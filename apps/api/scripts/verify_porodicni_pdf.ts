import fs from 'fs-extra'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

async function verifyPorodicniZakonPDF() {
    const pdfPath = 'D:\\Projekti\\Regulativa\\Dokumenti\\Crna Gora\\PDF\\Porodicni zakon-2021.pdf'

    console.log('Verifying Porodični zakon PDF...\n')

    if (!await fs.pathExists(pdfPath)) {
        console.error('✗ PDF file not found!')
        return
    }

    try {
        // Read PDF
        const data = new Uint8Array(await fs.readFile(pdfPath))
        const pdf = await getDocument({ data, verbosity: 0 }).promise

        console.log(`✓ PDF loaded successfully`)
        console.log(`  Pages: ${pdf.numPages}`)

        // Check first page
        const page1 = await pdf.getPage(1)
        const textContent1 = await page1.getTextContent()
        const text1 = textContent1.items.map((item: any) => item.str).join(' ')

        console.log(`\n✓ First page text (first 200 chars):`)
        console.log(`  ${text1.slice(0, 200)}`)

        // Check for RTF markers
        const hasRtf = text1.includes('\\rtf') || text1.includes('\\par') || /\\u\d{3,4}\?/.test(text1)

        if (hasRtf) {
            console.log(`\n✗ FAILED: PDF still contains RTF code!`)
            return false
        } else {
            console.log(`\n✓ SUCCESS: PDF is clean (no RTF code detected)`)
        }

        // Check a middle page
        const middlePage = Math.floor(pdf.numPages / 2)
        const pageMiddle = await pdf.getPage(middlePage)
        const textContentMiddle = await pageMiddle.getTextContent()
        const textMiddle = textContentMiddle.items.map((item: any) => item.str).join(' ')

        console.log(`\n✓ Middle page (${middlePage}) text (first 200 chars):`)
        console.log(`  ${textMiddle.slice(0, 200)}`)

        const hasRtfMiddle = textMiddle.includes('\\rtf') || textMiddle.includes('\\par') || /\\u\d{3,4}\?/.test(textMiddle)

        if (hasRtfMiddle) {
            console.log(`\n✗ FAILED: Middle page still contains RTF code!`)
            return false
        } else {
            console.log(`\n✓ SUCCESS: Middle page is clean`)
        }

        return true
    } catch (err) {
        console.error(`✗ Error reading PDF: ${err instanceof Error ? err.message : String(err)}`)
        return false
    }
}

verifyPorodicniZakonPDF().catch(console.error)
