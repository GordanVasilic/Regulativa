import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import * as cheerio from 'cheerio'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const DUMPS_DIR = path.join(ROOT, '..', '..', 'dumps')
const RS_PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')
const MISSING_JSON = path.join(DUMPS_DIR, 'missing_pdfs_rs.json')
const NSRS_META_JSON = path.join(DATA_DIR, 'nsrs_rs_meta.json')

type MissingItem = { file: string; path: string }
type MissingReport = {
  jurisdiction: string
  pdf_dir: string
  totals: { total_pdfs_non_recursive: number; total_laws_with_pdf: number; missing_count: number }
  missing: MissingItem[]
}

const BASE = 'https://www.narodnaskupstinars.net'
const LIST_URL = (page: number) => `${BASE}/?q=la/akti/usvojeni-zakoni&page=${page}`

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normTitle(input: string): string {
  return stripDiacritics(input).replace(/\s+/g, ' ').trim().toLowerCase()
}

function sanitizeFilename(input: string) {
  const illegal = /[<>:"/\\|?*]/g
  const cleaned = input.replace(illegal, '').replace(/\s+/g, ' ').trim()
  return cleaned
}

function formatGlasnik(input: string) {
  const groups = input.match(/\d+/g) || []
  if (groups.length === 1) {
    const s = groups[0]
    if (s.length >= 3) return `${s.slice(0, s.length - 2)}_${s.slice(-2)}`
    return s
  }
  return groups.join('_')
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function parseRows(html: string): { naziv: string; glasnik: string; detailUrl?: string }[] {
  const $ = cheerio.load(html)
  const rows: { naziv: string; glasnik: string; detailUrl?: string }[] = []
  const table = $('table')
  let nazivIdx = -1
  let glasnikIdx = -1

  table.find('thead th').each((i, th) => {
    const t = $(th).text().trim().toUpperCase()
    if (t.includes('NAZIV')) nazivIdx = i
    if (t.includes('GLASNIK')) glasnikIdx = i
  })

  table.find('tbody tr').each((_i, tr) => {
    const tds = $(tr).find('td')
    const naziv = sanitizeFilename($(tds.get(nazivIdx)).text())
    const glasnik = $(tds.get(glasnikIdx)).text().trim()
    let detailUrl: string | undefined
    const aNaziv = $(tds.get(nazivIdx)).find('a').first()
    const hrefNaziv = aNaziv.attr('href') || ''
    if (hrefNaziv) detailUrl = hrefNaziv.startsWith('http') ? hrefNaziv : `${BASE}${hrefNaziv}`
    rows.push({ naziv, glasnik, detailUrl })
  })

  return rows
}

function parseFromFilename(file: string) {
  const base = path.basename(file, '.pdf')
  const m = base.match(/^(.*?)-([0-9]{1,3}_[0-9]{2})$/)
  const title = m ? m[1] : base
  const gazette_key = m ? m[2] : null
  const gazette_number = gazette_key ? gazette_key.split('_')[0] : null
  const gazette_year = gazette_key ? gazette_key.split('_')[1] : null
  return { title, gazette_key, gazette_number, gazette_year }
}

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, '/').toLowerCase()
}

async function readMissingStrict(): Promise<MissingItem[]> {
  const exists = await fs.pathExists(MISSING_JSON)
  if (!exists) throw new Error(`Nedostaje fajl: ${MISSING_JSON}`)
  try {
    const obj = await fs.readJSON(MISSING_JSON)
    if (Array.isArray(obj.missing)) return obj.missing
  } catch {}
  let raw = await fs.readFile(MISSING_JSON, 'utf8')
  // Remove BOM and any leading garbage before first '{'
  raw = raw.replace(/^\uFEFF/, '')
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const jsonText = raw.slice(firstBrace, lastBrace + 1)
    try {
      const obj = JSON.parse(jsonText) as MissingReport
      if (Array.isArray(obj.missing)) return obj.missing
    } catch {}
  }
  const cleaned = raw
  const mArr = cleaned.match(/"missing"\s*:\s*\[(.|\n|\r)*?\]/)
  if (mArr) {
    const txt = mArr[0]
    const arrTxt = txt.slice(txt.indexOf('['), txt.lastIndexOf(']') + 1)
    try {
      const arr = JSON.parse(arrTxt)
      return arr
    } catch {}
  }
  // Fallback: extract paths via regex
  const paths: string[] = []
  const re = /"path"\s*:\s*"([^"]+)"/g
  let mm: RegExpExecArray | null
  while ((mm = re.exec(cleaned))) {
    paths.push(mm[1])
  }
  return paths.map((p) => ({ file: path.basename(p), path: p }))
}

async function ensureNsrsMeta() {
  const exists = await fs.pathExists(NSRS_META_JSON)
  if (exists) return
  const items: any[] = []
  for (let p = 0; p <= 61; p++) {
    const html = await fetchText(LIST_URL(p))
    const rows = parseRows(html)
    for (const r of rows) {
      const gazette_key = formatGlasnik(r.glasnik)
      const gazette_number = gazette_key.includes('_') ? gazette_key.replace('_', '/') : null
      items.push({
        title: r.naziv,
        title_normalized: normTitle(r.naziv),
        gazette_text: r.glasnik,
        gazette_key,
        gazette_number,
        source_url: r.detailUrl || null,
      })
    }
    console.log(`Scrape meta page ${p}: rows=${rows.length}`)
  }
  await fs.ensureDir(DATA_DIR)
  await fs.writeJson(NSRS_META_JSON, items, { spaces: 2 })
}

function parseSrDate(input: string): string | null {
  const s = input.trim().toLowerCase()
  const m = s.match(/(\d{1,2})\.?\s*(januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar|novembar|decembar)\s*(\d{4})/)
  if (!m) return null
  const day = String(m[1]).padStart(2, '0')
  const months: Record<string, string> = {
    januar: '01', februar: '02', mart: '03', april: '04', maj: '05', jun: '06', jul: '07', avgust: '08', septembar: '09', oktobar: '10', novembar: '11', decembar: '12'
  }
  const month = months[m[2]]
  const year = m[3]
  return `${year}-${month}-${day}`
}

async function fetchDetailDate(detailUrl?: string | null): Promise<string | null> {
  if (!detailUrl) return null
  try {
    const html = await fetchText(detailUrl)
    const $ = cheerio.load(html)
    // Look for label "Datum:" then read text content
    const label = $('table').find('td').filter((_i, td) => $(td).text().trim().toUpperCase().startsWith('DATUM'))
    let dateText = ''
    if (label.length) {
      const next = label.next('td')
      dateText = (next.text() || '').trim()
    } else {
      // fallback: find any text containing 'Datum:'
      const any = $('body').text()
      const mm = any.match(/Datum\s*:\s*([^\n]+)/i)
      if (mm) dateText = mm[1]
    }
    const iso = parseSrDate(dateText)
    return iso
  } catch {
    return null
  }
}

async function main() {
  const missing = await readMissingStrict()
  console.log(`Read missing from JSON: ${missing.length} items`)
  // Build set of the 156 paths
  const missingSet = new Set(missing.map((m) => normalizePath(m.path)))
  console.log(`Normalized missing set size: ${missingSet.size}`)

  // Koristi tačno listu iz JSON-a (156), bez dodatnog presjeka
  const effectiveMissing = Array.from(missingSet)

  // Load or scrape NSRS meta
  await ensureNsrsMeta()
  const meta: Array<{ title: string; title_normalized: string; gazette_key: string; source_url: string | null }> = await fs.readJSON(NSRS_META_JSON)

  const proposed: any[] = []
  for (const p of effectiveMissing) {
    const file = path.basename(p)
    const { title, gazette_key, gazette_number } = parseFromFilename(file)
    let source_url: string | null = null
    let gazette_date: string | null = null
    if (gazette_key) {
      const candidates = meta.filter((m) => m.gazette_key === gazette_key)
      if (candidates.length) {
        // try match by title if possible
        const byTitle = candidates.find((m) => normTitle(m.title) === normTitle(title)) || candidates[0]
        source_url = byTitle.source_url || null
        gazette_date = await fetchDetailDate(source_url)
      }
      // fallback to DB for date
      if (!gazette_date) {
        const row = await new Promise<{ gazette_date: string | null } | undefined>((resolve, reject) =>
          db.get('SELECT gazette_date FROM laws WHERE jurisdiction = ? AND gazette_key = ? AND gazette_date IS NOT NULL LIMIT 1', ['RS', gazette_key], (err, row) => (err ? reject(err) : resolve(row as any)))
        )
        gazette_date = (row?.gazette_date as string) || null
      }
    }

    proposed.push({
      jurisdiction: 'RS',
      title,
      title_normalized: normTitle(title),
      slug: null,
      doc_type: null,
      gazette_key,
      gazette_number,
      gazette_date,
      source_url,
      url_pdf: null,
      path_pdf: p,
    })
  }

  const outPath = path.join(DUMPS_DIR, 'missing_rs_insert_final_preview.json')
  await fs.writeJSON(outPath, { count: proposed.length, items: proposed }, { spaces: 2 })
  console.log(`Final preview spreman: ${proposed.length} unosa -> ${outPath}`)
  // nema rada sa DB ovdje, sve je iz JSON + scrape
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})