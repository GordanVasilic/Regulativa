import path from 'node:path'
import sqlite3 from 'sqlite3'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

sqlite3.verbose()

type LawRow = {
  id: number
  jurisdiction: string
  title: string
  title_normalized?: string | null
  slug?: string | null
  gazette_key: string | null
  gazette_number?: string | null
  url_pdf: string | null
  path_pdf: string | null
}

function stripDiacritics(s: string): string {
  return s
    .replace(/č/g, 'c')
    .replace(/ć/g, 'c')
    .replace(/đ/g, 'dj')
    .replace(/š/g, 's')
    .replace(/ž/g, 'z')
    .replace(/Č/g, 'c')
    .replace(/Ć/g, 'c')
    .replace(/Đ/g, 'dj')
    .replace(/Š/g, 's')
    .replace(/Ž/g, 'z')
}

function cyrToLat(s: string): string {
  const map: Record<string, string> = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'dj', 'е': 'e', 'ж': 'z', 'з': 'z', 'и': 'i', 'ј': 'j', 'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'ћ': 'c', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's',
    'А': 'a', 'Б': 'b', 'В': 'v', 'Г': 'g', 'Д': 'd', 'Ђ': 'dj', 'Е': 'e', 'Ж': 'z', 'З': 'z', 'И': 'i', 'Ј': 'j', 'К': 'k', 'Л': 'l', 'Љ': 'lj', 'М': 'm', 'Н': 'n', 'Њ': 'nj', 'О': 'o', 'П': 'p', 'Р': 'r', 'С': 's', 'Т': 't', 'Ћ': 'c', 'У': 'u', 'Ф': 'f', 'Х': 'h', 'Ц': 'c', 'Ч': 'c', 'Џ': 'dz', 'Ш': 's',
  }
  return s.split('').map((ch) => (map[ch] !== undefined ? map[ch] : ch)).join('')
}

function normTitle(s: string): string {
  const lower = String(s || '').toLowerCase().trim()
  const translit = cyrToLat(lower)
  const t = stripDiacritics(translit).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return t
}

function normalizePath(p: string | null): string | null {
  if (!p) return null
  return path.normalize(p).trim().toLowerCase()
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
  })
}

function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as unknown as T)) )
  })
}

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((p) => {
      const [k, v] = p.split('=')
      return [k.replace(/^--?/, '').toUpperCase(), v ?? '']
    })
  ) as Record<string, string>

  const APPLY = args.APPLY === '' || args.APPLY === 'true'

  const db = new sqlite3.Database(DB_PATH)
  const laws = await all<LawRow>(
    db,
    `SELECT id, jurisdiction, title, title_normalized, slug, gazette_key, gazette_number, url_pdf, path_pdf FROM laws`
  )

  type GroupKey = string
  type Group = { key: GroupKey; jurisdiction: string; title: string; normTitle: string; gazette_key: string; docKey: string; ids: number[] }
  const groups = new Map<GroupKey, Group>()

  for (const l of laws) {
    const jurisdiction = String(l.jurisdiction || '').trim()
    const title = String(l.title || '').trim()
    const norm = l.title_normalized && l.title_normalized.trim() ? String(l.title_normalized).trim().toLowerCase() : normTitle(title)
    const gk = String(l.gazette_key || '').trim().toLowerCase()
    const docKeyRaw = normalizePath(l.path_pdf) || (l.url_pdf ? String(l.url_pdf).trim().toLowerCase() : null)
    if (!title || !gk || !docKeyRaw) continue
    const key = `${jurisdiction}||${norm}||${gk}||${docKeyRaw}`
    const existing = groups.get(key)
    if (existing) existing.ids.push(l.id)
    else groups.set(key, { key, jurisdiction, title, normTitle: norm, gazette_key: gk, docKey: docKeyRaw, ids: [l.id] })
  }

  const dups = Array.from(groups.values()).filter((g) => g.ids.length > 1)
  console.log(`Duplicate groups detected: ${dups.length}`)

  // Helper to pick KEEP id using simple heuristics
  function pickKeepId(candidates: LawRow[]): number {
    // Prefer entries with slug or gazette_number, then those with path_pdf present, then smallest id
    candidates.sort((a, b) => {
      const aScore = (a.slug ? 2 : 0) + (a.gazette_number ? 2 : 0) + (a.path_pdf ? 1 : 0)
      const bScore = (b.slug ? 2 : 0) + (b.gazette_number ? 2 : 0) + (b.path_pdf ? 1 : 0)
      if (bScore !== aScore) return bScore - aScore
      return a.id - b.id
    })
    return candidates[0].id
  }

  for (const g of dups) {
    const members = await all<LawRow>(db, `SELECT id, jurisdiction, title, title_normalized, slug, gazette_key, gazette_number, url_pdf, path_pdf FROM laws WHERE id IN (${g.ids.map(() => '?').join(',')})`, g.ids)
    const keepId = pickKeepId(members)
    const deleteIds = members.map((m) => m.id).filter((id) => id !== keepId)
    console.log(JSON.stringify({
      jurisdiction: g.jurisdiction,
      title: g.title,
      title_normalized: g.normTitle,
      gazette_key: g.gazette_key,
      document: g.docKey,
      ids: g.ids,
      suggestion: { keep: keepId, delete: deleteIds }
    }))

    if (!APPLY) continue

    // Apply dedup: move metadata/segments and delete duplicates
    const keepLaw = members.find((m) => m.id === keepId)!
    for (const delId of deleteIds) {
      const delLaw = members.find((m) => m.id === delId)!
      // Migrate path_pdf if needed
      if ((!keepLaw.path_pdf || keepLaw.path_pdf.trim() === '') && delLaw.path_pdf) {
        await run(db, 'UPDATE laws SET path_pdf = ?, updated_at = datetime("now") WHERE id = ?', [delLaw.path_pdf, keepId])
        keepLaw.path_pdf = delLaw.path_pdf
      }
      // Reassign segments, avoiding duplicates by (law_id, number, segment_type)
      const delSegs = await all<{ id: number; number: number; segment_type: string | null; text: string; page_hint: number | null }>(
        db,
        'SELECT id, number, segment_type, text, page_hint FROM segments WHERE law_id = ? ORDER BY id ASC',
        [delId]
      )
      for (const s of delSegs) {
        const existing = await get<{ id: number }>(
          db,
          'SELECT id FROM segments WHERE law_id = ? AND number = ? AND (segment_type IS ? OR segment_type = ?)',
          [keepId, s.number, s.segment_type, s.segment_type]
        )
        if (existing) {
          await run(db, 'DELETE FROM segments WHERE id = ?', [s.id])
          continue
        }
        await run(db, 'UPDATE segments SET law_id = ? WHERE id = ?', [keepId, s.id])
      }
      // Delete duplicate law
      await run(db, 'DELETE FROM laws WHERE id = ?', [delId])
    }
  }

  db.close()
}

main().catch((e) => {
  console.error('Auto-dedup failed:', e)
  process.exit(1)
})