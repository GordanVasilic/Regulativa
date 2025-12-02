import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import { MeiliSearch } from 'meilisearch'

type Item = {
  jurisdiction: string
  title: string
  title_normalized?: string | null
  gazette_key?: string | null
  path_pdf?: string | null
}

sqlite3.verbose()

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return input.replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

async function readExpectedList(): Promise<Item[]> {
  const ROOT = path.resolve(process.cwd())
  // Prefer top-level dumps path; fallback to apps/api/dumps
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
    gazette_key: x.gazette_key || null,
    path_pdf: x.path_pdf || null
  }))
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

  const expected = await readExpectedList()
  const host = process.env.MEILI_HOST
  const apiKey = process.env.MEILI_KEY
  let meili: MeiliSearch | null = null
  let lawsIndex: ReturnType<MeiliSearch['index']> | null = null
  if (host && apiKey) {
    try {
      meili = new MeiliSearch({ host, apiKey })
      lawsIndex = meili.index('laws')
    } catch (e) {
      console.warn('Meili init failed:', e)
    }
  }

  const missingInDb: Item[] = []
  const missingInMeili: Item[] = []
  const presentInDbOnly: Item[] = []
  const presentInMeiliOnly: Item[] = []

  for (const item of expected) {
    const jurisdiction = item.jurisdiction || 'RS'
    const title = item.title
    const normTitle = item.title_normalized || normalizeTitle(title)
    const gazetteKey = item.gazette_key || null

    // DB check: match by jurisdiction + gazette_key + title/title_normalized
    const dbRow = await get<{ id: number }>(
      `SELECT id FROM laws WHERE jurisdiction = ? AND (
         (gazette_key = ?)
         OR (gazette_key IS NULL AND ? IS NULL)
       ) AND (
         title = ? OR title_normalized = ?
       ) LIMIT 1`,
      [jurisdiction, gazetteKey, gazetteKey, title, normTitle]
    )
    const inDb = !!dbRow?.id

    let inMeili = false
    if (lawsIndex) {
      try {
        const filters: string[] = []
        filters.push(`jurisdiction = "${jurisdiction}"`)
        if (gazetteKey) filters.push(`gazette_key = "${gazetteKey}"`)
        const result: any = await lawsIndex.search(title || normTitle || '', {
          limit: 5,
          filter: filters.join(' AND ')
        })
        const hits: any[] = result?.hits || []
        const hit = hits.find((h) => h.title === title || h.title_normalized === normTitle)
        inMeili = !!hit
      } catch (e) {
        console.warn('Meili search failed for', title, e)
      }
    }

    if (!inDb) missingInDb.push(item)
    if (!inMeili) missingInMeili.push(item)
    if (inDb && !inMeili) presentInDbOnly.push(item)
    if (!inDb && inMeili) presentInMeiliOnly.push(item)
  }

  const report = {
    totals: {
      expected_count: expected.length,
      db_present: expected.length - missingInDb.length,
      db_missing: missingInDb.length,
      meili_present: expected.length - missingInMeili.length,
      meili_missing: missingInMeili.length
    },
    db_missing: missingInDb.map((i) => ({ title: i.title, gazette_key: i.gazette_key })),
    meili_missing: missingInMeili.map((i) => ({ title: i.title, gazette_key: i.gazette_key })),
    present_in_db_only: presentInDbOnly.map((i) => ({ title: i.title, gazette_key: i.gazette_key })),
    present_in_meili_only: presentInMeiliOnly.map((i) => ({ title: i.title, gazette_key: i.gazette_key }))
  }
  console.log(JSON.stringify(report, null, 2))
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})