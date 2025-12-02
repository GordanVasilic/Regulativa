import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []) {
  return new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))) )
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  const total = await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ?', ['FBiH'])
  const withPdf = await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND path_pdf IS NOT NULL', ['FBiH'])
  const withDate = await get<{ cnt: number }>(db, 'SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction = ? AND gazette_date IS NOT NULL', ['FBiH'])
  console.log(JSON.stringify({ total: total?.cnt || 0, with_pdf: withPdf?.cnt || 0, with_date: withDate?.cnt || 0 }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })