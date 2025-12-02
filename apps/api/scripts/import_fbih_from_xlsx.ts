import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'

type LawItem = {
  title: string
  url: string
  gazetteText?: string | null
  gazetteNumber?: string | null
  gazetteKey?: string | null
  gazetteDate?: string | null
}

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normalizeTitle(s: string) {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim()
}
function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}
function parseGazetteInfo(text: string): { gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } {
  const txt = text.replace(/\s+/g, ' ').trim()
  const mNum = txt.match(/(?:broj\s*)?([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
  let gazetteNumber: string | null = null
  let gazetteKey: string | null = null
  if (mNum) {
    const num = mNum[1]
    const yearRaw = mNum[2]
    gazetteNumber = `${num}/${yearRaw}`
    const year2 = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2)
    gazetteKey = `${num}_${year2}`
  }
  const mDate = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?/)
  let gazetteDate: string | null = null
  if (mDate) {
    const d = Number(mDate[1])
    const m = Number(mDate[2])
    const yRaw = mDate[3]
    const yNum = Number(yRaw)
    let Y = yNum
    if (yRaw.length === 2) {
      Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum
    }
    gazetteDate = `${String(Y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  return { gazetteNumber, gazetteKey, gazetteDate }
}

async function ensurePdfFor(item: LawItem, pdfDir: string, previewHtmlPath?: string): Promise<string | null> {
  await fs.ensureDir(pdfDir)
  const baseName = sanitizeFileName(item.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
  const suffix = item.gazetteKey ? `-${item.gazetteKey}` : ''
  const outPath = path.join(pdfDir, `${baseName}${suffix}.pdf`)
  if (await fs.pathExists(outPath)) return outPath
  const urlLower = (item.url || '').toLowerCase()
  const looksPdf = urlLower.endsWith('.pdf') || urlLower.includes('/pdf')
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
      const selectors = [
        '.row.row-single-article .col-md-8.col-8-single-article',
        '.row.row-single-article .col-8-single-article',
        '.row.row-single-article .content-article',
        '.single-article .content-article',
        '.content-article'
      ]
      const { title, containerHtml } = await page.evaluate((sels) => {
        const titleEl = document.querySelector('h1')
        const title = ((titleEl && titleEl.textContent) || '').trim()
        let html = ''
        for (let i = 0; i < sels.length; i++) {
          const el = document.querySelector(sels[i]) as HTMLElement | null
          if (el && el.innerHTML && el.innerHTML.trim().length > 0) {
            html = el.innerHTML.trim()
            break
          }
        }
        if (!html) {
          const ca = document.querySelector('.content-article') as HTMLElement | null
          if (ca && ca.innerHTML.trim()) html = ca.innerHTML.trim()
        }
        const tmp = document.createElement('div')
        tmp.innerHTML = html
        tmp.querySelectorAll('script, style, nav, aside, header, footer').forEach((el) => el.remove())
        const cleaned = tmp.innerHTML.replace(/<br\s*\/?>\s*<br\s*\/?>/gi, '<br>')
        return { title, containerHtml: cleaned }
      }, selectors)
      const pdfPage = await browser.newPage()
      const safeTitle = sanitizeFileName(item.title)
      const contentHtml = `<!doctype html><html><head><meta charset="utf-8"><style>
        @page{size:A4;margin:16mm}
        body{font-family:Arial,sans-serif;font-size:12pt;line-height:1.6;color:#000}
        h1{font-size:16pt;margin:0 0 12px}
        p{margin:0 0 10px;hyphens:auto;-webkit-hyphens:auto}
        .text-center{text-align:center !important}
        .text-left{text-align:left !important}
        .text-right{text-align:right !important}
        .text-justify{text-align:justify !important}
        ul,ol{margin:0 0 10px 24px;padding-left:24px}
        table{width:100%;border-collapse:collapse}
        th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
        img{max-width:100%;height:auto}
      </style></head><body>
        <h1>${safeTitle}</h1>
        <div class="_main">${containerHtml || ''}</div>
      </body></html>`
      if (previewHtmlPath) {
        await fs.ensureDir(path.dirname(previewHtmlPath))
        await fs.writeFile(previewHtmlPath, contentHtml, 'utf-8')
      }
      await pdfPage.setContent(contentHtml, { waitUntil: 'load' })
      await pdfPage.pdf({ path: outPath, format: 'A4', printBackground: true })
      await browser.close()
      return outPath
    }
  } catch (e) {
    console.warn(`ensurePdfFor failed: ${item.title} -> ${item.url}`, e)
    return null
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return await res.text()
}

async function enrichGazetteFromPage(url: string): Promise<{ gazetteText?: string | null; gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } | null> {
  try {
    const html = await fetchHtml(url)
    const $ = cheerio.load(html)
    const blocks = $('p, div, li, section, article').toArray()
    let anyDate: string | null = null
    for (const b of blocks) {
      const t = $(b).text().replace(/\s+/g, ' ').trim()
      if (/Službene\s+novine\s+Federacije\s+BiH/i.test(t)) {
        const parsed = parseGazetteInfo(t)
        return { gazetteText: t, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate: parsed.gazetteDate || null }
      }
      const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
      if (!anyDate && m) anyDate = `${m[1]}.${m[2]}.${m[3]}`
    }
    if (anyDate) {
      const p = parseGazetteInfo(anyDate)
      return { gazetteText: null, gazetteNumber: null, gazetteKey: null, gazetteDate: p.gazetteDate || null }
    }
  } catch {}
  try {
    const browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage()
    await page.goto(url, { waitUntil: 'networkidle0' })
    const info = await page.evaluate(() => {
      const sels = ['p','div','li','section','article']
      for (let i = 0; i < sels.length; i++) {
        const nodes = Array.from(document.querySelectorAll(sels[i]))
        for (let j = 0; j < nodes.length; j++) {
          const t = (nodes[j].textContent || '').replace(/\s+/g, ' ').trim()
          if (/Službene\s+novine\s+Federacije\s+BiH/i.test(t)) return t
        }
      }
      return null
    })
    await browser.close()
    if (info) {
      const parsed = parseGazetteInfo(info)
      return { gazetteText: info, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate: parsed.gazetteDate || null }
    }
  } catch {}
  return null
}

async function enrichGazetteFromIndexPages(title: string): Promise<{ gazetteText?: string | null; gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } | null> {
  const pages = [1, 2, 3, 4].map((n) => `https://fbihvlada.gov.ba/bs/zakoni?page=${n}`)
  const targetKey = normalizeTitle(title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
  for (const url of pages) {
    try {
      const html = await fetchHtml(url)
      const $ = cheerio.load(html)
      const anchors = $('a').toArray()
      for (const a of anchors) {
        const t = ($(a).text() || '').trim()
        if (!t) continue
        const k = normalizeTitle(t.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
        if (k !== targetKey) continue
        let gazetteText: string | null = null
        let probe: cheerio.Element | null = a
        for (let depth = 0; depth < 6 && probe; depth++) {
          const parent = $(probe).parent()[0] || null
          const siblingsPrev = parent ? $(parent).prevAll().toArray() : []
          for (const s of siblingsPrev) {
            const tt = $(s).text().replace(/\s+/g, ' ').trim()
            if (/Službene\s+novine\s+Federacije\s+BiH/i.test(tt)) { gazetteText = tt; break }
          }
          if (gazetteText) break
          probe = parent
        }
        if (gazetteText) {
          const parsed = parseGazetteInfo(gazetteText)
          return { gazetteText, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate: parsed.gazetteDate || null }
        }
      }
    } catch {}
  }
  return null
}

async function enrichFromPravnapomoc(title: string): Promise<{ gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null } | null> {
  try {
    const ROOT = path.resolve(process.cwd())
    const jsonPath = path.join(ROOT, 'tmp', 'fbih_pravnapomoc_from_mhtml.json')
    if (!(await fs.pathExists(jsonPath))) return null
    const raw = await fs.readFile(jsonPath, 'utf-8')
    const data = JSON.parse(raw) as { count: number; items: Array<{ title: string; issue?: string; date?: string }> }
    const targetKey = normalizeTitle(title)
    let best: { issue?: string; date?: string } | null = null
    for (const it of data.items) {
      const k = normalizeTitle(it.title)
      if (k === targetKey) { best = it; break }
    }
    if (!best) return null
    const issue = best.issue || null
    const date = best.date || null
    let gazetteNumber: string | null = null
    let gazetteKey: string | null = null
    if (issue) {
      gazetteNumber = issue
      const m = issue.match(/^(\d{1,3})\/(\d{2,4})$/)
      if (m) {
        const num = m[1]
        const yr = m[2].length === 2 ? m[2] : m[2].slice(-2)
        gazetteKey = `${num}_${yr}`
      }
    }
    let gazetteDate: string | null = null
    if (date) {
      const p = parseGazetteInfo(date)
      gazetteDate = p.gazetteDate || null
    }
    return { gazetteNumber, gazetteKey, gazetteDate }
  } catch {
    return null
  }
}

function findTitleField(row: any): string | undefined {
  const keys = Object.keys(row)
  const candidates = keys.filter((k) => typeof row[k] === 'string')
  let best: string | undefined
  let bestScore = 0
  for (const k of candidates) {
    const v = String(row[k]).trim()
    if (!v) continue
    if (/^https?:\/\//i.test(v)) continue
    const keyName = k.toLowerCase()
    const bonus = (/\bzakon\b/i.test(v) ? 3 : 0) + (/naziv|naslov|propis|title/.test(keyName) ? 2 : 0)
    const score = bonus + Math.min(v.length, 200)
    if (score > bestScore) { best = v; bestScore = score }
  }
  return best
}

function findUrlField(row: any): string | undefined {
  const keys = Object.keys(row)
  for (const k of keys) {
    const v = row[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v
  }
  return undefined
}

function findPublishedField(row: any): string | undefined {
  const keys = Object.keys(row)
  for (const k of keys) {
    const v = row[k]
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) continue
    const keyName = k.toLowerCase()
    if (/Službene\s+novine/i.test(t) || /\b\d{1,3}\/\d{2,4}\b/.test(t) || /\b(broj|br\.)\b/i.test(t) || /Objavljeno/i.test(t) || /sluzbene|objavljeno|broj/.test(keyName)) return t
  }
  return undefined
}

function findDateField(row: any): string | undefined {
  const keys = Object.keys(row)
  for (const k of keys) {
    const keyName = k.toLowerCase()
    const v = row[k]
    if (/datum/.test(keyName)) return v as any
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t) continue
      const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
      if (m) return t
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 60000) return v as any
    }
    if (v instanceof Date) return v as any
  }
  return undefined
}

function toIsoDate(val: any): string | null {
  if (val == null) return null
  if (val instanceof Date && !isNaN(val.getTime())) {
    const Y = val.getFullYear()
    const M = val.getMonth() + 1
    const D = val.getDate()
    return `${String(Y).padStart(4,'0')}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`
  }
  if (typeof val === 'number') {
    try {
      // Excel serial date
      const parsed: any = (xlsx as any).SSF?.parse_date_code ? (xlsx as any).SSF.parse_date_code(val) : null
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return `${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`
      }
    } catch {}
    // Fallback: treat as days since 1899-12-30
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const ms = val * 24 * 60 * 60 * 1000
    const dt = new Date(epoch.getTime() + ms)
    if (!isNaN(dt.getTime())) {
      const Y = dt.getUTCFullYear()
      const M = dt.getUTCMonth() + 1
      const D = dt.getUTCDate()
      return `${String(Y).padStart(4,'0')}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`
    }
    return null
  }
  const s = String(val).trim()
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (m) {
    const d = Number(m[1])
    const mo = Number(m[2])
    const yRaw = m[3]
    const yNum = Number(yRaw)
    let Y = yNum
    if (yRaw.length === 2) Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum
    return `${String(Y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  return null
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Federacija BiH', 'PDF')
  await fs.ensureDir(DATA_DIR)
  await fs.ensureDir(PDF_DIR)

  const argv = process.argv.slice(2)
  const getArg = (name: string) => {
    const pref = `--${name}=`
    const hit = argv.find((a) => a.startsWith(pref))
    return hit ? hit.slice(pref.length) : undefined
  }
  const xlsxPath = getArg('xlsx') || path.join(ROOT, '..', '..', 'fbihdo22-25.xlsx')
  const limitArg = getArg('limit')
  const LIMIT = limitArg != null ? parseInt(limitArg, 10) : 0

  const wb = xlsx.readFile(xlsxPath)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' })

  const picked: LawItem[] = []
  for (const row of rows) {
    const title = findTitleField(row) || ''
    const url = findUrlField(row) || ''
    if (!title || !url) continue
    const pub = findPublishedField(row) || ''
    const dfield = findDateField(row)
    const parsed = pub ? parseGazetteInfo(pub) : { gazetteNumber: null, gazetteKey: null, gazetteDate: null }
    const gazetteDate = dfield != null ? toIsoDate(dfield) : parsed.gazetteDate || null
    picked.push({ title, url, gazetteText: pub || null, gazetteNumber: parsed.gazetteNumber || null, gazetteKey: parsed.gazetteKey || null, gazetteDate })
    if (LIMIT > 0 && picked.length >= LIMIT) break
  }

  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

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

  let inserted = 0
  const previewHtmlPath = path.join(ROOT, 'tmp', 'fbih_single_article_preview.html')
  for (const it of picked) {
    const jurisdiction = 'FBiH'
    const title = it.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim()
    const title_normalized = normalizeTitle(title)
    let gazette_key = it.gazetteKey || null
    let gazette_number = it.gazetteNumber || null
    let gazette_date = it.gazetteDate || null
    const source_url = it.url
    const url_pdf = /\.pdf($|\?)/i.test(it.url) ? it.url : null

    if (!gazette_key || !gazette_date) {
      const enriched = await enrichGazetteFromPage(source_url)
      if (enriched) {
        if (!gazette_key && enriched.gazetteKey) gazette_key = enriched.gazetteKey
        if (!gazette_number && enriched.gazetteNumber) gazette_number = enriched.gazetteNumber
        if (!gazette_date && enriched.gazetteDate) gazette_date = enriched.gazetteDate
      }
    }
    if (!gazette_date) {
      const fromIndex = await enrichGazetteFromIndexPages(title)
      if (fromIndex) {
        if (!gazette_key && fromIndex.gazetteKey) gazette_key = fromIndex.gazetteKey
        if (!gazette_number && fromIndex.gazetteNumber) gazette_number = fromIndex.gazetteNumber
        if (!gazette_date && fromIndex.gazetteDate) gazette_date = fromIndex.gazetteDate
      }
    }
    if (!gazette_date) {
      const fromJson = await enrichFromPravnapomoc(title)
      if (fromJson) {
        if (!gazette_key && fromJson.gazetteKey) gazette_key = fromJson.gazetteKey
        if (!gazette_number && fromJson.gazetteNumber) gazette_number = fromJson.gazetteNumber
        if (!gazette_date && fromJson.gazetteDate) gazette_date = fromJson.gazetteDate
      }
    }

    const existing = await get<{ id: number }>(
      `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') LIMIT 1`,
      [jurisdiction, title, gazette_key]
    )
    let lawId = existing?.id
    if (!lawId) {
      await run(
        `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
        [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, source_url, url_pdf]
      )
      const row = await get<{ id: number }>(
        `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') ORDER BY id DESC LIMIT 1`,
        [jurisdiction, title, gazette_key]
      )
      lawId = row?.id
    }
    // Update metadata even if exists
    if (lawId) {
      await run('UPDATE laws SET gazette_number = ?, gazette_key = ?, gazette_date = ?, updated_at = datetime("now") WHERE id = ?', [gazette_number, gazette_key, gazette_date, lawId])
    }
    let path_pdf: string | null = null
    if (lawId) {
      path_pdf = await ensurePdfFor(it, PDF_DIR, previewHtmlPath)
      if (path_pdf) {
        const port = process.env.PORT ? Number(process.env.PORT) : 5000
        const localUrl = `http://localhost:${port}/pdf/${lawId}`
        await run('UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime("now") WHERE id = ?', [path_pdf, localUrl, lawId])
      }
    }
    inserted++
  }

  console.log(JSON.stringify({ ok: true, inserted, count: picked.length }, null, 2))
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})