const fs = require('fs');

const text = fs.readFileSync('D:\\Projekti\\Regulativa\\Dokumenti\\Federacija BiH\\PDF\\output\\Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH-48_99.txt', 'utf8');

// Find lines with the problematic characters
const lines = text.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('odr') || lines[i].includes('Lu') || lines[i].includes('mo')) {
    console.log(`Line ${i+1}: ${lines[i]}`);
    
    // Show character codes for the problematic words
    const words = lines[i].split(' ');
    for (const word of words) {
      if (word.includes('odr') || word.includes('Lu') || word.includes('mo')) {
        console.log(`  Word: ${word}`);
        for (let j = 0; j < word.length; j++) {
          const char = word[j];
          const code = char.charCodeAt(0);
          console.log(`    ${char} -> ${code} (0x${code.toString(16)})`);
        }
      }
    }
  }
}