const puppeteer = require('puppeteer');

async function scrapeFBIHLaws2004() {
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
        
        console.log('Full text length:', fullText.length);
        
        // Split into lines and process
        const lines = fullText.split('\n').map(line => line.trim()).filter(line => line.length > 0);
        
        console.log('Total lines:', lines.length);
        
        const laws = [];
        let currentGazette = '';
        let currentDate = '';
        
        // Process each line
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Look for gazette entries with different patterns
            const gazettePatterns = [
                /«Službene novine Federacije BiH»\s*,?\s*broj\s+(\d+\/\d+)\s*[\/\-]\s*\((\d{1,2}\.\d{1,2}\.\d{4})\)/,
                /«Službene novine Federacije BiH»,?\s*broj\s+(\d+\/\d+)\s*\((\d{1,2}\.\d{1,2}\.\d{4})\)/,
                /«Službene novine Federacije BiH»\s*,?\s*broj\s+(\d+\/\d+)\s*[\/\-]\s*(\d{1,2}\.\d{1,2}\.\d{4})/
            ];
            
            for (const pattern of gazettePatterns) {
                const gazetteMatch = line.match(pattern);
                if (gazetteMatch) {
                    currentGazette = gazetteMatch[1];
                    currentDate = gazetteMatch[2];
                    console.log(`Found gazette: ${currentGazette}, date: ${currentDate}`);
                    break;
                }
            }
            
            // Look for law entries - extract Bosnian version only
            if (currentGazette && line.includes('ZAKON')) {
                // Skip if this line contains only Croatian version
                if (line.includes('(hrvatski jezik)') && !line.includes('(bosanski jezik)')) {
                    continue;
                }
                
                // Extract Bosnian law name
                let lawName = '';
                
                // Pattern 1: Look for "ZAKON ... (bosanski jezik)"
                const bosnianPattern = /ZAKON[\w\s\-]+?\(bosanski jezik\)/;
                const bosnianMatch = line.match(bosnianPattern);
                if (bosnianMatch) {
                    lawName = bosnianMatch[0].replace('(bosanski jezik)', '').trim();
                } else {
                    // Pattern 2: If no language marker, but contains ZAKON and we have current gazette
                    const generalPattern = /ZAKON[\w\s\-]+/;
                    const generalMatch = line.match(generalPattern);
                    if (generalMatch && !line.includes('(hrvatski jezik)')) {
                        lawName = generalMatch[0].trim();
                    }
                }
                
                // Clean up the law name
                if (lawName) {
                    lawName = lawName.replace(/\s+/g, ' ').trim();
                    
                    // Skip if it's too short or contains Croatian indicators
                    if (lawName.length > 10 && 
                        !lawName.toLowerCase().includes('hrvatski') && 
                        !lawName.includes('HR') && 
                        !lawName.includes('HRV')) {
                        
                        // Check for duplicates
                        const isDuplicate = laws.some(law => 
                            law.name === lawName && law.officialGazette === currentGazette
                        );
                        
                        if (!isDuplicate) {
                            laws.push({
                                name: lawName,
                                year: '2004',
                                officialGazette: currentGazette,
                                date: currentDate,
                                url: 'https://fbihvlada.gov.ba/bs/hronoloski-registar-zakona-objavljenih-u-sluzbenim-novinama-fbih-u-2004-godini'
                            });
                            
                            console.log(`Found law: ${lawName} (${currentGazette})`);
                        }
                    }
                }
            }
        }
        
        console.log(`Total laws found: ${laws.length}`);
        
        // Sort by gazette number (no need for duplicate filter since we already check during insertion)
        const uniqueLaws = laws.sort((a, b) => {
            const aNum = parseInt(a.officialGazette.split('/')[0]);
            const bNum = parseInt(b.officialGazette.split('/')[0]);
            return aNum - bNum;
        });

        console.log(`Unique laws found: ${uniqueLaws.length}`);
        
        // Log all laws for verification
        console.log('\nAll laws found:');
        uniqueLaws.forEach((law, index) => {
            console.log(`${index + 1}. ${law.name} (${law.officialGazette}) - ${law.date}`);
        });

        return uniqueLaws;
        
    } catch (error) {
        console.error('Error scraping data:', error);
        return [];
    } finally {
        await browser.close();
    }
}

// Export for use in other files
module.exports = { scrapeFBIHLaws2004 };

// Run if called directly
if (require.main === module) {
    scrapeFBIHLaws2004().then(data => {
        console.log(JSON.stringify(data, null, 2));
    });
}