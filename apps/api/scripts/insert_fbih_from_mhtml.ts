import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const JSON_PATH = path.join(ROOT, 'tmp', 'fbih_pravnapomoc_from_mhtml.json')
const OUT_PDF_DIR = path.resolve('D:/Projekti/Regulativa/Dokumenti/Federacija BiH/PDF')

type JsonItem = {
  title: string
  issue?: string
  date?: string
  url?: string
  pdf_url?: string
}

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return input.replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim()
}

function toGazette(issue?: string): { key?: string, number?: string } {
  if (!issue) return {}
  const first = issue.split(',')[0].trim() // take first if multiple
  const m = first.match(/^(\d{1,3})\/(\d{2,4})$/)
  if (!m) return {}
  const num = m[1]
  const year = m[2]
  return { key: `${num}_${year}`, number: num }
}

function toIso(date?: string): string | undefined {
  if (!date) return undefined
  const m = date.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (!m) return undefined
  const d = String(m[1]).padStart(2, '0')
  const mo = String(m[2]).padStart(2, '0')
  const yRaw = m[3]
  let Y = yRaw
  if (yRaw.length === 2) {
    const yNum = Number(yRaw)
    Y = String(yNum <= 39 ? 2000 + yNum : 1900 + yNum)
  }
  return `${Y}-${mo}-${d}`
}

async function ensureTables(db: sqlite3.Database) {
  await new Promise<void>((resolve, reject) =>
    db.run(
      `CREATE TABLE IF NOT EXISTS laws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jurisdiction TEXT NOT NULL,
        title TEXT NOT NULL,
        title_normalized TEXT,
        slug TEXT,
        doc_type TEXT,
        gazette_key TEXT,
        gazette_number TEXT,
        gazette_date TEXT,
        source_url TEXT,
        url_pdf TEXT,
        path_pdf TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      [],
      (err) => (err ? reject(err) : resolve())
    )
  )
}

async function downloadPdf(url: string, outPath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download PDF: ${res.status} ${res.statusText}`)
  const ab = await res.arrayBuffer()
  await fs.ensureDir(path.dirname(outPath))
  await fs.writeFile(outPath, Buffer.from(ab))
}

async function main() {
  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10)) : 3

  if (!(await fs.pathExists(JSON_PATH))) throw new Error(`JSON not found at ${JSON_PATH}`)
  const json = JSON.parse(await fs.readFile(JSON_PATH, 'utf-8')) as { count: number, items: JsonItem[] }
  const items = json.items.filter((it) => !!it.pdf_url).slice(0, LIMIT)
  console.log(`Preparing to insert ${items.length} FBiH laws...`)

  const db = new sqlite3.Database(DB_PATH)
  await ensureTables(db)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  let inserted = 0
  let skipped = 0
  for (const it of items) {
    const title = it.title
    const norm = normalizeTitle(title)
    const { key: gazette_key, number: gazette_number } = toGazette(it.issue)
    const gazette_date = toIso(it.date)
    const source_url = it.url || null
    let pdf_url = it.pdf_url || ''
    try { pdf_url = new URL(pdf_url, source_url || 'https://pravnapomoc.upfbih.ba/').href } catch {}
    const safeTitle = sanitizeFileName(title)
    const fileName = gazette_key ? `${safeTitle}-${gazette_key}.pdf` : `${safeTitle}.pdf`
    const path_pdf = path.join(OUT_PDF_DIR, fileName)

    const byKey = gazette_key ? await get<{ id: number }>('SELECT id FROM laws WHERE jurisdiction = ? AND gazette_key = ? AND title = ?', ['FBiH', gazette_key, title]) : undefined
    const byPath = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [path_pdf])
    if (byKey?.id || byPath?.id) {
      skipped++
      console.log(`Skip exists: ${title}`)
      continue
    }

    // Download PDF
    try {
      await downloadPdf(pdf_url, path_pdf)
    } catch (e) {
      console.warn(`Failed PDF for: ${title}`, e)
    }

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      ['FBiH', title, norm, gazette_key || null, gazette_number || null, gazette_date || null, source_url || null, pdf_url || null, path_pdf]
    )
    inserted++
    console.log(`Inserted: ${title}`)
  }

  console.log(`Done. Inserted=${inserted}, Skipped=${skipped}`)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })