import path from 'node:path'
import fs from 'fs-extra'
import * as cheerio from 'cheerio'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DUMPS_DIR = path.join(ROOT, '..', '..', 'dumps')
const PREVIEW_PATH = path.join(DUMPS_DIR, 'missing_rs_insert_preview.json')
const ENRICHED_PATH = path.join(DUMPS_DIR, 'missing_rs_insert_preview_enriched.json')
const NSRS_META_JSON = path.join(DATA_DIR, 'nsrs_rs_meta.json')

type Proposed = {
  jurisdiction: string
  title: string
  title_normalized: string
  slug: string | null
  doc_type: string | null
  gazette_key: string | null
  gazette_number: string | null
  gazette_date: string | null
  source_url: string | null
  url_pdf: string | null
  path_pdf: string
}

type Meta = {
  title: string
  title_normalized: string
  gazette_key: string
  source_url: string | null
}

function stripDiacritics(input: string): string {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normTitle(input: string): string {
  return stripDiacritics(input).replace(/\s+/g, ' ').trim().toLowerCase()
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function parseSrDate(input: string): string | null {
  const s = input.trim().toLowerCase()
  // Pattern: "18.05.2017"
  const mDot = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
  if (mDot) {
    const day = String(mDot[1]).padStart(2, '0')
    const month = String(mDot[2]).padStart(2, '0')
    const year = mDot[3]
    return `${year}-${month}-${day}`
  }
  // Pattern: "18. maj 2017"
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
    // Prefer explicit dd.mm.yyyy anywhere in body
    const m = any.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/)
    if (m) return parseSrDate(m[0])
    // Fallback: try label-based
    const label = $('table').find('td').filter((_i, td) => $(td).text().trim().toUpperCase().startsWith('DATUM'))
    if (label.length) {
      const next = label.next('td')
      const txt = (next.text() || '').trim()
      const parsed = parseSrDate(txt)
      if (parsed) return parsed
    }
    return null
  } catch {
    return null
  }
}

async function main() {
  const previewObj = await fs.readJSON(PREVIEW_PATH)
  const items: Proposed[] = Array.isArray(previewObj.items) ? previewObj.items : []
  const meta: Meta[] = await fs.readJSON(NSRS_META_JSON)

  const byKey: Record<string, Meta[]> = {}
  for (const m of meta) {
    const key = (m.gazette_key || '').trim()
    if (!key) continue
    if (!byKey[key]) byKey[key] = []
    byKey[key].push(m)
  }

  const enriched: Proposed[] = []
  let filledDates = 0
  for (const it of items) {
    let source_url = it.source_url
    let gazette_date = it.gazette_date
    const key = (it.gazette_key || '').trim()
    if (key && (!source_url || !gazette_date)) {
      const candidates = byKey[key] || []
      if (candidates.length) {
        const byTitle = candidates.find((m) => normTitle(m.title) === normTitle(it.title)) || candidates[0]
        source_url = source_url || byTitle.source_url || null
        if (!gazette_date) {
          gazette_date = await fetchDetailDate(source_url)
          if (gazette_date) filledDates++
        }
      }
    }
    enriched.push({ ...it, source_url, gazette_date })
  }

  await fs.writeJSON(ENRICHED_PATH, { count: enriched.length, filledDates, items: enriched }, { spaces: 2 })
  console.log(`Enriched ${enriched.length} records, filledDates=${filledDates} -> ${ENRICHED_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})