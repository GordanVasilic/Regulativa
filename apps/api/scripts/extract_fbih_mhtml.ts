import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { load } from 'cheerio'

type LawItem = {
  title: string
  issue?: string
  date?: string
  url?: string
  pdf_url?: string
  territory?: string
  published_in?: string
}

function decodeQuotedPrintableUtf8(input: string): string {
  const bytes: number[] = []
  const s = input
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '=') {
      const n1 = s[i + 1]
      const n2 = s[i + 2]
      // Soft line break: '=' followed by CRLF or LF
      if (n1 === '\r' && n2 === '\n') { i += 2; continue }
      if (n1 === '\n') { i += 1; continue }
      // Hex byte
      if (n1 && n2 && /[0-9A-Fa-f]/.test(n1) && /[0-9A-Fa-f]/.test(n2)) {
        bytes.push(parseInt(n1 + n2, 16))
        i += 2
        continue
      }
      // Stray '='; keep it as ASCII byte
      bytes.push('='.charCodeAt(0))
    } else {
      bytes.push(ch.charCodeAt(0))
    }
  }
  return Buffer.from(bytes).toString('utf8')
}

function extractHtmlFromMhtml(mhtml: string): string {
  const boundaryMatch = mhtml.match(/boundary="([^"]+)"/)
  if (!boundaryMatch) throw new Error('MHTML boundary not found')
  const boundary = boundaryMatch[1]
  const parts = mhtml.split('--' + boundary)
  // Prefer the HTML part for the specific Content-Location
  let htmlPart: string | null = null
  for (const part of parts) {
    if (part.includes('Content-Type: text/html') && part.includes('Content-Location: https://pravnapomoc.upfbih.ba/propisi?AP=Z&NZ=2')) {
      htmlPart = part
      break
    }
  }
  // Fallback: first text/html part
  if (!htmlPart) {
    for (const part of parts) {
      if (part.includes('Content-Type: text/html')) {
        htmlPart = part
        break
      }
    }
  }
  if (!htmlPart) throw new Error('HTML part not found in MHTML')
  // Find body after headers (blank line)
  const headerEndIdx = htmlPart.indexOf('\r\n\r\n')
  const body = headerEndIdx !== -1 ? htmlPart.slice(headerEndIdx + 4) : htmlPart
  // Decode quoted-printable if present
  const isQP = /Content-Transfer-Encoding:\s*quoted-printable/i.test(htmlPart)
  return isQP ? decodeQuotedPrintableUtf8(body) : body
}

function extractRows(html: string): LawItem[] {
  const $ = load(html)
  const rows = $('#zakonitbl tbody tr')
  if (rows.length === 0) {
    // Sometimes DataTables may render rows without tbody, try generic
    const fallbackRows = $('table#zakonitbl tr')
    if (fallbackRows.length === 0) return []
    return fallbackRows.toArray().slice(1).map((tr) => parseRow($(tr)))
  }
  return rows.toArray().map((tr) => parseRow($(tr)))
}

function parseRow($tr: any): LawItem {
  const tds = $tr.find('td')
  const tdTitle = tds.eq(0)
  const tdTerritory = tds.eq(1)
  const tdPublished = tds.eq(2)
  const tdDate = tds.eq(3)
  const tdPdf = tds.eq(4)

  const title = tdTitle.text().trim()
  const url = tdTitle.find('a').attr('href') || undefined
  const territory = tdTerritory.text().trim() || undefined
  const published_in = tdPublished.text().trim() || undefined
  const rawDate = tdDate.text().trim()
  const dateMatch = rawDate.match(/\d{1,2}\.\d{1,2}\.\d{4}/)
  const date = dateMatch ? dateMatch[0] : (rawDate || undefined)

  let pdf_url: string | undefined
  const pdfLink = tdPdf.find('a[href]').attr('href')
  if (pdfLink) pdf_url = pdfLink
  else {
    // Fallback: search anywhere in row
    $tr.find('a[href]').each((_: any, a: any) => {
      const href = a?.attribs?.href || ''
      if (/\.pdf($|\?)/i.test(href) || /dokumenti\//i.test(href)) {
        pdf_url = href
      }
    })
  }

  // Extract issue number from "Objavljeno u" cell if present
  let issue: string | undefined
  if (published_in) {
    // Prefer all number/year patterns like 25/17, 1/1996, 12/2003 etc.
    const all = published_in.match(/\b\d{1,3}\/\d{2,4}\b/g)
    if (all && all.length) {
      issue = all.join(', ')
    } else {
      // Fallback to 'broj ...' or 'Br.' patterns
      const im = published_in.match(/(?:broj|br\.)\s*([0-9]+(?:\/[0-9]+)+)/i)
      if (im) issue = im[1]
    }
  }

  return { title, issue, date, url, pdf_url, territory, published_in }
}

async function main() {
  // Emulate __dirname in ESM
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  // From scripts/ -> up to repo root to find zakoniFBIH.mhtml
  const mhtmlPath = path.resolve(__dirname, '../../../zakoniFBIH.mhtml')
  const outJsonPath = path.resolve(__dirname, '../../tmp/fbih_pravnapomoc_from_mhtml.json')
  const outJsonPathApiTmp = path.resolve(__dirname, '../tmp/fbih_pravnapomoc_from_mhtml.json')
  if (!fs.existsSync(mhtmlPath)) {
    throw new Error(`MHTML file not found at ${mhtmlPath}`)
  }
  const mhtml = fs.readFileSync(mhtmlPath, 'utf8')
  const html = extractHtmlFromMhtml(mhtml)
  const items = extractRows(html)
  fs.mkdirSync(path.dirname(outJsonPath), { recursive: true })
  fs.writeFileSync(outJsonPath, JSON.stringify({ count: items.length, items }, null, 2), 'utf8')
  // Also write inside apps/api/tmp for the running static server
  fs.mkdirSync(path.dirname(outJsonPathApiTmp), { recursive: true })
  fs.writeFileSync(outJsonPathApiTmp, JSON.stringify({ count: items.length, items }, null, 2), 'utf8')
  console.log(`Extracted ${items.length} items -> ${outJsonPath}`)
}

main().catch((err) => {
  console.error('Failed to extract from MHTML:', err)
  process.exit(1)
})