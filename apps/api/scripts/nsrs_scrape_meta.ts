import path from 'node:path'
import fs from 'fs-extra'
import * as cheerio from 'cheerio'

const BASE = 'https://www.narodnaskupstinars.net'
const LIST_URL = (page: number) => `${BASE}/?q=la/akti/usvojeni-zakoni&page=${page}`

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

function extractGazetteNumber(input: string) {
  const m = input.match(/(\d{1,3})\s*\/\s*(\d{2})/)
  if (m) return `${m[1]}/${m[2]}`
  const key = formatGlasnik(input)
  if (key.includes('_')) return key.replace('_', '/')
  return null
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

function parseRows(html: string): { naziv: string; glasnik: string; detailUrl?: string; zipUrl?: string }[] {
  const $ = cheerio.load(html)
  const rows: { naziv: string; glasnik: string; detailUrl?: string; zipUrl?: string }[] = []
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

async function main() {
  const root = path.resolve(process.cwd())
  const dataDir = path.join(root, 'data')
  await fs.ensureDir(dataDir)
  const outPath = path.join(dataDir, 'nsrs_rs_meta.json')

  const startPage = Number(process.env.START ?? 0)
  const endPage = Number(process.env.END ?? 61)

  const items: any[] = []
  for (let p = startPage; p <= endPage; p++) {
    const html = await fetchText(LIST_URL(p))
    const rows = parseRows(html)
    for (const r of rows) {
      const gazette_key = formatGlasnik(r.glasnik)
      const gazette_number = extractGazetteNumber(r.glasnik)
      items.push({
        title: r.naziv,
        title_normalized: r.naziv.toLowerCase(),
        gazette_text: r.glasnik,
        gazette_key,
        gazette_number,
        source_url: r.detailUrl || null,
        page: p
      })
    }
    console.log(`Page ${p}: rows=${rows.length}`)
  }

  await fs.writeJson(outPath, items, { spaces: 2 })
  console.log(`Scrape finished. Saved ${items.length} records to ${outPath}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})