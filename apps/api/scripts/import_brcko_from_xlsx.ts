import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'
import AdmZip from 'adm-zip'
import puppeteer from 'puppeteer'
import { execFile } from 'node:child_process'

type LawItem = {
  title: string
  url: string
  gazetteText?: string | null
  gazetteNumber?: string | null
  gazetteKey?: string | null
  gazetteDate?: string | null
  year?: number | null
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
function parseGazetteInfo(text: string): { gazetteNumber?: string | null; gazetteKey?: string | null; gazetteDate?: string | null; matchedPrefix?: string | null; year?: number | null } {
  const match = text.match(/(\d{1,3}B)?(\d{2}-\d{2})\s/);
  if (match) {
    const matchedPrefix = match[0]
    const gazetteNumber = match[2]
    const yy = Number(match[2].split('-')[1])
    const yearFull = yy <= 39 ? 2000 + yy : 1900 + yy
    const gazetteKey = gazetteNumber.replace('-', '_')
    // Per requirement: do not set exact gazette_date; leave empty
    const gazetteDate = null
    return { gazetteNumber, gazetteKey, gazetteDate, matchedPrefix, year: yearFull }
  }
  return { gazetteNumber: null, gazetteKey: null, gazetteDate: null, matchedPrefix: null, year: null }
}
function findTitleField(row: any): string | undefined {
  const keys = Object.keys(row);
  const titleCandidate = keys.find(key => key.toLowerCase().includes('zakon'));
  if (titleCandidate && typeof row[titleCandidate] === 'string') {
    return row[titleCandidate];
  }

  // Fallback to original logic if specific column not found
  const candidates = keys.filter((k) => typeof row[k] === 'string');
  let best: string | undefined;
  let bestScore = 0;
  for (const k of candidates) {
    const v = String(row[k]).trim();
    if (!v) continue;
    if (/^https?:\/\//i.test(v)) continue;
    const keyName = k.toLowerCase();
    const bonus = (/\bzakon\b/i.test(v) ? 3 : 0) + (/naziv|naslov|propis|title/.test(keyName) ? 2 : 0);
    const score = bonus + Math.min(v.length, 200);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
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
    if (/Službeni\s+glasnik/i.test(t) || /\b\d{1,3}\/\d{2,4}\b/.test(t) || /\b(broj|br\.)\b/i.test(t) || /sluzbeni|objavljeno|broj|glasnik/.test(keyName)) return t
  }
  return undefined
}
function toIsoDate(val: any): string | null {
  if (val == null) return null
  if (val instanceof Date && !isNaN(val.getTime())) {
    const Y = val.getFullYear(), M = val.getMonth() + 1, D = val.getDate()
    return `${String(Y).padStart(4,'0')}-${String(M).padStart(2,'0')}-${String(D).padStart(2,'0')}`
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
async function sofficeConvertToPdf(srcPath: string, outDir: string): Promise<string> {
  const candidates = [
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ]
  let sofficePath = 'soffice'
  for (const c of candidates) {
    const p = c.replace(/\\\\/g, '\\')
    if (await fs.pathExists(p)) { sofficePath = p; break }
  }
  await new Promise<void>((resolve, reject) => {
    execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath], (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
  const stem = path.basename(srcPath, path.extname(srcPath))
  const produced = path.join(outDir, `${stem}.pdf`)
  if (!(await fs.pathExists(produced))) {
    throw new Error('conversion failed')
  }
  return produced
}
async function ensurePdfFromUrl(item: LawItem, pdfDir: string): Promise<string | null> {
  await fs.ensureDir(pdfDir)
  const baseName = sanitizeFileName(item.title.trim())
  const suffix = item.gazetteKey ? `-${item.gazetteKey}` : ''
  const outPath = path.join(pdfDir, `${baseName}${suffix}.pdf`)
  if (await fs.pathExists(outPath)) return outPath
  const urlLower = (item.url || '').toLowerCase()
  const looksPdf = urlLower.endsWith('.pdf') || urlLower.includes('/pdf')
  const looksZip = urlLower.endsWith('.zip')
  try {
    if (looksPdf) {
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      await fs.writeFile(outPath, Buffer.from(ab))
      return outPath
    }
    if (looksZip) {
      const tmpDir = path.join(process.cwd(), 'tmp', 'srb_zip')
      await fs.ensureDir(tmpDir)
      const zipTmp = path.join(tmpDir, `${Date.now()}_${Math.random().toString(36).slice(2)}.zip`)
      const res = await fetch(item.url)
      if (!res.ok) return null
      const ab = await res.arrayBuffer()
      await fs.writeFile(zipTmp, Buffer.from(ab))
      const zip = new AdmZip(zipTmp)
      const entries = zip.getEntries().filter((e) => !e.isDirectory)
      const candidatePdf = entries.find((e) => path.basename(e.entryName).toLowerCase().endsWith('.pdf'))
      if (candidatePdf) {
        const data = candidatePdf.getData()
        await fs.writeFile(outPath, data)
        await fs.remove(zipTmp)
        return outPath
      }
      const pickByExt = (ext: string) => entries.find((e) => path.basename(e.entryName).toLowerCase().endsWith(ext))
      const chosen = pickByExt('.docx') || pickByExt('.doc') || pickByExt('.rtf')
      if (!chosen) { await fs.remove(zipTmp); return null }
      const tmpSrc = path.join(tmpDir, `${path.basename(outPath, '.pdf')}${path.extname(chosen.entryName).toLowerCase()}`)
      await fs.writeFile(tmpSrc, chosen.getData())
      const produced = await sofficeConvertToPdf(tmpSrc, tmpDir)
      await fs.copy(produced, outPath)
      await fs.remove(zipTmp)
      await fs.remove(tmpSrc)
      await fs.remove(produced)
      return outPath
    }
    const browser = await puppeteer.launch({ headless: 'new' })
    const page = await browser.newPage()
    await page.goto(item.url, { waitUntil: 'networkidle0' })
    await page.pdf({ path: outPath, format: 'A4', printBackground: true })
    await browser.close()
    return outPath
  } catch {
    return null
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Brcko', 'PDF')
  await fs.ensureDir(DATA_DIR)
  await fs.ensureDir(PDF_DIR)

  const argv = process.argv.slice(2)
  const getArg = (name: string) => { const pref = `--${name}=`; const hit = argv.find((a) => a.startsWith(pref)); return hit ? hit.slice(pref.length) : undefined }
  const xlsxPath = getArg('xlsx') || path.join(ROOT, '..', '..', 'BrckoZakoniLista.xlsx')
  const limitArg = getArg('limit')
  const LIMIT = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 3
  const metaOnlyArg = getArg('metaOnly')
  const META_ONLY = metaOnlyArg ? /^(1|true|yes)$/i.test(metaOnlyArg) : false
  const fixTitlesArg = getArg('fixTitles')
  const FIX_TITLES = fixTitlesArg ? /^(1|true|yes)$/i.test(fixTitlesArg) : false

  const wb = xlsx.readFile(xlsxPath)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' })

  const picked: LawItem[] = []
  for (const row of rows) {
    let rawTitle = findTitleField(row) || ''
    const url = findUrlField(row) || ''
    if (!rawTitle || !url) continue
    const meta = parseGazetteInfo(rawTitle)
    if (meta.matchedPrefix) rawTitle = rawTitle.replace(meta.matchedPrefix, '')
    // Also strip any leftover 3-digit Brčko marker like 003B/07B anywhere near the start
    const title = rawTitle.replace(/\s*\d{3}B\s*/gi, ' ').replace(/\s+/g, ' ').trim()
    picked.push({ title, url, gazetteText: null, gazetteNumber: meta.gazetteNumber || null, gazetteKey: meta.gazetteKey || null, gazetteDate: null, year: meta.year || null })
    if (picked.length >= LIMIT) break
  }

  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

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
      godina INTEGER,
      source_url TEXT,
      url_pdf TEXT,
      path_pdf TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`
  )

  try {
    const cols = await all<{ name: string }>('PRAGMA table_info(laws)')
    const hasGodina = cols.some((c) => c.name.toLowerCase() === 'godina')
    if (!hasGodina) {
      await run('ALTER TABLE laws ADD COLUMN godina INTEGER')
    }
  } catch (e) {
    // ignore
  }

  if (FIX_TITLES) {
    const rowsFix = await all<{ id: number; title: string }>("SELECT id, title FROM laws WHERE jurisdiction='BRCKO'")
    let updated = 0
    const clean = (t: string) => {
      let s = t.trim()
      // Remove leading codes like '004', '07B', '003B', optionally multiple times
      // Repeat until stabilized
      for (let i = 0; i < 3; i++) {
        const prev = s
        s = s.replace(/^\s*\d[\dA-Za-z\-_/]*[\.:–—]?\s+/, '').trim()
        if (s === prev) break
      }
      return s.replace(/\s+/g, ' ').trim()
    }
    for (const r of rowsFix) {
      const cleaned = clean(r.title)
      if (cleaned && cleaned !== r.title) {
        const norm = normalizeTitle(cleaned)
        await run('UPDATE laws SET title = ?, title_normalized = ?, updated_at = datetime("now") WHERE id = ?', [cleaned, norm, r.id])
        updated++
      }
    }
    console.log(JSON.stringify({ ok: true, fixed: updated }, null, 2))
    db.close()
    return
  }

  let inserted = 0
  for (const it of picked) {
    const jurisdiction = 'BRCKO'
    const title = it.title.trim()
    const title_normalized = normalizeTitle(title)
    let gazette_key = it.gazetteKey || null
    let gazette_number = it.gazetteNumber || null
    let gazette_date: string | null = null
    const godina = it.year || null
    const source_url = it.url
    const url_pdf = /\.pdf($|\?)/i.test(it.url) ? it.url : null

    const existing = await get<{ id: number }>(
      `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') LIMIT 1`,
      [jurisdiction, title, gazette_key]
    )
    let lawId = existing?.id
    if (!lawId) {
      await run(
        `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, godina, source_url, url_pdf, path_pdf)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, NULL)`,
        [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, godina, source_url, url_pdf]
      )
      const row = await get<{ id: number }>(
        `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND COALESCE(gazette_key, '') = COALESCE(?, '') ORDER BY id DESC LIMIT 1`,
        [jurisdiction, title, gazette_key]
      )
      lawId = row?.id
    } else {
      await run('UPDATE laws SET gazette_number = ?, gazette_key = ?, gazette_date = NULL, godina = ?, updated_at = datetime("now") WHERE id = ?', [gazette_number, gazette_key, godina, lawId])
    }
    if (lawId && !META_ONLY) {
      const path_pdf = await ensurePdfFromUrl(it, PDF_DIR)
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