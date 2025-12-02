const fs = require('fs')
const path = require('path')
const { PDFDocument } = require('pdf-lib')

// Ulazni PDF: FBiH zdravstveno osiguranje (61/22)
const INPUT_FILE = path.join(
  __dirname,
  'Dokumenti',
  'Federacija BiH',
  'PDF',
  'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH-61_22.pdf'
)

// Output folder: snimiti pod istim imenom
const OUTPUT_DIR = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'PDF', 'Output')
const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH-61_22.pdf'
)

async function cleanPdf() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('Ulazni PDF nije pronađen:', INPUT_FILE)
    process.exit(1)
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const srcBytes = fs.readFileSync(INPUT_FILE)
  const srcDoc = await PDFDocument.load(srcBytes)
  const newDoc = await PDFDocument.create()

  const totalPages = srcDoc.getPageCount()
  const indices = Array.from({ length: totalPages }, (_, i) => i)
  const copiedPages = await newDoc.copyPages(srcDoc, indices)

  copiedPages.forEach((page) => {
    const width = page.getWidth()
    const height = page.getHeight()
    // Uniformno ukloni tipična zaglavlja/podnožja Službenih novina
    const topCrop = Math.round(height * 0.06) // ~6% vrha
    const bottomCrop = Math.round(height * 0.06) // ~6% dna
    const x = 0
    const y = bottomCrop
    const w = width
    const h = height - topCrop - bottomCrop
    page.setCropBox(x, y, w, h)

    newDoc.addPage(page)
  })

  const outBytes = await newDoc.save()
  fs.writeFileSync(OUTPUT_FILE, outBytes)
  console.log('Očišćeni PDF snimljen u:', OUTPUT_FILE)
}

cleanPdf().catch(err => {
  console.error('Greška pri čišćenju PDF-a:', err)
  process.exit(1)
})