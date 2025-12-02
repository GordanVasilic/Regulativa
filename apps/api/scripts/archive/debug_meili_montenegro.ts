
import { MeiliSearch } from 'meilisearch';

const client = new MeiliSearch({
    host: 'http://127.0.0.1:7700',
    apiKey: 'devkey',
});

async function check() {
    try {
        const lawsStats = await client.index('laws').getStats();
        console.log('Laws Index Stats:', lawsStats);

        const segmentsStats = await client.index('segments').getStats();
        console.log('Segments Index Stats:', segmentsStats);

        console.log('\nSearching for "Porodični zakon" in "laws" index (Crna Gora)...');
        const lawSearch = await client.index('laws').search('Porodični zakon', {
            filter: 'jurisdiction = "Crna Gora"'
        });

        console.log(`Found ${lawSearch.hits.length} laws.`);
        lawSearch.hits.forEach(hit => {
            console.log(`- ${hit.title} (ID: ${hit.id})`);
        });

        if (lawSearch.hits.length > 0) {
            const lawId = lawSearch.hits[0].id;
            console.log(`\nChecking segments for Law ID: ${lawId}...`);
            const segmentStats = await client.index('segments').search('', {
                filter: `law_id = ${lawId}`,
                limit: 0
            });
            console.log(`Total segments for this law: ${segmentStats.estimatedTotalHits}`);

            console.log(`\nSearching for "član 11" in segments for this law...`);
            const segmentSearch = await client.index('segments').search('član 11', {
                filter: `law_id = ${lawId}`
            });
            console.log(`Found ${segmentSearch.hits.length} segments matching "član 11".`);
            segmentSearch.hits.forEach(hit => {
                console.log(`- ${hit.text.substring(0, 100)}...`);
            });
        }

    } catch (error) {
        console.error('Error:', error);
    }
}

check();
