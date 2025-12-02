const fs = require('fs');
const path = require('path');

function parseMHTMLForLaws2004(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const laws = [];
        
        // Decode quoted-printable content
        let decodedContent = content;
        
        // Handle quoted-printable encoding
        decodedContent = decodedContent.replace(/=([A-F0-9]{2})/g, (match, hex) => {
            return String.fromCharCode(parseInt(hex, 16));
        });
        
        // Handle soft line breaks (= at end of line)
        decodedContent = decodedContent.replace(/=\n/g, '');
        
        // Look for law entries in the MHTML content
        // Pattern matches: "ZAKON o... (bosanski jezik)</a>" or "ZAKON o... (hrvatski jezik)</a>"
        const lawPattern = /ZAKON[\w\sšđžčćŠĐŽČĆ\s]+?\([bosanskihrvatski\s]+jezik\)<\/a>/gi;
        
        let match;
        while ((match = lawPattern.exec(decodedContent)) !== null) {
            const fullMatch = match[0];
            
            // Extract law name (everything before the language indicator)
            const nameMatch = fullMatch.match(/(ZAKON[\w\sšđžčćŠĐŽČĆ\s]+?)\(/);
            if (nameMatch) {
                let lawName = nameMatch[1].trim();
                
                // Skip Croatian language entries
                if (fullMatch.includes('hrvatski jezik')) {
                    continue;
                }
                
                // Only process Bosnian language entries
                if (fullMatch.includes('bosanski jezik')) {
                    // Try to find gazette and date information nearby
                    // Look for patterns like "6/04" or "30.01.2004" around the law entry
                    const nearbyText = decodedContent.substring(Math.max(0, match.index - 200), match.index + 200);
                    
                    const gazetteMatch = nearbyText.match(/(\d+\/\d+)/);
                    const dateMatch = nearbyText.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
                    
                    const officialGazette = gazetteMatch ? gazetteMatch[1] : '';
                    const date = dateMatch ? dateMatch[1] : '';
                    
                    if (lawName && lawName.length > 10) {
                        laws.push({
                            name: lawName,
                            year: '2004',
                            officialGazette: officialGazette,
                            date: date,
                            url: ''
                        });
                    }
                }
            }
        }
        
        // Also try to find laws from the grep results we saw
        const specificLawPattern = /ski\/zakoni\/2004\/zakoni\/\d+(bos|hrv)\.htm\">(ZAKON[\w\sšđžčćŠĐŽČĆ\s]+?)<\/a>/gi;
        while ((match = specificLawPattern.exec(decodedContent)) !== null) {
            const lawName = match[2].trim();
            const fileType = match[1]; // 'bos' or 'hrv'
            
            // Skip Croatian versions
            if (fileType === 'hrv') continue;
            
            // Only process Bosnian versions
            if (fileType === 'bos' && lawName && lawName.length > 10) {
                // Try to find gazette and date information
                const nearbyText = decodedContent.substring(Math.max(0, match.index - 300), match.index + 300);
                
                const gazetteMatch = nearbyText.match(/(\d+\/\d+)/);
                const dateMatch = nearbyText.match(/(\d{1,2}\.\d{1,2}\.\d{4})/);
                
                const officialGazette = gazetteMatch ? gazetteMatch[1] : '';
                const date = dateMatch ? dateMatch[1] : '';
                
                laws.push({
                    name: lawName,
                    year: '2004',
                    officialGazette: officialGazette,
                    date: date,
                    url: ''
                });
            }
        }
        
        // Remove duplicates based on law name
        const uniqueLaws = laws.filter((law, index, self) => 
            index === self.findIndex(l => l.name === law.name)
        );
        
        return uniqueLaws;
    } catch (error) {
        console.error('Error parsing MHTML file:', error);
        return [];
    }
}

function getLawsFromMHTML2004() {
    const mhtmlPath = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'mhtml', 'fbih_zakoni_2004.mhtml');
    
    if (fs.existsSync(mhtmlPath)) {
        console.log('Parsing existing MHTML file for 2004 laws...');
        return parseMHTMLForLaws2004(mhtmlPath);
    } else {
        console.log('MHTML file not found, returning empty array');
        return [];
    }
}

module.exports = { getLawsFromMHTML2004, parseMHTMLForLaws2004 };

// Test if run directly
if (require.main === module) {
    const laws = getLawsFromMHTML2004();
    console.log(`Found ${laws.length} laws from MHTML file:`);
    console.log(JSON.stringify(laws, null, 2));
}