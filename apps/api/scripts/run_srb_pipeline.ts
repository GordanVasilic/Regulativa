import { execSync } from 'child_process';

console.log('Starting Serbia segmentation pipeline...');

try {
    console.log('Step 1: Extracting segments...');
    execSync('npx tsx scripts/extract_segments_srb.ts', { stdio: 'inherit' });
    console.log('Extraction complete.');

    console.log('Step 2: Indexing segments to MeiliSearch...');
    execSync('npx tsx scripts/index_segments_meili.ts', { stdio: 'inherit' });
    console.log('Indexing complete.');

    console.log('Pipeline finished successfully.');
} catch (error) {
    console.error('Pipeline failed:', error);
    process.exit(1);
}
