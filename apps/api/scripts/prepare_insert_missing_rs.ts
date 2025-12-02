import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const DUMPS_DIR = path.join(ROOT, '..', '..', 'dumps')
const RS_PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')

async function listPdfPathsNonRecursive(dir: string): Promise<string[]> {
  const exists = await fs.pathExists(dir)
  if (!exists) return []
  const files = await fs.readdir(dir)
  return files.filter((f) => f.toLowerCase().endsWith('.pdf')).map((f) => path.join(dir, f))
}

function parseFromFilename(file: string) {
  const base = path.basename(file, '.pdf')
  const m = base.match(/^(.*?)-([0-9]{1,3}_[0-9]{2})$/)
  const title = m ? m[1] : base
  const gazette_key = m ? m[2] : null
  const gazette_number = gazette_key ? gazette_key.split('_')[0] : null
  const gazette_year = gazette_key ? gazette_key.split('_')[1] : null
  return { title, gazette_key, gazette_number, gazette_year }
}

function normalizeTitle(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
}

async function main() {
  const pdfs = await listPdfPathsNonRecursive(RS_PDF_DIR)
  const db = new sqlite3.Database(DB_PATH)
  const rows = await new Promise<{ path_pdf: string | null }[]>((resolve, reject) =>
    db.all('SELECT path_pdf FROM laws WHERE jurisdiction = ?', ['RS'], (err, r) => (err ? reject(err) : resolve(r as any)))
  )
  const lawPaths = new Set(
    rows
      .map((r) => (r.path_pdf || '').trim().replace(/\\/g, '/').toLowerCase())
      .filter((p) => p)
  )
  const missing = pdfs
    .filter((p) => !lawPaths.has(p.trim().replace(/\\/g, '/').toLowerCase()))
    .map((p) => ({ file: path.basename(p), path: p }))

  const proposed: any[] = []
  for (const item of missing) {
    const { title, gazette_key, gazette_number, gazette_year } = parseFromFilename(item.file)
    // pokušaj dobiti datum glasnika iz postojećih unosa sa istim ključem
    let gazette_date: string | null = null
    if (gazette_key) {
      const row = await get<{ gazette_date: string }>(
        db,
        'SELECT gazette_date FROM laws WHERE jurisdiction = ? AND gazette_key = ? AND gazette_date IS NOT NULL LIMIT 1',
        ['RS', gazette_key]
      )
      gazette_date = row?.gazette_date || null
    }

    const record = {
      jurisdiction: 'RS',
      title,
      title_normalized: normalizeTitle(title),
      slug: null,
      doc_type: null,
      gazette_key,
      gazette_number,
      gazette_date, // ako je null, popuniće se kasnije web scrapingom
      source_url: null,
      url_pdf: null,
      path_pdf: item.path,
    }
    proposed.push(record)
  }

  // Sačuvaj preview za provjeru
  const outPath = path.join(DUMPS_DIR, 'missing_rs_insert_preview.json')
  await fs.writeJSON(outPath, { count: proposed.length, items: proposed }, { spaces: 2 })
  console.log(`Generisano ${proposed.length} predložених unosa -> ${outPath}`)

  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})