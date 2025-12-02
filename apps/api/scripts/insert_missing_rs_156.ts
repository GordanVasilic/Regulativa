import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const DUMPS_DIR = path.join(ROOT, '..', '..', 'dumps')

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
  const map: Record<string, string> = {
    č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj'
  }
  return input
    .replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

async function readMissingBasenames(): Promise<Set<string>> {
  const raw = await fs.readFile(MISSING_PATH, 'utf8')
  const names = new Set<string>()
  // Try JSON parse first
  try {
    const obj = JSON.parse(raw)
    if (Array.isArray(obj?.missing)) {
      for (const it of obj.missing) {
        const abs = String(it?.path || '')
        if (!abs) continue
        names.add(path.basename(abs))
      }
      return names
    }
  } catch {}
  // Fallback: regex for "path": "...pdf"
  const re = /\"path\"\s*:\s*\"([^\"]+\.pdf)\"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const abs = m[1]
    const base = path.basename(abs)
    names.add(base)
  }
  if (names.size === 0) {
    // Line-by-line fallback
    const lines = raw.split(/\r?\n/)
    for (const line of lines) {
      const lm = line.match(/"path"\s*:\s*"(.*?\.pdf)"/)
      if (lm) {
        names.add(path.basename(lm[1]))
      }
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
  const missingSet = await readMissingBasenames()
  console.log('Missing basenames count:', missingSet.size)
  const enriched = await fs.readJSON(ENRICHED_PATH)
  const items: EnrichedItem[] = Array.isArray(enriched.items) ? enriched.items : []

  const filtered: EnrichedItem[] = items.filter((it) => missingSet.has(path.basename(it.path_pdf)))
  console.log('Filtered to:', filtered.length)

  // Save final preview for audit
  await fs.writeJSON(FINAL_PREVIEW_PATH, { count: filtered.length, items: filtered }, { spaces: 2 })
  console.log(`Final preview spreman: ${filtered.length} unosa -> ${FINAL_PREVIEW_PATH}`)

  // Insert into DB
  const db = new sqlite3.Database(DB_PATH)
  await ensureTables(db)
  const get = <T = any>(sql: string, params: any[] = []) =>
    new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const run = (sql: string, params: any[] = []) =>
    new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  let inserted = 0
  let skipped = 0
  for (const it of filtered) {
    const exists = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [it.path_pdf])
    if (exists?.id) {
      skipped++
      continue
    }

    const jurisdiction = 'RS'
    const title = it.title
    const title_normalized = normalizeTitle(it.title)
    const gazette_key = it.gazette_key
    const gazette_number = it.gazette_number
    const gazette_date = it.gazette_date
    const source_url = it.source_url
    const url_pdf = it.url_pdf
    const path_pdf = it.path_pdf

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
       VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`,
      [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf]
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