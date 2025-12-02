import path from 'path'
import sqlite3 from 'sqlite3'

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | null>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve((row as T) || null))))

  const laws = await all<{ id: number; title: string }>(
    'SELECT id, title FROM laws WHERE jurisdiction = ? ORDER BY id ASC',
    ['RS']
  )

  let lawsWithSynthetic = 0
  const samples: { id: number; title: string; syntheticCount: number }[] = []

  for (const law of laws) {
    const cntAll = await get<{ cnt: number }>('SELECT COUNT(*) as cnt FROM segments WHERE law_id = ? AND segment_type = ?', [law.id, 'article'])
    const cntSynth = await get<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM segments WHERE law_id = ? AND segment_type = 'article' AND text LIKE 'Heuristički segment za %'",
      [law.id]
    )
    const syntheticCount = Number(cntSynth?.cnt || 0)
    if (syntheticCount > 0) {
      lawsWithSynthetic++
      samples.push({ id: law.id, title: law.title, syntheticCount })
    }
  }

  console.log(
    JSON.stringify(
      {
        totalRsLaws: laws.length,
        lawsWithSynthetic,
        sample: samples.slice(0, 20),
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