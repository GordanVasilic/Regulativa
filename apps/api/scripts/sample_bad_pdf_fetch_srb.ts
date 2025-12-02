import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'

function stripDiacritics(s: string) { return s.normalize('NFD').replace(/[\u0000-\u036f]/g, '') }
function normalizeTitle(s: string) { return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim() }
function looksPdf(u: string) { return /\.pdf(\?|$)/i.test(u) }

async function fetchHeadBytes(u: string): Promise<Buffer | null> {
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    return buf.slice(0, Math.min(buf.length, 16))
  } catch {
    return null
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const XLSX_PATH = path.join(ROOT, '..', '..', 'zakoni_srbija.xlsx')
  if (!(await fs.pathExists(DB_PATH))) throw new Error('DB not found')
  if (!(await fs.pathExists(XLSX_PATH))) throw new Error('XLSX not found')
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const laws = await all<{ id: number; title: string }>(`SELECT id, title FROM laws WHERE jurisdiction='SRB' AND (path_pdf IS NULL OR path_pdf='') ORDER BY id ASC LIMIT 2000`)

  const wb = xlsx.readFile(XLSX_PATH)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json<any>(sheet!, { defval: '' })
  const byNorm = new Map<string, { title: string; url: string }[]>()
  for (const row of rows) {
    const url = Object.values(row).find((v) => typeof v === 'string' && /^https?:\/\//i.test(String(v))) as string | undefined
    const title = Object.values(row).find((v) => typeof v === 'string' && !/^https?:\/\//i.test(String(v))) as string | undefined
    if (!url || !title) continue
    const key = normalizeTitle(title)
    const arr = byNorm.get(key) || []
    arr.push({ title, url })
    byNorm.set(key, arr)
  }

  const bad: any[] = []
  for (const law of laws) {
    const key = normalizeTitle(law.title)
    const candidates = byNorm.get(key) || []
    if (!candidates.length) continue
    const url = candidates[0].url
    if (!looksPdf(url)) {
      continue
    } else {
      const head = await fetchHeadBytes(url)
      if (!head) bad.push({ id: law.id, title: law.title, url, reason: 'download_failed_or_non_200' })
      else if (!head.toString('ascii').startsWith('%PDF-')) bad.push({ id: law.id, title: law.title, url, reason: 'not_a_pdf_content' })
    }
    if (bad.length >= 10) break
  }
  console.log(JSON.stringify(bad, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
