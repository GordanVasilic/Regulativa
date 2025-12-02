import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

type PreviewItem = {
  id: number
  title: string
  gazette_key: string | null
  gazette_number: string | null
  current_date: string | null
  proposed_date: string | null
  source_url: string | null
}

function getArgFlag(name: string): boolean {
  const arg = process.argv.find((a) => a === `--${name}`)
  return !!arg
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const PREVIEW_PATH = path.join(ROOT, '..', '..', 'dumps', 'rs_gazette_dates_preview.json')

  const dryRun = getArgFlag('dry-run')
  const force = getArgFlag('force')

  const exists = await fs.pathExists(PREVIEW_PATH)
  if (!exists) {
    console.error('Nema preview fajla:', PREVIEW_PATH)
    process.exit(1)
  }

  const preview = await fs.readJson(PREVIEW_PATH)
  const items: PreviewItem[] = preview.items || []

  const db = new sqlite3.Database(DB_PATH)
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  let considered = 0
  let skippedNoProposal = 0
  let skippedAlreadyHasDate = 0
  let updated = 0

  for (const it of items) {
    considered++
    if (!it.proposed_date) {
      skippedNoProposal++
      continue
    }
    if (dryRun) {
      const row = await all<{ gazette_date?: string | null; source_url?: string | null }>('SELECT gazette_date, source_url FROM laws WHERE id = ?', [it.id])
      const hasDate = row.length && !!(row[0].gazette_date && row[0].gazette_date.trim())
      if (!force && hasDate) {
        skippedAlreadyHasDate++
      } else {
        updated++
      }
      continue
    }

    if (force) {
      await run('UPDATE laws SET gazette_date = ?, source_url = COALESCE(source_url, ?) WHERE id = ?', [it.proposed_date, it.source_url || null, it.id])
      updated++
    } else {
      const row = await all<{ id: number; gazette_date?: string | null }>('SELECT id, gazette_date FROM laws WHERE id = ?', [it.id])
      const hasDate = row.length && !!(row[0].gazette_date && row[0].gazette_date.trim())
      if (hasDate) {
        skippedAlreadyHasDate++
      } else {
        await run('UPDATE laws SET gazette_date = ?, source_url = COALESCE(source_url, ?) WHERE id = ?', [it.proposed_date, it.source_url || null, it.id])
        updated++
      }
    }
  }

  console.log('Rezime upisa:')
  console.log('  considered', considered)
  console.log('  updated', updated)
  console.log('  skippedNoProposal', skippedNoProposal)
  console.log('  skippedAlreadyHasDate', skippedAlreadyHasDate)

  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})