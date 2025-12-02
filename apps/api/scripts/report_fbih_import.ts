import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
}
function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  const totals = {
    total: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ?', ['FBiH']))?.cnt || 0,
    with_pdf: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND path_pdf IS NOT NULL', ['FBiH']))?.cnt || 0,
    with_date: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND gazette_date IS NOT NULL', ['FBiH']))?.cnt || 0,
    with_gazette_key: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND gazette_key IS NOT NULL AND gazette_key <> ""', ['FBiH']))?.cnt || 0,
    with_gazette_number: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND gazette_number IS NOT NULL AND gazette_number <> ""', ['FBiH']))?.cnt || 0,
    with_source_url: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND source_url IS NOT NULL AND source_url <> ""', ['FBiH']))?.cnt || 0,
    with_url_pdf: (await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND url_pdf IS NOT NULL AND url_pdf <> ""', ['FBiH']))?.cnt || 0,
  }
  const missingPdfs = await all<{ id: number; title: string; gazette_key: string | null; source_url: string | null }>(
    db,
    'SELECT id, title, gazette_key, source_url FROM laws WHERE jurisdiction = ? AND (path_pdf IS NULL OR path_pdf = "") ORDER BY id ASC',
    ['FBiH']
  )
  const missingDates = await all<{ id: number; title: string; gazette_key: string | null }>(
    db,
    'SELECT id, title, gazette_key FROM laws WHERE jurisdiction = ? AND (gazette_date IS NULL OR gazette_date = "") ORDER BY id ASC',
    ['FBiH']
  )
  const missingGazetteKey = await all<{ id: number; title: string }>(
    db,
    'SELECT id, title FROM laws WHERE jurisdiction = ? AND (gazette_key IS NULL OR gazette_key = "") ORDER BY id ASC',
    ['FBiH']
  )
  const missingGazetteNumber = await all<{ id: number; title: string }>(
    db,
    'SELECT id, title FROM laws WHERE jurisdiction = ? AND (gazette_number IS NULL OR gazette_number = "") ORDER BY id ASC',
    ['FBiH']
  )
  const missingSourceUrl = await all<{ id: number; title: string }>(
    db,
    'SELECT id, title FROM laws WHERE jurisdiction = ? AND (source_url IS NULL OR source_url = "") ORDER BY id ASC',
    ['FBiH']
  )
  const missingUrlPdf = await all<{ id: number; title: string }>(
    db,
    'SELECT id, title FROM laws WHERE jurisdiction = ? AND (url_pdf IS NULL OR url_pdf = "") ORDER BY id ASC',
    ['FBiH']
  )
  const recent = await all<{ id: number; title: string; gazette_key: string | null; gazette_date: string | null; path_pdf: string | null }>(
    db,
    'SELECT id, title, gazette_key, gazette_date, path_pdf FROM laws WHERE jurisdiction = ? ORDER BY updated_at DESC, id DESC LIMIT 20',
    ['FBiH']
  )

  console.log(
    JSON.stringify(
      {
        ok: true,
        totals,
        missing_pdfs: missingPdfs,
        missing_dates: missingDates,
        missing_gazette_key: missingGazetteKey,
        missing_gazette_number: missingGazetteNumber,
        missing_source_url: missingSourceUrl,
        missing_url_pdf: missingUrlPdf,
        recent_updates: recent,
      },
      null,
      2
    )
  )
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})