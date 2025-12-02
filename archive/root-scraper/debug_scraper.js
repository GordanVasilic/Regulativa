const puppeteer = require('puppeteer');

async function debugScraper() {
    const browser = await puppeteer.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    try {
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        console.log('Navigating to FBIH website...');
        await page.goto('https://fbihvlada.gov.ba/bs/hronoloski-registar-zakona-objavljenih-u-sluzbenim-novinama-fbih-u-2004-godini', {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        await page.waitForTimeout(5000);

        // Get the raw HTML content
        const htmlContent = await page.content();
        console.log('HTML Content (first 3000 chars):');
        console.log(htmlContent.slice(0, 3000));
        
        // Get text content
        const textContent = await page.evaluate(() => document.body.textContent);
        console.log('\n\nText Content (first 3000 chars):');
        console.log(textContent.slice(0, 3000));
        
        // Look for specific patterns that might contain law data
        const patterns = [
            /Službene novine[^\n]*\n[^\n]*\n[^\n]*\n/g,
            /broj\s+\d+\/\d+/g,
            /\d{1,2}\.\d{1,2}\.\d{4}/g,
            /Zakon[^\n]*/g,
            /«[^»]*»/g
        ];
        
        console.log('\n\nPattern matching results:');
        patterns.forEach((pattern, index) => {
            const matches = textContent.match(pattern);
            console.log(`Pattern ${index + 1}: ${matches ? matches.length : 0} matches`);
            if (matches && matches.length > 0) {
                console.log('First 3 matches:');
                matches.slice(0, 3).forEach(match => console.log(`  "${match.trim()}"`));
            }
        });

        // Look for specific structure from the web search reference
        const specificPattern = /«Službene novine Federacije BiH»\s*,?\s*broj\s+(\d+\/\d+)\s*[\/\-]\s*\((\d{1,2}\.\d{1,2}\.\d{4})\)\s*\/([^\/]+?)\//g;
        const specificMatches = [...textContent.matchAll(specificPattern)];
        console.log(`\n\nSpecific pattern found ${specificMatches.length} matches:`);
        specificMatches.forEach((match, index) => {
            console.log(`${index + 1}. Gazette: ${match[1]}, Date: ${match[2]}, Law: ${match[3].trim()}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

debugScraper();