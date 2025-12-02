const puppeteer = require('puppeteer');

async function testScraper() {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        await page.goto('https://fbihvlada.gov.ba/bs/hronoloski-registar-zakona-objavljenih-u-sluzbenim-novinama-fbih-u-2004-godini', {
            waitUntil: 'networkidle2'
        });

        // Wait for content to load
        await page.waitForTimeout(3000);

        // Get page content and structure
        const pageInfo = await page.evaluate(() => {
            const info = {
                title: document.title,
                bodyText: document.body.textContent.slice(0, 1000),
                tables: document.querySelectorAll('table').length,
                links: document.querySelectorAll('a').length,
                paragraphs: document.querySelectorAll('p').length,
                divs: document.querySelectorAll('div').length,
                allText: document.body.textContent
            };
            
            // Look for specific content
            const tables = Array.from(document.querySelectorAll('table'));
            info.tableContent = tables.map((table, index) => ({
                index,
                rows: table.querySelectorAll('tr').length,
                headers: Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim()),
                firstRow: Array.from(table.querySelectorAll('tr')[0]?.querySelectorAll('td, th')).map(cell => cell.textContent.trim())
            }));
            
            // Look for law-related content
            const lawKeywords = ['zakon', 'službene novine', 'zakoni', 'registar'];
            info.lawElements = [];
            
            lawKeywords.forEach(keyword => {
                const elements = document.querySelectorAll(`*:not(script):not(style)`);
                Array.from(elements).forEach(el => {
                    if (el.textContent.toLowerCase().includes(keyword)) {
                        info.lawElements.push({
                            tag: el.tagName,
                            text: el.textContent.trim().slice(0, 200),
                            className: el.className,
                            id: el.id
                        });
                    }
                });
            });
            
            return info;
        });

        console.log('Page Title:', pageInfo.title);
        console.log('Body Text (first 1000 chars):', pageInfo.bodyText);
        console.log('Tables found:', pageInfo.tables);
        console.log('Links found:', pageInfo.links);
        console.log('Paragraphs found:', pageInfo.paragraphs);
        console.log('Divs found:', pageInfo.divs);
        
        console.log('\nTable Details:');
        pageInfo.tableContent.forEach(table => {
            console.log(`Table ${table.index}: ${table.rows} rows, headers:`, table.headers);
            console.log(`First row:`, table.firstRow);
        });
        
        console.log('\nLaw-related elements:');
        pageInfo.lawElements.slice(0, 10).forEach((el, index) => {
            console.log(`${index + 1}. ${el.tag} (${el.className || 'no class'}): ${el.text}`);
        });

        // Look for specific patterns in the text
        const textContent = pageInfo.allText;
        const lawPatterns = [
            /Zakon[\w\s]+?-\s*(\d+\/\d+)\s*-\s*(\d{1,2}\.\d{1,2}\.\d{4})/g,
            /([\w\s]+Zakon[\w\s]*?)\s*\(Službene novine\s+(\d+\/\d+)\s+(\d{1,2}\.\d{1,2}\.\d{4})\)/g,
            /Službene novine[\w\s]+?(\d+\/\d+)[\w\s]+?(\d{1,2}\.\d{1,2}\.\d{4})/g
        ];
        
        console.log('\nSearching for law patterns in text:');
        lawPatterns.forEach((pattern, index) => {
            const matches = [...textContent.matchAll(pattern)];
            console.log(`Pattern ${index + 1} found ${matches.length} matches:`);
            matches.slice(0, 5).forEach(match => console.log('  -', match[0]));
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

testScraper();