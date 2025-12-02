import path from 'node:path'
import sqlite3 from 'sqlite3'
import fs from 'fs-extra'

sqlite3.verbose()

async function main() {
  const ROOT = path.resolve(process.cwd())
  const dbPaths = [
    path.join(ROOT, 'data', 'regulativa.db'),
    path.join(path.dirname(ROOT), 'data', 'regulativa.db')
  ]
  const DB_PATH = dbPaths.find((p) => fs.existsSync(p)) || dbPaths[0]
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  try {
    const rows = await all<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM laws WHERE jurisdiction='SRB' AND (path_pdf IS NULL OR path_pdf='')`
    )
    console.log(JSON.stringify({ jurisdiction: 'SRB', path_pdf_null: rows[0]?.cnt ?? 0 }))
  } catch (e) {
    console.error('Query failed:', e)
    process.exit(1)
  } finally {
    db.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

