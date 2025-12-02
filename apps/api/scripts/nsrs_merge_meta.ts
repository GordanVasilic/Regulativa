import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return input.replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

function gazetteNumberFromKey(key?: string | null) {
  if (!key) return null
  const m = key.match(/^(\d{1,3})_(\d{2})$/)
  if (m) return `${m[1]}/${m[2]}`
  return null
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const META_PATH = path.join(DATA_DIR, 'nsrs_rs_meta.json')
  const exists = await fs.pathExists(META_PATH)
  if (!exists) {
    console.error('Nema meta fajla:', META_PATH)
    process.exit(1)
  }
  const meta: Array<{ title: string; title_normalized: string; gazette_key?: string | null; gazette_number?: string | null; source_url?: string | null }> = await fs.readJson(META_PATH)
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  let updated = 0
  let matched = 0
  let unmatched = 0

  for (const m of meta) {
    const titleNorm = normalizeTitle(m.title)
    const gk = m.gazette_key || null
    const gn = m.gazette_number || gazetteNumberFromKey(gk)
    const candidates = await all<{ id: number; title: string; title_normalized: string; path_pdf: string; gazette_key?: string }>(
      'SELECT id, title, title_normalized, path_pdf, gazette_key FROM laws WHERE jurisdiction = ? AND (gazette_key = ? OR title_normalized LIKE ?) LIMIT 10',
      ['RS', gk, `%${titleNorm.slice(0, Math.min(20, titleNorm.length))}%`]
    )
    if (!candidates.length) {
      unmatched++
      continue
    }
    matched++
    // Prefer exact gazette_key match, else best title match
    let target = candidates.find((c) => c.gazette_key && gk && c.gazette_key === gk) || candidates[0]
    const slug = titleNorm.replace(/\s+/g, '-').slice(0, 200)
    await run(
      'UPDATE laws SET title = ?, title_normalized = ?, slug = ?, gazette_key = COALESCE(gazette_key, ?), gazette_number = COALESCE(gazette_number, ?), source_url = COALESCE(source_url, ?) WHERE id = ?',
      [m.title, titleNorm, slug, gk, gn, m.source_url || null, target.id]
    )
    updated++
  }

  console.log(`Spajanje gotovo. matched=${matched}, updated=${updated}, unmatched=${unmatched}`)
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})