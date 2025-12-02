import fs from 'fs';
import path from 'path';

const dumpPath = 'd:/Projekti/Regulativa/apps/api/dumps/debug_law_8653.txt';
const content = fs.readFileSync(dumpPath, 'utf-8');

console.log('Original length:', content.length);
console.log('Starts with:', content.slice(0, 50));

function stripRtf(rtf: string): string {
    if (!rtf.includes('{\\rtf')) {
        console.log('No RTF signature found');
        return rtf;
    }

    console.log('RTF signature found, stripping...');
    let text = rtf;

    // 1. Handle Unicode characters: \u268? -> Č
    text = text.replace(/\\u(-?\d+)\?/g, (_, code) => String.fromCharCode(Number(code)));

    // 2. Replace common control words with whitespace
    text = text
        .replace(/\\par\b/g, '\n')
        .replace(/\\tab\b/g, '\t')
        .replace(/\\line\b/g, '\n');

    // 3. Remove all other control words
    text = text.replace(/\\[a-z]+\d*/g, '');

    // 4. Remove braces
    text = text.replace(/[{}]/g, '');

    // 5. Clean up multiple spaces/newlines
    text = text.replace(/\n\s*\n/g, '\n\n').trim();

    return text;
}

// Test regex on snippet
const snippet = "ODI\\u268?NI";
console.log("Testing regex on snippet:", snippet);
const replaced = snippet.replace(/\\u(-?\d+)\?/g, (_, code) => {
    console.log("Match found code:", code);
    return String.fromCharCode(Number(code));
});
console.log("Replaced:", replaced);

if (replaced === "ODIČNI") {
    console.log("Regex works on snippet!");
} else {
    console.log("Regex FAILED on snippet!");
}

// Find index of "268"
const idx = content.indexOf('268');
if (idx !== -1) {
    console.log('Found "268" at index:', idx);
    const snippet = content.slice(idx - 5, idx + 10);
    console.log('Snippet:', snippet);
    console.log('Char codes:');
    for (let i = 0; i < snippet.length; i++) {
        console.log(`${snippet[i]}: ${snippet.charCodeAt(i)}`);
    }
} else {
    console.log('"268" not found');
}
