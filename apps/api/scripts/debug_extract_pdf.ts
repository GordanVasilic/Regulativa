
import fs from 'fs-extra';
import { getDocument as getPDF } from 'pdfjs-dist/legacy/build/pdf.mjs';

async function debugDump(pdfPath: string) {
    const buf = await fs.readFile(pdfPath);
    const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const loadingTask = getPDF({ data: u8 });
    const pdf = await loadingTask.promise;

    for (let i = 1; i <= pdf.numPages; i++) {
        console.log(`\n\n=== PAGE ${i} RAW ITEMS ===`);
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        for (const item of textContent.items) {
            console.log(`X: ${Math.round(item.transform[4])}, Y: ${Math.round(item.transform[5])} -> "${item.str}"`);
        }
    }
}

const path = "D:\\Projekti\\Regulativa\\Dokumenti\\RepublikaSrpska\\PDF\\Zakon o izmjenama i dopunama Zakona o Pravobranilaštvu Republike Srpske-10025.pdf";
debugDump(path).catch(console.error);
