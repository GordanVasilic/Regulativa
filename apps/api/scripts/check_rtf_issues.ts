import fs from 'fs';
import path from 'path';

const dumpsDir = 'd:/Projekti/Regulativa/apps/api/dumps';

console.log('=== Checking for RTF/Corrupted Text in Dump Files ===\n');

// Read all dump files
const files = fs.readdirSync(dumpsDir).filter(f => f.startsWith('debug_law_') && f.endsWith('.txt'));

console.log(`Found ${files.length} dump files\n`);

const problematic: any[] = [];

files.forEach(file => {
    const filePath = path.join(dumpsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    // Check for RTF markers
    const hasRTF = content.includes('\\rtf1') || content.includes('\\ansi') || content.includes('\\fonttbl');
    const hasControlChars = /\\[a-z]+\d*/.test(content.slice(0, 500)); // Check first 500 chars for RTF control words

    if (hasRTF || (hasControlChars && content.slice(0, 10).includes('\\'))) {
        const lawId = file.match(/debug_law_(\d+)\.txt/)?.[1];
        problematic.push({
            file,
            lawId,
            preview: content.slice(0, 300)
        });
    }
});

if (problematic.length > 0) {
    console.log(`⚠️  Found ${problematic.length} files with potential RTF/corrupted text:\n`);

    problematic.forEach(item => {
        console.log(`Law ID: ${item.lawId}`);
        console.log(`File: ${item.file}`);
        console.log(`Preview:`);
        console.log(item.preview);
        console.log('\n---\n');
    });
} else {
    console.log('✅ No RTF/corrupted text found in dump files');
}

console.log(`\nTotal problematic files: ${problematic.length} out of ${files.length}`);
