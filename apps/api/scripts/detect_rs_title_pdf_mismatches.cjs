const sqlite3 = require('sqlite3')
const path = require('node:path')
const fs = require('node:fs')

sqlite3.verbose()

function normalizeText(s) {
  if (!s) return ''
  const noDiacritics = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return noDiacritics
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // keep letters and numbers
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(s) {
  return normalizeText(s).split(' ').filter(w => w.length >= 2)
}

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const union = A.size + B.size - inter
  return union === 0 ? 0 : inter / union
}

function includesSimilarity(title, pdfName) {
  const t = normalizeText(title)
  const p = normalizeText(pdfName)
  if (!t || !p) return false
  // Check if a shortened title prefix appears in pdf name
  const prefix = t.split(' ').slice(0, 5).join(' ')
  return prefix && p.includes(prefix)
}

async function main() {
  const dbPath = path.join(process.cwd(), 'data', 'regulativa.db')
  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  const rows = await all("SELECT id, title, path_pdf FROM laws WHERE jurisdiction='RS' AND path_pdf IS NOT NULL AND path_pdf<>''")
  const issues = []
  for (const r of rows) {
    const pdfBasename = path.basename(r.path_pdf || '')
    const pdfName = pdfBasename.replace(/\.pdf$/i, '')
    const titleTokens = tokenize(r.title || '')
    const pdfTokens = tokenize(pdfName)
    const score = jaccard(titleTokens, pdfTokens)
    const passIncludes = includesSimilarity(r.title || '', pdfName)
    const isSuspicious = score < 0.35 && !passIncludes
    if (isSuspicious) {
      issues.push({ id: r.id, title: r.title, pdf_name: pdfBasename, path_pdf: r.path_pdf, similarity: Number(score.toFixed(3)), reason: 'low_similarity' })
    }
  }

  const outDir = path.join(process.cwd(), '..', '..', 'dumps')
  const outPath = path.join(outDir, 'rs_title_pdf_mismatches.json')
  const payload = { count: issues.length, threshold: 0.35, items: issues }
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8')
  console.log(`RS title/PDF mismatches: ${issues.length} (threshold 0.35)`)
  console.log(`Saved details to: ${outPath}`)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })