import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

async function buildPreviewFromSingleArticle(sourceUrl: string, title: string, outPdfPath: string, outHtmlPath: string): Promise<boolean> {
  const browser = await puppeteer.launch({ headless: 'new' })
  try {
    const page = await browser.newPage()
    await page.goto(sourceUrl, { waitUntil: 'networkidle0' })
    const html = await page.content()
    const $ = cheerio.load(html)

    // Primarno koristi .row.row-single-article, fallback na .single-article
    let $article = $('.row.row-single-article').first()
    let usedRowSingle = false
    if ($article.length) {
      usedRowSingle = true
    } else {
      $article = $('.single-article').first()
    }
    if ($article.length === 0) {
      // Fallback: probaj centralnu kolonu članka
      $article = $('.col-md-8.col-8-single-article, .col-8-single-article, .content-article').first()
    }
    if ($article.length === 0) return false

    // Ne uklanjaj odmah desnu kolonu; prvo ekstraktuj potpise pa očisti sidebare

    // Odredi glavni sadržaj: preferiraj .content-article ili lijevu kolonu
    let $main = usedRowSingle
      ? $article.find('.col-md-8, .col-8-single-article, .content-article').first()
      : $article.find('.content-article').first()
    if (!$main.length) $main = $article

    // Pripremi regex za detekciju potpisnih fraza (bez uklanjanja originalnih elemenata)
    const endSignatureRegex = /(Predsjedavajući|Predsjednica|Predsjednik|s\.\s*r\.)[\s\S]*?(Doma\s+naroda|Predstavničkog\s+doma|Parlamenta\s+Federacije(?:\s+BiH|\s+Bosne\s+i\s+Hercegovine)?|BiH)/i

    // Primarno: pronađi potpise unutar specifičnih wrapera `.col-md-3.margin-bottom-10` (lijevi i desni), uz srednji spacer `.col-md-6.margin-bottom-10`
    const sigWrappers = $article.find('div.col-md-3.margin-bottom-10').filter((_i, el) => {
      const t = $(el).find('p.text-center').text().replace(/\s+/g, ' ').trim()
      return endSignatureRegex.test(t)
    })
    if (sigWrappers.length >= 1) {
      const count = sigWrappers.length
      const leftWrap = count >= 2 ? sigWrappers.eq(count - 2) : sigWrappers.eq(count - 1)
      const rightWrap = sigWrappers.eq(count - 1)
      const htmlToParas = (el: cheerio.Element) => {
        const innerHtml = $(el).html() || ''
        const normalized = innerHtml
          .replace(/<br\s*\/?>(?=\s*<br\s*\/?>(?!\s*<br))/gi, '\n')
          .replace(/<br\s*\/?>(?!\n)/gi, '\n')
          .replace(/<span[^>]*>/gi, '')
          .replace(/<\/span>/gi, '')
          .replace(/<strong[^>]*>/gi, '')
          .replace(/<\/strong>/gi, '')
          .replace(/<em[^>]*>/gi, '')
          .replace(/<\/em>/gi, '')
        const lines = normalized.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
        return lines.map(s => `<p>${s}</p>`).join('')
      }
      const leftP = leftWrap.find('p.text-center').first()
      const rightP = rightWrap.find('p.text-center').first()
      const leftHtml = htmlToParas(leftP.get(0)!)
      const rightHtml = htmlToParas(rightP.get(0)!)
      // Zadrži originalne wrapere i ne dodaj naš potpisni blok, da provjerimo prikaz u izvornom layoutu
      // Ako bude potrebno, kasnije ćemo uključiti čišćenje i render našeg `_sig-block`.
    } else {
      // Fallback: Nađi zadnja dva potpisa unutar članka i dodaj kao dvije kolone
      const candidates = $article.find('p.text-center, div.text-center').filter((_i, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        return endSignatureRegex.test(t)
      })
      if (candidates.length >= 1) {
        const count = candidates.length
        const leftEl = count >= 2 ? candidates.eq(count - 2) : candidates.eq(count - 1)
        const rightEl = candidates.eq(count - 1)
        const htmlToParas = (el: cheerio.Element) => {
          const innerHtml = $(el).html() || ''
          const normalized = innerHtml
            .replace(/<br\s*\/?>(?=\s*<br\s*\/?>(?!\s*<br))/gi, '\n')
            .replace(/<br\s*\/?>(?!\n)/gi, '\n')
            .replace(/<span[^>]*>/gi, '')
            .replace(/<\/span>/gi, '')
            .replace(/<strong[^>]*>/gi, '')
            .replace(/<\/strong>/gi, '')
            .replace(/<em[^>]*>/gi, '')
            .replace(/<\/em>/gi, '')
          const lines = normalized.split(/\n+/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean)
          return lines.map(s => `<p>${s}</p>`).join('')
        }
        const leftHtml = htmlToParas(leftEl.get(0)!)
        const rightHtml = htmlToParas(rightEl.get(0)!)
        $main.append(`<div class="_sig-block"><div class="_sig-cols"><div class="_sig-col">${leftHtml}</div><div class="_sig-col">${rightHtml}</div></div></div>`)
      }
    }

    // Ne uklanjaj desnu kolonu (Aktuelno) i sidebare u ovom koraku — želimo provjeriti da li potpisi postoje u originalnom rasporedu

    const headLinks = ''
    const headStyles = ''
    const baseTag = `<base href="${sourceUrl}">`
    const safeTitle = sanitizeFileName(title)
    const containerHtml = $.html($main)

    const finalHtml = `<!doctype html>
<html lang="bs">
  <head>
    <meta charset="utf-8">
    ${baseTag}
    ${headLinks}
    ${headStyles}
    <style>
      @page { size: A4; margin: 16mm; }
      html, body { height: auto; background: #fff !important; }
      body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.6; color: #000; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      * { box-sizing: border-box; }
      .container, .content, .page-content, .region-content, .view-content, .layout, .row { max-width: none !important; display: block !important; }
      .col, .col-lg-9, .col-md-8, [class^="col-"], [class*=" col-"] { width: 100% !important; max-width: 100% !important; flex: none !important; float: none !important; padding-left: 0 !important; padding-right: 0 !important; }
      [style*="width:"] { width: auto !important; }
      [style*="height:"] { height: auto !important; }
      *, *::before, *::after { overflow: visible !important; max-height: none !important; }
      ._sig-block, ._sig-block * { position: static !important; display: block !important; float: none !important; visibility: visible !important; opacity: 1 !important; color: #000 !important; background: #fff !important; }
      ._sig-block { page-break-before: avoid; margin-top: 16px; }
      ._sig-cols { display: flex; gap: 32px; justify-content: space-between; }
      ._sig-col { width: 48%; text-align: center; }
      ._sig-col p { margin: 0 0 4px; }

      /* Text alignment helpers restored */
      .text-center { text-align: center !important; }
      .text-left { text-align: left !important; }
      .text-right { text-align: right !important; }
      .text-justify { text-align: justify !important; }

      /* Justify article paragraphs for better readability */
      .content-article p,
      .single-article p,
      .row.row-single-article p { text-align: justify; hyphens: auto; -webkit-hyphens: auto; }

      /* Headings: keep left aligned and clear spacing */
      .content-article h1, .content-article h2, .content-article h3,
      .single-article h1, .single-article h2, .single-article h3,
      .row.row-single-article h1, .row.row-single-article h2, .row.row-single-article h3,
      h1, h2, h3, h4, h5, h6 { text-align: left; font-weight: 700; margin: 0 0 12px; }

      /* Paragraph spacing and typography */
      p { margin: 0 0 10px; orphans: 2; widows: 2; }
      a { color: inherit; text-decoration: none; }
      img, svg { max-width: 100%; height: auto; }

      /* Lists: readable indentation and spacing */
      .content-article ul, .content-article ol,
      .single-article ul, .single-article ol,
      .row.row-single-article ul, .row.row-single-article ol { text-align: left; margin: 0 0 10px 24px; padding-left: 24px; }
      li { margin-bottom: 6px; }

      /* Tables: full width and printable borders */
      .content-article table, .single-article table, .row.row-single-article table { width: 100%; border-collapse: collapse; page-break-inside: avoid; }
      .content-article th, .single-article th, .row.row-single-article th,
      .content-article td, .single-article td, .row.row-single-article td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }

      /* Restore bootstrap-like columns for signature blocks */
      .row.row-single-article::after,
      .single-article::after,
      .content-article::after { content: ""; display: table; clear: both; }

      .row.row-single-article .col-md-3.margin-bottom-10,
      .single-article .col-md-3.margin-bottom-10,
      .content-article .col-md-3.margin-bottom-10 { width: 25% !important; float: left !important; display: block !important; padding-left: 15px !important; padding-right: 15px !important; }

      .row.row-single-article .col-md-6.margin-bottom-10,
      .single-article .col-md-6.margin-bottom-10,
      .content-article .col-md-6.margin-bottom-10 { width: 50% !important; float: left !important; display: block !important; padding-left: 15px !important; padding-right: 15px !important; }

      /* Ensure signature text stays centered inside columns */
      .row.row-single-article .col-md-3.margin-bottom-10 p.text-center,
      .single-article .col-md-3.margin-bottom-10 p.text-center,
      .row.row-single-article .col-md-6.margin-bottom-10 p.text-center,
      .single-article .col-md-6.margin-bottom-10 p.text-center,
      .content-article .col-md-3.margin-bottom-10 p.text-center,
      .content-article .col-md-6.margin-bottom-10 p.text-center { text-align: center !important; }
    </style>
    <title>${safeTitle} (single-article)</title>
  </head>
  <body>
    ${containerHtml}
  </body>
</html>`

    await fs.ensureDir(path.dirname(outHtmlPath))
    await fs.writeFile(outHtmlPath, finalHtml, 'utf-8')

    const pdfPage = await browser.newPage()
    await pdfPage.setViewport({ width: 1200, height: 800 })
    await pdfPage.setContent(finalHtml, { waitUntil: 'networkidle0' })
    await pdfPage.pdf({ path: outPdfPath, format: 'A4', printBackground: true })
    return true
  } finally {
    await browser.close()
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Federacija BiH', 'PDF')
  await fs.ensureDir(PDF_DIR)

  // Simple CLI args parsing: --url=..., --title=...
  const argv = process.argv.slice(2)
  const getArg = (name: string) => {
    const pref = `--${name}=`
    const hit = argv.find(a => a.startsWith(pref))
    return hit ? hit.slice(pref.length) : undefined
  }

  const sourceUrl = getArg('url') || process.env.FBIH_URL || 'https://fbihvlada.gov.ba/bs/1-zakon-o-advokaturi-federacije-bosne-i-hercegovine'
  const title = getArg('title') || 'Zakon o advokaturi Federacije Bosne i Hercegovine'
  const outName = sanitizeFileName(title) + '-single_article.pdf'
  const outPdfPath = path.join(PDF_DIR, outName)

  const tmpDir = path.join(process.cwd(), 'tmp')
  await fs.ensureDir(tmpDir)
  const outHtmlPath = path.join(tmpDir, 'fbih_single_article_preview.html')

  const ok = await buildPreviewFromSingleArticle(sourceUrl, title, outPdfPath, outHtmlPath)
  if (!ok) {
    console.error('Failed to build preview from .row.row-single-article')
    process.exit(2)
  }
  console.log(JSON.stringify({ ok: true, path_pdf: outPdfPath, path_preview: outHtmlPath }, null, 2))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})