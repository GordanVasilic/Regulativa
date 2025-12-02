import sqlite3 from 'sqlite3'
import fs from 'fs'
import path from 'path'

const dbPath = 'd:/Projekti/Regulativa/apps/api/data/regulativa.db'
const db = new sqlite3.Database(dbPath)

function resolvePath(p: string) {
  if (!p) return ''
  if (path.isAbsolute(p)) return p
  return path.join('d:/Projekti/Regulativa', p)
}

db.all(
  "SELECT id, title, path_pdf FROM laws WHERE jurisdiction = 'Crna Gora'",
  [],
  (err, rows: any[]) => {
    if (err) {
      console.error('Error:', err)
      db.close()
      return
    }
    let total = 0
    let missing = 0
    const samples: { id: number; title: string; path: string }[] = []
    for (const r of rows) {
      total++
      const p = resolvePath(String(r.path_pdf || ''))
      const has = p && fs.existsSync(p)
      if (!has) {
        missing++
        if (samples.length < 20) samples.push({ id: r.id, title: r.title, path: p })
      }
    }
    console.log(JSON.stringify({ jurisdiction: 'Crna Gora', total_laws: total, missing_pdf: missing, with_pdf: total - missing, samples_missing: samples }, null, 2))
    db.close()
  }
)

