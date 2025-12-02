import XLSX from 'xlsx';

const excelPath = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/zakoni_crna_gora_complete.xlsx';

const workbook = XLSX.readFile(excelPath);
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet);

console.log(`Sheet name: ${sheetName}`);
console.log(`Total rows: ${data.length}\n`);

// Show column names
if (data.length > 0) {
    console.log('Column names:');
    console.log(Object.keys(data[0]));
    console.log('\n');
}

// Show first 5 rows
console.log('First 5 rows:\n');
data.slice(0, 5).forEach((row: any, idx: number) => {
    console.log(`Row ${idx + 1}:`);
    console.log(JSON.stringify(row, null, 2));
    console.log('---\n');
});
