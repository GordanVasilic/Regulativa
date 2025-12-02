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
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
  })
}

async function main() {
  const host = process.env.MEILI_HOST
  const apiKey = process.env.MEILI_KEY
  if (!host || !apiKey) throw new Error('MEILI_HOST/MEILI_KEY not set')
  const meili = new MeiliSearch({ host, apiKey })

  await meili.createIndex('laws', { primaryKey: 'id' }).catch(() => null)
  const index = meili.index('laws')
  await index.updateSettings({
    searchableAttributes: ['title', 'jurisdiction', 'gazette_key', 'title_normalized'],
    filterableAttributes: ['jurisdiction', 'gazette_key']
  })

  const laws = await all(
    `SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf, title_normalized FROM laws`
  )
  console.log(`Rebuilding laws index with ${laws.length} records...`)
  await index.deleteAllDocuments().catch(() => null)
  if (laws.length) {
    // chunked add to avoid payload limits
    const chunkSize = 1000
    for (let i = 0; i < laws.length; i += chunkSize) {
      const chunk = laws.slice(i, i + chunkSize)
      await index.addDocuments(chunk)
      console.log(`Indexed ${Math.min(i + chunkSize, laws.length)}/${laws.length}`)
    }
  }
  console.log('Done.')
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})