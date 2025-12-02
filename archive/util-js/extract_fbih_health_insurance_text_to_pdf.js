const fs = require('fs')
const path = require('path')
const PDFDocument = require('pdfkit')
// pdf-parse je ESM paket; u CommonJS okruženju koristimo dynamic import

// Ulazni PDF: FBiH zdravstveno osiguranje (61/22)
const INPUT_FILE = path.join(
  __dirname,
  'Dokumenti',
  'Federacija BiH',
  'PDF',
  'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH-61_22.pdf'
)

// Output folder i fajl (isto ime)
const OUTPUT_DIR = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'PDF', 'Output')
const OUTPUT_FILE = path.join(
  OUTPUT_DIR,
  'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH-61_22.pdf'
)

function normalize(s) {
  return (s || '').toLowerCase()
}

function isUkazLine(line) {
  const n = normalize(line)
  // Pokriva “UKAZ”, “UKAZ O PROGLAŠENJU”, eventualno razmaknute slova “U K A Z”
  const compact = n.replace(/\s+/g, '')
  return (
    /\bukaz\b/.test(n) ||
    compact.includes('ukaz') ||
    n.includes('proglaš') // često se javlja uz ukaz
  )
}

function isLawTitleLine(line) {
  const n = normalize(line)
  const compact = n.replace(/\s+/g, ' ')
  return (
    compact.includes('zakon o') ||
    (n.includes('zakon') && (n.includes('izmjen') || n.includes('dopun') || n.includes('zdravstven')))
  )
}

function isArticleLine(line) {
  const n = normalize(line)
  return /\bčlan\b/.test(n) || /\bclan\b/.test(n)
}

function containsCyrillic(s) {
  return /[\u0400-\u04FF\u0500-\u052F]/.test(s || '')
}

function isChairLine(line) {
  const n = normalize(line)
  // “Predsjedavajući”, “Predsjedatelj”, “Predsjednik”, tolerantno
  return (
    n.includes('predsjedava') ||
    n.includes('predsjedatelj') ||
    n.includes('predsjednik')
  )
}

function normalizeGlyphs(text) {
  if (!text) return ''
  let t = text
    .replace(/\u00A0/g, ' ') // NBSP -> space
    .replace(/\u200B/g, '') // zero-width space
    .replace(/\u00AD/g, '') // soft hyphen
    .replace(/[\u2018\u2019]/g, "'") // curly single quotes -> '
    .replace(/[\u201C\u201D]/g, '"') // curly double quotes -> "
    .replace(/[\u2013\u2014]/g, '-') // en/em dash -> hyphen
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')

  // Normalizacija Unicode (NFC) i kombinacijskih dijakritika
  t = t.normalize('NFC')
    // đ/Đ često se javlja kao d + combining dot above/below
    .replace(/d[\u0307\u0323]/g, 'đ')
    .replace(/D[\u0307\u0323]/g, 'Đ')
    // č/Č (combining caron)
    .replace(/c\u030C/g, 'č')
    .replace(/C\u030C/g, 'Č')
    // š/Š
    .replace(/s\u030C/g, 'š')
    .replace(/S\u030C/g, 'Š')
    // ž/Ž
    .replace(/z\u030C/g, 'ž')
    .replace(/Z\u030C/g, 'Ž')
    // ć/Ć (combining acute)
    .replace(/c\u0301/g, 'ć')
    .replace(/C\u0301/g, 'Ć')

  return t
}

async function extractLawText(buffer) {
  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: buffer })
  const textResult = await parser.getText()
  await parser.destroy()
  // Normalizuj znakove i odbaci ćirilične linije
  let lines = normalizeGlyphs(textResult.text).split(/\r?\n/)
  lines = lines.filter(line => !containsCyrillic(line))

  // Detekcija oba dijela: počinjemo od Ukaza ako postoji, ali kraj tražimo nakon naslova/Člana
  const ukazStart = lines.findIndex(isUkazLine)
  let lawStart = lines.findIndex(isLawTitleLine)
  if (lawStart === -1) {
    lawStart = lines.findIndex(isArticleLine)
  }

  const startIdx = ukazStart !== -1 ? ukazStart : (lawStart !== -1 ? lawStart : 0)

  // Kraj: posljednja pojava Predsjedavajući/Predsjedatelj/Predsjednik poslije početka zakona
  let lastChairAfterLaw = -1
  const scanFrom = lawStart !== -1 ? lawStart : startIdx
  for (let i = scanFrom; i < lines.length; i++) {
    if (isChairLine(lines[i])) {
      lastChairAfterLaw = i
      // ne prekidamo – tražimo posljednju pojavu
    }
  }
  let endIdx = lastChairAfterLaw !== -1 ? lastChairAfterLaw : (lines.length - 1)
  // Uhvati i do dvije naredne linije (ime, "v. r.") ako postoje
  if (endIdx !== -1) {
    let extra = 0
    while (extra < 2 && endIdx + extra + 1 < lines.length) {
      const next = lines[endIdx + extra + 1].trim()
      if (!next) break
      extra++
    }
    endIdx = endIdx + extra
  }

  const slice = lines.slice(startIdx, Math.min(endIdx + 1, lines.length))
  // Bez izmjene teksta: spojimo sa originalnim prelazima linija
  const lawText = slice.join('\n')
  return lawText
}

async function createPdfFromText(text) {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  }

  const tryPaths = [
    OUTPUT_FILE,
    path.join(
      OUTPUT_DIR,
      'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH-61_22 (NEW).pdf'
    )
  ]

  for (const outPath of tryPaths) {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 60, bottom: 60, left: 60, right: 60 },
        info: {
          Title: 'Zakon o izmjeni i dopunama Zakona o zdravstvenom osiguranju FBiH',
          Author: 'Federacija Bosne i Hercegovine'
        }
      })

      const stream = fs.createWriteStream(outPath)
      doc.pipe(stream)

      // Odaberi Windows font sa podrškom za našu latinicu
      const candidateFonts = [
        'C\\\\Windows\\\\Fonts\\\\segoeui.ttf',
        'C\\\\Windows\\\\Fonts\\\\arial.ttf',
        'C\\\\Windows\\\\Fonts\\\\calibri.ttf',
        'C\\\\Windows\\\\Fonts\\\\times.ttf'
      ]
      let usedFont = null
      for (const f of candidateFonts) {
        if (fs.existsSync(f)) { usedFont = f; break }
      }
      if (usedFont) {
        doc.font(usedFont)
      } else {
        // fallback na Helvetica ako font nije dostupan
        doc.font('Helvetica')
      }
      doc.fontSize(12)
      doc.text(text, { align: 'left', lineGap: 4 })
      doc.end()

      await new Promise((resolve, reject) => {
        stream.on('finish', resolve)
        stream.on('error', reject)
      })
      return outPath
    } catch (err) {
      // Ako je primarna putanja zaključana (EBUSY/EPERM), pokušaj fallback naziv
      if (outPath === tryPaths[tryPaths.length - 1]) throw err
    }
  }
}

async function main() {
  if (!fs.existsSync(INPUT_FILE)) {
    console.error('Ulazni PDF nije pronađen:', INPUT_FILE)
    process.exit(1)
  }
  const buffer = fs.readFileSync(INPUT_FILE)
  const lawText = await extractLawText(buffer)
  const savedPath = await createPdfFromText(lawText)
  console.log('Novi PDF sa izdvojenim tekstom snimljen u:', savedPath)
}

main().catch(err => {
  console.error('Greška:', err)
  process.exit(1)
})