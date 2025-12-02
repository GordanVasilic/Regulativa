import fs from 'fs-extra'
import path from 'path'

const dumpsDir = 'd:/Projekti/Regulativa/apps/api/dumps'

interface RTFFile {
    lawId: number
    filename: string
    hasRtf: boolean
}

async function identifyRTFFiles() {
    const files = await fs.readdir(dumpsDir)
    const debugFiles = files.filter(f => f.startsWith('debug_law_') && f.endsWith('.txt'))

    const rtfFiles: RTFFile[] = []

    for (const file of debugFiles) {
        const lawId = parseInt(file.match(/debug_law_(\d+)\.txt/)?.[1] || '0')
        if (!lawId) continue

        const content = await fs.readFile(path.join(dumpsDir, file), 'utf-8')

        // Check for RTF markers
        const hasRtf = content.includes('\\rtf1') ||
            content.includes('\\ansi') ||
            content.includes('\\fonttbl') ||
            /\\u\d{3,4}\?/.test(content)

        if (hasRtf) {
            rtfFiles.push({ lawId, filename: file, hasRtf: true })
        }
    }

    console.log(`Found ${rtfFiles.length} files with RTF content\n`)

    // Save to CSV
    const csv = 'law_id,filename\n' + rtfFiles.map(f => `${f.lawId},${f.filename}`).join('\n')
    await fs.writeFile('d:/Projekti/Regulativa/apps/api/rtf_files.csv', csv)

    console.log('Saved to rtf_files.csv')
    console.log('\nFirst 10 files:')
    rtfFiles.slice(0, 10).forEach(f => {
        console.log(`  Law ID ${f.lawId}: ${f.filename}`)
    })

    return rtfFiles
}

identifyRTFFiles().catch(console.error)
