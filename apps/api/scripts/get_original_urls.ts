import fs from 'fs-extra'
import XLSX from 'xlsx'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

interface RTFLaw {
    id: number
    title: string
    pdfPath: string
}

interface ExcelRow {
    Naziv: string
    Godina: string
    Datum: string
    URL: string
}

async function getOriginalURLs() {
    // Read RTF PDFs list
    const rtfCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_pdfs.csv', 'utf-8')
    const rtfLines = rtfCsv.split('\n').slice(1) // Skip header

    const rtfLaws: RTFLaw[] = rtfLines
        .filter(line => line.trim())
        .map(line => {
            const match = line.match(/^(\d+),"([^"]+)","([^"]+)"/)
            if (!match) return null
            return {
                id: parseInt(match[1]),
                title: match[2],
                pdfPath: match[3]
            }
        })
        .filter(Boolean) as RTFLaw[]

    console.log(`Processing ${rtfLaws.length} RTF laws\n`)

    // Read Excel file
    const excelPath = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/zakoni_crna_gora_complete.xlsx'
    const workbook = XLSX.readFile(excelPath)
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const excelData: ExcelRow[] = XLSX.utils.sheet_to_json(sheet)

    console.log(`Excel file has ${excelData.length} entries\n`)

    // Match RTF laws to Excel URLs
    const matched: Array<RTFLaw & { url: string; year: string }> = []
    const unmatched: RTFLaw[] = []

    for (const law of rtfLaws) {
        // Try to find matching entry in Excel
        // Extract year from PDF path (e.g., "...-2021.pdf" -> "2021")
        const yearMatch = law.pdfPath.match(/-(\d{4})\.pdf$/)
        const year = yearMatch ? yearMatch[1] : null

        // Normalize title for matching
        const normalizedTitle = law.title
            .toLowerCase()
            .replace(/č/g, 'c')
            .replace(/ć/g, 'c')
            .replace(/š/g, 's')
            .replace(/ž/g, 'z')
            .replace(/đ/g, 'd')
            .trim()

        const excelEntry = excelData.find(row => {
            const excelTitle = row.Naziv
                .toLowerCase()
                .replace(/č/g, 'c')
                .replace(/ć/g, 'c')
                .replace(/š/g, 's')
                .replace(/ž/g, 'z')
                .replace(/đ/g, 'd')
                .trim()

            const titleMatch = excelTitle.includes(normalizedTitle) || normalizedTitle.includes(excelTitle)
            const yearMatch = !year || row.Godina === year

            return titleMatch && yearMatch
        })

        if (excelEntry) {
            matched.push({
                ...law,
                url: excelEntry.URL,
                year: excelEntry.Godina
            })
        } else {
            unmatched.push(law)
        }
    }

    console.log(`✓ Matched: ${matched.length}`)
    console.log(`✗ Unmatched: ${unmatched.length}\n`)

    // Save matched URLs to CSV
    const csv = 'law_id,title,year,url,pdf_path\n' +
        matched.map(l => `${l.id},"${l.title}","${l.year}","${l.url}","${l.pdfPath}"`).join('\n')

    await fs.writeFile('d:/Projekti/Regulativa/apps/api/rtf_download_urls.csv', csv)
    console.log('✓ Saved matched URLs to rtf_download_urls.csv\n')

    // Save unmatched to separate file
    if (unmatched.length > 0) {
        const unmatchedCsv = 'law_id,title,pdf_path\n' +
            unmatched.map(l => `${l.id},"${l.title}","${l.pdfPath}"`).join('\n')

        await fs.writeFile('d:/Projekti/Regulativa/apps/api/rtf_unmatched.csv', unmatchedCsv)
        console.log('⚠ Saved unmatched laws to rtf_unmatched.csv')
        console.log('\nUnmatched laws (first 10):')
        unmatched.slice(0, 10).forEach(l => {
            console.log(`  ${l.id}: ${l.title}`)
        })
    }

    return { matched, unmatched }
}

getOriginalURLs().catch(console.error)
