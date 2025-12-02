const fs = require('node:fs')
const path = require('node:path')
const sqlite3 = require('sqlite3')

sqlite3.verbose()

function csvEscape(val) {
  if (val === null || val === undefined) return ''
  const s = String(val)
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

async function main() {
  const root = process.cwd()
  const dbPath = path.join(root, 'data', 'regulativa.db')
  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  // Optional filter: --jurisdiction=RS (default: none)
  const argJur = process.argv.find(a => a.startsWith('--jurisdiction='))
  const jurisdiction = argJur ? argJur.split('=')[1] : null

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
  const rows = await all(
    `SELECT id, jurisdiction, title, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf FROM laws ${where} ORDER BY id ASC`,
    params
  )

  console.log(`Empty rows count${jurisdiction ? ' (' + jurisdiction + ')' : ''}:`, rows.length)
  console.log('Sample (first 10):', rows.slice(0, 10))

  const outCsv = path.join(root, `empty_law_rows${jurisdiction ? '_' + jurisdiction : ''}.csv`)
  const header = ['id','jurisdiction','title','gazette_key','gazette_number','gazette_date','source_url','url_pdf','path_pdf']
  const lines = [header.join(',')]
  for (const r of rows) {
    const row = [r.id, r.jurisdiction, r.title, r.gazette_key, r.gazette_number, r.gazette_date, r.source_url, r.url_pdf, r.path_pdf].map(csvEscape)
    lines.push(row.join(','))
  }
  fs.writeFileSync(outCsv, lines.join('\n'), 'utf-8')
  console.log('CSV saved:', outCsv)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })