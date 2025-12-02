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
  const txt = String(text).replace(/\s+/g, ' ').trim()
  const txtNorm = txt.replace(/[Мм]/g, 'M')
  const mu = /\bMU\b/i.test(txtNorm)
  const mNum = txt.match(/(?:broj\s*)?([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
  let gazetteNumber: string | null = null
  let gazetteKey: string | null = null
  if (mNum) {
    const num = mNum[1]
    const yearRaw = mNum[2]
    const yy = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2)
    gazetteNumber = mu ? `${num}/${yearRaw} MU` : `${num}/${yearRaw}`
    gazetteKey = `${num}_${yy}`
  } else {
    const only = txt.match(/^([0-9]{1,3})$/)
    if (only) {
      gazetteNumber = mu ? `${only[1]} MU` : only[1]
    }
  }
  return { gazetteNumber, gazetteKey, gazetteDate: null }
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
    'C\\\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C\\\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
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
  if (await fs.pathExists(outPath)) {
    if (await validatePdfFile(outPath)) return outPath
    try { await fs.remove(outPath) } catch {}
  }
  const urlLower = (item.url || '').toLowerCase()
  const looksZip = /\.zip($|\?)/i.test(urlLower)
  const looksPdf = /\.pdf($|\?)/i.test(urlLower)
  try {
    if (!looksZip && looksPdf) {
      const res = await fetch(item.url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const ab = await res.arrayBuffer()
      const data = Buffer.from(ab)
      const head = data.slice(0, 5).toString('ascii')
      const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
      if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) return null
      await fs.writeFile(outPath, data)
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
        const head = data.slice(0, 5).toString('ascii')
        const tail = data.slice(Math.max(0, data.length - 16)).toString('ascii')
        if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) {
          await fs.remove(zipTmp)
          return null
        }
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
      const data = await fs.readFile(outPath)
      const head = data.slice(0, 5).toString('ascii')
      const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
      if (!head.startsWith('%PDF-') || !/%%EOF/.test(tail)) { await fs.remove(zipTmp); await fs.remove(tmpSrc); await fs.remove(produced); await fs.remove(outPath); return null }
      await fs.remove(zipTmp)
      await fs.remove(tmpSrc)
      await fs.remove(produced)
      return outPath
    }
    return null
  } catch {
    return null
  }
}

async function validatePdfFile(absPath: string): Promise<boolean> {
  try {
    const data = await fs.readFile(absPath)
    if (data.length < 8) return false
    const head = data.slice(0, 5).toString('ascii')
    const tail = data.slice(Math.max(0, data.length - 32)).toString('ascii')
    return head.startsWith('%PDF-') && /%%EOF/.test(tail)
  } catch { return false }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Srbija', 'PDF')
  await fs.ensureDir(DATA_DIR)
  await fs.ensureDir(PDF_DIR)

  const argv = process.argv.slice(2)
  const getArg = (name: string) => { const pref = `--${name}=`; const hit = argv.find((a) => a.startsWith(pref)); return hit ? hit.slice(pref.length) : undefined }
  const xlsxPath = getArg('xlsx') || path.join(ROOT, '..', '..', 'zakoni_srbija.xlsx')
  const limitArg = getArg('limit')
  const LIMIT = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 3
  const metaOnlyArg = getArg('metaOnly')
  const META_ONLY = metaOnlyArg ? /^(1|true|yes)$/i.test(metaOnlyArg) : false
  const titleContainsArg = getArg('titleContains')
  const titleContainsNorm = titleContainsArg ? normalizeTitle(titleContainsArg) : null
  const repairInvalidArg = getArg('repairInvalid')
  const REPAIR_INVALID = repairInvalidArg ? /^(1|true|yes)$/i.test(repairInvalidArg) : false
  const idsArg = getArg('ids')
  const IDS = idsArg ? idsArg.split(',').map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n)) : null

  const wb = REPAIR_INVALID ? null : xlsx.readFile(xlsxPath)
  const sheetName = REPAIR_INVALID ? null : wb!.SheetNames[0]
  const sheet = REPAIR_INVALID ? null : wb!.Sheets[sheetName!]
  const rows = REPAIR_INVALID ? [] : xlsx.utils.sheet_to_json<any>(sheet!, { defval: '' })

  const picked: LawItem[] = []
  if (!REPAIR_INVALID) {
    for (const row of rows) {
      const title = findTitleField(row) || ''
      const url = findUrlField(row) || ''
      if (!title || !url) continue
      if (titleContainsNorm) {
        const tNorm = normalizeTitle(title)
        if (!tNorm.includes(titleContainsNorm)) continue
      }
      const pub = findPublishedField(row) || ''
      const meta = pub ? parseGazetteInfo(pub) : { gazetteNumber: null, gazetteKey: null, gazetteDate: null }
      const dfield = (row as any)['Datum'] || (row as any)['date'] || (row as any)['DATUM'] || null
      const gazetteDate = dfield != null ? toIsoDate(dfield) : null
      picked.push({ title, url, gazetteText: pub || null, gazetteNumber: meta.gazetteNumber || null, gazetteKey: meta.gazetteKey || null, gazetteDate })
      if (picked.length >= LIMIT) break
    }
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
  if (REPAIR_INVALID) {
    const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
    const sqlBase = `SELECT id, title, source_url, url_pdf, path_pdf, gazette_key FROM laws WHERE jurisdiction = 'SRB'`
    const laws = IDS && IDS.length
      ? await all<{ id: number; title: string; source_url: string | null; url_pdf: string | null; path_pdf: string | null; gazette_key: string | null }>(
          `${sqlBase} AND id IN (${IDS.map(() => '?').join(',')}) ORDER BY id ASC`, IDS as any[]
        )
      : await all<{ id: number; title: string; source_url: string | null; url_pdf: string | null; path_pdf: string | null; gazette_key: string | null }>(
          `${sqlBase} ORDER BY id ASC`
        )
    let repaired = 0, skipped = 0
    for (const law of laws) {
      const hasPath = !!law.path_pdf
      const valid = hasPath && await validatePdfFile(path.isAbsolute(String(law.path_pdf)) ? String(law.path_pdf) : path.join(ROOT, String(law.path_pdf)))
      if (valid) { skipped++; continue }
      const url = law.source_url || law.url_pdf || ''
      if (!url) { skipped++; continue }
      const li: LawItem = { title: law.title, url, gazetteKey: law.gazette_key || undefined, gazetteText: null, gazetteNumber: null, gazetteDate: null }
      const path_pdf = await ensurePdfFromUrl(li, PDF_DIR)
      if (path_pdf) {
        const port = process.env.PORT ? Number(process.env.PORT) : 5000
        const localUrl = `http://localhost:${port}/pdf/${law.id}`
        await run('UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime("now") WHERE id = ?', [path_pdf, localUrl, law.id])
        repaired++
      } else {
        skipped++
      }
    }
    console.log(JSON.stringify({ ok: true, repaired, skipped, total: laws.length }, null, 2))
    db.close()
    return
  }
  for (const it of picked) {
    const jurisdiction = 'SRB'
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
