import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const RS_PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')

sqlite3.verbose()

type LawRow = {
  id: number
  jurisdiction: string
  title: string
  gazette_key: string | null
  path_pdf: string | null
}

type PdfInfo = {
  fullPath: string
  baseName: string // without .pdf
  gazetteKey: string | null
  tokens: string[]
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

function normTokens(s: string): string[] {
  const stop = new Set([
    'zakon', 'o', 'u', 'od', 'i', 'za', 'o', 'o', 'prijedlog', 'nacrt',
    'izmjenama', 'dopunama', 'precisceni', 'prečišćeni', 'tekst', 'pr', 'tekst'
  ])
  const lower = String(s).toLowerCase()
  const translit = cyrToLat(lower)
  const t = stripDiacritics(translit).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return []
  return t.split(' ').filter((w) => w.length > 2 && !stop.has(w))
}

function extractGazetteKey(baseName: string): string | null {
  const m = baseName.match(/-([0-9]{1,3}_[0-9]{2})$/)
  return m ? m[1] : null
}

async function listRsPdfs(): Promise<PdfInfo[]> {
  const exists = await fs.pathExists(RS_PDF_DIR)
  if (!exists) throw new Error(`RS PDF dir not found: ${RS_PDF_DIR}`)
  const files = (await fs.readdir(RS_PDF_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf'))
  const infos: PdfInfo[] = []
  for (const f of files) {
    const base = path.basename(f, '.pdf')
    infos.push({
      fullPath: path.join(RS_PDF_DIR, f),
      baseName: base,
      gazetteKey: extractGazetteKey(base),
      tokens: normTokens(base)
    })
  }
  return infos
}

function bestPdfMatch(law: LawRow, pdfs: PdfInfo[]): PdfInfo | null {
  const lawTokens = normTokens(law.title || '')
  // Prefer exact gazette_key match if present. If multiple, pick highest token overlap.
  if (law.gazette_key) {
    const byKey = pdfs.filter((p) => p.gazetteKey === law.gazette_key)
    if (byKey.length) {
      let bestKey = byKey[0]
      let bestKeyScore = lawTokens.filter((t) => bestKey.tokens.includes(t)).length
      for (const p of byKey.slice(1)) {
        const score = lawTokens.filter((t) => p.tokens.includes(t)).length
        if (score > bestKeyScore) {
          bestKeyScore = score
          bestKey = p
        }
      }
      return bestKey
    }
  }
  // Otherwise, token overlap match across all PDFs
  let best: PdfInfo | null = null
  let bestScore = -1
  for (const p of pdfs) {
    const overlap = lawTokens.filter((t) => p.tokens.includes(t)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = p
    }
  }
  // Primary threshold: at least 2 overlapping tokens
  if (best && bestScore >= 2) return best
  // Fallback: if nothing reaches 2, allow 1 overlapping token when law has at least 3 tokens
  if (best && bestScore >= 1 && lawTokens.length >= 3) return best
  return null
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  })
}

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  await run(
    db,
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
    )`
  )

  const laws = await all<LawRow>(db, 'SELECT id, jurisdiction, title, gazette_key, path_pdf FROM laws WHERE jurisdiction = ? ORDER BY id ASC', ['RS'])
  const pdfs = await listRsPdfs()

  let updated = 0
  const changedIds: number[] = []
  for (const law of laws) {
    const current = law.path_pdf || ''
    const currentExists = current ? await fs.pathExists(current) : false
    const match = bestPdfMatch(law, pdfs)
    if (!match) {
      // If current path doesn't exist, try a very loose match: pick any PDF with gazette_key
      if (!currentExists && law.gazette_key) {
        const loose = pdfs.find((p) => p.gazetteKey === law.gazette_key)
        if (loose) {
          await run(db, 'UPDATE laws SET path_pdf = ?, updated_at = datetime("now") WHERE id = ?', [loose.fullPath, law.id])
          updated++
          changedIds.push(law.id)
          console.log(`Updated (loose) law_id=${law.id} -> ${path.basename(loose.fullPath)}`)
        }
      }
      continue
    }
    const next = match.fullPath
    if (path.resolve(current) !== path.resolve(next)) {
      await run(db, 'UPDATE laws SET path_pdf = ?, updated_at = datetime("now") WHERE id = ?', [next, law.id])
      updated++
      changedIds.push(law.id)
      console.log(`Updated law_id=${law.id} -> ${path.basename(next)}`)
    } else if (!currentExists) {
      // Current equals next but file missing: still report
      console.warn(`Warning: law_id=${law.id} path points to missing file: ${current}`)
    }
  }

  console.log(`Done. Updated: ${updated} laws.`)
  if (changedIds.length) {
    console.log(`Changed IDs: ${changedIds.join(', ')}`)
  }
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})