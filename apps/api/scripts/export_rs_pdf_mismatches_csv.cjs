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
  const mismatchesPath = path.join(root, '..', '..', 'dumps', 'rs_title_pdf_mismatches.json')
  const outCsvPath = path.join(root, 'detection_rs_pdf_mismatches_manual_review.csv')

  if (!fs.existsSync(mismatchesPath)) throw new Error('Nedostaje JSON: ' + mismatchesPath)
  const mismatches = JSON.parse(fs.readFileSync(mismatchesPath, 'utf-8'))
  const items = mismatches.items || []

  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  const header = [
    'id',
    'title',
    'db_path_pdf',
    'db_pdf_name',
    'mismatch_pdf_name',
    'mismatch_path_pdf',
    'similarity',
    'gazette_key',
    'gazette_number',
    'gazette_date',
    'source_url',
    'review_notes',
    'new_path_pdf'
  ]
  const lines = [header.join(',')]

  for (const it of items) {
    const lawRows = await all('SELECT id, title, path_pdf, gazette_key, gazette_number, gazette_date, source_url FROM laws WHERE id=?', [it.id])
    const law = lawRows[0] || {}
    const dbPdfName = law.path_pdf ? path.basename(law.path_pdf) : ''
    const row = [
      law.id ?? it.id,
      law.title ?? it.title ?? '',
      law.path_pdf ?? '',
      dbPdfName,
      it.pdf_name ?? '',
      it.path_pdf ?? '',
      it.similarity ?? '',
      law.gazette_key ?? '',
      law.gazette_number ?? '',
      law.gazette_date ?? '',
      law.source_url ?? '',
      '',
      ''
    ].map(csvEscape)
    lines.push(row.join(','))
  }

  fs.writeFileSync(outCsvPath, lines.join('\n'), 'utf-8')
  console.log('CSV generisan:', outCsvPath)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })