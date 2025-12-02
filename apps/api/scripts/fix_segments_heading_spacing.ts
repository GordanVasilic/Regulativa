import path from 'node:path'
import sqlite3 from 'sqlite3'
import fs from 'fs-extra'

sqlite3.verbose()

function fixText(s: string): string {
  let out = s
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+lan/g, 'Član')
  out = out.replace(/C[\s\u00A0\u2000-\u200B]+lan/g, 'Clan')
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+l\./g, 'Čl.')
  out = out.replace(/Ч[\s\u00A0\u2000-\u200B]+лан/g, 'Члан')
  return out
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
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  const jurisdictions = process.env.JURISDICTION ? [String(process.env.JURISDICTION)] : ['SRB', 'RS', 'BRCKO', 'Crna Gora']
  const report: Record<string, number> = {}
  for (const jur of jurisdictions) {
    const rows = await all<{ id: number; text: string }>(
      `SELECT s.id, s.text FROM segments s JOIN laws l ON l.id = s.law_id WHERE l.jurisdiction = ?`,
      [jur]
    )
    let changed = 0
    for (const r of rows) {
      const fixed = fixText(String(r.text || ''))
      if (fixed !== r.text) {
        await run(`UPDATE segments SET text = ?, updated_at = datetime('now') WHERE id = ?`, [fixed, r.id])
        changed++
      }
    }
    report[jur] = changed
  }
  console.log(JSON.stringify({ updated_by_jurisdiction: report }, null, 2))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
