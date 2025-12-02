const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

// Path to the database
const DB_PATH = path.join(__dirname, 'database', 'regulativa.db');

// Output file
const OUTPUT_FILE = path.join(__dirname, 'duplicate_results.txt');

// Connect to the database
const db = new sqlite3.Database(DB_PATH);

let output = 'Checking for duplicate laws in the database...\n\n';

// First, let's check for duplicates
const findDuplicatesQuery = `
  SELECT 
    title, 
    official_gazette_number, 
    gazette_date,
    COUNT(*) as count,
    MIN(id) as keep_id,
    GROUP_CONCAT(id) as all_ids
  FROM laws 
  GROUP BY title, official_gazette_number, gazette_date 
  HAVING COUNT(*) > 1
`;

db.all(findDuplicatesQuery, (err, duplicateGroups) => {
  if (err) {
    output += 'Error finding duplicates: ' + JSON.stringify(err) + '\n';
    fs.writeFileSync(OUTPUT_FILE, output);
    db.close();
    return;
  }

  if (duplicateGroups.length === 0) {
    output += 'No duplicates found in the laws table.\n\n';
    
    // Count total records
    db.get('SELECT COUNT(*) as total_records FROM laws', (err, result) => {
      if (err) {
        output += 'Error counting records: ' + JSON.stringify(err) + '\n';
      } else {
        output += 'Total records in laws table: ' + result.total_records + '\n';
      }
      
      fs.writeFileSync(OUTPUT_FILE, output);
      db.close();
    });
    return;
  }

  output += `Found ${duplicateGroups.length} groups of duplicates:\n\n`;
  
  let totalDuplicates = 0;
  duplicateGroups.forEach(group => {
    output += `- Title: "${group.title}" (${group.count} duplicates)\n`;
    output += `  Official Gazette Number: ${group.official_gazette_number || 'N/A'}\n`;
    output += `  Gazette Date: ${group.gazette_date || 'N/A'}\n`;
    output += `  IDs: ${group.all_ids}\n`;
    output += `  Keeping ID: ${group.keep_id}\n\n`;
    totalDuplicates += group.count - 1; // Subtract 1 because we're keeping one record
  });

  output += `Total duplicate records to delete: ${totalDuplicates}\n\n`;

  // Count total records before deletion
  db.get('SELECT COUNT(*) as total_records FROM laws', (err, result) => {
    if (err) {
      output += 'Error counting records: ' + JSON.stringify(err) + '\n';
    } else {
      output += 'Total records in laws table before deletion: ' + result.total_records + '\n';
    }
    
    fs.writeFileSync(OUTPUT_FILE, output);
    db.close();
  });
});

console.log('Script is running. Results will be saved to ' + OUTPUT_FILE);