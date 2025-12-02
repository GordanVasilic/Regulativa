import { MeiliSearch } from 'meilisearch'

const client = new MeiliSearch({
    host: 'http://127.0.0.1:7700',
    apiKey: 'devkey'
})

async function verifySearch() {
    console.log('=== Verifying Porodični zakon Search ===\n')

    // 1. Check law exists
    const lawsIndex = client.index('laws')
    const lawResults = await lawsIndex.search('Porodični zakon', {
        filter: 'jurisdiction = "Crna Gora"',
        limit: 5
    })

    console.log(`Found ${lawResults.hits.length} laws matching "Porodični zakon"`)
    const porodicniZakon = lawResults.hits.find((hit: any) => hit.id === 8653)

    if (porodicniZakon) {
        console.log(`✓ Found "Porodični zakon" (ID: 8653)`)
        console.log(`  Title: ${porodicniZakon.title}`)
    } else {
        console.log('✗ "Porodični zakon" (ID 8653) not found!')
        return
    }

    // 2. Check segments exist for this law
    const segmentsIndex = client.index('segments')
    const allSegments = await segmentsIndex.search('', {
        filter: 'law_id = 8653',
        limit: 1
    })

    console.log(`\n✓ Total segments for law 8653: ${allSegments.estimatedTotalHits}`)

    // 3. Search for "član 11"
    const clanResults = await segmentsIndex.search('član 11', {
        filter: 'law_id = 8653',
        limit: 5
    })

    console.log(`\n=== Search Results for "član 11" ===`)
    console.log(`Found ${clanResults.hits.length} segments`)

    if (clanResults.hits.length > 0) {
        console.log('\n✓ SUCCESS! Segments found:')
        clanResults.hits.forEach((hit: any, idx: number) => {
            console.log(`\n${idx + 1}. ${hit.label}`)
            console.log(`   Text preview: ${hit.text.slice(0, 100)}...`)
        })
    } else {
        console.log('\n✗ No segments found for "član 11"')
    }

    // 4. General search across all Montenegro laws
    const generalSearch = await segmentsIndex.search('član 11', {
        filter: 'jurisdiction = "Crna Gora"',
        limit: 10
    })

    console.log(`\n=== General Search "član 11" in Crna Gora ===`)
    console.log(`Found ${generalSearch.estimatedTotalHits} total segments across all laws`)
}

verifySearch().catch(console.error)
