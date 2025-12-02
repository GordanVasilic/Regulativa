const sqlite3 = require('sqlite3')
const path = require('node:path')

sqlite3.verbose()

async function main() {
  const dbPath = path.join(process.cwd(), 'data', 'regulativa.db')
  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  const rows = await all("SELECT id, title, gazette_key, gazette_number, gazette_date, source_url FROM laws WHERE jurisdiction='RS' AND (gazette_date IS NULL OR gazette_date='') ORDER BY id ASC LIMIT 100")
  console.log('RS laws missing gazette_date (up to 100):')
  for (const r of rows) {
    console.log({ id: r.id, title: r.title, gazette_key: r.gazette_key, gazette_number: r.gazette_number, gazette_date: r.gazette_date, source_url: r.source_url })
  }
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })