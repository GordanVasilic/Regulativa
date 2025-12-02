import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

async function main() {
  const LAW_ID = process.env.LAW_ID ? Number(process.env.LAW_ID) : NaN
  const PATH_PDF = process.env.PATH_PDF ? String(process.env.PATH_PDF) : ''
  if (!LAW_ID || !PATH_PDF) {
    console.error('Provide LAW_ID and PATH_PDF')
    process.exit(1)
  }
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const port = process.env.PORT ? Number(process.env.PORT) : 5000
  const localUrl = `http://localhost:${port}/pdf/${LAW_ID}`
  await run("UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime('now') WHERE id = ?", [PATH_PDF, localUrl, LAW_ID])
  console.log(JSON.stringify({ ok: true }))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })

