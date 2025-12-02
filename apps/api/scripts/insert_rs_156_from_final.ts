import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

type Item = {
  jurisdiction: string
  title: string
  title_normalized?: string | null
  slug?: string | null
  doc_type?: string | null
  gazette_key?: string | null
  gazette_number?: string | null
  gazette_date?: string | null
  source_url?: string | null
  url_pdf?: string | null
  path_pdf?: string | null
}

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return (input || '').replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

async function readFinalList(): Promise<Item[]> {
  const ROOT = path.resolve(process.cwd())
  const topLevel = path.join(ROOT, '..', '..', 'dumps', 'missing_rs_insert_final_preview.json')
  const local = path.join(ROOT, 'dumps', 'missing_rs_insert_final_preview.json')
  let raw: any
  if (await fs.pathExists(topLevel)) raw = await fs.readJson(topLevel)
  else if (await fs.pathExists(local)) raw = await fs.readJson(local)
  else throw new Error('missing_rs_insert_final_preview.json not found in dumps')
  const arr: any[] = Array.isArray(raw) ? raw : (raw.items || raw.records || raw.missing || [])
  return arr.map((x) => ({
    jurisdiction: x.jurisdiction || 'RS',
    title: x.title,
    title_normalized: x.title_normalized || normalizeTitle(x.title || ''),
    slug: x.slug || null,
    doc_type: x.doc_type || null,
    gazette_key: x.gazette_key || null,
    gazette_number: x.gazette_number || null,
    gazette_date: x.gazette_date || null,
    source_url: x.source_url || null,
    url_pdf: x.url_pdf || null,
    path_pdf: x.path_pdf || null
  }))
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  const items = (await readFinalList()).filter((i) => (i.jurisdiction || 'RS') === 'RS')
  let inserted = 0
  let skipped = 0

  for (const i of items) {
    const title = i.title
    const norm = i.title_normalized || normalizeTitle(title)
    const jurisdiction = i.jurisdiction || 'RS'
    const gazette_key = i.gazette_key || null
    const path_pdf = i.path_pdf || null

    // Prefer path_pdf uniqueness if available
    if (path_pdf) {
      const byPath = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [path_pdf])
      if (byPath?.id) { skipped++; continue }
    }
    const byComposite = await get<{ id: number }>(
      'SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND (gazette_key = ? OR (gazette_key IS NULL AND ? IS NULL)) LIMIT 1',
      [jurisdiction, title, gazette_key, gazette_key]
    )
    if (byComposite?.id) { skipped++; continue }

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jurisdiction, title, norm, i.slug || null, i.doc_type || null, gazette_key, i.gazette_number || null, i.gazette_date || null, i.source_url || null, i.url_pdf || null, path_pdf]
    )
    inserted++
  }

  console.log(JSON.stringify({ ok: true, inserted, skipped, total: items.length }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })