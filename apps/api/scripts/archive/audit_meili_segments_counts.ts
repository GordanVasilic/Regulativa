import { MeiliSearch } from 'meilisearch'

const host = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const apiKey = process.env.MEILI_KEY || 'devkey'

async function main() {
  const client = new MeiliSearch({ host, apiKey })
  const index = client.index('segments')
  const jurisdictions = ['RS', 'FBiH', 'SRB', 'BRCKO', 'Crna Gora']
  const byJur: Record<string, number> = {}
  for (const j of jurisdictions) {
    const res: any = await index.search('', { filter: `jurisdiction = "${j}"`, limit: 0 })
    byJur[j] = Number(res.estimatedTotalHits || 0)
  }
  const all: any = await index.search('', { limit: 0 })
  console.log(JSON.stringify({ total_segments: Number(all.estimatedTotalHits || 0), by_jurisdiction: byJur }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

