
import * as pdfParseModule from 'pdf-parse';
import defaultPdfParse from 'pdf-parse';

console.log('Module keys:', Object.keys(pdfParseModule));
console.log('Module type:', typeof pdfParseModule);
console.log('Default import:', typeof defaultPdfParse);
console.log('Module default:', typeof pdfParseModule.default);

try {
    // @ts-ignore
    pdfParseModule('test');
} catch (e) {
    console.log('Call module failed:', e.message);
}

try {
    defaultPdfParse('test');
} catch (e) {
    console.log('Call default failed:', e.message);
}
