import 'dotenv/config'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { MeiliSearch } from 'meilisearch'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

sqlite3.verbose()
const db = new sqlite3.Database(DB_PATH)

function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])))
  })
}

async function main() {
  const rows = await all<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt
     FROM segments s
     JOIN laws l ON l.id = s.law_id
     WHERE l.jurisdiction = 'BRCKO' AND s.text LIKE 'Heuristički%'`
  )
  const sqliteCnt = rows[0]?.cnt ?? 0
  const host = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
  const apiKey = process.env.MEILI_KEY || 'devkey'
  const meili = new MeiliSearch({ host, apiKey })
  const index = meili.index('segments')
  const res: any = await index.search('Heuristički', { filter: 'jurisdiction = "BRCKO"', limit: 3 })
  const meiliCnt = Array.isArray(res?.hits) ? res.hits.length : 0
  console.log(JSON.stringify({ sqlite_heuristics_count: sqliteCnt, meili_hits_for_heuristics: meiliCnt }, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

