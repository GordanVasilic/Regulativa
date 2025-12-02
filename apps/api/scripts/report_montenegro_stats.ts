import path from 'node:path'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'
import fs from 'fs'

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

  const total = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora'")
  const withPdf = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND path_pdf IS NOT NULL AND path_pdf <> ''")
  const withLocalUrl = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND url_pdf LIKE 'http://localhost:%'")
  const missingDates = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND (gazette_date IS NULL OR gazette_date = '')")

  const missingPdf = Math.max(0, (total?.c || 0) - (withPdf?.c || 0))

  const base = {
    jurisdiction: 'Crna Gora',
    total: total?.c || 0,
    withPdf: withPdf?.c || 0,
    missingPdf,
    withLocalUrl: withLocalUrl?.c || 0,
    missingDates: missingDates?.c || 0,
  }

  const showDup = process.argv.some((a) => a.startsWith('--show-duplicates'))
  if (!showDup) {
    console.log(JSON.stringify(base, null, 2))
    db.close()
    return
  }

  const dups = await all<{ title: string; gazette_key: string; c: number }>(
    "SELECT title, gazette_key, COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND gazette_key IS NOT NULL GROUP BY title, gazette_key HAVING COUNT(*)>1 ORDER BY c DESC, title ASC LIMIT 20"
  )

  console.log(JSON.stringify({ ...base, duplicates: dups }, null, 2))
  db.close()
}

async function duplicatesBySize() {
  const fp = path.join('..', '..', 'Dokumenti', 'Crna Gora', 'zakoni_crna_gora_complete.xlsx')
  const wb = xlsx.readFile(fp)
  const rows = xlsx.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]], { defval: '' })

  const norm = (s: any) => String(s || '').trim()
  const titleOf = (r: any) => norm(r.Naziv || r.naziv || r.Title || r.title)
  const urlOf = (r: any) => norm(r.URL || r.url)
  const dateOf = (r: any) => {
    const raw = r.Datum || r.datum || r.Date || r.date || ''
    if (raw instanceof Date) return raw.toISOString().slice(0, 10)
    const s = norm(raw)
    const m = s.match(/(\d{4})/)
    const y = m ? m[1] : ''
    const parts = s.replace(/[^0-9]/g, ' ').trim().split(/\s+/)
    if (parts.length >= 3) {
      const [d, mo, yr] = parts
      if (yr?.length === 4) {
        const dd = d.padStart(2, '0')
        const mm = mo.padStart(2, '0')
        return `${yr}-${mm}-${dd}`
      }
    }
    return s
  }
  const yearOf = (r: any) => {
    const y = r.Godina || r.godina || ''
    const s = norm(y)
    if (s) return s
    const d = dateOf(r)
    const m = String(d).match(/(\d{4})/)
    return m ? m[1] : ''
  }

  const groups = new Map<string, { title: string; date: string; year: string; urls: string[] }>()
  for (const r of rows) {
    const t = titleOf(r)
    const d = dateOf(r)
    const y = yearOf(r)
    const u = urlOf(r)
    if (!t || !d || !y || !u) continue
    const key = `${t.toLowerCase()}|${d}|${y}`
    const g = groups.get(key) || { title: t, date: d, year: y, urls: [] }
    if (!g.urls.includes(u)) g.urls.push(u)
    groups.set(key, g)
  }

  const candidates = [...groups.values()].filter((g) => g.urls.length > 1)

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118 Safari/537.36',
    Accept: '*/*',
  }

  async function fetchSize(u: string): Promise<number | null> {
    try {
      const head = await fetch(u, { method: 'HEAD', headers })
      const cl = head.headers.get('content-length')
      if (cl) return parseInt(cl, 10)
    } catch {}
    try {
      const res = await fetch(u, { method: 'GET', headers })
      const ab = await res.arrayBuffer()
      return ab.byteLength
    } catch {
      return null
    }
  }

  const out: any[] = []
  for (const g of candidates) {
    const sizes: { url: string; size: number | null }[] = []
    for (const u of g.urls) {
      const sz = await fetchSize(u)
      sizes.push({ url: u, size: sz })
    }
    const concrete = sizes.filter((s) => typeof s.size === 'number') as { url: string; size: number }[]
    const distinct = new Set(concrete.map((s) => s.size))
    if (distinct.size > 1) {
      out.push({ title: g.title, date: g.date, year: g.year, files: sizes })
    }
    if (out.length >= 50) break
  }

  console.log(JSON.stringify({ count: out.length, items: out }, null, 2))
}

if (process.argv.some((a) => a.startsWith('--duplicates-by-size'))) {
  duplicatesBySize().catch((e) => {
    console.error(e)
    process.exit(1)
  })
} else {
  main().catch((e) => { console.error(e); process.exit(1) })
}

async function auditPdfs() {
  const ROOT = path.resolve(process.cwd(), '..', '..')
  const PDF_DIR = path.join(ROOT, 'Dokumenti', 'Crna Gora', 'PDF')
  const files = fs.readdirSync(PDF_DIR).filter((f) => f.toLowerCase().endsWith('.pdf'))

  const DB_PATH = path.join(process.cwd(), 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))

  const dbWithPdf = await get<{ c: number }>("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND path_pdf IS NOT NULL AND path_pdf<>''")
  const dbDistinctPdf = await get<{ c: number }>("SELECT COUNT(DISTINCT path_pdf) AS c FROM laws WHERE jurisdiction='Crna Gora' AND path_pdf IS NOT NULL AND path_pdf<>''")
  const dupPaths = await all<{ path_pdf: string; c: number }>("SELECT path_pdf, COUNT(*) AS c FROM laws WHERE jurisdiction='Crna Gora' AND path_pdf IS NOT NULL AND path_pdf<>'' GROUP BY path_pdf HAVING COUNT(*)>1 ORDER BY c DESC LIMIT 20")
  const sampleMissingOnDisk = (await all<{ id: number; title: string; path_pdf: string }>("SELECT id, title, path_pdf FROM laws WHERE jurisdiction='Crna Gora' AND path_pdf IS NOT NULL AND path_pdf<>''")).filter((r) => {
    try { return !fs.existsSync(r.path_pdf) } catch { return true }
  }).slice(0, 20)

  console.log(JSON.stringify({
    folderPdfCount: files.length,
    dbWithPdf: dbWithPdf?.c || 0,
    dbDistinctPdf: dbDistinctPdf?.c || 0,
    topDuplicatePaths: dupPaths,
    sampleMissingOnDisk,
  }, null, 2))
  db.close()
}

if (process.argv.some((a) => a.startsWith('--audit-pdf'))) {
  auditPdfs().catch((e) => { console.error(e); process.exit(1) })
}

main().catch((e) => { console.error(e); process.exit(1) })
