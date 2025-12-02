import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const DUMPS_DIR = path.join(ROOT, 'dumps')

const MISSING_PATH = path.join(DUMPS_DIR, 'missing_pdfs_rs.json')
const ENRICHED_PATH = path.join(DUMPS_DIR, 'missing_rs_insert_preview_enriched.json')
const FINAL_PREVIEW_PATH = path.join(DUMPS_DIR, 'missing_rs_insert_final_preview.json')

type EnrichedItem = {
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

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return input.replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

async function getMissingBasenames(): Promise<string[]> {
  // Try fs.readJSON first
  try {
    const obj: any = await fs.readJSON(MISSING_PATH)
    console.log('readJSON ok, keys:', Object.keys(obj))
    if (Array.isArray(obj?.missing)) {
      const arr = obj.missing.map((it: any) => path.basename(String(it.path)))
      console.log('readJSON missing count:', arr.length)
      return arr
    }
  } catch (e) {
    console.warn('readJSON failed:', (e as Error).message)
  }
  // Try JSON.parse with BOM strip
  try {
    let raw = await fs.readFile(MISSING_PATH, 'utf8')
    raw = raw.replace(/^\uFEFF/, '')
    const obj = JSON.parse(raw)
    console.log('JSON.parse ok, keys:', Object.keys(obj))
    if (Array.isArray((obj as any)?.missing)) {
      const arr = (obj as any).missing.map((it: any) => path.basename(String(it.path)))
      console.log('JSON.parse missing count:', arr.length)
      return arr
    }
  } catch (e) {
    console.warn('JSON.parse failed:', (e as Error).message)
  }
  // Regex fallback
  // Read raw and handle potential UTF-16 encoding
  const buf = await fs.readFile(MISSING_PATH)
  let raw = buf.toString('utf8')
  if (raw.startsWith('\uFEFF') || raw.slice(0, 2).includes('�')) {
    try {
      raw = buf.toString('utf16le')
    } catch {}
  }
  console.log('raw start:', raw.slice(0, 200))
  const names: string[] = []
  const re = /"path"\s*:\s*"([^"\n]+\.pdf)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) names.push(path.basename(m[1]))
  console.log('regex extracted count:', names.length)
  if (!names.length) {
    for (const line of raw.split(/\r?\n/)) {
      const lm = line.match(/"path"\s*:\s*"(.*?\.pdf)"/)
      if (lm) names.push(path.basename(lm[1]))
    }
    console.log('line-by-line extracted count:', names.length)
  }
  if (!names.length) {
    const s = raw
    const results: string[] = []
    let i = 0
    while (i < s.length) {
      const idx = s.indexOf('"path"', i)
      if (idx === -1) break
      const colonIdx = s.indexOf(':', idx)
      if (colonIdx === -1) break
      const firstQuote = s.indexOf('"', colonIdx + 1)
      if (firstQuote === -1) break
      let j = firstQuote + 1
      let buf = ''
      while (j < s.length) {
        const ch = s[j]
        if (ch === '"') break
        buf += ch
        j++
      }
      if (buf.toLowerCase().endsWith('.pdf')) results.push(path.basename(buf))
      i = j + 1
    }
    if (results.length) {
      names.push(...results)
      console.log('manual-scan extracted count:', names.length)
    }
  }
  return names
}

async function ensureTables(db: sqlite3.Database) {
  await new Promise<void>((resolve, reject) =>
    db.run(
      `CREATE TABLE IF NOT EXISTS laws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jurisdiction TEXT NOT NULL,
        title TEXT NOT NULL,
        title_normalized TEXT,
        slug TEXT,
        doc_type TEXT,
        gazette_key TEXT,
        gazette_number TEXT,
        gazette_date TEXT,
        source_url TEXT,
        url_pdf TEXT,
        path_pdf TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
      [],
      (err) => (err ? reject(err) : resolve())
    )
  )
}

async function main() {
  const basenames = await getMissingBasenames()
  console.log('Missing basenames length:', basenames.length)
  if (!basenames.length) {
    console.error('Missing list is empty, aborting to avoid wrong insert.')
    process.exit(1)
  }
  const enriched = await fs.readJSON(ENRICHED_PATH)
  const items: EnrichedItem[] = Array.isArray(enriched.items) ? enriched.items : []

  // Derive gazette_key from basenames and use that for matching
  const keys = basenames.map((b) => {
    const last = b.split('-').pop() || ''
    return last.replace(/\.pdf$/i, '')
  })
  const orderedKeys = keys.slice(0, 156)
  const targetKeys = new Set(orderedKeys)
  let filtered: EnrichedItem[] = items.filter((it) => it.gazette_key && targetKeys.has(it.gazette_key))
  // Preserve order based on orderedKeys and strictly cap to 156
  const keyOrder = new Map<string, number>(orderedKeys.map((k, i) => [k, i]))
  filtered.sort((a, b) => (keyOrder.get(a.gazette_key || '')! - keyOrder.get(b.gazette_key || '')!))
  if (filtered.length > 156) filtered = filtered.slice(0, 156)
  console.log('Filtered to:', filtered.length)

  await fs.writeJSON(FINAL_PREVIEW_PATH, { count: filtered.length, items: filtered }, { spaces: 2 })
  console.log(`Final preview spreman: ${filtered.length} unosa -> ${FINAL_PREVIEW_PATH}`)

  await fs.ensureDir(DATA_DIR)
  const db = new sqlite3.Database(DB_PATH)
  await ensureTables(db)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  let inserted = 0
  let skipped = 0
  for (const it of filtered) {
    const exists = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [it.path_pdf])
    if (exists?.id) {
      skipped++
      continue
    }

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      ['RS', it.title, normalizeTitle(it.title), it.gazette_key, it.gazette_number, it.gazette_date, it.source_url, it.url_pdf, it.path_pdf]
    )
    inserted++
  }

  console.log(`Umetnuto: ${inserted}, Preskočeno: ${skipped}`)
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})