import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function extractFirstText(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath)
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const loadingTask = getDocument({ data: u8 })
  const pdf = await loadingTask.promise
  const pages: string[] = []
  const maxPages = Math.min(3, pdf.numPages)
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i)
    const textContent: any = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
    let lastY = null as number | null
    let text = ''
    for (const item of textContent.items) {
      const str = String(item.str || '')
      const y = item.transform ? item.transform[5] : null
      if (lastY !== null && y !== null && Math.abs(lastY - y) > 9) text += '\n'
      text += str + ' '
      if (y !== null) lastY = y
    }
    const cleaned = text.replace(/\s+\n/g, '\n').replace(/\s{2,}/g, ' ').trim()
    pages.push(cleaned)
  }
  await pdf.cleanup()
  return pages.join('\n\n')
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  const laws = await all<{ id: number; title: string; path_pdf: string }>(
    `SELECT l.id, l.title, l.path_pdf
     FROM laws l
     WHERE l.jurisdiction = 'BRCKO' AND l.path_pdf IS NOT NULL
     ORDER BY l.id ASC`
  )

  let added = 0
  for (const r of laws) {
    const segs = await all<{ id: number; text: string }>('SELECT id, text FROM segments WHERE law_id = ?', [r.id])
    const nonHeu = segs.filter((s) => !/^Heuristički/i.test(String(s.text || '')))
    if (nonHeu.length > 0) continue
    try {
      const filePath = String(r.path_pdf)
      if (!(await fs.pathExists(filePath))) continue
      const text = await extractFirstText(filePath)
      const snippet = text.slice(0, Math.min(text.length, 4000)).trim()
      await run('INSERT OR IGNORE INTO segments (law_id, segment_type, label, number, text, page_hint) VALUES (?, ?, ?, ?, ?, ?)', [r.id, 'article', 'Uvod', 0, snippet, 1])
      added++
      console.log(`Added BRCKO fallback segment law_id=${r.id}`)
    } catch (e) {
      console.warn(`Skip law_id=${r.id}:`, e)
    }
  }
  console.log(`Done. laws=${laws.length}, added=${added}`)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })

