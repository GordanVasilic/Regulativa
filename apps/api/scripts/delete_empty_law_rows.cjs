const path = require('node:path')
const sqlite3 = require('sqlite3')

sqlite3.verbose()

async function main() {
  const root = process.cwd()
  const argDb = process.argv.find(a => a.startsWith('--db='))
  const dbPath = argDb ? path.resolve(root, argDb.split('=')[1]) : path.join(root, 'data', 'regulativa.db')
  const argJur = process.argv.find(a => a.startsWith('--jurisdiction='))
  const jurisdiction = argJur ? argJur.split('=')[1] : null
  const apply = process.argv.some(a => a === '--apply')

  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))
  const run = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function (err) { (err ? reject(err) : resolve(this)) }))

  const emptiesWhere = [
    "(jurisdiction IS NULL OR jurisdiction='')",
    "(title IS NULL OR title='')",
    "(title_normalized IS NULL OR title_normalized='')",
    "(slug IS NULL OR slug='')",
    "(doc_type IS NULL OR doc_type='')",
    "(gazette_key IS NULL OR gazette_key='')",
    "(gazette_number IS NULL OR gazette_number='')",
    "(gazette_date IS NULL OR gazette_date='')",
    "(source_url IS NULL OR source_url='')",
    "(url_pdf IS NULL OR url_pdf='')",
    "(path_pdf IS NULL OR path_pdf='')",
  ].join(' AND ')

  const where = jurisdiction ? `WHERE ${emptiesWhere} AND jurisdiction=?` : `WHERE ${emptiesWhere}`
  const params = jurisdiction ? [jurisdiction] : []

  console.log('DB path:', dbPath)
  const rows = await all(`SELECT id FROM laws ${where} ORDER BY id ASC`, params)
  const ids = rows.map(r => r.id)
  console.log(`Found empty rows${jurisdiction ? ' (' + jurisdiction + ')' : ''}:`, ids.length)
  console.log('IDs:', ids)

  if (!apply) {
    console.log('Dry-run: no changes applied. Use --apply to delete these rows.')
    db.close()
    return
  }

  if (ids.length === 0) {
    console.log('Nothing to delete.')
    db.close()
    return
  }

  await run('BEGIN')
  const placeholders = ids.map(() => '?').join(',')
  await run(`DELETE FROM laws WHERE id IN (${placeholders})`, ids)
  await run('COMMIT')
  console.log('Deleted rows count:', ids.length)

  const verify = await all(`SELECT id FROM laws ${where} ORDER BY id ASC`, params)
  console.log('Remaining empty rows after delete:', verify.map(v => v.id))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })