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
  const argDb = process.argv.find(a => a.startsWith('--db='))
  const dbPath = argDb ? path.resolve(root, argDb.split('=')[1]) : path.join(root, 'data', 'regulativa.db')
  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  const argJur = process.argv.find(a => a.startsWith('--jurisdiction='))
  const jurisdiction = argJur ? argJur.split('=')[1] : null

  const whereJur = jurisdiction ? `WHERE jurisdiction=?` : ''
  const params = jurisdiction ? [jurisdiction] : []

  // Učitaj kandidate i filtriraj u JS: title null ili samo whitespace/NBSP
  const candidates = await all(
    `SELECT id, jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf
     FROM laws ${whereJur}
     ORDER BY id ASC`,
    params
  )

  const isEmptyTitle = (t) => {
    if (t === null || t === undefined) return true
    const cleaned = String(t).replace(/\u00A0/g, ' ').trim()
    return cleaned.length === 0
  }

  const rows = candidates.filter(r => isEmptyTitle(r.title))

  console.log(`DB path: ${dbPath}`)
  console.log(`Rows with empty title${jurisdiction ? ' (' + jurisdiction + ')' : ''}:`, rows.length)
  console.log('Sample (first 10):', rows.slice(0, 10))

  const outCsv = path.join(root, `empty_title_rows${jurisdiction ? '_' + jurisdiction : ''}.csv`)
  const header = ['id','jurisdiction','title','title_normalized','slug','doc_type','gazette_key','gazette_number','gazette_date','source_url','url_pdf','path_pdf']
  const lines = [header.join(',')]
  for (const r of rows) {
    const row = [
      r.id,
      r.jurisdiction,
      r.title,
      r.title_normalized,
      r.slug,
      r.doc_type,
      r.gazette_key,
      r.gazette_number,
      r.gazette_date,
      r.source_url,
      r.url_pdf,
      r.path_pdf,
    ].map(csvEscape)
    lines.push(row.join(','))
  }
  fs.writeFileSync(outCsv, lines.join('\n'), 'utf-8')
  console.log('CSV saved:', outCsv)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })