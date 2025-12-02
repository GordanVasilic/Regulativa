const fs = require('fs');
const path = require('path');

function extractLawInfoFromFilename(filename) {
    // Remove file extension
    const nameWithoutExt = path.parse(filename).name;
    
    // Look for patterns like "FBiH-XX_04" where XX is the law number
    const patternMatch = nameWithoutExt.match(/FBiH-(\d+)_04$/);
    
    if (patternMatch) {
        const lawNumber = patternMatch[1];
        
        // Extract law name (remove FBiH-XX_04 suffix)
        let lawName = nameWithoutExt.replace(/FBiH-\d+_04$/, '').trim();
        
        // Clean up the name
        lawName = lawName.replace(/-$/, '').trim();
        
        return {
            name: lawName,
            year: '2004',
            officialGazette: `${lawNumber}/04`,
            date: '', // Date not available from filename
            url: '',
            sourceFile: filename
        };
    }
    
    // Also check for patterns like "-04" or "_04" in the filename
    const simpleMatch = nameWithoutExt.match(/(\d+)[-_]04$/);
    if (simpleMatch) {
        const lawNumber = simpleMatch[1];
        
        // Extract law name (remove the number suffix)
        let lawName = nameWithoutExt.replace(/\d+[-_]04$/, '').trim();
        
        return {
            name: lawName,
            year: '2004',
            officialGazette: `${lawNumber}/04`,
            date: '',
            url: '',
            sourceFile: filename
        };
    }
    
    return null;
}

function getLawsFromExistingFiles() {
    const laws = [];
    
    // Get list of existing law files from 2004
    const docPath = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'Doc');
    const pdfPath = path.join(__dirname, 'Dokumenti', 'Federacija Bi H', 'PDF');
    
    // Process DOC files
    if (fs.existsSync(docPath)) {
        const docFiles = fs.readdirSync(docPath);
        docFiles.forEach(file => {
            if (file.endsWith('.docx')) {
                const lawInfo = extractLawInfoFromFilename(file);
                if (lawInfo) {
                    laws.push(lawInfo);
                }
            }
        });
    }
    
    // Process PDF files
    if (fs.existsSync(pdfPath)) {
        const pdfFiles = fs.readdirSync(pdfPath);
        pdfFiles.forEach(file => {
            if (file.endsWith('.pdf')) {
                const lawInfo = extractLawInfoFromFilename(file);
                if (lawInfo) {
                    laws.push(lawInfo);
                }
            }
        });
    }
    
    return laws;
}

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
        
        return laws;
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
        console.log('MHTML file not found, using existing files...');
        return [];
    }
}

function getAll2004Laws() {
    console.log('Gathering 2004 laws from all available sources...');
    
    // First try MHTML
    let laws = getLawsFromMHTML2004();
    console.log(`Found ${laws.length} laws from MHTML`);
    
    // Then add from existing files
    const fileLaws = getLawsFromExistingFiles();
    console.log(`Found ${fileLaws.length} laws from existing files`);
    
    // Combine and remove duplicates
    const allLaws = [...laws, ...fileLaws];
    
    // Remove duplicates based on law name
    const uniqueLaws = allLaws.filter((law, index, self) => 
        index === self.findIndex(l => l.name === law.name)
    );
    
    console.log(`Total unique laws found: ${uniqueLaws.length}`);
    return uniqueLaws;
}

module.exports = { getAll2004Laws, getLawsFromMHTML2004, getLawsFromExistingFiles };

// Test if run directly
if (require.main === module) {
    const laws = getAll2004Laws();
    console.log(`Found ${laws.length} laws from 2004:`);
    console.log(JSON.stringify(laws.slice(0, 10), null, 2)); // Show first 10
    console.log(`... and ${laws.length - 10} more`);
}