import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')

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

async function main() {
  await fs.ensureDir(DATA_DIR)
  const db = new sqlite3.Database(DB_PATH)

  const run = (sql: string, params: any[] = []) =>
    new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) =>
    new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

  const exists = await fs.pathExists(PDF_DIR)
  if (!exists) {
    console.error('PDF direktorijum ne postoji:', PDF_DIR)
    process.exit(1)
  }

  // Ensure tables exist (mirror of server setup)
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
  await new Promise<void>((resolve, reject) =>
    db.run(
      `CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        law_id INTEGER,
        file_type TEXT,
        path TEXT,
        size INTEGER,
        pages INTEGER,
        hash TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (law_id) REFERENCES laws(id)
      )`,
      [],
      (err) => (err ? reject(err) : resolve())
    )
  )

  const files = (await fs.readdir(PDF_DIR)).filter((f) => f.toLowerCase().endsWith('.pdf'))
  let inserted = 0
  let skipped = 0

  for (const file of files) {
    const fullPath = path.join(PDF_DIR, file)
    const base = path.basename(file, '.pdf')
    // Očekujemo: Naziv-55_25 ili samo Naziv
    const m = base.match(/^(.*?)-([0-9]{1,3}_[0-9]{2})$/)
    const title = m ? m[1] : base
    const gazette_key = m ? m[2] : null
    const jurisdiction = 'RS'
    const title_normalized = normalizeTitle(title)

    const existing = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [fullPath])
    if (existing?.id) {
      skipped++
      continue
    }

    await run(
      `INSERT INTO laws (jurisdiction, title, title_normalized, gazette_key, path_pdf) VALUES (?, ?, ?, ?, ?)`,
      [jurisdiction, title, title_normalized, gazette_key, fullPath]
    )
    inserted++
  }

  console.log(`Gotovo. Umetnuto: ${inserted}, Preskočeno: ${skipped}, Ukupno PDF: ${files.length}`)
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})