import 'dotenv/config'
import { MeiliSearch } from 'meilisearch'

async function main() {
  const host = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
  const apiKey = process.env.MEILI_KEY || 'devkey'
  const client = new MeiliSearch({ host, apiKey })
  const indexes = await client.getIndexes()
  const used = new Set(['documents', 'laws', 'segments'])
  const out = [] as any[]
  for (const idx of indexes.results || []) {
    const stats: any = await client.index(idx.uid).getStats().catch(() => ({}))
    out.push({ name: idx.uid, docs: Number(stats.numberOfDocuments || 0), used: used.has(idx.uid) })
  }
  console.log(JSON.stringify({ host, total_indexes: out.length, indexes: out }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

