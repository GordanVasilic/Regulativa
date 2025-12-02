import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import puppeteer from 'puppeteer'

const ERP_URL = process.env.ERP_URL || 'https://erp.slglasnik.org/erp?namjenjeno_za=RS&vrsta_propisa=10&status_propisaFilteri=Aktivan'

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

type ErpItem = {
  title: string
  title_normalized: string
  gazette_text: string
  gazette_number: string | null
  gazette_key: string | null
}

async function scrapeErp(): Promise<ErpItem[]> {
  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  await page.goto(ERP_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  // Pokušaj čekanja uz više ciklusa + skrol
  for (let attempt = 0; attempt < 9; attempt++) {
    const hasRows = await page.evaluate(() => {
      const tbls = Array.from(document.querySelectorAll('table'))
      for (const t of tbls) {
        const tbody = t.querySelector('tbody')
        if (tbody && tbody.querySelectorAll('tr').length > 0) return true
      }
      return false
    })
    if (hasRows) break
    // skrol dole i gore da inicira eventualni lazy load
    await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight) })
    await new Promise((r) => setTimeout(r, 5000))
    await page.evaluate(() => { window.scrollTo(0, 0) })
    await new Promise((r) => setTimeout(r, 5000))
  }

  const rowsData: { title: string; gazette_text: string }[] = await page.evaluate(() => {
    const results: { title: string; gazette_text: string }[] = []
    const tables = Array.from(document.querySelectorAll('table'))
    for (const table of tables) {
      const ths = Array.from(table.querySelectorAll('thead th'))
      let nazivIdx = -1
      let glasnikIdx = -1
      ths.forEach((th, i) => {
        const t = (th.textContent || '').trim().toLowerCase()
        if (t.includes('naziv')) nazivIdx = i
        if (t.includes('glasnik') || t.includes('služben') || t.includes('службен')) glasnikIdx = i
      })
      if (nazivIdx === -1 || glasnikIdx === -1) continue
      const rows = Array.from(table.querySelectorAll('tbody tr'))
      for (const tr of rows) {
        const tds = Array.from(tr.querySelectorAll('td'))
        const rawTitle = (tds[nazivIdx]?.textContent || '').replace(/\s+/g, ' ').trim()
        const gazetteText = (tds[glasnikIdx]?.textContent || '').replace(/\s+/g, ' ').trim()
        if (!rawTitle) continue
        results.push({ title: rawTitle, gazette_text: gazetteText })
      }
    }

    // Fallback: kartice/list-item ako tabela nije prisutna
    if (results.length === 0) {
      const cards = Array.from(document.querySelectorAll('.views-row, .list-group-item, .card'))
      for (const el of cards) {
        const h = el.querySelector('h3, .title, .node-title')
        const title = (h?.textContent || '').replace(/\s+/g, ' ').trim()
        const gazTxtCandidates = [
          el.querySelector('.field--name-field-broj-sluzbenog-glasnika'),
          el.querySelector('.field--name-field-sluzbeni-glasnik'),
          el.querySelector('.gazette, .glasnik')
        ]
        const gazetteText = gazTxtCandidates.map((n) => (n?.textContent || '').replace(/\s+/g, ' ').trim()).find((t) => t.length > 0) || ''
        if (!title) continue
        results.push({ title, gazette_text: gazetteText })
      }
    }
    return results
  })

  await browser.close()
  // Obogati podatke van browser konteksta
  const items: ErpItem[] = rowsData.map((r) => ({
    title: r.title,
    title_normalized: normalizeTitle(r.title),
    gazette_text: r.gazette_text,
    gazette_number: extractGazetteNumber(r.gazette_text),
    gazette_key: r.gazette_text ? formatGazetteKey(r.gazette_text) : null
  }))
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
  const ROOT = path.resolve(process.cwd())
  const dumpsDir = path.join(ROOT, 'dumps')
  await fs.ensureDir(dumpsDir)

  const erpItems = await scrapeErp()
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