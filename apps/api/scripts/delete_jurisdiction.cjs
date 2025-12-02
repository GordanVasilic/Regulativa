#!/usr/bin/env node
require('dotenv').config()
const path = require('node:path')
const sqlite3 = require('sqlite3')
const { MeiliSearch } = require('meilisearch')

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

sqlite3.verbose()
const db = new sqlite3.Database(DB_PATH)

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  })
}

async function deleteFromMeili(lawIds, jurisdictions) {
  const host = process.env.MEILI_HOST
  const apiKey = process.env.MEILI_KEY
  if (!host) {
    console.log('MEILI_HOST not set; skipping Meili cleanup.')
    return
  }
  const meili = new MeiliSearch({ host, apiKey })

  try {
    const lawsIndex = meili.index('laws')
    // Delete laws docs by jurisdiction filter
    for (const j of jurisdictions) {
      const res = await lawsIndex.search('', { limit: 10000, filter: `jurisdiction = "${j}"` })
      const ids = (res.hits || []).map((h) => h.id)
      if (ids.length) {
        console.log(`Meili: deleting ${ids.length} laws docs for jurisdiction ${j}`)
        await lawsIndex.deleteDocuments(ids)
      }
    }
  } catch (e) {
    console.warn('Meili laws cleanup failed:', e)
  }

  try {
    const segIndex = meili.index('segments')
    // Delete segment docs by law_id chunks
    const chunkSize = 1000
    for (let i = 0; i < lawIds.length; i += chunkSize) {
      const chunk = lawIds.slice(i, i + chunkSize)
      const filter = chunk.map((id) => `law_id = ${id}`).join(' OR ')
      const res = await segIndex.search('', { limit: 10000, filter })
      const ids = (res.hits || []).map((h) => h.id)
      if (ids.length) {
        console.log(`Meili: deleting ${ids.length} segment docs for law_id chunk ${i}/${lawIds.length}`)
        await segIndex.deleteDocuments(ids)
      }
    }
  } catch (e) {
    console.warn('Meili segments cleanup failed:', e)
  }
}

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  // Allow override: --jurisdiction "FBiH"
  const jArgIdx = args.indexOf('--jurisdiction')
  let jurisdictions = [
    'Federacija BiH',
    'FBiH',
    'Federacija Bosne i Hercegovine'
  ]
  if (jArgIdx !== -1 && args[jArgIdx + 1]) {
    jurisdictions = [String(args[jArgIdx + 1])]
  }

  const placeholders = jurisdictions.map(() => '?').join(',')
  const where = `WHERE LOWER(jurisdiction) IN (${jurisdictions.map(() => 'LOWER(?)').join(',')})`

  const rows = await all(`SELECT id FROM laws ${where} ORDER BY id ASC`, jurisdictions)
  const ids = rows.map((r) => r.id)
  console.log(`Found laws to delete for jurisdictions [${jurisdictions.join(', ')}]:`, ids.length)
  if (!ids.length) {
    console.log('No matching laws found. Exiting.')
    db.close()
    return
  }

  if (!apply) {
    console.log('Dry-run: no changes applied. Use --apply to perform deletion.')
    db.close()
    return
  }

  await run('BEGIN')
  try {
    // Delete dependent segments/files first
    const inPlaceholders = ids.map(() => '?').join(',')
    await run(`DELETE FROM segments WHERE law_id IN (${inPlaceholders})`, ids)
    await run(`DELETE FROM files WHERE law_id IN (${inPlaceholders})`, ids)
    await run(`DELETE FROM laws WHERE id IN (${inPlaceholders})`, ids)
    await run('COMMIT')
    console.log('Deletion committed. Total laws deleted:', ids.length)
  } catch (e) {
    await run('ROLLBACK').catch(() => null)
    console.error('Deletion failed, rolled back:', e)
    db.close()
    process.exit(1)
  }
  db.close()

  // Meili cleanup (optional)
  await deleteFromMeili(ids, jurisdictions)
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})