import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import AdmZip from 'adm-zip'
import { execFile } from 'node:child_process'

sqlite3.verbose()

function isUsable(u?: string | null): boolean {
  if (!u) return false
  const l = String(u).toLowerCase()
  return /(\.pdf|\.zip|\.docx?|\.rtf)(\?|$)/.test(l)
}

function sanitizeFileName(name: string) { return name.replace(/[\\/:*?"<>|]/g, '').trim() }

async function sofficeConvertToPdf(srcPath: string, outDir: string): Promise<string> {
  const candidates = [
    'C\\\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C\\\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ]
  let sofficePath = 'soffice'
  for (const c of candidates) {
    const p = c.replace(/\\\\/g, '\\')
    if (await fs.pathExists(p)) { sofficePath = p; break }
  }
  await new Promise<void>((resolve, reject) => {
    execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath], (err) => (err ? reject(err) : resolve()))
  })
  const stem = path.basename(srcPath, path.extname(srcPath))
  const produced = path.join(outDir, `${stem}.pdf`)
  if (!(await fs.pathExists(produced))) throw new Error('conversion failed')
  return produced
}

async function validatePdfFile(absPath: string): Promise<boolean> {
  try {
    const data = await fs.readFile(absPath)
    if (data.length < 8) return false
    const head = data.slice(0, 5).toString('ascii')
    const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
    return head.startsWith('%PDF-') && /%%EOF/.test(tail)
  } catch { return false }
}

async function ensurePdfFromUrl(url: string, title: string, gazetteKey: string | null, pdfDir: string): Promise<string | null> {
  await fs.ensureDir(pdfDir)
  const baseName = sanitizeFileName(title.trim())
  const suffix = gazetteKey ? `-${gazetteKey}` : ''
  const outPath = path.join(pdfDir, `${baseName}${suffix}.pdf`)
  if (await fs.pathExists(outPath)) {
    if (await validatePdfFile(outPath)) return outPath
    try { await fs.remove(outPath) } catch {}
  }
  const urlLower = (url || '').toLowerCase()
  const looksZip = /\.zip($|\?)/i.test(urlLower)
  const looksPdf = /\.pdf($|\?)/i.test(urlLower)
  try {
    if (!looksZip && looksPdf) {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      const data = Buffer.from(ab)
      const head = data.slice(0, 5).toString('ascii')
      const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
      if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) return null
      await fs.writeFile(outPath, data)
      return outPath
    }
    if (looksZip) {
      const tmpDir = path.join(process.cwd(), 'tmp', 'srb_zip_db')
      await fs.ensureDir(tmpDir)
      const zipTmp = path.join(tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}.zip`)
      const res = await fetch(url)
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      await fs.writeFile(zipTmp, Buffer.from(ab))
      const zip = new AdmZip(zipTmp)
      const entries = zip.getEntries().filter((e) => !e.isDirectory)
      const candidatePdf = entries.find((e) => path.basename(e.entryName).toLowerCase().endsWith('.pdf'))
      if (candidatePdf) {
        const data = candidatePdf.getData()
        const head = data.slice(0, 5).toString('ascii')
        const tail = data.slice(Math.max(0, data.length - 16)).toString('ascii')
        if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) { await fs.remove(zipTmp); return null }
        await fs.writeFile(outPath, data)
        await fs.remove(zipTmp)
        return outPath
      }
      const pickByExt = (ext: string) => entries.find((e) => path.basename(e.entryName).toLowerCase().endsWith(ext))
      const chosen = pickByExt('.docx') || pickByExt('.doc') || pickByExt('.rtf')
      if (!chosen) { await fs.remove(zipTmp); return null }
      const tmpSrc = path.join(tmpDir, `${path.basename(outPath, '.pdf')}${path.extname(chosen.entryName).toLowerCase()}`)
      await fs.writeFile(tmpSrc, chosen.getData())
      const produced = await sofficeConvertToPdf(tmpSrc, tmpDir)
      await fs.copy(produced, outPath)
      const data = await fs.readFile(outPath)
      const head = data.slice(0, 5).toString('ascii')
      const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
      if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) { await fs.remove(zipTmp); await fs.remove(tmpSrc); await fs.remove(produced); await fs.remove(outPath); return null }
      await fs.remove(zipTmp); await fs.remove(tmpSrc); await fs.remove(produced)
      return outPath
    }
    return null
  } catch { return null }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Srbija', 'PDF')
  await fs.ensureDir(PDF_DIR)
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const laws = await all<{ id: number; title: string; source_url: string | null; url_pdf: string | null; gazette_key: string | null }>(
    `SELECT id, title, source_url, url_pdf, gazette_key FROM laws WHERE jurisdiction='SRB' AND (path_pdf IS NULL OR path_pdf='') ORDER BY id ASC`
  )
  let repaired = 0, skipped = 0
  for (const law of laws) {
    const candidateUrl = isUsable(law.url_pdf) ? String(law.url_pdf) : (isUsable(law.source_url) ? String(law.source_url) : '')
    if (!candidateUrl) { skipped++; continue }
    const path_pdf = await ensurePdfFromUrl(candidateUrl, law.title, law.gazette_key, PDF_DIR)
    if (path_pdf) {
      const port = process.env.PORT ? Number(process.env.PORT) : 5000
      const localUrl = `http://localhost:${port}/pdf/${law.id}`
      await run("UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime('now') WHERE id = ?", [path_pdf, localUrl, law.id])
      repaired++
    } else {
      skipped++
    }
  }
  console.log(JSON.stringify({ ok: true, repaired, skipped, total: laws.length }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })

