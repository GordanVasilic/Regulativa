import path from 'node:path'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

function normalizeTitle(input: string) {
  const map: Record<string, string> = { č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }
  return input.replace(/[čćžšđČĆŽŠĐ]/g, (ch) => map[ch] || ch).toLowerCase().replace(/\s+/g, ' ').trim()
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  const jurisdiction = 'RS'
  const title = 'Porodični zakon'
  const title_normalized = normalizeTitle(title)
  const gazette_key = '17_23'
  const gazette_number = '17'
  const gazette_date = '2023-02-23'
  const source_url = 'https://www.narodnaskupstinars.net/?q=la/akti/usvojeni-zakoni/porodi%C4%8Dni-zakon'
  const path_pdf = path.resolve('D:/Projekti/Regulativa/Dokumenti/RepublikaSrpska/PDF/Porodični zakon-17_23.pdf')

  const exists = await get<{ id: number }>('SELECT id FROM laws WHERE jurisdiction = ? AND gazette_key = ? AND title = ?', [jurisdiction, gazette_key, title])
  if (exists?.id) {
    console.log('Law already exists with same jurisdiction+gazette_key+title:', exists.id)
    db.close()
    return
  }
  const byPath = await get<{ id: number }>('SELECT id FROM laws WHERE path_pdf = ?', [path_pdf])
  if (byPath?.id) {
    console.log('Law already exists with same path_pdf:', byPath.id)
    db.close()
    return
  }

  await run(
    `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?)`,
    [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, source_url, path_pdf]
  )
  const row = await get<{ id: number }>('SELECT id FROM laws WHERE jurisdiction = ? AND gazette_key = ? AND title = ?', [jurisdiction, gazette_key, title])
  console.log('Inserted law id:', row?.id)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })