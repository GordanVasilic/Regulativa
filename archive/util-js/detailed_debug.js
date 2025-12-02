const puppeteer = require('puppeteer');

async function detailedDebug() {
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

        // Get the full text content
        const fullText = await page.evaluate(() => document.body.textContent);
        
        // Split into lines and process
        const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        console.log('Total lines:', lines.length);
        
        // Look for specific patterns
        console.log('\n=== LINES CONTAINING "Službene novine" ===');
        lines.forEach((line, index) => {
            if (line.includes('Službene novine')) {
                console.log(`Line ${index}: "${line}"`);
            }
        });
        
        console.log('\n=== LINES CONTAINING "ZAKON" ===');
        lines.forEach((line, index) => {
            if (line.includes('ZAKON')) {
                console.log(`Line ${index}: "${line}"`);
            }
        });
        
        console.log('\n=== LINES CONTAINING "bosanski jezik" ===');
        lines.forEach((line, index) => {
            if (line.includes('bosanski jezik')) {
                console.log(`Line ${index}: "${line}"`);
            }
        });
        
        console.log('\n=== LINES CONTAINING "hrvatski jezik" ===');
        lines.forEach((line, index) => {
            if (line.includes('hrvatski jezik')) {
                console.log(`Line ${index}: "${line}"`);
            }
        });
        
        // Look for the specific pattern from web search
        console.log('\n=== LOOKING FOR SPECIFIC PATTERN ===');
        const pattern = /«Službene novine FBiH»\s*,?\s*broj\s+(\d+\/\d+)\s*[\/\-]\s*\((\d{1,2}\.\d{1,2}\.\d{4})\)/g;
        const matches = [...fullText.matchAll(pattern)];
        console.log(`Found ${matches.length} gazette entries:`);
        matches.forEach((match, index) => {
            console.log(`${index + 1}. Gazette: ${match[1]}, Date: ${match[2]}`);
        });
        
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await browser.close();
    }
}

detailedDebug();