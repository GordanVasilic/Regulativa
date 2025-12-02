import path from 'node:path'
import sqlite3 from 'sqlite3'

async function main() {
  const DB_PATH = path.join(process.cwd(), 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

  const before = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora'")
  await run("DELETE FROM laws WHERE jurisdiction='Crna Gora'")
  await run('VACUUM')
  const after = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora'")
  console.log(JSON.stringify({ deleted: before?.c || 0, remaining: after?.c || 0 }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })

