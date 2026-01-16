
import { pdfService } from '../src/services/pdf.service.js';
import { parseSegmentsFromPdf } from '../src/services/law-parsing.service.js';
import sqlite3 from 'sqlite3';
import { open } from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'path';

async function verify() {
    const dbPath = path.resolve(process.cwd(), 'data/regulativa.db');
    const db = new sqlite3.Database(dbPath);

    const get = (sql: string, params: any[] = []) => new Promise<any>((res, rej) => {
        db.get(sql, params, (err, row) => err ? rej(err) : res(row));
    });

    try {
        console.log('1. Fetching raw content for Law 10550...');
        const law = await get('SELECT id, title, jurisdiction, gazette_key, text_content FROM laws WHERE id = 10550');
        if (!law) throw new Error('Law 10550 not found');

        console.log('2. Regenerating PDF with new structured logic...');
        // We'll use a temp filename to avoid overwriting production if we are cautious, 
        // but the system overwrites anyway during normal operation.
        const tempPth = await pdfService.generatePdf(law.title + "_TEST", law.text_content, law.jurisdiction, law.gazette_key);
        console.log(`Generated: ${tempPth}`);

        console.log('3. Parsing segments from NEW PDF...');
        const segments = await parseSegmentsFromPdf(tempPth);
        console.log(`Extracted ${segments.length} segments.`);

        const c6 = segments.find(s => s.number === 6);
        if (!c6) {
            console.error('FAILED: Article 6 not found!');
            // List detected articles for debugging
            console.log('Detected articles:', segments.map(s => s.label).join(', '));
            process.exit(1);
        }

        console.log(`Article 6 status: Page=${c6.page_hint}, Label=${c6.label}`);

        // BASED ON USER FEEDBACK: Article 6 should be visibile correctly.
        // In Law 10550, Article 6 starts on Page 3.
        if (c6.page_hint === 3) {
            console.log('SUCCESS: Article 6 is CORRECTLY indexed on Page 3.');
        } else {
            console.error(`FAILED: Article 6 is still on Page ${c6.page_hint}.`);
            // Optional: print text to see if it's scrambled
            console.log('Text preview:', c6.text.slice(0, 200));
            process.exit(1);
        }

        // Cleanup
        await fs.remove(tempPth);
        console.log('Verification completed successfully!');

    } catch (e) {
        console.error('Verification error:', e);
        process.exit(1);
    } finally {
        db.close();
    }
}

verify();
