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
  gazette_key: string | null
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
  const lower = String(s).toLowerCase()
  const translit = cyrToLat(lower)
  const t = stripDiacritics(translit).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  return t
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  })
}

function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
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
      return [k.replace(/^--?/, '').toUpperCase(), v]
    })
  ) as Record<string, string>

  const KEEP = Number(args.KEEP)
  const DELETE = Number(args.DELETE)
  if (!KEEP || !DELETE) {
    console.error('Usage: tsx scripts/deduplicate_rs_laws.ts --KEEP=<id> --DELETE=<id>')
    process.exit(1)
  }
  if (KEEP === DELETE) {
    console.error('KEEP and DELETE must be different IDs.')
    process.exit(1)
  }

  const db = new sqlite3.Database(DB_PATH)

  const keepLaw = await get<LawRow>(db, 'SELECT * FROM laws WHERE id = ?', [KEEP])
  const delLaw = await get<LawRow>(db, 'SELECT * FROM laws WHERE id = ?', [DELETE])
  if (!keepLaw || !delLaw) {
    console.error('One of the laws not found.')
    process.exit(1)
  }
  if (keepLaw.jurisdiction !== 'RS' || delLaw.jurisdiction !== 'RS') {
    console.error('Both laws must be in RS jurisdiction.')
    process.exit(1)
  }

  const sameGk = keepLaw.gazette_key && delLaw.gazette_key && keepLaw.gazette_key === delLaw.gazette_key
  const sameTitleNorm = normTitle(keepLaw.title) === normTitle(delLaw.title)
  console.log(`KEEP ${KEEP}: "${keepLaw.title}" gk=${keepLaw.gazette_key} path=${keepLaw.path_pdf}`)
  console.log(`DEL  ${DELETE}: "${delLaw.title}" gk=${delLaw.gazette_key} path=${delLaw.path_pdf}`)
  console.log(`same gazette_key=${!!sameGk}, same normalized title=${sameTitleNorm}`)

  // If keepLaw has empty path_pdf and delLaw has one, migrate it
  if ((!keepLaw.path_pdf || keepLaw.path_pdf.trim() === '') && delLaw.path_pdf) {
    await run(db, 'UPDATE laws SET path_pdf = ?, updated_at = datetime("now") WHERE id = ?', [delLaw.path_pdf, KEEP])
    console.log(`Migrated path_pdf to KEEP id=${KEEP}`)
  }

  // Conflict-aware reassignment of segments from DELETE to KEEP
  const delSegs = await all<{ id: number; number: number; segment_type: string | null; text: string; page_hint: number | null }>(
    db,
    'SELECT id, number, segment_type, text, page_hint FROM segments WHERE law_id = ? ORDER BY id ASC',
    [DELETE]
  )
  let moved = 0
  let skipped = 0
  let removedDup = 0
  for (const s of delSegs) {
    const existing = await get<{ id: number }>(
      db,
      'SELECT id FROM segments WHERE law_id = ? AND number = ? AND (segment_type IS ? OR segment_type = ?)',
      [KEEP, s.number, s.segment_type, s.segment_type]
    )
    if (existing) {
      // Duplicate by (law_id, number, segment_type) exists; remove the duplicate from DELETE
      await run(db, 'DELETE FROM segments WHERE id = ?', [s.id])
      removedDup++
      continue
    }
    await run(db, 'UPDATE segments SET law_id = ? WHERE id = ?', [KEEP, s.id])
    moved++
  }
  console.log(`Segments processed from ${DELETE}: moved=${moved}, removed_duplicates=${removedDup}, skipped=${skipped}`)

  // Delete duplicate law entry
  await run(db, 'DELETE FROM laws WHERE id = ?', [DELETE])
  console.log(`Deleted duplicate law id=${DELETE}`)

  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})