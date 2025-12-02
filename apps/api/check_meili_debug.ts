import 'dotenv/config'
import { MeiliSearch } from 'meilisearch'

console.log('MEILI_HOST:', process.env.MEILI_HOST)
console.log('MEILI_KEY:', process.env.MEILI_KEY)

const client = new MeiliSearch({
    host: process.env.MEILI_HOST || 'http://localhost:7700',
    apiKey: process.env.MEILI_KEY,
})

async function check() {
    try {
        const indexes = await client.getIndexes()
        console.log('Indexes:', indexes.results.map(i => i.uid))

        for (const index of indexes.results) {
            const stats = await client.index(index.uid).getStats()
            console.log(`Index ${index.uid} stats:`, stats)
        }
    } catch (e) {
        console.error('Error:', e)
    }
}

check()
