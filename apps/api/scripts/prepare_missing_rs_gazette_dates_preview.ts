import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import * as cheerio from 'cheerio'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const META_PATH = path.join(DATA_DIR, 'nsrs_rs_meta.json')
const DUMPS_DIR = path.join(ROOT, '..', '..', 'dumps')
const OUT_PATH = path.join(DUMPS_DIR, 'rs_gazette_dates_preview.json')

type LawRow = {
  id: number
  title: string
  title_normalized?: string | null
  gazette_key?: string | null
  gazette_number?: string | null
  gazette_date?: string | null
}

type MetaRow = {
  title: string
  title_normalized: string
  gazette_key: string
  gazette_number?: string | null
  source_url?: string | null
  page?: number
}

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normTitle(input: string) {
  return stripDiacritics(input).replace(/\s+/g, ' ').trim().toLowerCase()
}
function gazetteNumberFromKey(key?: string | null) {
  if (!key) return null
  const m = key.match(/^(\d{1,3})_(\d{2})$/)
  if (m) return `${m[1]}/${m[2]}`
  return null
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function parseSrDateToISO(input: string): string | null {
  const s = input.trim().toLowerCase()
  const mDot = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (mDot) {
    const day = String(mDot[1]).padStart(2, '0')
    const month = String(mDot[2]).padStart(2, '0')
    const year = mDot[3]
    return `${year}-${month}-${day}`
  }
  const mWord = s.match(/(\d{1,2})\.?\s*(januar|februar|mart|april|maj|jun|jul|avgust|septembar|oktobar|novembar|decembar)\s*(\d{4})/)
  if (mWord) {
    const day = String(mWord[1]).padStart(2, '0')
    const months: Record<string, string> = {
      januar: '01', februar: '02', mart: '03', april: '04', maj: '05', jun: '06', jul: '07', avgust: '08', septembar: '09', oktobar: '10', novembar: '11', decembar: '12'
    }
    const month = months[mWord[2]]
    const year = mWord[3]
    return `${year}-${month}-${day}`
  }
  return null
}

async function fetchDetailDate(detailUrl?: string | null): Promise<string | null> {
  if (!detailUrl) return null
  try {
    const html = await fetchText(detailUrl)
    const $ = cheerio.load(html)
    const any = $('body').text().replace(/\s+/g, ' ').trim()
    const m = any.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    if (m) return parseSrDateToISO(m[0])
    const label = $('table').find('td').filter((_i, td) => $(td).text().trim().toUpperCase().startsWith('DATUM'))
    if (label.length) {
      const next = label.next('td')
      const txt = (next.text() || '').trim()
      const parsed = parseSrDateToISO(txt)
      if (parsed) return parsed
    }
    return null
  } catch {
    return null
  }
}

async function main() {
  await fs.ensureDir(DUMPS_DIR)
  const metaExists = await fs.pathExists(META_PATH)
  if (!metaExists) {
    console.error('Nedostaje meta fajl:', META_PATH, '\nPrvo pokreni: node --import tsx scripts/nsrs_scrape_meta.ts')
    process.exit(1)
  }
  const meta: MetaRow[] = await fs.readJson(META_PATH)
  const byKey: Record<string, MetaRow[]> = {}
  for (const m of meta) {
    const key = (m.gazette_key || '').trim()
    if (!key) continue
    if (!byKey[key]) byKey[key] = []
    byKey[key].push(m)
  }

  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

  const missing = await all<LawRow>(
    `SELECT id, title, title_normalized, gazette_key, gazette_number, gazette_date
     FROM laws
     WHERE jurisdiction = 'RS' AND COALESCE(gazette_key,'') <> '' AND (gazette_date IS NULL OR gazette_date = '')
     ORDER BY id ASC`
  )

  const proposals: Array<{ id: number; title: string; gazette_key: string | null; gazette_number: string | null; current_date: string | null; proposed_date: string | null; source_url: string | null }> = []

  for (const law of missing) {
    const key = (law.gazette_key || '').trim()
    const candidates = key ? (byKey[key] || []) : []
    let source_url: string | null = null
    let proposed_date: string | null = null
    if (candidates.length) {
      const lawNorm = normTitle(law.title)
      const byTitle = candidates.find((m) => normTitle(m.title) === lawNorm) || candidates[0]
      source_url = byTitle.source_url || null
      proposed_date = await fetchDetailDate(source_url)
    }
    proposals.push({
      id: law.id,
      title: law.title,
      gazette_key: law.gazette_key || null,
      gazette_number: law.gazette_number || gazetteNumberFromKey(law.gazette_key) || null,
      current_date: law.gazette_date || null,
      proposed_date,
      source_url
    })
  }

  await fs.writeJson(OUT_PATH, { count: proposals.length, items: proposals }, { spaces: 2 })
  db.close()
  console.log(`Gotovo. Sačuvan preview: ${OUT_PATH} (items=${proposals.length})`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})