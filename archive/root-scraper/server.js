const express = require('express');
const path = require('path');
const { scrapeFBIHLaws2004 } = require('./scrape_fbih_2004');
const { getLawsFromMHTML2004 } = require('./law_parser_2004');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// API endpoint for scraping FBIH laws 2004
app.get('/api/scrape-fbih-2004', async (req, res) => {
    try {
        console.log('Starting FBIH 2004 laws scrape...');
        let laws = await scrapeFBIHLaws2004();
        console.log(`Scraping returned ${laws ? laws.length : 0} laws`);
        
        // If web scraping fails or returns no results, try MHTML parser
        if (!laws || laws.length === 0) {
            console.log('Web scraping returned no results, trying MHTML parser...');
            laws = getLawsFromMHTML2004();
            console.log(`MHTML parser found ${laws.length} laws`);
        }
        
        res.json({
            success: true,
            count: laws.length,
            data: laws,
            source: laws.length > 0 ? (laws[0].url ? 'web' : 'mhtml') : 'none'
        });
        
        console.log(`Returned ${laws.length} laws successfully`);
    } catch (error) {
        console.error('Scraping error:', error);
        
        // Try MHTML as fallback
        try {
            console.log('Trying MHTML fallback...');
            const laws = getLawsFromMHTML2004();
            res.json({
                success: true,
                count: laws.length,
                data: laws,
                source: 'mhtml',
                warning: 'Web scraping failed, using MHTML data'
            });
        } catch (mhtmlError) {
            res.status(500).json({
                success: false,
                error: `Web scraping: ${error.message}, MHTML fallback: ${mhtmlError.message}`
            });
        }
    }
});

// Serve the HTML page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'fbih_zakoni_2004_tabela_puna.html'));
});

app.get('/fbih_zakoni_2004_tabela_puna.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'fbih_zakoni_2004_tabela_puna.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log('Available endpoints:');
    console.log(`  GET / - FBIH 2004 Laws Table`);
    console.log(`  GET /api/scrape-fbih-2004 - Scrape FBIH 2004 laws`);
});

module.exports = app;