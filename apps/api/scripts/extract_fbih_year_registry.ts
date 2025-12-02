import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import puppeteer from 'puppeteer'
import * as cheerio from 'cheerio'
import { spawn } from 'node:child_process'

function sanitizeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, '').trim()
}

type RegistryItem = { url: string, title: string, issue?: string, date?: string }

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function collectLawLinksFromRegistry(registryUrl: string): Promise<RegistryItem[]> {
  const browser = await puppeteer.launch({ headless: 'new' })
  try {
    const page = await browser.newPage()
    const resp1 = await page.goto(registryUrl, { waitUntil: 'networkidle0' })
    let html = await page.content()
    let baseUrl = registryUrl
    // Ako je 404 ili sadržaj sadrži 404 poruku, pokušati alternativni slug (npr. hronocoski umjesto hronoloski)
    const is404 = (resp1 && resp1.status() === 404) || /Error\s+404\s*-\s*Not\s*Found/i.test(html)
    if (is404) {
      const altUrl = registryUrl.replace(/hronoloski/gi, 'hronocoski')
      if (altUrl !== registryUrl) {
        const resp2 = await page.goto(altUrl, { waitUntil: 'networkidle0' })
        const html2 = await page.content()
        const ok2 = resp2 && resp2.status() < 400 && !/Error\s+404\s*-\s*Not\s*Found/i.test(html2)
        if (ok2) {
          html = html2
          baseUrl = altUrl
        }
      }
    }
    // Debug: save raw HTML of the registry page to dumps for inspection
    try {
      const dumpsDir = path.join(process.cwd(), 'dumps')
      await fs.ensureDir(dumpsDir)
      const year = yearFromUrl(baseUrl) || yearFromUrl(registryUrl) || 'unknown'
      const out = path.join(dumpsDir, `fbih_registry_raw_${year}.html`)
      await fs.writeFile(out, html, 'utf-8')
    } catch { /* ignore debug write errors */ }
    const $ = cheerio.load(html)

    let $root = $('main, .content-article, .single-article, .region-content, .page-content, .node, .content').first()
    if ($root.length === 0) {
      $root = $('body')
    }
    const headerRegex = /(Službene\s+novine\s+Federacije\s*(?:BiH|Bosne\s+i\s+Hercegovine)|Službenim\s+novinama\s*(?:FBiH|Federacije\s+BiH))/i
    const issueDateRegex = /broj\s*([^\n\r\/]+\/[0-9]+)\/?\s*(?:([0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4})\.?)/i
    const parseIssueDate = (text: string): { issue?: string, date?: string } => {
      const txt = text.replace(/\s+/g, ' ').trim()
      const mNum = txt.match(/broj\s+([0-9]{1,3})\s*\/\s*([0-9]{2,4})/i)
      let issue: string | undefined
      if (mNum) {
        const num = mNum[1]
        const yearRaw = mNum[2]
        issue = `${num}/${yearRaw}`
      }
      const mDate = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})\.?/)
      let date: string | undefined
      if (mDate) {
        const d = String(mDate[1]).padStart(2, '0')
        const m = String(mDate[2]).padStart(2, '0')
        const yRaw = mDate[3]
        let Y = yRaw
        if (yRaw.length === 2) {
          const yNum = Number(yRaw)
          Y = String(yNum <= 39 ? 2000 + yNum : 1900 + yNum)
        }
        date = `${d}.${m}.${Y}.`
      }
      return { issue, date }
    }
    const findNearbyIssueDate = ($$: cheerio.Root, element: cheerio.Element): { issue?: string, date?: string } => {
      let probe: cheerio.Element | null = element
      for (let depth = 0; depth < 6 && probe; depth++) {
        const parent = $$(probe).parent()[0] || null
        const siblingsPrev = parent ? $$(parent).prevAll().toArray() : []
        for (const s of siblingsPrev) {
          const t = $$(s).text().replace(/\s+/g, ' ').trim()
          if (!t) continue
          if (headerRegex.test(t)) {
            return parseIssueDate(t)
          }
        }
        if (!parent) break
        probe = parent
      }
      // Fallback: check immediate next siblings if previous didn't match
      let nextProbe: cheerio.Element | null = element
      for (let d = 0; d < 2 && nextProbe; d++) {
        const parent = $$(nextProbe).parent()[0] || null
        const siblingsNext = parent ? $$(parent).nextAll().toArray().slice(0, 3) : []
        for (const s of siblingsNext) {
          const t = $$(s).text().replace(/\s+/g, ' ').trim()
          if (!t) continue
          if (headerRegex.test(t)) {
            return parseIssueDate(t)
          }
        }
        if (!parent) break
        nextProbe = parent
      }
      return {}
    }
    const looksLaw = (t: string) => {
      const s = t.trim()
      if (s.length < 6) return false
      // Zadržati samo naslove koji sadrže riječ "zakon" kao zasebnu riječ
      // ili razmaknut oblik slova (npr. Z A K O N), ali isključiti "zakoni", "zakonodavstva", itd.
      const hasWord = /\bzakon\b/i.test(s) || /z\s*a\s*k\s*o\s*n/i.test(s)
      if (!hasWord) return false
      if (/\bzakoni\b/i.test(s)) return false
      if (/zakonodavst/i.test(s)) return false
      return true
    }

    let currentIssue: string | undefined
    let currentDate: string | undefined
    const items: RegistryItem[] = []

    // Iterate through all descendants in DOM order to capture headers, anchors, and text blocks
    const descendants = $root.find('*').toArray()
    for (const el of descendants) {
      const $el = $(el)
      const text = $el.text().replace(/\s+/g, ' ').trim()
      if (!text) continue

      // Detect header blocks (Službene novine ... broj ... datum)
      if (headerRegex.test(text)) {
        const m = issueDateRegex.exec(text)
        currentIssue = m?.[1]?.trim()
        currentDate = m?.[2]?.trim()
        if (!currentIssue || !currentDate) {
          const parsed = parseIssueDate(text)
          currentIssue = currentIssue || parsed.issue
          currentDate = currentDate || parsed.date
        }
        continue
      }

      // Law anchors within this block
      // Helper to strip leading ordinal numbers from titles (e.g., "1.", "2)" or "3 -")
      const stripLeadingOrdinal = (t: string) => {
        const s = t.trim()
        // Remove patterns like: 1., 2), 3 -, 4 – followed by spaces
        return s.replace(/^\s*\d+\s*[\.|\)|\-|–]\s*/u, '')
      }

      if ($el.is('a')) {
        const href = ($el.attr('href') || '').trim()
        const atxt = stripLeadingOrdinal(text)
        if (!href || !atxt) continue
        let abs: string
        try {
          abs = new URL(href, baseUrl).href
        } catch {
          continue
        }
        const u = new URL(abs)
        const isSameDomain = u.hostname.endsWith('fbihvlada.gov.ba')
        const isLocal = href.startsWith('/')
        if (!(isSameDomain || isLocal)) continue
        // Ignore self-links or hash anchors pointing to the same page
        const reg = new URL(registryUrl)
        const samePage = (u.origin === reg.origin && u.pathname === reg.pathname)
        if (samePage || href === '#' || abs.endsWith('#')) continue
        // Exclude obvious category pages
        const p = u.pathname.toLowerCase()
        const isCategory = p.startsWith('/bs/zakoni') || p.startsWith('/bs/budzet') || p.includes('uskladenost-zakonodavstva')
        if (isCategory) continue
        // Prefer only content links under site (exclude navigation)
        if (!looksLaw(atxt)) continue
        const near = findNearbyIssueDate($, el)
        items.push({ url: abs, title: atxt, issue: near.issue || currentIssue, date: near.date || currentDate })
      }

      // List items or paragraphs that contain law titles, possibly without a direct anchor
      if ($el.is('li') || $el.is('p')) {
        const cleaned = stripLeadingOrdinal(text)
        if (!looksLaw(cleaned)) continue
        const a = $el.find('a[href]').first()
        let abs: string | undefined
        if (a.length) {
          const href = (a.attr('href') || '').trim()
          try { abs = new URL(href, baseUrl).href } catch { /* ignore */ }
        }
        const near = findNearbyIssueDate($, el)
        items.push({ url: abs || '', title: cleaned, issue: near.issue || currentIssue, date: near.date || currentDate })
      }

      // Fallback: catch law titles in other blocks (div/section/article/span/strong)
      if ($el.is('div') || $el.is('section') || $el.is('article') || $el.is('span') || $el.is('strong')) {
        const cleaned = stripLeadingOrdinal(text)
        if (!looksLaw(cleaned)) continue
        const a = $el.find('a[href]').first()
        let abs: string | undefined
        if (a.length) {
          const href = (a.attr('href') || '').trim()
          try { abs = new URL(href, baseUrl).href } catch { /* ignore */ }
        }
        const near = findNearbyIssueDate($, el)
        items.push({ url: abs || '', title: cleaned, issue: near.issue || currentIssue, date: near.date || currentDate })
      }
    }

    // Deduplicate by URL keeping first occurrence with issue/date
    const uniqMap: Record<string, RegistryItem> = {}
    for (const it of items) {
      const key = it.url ? `url:${it.url}` : `title:${it.title}|issue:${it.issue ?? ''}|date:${it.date ?? ''}`
      if (!uniqMap[key]) uniqMap[key] = it
    }
    return Object.values(uniqMap)
  } finally {
    await browser.close()
  }
}

function runSingleArticleExtractor(cwd: string, url: string, title: string): Promise<{ ok: boolean }>
{ return new Promise((resolve) => {
    const args = [
      '--yes', 'tsx',
      path.join(cwd, 'scripts', 'extract_fbih_single_article.ts'),
      `--url=${url}`,
      `--title=${title}`
    ]
    const child = spawn('npx', args, { cwd, stdio: 'pipe', shell: true })
    let out = ''
    let err = ''
    child.stdout.on('data', d => out += d.toString())
    child.stderr.on('data', d => err += d.toString())
    child.on('close', (code) => {
      const ok = code === 0
      resolve({ ok })
    })
  }) }

function renderPreviewTable(all: Array<{ registry: string, items: RegistryItem[] }>): string {
  const flat = all.flatMap(group => {
    const year = yearFromUrl(group.registry)
    return group.items.map(it => ({ ...it, year }))
  })
  // Sort samo kada je više godina; za jednu godinu zadržati izvorni redoslijed sa stranice
  if (all.length > 1) {
    flat.sort((a, b) => {
      const ya = Number(a.year || 0), yb = Number(b.year || 0)
      if (yb !== ya) return yb - ya
      const da = a.date || '', db = b.date || ''
      return da.localeCompare(db)
    })
  }
  const rows = flat.map(it => {
    const issue = it.issue ? it.issue : ''
    const date = it.date ? it.date : ''
    const year = it.year ? String(it.year) : ''
    const urlCell = it.url ? `<a href="${htmlEscape(it.url)}" target="_blank">${htmlEscape(it.url)}</a>` : '-'
    return `<tr>
      <td>${htmlEscape(it.title)}</td>
      <td>${htmlEscape(year)}</td>
      <td>${htmlEscape(issue)}</td>
      <td>${htmlEscape(date)}</td>
      <td>${urlCell}</td>
    </tr>`
  })
  const sources = all.map(g => `<li><a href="${htmlEscape(g.registry)}" target="_blank">${htmlEscape(g.registry)}</a></li>`).join('\n')
  return `<!doctype html>
<html lang="bs">
  <head>
    <meta charset="utf-8">
    <title>FBiH – Registar (više godina)</title>
    <style>
      body { font-family: Arial, sans-serif; font-size: 14px; line-height: 1.5; padding: 24px; background: #ffffff; color: #000000; }
      h1 { margin: 0 0 16px; font-size: 20px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
      th, td { border: 1px solid #ccc; padding: 8px 10px; text-align: left; }
      th { background: #f5f5f5; }
      tbody tr:nth-child(odd) { background: #fafafa; }
      .small { color: #666; font-size: 12px; }
    </style>
  </head>
  <body>
    <h1>FBiH – Hronološki registar (jedna tabela)</h1>
    <p class="small">Izvori: </p>
    <ul class="small">${sources}</ul>
    <section>
      <table>
        <thead>
          <tr>
            <th>Naziv</th>
            <th>Godina</th>
            <th>Službene novine (broj)</th>
            <th>Datum</th>
            <th>URL zakona</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join('\n')}
        </tbody>
      </table>
    </section>
  </body>
</html>`
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const API_DIR = ROOT
  const DUMPS_DIR = path.join(ROOT, 'dumps')
  await fs.ensureDir(DUMPS_DIR)

  // CLI: --year_url=... (može više puta) ili --urls=comma-separated
  const argv = process.argv.slice(2)
  const getArg = (name: string) => {
    const pref = `--${name}=`
    const hit = argv.find(a => a.startsWith(pref))
    return hit ? hit.slice(pref.length) : undefined
  }
  const urlsArg = getArg('urls')
  const yearUrlArgs = argv.filter(a => a.startsWith('--year_url=')).map(a => a.slice('--year_url='.length))
  const yearUrls = urlsArg ? urlsArg.split(',').map(s => s.trim()).filter(Boolean)
                            : yearUrlArgs.length ? yearUrlArgs : []

  if (yearUrls.length === 0) {
    console.error('Provide --year_url=URL (can be multiple via --urls=url1,url2,...)')
    process.exit(2)
  }

  const allPreview: Array<{ registry: string, items: RegistryItem[] }> = []

  for (const regUrl of yearUrls) {
    console.log(`Collecting laws from: ${regUrl}`)
    const links = await collectLawLinksFromRegistry(regUrl)
    console.log(`Found ${links.length} laws in registry with metadata`)
    allPreview.push({ registry: regUrl, items: links })
  }

  // Save JSON dump
  const outJson = path.join(DUMPS_DIR, `fbih_registry_preview_${Date.now()}.json`)
  await fs.writeFile(outJson, JSON.stringify(allPreview, null, 2), 'utf-8')

  // Save HTML preview table
  const outHtml = path.join(API_DIR, 'tmp', 'fbih_registry_preview.html')
  const html = renderPreviewTable(allPreview)
  await fs.ensureDir(path.dirname(outHtml))
  await fs.writeFile(outHtml, html, 'utf-8')
  // Also write to single article preview path to reuse running server route
  const outHtmlAlias = path.join(API_DIR, 'tmp', 'fbih_single_article_preview.html')
  await fs.writeFile(outHtmlAlias, html, 'utf-8')
  console.log(JSON.stringify({ ok: true, results_path: outJson, preview_path: outHtml, alias_preview: outHtmlAlias }, null, 2))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
function yearFromUrl(u: string): string {
  try {
    const yearMatch = u.match(/(\d{4})/)
    return yearMatch ? yearMatch[1] : ''
  } catch {
    return ''
  }
}