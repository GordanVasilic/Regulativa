import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  const rows = await all(db, 'SELECT id, jurisdiction, title, gazette_key, gazette_date, godina, url_pdf, path_pdf FROM laws WHERE jurisdiction = ? ORDER BY id DESC LIMIT 3', ['BRCKO'])
  const problematic = await all<{ id: number; title: string }>(db, "SELECT id, title FROM laws WHERE jurisdiction='BRCKO' AND title GLOB '[0-9]* *' LIMIT 10")
  console.log(JSON.stringify({ sample: rows, leading_number_examples: problematic }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })