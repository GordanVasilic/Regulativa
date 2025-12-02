import XLSX from 'xlsx';
import path from 'path';

const excelPath = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/zakoni_crna_gora_complete.xlsx';

const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Total rows: ${data.length}\n`);

// Find files that are DOC, DOCX, RTF or ZIP
const problematicFiles = data.filter((row: any) => {
    const url = row.URL || row.url || row.Link || '';
    const urlLower = url.toLowerCase();
    return urlLower.endsWith('.doc') ||
        urlLower.endsWith('.docx') ||
        urlLower.endsWith('.rtf') ||
        urlLower.endsWith('.zip');
});

console.log(`Found ${problematicFiles.length} files that need conversion:\n`);

// Group by type
const byType = {
    doc: [] as any[],
    docx: [] as any[],
    rtf: [] as any[],
    zip: [] as any[]
};

problematicFiles.forEach((row: any) => {
    const url = row.URL || row.url || row.Link || '';
    const urlLower = url.toLowerCase();

    if (urlLower.endsWith('.doc')) byType.doc.push(row);
    else if (urlLower.endsWith('.docx')) byType.docx.push(row);
    else if (urlLower.endsWith('.rtf')) byType.rtf.push(row);
    else if (urlLower.endsWith('.zip')) byType.zip.push(row);
});

console.log(`DOC files: ${byType.doc.length}`);
console.log(`DOCX files: ${byType.docx.length}`);
console.log(`RTF files: ${byType.rtf.length}`);
console.log(`ZIP files: ${byType.zip.length}\n`);

// Show first 3 examples
console.log('=== First 3 examples to test ===\n');

const samples = [
    ...(byType.doc.length > 0 ? [byType.doc[0]] : []),
    ...(byType.docx.length > 0 ? [byType.docx[0]] : []),
    ...(byType.rtf.length > 0 ? [byType.rtf[0]] : [])
].slice(0, 3);

samples.forEach((row: any, idx: number) => {
    console.log(`${idx + 1}. ${row.Naziv || row.Title || 'Unknown'}`);
    console.log(`   URL: ${row.URL || row.url || row.Link || ''}`);
    console.log(`   Year: ${row.Godina || row.Year || ''}`);
    console.log('');
});
