import { MeiliSearch } from 'meilisearch'

const host = process.env.MEILI_HOST || 'http://127.0.0.1:7700'
const apiKey = process.env.MEILI_KEY || 'devkey'

async function main() {
  const client = new MeiliSearch({ host, apiKey })
  const index = client.index('segments')
  const res1: any = await index.search('', { filter: 'law_id = 5803', limit: 3 })
  console.log('law_id=5803 estimatedTotalHits=', res1.estimatedTotalHits)
  const res2: any = await index.search('član', { filter: 'jurisdiction = "BRCKO"', limit: 3 })
  console.log('jur=BRCKO član hits=', res2.hits?.length || 0, 'est=', res2.estimatedTotalHits)
  const res3: any = await index.search('član', { limit: 3 })
  console.log('global član hits=', res3.hits?.length || 0, 'est=', res3.estimatedTotalHits)
}

main().catch((e) => { console.error(e); process.exit(1) })

