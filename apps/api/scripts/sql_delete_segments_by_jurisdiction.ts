import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

const ROOT = path.resolve(process.cwd())
const CANDIDATE_DB_PATHS = [
  path.join(ROOT, 'apps', 'api', 'data', 'regulativa.db'),
  path.join(ROOT, 'data', 'regulativa.db')
]
const DB_PATH = CANDIDATE_DB_PATHS.find((p) => fs.existsSync(p)) || CANDIDATE_DB_PATHS[0]

sqlite3.verbose()
const db = new sqlite3.Database(DB_PATH)

function run(sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}

function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  })
}

async function main() {
  const jurisdiction = process.env.JURISDICTION ? String(process.env.JURISDICTION) : 'BRCKO'

  const laws = await all<{ id: number }>(
    `SELECT id FROM laws WHERE jurisdiction = ? ORDER BY id ASC`,
    [jurisdiction]
  )
  const ids = laws.map((l) => l.id)
  console.log(`Found ${ids.length} laws for jurisdiction=${jurisdiction}`)
  if (!ids.length) {
    db.close()
    return
  }

  await run('BEGIN')
  try {
    const placeholders = ids.map(() => '?').join(',')
    await run(`DELETE FROM segments WHERE law_id IN (${placeholders})`, ids)
    await run('COMMIT')
    console.log(`Deleted segments for ${ids.length} laws in jurisdiction=${jurisdiction}`)
  } catch (e) {
    await run('ROLLBACK').catch(() => null)
    console.error('Deletion failed, rolled back:', e)
    db.close()
    process.exit(1)
  }
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
