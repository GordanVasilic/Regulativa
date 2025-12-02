import path from 'node:path'
import fs from 'fs-extra'
import * as cheerio from 'cheerio'
import sqlite3 from 'sqlite3'

// Target ERP URL provided by user
const ERP_URL = 'https://erp.slglasnik.org/erp?namjenjeno_za=RS&vrsta_propisa=10'

function stripDiacritics(input: string) {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeTitle(input: string) {
  return stripDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim()
}

function formatGazetteKey(input: string) {
  const groups = input.match(/\d+/g) || []
  if (groups.length === 1) {
    const s = groups[0]
    if (s.length >= 3) return `${s.slice(0, s.length - 2)}_${s.slice(-2)}`
    return s
  }
  return groups.join('_')
}

function extractGazetteNumber(input: string) {
  const m = input.match(/(\d{1,3})\s*\/\s*(\d{2})/)
  if (m) return `${m[1]}/${m[2]}`
  const key = formatGazetteKey(input)
  if (key.includes('_')) return key.replace('_', '/')
  return null
}

async function fetchHtml(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

type ErpItem = {
  title: string
  title_normalized: string
  gazette_text: string
  gazette_number: string | null
  gazette_key: string | null
}

function parseErp(html: string): ErpItem[] {
  const $ = cheerio.load(html)

  // Try to find a table with headers including Naziv and Glasnik (variations in Latin/Cyrillic)
  const items: ErpItem[] = []
  $('table').each((_ti, table) => {
    let nazivIdx = -1
    let glasnikIdx = -1
    $(table).find('thead th').each((i, th) => {
      const t = $(th).text().trim().toLowerCase()
      if (t.includes('naziv')) nazivIdx = i
      if (t.includes('glasnik') || t.includes('služben') || t.includes('службен')) glasnikIdx = i
    })
    if (nazivIdx === -1 || glasnikIdx === -1) return

    $(table).find('tbody tr').each((_ri, tr) => {
      const tds = $(tr).find('td')
      const rawTitle = $(tds.get(nazivIdx)).text().replace(/\s+/g, ' ').trim()
      const gazetteText = $(tds.get(glasnikIdx)).text().replace(/\s+/g, ' ').trim()
      if (!rawTitle) return
      const gazNum = extractGazetteNumber(gazetteText)
      const gazKey = gazetteText ? formatGazetteKey(gazetteText) : null
      items.push({
        title: rawTitle,
        title_normalized: normalizeTitle(rawTitle),
        gazette_text: gazetteText,
        gazette_number: gazNum,
        gazette_key: gazKey
      })
    })
  })

  // Fallback: try card/list elements if table not found
  if (items.length === 0) {
    $('.views-row, .list-group-item, .card').each((_i, el) => {
      const title = $(el).find('h3, .title, .node-title').first().text().replace(/\s+/g, ' ').trim()
      const gazTxtCandidates = [
        $(el).find('.field--name-field-broj-sluzbenog-glasnika').text(),
        $(el).find('.field--name-field-sluzbeni-glasnik').text(),
        $(el).find('.gazette, .glasnik').text()
      ]
      const gazetteText = gazTxtCandidates.map((t) => (t || '').replace(/\s+/g, ' ').trim()).find((t) => t.length > 0) || ''
      if (!title) return
      const gazNum = extractGazetteNumber(gazetteText)
      const gazKey = gazetteText ? formatGazetteKey(gazetteText) : null
      items.push({
        title,
        title_normalized: normalizeTitle(title),
        gazette_text: gazetteText,
        gazette_number: gazNum,
        gazette_key: gazKey
      })
    })
  }

  return items
}

async function loadDbLaws() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

  const rows = await all<{ id: number; title: string; title_normalized: string | null; gazette_number: string | null; gazette_key: string | null }>(
    "SELECT id, title, title_normalized, gazette_number, gazette_key FROM laws WHERE jurisdiction='RS'"
  )
  db.close()
  const normTitles = new Set(rows.map((r) => normalizeTitle(r.title_normalized || r.title)))
  const gazetteNumbers = new Set(rows.map((r) => (r.gazette_number || (r.gazette_key ? r.gazette_key.replace('_', '/') : null))).filter(Boolean) as string[])
  const gazetteKeys = new Set(rows.map((r) => r.gazette_key).filter(Boolean) as string[])
  return { rows, normTitles, gazetteNumbers, gazetteKeys }
}

async function main() {
  const root = path.resolve(process.cwd())
  const dumpsDir = path.join(root, 'dumps')
  await fs.ensureDir(dumpsDir)

  let html: string
  try {
    html = await fetchHtml(ERP_URL)
  } catch (e) {
    console.error('Greška pri preuzimanju ERP stranice:', e)
    html = ''
  }

  const erpItems = html ? parseErp(html) : []
  const { normTitles, gazetteNumbers, gazetteKeys } = await loadDbLaws()

  const missing: ErpItem[] = []
  let matchedByGazette = 0
  let matchedByTitle = 0

  for (const it of erpItems) {
    const hasGazNum = it.gazette_number ? gazetteNumbers.has(it.gazette_number) : false
    const hasGazKey = it.gazette_key ? gazetteKeys.has(it.gazette_key) : false
    const hasTitle = normTitles.has(it.title_normalized)
    if (hasGazNum || hasGazKey) {
      matchedByGazette++
      continue
    }
    if (hasTitle) {
      matchedByTitle++
      continue
    }
    missing.push(it)
  }

  const report = {
    source_url: ERP_URL,
    total_erp: erpItems.length,
    matched_by_gazette: matchedByGazette,
    matched_by_title: matchedByTitle,
    missing_count: missing.length,
    missing
  }

  const outJson = path.join(dumpsDir, 'missing_rs_from_erp.json')
  await fs.writeJson(outJson, report, { spaces: 2 })
  console.log(`Izvještaj sačuvan u: ${outJson}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})