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

  console.log('Waiting for MeiliSearch to be healthy...')
  // Wait a bit for Meili to start
  await new Promise(r => setTimeout(r, 2000))

  // 1. Index Laws
  console.log('Indexing Laws...')
  await meili.createIndex('laws', { primaryKey: 'id' }).catch(() => null)
  const indexLaws = meili.index('laws')
  await indexLaws.updateSettings({
    searchableAttributes: ['title', 'jurisdiction', 'gazette_key', 'title_normalized'],
    filterableAttributes: ['jurisdiction', 'gazette_key']
  })
  await indexLaws.deleteAllDocuments().catch(() => null)
  
  const laws = await all('SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf, title_normalized FROM laws')
  if (laws.length) {
      const chunkSize = 1000
      for (let i = 0; i < laws.length; i += chunkSize) {
        await indexLaws.addDocuments(laws.slice(i, i + chunkSize))
        console.log(`Indexed laws ${Math.min(i + chunkSize, laws.length)}/${laws.length}`)
      }
  }

  // 2. Index Segments (Law by Law to save RAM)
  console.log('Indexing Segments...')
  await meili.createIndex('segments', { primaryKey: 'id' }).catch(() => null)
  const indexSegments = meili.index('segments')
  await indexSegments.updateSettings({
    searchableAttributes: ['label', 'text', 'law_title'],
    filterableAttributes: ['law_id', 'number', 'jurisdiction', 'gazette_key'],
    synonyms: {
      clan: ['član', 'cl.', 'čl', 'čl.', 'članak', 'clanak'],
      'član': ['clan', 'cl.', 'čl', 'čl.', 'članak', 'clanak'],
      clanak: ['član', 'clan', 'članak', 'cl.', 'čl', 'čl.'],
      'članak': ['član', 'clan', 'clanak', 'cl.', 'čl', 'čl.'],
      pozar: ['požar', 'požara'],
      pozara: ['požara', 'požar']
    }
  })
  await indexSegments.deleteAllDocuments().catch(() => null)

  const lawIds = await all<{ id: number, title: string, jurisdiction: string, gazette_key: string }>('SELECT id, title, jurisdiction, gazette_key FROM laws')
  console.log(`Found ${lawIds.length} laws to process segments for.`)

  let count = 0
  for (const law of lawIds) {
    const segments = await all(`
        SELECT id, law_id, label, number, text, page_hint 
        FROM segments 
        WHERE law_id = ?
    `, [law.id])
    
    if (segments.length > 0) {
        const docs = segments
            .filter((s: any) => !/^Heuristički/i.test(s.text || ''))
            .map((s: any) => ({
                ...s,
                law_title: law.title,
                jurisdiction: law.jurisdiction,
                gazette_key: law.gazette_key
            }))
        
        if (docs.length > 0) {
             await indexSegments.addDocuments(docs)
        }
    }
    count++
    if (count % 100 === 0) {
        console.log(`Processed segments for ${count}/${lawIds.length} laws`)
        // Force GC or pause slightly to let Meili catch up
        if (count % 500 === 0) await new Promise(r => setTimeout(r, 1000))
    }
  }
  
  console.log('Done.')
  db.close()
}

main().catch(console.error)
