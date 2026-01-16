
import { parseSegmentsFromPdf } from '../src/services/law-parsing.service.js';
import fs from 'fs-extra';
import path from 'path';

async function verify() {
    const pdfPath = "D:\\Projekti\\Regulativa\\Dokumenti\\RepublikaSrpska\\PDF\\Zakon o izmjenama i dopunama Zakona o Pravobranilaštvu Republike Srpske-10025.pdf";

    console.log(`Verifying PDF: ${pdfPath}`);

    if (!(await fs.pathExists(pdfPath))) {
        console.error('PDF not found!');
        process.exit(1);
    }

    try {
        const segments = await parseSegmentsFromPdf(pdfPath);
        console.log(`Extracted ${segments.length} segments.`);

        const c6 = segments.find(s => s.number === 6);
        if (!c6) {
            console.error('FAILED: Article 6 not found in segments!');
            process.exit(1);
        }

        console.log(`Article 6: Label=${c6.label}, Page=${c6.page_hint}`);

        if (c6.page_hint === 3) {
            console.log('SUCCESS: Article 6 is correctly indexed on Page 3.');
        } else {
            console.error(`FAILED: Article 6 is on Page ${c6.page_hint}, expected Page 3.`);
            process.exit(1);
        }

        // Check coherent text
        if (c6.text.toLowerCase().includes(' clan 6') || c6.text.toLowerCase().includes(' član 6')) {
            console.log('SUCCESS: Text content is coherent.');
        } else {
            console.log('WARNING: Text content might still be weird:', c6.text.slice(0, 100));
        }

    } catch (e) {
        console.error('Error during verification:', e);
        process.exit(1);
    }
}

verify();
