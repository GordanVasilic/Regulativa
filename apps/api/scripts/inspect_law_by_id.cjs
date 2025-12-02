const path = require('node:path')
const sqlite3 = require('sqlite3')

sqlite3.verbose()

async function main() {
  const root = process.cwd()
  const argDb = process.argv.find(a => a.startsWith('--db='))
  const dbPath = argDb ? path.resolve(root, argDb.split('=')[1]) : path.join(root, 'data', 'regulativa.db')
  const argId = process.argv.find(a => a.startsWith('--id='))
  const id = argId ? parseInt(argId.split('=')[1], 10) : NaN
  if (!Number.isFinite(id)) {
    console.error('Usage: node scripts/inspect_law_by_id.cjs --id=<ID> [--db=path/to.db]')
    process.exit(1)
  }

  const db = new sqlite3.Database(dbPath)
  const get = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))))

  console.log('DB path:', dbPath)
  console.log('Inspecting laws.id =', id)

  const row = await get('SELECT * FROM laws WHERE id = ?', [id])
  if (!row) {
    console.log('No row found for id', id)
    db.close()
    return
  }

  const isEmpty = (v) => v === null || v === undefined || String(v).trim() === ''
  const isEmptyTitleRobust = (t) => {
    if (t === null || t === undefined) return true
    const cleaned = String(t).replace(/\u00A0/g, ' ').trim()
    return cleaned.length === 0
  }

  const fields = ['jurisdiction','title','title_normalized','slug','doc_type','gazette_key','gazette_number','gazette_date','source_url','url_pdf','path_pdf']
  const empties = {}
  for (const f of fields) empties[f] = isEmpty(row[f])

  console.log('Row summary:')
  console.log({
    id: row.id,
    jurisdiction: row.jurisdiction,
    doc_type: row.doc_type,
    title: row.title,
    title_normalized: row.title_normalized,
    slug: row.slug,
    gazette_key: row.gazette_key,
    gazette_number: row.gazette_number,
    gazette_date: row.gazette_date,
    source_url: row.source_url,
    url_pdf: row.url_pdf,
    path_pdf: row.path_pdf,
  })

  console.log('Empty checks (simple trim):', empties)
  console.log('Empty title (robust NBSP trim):', isEmptyTitleRobust(row.title))
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })