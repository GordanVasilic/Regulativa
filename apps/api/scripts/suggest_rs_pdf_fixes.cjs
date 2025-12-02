const fs = require('node:fs')
const path = require('node:path')
const sqlite3 = require('sqlite3')

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
  const prefix = t.split(' ').slice(0, 5).join(' ')
  return prefix && p.includes(prefix)
}

function getGazetteSuffix(gazetteKey, gazetteNumber) {
  // Expect patterns like "59_08" or "65_12" from key or number
  const candidates = []
  const m1 = (gazetteKey || '').match(/(\d{1,3})_(\d{2})/) // e.g., 65_12
  if (m1) candidates.push(`${m1[1]}_${m1[2]}`)
  const m2 = (gazetteNumber || '').match(/(\d{1,3})\/(\d{2})/) // e.g., 65/12
  if (m2) candidates.push(`${m2[1]}_${m2[2]}`)
  return [...new Set(candidates)]
}

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  let files = []
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files = files.concat(walkDir(full))
    else files.push(full)
  }
  return files
}

async function main() {
  const root = process.cwd()
  const dbPath = path.join(root, 'data', 'regulativa.db')
  const mismatchesPath = path.join(root, '..', '..', 'dumps', 'rs_title_pdf_mismatches.json')
  const outJsonPath = path.join(root, '..', '..', 'dumps', 'rs_title_pdf_mismatches_suggested.json')
  const outCsvPath = path.join(root, 'detection_rs_pdf_mismatches_suggested.csv')

  const rsPdfDir = path.join(root, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')
  if (!fs.existsSync(mismatchesPath)) throw new Error('Missing mismatches JSON: ' + mismatchesPath)

  const mismatches = JSON.parse(fs.readFileSync(mismatchesPath, 'utf-8'))
  const items = mismatches.items || []

  const db = new sqlite3.Database(dbPath)
  const all = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows))))

  // Collect all candidate PDFs once
  const allPdfs = walkDir(rsPdfDir).filter(p => p.toLowerCase().endsWith('.pdf'))
  const pdfIndex = allPdfs.map(p => {
    const name = path.basename(p).replace(/\.pdf$/i, '')
    return { path: p, name, tokens: tokenize(name) }
  })

  const suggested = []
  for (const it of items) {
    const law = (await all('SELECT id, title, gazette_key, gazette_number FROM laws WHERE id=?', [it.id]))[0]
    const title = law?.title || it.title || ''
    const titleTokens = tokenize(title)
    const currentName = (it.pdf_name || '').replace(/\.pdf$/i, '')
    const currentTokens = tokenize(currentName)
    const currentScore = jaccard(titleTokens, currentTokens)
    const suffixes = getGazetteSuffix(law?.gazette_key, law?.gazette_number)

    const ranked = pdfIndex.map(p => {
      const baseScore = jaccard(titleTokens, p.tokens)
      const incPref = includesSimilarity(title, p.name) ? 0.2 : 0
      const hasSuffix = suffixes.some(suf => p.name.includes(suf))
      const sufBoost = hasSuffix ? 0.25 : 0
      const score = Math.min(1, baseScore + incPref + sufBoost)
      const reasons = []
      if (incPref) reasons.push('title_prefix_include')
      if (hasSuffix) reasons.push('gazette_suffix_match')
      return { pdf_name: p.name + '.pdf', path_pdf: p.path, score: Number(score.toFixed(3)), reasons }
    }).sort((a, b) => b.score - a.score)

    const top = ranked.slice(0, 3)
    suggested.push({
      id: it.id,
      title,
      current_pdf: it.pdf_name,
      current_similarity: Number(currentScore.toFixed(3)),
      gazette_key: law?.gazette_key || null,
      gazette_number: law?.gazette_number || null,
      suggestions: top,
    })
  }

  const payload = { count: suggested.length, items: suggested }
  fs.writeFileSync(outJsonPath, JSON.stringify(payload, null, 2), 'utf-8')

  // CSV export: id,title,current_pdf,current_similarity,suggested_pdf,suggested_path,score,reasons
  const lines = ['id,title,current_pdf,current_similarity,suggested_pdf,suggested_path,score,reasons']
  for (const s of suggested) {
    const top = s.suggestions[0]
    const row = [
      s.id,
      '"' + (s.title || '').replace(/"/g, '""') + '"',
      '"' + (s.current_pdf || '').replace(/"/g, '""') + '"',
      s.current_similarity,
      '"' + (top?.pdf_name || '').replace(/"/g, '""') + '"',
      '"' + (top?.path_pdf || '').replace(/"/g, '""') + '"',
      top?.score ?? '',
      '"' + ((top?.reasons || []).join('|')).replace(/"/g, '""') + '"',
    ]
    lines.push(row.join(','))
  }
  fs.writeFileSync(outCsvPath, lines.join('\n'), 'utf-8')

  console.log('Suggested fixes prepared:')
  console.log('JSON:', outJsonPath)
  console.log('CSV :', outCsvPath)
  db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })