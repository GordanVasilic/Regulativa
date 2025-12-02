import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'

sqlite3.verbose()

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
const RS_PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'RepublikaSrpska', 'PDF')

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
  })
}

function normalize(p: string | null | undefined): string {
  return (p || '').trim().replace(/\\/g, '/').toLowerCase()
}

async function listPdfPathsNonRecursive(dir: string): Promise<string[]> {
  const exists = await fs.pathExists(dir)
  if (!exists) return []
  const files = await fs.readdir(dir)
  return files
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .map((f) => path.join(dir, f))
}

async function main() {
  const db = new sqlite3.Database(DB_PATH)
  try {
    const pdfs = await listPdfPathsNonRecursive(RS_PDF_DIR)
    const laws = await all<{ path_pdf: string | null }>(db, 'SELECT path_pdf FROM laws WHERE jurisdiction = ?', ['RS'])
    const lawPathSet = new Set(laws.map((l) => normalize(l.path_pdf)))

    const missing = pdfs.filter((full) => !lawPathSet.has(normalize(full)))

    const result = {
      jurisdiction: 'RS',
      pdf_dir: RS_PDF_DIR,
      totals: {
        total_pdfs_non_recursive: pdfs.length,
        total_laws_with_pdf: lawPathSet.size,
        missing_count: missing.length,
      },
      missing: missing.map((p) => ({ file: path.basename(p), path: p })),
    }

    console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})