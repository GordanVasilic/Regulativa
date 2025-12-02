import path from 'node:path'
import fs from 'fs-extra'
import AdmZip from 'adm-zip'
import convert from 'libreoffice-convert'
import { execFile } from 'node:child_process'

function sanitizeFilename(input: string) {
  const illegal = /[<>:"/\\|?*]/g
  const cleaned = input.replace(illegal, '').replace(/\s+/g, ' ').trim()
  return cleaned
}

async function ensureUniquePath(dir: string, baseName: string): Promise<string> {
  const ext = path.extname(baseName)
  const stem = baseName.slice(0, ext.length ? baseName.length - ext.length : baseName.length)
  let idx = 1
  let candidate = path.join(dir, baseName)
  while (await fs.pathExists(candidate)) {
    candidate = path.join(dir, `${stem}_DUP${idx}${ext}`)
    idx++
  }
  return candidate
}

function bufferConvertToDocx(input: Buffer, fromExt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      convert(input, '.docx', undefined, (err: any, done: Buffer) => {
        if (err) return reject(err)
        resolve(done)
      })
    } catch (e) {
      reject(e)
    }
  })
}

async function sofficeConvertToDocx(srcPath: string, outDir: string): Promise<string> {
  // Pokušaj poznate lokacije na Windowsu pa fallback na PATH
  const candidates = [
    'C\\\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C\\\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ]
  let sofficePath = 'soffice'
  for (const c of candidates) {
    const p = c.replace(/\\\\/g, '\\')
    if (await fs.pathExists(p)) {
      sofficePath = p
      break
    }
  }
  await new Promise<void>((resolve, reject) => {
    execFile(sofficePath, ['--headless', '--convert-to', 'docx', '--outdir', outDir, srcPath], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
  const stem = path.basename(srcPath, path.extname(srcPath))
  const produced = path.join(outDir, `${stem}.docx`)
  if (!(await fs.pathExists(produced))) {
    throw new Error('LibreOffice conversion did not produce output')
  }
  return produced
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..')
  const zipDir = path.join(root, 'Dokumenti', 'RepublikaSrpska', 'ZIP')
  const docDir = path.join(root, 'Dokumenti', 'RepublikaSrpska', 'Doc')
  await fs.ensureDir(docDir)

  const zips = (await fs.readdir(zipDir)).filter((n) => n.toLowerCase().endsWith('.zip'))

  const failedUnzip: string[] = []
  const failedConvert: string[] = []
  let convertedCount = 0
  let producedCount = 0

  for (const zipName of zips) {
    const zipPath = path.join(zipDir, zipName)
    const zipStem = path.basename(zipName, path.extname(zipName))
    try {
      const zip = new AdmZip(zipPath)
      const entries = zip.getEntries()
      // Odaberi tačno jedan kandidat po ZIP-u: prioritet .docx > .doc > .rtf
      // Odaberi tačno jedan kandidat po ZIP-u: prioritet .docx > .doc > .rtf
      const fileEntries = entries.filter((e) => !e.isDirectory)
      const pickByExt = (ext: string) => fileEntries.find((e) => path.basename(e.entryName).toLowerCase().endsWith(ext))
      let chosenEntry = pickByExt('.docx') || pickByExt('.doc') || pickByExt('.rtf')

      if (!chosenEntry) {
        // nema konvertibilnih dokumenata u ZIP-u
        failedConvert.push(zipName)
        console.log(`SKIP (no doc/docx/rtf): ${zipName}`)
      } else {
        // Ime izlaza je tačno naziv ZIP-a (bez .zip)
        const outPath = path.join(docDir, `${zipStem}.docx`)
        const lower = path.basename(chosenEntry.entryName).toLowerCase()
        const data = chosenEntry.getData()
        try {
          if (lower.endsWith('.docx')) {
            // već .docx -> prepiši (bez duplikata)
            await fs.writeFile(outPath, data)
            producedCount++
            console.log(`OK (copy docx): ${zipName} -> ${path.basename(outPath)}`)
          } else {
            // Sačuvaj ulaz u privremenu datoteku pa konvertuj preko soffice CLI
            const tmpSrcPath = path.join(docDir, `${zipStem}__SRC${path.extname(lower).toLowerCase()}`)
            await fs.writeFile(tmpSrcPath, data)
            const producedTmp = await sofficeConvertToDocx(tmpSrcPath, docDir)
            // Preimenuj proizvedeni .docx na željeni outPath (prepiši)
            if (await fs.pathExists(outPath)) await fs.remove(outPath)
            await fs.move(producedTmp, outPath, { overwrite: true })
            await fs.remove(tmpSrcPath)
            convertedCount++
            producedCount++
            console.log(`OK (convert ${path.extname(lower)}): ${zipName} -> ${path.basename(outPath)}`)
          }
        } catch (convErr) {
          failedConvert.push(zipName)
          console.log(`FAIL (convert): ${zipName} - ${String(convErr)}`)
        }
      }
    } catch (e) {
      failedUnzip.push(zipName)
      // ako unzip padne, preskoči konverziju za ovaj ZIP
      continue
    }
    // Ako ZIP nije proizveo izlaz (nema kandidata ili greška), već je označen u failedConvert
  }

  const summary = {
    zipCount: zips.length,
    producedCount,
    convertedCount,
    failedUnzipCount: failedUnzip.length,
    failedConvertCount: failedConvert.length,
    failedUnzip,
    failedConvert,
    docDir,
  }
  const logPath = path.join(docDir, 'extract_convert_log.json')
  await fs.writeJson(logPath, summary, { spaces: 2 })
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})