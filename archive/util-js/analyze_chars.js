const fs = require('fs');

// Read the text file
const text = fs.readFileSync('D:\\Projekti\\Regulativa\\Dokumenti\\Federacija BiH\\PDF\\output\\Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH-48_99.txt', 'utf8');

// Find lines with problematic patterns
const lines = text.split('\n');

console.log('Analyzing character codes in problematic words:\n');

// Check specific problematic words
const problematicWords = ['Proglašava', 'šće', 'će', 'možće', 'održanoj', 'Službene', 'riječi', 'može'];

lines.forEach((line, index) => {
  problematicWords.forEach(word => {
    if (line.includes(word)) {
      console.log(`Line ${index + 1}: "${line}"`);
      
      // Find the word in the line and analyze its characters
      const wordIndex = line.indexOf(word);
      if (wordIndex !== -1) {
        const extractedWord = line.substring(wordIndex, wordIndex + word.length);
        console.log(`  Word: "${extractedWord}"`);
        
        // Print character codes
        for (let i = 0; i < extractedWord.length; i++) {
          const char = extractedWord[i];
          const code = char.charCodeAt(0);
          const hexCode = code.toString(16).toUpperCase();
          console.log(`    "${char}" = ${code} (0x${hexCode})`);
        }
        console.log('');
      }
    }
  });
});

// Also check for the specific patterns we're trying to replace
console.log('\nChecking for patterns we\'re trying to replace:\n');
const patternsToCheck = ['šće', 'će', 'možće', 'održanoj', 'Službene', 'riječi', 'može'];

patternsToCheck.forEach(pattern => {
  const regex = new RegExp(pattern, 'g');
  const matches = text.match(regex);
  if (matches) {
    console.log(`Pattern "${pattern}" found ${matches.length} times`);
    
    // Analyze the first match
    const firstMatch = matches[0];
    console.log(`  First match: "${firstMatch}"`);
    for (let i = 0; i < firstMatch.length; i++) {
      const char = firstMatch[i];
      const code = char.charCodeAt(0);
      const hexCode = code.toString(16).toUpperCase();
      console.log(`    "${char}" = ${code} (0x${hexCode})`);
    }
    console.log('');
  } else {
    console.log(`Pattern "${pattern}" not found`);
  }
});