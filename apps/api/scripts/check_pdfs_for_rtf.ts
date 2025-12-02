import fs from 'fs-extra'
import path from 'path'
import sqlite3 from 'sqlite3'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

sqlite3.verbose()

interface RTFLaw {
    id: number
    title: string
    pdfPath: string
    hasRtf: boolean
}

async function checkPDFsForRTF() {
    const db = new sqlite3.Database('d:/Projekti/Regulativa/apps/api/data/regulativa.db')

    // Get all Montenegro laws
    const laws: any[] = await new Promise((resolve, reject) => {
        db.all(
            `SELECT id, title, path_pdf FROM laws WHERE jurisdiction = 'Crna Gora' ORDER BY id`,
            (err, rows) => {
                if (err) reject(err)
                else resolve(rows)
            }
        )
    })

    console.log(`Checking ${laws.length} Montenegro PDFs for RTF content...\n`)

    const rtfLaws: RTFLaw[] = []
    let checked = 0

    for (const law of laws) {
        checked++
        if (checked % 100 === 0) {
            console.log(`Checked ${checked}/${laws.length}...`)
        }

        if (!law.path_pdf || !fs.existsSync(law.path_pdf)) {
            continue
        }

        try {
            // Read first page of PDF
            const data = new Uint8Array(await fs.readFile(law.path_pdf))
            const pdf = await getDocument({ data, verbosity: 0 }).promise
            const page = await pdf.getPage(1)
            const textContent = await page.getTextContent()
            const text = textContent.items.map((item: any) => item.str).join(' ')

            // Check for RTF markers
            const hasRtf = text.includes('\\rtf1') ||
                text.includes('\\ansi') ||
                text.includes('\\fonttbl') ||
                /\\u\d{3,4}\?/.test(text) ||
                text.includes('\\par') && text.includes('\\pard')

            if (hasRtf) {
                rtfLaws.push({
                    id: law.id,
                    title: law.title,
                    pdfPath: law.path_pdf,
                    hasRtf: true
                })
            }
        } catch (err) {
            console.error(`Error checking law ${law.id}: ${err}`)
        }
    }

    console.log(`\n✓ Found ${rtfLaws.length} PDFs with RTF content\n`)

    // Save to CSV
    const csv = 'law_id,title,pdf_path\n' +
        rtfLaws.map(l => `${l.id},"${l.title}","${l.pdfPath}"`).join('\n')

    await fs.writeFile('d:/Projekti/Regulativa/apps/api/rtf_pdfs.csv', csv)
    console.log('Saved to rtf_pdfs.csv\n')

    console.log('First 10 RTF PDFs:')
    rtfLaws.slice(0, 10).forEach(l => {
        console.log(`  ${l.id}: ${l.title}`)
    })

    db.close()
    return rtfLaws
}

checkPDFsForRTF().catch(console.error)
