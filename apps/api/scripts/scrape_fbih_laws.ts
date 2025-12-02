import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import * as cheerio from 'cheerio'
import puppeteer from 'puppeteer'

sqlite3.verbose()

type LawItem = {
  title: string
  url: string
  gazetteText?: string | null
  gazetteNumber?: string | null // e.g. "1/25"
  gazetteKey?: string | null // e.g. "1_25"
  gazetteDate?: string | null // ISO date
}

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normalizeTitle(s: string) {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim()
}
function hasWordZakon(title: string) {
  const n = normalizeTitle(title)
  return /\bzakon\b/i.test(n) || /z\s*a\s*k\s*o\s*n/i.test(title)
}
function isBosnianVersion(title: string) {
  const t = title.toLowerCase()
  if (t.includes('(hrvatski jezik)')) return false
  return true // prefer bosanski or neutral
}
function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}
function parseGazetteInfo(text: string): { gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } {
  const txt = text.replace(/\s+/g, ' ').trim()
  // broj X/YY or X/YYY
  const mNum = txt.match(/broj\s+([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
  let gazetteNumber: string | null = null
  let gazetteKey: string | null = null
  if (mNum) {
    const num = mNum[1]
    const yearRaw = mNum[2]
    gazetteNumber = `${num}/${yearRaw}`
    const year2 = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2)
    gazetteKey = `${num}_${year2}`
  }
  // date dd.mm.yy[yy].
  const mDate = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?/)
  let gazetteDate: string | null = null
  if (mDate) {
    const d = Number(mDate[1])
    const m = Number(mDate[2])
    const yRaw = mDate[3]
    const yNum = Number(yRaw)
    let Y = yNum
    if (yRaw.length === 2) {
      // assume 2000-2039 for 00-39, else 1900s fallback
      Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum
    }
    gazetteDate = `${String(Y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return { gazetteNumber, gazetteKey, gazetteDate }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

function absolute(base: string, href: string) {
  try {
    const u = new URL(href, base)
    return u.toString()
  } catch {
    return href
  }
}

async function scrapeYearPage(yearUrl: string): Promise<LawItem[]> {
  // Try static HTML fetch first
  try {
    const html = await fetchHtml(yearUrl)
    const $ = cheerio.load(html)
    const items: LawItem[] = []
    const anchors = $('a').toArray()
    for (const a of anchors) {
      const el = $(a)
      const title = (el.text() || '').trim()
      if (!title) continue
      if (!hasWordZakon(title)) continue
      if (!isBosnianVersion(title)) continue
      const href = el.attr('href') || ''
      if (!href) continue
      const url = absolute(yearUrl, href)
      let gazetteText: string | null = null
      let probe: cheerio.Element | null = a
      for (let depth = 0; depth < 6 && probe; depth++) {
        const parent = $(probe).parent()[0] || null
        const siblingsPrev = parent ? $(parent).prevAll().toArray() : []
        for (const s of siblingsPrev) {
          const t = $(s).text().trim()
          if (/Službene\s+novine\s+Federacije\s+BiH/i.test(t)) {
            gazetteText = t
            break
          }
        }
        if (gazetteText) break
        probe = parent
      }
      const parsed = gazetteText ? parseGazetteInfo(gazetteText) : { gazetteNumber: null, gazetteKey: null, gazetteDate: null }
      items.push({ title, url, gazetteText, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate: parsed.gazetteDate || null })
    }
    const byKey = new Map<string, LawItem>()
    for (const it of items) {
      const key = normalizeTitle(it.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
      const existing = byKey.get(key)
      if (!existing) byKey.set(key, it)
      else {
        const score = (x: LawItem) => (x.gazetteKey ? 2 : 0) + (x.gazetteDate ? 1 : 0)
        byKey.set(key, score(it) >= score(existing) ? it : existing)
      }
    }
    const arr = Array.from(byKey.values())
    if (arr.length > 0) return arr

    // Fallback: parse textual list items (no explicit anchors) on year page
    const textItems: LawItem[] = []
    let currentGazetteText: string | null = null
    let currentParsed: { gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } | null = null
    const blocks = $('p, li, div, section, article').toArray()
    for (const b of blocks) {
      const t = $(b).text().replace(/\s+/g, ' ').trim()
      if (!t) continue
      if (/Službene\s+novine\s+Federacije\s+BiH/i.test(t)) {
        currentGazetteText = t
        currentParsed = parseGazetteInfo(t)
        continue
      }
      // Lines like "1. Zakon o ..." or "8. ZAKON o ..."
      if (/^\d+/.test(t) && /zakon/i.test(t)) {
        const title = t.replace(/^\d+\s*\.?\s*/, '').trim()
        if (!title) continue
        if (!hasWordZakon(title)) continue
        const parsed = currentParsed || { gazetteNumber: null, gazetteKey: null, gazetteDate: null }
        textItems.push({ title, url: yearUrl, gazetteText: currentGazetteText, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate: parsed.gazetteDate || null })
      }
    }
    // Dedup textual items by normalized title
    const byKeyText = new Map<string, LawItem>()
    for (const it of textItems) {
      const key = normalizeTitle(it.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
      const existing = byKeyText.get(key)
      if (!existing) byKeyText.set(key, it)
      else {
        const score = (x: LawItem) => (x.gazetteKey ? 2 : 0) + (x.gazetteDate ? 1 : 0)
        byKeyText.set(key, score(it) >= score(existing) ? it : existing)
      }
    }
    const asText = Array.from(byKeyText.values())
    if (asText.length > 0) return asText
  } catch (e) {
    // fall through to puppeteer
  }

  // Puppeteer fallback for cookie/JS-driven content
  const browser = await puppeteer.launch({ headless: 'new' })
  try {
    const page = await browser.newPage()
    await page.goto(yearUrl, { waitUntil: 'networkidle0' })
    // Try to accept/close cookie banner
    try {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a')) as HTMLElement[]
        const target = btns.find((b) => /Prihvati|Slažem|U redu|Accept|OK/i.test(b.innerText || ''))
        target?.click()
      })
      await page.waitForTimeout(500)
    } catch {}
    const items: LawItem[] = await page.$$eval('a', (anchors) => {
      const base = location.href
      const results: { title: string; url: string; gazetteText?: string | null; gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null }[] = []
      for (const a of anchors) {
        const title = (a.textContent || '').trim()
        if (!title) continue
        // normalize
        let norm = ''
        try { norm = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() } catch { norm = title.toLowerCase() }
        if (!/\bzakon\b/i.test(norm) && !/z\s*a\s*k\s*o\s*n/i.test(title)) continue
        if (title.toLowerCase().includes('(hrvatski jezik)')) continue
        const href = (a.getAttribute('href') || '').trim()
        if (!href) continue
        let url = href
        try { url = new URL(href, base).toString() } catch {}
        let gazetteText: string | null = null
        let probe = a.parentElement as HTMLElement | null
        for (let depth = 0; depth < 6 && probe; depth++) {
          let s = probe.previousElementSibling as HTMLElement | null
          let steps = 0
          while (s && steps < 12) {
            const t = (s.textContent || '').trim()
            if (/Službene\s+novine\s+Federacije\s+BiH/i.test(t)) { gazetteText = t; break }
            s = s.previousElementSibling as HTMLElement | null
            steps++
          }
          if (gazetteText) break
          probe = probe.parentElement as HTMLElement | null
        }
        let gazetteNumber: string | null = null
        let gazetteKey: string | null = null
        let gazetteDate: string | null = null
        if (gazetteText) {
          const txt = gazetteText.replace(/\s+/g, ' ').trim()
          const mNum = txt.match(/broj\s+([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
          if (mNum) { const num = mNum[1]; const yearRaw = mNum[2]; gazetteNumber = `${num}/${yearRaw}`; const year2 = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2); gazetteKey = `${num}_${year2}` }
          const mDate = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?/)
          if (mDate) { const d = Number(mDate[1]); const m = Number(mDate[2]); const yRaw = mDate[3]; const yNum = Number(yRaw); let Y = yNum; if (yRaw.length === 2) { Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum } gazetteDate = `${String(Y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
        }
        results.push({ title, url, gazetteText, gazetteNumber, gazetteKey, gazetteDate })
      }
      // Dedup by normalized title
      const map = new Map<string, typeof results[0]>()
      for (const it of results) {
        let key = it.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim()
        try { key = key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim() } catch { key = key.toLowerCase() }
        const ex = map.get(key)
        if (!ex) map.set(key, it)
        else {
          const score = (x: any) => (x.gazetteKey ? 2 : 0) + (x.gazetteDate ? 1 : 0)
          map.set(key, score(it) >= score(ex) ? it : ex)
        }
      }
      return Array.from(map.values()) as any
    })
    return items
  } finally {
    await browser.close()
  }
}

async function scrapeIndexPage(pageUrl: string): Promise<string[]> {
  const html = await fetchHtml(pageUrl)
  const $ = cheerio.load(html)
  const links: string[] = []
  $('a').each((_i, el) => {
    const href = $(el).attr('href') || ''
    if (!href) return
    const abs = absolute(pageUrl, href)
    // Target explicit year registry pages
    if (/\/bs\/hronoloski-registar-zakona-objavljenih-u-sluzbenim-novinama-fbih-u-\d{4}-godini\/?$/i.test(abs)) {
      links.push(abs)
    }
  })
  // Fallback: if none detected, include any content pages under /bs/zakoni/ not being pagination
  if (links.length === 0) {
    $('a').each((_i, el) => {
      const href = $(el).attr('href') || ''
      if (!href) return
      const abs = absolute(pageUrl, href)
      if (/\/bs\/zakoni\//.test(abs) && !/\?page=/.test(abs)) {
        links.push(abs)
      }
    })
  }
  return Array.from(new Set(links))
}

async function ensurePdfFor(item: LawItem, pdfDir: string): Promise<string | null> {
  await fs.ensureDir(pdfDir)
  const baseName = sanitizeFileName(item.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
  const suffix = item.gazetteKey ? `-${item.gazetteKey}` : ''
  const outPath = path.join(pdfDir, `${baseName}${suffix}.pdf`)
  // If already exists, skip
  if (await fs.pathExists(outPath)) return outPath

  // Decide whether URL is a PDF
  const urlLower = (item.url || '').toLowerCase()
  const looksPdf = urlLower.endsWith('.pdf') || urlLower.includes('/pdf')
  // Avoid printing generic year pages to PDF; leave path_pdf null
  if (!looksPdf && /hronoloski-registar-zakona-objavljenih-u-sluzbenim-novinama-fbih/i.test(urlLower)) {
    return null
  }
  try {
    if (looksPdf) {
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(`Failed to download PDF: HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      const buf = Buffer.from(ab)
      await fs.writeFile(outPath, buf)
      return outPath
    } else {
      const browser = await puppeteer.launch({ headless: 'new' })
      const page = await browser.newPage()
      await page.goto(item.url, { waitUntil: 'networkidle0' })
      // Try to locate the main law text container and extract only its content
      const extracted = await page.evaluate(() => {
        function score(el: Element): number {
          const t = (el.textContent || '').trim()
          return t.split(/\s+/).length
        }
        const candidates: Element[] = []
        const selectors = [
          'article',
          'main',
          '.content',
          '.page-content',
          '.field--name-body',
          '.node__content',
          '.views-row',
          '.region-content',
          '.col',
        ]
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => candidates.push(el))
        }
        // also consider all <div> blocks but cap amount
        const divs = Array.from(document.querySelectorAll('div')).slice(0, 500)
        for (const d of divs) candidates.push(d)
        let best: Element | null = null
        let bestScore = 0
        for (const el of candidates) {
          const sc = score(el)
          // ignore very short or navigation-like blocks
          const cls = (el as HTMLElement).className || ''
          if (/nav|header|footer|menu|breadcrumb/i.test(cls)) continue
          if (sc > bestScore) { best = el; bestScore = sc }
        }
        const title = (document.querySelector('h1')?.textContent || '').trim()
        const bodyText = best ? (best.textContent || '').trim() : (document.body.textContent || '').trim()
        return { title, bodyText }
      })
      // Render a clean page with only the law title and text
      const pdfPage = await browser.newPage()
      const safeTitle = sanitizeFileName(item.title)
      const contentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
        body { font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #000; }
        h1 { font-size: 16pt; margin-bottom: 12px; }
        pre { white-space: pre-wrap; word-wrap: break-word; }
      </style></head><body>
        <h1>${safeTitle}</h1>
        <pre>${extracted.bodyText.replace(/[<>]/g, (c) => ({ '<': '&lt;', '>': '&gt;' } as any)[c])}</pre>
      </body></html>`
      await pdfPage.setContent(contentHtml, { waitUntil: 'load' })
      await pdfPage.pdf({ path: outPath, format: 'A4', printBackground: true })
      await browser.close()
      return outPath
    }
  } catch (e) {
    console.warn(`PDF creation failed for "${item.title}":`, e)
    return null
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Federacija BiH', 'PDF')
  await fs.ensureDir(DATA_DIR)
  await fs.ensureDir(PDF_DIR)

  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

  // Ensure laws table exists
  await run(
    `CREATE TABLE IF NOT EXISTS laws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jurisdiction TEXT NOT NULL,
      title TEXT NOT NULL,
      title_normalized TEXT,
      slug TEXT,
      doc_type TEXT,
      gazette_key TEXT,
      gazette_number TEXT,
      gazette_date TEXT,
      source_url TEXT,
      url_pdf TEXT,
      path_pdf TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`
  )

  const LIMIT = Number(process.env.LIMIT || 0) // 0 = no limit
  const indexPages = [1, 2, 3, 4].map((n) => `https://fbihvlada.gov.ba/bs/zakoni?page=${n}`)
  let yearPages: string[] = []
  for (const url of indexPages) {
    try {
      const ys = await scrapeIndexPage(url)
      for (const y of ys) yearPages.push(y)
    } catch (e) {
      console.warn('Failed to parse index page', url, e)
    }
  }
  let seenYearPages = Array.from(new Set(yearPages))
  if (seenYearPages.length === 0) {
    console.warn('No year pages detected from index; falling back to scraping index pages directly.')
    seenYearPages = indexPages
  }
  console.log(`Found ~${seenYearPages.length} target pages under FBiH.`)

  const collected: LawItem[] = []
  for (const yp of seenYearPages) {
    try {
      const items = await scrapeYearPage(yp)
      for (const it of items) collected.push(it)
      console.log(`Parsed year page: ${yp} -> ${items.length} laws (filtered).`)
    } catch (e) {
      console.warn('Failed to parse year page', yp, e)
    }
    if (LIMIT > 0 && collected.length >= LIMIT) break
  }

  // Apply final filters and take up to LIMIT if set
  const filtered = collected
    .filter((i) => hasWordZakon(i.title))
    .filter((i) => isBosnianVersion(i.title))
    .filter((i) => !!i.url)
    .slice(0, LIMIT > 0 ? LIMIT : collected.length)

  console.log(`Collected ${filtered.length} law entries to insert.`)

  let inserted = 0
  for (const it of filtered) {
    const jurisdiction = 'FBiH'
    const title = it.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim()
    const title_normalized = normalizeTitle(title)
    const gazette_key = it.gazetteKey || null
    const gazette_number = it.gazetteNumber || null
    const gazette_date = it.gazetteDate || null
    const source_url = it.url
    const url_pdf = /\.pdf($|\?)/i.test(it.url) ? it.url : null

    // Skip if already inserted (match by jurisdiction + title + gazette_key)
    const existing = await get<{ id: number }>(
      `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') LIMIT 1`,
      [jurisdiction, title, gazette_key]
    )
    if (existing?.id) {
      console.log(`Skip existing: id=${existing.id} title="${title}"`)
      continue
    }

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
      [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, source_url, url_pdf]
    )
    const row = await get<{ id: number }>(
      `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') ORDER BY id DESC LIMIT 1`,
      [jurisdiction, title, gazette_key]
    )
    const lawId = row?.id
    let path_pdf: string | null = null
    if (lawId) {
      path_pdf = await ensurePdfFor(it, PDF_DIR)
      if (path_pdf) {
        await run('UPDATE laws SET path_pdf = ?, updated_at = datetime("now") WHERE id = ?', [path_pdf, lawId])
      }
    }
    inserted++
    console.log(`Inserted FBiH law: id=${lawId} title="${title}" gazette=${gazette_key || gazette_number || ''} pdf=${path_pdf ? 'yes' : 'no'}`)
  }

  console.log(JSON.stringify({ ok: true, inserted }, null, 2))
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})