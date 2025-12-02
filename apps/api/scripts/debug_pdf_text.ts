import 'dotenv/config'
import fs from 'fs-extra'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

const PDF_PATH = path.resolve('../../Dokumenti/Crna Gora/PDF/Zakon o slobodnom pristupu informacijama-2017.pdf')

async function main() {
    console.log(`Reading PDF: ${PDF_PATH}`)
    const data = new Uint8Array(await fs.readFile(PDF_PATH))
    const loadingTask = pdfjsLib.getDocument(data)
    const pdfDocument = await loadingTask.promise
    console.log(`PDF loaded. Pages: ${pdfDocument.numPages}`)

    const pages = []
    for (let i = 1; i <= pdfDocument.numPages; i++) {
        const page = await pdfDocument.getPage(i)
        const content = await page.getTextContent()
        const text = content.items.map((item: any) => item.str).join(' ')
        pages.push(text)
    }

    const fullText = pages.join('\n\n')
    console.log(`Full text length: ${fullText.length}`)
    console.log(`Snippet: ${fullText.slice(0, 500)}`)
}

main().catch(console.error)
