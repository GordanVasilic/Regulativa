import path from 'node:path'
import sqlite3 from 'sqlite3'

// Utilities: normalize titles to compare reliably across diacritics and scripts
const stripDiacritics = (s: string) => s
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .replace(/Đ/g, 'D')
  .replace(/č/g, 'c')
  .replace(/Č/g, 'C')
  .replace(/ć/g, 'c')
  .replace(/Ć/g, 'C')
  .replace(/š/g, 's')
  .replace(/Š/g, 'S')
  .replace(/ž/g, 'z')
  .replace(/Ž/g, 'Z');

// Basic Cyrillic to Latin mapping for Bosnian/Serbian variants used in titles
const cyrToLat = (s: string) => s
  .replace(/А/g, 'A').replace(/а/g, 'a')
  .replace(/Б/g, 'B').replace(/б/g, 'b')
  .replace(/В/g, 'V').replace(/в/g, 'v')
  .replace(/Г/g, 'G').replace(/г/g, 'g')
  .replace(/Д/g, 'D').replace(/д/g, 'd')
  .replace(/Ђ/g, 'Đ').replace(/ђ/g, 'đ')
  .replace(/Е/g, 'E').replace(/е/g, 'e')
  .replace(/Ж/g, 'Ž').replace(/ж/g, 'ž')
  .replace(/З/g, 'Z').replace(/з/g, 'z')
  .replace(/И/g, 'I').replace(/и/g, 'i')
  .replace(/Ј/g, 'J').replace(/ј/g, 'j')
  .replace(/К/g, 'K').replace(/к/g, 'k')
  .replace(/Л/g, 'L').replace(/л/g, 'l')
  .replace(/Љ/g, 'Lj').replace(/љ/g, 'lj')
  .replace(/М/g, 'M').replace(/м/g, 'm')
  .replace(/Н/g, 'N').replace(/н/g, 'n')
  .replace(/Њ/g, 'Nj').replace(/њ/g, 'nj')
  .replace(/О/g, 'O').replace(/о/g, 'o')
  .replace(/П/g, 'P').replace(/п/g, 'p')
  .replace(/Р/g, 'R').replace(/р/g, 'r')
  .replace(/С/g, 'S').replace(/с/g, 's')
  .replace(/Т/g, 'T').replace(/т/g, 't')
  .replace(/Ћ/g, 'Ć').replace(/ћ/g, 'ć')
  .replace(/У/g, 'U').replace(/у/g, 'u')
  .replace(/Ф/g, 'F').replace(/ф/g, 'f')
  .replace(/Х/g, 'H').replace(/х/g, 'h')
  .replace(/Ц/g, 'C').replace(/ц/g, 'c')
  .replace(/Ч/g, 'Č').replace(/ч/g, 'č')
  .replace(/Џ/g, 'Dž').replace(/џ/g, 'dž')
  .replace(/Ш/g, 'Š').replace(/ш/g, 'š');

const normalizeTitle = (title: string) => stripDiacritics(cyrToLat(title))
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

type LawRow = {
  id: number;
  title: string;
  gazette_key: string | null;
  path_pdf: string | null;
  jurisdiction: string | null;
};

type SegmentRow = {
  id: number;
  law_id: number;
  number: number | null;
  segment_type: string | null;
};

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = process.env.DB_PATH ? path.resolve(process.env.DB_PATH) : path.join(DATA_DIR, 'regulativa.db')

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
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

async function main() {
  sqlite3.verbose()
  const db = new sqlite3.Database(DB_PATH)

  const laws: LawRow[] = await all(
    db,
    `SELECT id, title, gazette_key, path_pdf, jurisdiction
     FROM laws
     WHERE jurisdiction = 'Republika Srpska'`
  )

  const groups = new Map<string, LawRow[]>()
  for (const law of laws) {
    const gk = law.gazette_key?.trim()
    if (!gk) continue
    const normTitle = normalizeTitle(law.title || '')
    const key = `${gk}|${normTitle}`
    const arr = groups.get(key) || []
    arr.push(law)
    groups.set(key, arr)
  }

  let groupsProcessed = 0
  let lawsDeleted = 0
  let segsMoved = 0
  let segsDeleted = 0
  let pdfFixed = 0

  await run(db, 'BEGIN')
  try {
    for (const [_key, arr] of groups.entries()) {
      if (arr.length < 2) continue
      groupsProcessed++

      const canonical = [...arr].sort((a, b) => {
        const aHasPdf = a.path_pdf && a.path_pdf.length > 0 ? 1 : 0
        const bHasPdf = b.path_pdf && b.path_pdf.length > 0 ? 1 : 0
        if (bHasPdf !== aHasPdf) return bHasPdf - aHasPdf
        return a.id - b.id
      })[0]

      for (const dup of arr) {
        if (dup.id === canonical.id) continue

        if ((!canonical.path_pdf || canonical.path_pdf.length === 0) && dup.path_pdf && dup.path_pdf.length > 0) {
          await run(db, `UPDATE laws SET path_pdf = ? WHERE id = ?`, [dup.path_pdf, canonical.id])
          pdfFixed++
          canonical.path_pdf = dup.path_pdf
        }

        const dupSegs: SegmentRow[] = await all(
          db,
          `SELECT id, law_id, number, segment_type FROM segments WHERE law_id = ?`,
          [dup.id]
        )
        for (const s of dupSegs) {
          const exists = await get<{ id: number }>(
            db,
            `SELECT id FROM segments WHERE law_id = ? AND COALESCE(number, -1) = COALESCE(?, -1) AND COALESCE(segment_type, '') = COALESCE(?, '')`,
            [canonical.id, s.number, s.segment_type]
          )
          if (exists && exists.id) {
            await run(db, `DELETE FROM segments WHERE id = ?`, [s.id])
            segsDeleted++
          } else {
            await run(db, `UPDATE segments SET law_id = ? WHERE id = ?`, [canonical.id, s.id])
            segsMoved++
          }
        }

        await run(db, `DELETE FROM laws WHERE id = ?`, [dup.id])
        lawsDeleted++
      }
    }
    await run(db, 'COMMIT')
  } catch (e) {
    await run(db, 'ROLLBACK').catch(() => {})
    db.close()
    throw e
  }

  console.log('RS bulk dedup summary:')
  console.log(`Groups processed: ${groupsProcessed}`)
  console.log(`Laws deleted: ${lawsDeleted}`)
  console.log(`Segments moved: ${segsMoved}`)
  console.log(`Segments deleted (exact duplicates): ${segsDeleted}`)
  console.log(`Canonical PDFs fixed/copied: ${pdfFixed}`)

  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})