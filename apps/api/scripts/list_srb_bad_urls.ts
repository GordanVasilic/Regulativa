import path from 'node:path'
import sqlite3 from 'sqlite3'
import fs from 'fs-extra'

sqlite3.verbose()

function isUsable(u?: string | null): boolean {
  if (!u) return false
  const l = String(u).toLowerCase()
  return /(\.pdf|\.zip|\.docx?|\.rtf)(\?|$)/.test(l)
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const dbPaths = [
    path.join(ROOT, 'data', 'regulativa.db'),
    path.join(path.dirname(ROOT), 'data', 'regulativa.db')
  ]
  const DB_PATH = dbPaths.find((p) => fs.existsSync(p)) || dbPaths[0]
  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  try {
    const rows = await all<{ id: number; title: string; source_url: string | null; url_pdf: string | null }>(
      `SELECT id, title, source_url, url_pdf
       FROM laws
       WHERE jurisdiction = 'SRB' AND (path_pdf IS NULL OR path_pdf = '')
       ORDER BY id ASC
       LIMIT 5000`
    )
    const bad: any[] = []
    for (const r of rows) {
      const su = r.source_url || ''
      const up = r.url_pdf || ''
      const anyUrl = su || up
      if (!anyUrl) continue
      const usable = isUsable(su) || isUsable(up)
      if (!usable) {
        bad.push({ id: r.id, title: r.title, source_url: su || null, url_pdf: up || null })
        if (bad.length >= 10) break
      }
    }
    console.log(JSON.stringify(bad, null, 2))
  } catch (e) {
    console.error('Query failed:', e)
    process.exit(1)
  } finally {
    db.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })

