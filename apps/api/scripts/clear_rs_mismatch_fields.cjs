const fs = require('node:fs')
const path = require('node:path')
const sqlite3 = require('sqlite3')

sqlite3.verbose()

async function main() {
  const root = process.cwd()
  const dbPath = path.join(root, 'data', 'regulativa.db')
  const mismatchesPath = path.join(root, '..', '..', 'dumps', 'rs_title_pdf_mismatches.json')
  const dryRun = process.argv.includes('--dry-run')

  if (!fs.existsSync(mismatchesPath)) throw new Error('Nedostaje JSON: ' + mismatchesPath)
  const mismatches = JSON.parse(fs.readFileSync(mismatchesPath, 'utf-8'))
  const ids = (mismatches.items || []).map(it => it.id)
  const uniqueIds = [...new Set(ids)]

  const db = new sqlite3.Database(dbPath)
  const run = (sql, params=[]) => new Promise((resolve, reject)=> db.run(sql, params, function(err){ if(err) reject(err); else resolve(this) }))
  const all = (sql, params=[]) => new Promise((resolve, reject)=> db.all(sql, params, (err, rows)=> err?reject(err):resolve(rows)))

  console.log('Broj RS mismatch ID-ova:', uniqueIds.length)
  if (dryRun) {
    const sample = await all(`SELECT id, title, url_pdf, path_pdf, source_url FROM laws WHERE jurisdiction='RS' AND id IN (${uniqueIds.map(()=>'?').join(',')}) ORDER BY id ASC`, uniqueIds)
    console.log('DRY-RUN preview (prvih 5):', sample.slice(0,5))
    db.close()
    return
  }

  const placeholders = uniqueIds.map(()=>'?').join(',')
  const sql = `UPDATE laws SET url_pdf=NULL, path_pdf=NULL, source_url=NULL WHERE jurisdiction='RS' AND id IN (${placeholders})`
  const res = await run(sql, uniqueIds)
  console.log('Očišćeno zapisa (affected rows approx):', res.changes ?? 'n/a')

  const after = await all(`SELECT id, url_pdf, path_pdf, source_url FROM laws WHERE jurisdiction='RS' AND id IN (${placeholders}) ORDER BY id ASC`, uniqueIds)
  console.log('Verifikacija (prvih 5):', after.slice(0,5))
  db.close()
}

main().catch((e)=>{ console.error(e); process.exit(1) })