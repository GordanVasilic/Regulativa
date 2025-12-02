import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

function stripDiacritics(input: string) {
  return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeTitle(input: string) {
  return stripDiacritics(input).toLowerCase().replace(/\s+/g, ' ').trim()
}

type NsrsItem = {
  title: string
  title_normalized: string
  gazette_text?: string
  gazette_number?: string | null
  gazette_key?: string | null
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
  const dataDir = path.join(ROOT, 'data')
  const dumpsDir = path.join(ROOT, 'dumps')
  await fs.ensureDir(dumpsDir)

  const nsrsPath = path.join(dataDir, 'nsrs_rs_meta.json')
  if (!(await fs.pathExists(nsrsPath))) {
    throw new Error(`NSRS meta file not found: ${nsrsPath}. Run scripts/nsrs_scrape_meta.ts first.`)
  }
  const list = await fs.readJson(nsrsPath) as NsrsItem[]
  const nsrsItems = list.map((x) => ({
    title: x.title,
    title_normalized: normalizeTitle(x.title_normalized || x.title),
    gazette_number: x.gazette_number || null,
    gazette_key: x.gazette_key || null,
    gazette_text: x.gazette_text || ''
  })).filter((it) => it.title && it.title_normalized)

  const { normTitles, gazetteNumbers, gazetteKeys } = await loadDbLaws()

  const missing: NsrsItem[] = []
  let matchedByGazette = 0
  let matchedByTitle = 0

  for (const it of nsrsItems) {
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
    source: 'NSRS scraped list',
    nsrs_total: nsrsItems.length,
    matched_by_gazette: matchedByGazette,
    matched_by_title: matchedByTitle,
    missing_count: missing.length,
    missing
  }

  const outJson = path.join(dumpsDir, 'missing_rs_from_nsrs.json')
  await fs.writeJson(outJson, report, { spaces: 2 })
  console.log(`Izvještaj sačuvan u: ${outJson}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})