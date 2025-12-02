const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Path to the database
const DB_PATH = path.join(__dirname, 'database', 'regulativa.db');

// Connect to the database
const db = new sqlite3.Database(DB_PATH);

// Search for the specific document
const searchTitle = '%Zakon o izmjenama Zakona o prenosu prava svojine na kapitalu Republike Srpske%';
const searchGazetteNumber = '70/12';

console.log('Searching for document with title containing "Zakon o izmjenama Zakona o prenosu prava svojine na kapitalu Republike Srpske" and gazette number "70/12"...');

// Query to find the document
const query = `
  SELECT id, title, official_gazette_number, gazette_date, category, jurisdiction, 
         LENGTH(content) as content_length, SUBSTR(content, 1, 200) as content_preview
  FROM laws 
  WHERE title LIKE ? AND official_gazette_number = ?
`;

db.get(query, [searchTitle, searchGazetteNumber], (err, row) => {
  if (err) {
    console.error('Error querying database:', err.message);
    return;
  }
  
  if (!row) {
    console.log('Document not found with the specified criteria.');
    
    // Try a broader search
    console.log('\nTrying a broader search with just the gazette number...');
    db.get('SELECT id, title, official_gazette_number, gazette_date, category, jurisdiction, LENGTH(content) as content_length FROM laws WHERE official_gazette_number = ?', [searchGazetteNumber], (err, row) => {
      if (err) {
        console.error('Error querying database:', err.message);
        return;
      }
      
      if (!row) {
        console.log('No documents found with gazette number "70/12"');
      } else {
        console.log('\nFound document with gazette number "70/12":');
        console.log('ID:', row.id);
        console.log('Title:', row.title);
        console.log('Official Gazette Number:', row.official_gazette_number);
        console.log('Gazette Date:', row.gazette_date);
        console.log('Category:', row.category);
        console.log('Jurisdiction:', row.jurisdiction);
        console.log('Content Length:', row.content_length);
        
        // Get a preview of the content to check for encoding issues
        db.get('SELECT SUBSTR(content, 1, 500) as content_preview FROM laws WHERE id = ?', [row.id], (err, previewRow) => {
          if (err) {
            console.error('Error getting content preview:', err.message);
            return;
          }
          
          console.log('\nContent Preview (first 500 characters):');
          console.log(previewRow.content_preview);
          
          // Check for potential encoding issues
          const content = previewRow.content_preview;
          const hasSpecialChars = /[\u0000-\u001F\u007F-\u009F]/.test(content);
          const hasReplacementChars = content.includes('�');
          
          console.log('\nEncoding Analysis:');
          console.log('Contains special control characters:', hasSpecialChars);
          console.log('Contains replacement characters (�):', hasReplacementChars);
          
          if (hasReplacementChars) {
            console.log('\nISSUE DETECTED: The document contains replacement characters (�), which indicates encoding problems.');
            console.log('This typically happens when text with one encoding is interpreted as another encoding.');
            console.log('Common causes:');
            console.log('1. UTF-8 text interpreted as a different encoding (like Windows-1250)');
            console.log('2. Text copied from a source with different encoding');
            console.log('3. Database connection not configured for UTF-8');
          }
          
          db.close();
        });
      }
    });
  } else {
    console.log('\nFound document:');
    console.log('ID:', row.id);
    console.log('Title:', row.title);
    console.log('Official Gazette Number:', row.official_gazette_number);
    console.log('Gazette Date:', row.gazette_date);
    console.log('Category:', row.category);
    console.log('Jurisdiction:', row.jurisdiction);
    console.log('Content Length:', row.content_length);
    console.log('\nContent Preview (first 200 characters):');
    console.log(row.content_preview);
    
    // Check for potential encoding issues
    const content = row.content_preview;
    const hasSpecialChars = /[\u0000-\u001F\u007F-\u009F]/.test(content);
    const hasReplacementChars = content.includes('�');
    
    console.log('\nEncoding Analysis:');
    console.log('Contains special control characters:', hasSpecialChars);
    console.log('Contains replacement characters (�):', hasReplacementChars);
    
    if (hasReplacementChars) {
      console.log('\nISSUE DETECTED: The document contains replacement characters (�), which indicates encoding problems.');
      console.log('This typically happens when text with one encoding is interpreted as another encoding.');
      console.log('Common causes:');
      console.log('1. UTF-8 text interpreted as a different encoding (like Windows-1250)');
      console.log('2. Text copied from a source with different encoding');
      console.log('3. Database connection not configured for UTF-8');
    }
    
    db.close();
  }
});