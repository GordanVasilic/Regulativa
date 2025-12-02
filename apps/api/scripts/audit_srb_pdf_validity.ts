import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

sqlite3.verbose()

async function checkPdfOpenable(filePath: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const buf = await fs.readFile(filePath)
    if (buf.length < 8) return { ok: false, reason: 'too_small' }
    const head = buf.slice(0, 5).toString('ascii')
    const tail = buf.slice(Math.max(0, buf.length - 32)).toString('ascii')
    if (!head.startsWith('%PDF-')) return { ok: false, reason: 'no_pdf_header' }
    if (!/%%EOF/.test(tail)) return { ok: false, reason: 'no_eof_marker' }
    try {
      const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
      const loadingTask = getDocument({ data: u8 })
      const pdf = await loadingTask.promise
      // Try to get first page to ensure rendering pipeline works
      const page = await pdf.getPage(1)
      await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
      await pdf.cleanup()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: String(e) }
    }
  } catch (e) {
    return { ok: false, reason: 'read_error:' + String(e) }
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  await new Promise<void>((resolve, reject) => db.exec('PRAGMA busy_timeout=5000', (err) => (err ? reject(err) : resolve())))
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

  const laws = await all<{ id: number; title: string; path_pdf: string }>(
    "SELECT id, title, path_pdf FROM laws WHERE jurisdiction = 'SRB' AND path_pdf IS NOT NULL ORDER BY id ASC"
  )

  let ok = 0
  const bad: { id: number; title: string; path: string; reason: string }[] = []
  for (const l of laws) {
    const abs = path.isAbsolute(l.path_pdf) ? l.path_pdf : path.join(ROOT, l.path_pdf)
    const exists = await fs.pathExists(abs)
    if (!exists) {
      bad.push({ id: l.id, title: l.title, path: abs, reason: 'missing_file' })
      continue
    }
    const res = await checkPdfOpenable(abs)
    if (res.ok) ok++
    else bad.push({ id: l.id, title: l.title, path: abs, reason: res.reason || 'unknown' })
  }

  const summary = {
    jurisdiction: 'SRB',
    total: laws.length,
    ok,
    bad: bad.length,
    bad_reasons_top: Object.entries(
      bad.reduce((acc: Record<string, number>, b) => {
        const key = String(b.reason || 'unknown')
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {})
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([reason, count]) => ({ reason, count })),
    samples: bad.slice(0, 15),
  }
  console.log(JSON.stringify(summary, null, 2))
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

