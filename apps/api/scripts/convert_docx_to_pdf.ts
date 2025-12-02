import path from 'node:path'
import fs from 'fs-extra'
import { execFile } from 'node:child_process'

async function findSoffice(): Promise<string> {
  const candidates = [
    'C\\\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C\\\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ]
  for (const c of candidates) {
    const p = c.replace(/\\\\/g, '\\')
    if (await fs.pathExists(p)) return p
  }
  return 'soffice'
}

async function convertDocxToPdf(sofficePath: string, srcPath: string, outDir: string): Promise<string> {
  await fs.ensureDir(outDir)
  await new Promise<void>((resolve, reject) => {
    execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
  const stem = path.basename(srcPath, path.extname(srcPath))
  const produced = path.join(outDir, `${stem}.pdf`)
  if (!(await fs.pathExists(produced))) throw new Error('LibreOffice did not produce PDF')
  return produced
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..')
  const docDir = path.join(root, 'Dokumenti', 'RepublikaSrpska', 'Doc')
  const pdfDir = path.join(root, 'Dokumenti', 'RepublikaSrpska', 'PDF')
  await fs.ensureDir(pdfDir)

  const sofficePath = await findSoffice()
  const docxFiles = (await fs.readdir(docDir)).filter((n) => n.toLowerCase().endsWith('.docx'))

  let convertedCount = 0
  const failed: string[] = []

  for (const name of docxFiles) {
    const srcPath = path.join(docDir, name)
    const outPath = path.join(pdfDir, `${path.basename(name, path.extname(name))}.pdf`)
    try {
      // ako već postoji, ukloni da izbjegnemo zadržane stare verzije
      if (await fs.pathExists(outPath)) await fs.remove(outPath)
      const produced = await convertDocxToPdf(sofficePath, srcPath, pdfDir)
      // osiguraj da se fajl nalazi pod tačnim imenom u pdfDir
      if (produced !== outPath) await fs.move(produced, outPath, { overwrite: true })
      convertedCount++
      console.log(`OK: ${name} -> ${path.basename(outPath)}`)
    } catch (e) {
      failed.push(name)
      console.log(`FAIL: ${name} - ${String(e)}`)
    }
  }

  const summary = {
    docxCount: docxFiles.length,
    convertedCount,
    failedCount: failed.length,
    failedFiles: failed,
    pdfDir,
  }
  const logPath = path.join(pdfDir, 'convert_pdf_log.json')
  await fs.writeJson(logPath, summary, { spaces: 2 })
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})