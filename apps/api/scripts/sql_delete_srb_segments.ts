import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  await new Promise<void>((resolve, reject) => db.exec("PRAGMA busy_timeout=5000", (err) => (err ? reject(err) : resolve())))

  const before = await all<{ c: number }>(
    "SELECT COUNT(*) AS c FROM segments s JOIN laws l ON l.id=s.law_id WHERE l.jurisdiction='SRB'"
  )
  console.log(`SRB segments before delete=${before[0]?.c ?? 0}`)

  await run("DELETE FROM segments WHERE law_id IN (SELECT id FROM laws WHERE jurisdiction='SRB')")

  const after = await all<{ c: number }>(
    "SELECT COUNT(*) AS c FROM segments s JOIN laws l ON l.id=s.law_id WHERE l.jurisdiction='SRB'"
  )
  console.log(`SRB segments after delete=${after[0]?.c ?? 0}`)

  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

