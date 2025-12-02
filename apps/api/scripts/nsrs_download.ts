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
  // Pravilo: izdvoji sve grupe cifara.
  // - Ako postoji samo JEDNA grupa i ima ≥3 cifre (npr. 512, 11016, 9225), razdvoji na 'prefix' + '_' + zadnje 2 cifre.
  //   Primjeri: 512 -> 5_12, 11016 -> 110_16, 9225 -> 92_25.
  // - Ako postoji više grupa (npr. 5/12, 110/16), spoji ih sa '_': 5_12, 110_16.
  const groups = input.match(/\d+/g) || []
  if (groups.length === 1) {
    const s = groups[0]
    if (s.length >= 3) return `${s.slice(0, s.length - 2)}_${s.slice(-2)}`
    return s
  }
  return groups.join('_')
}

async function nextNemAsgIndex(dir: string): Promise<number> {
  try {
    const files = await fs.readdir(dir)
    let max = 0
    for (const name of files) {
      const m = name.match(/-NEMASG(\d+)\.zip$/i)
      if (m) {
        const n = parseInt(m[1], 10)
        if (!Number.isNaN(n) && n > max) max = n
      }
    }
    return max + 1
  } catch {
    return 1
  }
}

async function fetchText(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'RegulativaBot/1.0' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

async function ensureUniquePath(dir: string, baseName: string): Promise<{ name: string; path: string; suffix?: string }> {
  const ext = path.extname(baseName)
  const stem = baseName.slice(0, ext.length ? baseName.length - ext.length : baseName.length)
  let idx = 1
  while (true) {
    const name = `${stem}_DUP${idx}${ext}`
    const candidate = path.join(dir, name)
    const exists = await fs.pathExists(candidate)
    if (!exists) return { name, path: candidate, suffix: `_DUP${idx}` }
    idx++
  }
}

type RowItem = {
  naziv: string
  glasnik: string
  zipUrl: string
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
    // detail link from naziv cell
    let detailUrl: string | undefined
    const aNaziv = $(tds.get(nazivIdx)).find('a').first()
    const hrefNaziv = aNaziv.attr('href') || ''
    if (hrefNaziv) detailUrl = hrefNaziv.startsWith('http') ? hrefNaziv : `${BASE}${hrefNaziv}`
    // zip link in row (if present)
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

async function downloadTo(url: string, filePath: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.writeFile(filePath, buf)
}

async function main() {
  const root = path.resolve(process.cwd(), '..', '..')
  const destDir = path.join(root, 'Dokumenti', 'RepublikaSrpska', 'ZIP')
  await fs.ensureDir(destDir)
  let nemCounter = await nextNemAsgIndex(destDir)
  const logPath = path.join(destDir, 'log.json')
  const failedLogPath = path.join(destDir, 'log_failed.json')
  let existingLog: any[] = []
  let existingFailed: any[] = []
  try {
    existingLog = await fs.readJson(logPath)
    if (!Array.isArray(existingLog)) existingLog = []
  } catch {}
  try {
    existingFailed = await fs.readJson(failedLogPath)
    if (!Array.isArray(existingFailed)) existingFailed = []
  } catch {}

  const limit = Number(process.env.LIMIT || 3)
  const startPage = Number(process.env.START || 0)
  const endPage = Number(process.env.END || 0)

  const samples: { name: string; url: string; path: string; page: number; glasnikPart: string }[] = []
  const successes: { name: string; url: string; path: string; page: number; glasnikPart: string }[] = []
  let duplicatesResolved = 0
  const failedNoZip: { naziv: string; page: number; detailUrl?: string }[] = []
  const failedDownloads: { naziv: string; page: number; glasnikPart: string; url: string; reason: string }[] = []
  for (let p = startPage; p <= endPage; p++) {
    const html = await fetchText(LIST_URL(p))
    const rows = parseRows(html)
    for (const r of rows) {
      let zipUrl = r.zipUrl
      if (!zipUrl && r.detailUrl) {
        // fetch detail page and find zip
        try {
          const detailHtml = await fetchText(r.detailUrl)
          const $d = cheerio.load(detailHtml)
          const aZip = $d('a').filter((_i, a) => String($d(a).attr('href') || '').toLowerCase().endsWith('.zip')).first()
          const href = aZip.attr('href') || ''
          if (href) zipUrl = href.startsWith('http') ? href : `${BASE}${href}`
        } catch {}
      }
      if (!zipUrl) {
        failedNoZip.push({ naziv: r.naziv, page: p, detailUrl: r.detailUrl })
        continue
      }
      const gfmt = formatGlasnik(r.glasnik)
      const glasnikPart = gfmt || `NEMASG${nemCounter++}`
      const fileName = `${r.naziv}-${glasnikPart}.zip`
      const filePath = path.join(destDir, fileName)
      samples.push({ name: fileName, url: zipUrl, path: filePath, page: p, glasnikPart })
      if (samples.length >= limit) break
    }
    if (samples.length >= limit) break
  }

  // download samples
  for (const s of samples) {
    let finalName = s.name
    let finalPath = s.path
    try {
      const exists = await fs.pathExists(finalPath)
      if (exists) {
        const uniq = await ensureUniquePath(destDir, s.name)
        finalName = uniq.name
        finalPath = uniq.path
        duplicatesResolved++
      }
      await downloadTo(s.url, finalPath)
      successes.push({ name: finalName, url: s.url, path: finalPath, page: s.page, glasnikPart: s.glasnikPart })
    } catch (e: any) {
      failedDownloads.push({ naziv: s.name.replace(/-.*$/, ''), page: s.page, glasnikPart: s.glasnikPart, url: s.url, reason: String(e) })
    }
  }

  const newLog = existingLog.concat(
    successes.map((s) => ({ name: s.name, url: s.url, path: s.path, page: s.page, glasnik: s.glasnikPart }))
  )
  await fs.writeJson(logPath, newLog, { spaces: 2 })

  const newFailed = existingFailed.concat(
    failedNoZip.map((f) => ({ status: 'nozip', naziv: f.naziv, page: f.page, detailUrl: f.detailUrl })),
    failedDownloads.map((f) => ({ status: 'error', naziv: f.naziv, page: f.page, glasnik: f.glasnikPart, url: f.url, reason: f.reason }))
  )
  await fs.writeJson(failedLogPath, newFailed, { spaces: 2 })

  console.log(
    JSON.stringify(
      {
        attemptedCount: samples.length,
        okCount: successes.length,
        duplicatesResolved,
        failedNoZipCount: failedNoZip.length,
        failedDownloadCount: failedDownloads.length,
        logPath,
        failedLogPath,
        failedNoZipPreview: failedNoZip.slice(0, 5).map((f) => f.naziv),
        failedDownloadPreview: failedDownloads.slice(0, 5).map((f) => f.naziv),
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})