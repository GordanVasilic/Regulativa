import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db';
const db = new sqlite3.Database(dbPath);
const dumpsDir = 'd:/Projekti/Regulativa/apps/api/dumps';

console.log('═══════════════════════════════════════════════════════════');
console.log('  IZVJEŠTAJ O EKSTRAKCIJI SEGMENATA - CRNA GORA');
console.log('═══════════════════════════════════════════════════════════\n');

// Get total stats
db.get(`SELECT COUNT(*) as total FROM laws WHERE jurisdiction = 'Crna Gora'`, [], (err, totalRow: any) => {
    if (err) {
        console.error('Error:', err);
        db.close();
        return;
    }

    db.get(`
    SELECT COUNT(DISTINCT s.law_id) as with_segments
    FROM segments s
    INNER JOIN laws l ON s.law_id = l.id
    WHERE l.jurisdiction = 'Crna Gora'
  `, [], (err2, segRow: any) => {
        if (err2) {
            console.error('Error:', err2);
            db.close();
            return;
        }

        console.log('📊 STATISTIKA:\n');
        console.log(`  Ukupno zakona u bazi: ${totalRow.total}`);
        console.log(`  Zakona sa segmentima: ${segRow.with_segments}`);
        console.log(`  Zakona bez segmenata: ${totalRow.total - segRow.with_segments}\n`);

        // Check for RTF issues
        const files = fs.readdirSync(dumpsDir).filter(f => f.startsWith('debug_law_') && f.endsWith('.txt'));
        const rtfFiles: any[] = [];

        files.forEach(file => {
            const filePath = path.join(dumpsDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');

            if (content.includes('\\rtf1') || content.includes('\\ansi')) {
                const lawId = file.match(/debug_law_(\d+)\.txt/)?.[1];
                rtfFiles.push({ file, lawId });
            }
        });

        console.log(`📄 RTF/KORUMPIRANI FAJLOVI:\n`);
        console.log(`  Pronađeno: ${rtfFiles.length} fajlova sa RTF formatiranjem\n`);

        // Check Porodični zakon
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
    `, [], (err4, porodicni: any[]) => {
            if (err4) {
                console.error('Error:', err4);
                db.close();
                return;
            }

            console.log('\n🔍 STATUS: PORODIČNI ZAKON\n');
            porodicni.forEach((law: any) => {
                console.log(`  ${law.title} (ID: ${law.id})`);
                console.log(`    ├─ Broj segmenata: ${law.segment_count}`);
                console.log(`    └─ PDF: ${law.path_pdf ? path.basename(law.path_pdf) : 'N/A'}\n`);
            });

            // Laws with 0 segments
            db.all(`
        SELECT 
          l.id,
          l.title,
          COUNT(s.id) as segment_count
        FROM laws l
        LEFT JOIN segments s ON l.id = s.law_id
        WHERE l.jurisdiction = 'Crna Gora'
        GROUP BY l.id
        HAVING segment_count = 0
        LIMIT 20
      `, [], (err5, zeroSegs: any[]) => {
                if (err5) {
                    console.error('Error:', err5);
                    db.close();
                    return;
                }

                console.log('\n⚠️  ZAKONI BEZ SEGMENATA (prvih 20):\n');
                zeroSegs.forEach((law: any, idx: number) => {
                    console.log(`  ${idx + 1}. ${law.title} (ID: ${law.id})`);
                });

                console.log('\n═══════════════════════════════════════════════════════════');
                console.log('  KRAJ IZVJEŠTAJA');
                console.log('═══════════════════════════════════════════════════════════\n');

                db.close();
            });
        });
    });
});
