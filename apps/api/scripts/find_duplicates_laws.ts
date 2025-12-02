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
  // Windows paths are case-insensitive; trim and lower for matching
  return path.normalize(p).trim().toLowerCase()
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
  })
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)

  const laws = await all<LawRow>(
    db,
    `SELECT id, jurisdiction, title, title_normalized, gazette_key, gazette_number, url_pdf, path_pdf FROM laws`
  )

  type GroupKey = string
  type Group = { key: GroupKey; jurisdiction: string; title: string; normTitle: string; gazette_key: string; docKey: string; ids: number[] }
  const groups = new Map<GroupKey, Group>()

  for (const l of laws) {
    const jurisdiction = String(l.jurisdiction || '').trim()
    const title = String(l.title || '').trim()
    const norm = l.title_normalized && l.title_normalized.trim() ? String(l.title_normalized).trim().toLowerCase() : normTitle(title)
    const gk = String(l.gazette_key || '').trim().toLowerCase()
    // Prefer path_pdf; if not present, fallback to url_pdf
    const docKeyRaw = normalizePath(l.path_pdf) || (l.url_pdf ? String(l.url_pdf).trim().toLowerCase() : null)
    if (!title || !gk || !docKeyRaw) continue // must have all three criteria
    const key = `${jurisdiction}||${norm}||${gk}||${docKeyRaw}`
    const existing = groups.get(key)
    if (existing) {
      existing.ids.push(l.id)
    } else {
      groups.set(key, { key, jurisdiction, title, normTitle: norm, gazette_key: gk, docKey: docKeyRaw, ids: [l.id] })
    }
  }

  const dups = Array.from(groups.values()).filter((g) => g.ids.length > 1)
  dups.sort((a, b) => a.jurisdiction.localeCompare(b.jurisdiction) || a.gazette_key.localeCompare(b.gazette_key) || a.normTitle.localeCompare(b.normTitle))

  if (dups.length === 0) {
    console.log('No exact duplicates found by (jurisdiction, normalized title, gazette_key, document).')
    db.close()
    return
  }

  console.log(`Found ${dups.length} duplicate groups.\n`)
  for (const g of dups) {
    const keepId = Math.min(...g.ids)
    const deleteIds = g.ids.filter((id) => id !== keepId)
    console.log(
      JSON.stringify(
        {
          jurisdiction: g.jurisdiction,
          title: g.title,
          title_normalized: g.normTitle,
          gazette_key: g.gazette_key,
          document: g.docKey,
          count: g.ids.length,
          ids: g.ids,
          suggestion: { keep: keepId, delete: deleteIds }
        },
        null,
        2
      )
    )
  }

  db.close()
}

main().catch((e) => {
  console.error('Duplicate detection failed:', e)
  process.exit(1)
})