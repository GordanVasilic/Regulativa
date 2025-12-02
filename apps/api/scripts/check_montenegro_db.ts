import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';


const dbPath = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db';
const db = new sqlite3.Database(dbPath);

// Get Montenegro laws
db.all(`
  SELECT id, title, path_pdf, gazette_key
  FROM laws
  WHERE jurisdiction = 'Crna Gora'
  LIMIT 10
`, [], (err, laws: any[]) => {
    if (err) {
        console.error('Error querying laws:', err);
        db.close();
        return;
    }

    console.log(`Found ${laws.length} Montenegro laws in database:\n`);

    laws.forEach((law: any, idx: number) => {
        console.log(`${idx + 1}. ${law.title}`);
        console.log(`   ID: ${law.id}`);
        console.log(`   PDF Path: ${law.path_pdf}`);
        console.log(`   Gazette: ${law.gazette_key}`);

        // Check if file exists
        if (law.path_pdf) {
            const fullPath = path.join('d:/Projekti/Regulativa', law.path_pdf);
            const exists = fs.existsSync(fullPath);
            console.log(`   File exists: ${exists}`);

            if (exists) {
                const stats = fs.statSync(fullPath);
                console.log(`   File size: ${stats.size} bytes`);
            }
        }
        console.log('');
    });

    // Check for Porodični zakon specifically
    console.log('\n=== Checking Porodični zakon ===\n');
    db.all(`
    SELECT id, title, path_pdf, gazette_key
    FROM laws
    WHERE jurisdiction = 'Crna Gora' AND title LIKE '%orodic%'
  `, [], (err2, porodicni: any[]) => {
        if (err2) {
            console.error('Error querying Porodični zakon:', err2);
            db.close();
            return;
        }

        console.log(`Found ${porodicni.length} laws matching 'Porodični':\n`);
        porodicni.forEach((law: any) => {
            console.log(`- ${law.title} (ID: ${law.id})`);
            console.log(`  Path: ${law.path_pdf}`);

            if (law.path_pdf) {
                const fullPath = path.join('d:/Projekti/Regulativa', law.path_pdf);
                const exists = fs.existsSync(fullPath);
                console.log(`  Exists: ${exists}`);

                if (exists) {
                    const stats = fs.statSync(fullPath);
                    console.log(`  Size: ${stats.size} bytes`);
                }
            }
            console.log('');
        });

        db.close();
    });
});
