import path from 'node:path'
import fs from 'fs-extra'
import puppeteer from 'puppeteer'
import { load } from 'cheerio'

type LawItem = {
  title: string
  issue: string | null
  date: string | null
  pdfUrl: string | null
  pageUrl: string | null
}

const BASE_URL = 'https://pravnapomoc.upfbih.ba/propisi?AP=Z&NZ=2'

async function ensureTmpRoot(): Promise<string> {
  // Write JSON to workspace tmp root: ../../tmp relative to apps/api
  const tmpRoot = path.resolve(process.cwd(), '..', '..', 'tmp')
  await fs.ensureDir(tmpRoot)
  return tmpRoot
}

function normalizeText(s: string | null | undefined): string {
  if (!s) return ''
  return s.replace(/\s+/g, ' ').trim()
}

async function extractItemsOnPage(page: puppeteer.Page): Promise<LawItem[]> {
  const html = await page.content()
  const $ = load(html)
  const results: LawItem[] = []

  const issueFrom = (txt: string) => {
    const m = txt.match(/Službene\s+novine\s+FBiH\s*([0-9]+\/[0-9]+)/i)
    return m ? m[1] : null
  }
  const dateFrom = (txt: string) => {
    const m = txt.match(/(\d{2}\.\d{2}\.\d{4}|\d{2}\.\d{1,2}\.\d{2})/)
    return m ? m[1] : null
  }

  const rows = $('table tbody tr')
  if (rows.length) {
    rows.each((_i, el) => {
      const tr = $(el)
      const anchor = tr.find('a[href]').first()
      const title = normalizeText(anchor.text() || tr.find('td').first().text())
      const textAll = tr.text()
      const issue = issueFrom(textAll)
      const date = dateFrom(textAll)
      const pdfA = tr.find('a[href$=".pdf"], a[href*=".pdf"]').first()
      const pdfUrl = pdfA.length ? pdfA.attr('href') || null : null
      const pageUrl = anchor.length ? anchor.attr('href') || null : null
      if (title) results.push({ title, issue, date, pdfUrl, pageUrl })
    })
  } else {
    // Heuristic: look for blocks mentioning SN FBiH and backtrack title anchors
    $('main *').each((_i, el) => {
      const text = normalizeText($(el).text())
      if (!text) return
      if (/Službene\s+novine\s+FBiH/i.test(text)) {
        const anchor = $(el).find('a[href]').first()
        let title = ''
        const prev = $(el).prev()
        if (prev && /Zakon|ZAKON/i.test(prev.text())) title = normalizeText(prev.text())
        if (!title) title = normalizeText(anchor.text())
        const issue = issueFrom(text)
        const date = dateFrom(text)
        const pdfA = $(el).find('a[href$=".pdf"], a[href*=".pdf"]').first()
        const pageUrl = anchor.length ? anchor.attr('href') || null : null
        const pdfUrl = pdfA.length ? pdfA.attr('href') || null : null
        if (title) results.push({ title, issue, date, pdfUrl, pageUrl })
      }
    })
  }

  return results
}

async function setLengthToAll(page: puppeteer.Page): Promise<void> {
  // Try to select 1000 on the DataTables length dropdown
  try {
    await page.waitForSelector('select[name="zakonitbl_length"]', { timeout: 5000 })
    // Prefer 1000 if available, else fallback to the largest option
    const has1000 = await page.$('select[name="zakonitbl_length"] option[value="1000"]')
    if (has1000) {
      await page.select('select[name="zakonitbl_length"]', '1000')
    } else {
      // Find max value among options
      const maxVal = await page.evaluate(() => {
        const sel = document.querySelector('select[name="zakonitbl_length"]') as HTMLSelectElement | null
        if (!sel) return null
        let max = 0
        for (const opt of Array.from(sel.options)) {
          const v = parseInt(opt.value, 10)
          if (!isNaN(v) && v > max) max = v
        }
        return max ? String(max) : null
      })
      if (maxVal) await page.select('select[name="zakonitbl_length"]', maxVal)
    }
    await page.waitForTimeout(1200)
  } catch (e) {
    // ignore if selector is not present; we'll fallback to pagination methods
  }
}

async function findPaginationLinks(page: puppeteer.Page): Promise<string[]> {
  const html = await page.content()
  const $ = load(html)
  const set = new Set<string>()
  $('a').each((_i, el) => {
    const a = $(el)
    const text = normalizeText(a.text())
    const href = a.attr('href') || ''
    if (!href) return
    if (/^\d+$/.test(text)) {
      const u = new URL(href, BASE_URL).href
      set.add(u)
    }
    if (/Sljedeća|Next|›|>>/i.test(text)) {
      const u = new URL(href, BASE_URL).href
      set.add(u)
    }
  })
  set.add(BASE_URL)
  return Array.from(set)
}

async function resolvePdfFromDetail(browser: puppeteer.Browser, pageUrl: string): Promise<string | null> {
  try {
    const p = await browser.newPage()
    await p.goto(pageUrl, { waitUntil: 'domcontentloaded' })
    const html = await p.content()
    const $ = load(html)
    const a = $('a[href$=".pdf"], a[href*=".pdf"]').first()
    await p.close()
    return a.length ? a.attr('href') || null : null
  } catch (e) {
    return null
  }
}

async function main() {
  const tmpRoot = await ensureTmpRoot()
  const outPath = path.join(tmpRoot, 'fbih_pravnapomoc.json')

  const browser = await puppeteer.launch({ headless: 'new' })
  const page = await browser.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
  await page.waitForTimeout(1500)

  // Show all rows on one page (1000) to avoid paging
  await setLengthToAll(page)
  let all: LawItem[] = await extractItemsOnPage(page)
  // Resolve missing PDFs from detail pages if possible
  for (const it of all) {
    if (!it.pdfUrl && it.pageUrl) {
      it.pdfUrl = await resolvePdfFromDetail(browser, it.pageUrl)
    }
  }

  // If length dropdown failed (still only ~10 items), fallback to paging methods
  if (all.length <= 10) {
    const pageLinks = await findPaginationLinks(page)
    const visited = new Set<string>()
    for (const url of pageLinks) {
      if (visited.has(url)) continue
      visited.add(url)
      try {
        await page.goto(url, { waitUntil: 'networkidle2' })
        await page.waitForTimeout(1000)
        const items = await extractItemsOnPage(page)
        for (const it of items) {
          if (!it.pdfUrl && it.pageUrl) {
            it.pdfUrl = await resolvePdfFromDetail(browser, it.pageUrl)
          }
        }
        all.push(...items)
        console.log(`Parsed ${items.length} items from ${url}`)
      } catch (e) {
        console.warn('Failed to parse page', url, e)
      }
    }
  }

  // If only base page parsed, try common pagination params heuristically
  if (all.length <= 10) {
    const paramCandidates = ['page', 'stranica', 'Stranica', 'p', 'pg', 'Page']
    for (let i = 2; i <= 40; i++) {
      for (const pName of paramCandidates) {
        const u = new URL(BASE_URL)
        u.searchParams.set(pName, String(i))
        const nextUrl = u.href
        // We do not track visited here; requests should be unique by URL
        try {
          await page.goto(nextUrl, { waitUntil: 'networkidle2' })
          await page.waitForTimeout(800)
          const items = await extractItemsOnPage(page)
          for (const it of items) {
            if (!it.pdfUrl && it.pageUrl) {
              it.pdfUrl = await resolvePdfFromDetail(browser, it.pageUrl)
            }
          }
          all.push(...items)
          console.log(`Parsed ${items.length} items from ${nextUrl}`)
        } catch (e) {
          // ignore and continue with other candidates
        }
      }
    }
  }

  // As a final attempt, try to click through pagination controls on the page
  if (all.length <= 10) {
    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle2' })
      await page.waitForTimeout(1000)
      for (let step = 0; step < 40; step++) {
        const items = await extractItemsOnPage(page)
        for (const it of items) {
          if (!it.pdfUrl && it.pageUrl) {
            it.pdfUrl = await resolvePdfFromDetail(browser, it.pageUrl)
          }
        }
        all.push(...items)
        // Try find 'Next' or 'Sljedeća'
        const nextSelectors = [
          "//a[contains(., 'Sljedeća')]",
          "//button[contains(., 'Sljedeća')]",
          "//a[contains(., 'Next')]",
          "//button[contains(., 'Next')]",
          "//a[contains(., '›')]",
          "//a[contains(@class,'next') or contains(@aria-label,'Next')]"
        ]
        let nextEl = null
        for (const xp of nextSelectors) {
          const handles = await page.$x(xp)
          if (handles && handles.length) { nextEl = handles[0]; break }
        }
        if (!nextEl) {
          // Try to click numeric next page link
          const current = step + 1
          const xpNum = `//a[normalize-space(text())='${current + 1}']`
          const handles = await page.$x(xpNum)
          if (handles && handles.length) nextEl = handles[0]
        }
        if (!nextEl) break
        try {
          await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            (nextEl as any).click()
          ])
          await page.waitForTimeout(600)
        } catch {
          break
        }
      }
    } catch (e) {
      // ignore
    }
  }

  // Dedup by title + issue + date
  const dedupMap = new Map<string, LawItem>()
  for (const it of all) {
    const key = `${it.title}|${it.issue || ''}|${it.date || ''}`
    if (!dedupMap.has(key)) dedupMap.set(key, it)
  }
  const final = Array.from(dedupMap.values())

  await fs.writeJSON(outPath, { source: BASE_URL, count: final.length, items: final }, { spaces: 2 })
  console.log('Wrote JSON:', outPath, 'count=', final.length)

  await browser.close()
}

main().catch((e) => {
  console.error('Scrape failed:', e)
  process.exitCode = 1
})