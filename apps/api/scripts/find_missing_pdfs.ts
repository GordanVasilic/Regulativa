import fs from 'fs-extra'

async function findMissingPDFs() {
    // Read RTF PDFs list (all 108 problematic PDFs)
    const rtfCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_pdfs.csv', 'utf-8')
    const rtfLines = rtfCsv.split('\n').slice(1) // Skip header

    // Read clean PDFs directory
    const cleanPdfDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Clean'
    const cleanPdfs = await fs.readdir(cleanPdfDir)

    const missing: Array<{ lawId: number; title: string; pdfPath: string }> = []

    for (const line of rtfLines) {
        if (!line.trim()) continue

        const match = line.match(/^(\d+),"([^"]+)","([^"]+)"/)
        if (!match) continue

        const lawId = parseInt(match[1])
        const title = match[2]
        const pdfPath = match[3]

        // Check if clean PDF exists
        const cleanPdf = cleanPdfs.find(f => f.startsWith(`${lawId}_`) && f.endsWith('.pdf'))

        if (!cleanPdf) {
            missing.push({ lawId, title, pdfPath })
        }
    }

    console.log(`Missing PDFs: ${missing.length}\n`)

    // Get URLs for missing PDFs
    const urlsCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_download_urls.csv', 'utf-8')
    const urlsLines = urlsCsv.split('\n').slice(1)

    const missingWithUrls = missing.map(m => {
        const urlLine = urlsLines.find(line => line.startsWith(`${m.lawId},`))
        let url = ''
        if (urlLine) {
            const urlMatch = urlLine.match(/,"([^"]+)"$/)
            if (urlMatch) url = urlMatch[1]
        }
        return { ...m, url }
    })

    // Save to CSV
    const csv = 'law_id,title,url,pdf_path\n' +
        missingWithUrls.map(m => `${m.lawId},"${m.title}","${m.url}","${m.pdfPath}"`).join('\n')

    await fs.writeFile('d:/Projekti/Regulativa/apps/api/missing_pdfs.csv', csv)

    console.log('First 10 missing PDFs:\n')
    missingWithUrls.slice(0, 10).forEach((m, idx) => {
        console.log(`${idx + 1}. Law ID: ${m.lawId}`)
        console.log(`   Title: ${m.title}`)
        console.log(`   URL: ${m.url}`)
        console.log()
    })

    console.log(`\nSaved all ${missing.length} missing PDFs to missing_pdfs.csv`)

    return missingWithUrls
}

findMissingPDFs().catch(console.error)
