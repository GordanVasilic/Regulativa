import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'
import puppeteer from 'puppeteer'

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
function parseGazetteInfo(text: string): { gazetteNumber?: string | null; gazetteKey?: string | null } {
  const txt = String(text).replace(/\s+/g, ' ').trim()
  const mNum = txt.match(/(?:broj\s*)?([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
  let gazetteNumber: string | null = null
  let gazetteKey: string | null = null
  if (mNum) {
    const num = mNum[1]
    const yearRaw = mNum[2]
    gazetteNumber = `${num}/${yearRaw}`
    const year2 = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2)
    gazetteKey = `${num}_${year2}`
  } else {
    const only = txt.match(/^([0-9]{1,3})$/)
    if (only) {
      // year will be added later once known
      gazetteNumber = only[1]
    }
  }
  return { gazetteNumber, gazetteKey }
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
function findYearFromSourceUrl(url: string | undefined): number | null {
  if (!url) return null
  const m = url.match(/\/(19\d{2}|20\d{2})\//)
  return m ? Number(m[1]) : null
}
function findDateField(row: any): any {
  const keys = Object.keys(row)
  for (const k of keys) {
    const keyName = k.toLowerCase()
    const v = row[k]
    if (/datum/.test(keyName)) return v
    if (typeof v === 'string') {
      const t = v.trim()
      if (!t) continue
      const m = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
      if (m) return t
    }
    if (typeof v === 'number') {
      if (v > 20000 && v < 60000) return v
    }
    if (v instanceof Date) return v
  }
  return undefined
}
function toIsoDate(val: any): string | null {
  if (val == null) return null
  if (val instanceof Date && !isNaN(val.getTime())) {
    const Y = val.getFullYear(), M = val.getMonth() + 1, D = val.getDate()
    return `${String(Y).padStart(4,'0')}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`
  }
  if (typeof val === 'number') {
    try {
      const parsed: any = (xlsx as any).SSF?.parse_date_code ? (xlsx as any).SSF.parse_date_code(val) : null
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return `${String(parsed.y).padStart(4,'0')}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`
      }
    } catch {}
    const epoch = new Date(Date.UTC(1899, 11, 30))
    const ms = val * 24 * 60 * 60 * 1000
    const dt = new Date(epoch.getTime() + ms)
    if (!isNaN(dt.getTime())) {
      const Y = dt.getUTCFullYear(), M = dt.getUTCMonth() + 1, D = dt.getUTCDate()
      return `${String(Y).padStart(4,'0')}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`
    }
    return null
  }
  const s = String(val).trim()
  const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), yRaw = m[3], yNum = Number(yRaw)
    let Y = yNum
    if (yRaw.length === 2) Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum
    return `${String(Y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
  }
  return null
}

async function ensurePdfFullPage(item: LawItem, pdfDir: string): Promise<string | null> {
  await fs.ensureDir(pdfDir)
  const baseName = sanitizeFileName(item.title.replace(/\(bosanski jezik\)/i, '').replace(/\(hrvatski jezik\)/i, '').trim())
  const suffix = item.gazetteKey ? `-${item.gazetteKey}` : ''
  const outPath = path.join(pdfDir, `${baseName}${suffix}.pdf`)
  if (await fs.pathExists(outPath)) return outPath
  const urlLower = (item.url || '').toLowerCase()
  const looksPdf = urlLower.endsWith('.pdf') || urlLower.includes('/pdf')
  try {
    if (looksPdf) {
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(`Failed to download PDF: HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      await fs.writeFile(outPath, Buffer.from(ab))
      return outPath
    }
    const browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage()
    await page.goto(item.url, { waitUntil: 'networkidle0' })
    try {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, a')) as HTMLElement[]
        const target = btns.find((b) => /Prihvati|Slažem|U redu|Accept|OK/i.test((b.innerText || '').trim()))
        target?.click()
      })
      await page.waitForTimeout(500)
    } catch {}
    await page.pdf({ path: outPath, format: 'A4', printBackground: true })
    await browser.close()
    return outPath
  } catch (e) {
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

  const argv = process.argv.slice(2)
  const getArg = (name: string) => { const pref = `--${name}=`; const hit = argv.find((a) => a.startsWith(pref)); return hit ? hit.slice(pref.length) : undefined }
  const xlsxPath = getArg('xlsx') || path.join(ROOT, '..', '..', 'fbihdo96-20.xlsx')
  const limitArg = getArg('limit')
  const LIMIT = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 3

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
    let { gazetteNumber, gazetteKey } = pub ? parseGazetteInfo(pub) : { gazetteNumber: null, gazetteKey: null }
    const dfield = findDateField(row)
    const gazetteDate = dfield != null ? toIsoDate(dfield) : null
    // If pub is only a number (e.g., "15"), add year suffix from date or source_url
    if (gazetteNumber && /^\d{1,3}$/.test(gazetteNumber)) {
      const year = gazetteDate ? Number(gazetteDate.slice(0, 4)) : findYearFromSourceUrl(url)
      if (year) {
        const yy = String(year).slice(-2)
        gazetteKey = `${gazetteNumber}_${yy}`
        gazetteNumber = `${gazetteNumber}/${yy}`
      }
    }
    picked.push({ title, url, gazetteText: pub || null, gazetteNumber: gazetteNumber || null, gazetteKey: gazetteKey || null, gazetteDate })
    if (picked.length >= LIMIT) break
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
  for (const it of picked) {
    const jurisdiction = 'FBiH'
    const title = it.title.trim()
    const title_normalized = normalizeTitle(title)
    let gazette_key = it.gazetteKey || null
    let gazette_number = it.gazetteNumber || null
    let gazette_date = it.gazetteDate || null
    const source_url = it.url
    const url_pdf = /\.pdf($|\?)/i.test(it.url) ? it.url : null

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
    } else {
      await run('UPDATE laws SET gazette_number = ?, gazette_key = ?, gazette_date = ?, updated_at = datetime("now") WHERE id = ?', [gazette_number, gazette_key, gazette_date, lawId])
    }
    let path_pdf: string | null = null
    if (lawId) {
      path_pdf = await ensurePdfFullPage(it, PDF_DIR)
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

main().catch((e) => { console.error(e); process.exit(1) })