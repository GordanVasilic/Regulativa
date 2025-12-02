import path from 'node:path'
import fs from 'fs-extra'
import * as cheerio from 'cheerio'

const BASE = 'https://www.narodnaskupstinars.net'
const LIST_URL = (page: number) => `${BASE}/?q=la/akti/usvojeni-zakoni&page=${page}`

function stripDiacritics(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeTitle(input: string) {
  return stripDiacritics(input)
    .replace(/[čćžšđČĆŽŠĐ]/g, (ch) => ({ č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }[ch] || ch))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeFilename(input: string) {
  const illegal = /[<>:"/\\|?*]/g
  const cleaned = input.replace(illegal, '').replace(/\s+/g, ' ').trim()
  return cleaned
}

type MissingItem = {
  title: string
  title_normalized: string
  gazette_text?: string | null
  gazette_number?: string | null
  gazette_key?: string | null
}

type NsrsMeta = {
  title: string
  title_normalized: string
  gazette_key?: string | null
  gazette_number?: string | null
  source_url?: string | null
  page?: number
}

async function loadMissingFromSgTxt() {
  const ROOT = path.resolve(process.cwd())
  const dumpsDir = path.join(ROOT, 'dumps')
  const reportPath = path.join(dumpsDir, 'missing_rs_from_sgtxt.json')
  if (!(await fs.pathExists(reportPath))) {
    throw new Error(`Nije pronađen izvještaj: ${reportPath}. Prvo pokreni: npm run compare:sgtxt`)
  }
  const report = await fs.readJson(reportPath)
  const arr: MissingItem[] = report.missing || []
  return arr.map((x) => ({
    title: x.title,
    title_normalized: normalizeTitle(x.title_normalized || x.title || ''),
    gazette_text: x.gazette_text || null,
    gazette_number: x.gazette_number || null,
    gazette_key: x.gazette_key || null,
  }))
}

async function loadNsrsMeta() {
  const ROOT = path.resolve(process.cwd())
  const dataDir = path.join(ROOT, 'data')
  const metaPath = path.join(dataDir, 'nsrs_rs_meta.json')
  if (!(await fs.pathExists(metaPath))) {
    throw new Error(`Nije pronađen NSRS meta fajl: ${metaPath}. Dostupne stranice: 0–61, prvo ih treba scrapovati.`)
  }
  const meta: NsrsMeta[] = await fs.readJson(metaPath)
  return meta
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} za ${url}`)
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
    let zipUrl: string | undefined
    $(tr)
      .find('a')
      .each((_j, a) => {
        const href = $(a).attr('href') || ''
        if (href.toLowerCase().endsWith('.zip')) {
          zipUrl = href.startsWith('http') ? href : `${BASE}${href}`
        }
      })
    if (naziv) {
      rows.push({ naziv, glasnik, detailUrl, zipUrl })
    }
  })

  return rows
}

async function hasZipOnDetail(detailUrl: string): Promise<boolean> {
  try {
    const html = await fetchText(detailUrl)
    const $ = cheerio.load(html)
    const aZip = $('a').filter((_i, a) => String($(a).attr('href') || '').toLowerCase().endsWith('.zip')).first()
    const href = aZip.attr('href') || ''
    return !!href
  } catch {
    return false
  }
}

async function hasZipOnList(page: number | undefined, detailUrl: string): Promise<boolean> {
  if (typeof page !== 'number') return false
  try {
    const html = await fetchText(LIST_URL(page))
    const rows = parseRows(html)
    const row = rows.find((r) => r.detailUrl === detailUrl)
    return !!(row && row.zipUrl)
  } catch {
    return false
  }
}

async function main() {
  const missing = await loadMissingFromSgTxt()
  const nsrs = await loadNsrsMeta()

  const nsrsByGazKey = new Map<string, NsrsMeta[]>()
  const nsrsByGazNum = new Map<string, NsrsMeta[]>()
  const nsrsTitleSet = new Map<string, NsrsMeta>()

  for (const m of nsrs) {
    const key = (m.gazette_key || '').trim()
    const num = (m.gazette_number || '').trim()
    if (key) {
      if (!nsrsByGazKey.has(key)) nsrsByGazKey.set(key, [])
      nsrsByGazKey.get(key)!.push(m)
    }
    if (num) {
      if (!nsrsByGazNum.has(num)) nsrsByGazNum.set(num, [])
      nsrsByGazNum.get(num)!.push(m)
    }
    const tnorm = normalizeTitle(m.title_normalized || m.title)
    if (tnorm && !nsrsTitleSet.has(tnorm)) nsrsTitleSet.set(tnorm, m)
  }

  const found: Array<{ missing: MissingItem; matched_by: 'gazette_key' | 'gazette_number' | 'title'; nsrs_item?: NsrsMeta }> = []
  for (const it of missing) {
    const key = (it.gazette_key || '').trim()
    const num = (it.gazette_number || '').trim()
    const tnorm = normalizeTitle(it.title_normalized || it.title)

    if (key && nsrsByGazKey.has(key)) {
      const target = nsrsByGazKey.get(key)![0]
      found.push({ missing: it, matched_by: 'gazette_key', nsrs_item: target })
      continue
    }
    if (num && nsrsByGazNum.has(num)) {
      const target = nsrsByGazNum.get(num)![0]
      found.push({ missing: it, matched_by: 'gazette_number', nsrs_item: target })
      continue
    }
    if (tnorm && nsrsTitleSet.has(tnorm)) {
      const target = nsrsTitleSet.get(tnorm)
      found.push({ missing: it, matched_by: 'title', nsrs_item: target })
      continue
    }
  }

  // Count PREUZMI availability
  let withPreuzmi = 0
  const examplesWith: Array<{ title: string; nsrs_url: string | null }> = []
  const examplesWithout: Array<{ title: string; nsrs_url: string | null }> = []

  for (const f of found) {
    const url = f.nsrs_item?.source_url || ''
    const page = f.nsrs_item?.page
    if (!url) {
      examplesWithout.push({ title: f.missing.title, nsrs_url: null })
      continue
    }
    const okDetail = await hasZipOnDetail(url)
    let ok = okDetail
    if (!ok) {
      const okList = await hasZipOnList(page, url)
      ok = okList
    }
    if (ok) {
      withPreuzmi++
      if (examplesWith.length < 10) examplesWith.push({ title: f.missing.title, nsrs_url: url })
    } else {
      if (examplesWithout.length < 10) examplesWithout.push({ title: f.missing.title, nsrs_url: url })
    }
  }

  const ROOT = path.resolve(process.cwd())
  const dumpsDir = path.join(ROOT, 'dumps')
  await fs.ensureDir(dumpsDir)

  const report = {
    input_found_total: found.length,
    with_preuzmi: withPreuzmi,
    without_preuzmi: found.length - withPreuzmi,
    examples_with_preuzmi: examplesWith,
    examples_without_preuzmi: examplesWithout,
  }

  const outPath = path.join(dumpsDir, 'preuzmi_count_for_sgtxt_vs_nsrs.json')
  await fs.writeJson(outPath, report, { spaces: 2 })
  console.log(`Izvještaj sačuvan u: ${outPath}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})