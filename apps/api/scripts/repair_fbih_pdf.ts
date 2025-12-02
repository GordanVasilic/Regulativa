import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'

sqlite3.verbose()

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

async function generateFormattedPdf(sourceUrl: string, title: string, outPath: string): Promise<boolean> {
  const browser = await puppeteer.launch({ headless: 'new' })
  try {
    const page = await browser.newPage()
    await page.goto(sourceUrl, { waitUntil: 'networkidle0' })
    const html = await page.content()
    const $ = cheerio.load(html)

    // 1) Pronađi heading koji odgovara naslovu zakona (ili njegovoj jezgri)
    const core = (title || '').toLowerCase().replace(/\s+/g, ' ').trim()
    const coreShort = core.includes('zakon o ') ? core.replace(/.*,?\s(zakon o [^]+)$/,'$1') : core
    let $heading = $('h1,h2,h3').filter((_i, el) => {
      const t = $(el).text().toLowerCase().replace(/\s+/g, ' ').trim()
      return t.includes(coreShort) || t.includes('zakon o advokaturi')
    })

    // Ako heading nije nađen, uzmi prvi h1 na stranici
    if ($heading.length === 0) {
      $heading = $('h1').first()
    }

    // 2) Nađi kontejner koji drži kompletan članak
    // Primarno koristi `.single-article` (obuhvata cijeli članak sa lijevom i desnom kolonom),
    // zatim fallback na centralni content region i specifične kontejnere članka
    let usedSingleArticle = false
    let $container = $('.single-article').first()
    if ($container.length) {
      usedSingleArticle = true
    } else {
      $container = $('main, .region-content, .page-content, .content, .col-8-single-article, .col-md-8.col-8-single-article').first()
    }
    if ($container.length === 0) {
      // kao alternativa: roditeljski .row pa lijeva kolona
      const $row = $heading.closest('.row')
      $container = $row && $row.length ? $row.find('.col-lg-9, .col-md-8, .col-8-single-article, .col-md-8.col-8-single-article').first() : $heading.closest('.col-lg-9, .col-md-8, .col-8-single-article, .col-md-8.col-8-single-article')
    }
    if ($container.length === 0) {
      $container = $heading.closest('.field--name-body, .node__content, article, main, .region-content, .page-content, .content')
    }
    if ($container.length === 0) {
      // fallback: ako ništa nije pogodilo, uzmi roditelja headinga
      $container = $heading.parent()
    }
    // Ako i dalje prazno, zadnji fallback: main ili region-content
    if ($container.length === 0) {
      $container = $('main, .region-content').first()
    }
    if ($container.length === 0) return false

    // 3) Ukloni sidebar/sekundarne blokove iz kontejnera
    // Ako je korišten `.single-article`, desna kolona sa Aktuelno je obično `.col-md-4`
    $container.find('aside, .region-sidebar, .sidebar, .col-lg-3, .col-md-3, .col-md-4, .col-lg-4, .col-4, .col-4-single-article, [role="complementary"], .block-aktuelno').remove()
    // U slučaju da sidebar postoji kao sibling, ukloni ga iz body-a
    $('aside, .region-sidebar, .sidebar, .col-lg-3, .col-md-3, .col-md-4, .col-lg-4, .col-4, .col-4-single-article, [role="complementary"], .block-aktuelno').remove()

    // Preferiraj eksplicitno centralni kontejner članka ako postoji, ali samo ako nismo uzeli `.single-article`
    const $articleZone = $('.col-md-8.col-8-single-article, .col-8-single-article').first()
    if (!usedSingleArticle && $articleZone.length) {
      $container = $articleZone
    }

    // 3.1) Izlazni sadržaj: ako je korišten `.single-article`, uzmi kompletan članak
    // inače preferiraj `.content-article` da izbjegnemo dupliranje
    let $output = usedSingleArticle ? $container : $container.find('.content-article').first()
    if (!$output.length) $output = $container

    // 4) Provjera: kontejner mora imati više paragrafa ili indikatore zakona (UKAZ, Član)
    const paraCount = $container.find('p').length
    const textAll = $container.text().replace(/\s+/g, ' ').trim()
    const hasLawHints = /(UKAZ|Član|CLAN|O PROGLAŠENJU)/i.test(textAll)
    if (paraCount < 3 && !hasLawHints) {
      // Probaj još jedan viši roditelj, ali bez sidebara
      const upper = $container.parent()
      if (upper && upper.length) {
        $container = upper
        $container.find('aside, .region-sidebar, .sidebar, .col-lg-3, .col-md-3, [role="complementary"], .block-aktuelno').remove()
      }
    }

    // 4.1) Iz sadržaja ukloni postojeće potpisne tekst-center blokove da izbjegnemo duplikate
    $output.find('p.text-center, div.text-center').filter((_i, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim()
      return /(Predsjedavajući|Predsjednica|Predsjednik|s\.\s*r\.)/i.test(t)
    }).remove()

    // 5) Pronađi završni potpisni blok (Predsjedavajući...) kroz cijelu stranicu i dodaj na kraj izlaznog sadržaja u očišćenoj formi
    const endSignatureRegex = /(Predsjedavajući|Predsjednica|Predsjednik|s\.\s*r\.)[\s\S]*?(Doma\s+naroda|Predstavničkog\s+doma|Parlamenta\s+Federacije(?:\s+BiH|\s+Bosne\s+i\s+Hercegovine)?|BiH)/i
    // Preferiraj .row koji sadrži najmanje dvije kolone i potpisne fraze
    let $sigRow = $('.row').filter((_i, el) => {
      const $el = $(el)
      const t = $el.text().replace(/\s+/g, ' ').trim()
      const colCount = $el.find('.col, [class^="col-"], [class*=" col-"]').length
      return endSignatureRegex.test(t) && colCount >= 2
    }).last()

    // Fallback: uzmi najzadnji element koji sadrži potpisne fraze
    let $sigEl: cheerio.Cheerio | null = null
    if ($sigRow.length === 0) {
      $sigEl = $('p, div, section, table, article, span, li, h4, h5').filter((_i, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        return endSignatureRegex.test(t)
      }).last()
      if ($sigEl.length) {
        const $common = $sigEl.closest('.row, section, article, div').first()
        const hasMultiple = $common.length ? $common.find('*').filter((_j, node) => {
          const tt = $(node).text().replace(/\s+/g, ' ').trim()
          return endSignatureRegex.test(tt)
        }).length >= 2 : false
        if (hasMultiple) {
          $sigRow = $common
        }
      }
    }

    // Ako imamo row, očisti ga i izrenderuj sigurne kolone; inače ako imamo pojedinačni element, dodaj ga
    if ($sigRow && $sigRow.length) {
      const $cols = $sigRow.find('.col, [class^="col-"], [class*=" col-"], .views-column')
      const toParagraphs = (txt: string) => txt.split(/\r?\n+/).map(s => s.trim()).filter(Boolean).map(s => `<p>${s}</p>`).join('')
      if ($cols.length >= 2) {
        const leftText = ($cols.eq(0).text() || '').replace(/\s+$/,'').trim()
        const rightText = ($cols.eq(1).text() || '').replace(/\s+$/,'').trim()
        const leftHtml = toParagraphs(leftText)
        const rightHtml = toParagraphs(rightText)
        $output.append(`<div class="_sig-block"><div class="_sig-cols"><div class="_sig-col">${leftHtml}</div><div class="_sig-col">${rightHtml}</div></div></div>`)
      } else {
        const soloText = ($sigRow.text() || '').trim()
        const soloHtml = toParagraphs(soloText)
        $output.append(`<div class="_sig-block">${soloHtml}</div>`)
      }
    } else if ($sigEl && ($sigEl as cheerio.Cheerio).length) {
      const soloText = (($sigEl as cheerio.Cheerio).text() || '').trim()
      const toParagraphs = (txt: string) => txt.split(/\r?\n+/).map(s => s.trim()).filter(Boolean).map(s => `<p>${s}</p>`).join('')
      const soloHtml = toParagraphs(soloText)
      $output.append(`<div class="_sig-block">${soloHtml}</div>`)
    } else {
      // Dodatno: ciljano traži p.text-center u članku koji sadrže potpisne fraze; uzmi zadnja dva i renderuj ih u dvije kolone
      const candidates = $container.find('p.text-center, div.text-center, p, div').filter((_i, el) => {
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
            .replace(/<br\s*\/?>/gi, '\n')
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
        $output.append(`<div class="_sig-block"><div class="_sig-cols"><div class="_sig-col">${leftHtml}</div><div class="_sig-col">${rightHtml}</div></div></div>`)
      }
    }

    // Ne uključuj originalne stilove (često sakrivaju dijelove pri printu); koristimo minimalni CSS
    const headLinks = ''
    const headStyles = ''
    const baseTag = `<base href="${sourceUrl}">`
    const safeTitle = sanitizeFileName(title)
    const containerHtml = $.html($output)

    const finalHtml = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    ${baseTag}
    ${headLinks}
    ${headStyles}
    <style>
      /* Print adjustments to avoid clipping and ensure readable margins */
      @page { size: A4; margin: 16mm; }
      html, body { height: auto; background: #fff !important; }
      body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #000; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      /* Osiguraj punu širinu kontejnera u printu */
      .container, .content, .page-content, .region-content, .view-content, .layout, .row {
        max-width: none !important; display: block !important;
      }
      /* Kolone neka budu 100% širine da ne ostaje prazna desna strana */
      .col, .col-lg-9, .col-md-8, [class^="col-"], [class*=" col-"] {
        width: 100% !important; max-width: 100% !important; flex: none !important; float: none !important;
        padding-left: 0 !important; padding-right: 0 !important;
      }
      /* Ukloni potencijalne fiksne širine i visine koje prave praznine */
      [style*="width:"] { width: auto !important; }
      [style*="height:"] { height: auto !important; }
      /* Izbjegni clipping */
      *, *::before, *::after { overflow: visible !important; max-height: none !important; }
      /* Reset za potpisni blok */
      ._sig-block, ._sig-block * { position: static !important; display: block !important; float: none !important; visibility: visible !important; opacity: 1 !important; color: #000 !important; background: #fff !important; }
      ._sig-block { page-break-before: avoid; margin-top: 16px; }
      ._sig-cols { display: flex; gap: 32px; justify-content: space-between; }
      ._sig-col { width: 48%; text-align: center; }
      ._sig-col p { margin: 0 0 4px; }
    </style>
    <title>${safeTitle}</title>
  </head>
  <body>
    ${containerHtml}
  </body>
</html>`

    // Sačuvaj preview HTML u tmp direktorij radi provjere
    try {
      const tmpDir = path.join(process.cwd(), 'tmp')
      await fs.ensureDir(tmpDir)
      const previewPath = path.join(tmpDir, 'fbih_repair_preview.html')
      await fs.writeFile(previewPath, finalHtml, 'utf-8')
    } catch {}

    const pdfPage = await browser.newPage()
    await pdfPage.setViewport({ width: 1200, height: 800 })
    await pdfPage.setContent(finalHtml, { waitUntil: 'networkidle0' })
    await pdfPage.pdf({ path: outPath, format: 'A4', printBackground: true })
    return true
  } finally {
    await browser.close()
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Federacija BiH', 'PDF')
  await fs.ensureDir(PDF_DIR)

  const sourceUrl = process.env.FBIH_URL || 'https://fbihvlada.gov.ba/bs/1-zakon-o-advokaturi-federacije-bosne-i-hercegovine'
  const title = 'Zakon o advokaturi Federacije Bosne i Hercegovine'
  const outName = sanitizeFileName(title) + '-1_25.pdf'
  const outPath = path.join(PDF_DIR, outName)
  let finalPath = outPath
  try {
    const ok = await generateFormattedPdf(sourceUrl, title, outPath)
    if (!ok) throw new Error('PDF generation returned false')
  } catch (e: any) {
    if (String(e?.message || e).includes('EBUSY')) {
      finalPath = path.join(PDF_DIR, outName.replace(/\.pdf$/i, '.fixed.pdf'))
      const ok2 = await generateFormattedPdf(sourceUrl, title, finalPath)
      if (!ok2) {
        console.error('Failed to regenerate PDF to alternate path')
        process.exit(2)
      }
    } else {
      throw e
    }
  }
  console.log(JSON.stringify({ ok: true, path_pdf: finalPath }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })