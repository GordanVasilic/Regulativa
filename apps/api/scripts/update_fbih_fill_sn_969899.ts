import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'

sqlite3.verbose()

function stripDiacritics(s: string) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normalizeTitle(s: string) {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim()
}

function findUrlField(row: any): string | undefined {
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v
  }
  return undefined
}
function findTitleField(row: any): string | undefined {
  const keys = Object.keys(row)
  let best: string | undefined
  let bestScore = 0
  for (const k of keys) {
    const v = row[k]
    if (typeof v !== 'string') continue
    const t = v.trim()
    if (!t) continue
    if (/^https?:\/\//i.test(t)) continue
    const score = (/\bzakon\b/i.test(t) ? 3 : 0) + Math.min(t.length, 200)
    if (score > bestScore) { best = t; bestScore = score }
  }
  return best
}
function findNumericSn(row: any): number | null {
  for (const k of Object.keys(row)) {
    const v = row[k]
    if (typeof v === 'number' && v >= 1 && v <= 300) return v
    if (typeof v === 'string') {
      const t = v.trim()
      if (/^\d{1,3}$/.test(t)) return Number(t)
      const m = t.match(/\b(\d{1,3})\b/)
      if (m) return Number(m[1])
    }
  }
  return null
}
function yearFromUrl(url?: string): number | null {
  if (!url) return null
  const m = url.match(/\/(19\d{2}|20\d{2})\//)
  return m ? Number(m[1]) : null
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const XLSX_PATH = path.join(ROOT, '..', '..', 'fbihdo96-20.xlsx')

  if (!(await fs.pathExists(XLSX_PATH))) throw new Error(`Excel not found: ${XLSX_PATH}`)
  const wb = xlsx.readFile(XLSX_PATH)
  const sheetName = wb.SheetNames[0]
  const sheet = wb.Sheets[sheetName]
  const rows = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' })

  const targetYears = new Set([1996, 1998, 1999])
  const candidates: { title: string; norm: string; num: number; year: number }[] = []
  for (const row of rows) {
    const title = findTitleField(row) || ''
    const url = findUrlField(row) || ''
    if (!title || !url) continue
    const year = yearFromUrl(url)
    if (!year || !targetYears.has(year)) continue
    const num = findNumericSn(row)
    if (!num) continue
    candidates.push({ title, norm: normalizeTitle(title), num, year })
    if (candidates.length >= 20000) break
  }

  const db = new sqlite3.Database(DB_PATH)
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

  let updated = 0
  for (const c of candidates) {
    const row = await get<{ id: number }>(
      'SELECT id FROM laws WHERE jurisdiction = ? AND title_normalized = ? LIMIT 1',
      ['FBiH', c.norm]
    )
    if (!row?.id) continue
    const yy = String(c.year).slice(-2)
    const gazette_number = `${c.num}/${yy}`
    const gazette_key = `${c.num}_${yy}`
    await run('UPDATE laws SET gazette_number = ?, gazette_key = ?, updated_at = datetime("now") WHERE id = ?', [gazette_number, gazette_key, row.id])
    updated++
  }
  console.log(JSON.stringify({ ok: true, updated }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })