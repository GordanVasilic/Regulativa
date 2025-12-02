import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db';
const db = new sqlite3.Database(dbPath);

console.log('=== Analyzing Montenegro Segment Extraction ===\n');

// Check total Montenegro laws
db.get(`
  SELECT COUNT(*) as total
  FROM laws
  WHERE jurisdiction = 'Crna Gora'
`, [], (err, row: any) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    console.log(`Total Montenegro laws in database: ${row.total}\n`);

    // Check how many have segments
    db.all(`
    SELECT 
      l.id,
      l.title,
      l.path_pdf,
      COUNT(s.id) as segment_count
    FROM laws l
    LEFT JOIN segments s ON l.id = s.law_id
    WHERE l.jurisdiction = 'Crna Gora'
    GROUP BY l.id
    ORDER BY segment_count ASC
    LIMIT 20
  `, [], (err2, laws: any[]) => {
        if (err2) {
            console.error('Error:', err2);
            db.close();
            return;
        }

        console.log('Laws with FEWEST segments (potential issues):\n');
        laws.forEach((law: any) => {
            console.log(`${law.segment_count} segments - ${law.title} (ID: ${law.id})`);

            // Check if PDF exists
            if (law.path_pdf) {
                const fullPath = path.join('d:/Projekti/Regulativa', law.path_pdf);
                const exists = fs.existsSync(fullPath);
                if (!exists) {
                    console.log(`  ⚠️  PDF NOT FOUND: ${law.path_pdf}`);
                }
            }
        });

        console.log('\n');

        // Check for Porodični zakon specifically
        db.all(`
      SELECT 
        l.id,
        l.title,
        l.path_pdf,
        COUNT(s.id) as segment_count
      FROM laws l
      LEFT JOIN segments s ON l.id = s.law_id
      WHERE l.jurisdiction = 'Crna Gora' AND l.title LIKE '%orodic%'
      GROUP BY l.id
    `, [], (err3, porodicni: any[]) => {
            if (err3) {
                console.error('Error:', err3);
                db.close();
                return;
            }

            console.log('=== Porodični zakon status ===\n');
            porodicni.forEach((law: any) => {
                console.log(`${law.title} (ID: ${law.id})`);
                console.log(`  Segments: ${law.segment_count}`);
                console.log(`  PDF: ${law.path_pdf}`);

                if (law.path_pdf) {
                    const fullPath = path.join('d:/Projekti/Regulativa', law.path_pdf);
                    const exists = fs.existsSync(fullPath);
                    console.log(`  PDF exists: ${exists}`);

                    if (exists) {
                        const stats = fs.statSync(fullPath);
                        console.log(`  PDF size: ${stats.size} bytes`);
                    }
                }
                console.log('');
            });

            db.close();
        });
    });
});
