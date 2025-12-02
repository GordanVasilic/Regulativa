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
    const rows = await all<{
      id: number,
      title: string,
      gazette_key: string | null,
      gazette_date: string | null,
      path_pdf: string | null
    }>(
      `SELECT l.id, l.title, l.gazette_key, l.gazette_date, l.path_pdf
       FROM laws l
       LEFT JOIN segments s ON s.law_id = l.id
       WHERE l.jurisdiction = 'SRB'
       GROUP BY l.id
       HAVING COUNT(s.id) = 0
       ORDER BY l.id ASC
       LIMIT 10`
    )
    console.log(JSON.stringify(rows, null, 2))
  } catch (e) {
    console.error('Query failed:', e)
    process.exit(1)
  } finally {
    db.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

