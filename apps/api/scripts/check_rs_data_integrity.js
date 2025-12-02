const sqlite3 = require('sqlite3')
const path = require('node:path')

sqlite3.verbose()

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DB_PATH = path.join(ROOT, 'data', 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  const counts = {}
  counts.missing_date = (await all("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='RS' AND (gazette_date IS NULL OR gazette_date='')"))[0].c
  counts.missing_key = (await all("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='RS' AND (gazette_key IS NULL OR gazette_key='')"))[0].c
  counts.missing_number = (await all("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='RS' AND (gazette_number IS NULL OR gazette_number='')"))[0].c
  counts.missing_source = (await all("SELECT COUNT(*) AS c FROM laws WHERE jurisdiction='RS' AND (source_url IS NULL OR source_url='')"))[0].c

  console.log('RS data integrity counts:', counts)
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})