import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import multer from 'multer'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import { open } from 'node:fs/promises'
import { MeiliSearch } from 'meilisearch'
import mammoth from 'mammoth'
import { pdfService } from './services/pdf.service'
import { parseSegments, parseSegmentsFromPdf, normalizeTitle } from './services/law-parsing.service'

const PORT = process.env.PORT ? Number(process.env.PORT) : 5000
const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const UPLOADS_DIR = path.join(ROOT, 'uploads')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

await fs.ensureDir(DATA_DIR)
await fs.ensureDir(UPLOADS_DIR)

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))
app.use(morgan('dev'))

// SQLite setup
sqlite3.verbose()
const db = new sqlite3.Database(DB_PATH)

function run(db: sqlite3.Database, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()))
  })
}
function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[])))
  })
}
function get<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T)))
  })
}

await run(
  db,
  `CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    path TEXT,
    text TEXT,
    source TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`
)

// Regulativa: osnovne tabele
await run(
  db,
  `CREATE TABLE IF NOT EXISTS laws (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    jurisdiction TEXT NOT NULL,
    title TEXT NOT NULL,
    title_normalized TEXT,
    slug TEXT,
    doc_type TEXT,
    gazette_key TEXT,
    gazette_number TEXT,
    gazette_date TEXT,
    source_url TEXT,
    url_pdf TEXT,
    path_pdf TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`
)

// Ensure usage tracking columns exist
try {
  await run(db, 'ALTER TABLE laws ADD COLUMN views_count INTEGER DEFAULT 0')
} catch (e) {
  // ignore if exists
}
try {
    await run(db, 'ALTER TABLE laws ADD COLUMN last_opened TEXT')
  } catch (e) {
    // ignore if exists
  }
  try {
    await run(db, 'ALTER TABLE laws ADD COLUMN text_content TEXT')
  } catch (e) {
    // ignore if exists
  }

await run(
  db,
  `CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id INTEGER,
    file_type TEXT,
    path TEXT,
    size INTEGER,
    pages INTEGER,
    hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (law_id) REFERENCES laws(id)
  )`
)

await run(
  db,
  `CREATE TABLE IF NOT EXISTS segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    law_id INTEGER NOT NULL,
    segment_type TEXT,
    label TEXT,
    number INTEGER,
    text TEXT,
    page_hint INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (law_id) REFERENCES laws(id)
  )`
)

// MeiliSearch setup (optional)
let meili: MeiliSearch | null = null
try {
  if (process.env.MEILI_HOST) {
    meili = new MeiliSearch({ host: process.env.MEILI_HOST!, apiKey: process.env.MEILI_KEY })
    // ensure index exists
    await meili.createIndex('documents', { primaryKey: 'id' }).catch(() => null)
    const index = meili.index('documents')
    await index.updateSettings({ searchableAttributes: ['title', 'text', 'source'], filterableAttributes: ['source'] })

    // Ensure laws index exists and is configured
    await meili.createIndex('laws', { primaryKey: 'id' }).catch(() => null)
    const lawsIndex = meili.index('laws')
    await lawsIndex.updateSettings({
      searchableAttributes: ['title', 'jurisdiction', 'gazette_key', 'title_normalized'],
      filterableAttributes: ['jurisdiction', 'gazette_key']
    })

    try {
      const laws = await all(db, 'SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf, title_normalized FROM laws')
      if (Array.isArray(laws) && laws.length) {
        await lawsIndex.addDocuments(laws)
      }
    } catch (e) {
      console.warn('MeiliSearch laws indexing failed:', e)
    }
  }
} catch (e) {
  console.warn('MeiliSearch init failed, continuing without it:', e)
  meili = null
}

// Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
})
const upload = multer({ storage })

// Health
app.get('/health', (_req, res) => {
  res.json({ ok: true, db: !!db, meili: !!meili, port: PORT })
})

// List documents
app.get('/documents', async (_req, res) => {
  try {
    const docs = await all(db, 'SELECT id, title, path, source, created_at FROM documents ORDER BY id DESC LIMIT 50')
    res.json(docs)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Get one document
app.get('/documents/:id', async (req, res) => {
  try {
    const doc = await get(db, 'SELECT * FROM documents WHERE id = ?', [req.params.id])
    if (!doc) return res.status(404).json({ error: 'Not found' })
    res.json(doc)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Search
app.get('/search', async (req, res) => {
  const q = String(req.query.q || '').trim()
  if (!q) return res.json([])
  try {
    if (meili) {
      const index = meili.index('documents')
      const result = await index.search(q, { limit: 20 })
      return res.json(result.hits)
    }
  } catch (e) {
    console.warn('MeiliSearch search failed, falling back to SQLite:', e)
  }
  try {
    const rows = await all(db, 'SELECT * FROM documents WHERE title LIKE ? OR text LIKE ? LIMIT 20', [`%${q}%`, `%${q}%`])
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Regulativa: laws API
app.get('/laws', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50)
    const offset = Number(req.query.offset || 0)
    const sort = String(req.query.sort || 'id_desc')
    const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : null
    const format = req.query.format ? String(req.query.format) : null
    const q = req.query.q ? String(req.query.q).trim() : null

    let orderBy = 'id DESC'
    if (sort === 'gazette_desc') {
      // Sort by gazette year (right part) DESC, then gazette number (left part) DESC; nulls last
      orderBy = `
        (gazette_key IS NULL OR gazette_key = '') ASC,
        CASE WHEN INSTR(gazette_key, '_') > 0 THEN CAST(SUBSTR(gazette_key, INSTR(gazette_key, '_') + 1) AS INTEGER)
             ELSE CAST(gazette_key AS INTEGER) END DESC,
        CASE WHEN INSTR(gazette_key, '_') > 0 THEN CAST(SUBSTR(gazette_key, 1, INSTR(gazette_key, '_') - 1) AS INTEGER)
             ELSE NULL END DESC,
        id DESC
      `
    } else if (sort === 'date_desc') {
      // Sort by gazette_date DESC, nulls last
      orderBy = `
        (gazette_date IS NULL) ASC,
        gazette_date DESC,
        id DESC
      `
    }
    
    const whereParts: string[] = []
    const params: any[] = []

    if (jurisdiction) {
      whereParts.push('jurisdiction = ?')
      params.push(jurisdiction)
    }

    if (q) {
      // Basic search on title or gazette_key
      whereParts.push('(title LIKE ? OR gazette_key LIKE ?)')
      params.push(`%${q}%`, `%${q}%`)
    }

    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : ''
    
    // Total count for pagination
    let total = 0
    if (format === 'paged') {
      const countRes = await get(db, `SELECT COUNT(*) as cnt FROM laws ${where}`, params)
      total = countRes?.cnt || 0
    }

    params.push(limit, offset)
    const rows = await all(
      db,
      `SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf, created_at, views_count, last_opened FROM laws ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      params
    )

    if (format === 'paged') {
      res.json({ data: rows, total, limit, offset })
    } else {
      res.json(rows)
    }
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Jurisdiction statistics
app.get('/laws/stats', async (_req, res) => {
  try {
    const rows = await all(
      db,
      `SELECT jurisdiction, COUNT(*) as count FROM laws GROUP BY jurisdiction ORDER BY count DESC`
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Top laws by usage
app.get('/laws/top', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 10)
    const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : null
    const where = jurisdiction ? 'WHERE jurisdiction = ?' : ''
    const params: any[] = []
    if (jurisdiction) params.push(jurisdiction)
    params.push(limit)
    const rows = await all(
      db,
      `SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf, views_count, last_opened FROM laws ${where} ORDER BY views_count DESC, (last_opened IS NULL), last_opened DESC LIMIT ?`,
      params
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/laws/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const limit = Number(req.query.limit || 50)
    const offset = Number(req.query.offset || 0)
    const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : null
    const gazetteKey = req.query.gazette_key ? String(req.query.gazette_key) : null
    if (!q) return res.json([])
    // Try MeiliSearch first if available
    if (meili) {
      try {
        const index = meili.index('laws')
        const filters: string[] = []
        if (jurisdiction) filters.push(`jurisdiction = "${jurisdiction}"`)
        if (gazetteKey) filters.push(`gazette_key = "${gazetteKey}"`)
        const result: any = await index.search(q, { limit, offset, filter: filters.length ? filters.join(' AND ') : undefined })
        const hits = Array.isArray(result.hits) ? result.hits : []
        if (hits.length) {
          const ids = hits.map((h: any) => Number(h.id)).filter((n: number) => !Number.isNaN(n))
          if (ids.length) {
            const placeholders = ids.map(() => '?').join(',')
            const rows = await all(db, `SELECT id, gazette_date FROM laws WHERE id IN (${placeholders})`, ids)
            const byId: Record<number, string | null> = {}
            for (const r of rows as any[]) byId[Number(r.id)] = r.gazette_date || null
            for (const h of hits) if (byId[h.id] && !h.gazette_date) h.gazette_date = byId[h.id]
          }
        }
        return res.json({ hits, total: result.estimatedTotalHits ?? undefined, limit, offset })
      } catch (e) {
        console.warn('MeiliSearch laws search failed, falling back to SQLite:', e)
      }
    }
    // Tokenize query and ignore article-specific noise like "član", numbers
    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const norm = (s: string) => stripDiacritics(s).toLowerCase()
    const rawTokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    const meaningful = rawTokens
      .map((t) => ({ raw: t, n: norm(t) }))
      .filter((t) => t.n.length >= 3)
      .filter((t) => !/^\d+$/.test(t.n))
      .filter((t) => !/^(clan|cl|cl\.|clanak|cl\.?|clanak)$/.test(t.n))

    // Build WHERE with AND across meaningful tokens so all must match
    const where: string[] = []
    const params: any[] = []
    if (meaningful.length === 0) {
      // fallback to whole query if nothing meaningful remains
      where.push('(title LIKE ? OR title_normalized LIKE ?)')
      params.push(`%${q}%`, `%${norm(q)}%`)
    } else {
      for (const t of meaningful) {
        where.push('(title LIKE ? OR title_normalized LIKE ?)')
        params.push(`%${t.raw}%`, `%${t.n}%`)
      }
    }
    if (jurisdiction) {
      where.push('jurisdiction = ?')
      params.push(jurisdiction)
    }
    if (gazetteKey) {
      where.push('gazette_key LIKE ?')
      params.push(`%${gazetteKey}%`)
    }
    const rows = await all(
      db,
      `SELECT id, jurisdiction, title, gazette_key, gazette_date, path_pdf FROM laws WHERE ${where.join(' AND ')} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    )
    const totalRows = await get(
      db,
      `SELECT COUNT(*) as cnt FROM laws WHERE ${where.join(' AND ')}`,
      params
    )
    res.json({ hits: rows, total: Number(totalRows?.cnt || rows.length), limit, offset })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/laws/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const law = await get(db, 'SELECT * FROM laws WHERE id = ?', [id])
    if (!law) return res.status(404).json({ error: 'Not found' })
    
    // If text_content is missing, reconstruct from segments
    if (!law.text_content) {
        const segments = await all(db, 'SELECT label, text FROM segments WHERE law_id = ? ORDER BY id ASC', [id])
        if (segments.length > 0) {
            // Reconstruct text: join segment texts.
            // Note: Parser stores full text in segment.text, including label if regex matched.
            // But let's check if we need to add label explicitly?
            // Usually segment.text is the full article content.
            // If label is "Član 1", text is "Član 1\nTekst...".
            // So joining by newlines is enough.
            law.text_content = segments.map(s => s.text).join('\n\n')
        }
    }
    
    res.json(law)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/laws/:id', async (req, res) => {
  try {
    const law = await get(db, 'SELECT * FROM laws WHERE id = ?', [req.params.id])
    if (!law) return res.status(404).json({ error: 'Not found' })
    res.json(law)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Track law open (increment views_count and set last_opened)
app.post('/laws/:id/open', async (req, res) => {
  try {
    const id = Number(req.params.id)
    await run(db, 'UPDATE laws SET views_count = COALESCE(views_count, 0) + 1, last_opened = datetime("now") WHERE id = ?', [id])
    const law = await get(db, 'SELECT id, views_count, last_opened FROM laws WHERE id = ?', [id])
    res.json({ ok: true, law })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Serve law PDF by id
app.get('/pdf/:id', async (req, res) => {
  try {
    const law = await get(db, 'SELECT id, path_pdf FROM laws WHERE id = ?', [req.params.id])
    if (!law || !law.path_pdf) return res.status(404).json({ error: 'PDF not found' })
    const abs = path.resolve(String(law.path_pdf))
    if (!(await fs.pathExists(abs))) return res.status(404).json({ error: 'File missing' })
    res.sendFile(abs)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Preview: serve generated FBiH registry HTML for manual review
app.get('/api/test/fbih/preview', async (_req, res) => {
  try {
    const primary = path.join(process.cwd(), 'tmp', 'fbih_registry_preview.html')
    const alias = path.join(process.cwd(), 'tmp', 'fbih_single_article_preview.html')
    const target = (await fs.pathExists(primary)) ? primary : (await fs.pathExists(alias)) ? alias : null
    if (!target) return res.status(404).send('Preview not found. Run extract_fbih_year_registry.ts first.')
    res.sendFile(target)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Segments API
app.get('/segments', async (req, res) => {
  try {
    const lawId = req.query.law_id ? Number(req.query.law_id) : null
    const limit = Number(req.query.limit || 50)
    if (lawId) {
      const rows = await all(
        db,
        'SELECT id, law_id, segment_type, label, number, page_hint FROM segments WHERE law_id = ? ORDER BY number ASC LIMIT ?',
        [lawId, limit]
      )
      return res.json(rows)
    }
    const rows = await all(
      db,
      'SELECT id, law_id, segment_type, label, number, page_hint FROM segments ORDER BY id DESC LIMIT ?',
      [limit]
    )
    res.json(rows)
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/segments/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim()
    const limit = Number(req.query.limit || 50)
    const offset = Number(req.query.offset || 0)
    const jurisdiction = req.query.jurisdiction ? String(req.query.jurisdiction) : null
    const lawIdFilter = req.query.law_id ? Number(req.query.law_id) : null
    const gazetteKey = req.query.gazette_key ? String(req.query.gazette_key) : null
    if (!q) return res.json([])
    // Detect intent for specific article number (e.g., "član 4", "cl. 4")
    const lowerQ = q.toLowerCase()
    // Try match with diacritics first, then after stripping diacritics
    const m1 = lowerQ.match(/(?:\b[čc]lan(?:ak)?\b|\b[čc]l\.?\b)\s*(\d{1,4})/i)
    const normQ = lowerQ.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const m2 = m1 || normQ.match(/(?:\bclan(?:ak)?\b|\bcl\.?\b)\s*(\d{1,4})/i)
    const m = m2
    const articleNum = m ? Number(m[1]) : null
    // Ako nije tražen precizan zakon (law_id/gazette_key) i Meili je dostupan — koristi Meili (uključujući i kada je prisutan broj člana)
    if ((lawIdFilter === null && !gazetteKey) && meili) {
      try {
        const index = meili.index('segments')
        const baseFilters: string[] = []
        if (jurisdiction) baseFilters.push(`jurisdiction = "${jurisdiction}"`)
        if (lawIdFilter !== null) baseFilters.push(`law_id = ${lawIdFilter}`)
        if (gazetteKey) baseFilters.push(`gazette_key = "${gazetteKey}"`)
        // Two-pass search: prioritize exact article matches first, then fill with general results
        if (articleNum !== null && offset === 0) {
          const primary: any = await index.search(q, {
            limit,
            offset: 0,
            filter: baseFilters.concat([`number = ${articleNum}`]).join(' AND ')
          })
          const already = new Set((primary.hits || []).map((h: any) => h.id))
          const secondary: any = await index.search(q, {
            limit: Math.max(0, limit - (primary.hits?.length || 0)),
            offset: 0,
            filter: baseFilters.length ? baseFilters.join(' AND ') : undefined
          })
          const merged = [...(primary.hits || []), ...((secondary.hits || []).filter((h: any) => !already.has(h.id)))]
          const total = secondary.estimatedTotalHits ?? merged.length
          if (merged.length > 0) return res.json({ hits: merged.slice(0, limit), total, limit, offset })
        } else {
          const result: any = await index.search(q, { limit, offset, filter: baseFilters.length ? baseFilters.join(' AND ') : undefined })
          const hits = Array.isArray(result.hits) ? result.hits : []
          if (hits.length > 0) return res.json({ hits, total: result.estimatedTotalHits ?? undefined, limit, offset })
        }
      } catch (e) {
        console.warn('MeiliSearch segments search failed, falling back to SQLite:', e)
      }
    }
    // Tokenize query i ignoriši članske riječi i brojeve
    const stripDiacritics = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    const norm = (s: string) => stripDiacritics(s).toLowerCase()
    const rawTokens = q.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    const meaningful = rawTokens
      .map((t) => ({ raw: t, n: norm(t) }))
      .filter((t) => t.n.length >= 3)
      .filter((t) => !/^\d+$/.test(t.n))
      .filter((t) => !/^(clan|cl|cl\.|clanak|clanako?|član|čl|čl\.|članak)$/.test(t.n))

    // Build WHERE: combine jurisdiction with (article match OR token matches)
    const whereClauses: string[] = []
    const whereParams: any[] = []
    const contentClauses: string[] = []
    const contentParams: any[] = []

    if (articleNum !== null) {
      contentClauses.push('s.number = ?')
      contentParams.push(articleNum)
    }

    if (meaningful.length > 0) {
      const tokenParts: string[] = []
      for (const t of meaningful) {
        // Match in segment text/label and law title (including normalized for diacritics)
        tokenParts.push('(s.text LIKE ? OR s.label LIKE ? OR l.title LIKE ? OR l.title_normalized LIKE ?)')
        contentParams.push(`%${t.raw}%`, `%${t.raw}%`, `%${t.raw}%`, `%${norm(t.raw)}%`)
      }
      contentClauses.push(tokenParts.join(' AND '))
    }

    if (contentClauses.length === 0) {
      // Fallback to whole query if nothing meaningful remains
      contentClauses.push('(s.text LIKE ? OR s.label LIKE ? OR l.title LIKE ? OR l.title_normalized LIKE ?)')
      contentParams.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${norm(q)}%`)
    }

    // Combine content with OR to allow selecting a specific article even if other tokens don't match
    whereClauses.push(`(${contentClauses.join(' OR ')})`)
    whereParams.push(...contentParams)

    if (jurisdiction) {
      whereClauses.push('l.jurisdiction = ?')
      whereParams.push(jurisdiction)
    }
    if (lawIdFilter !== null) {
      whereClauses.push('l.id = ?')
      whereParams.push(lawIdFilter)
    }
    if (gazetteKey) {
      whereClauses.push('l.gazette_key = ?')
      whereParams.push(gazetteKey)
    }

    // Pripremi frazu zakona (upit bez dijela "član X") za dodatni boost tačne fraze naslova
    const lawPhraseRaw = q.replace(/(?:\b[čc]lan(?:ak)?\b|\b[čc]l\.?\b)\s*\d{1,4}/i, '').trim()
    const lawPhraseNorm = norm(lawPhraseRaw)

    // Scoring: prioritet naslov → labela → tekst; boost za tačan broj člana; dodatni boost za frazu naslova
    const scoringTokens = meaningful.length > 0 ? meaningful : [{ raw: q, n: norm(q) }]
    const scoreExprParts: string[] = []
    const scoreParams: any[] = []
    if (lawPhraseRaw.length >= 5) {
      scoreExprParts.push('CASE WHEN LOWER(l.title) = LOWER(?) THEN 400 ELSE 0 END')
      scoreParams.push(lawPhraseRaw)
      scoreExprParts.push('CASE WHEN LOWER(l.title_normalized) = LOWER(?) THEN 400 ELSE 0 END')
      scoreParams.push(lawPhraseNorm)
      scoreExprParts.push('CASE WHEN l.title LIKE ? THEN 200 ELSE 0 END')
      scoreParams.push(`%${lawPhraseRaw}%`)
      scoreExprParts.push('CASE WHEN l.title_normalized LIKE ? THEN 200 ELSE 0 END')
      scoreParams.push(`%${lawPhraseNorm}%`)
      scoreExprParts.push("CASE WHEN LOWER(l.title) LIKE 'zakon o izmenama%' THEN -120 ELSE 0 END")
      scoreExprParts.push("CASE WHEN LOWER(l.title) LIKE 'zakon o dopun%' THEN -120 ELSE 0 END")
    }
    for (const t of scoringTokens) {
      scoreExprParts.push('CASE WHEN l.title LIKE ? THEN 40 ELSE 0 END')
      scoreParams.push(`%${t.raw}%`)
      scoreExprParts.push('CASE WHEN l.title_normalized LIKE ? THEN 40 ELSE 0 END')
      scoreParams.push(`%${t.n}%`)
      scoreExprParts.push('CASE WHEN s.label LIKE ? THEN 10 ELSE 0 END')
      scoreParams.push(`%${t.raw}%`)
      scoreExprParts.push('CASE WHEN s.text LIKE ? THEN 4 ELSE 0 END')
      scoreParams.push(`%${t.raw}%`)
    }
    if (articleNum !== null) {
      scoreExprParts.push('CASE WHEN s.number = ? THEN 50 ELSE 0 END')
      scoreParams.push(articleNum)
    }

    const rows = await all(
      db,
      `SELECT s.id, s.law_id, s.label, s.number, s.page_hint, s.text,
              l.title AS law_title, l.path_pdf, l.gazette_key, l.gazette_date, l.jurisdiction,
              (${scoreExprParts.length ? scoreExprParts.join(' + ') : '0'}) AS score
       FROM segments s
       JOIN laws l ON l.id = s.law_id
       WHERE ${whereClauses.join(' AND ')}
       ORDER BY score DESC, s.id ASC
       LIMIT ? OFFSET ?`,
      [...scoreParams, ...whereParams, limit, offset]
    )
    const totalRows = await get(
      db,
      `SELECT COUNT(*) as cnt
       FROM segments s
       JOIN laws l ON l.id = s.law_id
       WHERE ${whereClauses.join(' AND ')}`,
      whereParams
    )
    res.json({ hits: rows, total: Number(totalRows?.cnt || rows.length), limit, offset })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// Upload and ingest
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file
    if (!file) return res.status(400).json({ error: 'No file' })
    const ext = path.extname(file.originalname).toLowerCase()
    let text = ''
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: file.path })
      text = result.value
    } else if (ext === '.txt') {
      text = await fs.readFile(file.path, 'utf8')
    } else {
      text = '' // placeholder; PDF/other handlers can be added later
    }
    const title = path.basename(file.originalname)
    await run(db, 'INSERT INTO documents (title, path, text, source) VALUES (?, ?, ?, ?)', [title, file.path, text, 'upload'])
    const doc = await get(db, 'SELECT * FROM documents ORDER BY id DESC LIMIT 1')
    if (meili && doc) {
      try {
        await meili.index('documents').addDocuments([{ id: doc.id, title: doc.title, text: doc.text, source: doc.source }])
      } catch (e) {
        console.warn('Meili add failed:', e)
      }
    }
    res.json({ ok: true, id: doc?.id })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})


// Admin: Add new law manually
app.post('/api/admin/laws', async (req, res) => {
  try {
    const { title, jurisdiction, date, gazette_key, text } = req.body
    if (!title || !jurisdiction || !text) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // 1. Generate PDF
    const path_pdf = await pdfService.generatePdf(title, text, jurisdiction, gazette_key)

    // 2. Insert into DB
    const title_normalized = normalizeTitle(title)
    await run(
      db,
      `INSERT INTO laws (jurisdiction, title, title_normalized, gazette_key, gazette_date, path_pdf, text_content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [jurisdiction, title, title_normalized, gazette_key || null, date || null, path_pdf, text]
    )
    
    const law = await get(db, 'SELECT id, title, jurisdiction, gazette_key, title_normalized FROM laws WHERE path_pdf = ? ORDER BY id DESC LIMIT 1', [path_pdf])
    if (!law) throw new Error('Failed to retrieve inserted law')

    // 3. Parse Segments (from generated PDF to get correct page hints)
    const segments = await parseSegmentsFromPdf(path_pdf)
    
    // 4. Insert Segments
    for (const s of segments) {
      await run(
        db,
        'INSERT INTO segments (law_id, segment_type, label, number, text, page_hint) VALUES (?, ?, ?, ?, ?, ?)',
        [law.id, 'article', s.label, s.number, s.text, s.page_hint]
      )
    }

    // 5. Index to MeiliSearch
    if (meili) {
      try {
        // Index Law
        await meili.index('laws').addDocuments([{
          id: law.id,
          title: law.title,
          jurisdiction: law.jurisdiction,
          gazette_key: law.gazette_key,
          title_normalized: law.title_normalized
        }])

        // Index Segments
        const insertedSegments = await all(db, 'SELECT id, label, number, text FROM segments WHERE law_id = ?', [law.id])
        const meiliDocs = insertedSegments.map(s => ({
          id: s.id,
          law_id: law.id,
          label: s.label,
          number: s.number,
          text: s.text,
          law_title: law.title,
          jurisdiction: law.jurisdiction,
          gazette_key: law.gazette_key
        }))
        await meili.index('segments').addDocuments(meiliDocs)
      } catch (e) {
        console.warn('Meili indexing failed for manual law:', e)
      }
    }

    res.json({ ok: true, id: law.id, segments_count: segments.length })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

// Admin: Delete law
app.delete('/api/admin/laws/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const law = await get(db, 'SELECT * FROM laws WHERE id = ?', [id])
    if (!law) return res.status(404).json({ error: 'Not found' })

    // 1. Delete from MeiliSearch
    if (meili) {
      try {
        await meili.index('laws').deleteDocument(id)
        
        // Get segment IDs to delete from Meili
        const segments = await all(db, 'SELECT id FROM segments WHERE law_id = ?', [id])
        const segmentIds = segments.map(s => s.id)
        if (segmentIds.length > 0) {
          await meili.index('segments').deleteDocuments(segmentIds)
        }
      } catch (e) {
        console.warn('Meili delete failed:', e)
      }
    }

    // 2. Delete PDF file
    if (law.path_pdf) {
      const absPath = path.resolve(law.path_pdf) // law.path_pdf is likely absolute or relative to root
      // Check if it's absolute
      const finalPath = path.isAbsolute(law.path_pdf) ? law.path_pdf : path.resolve(process.cwd(), law.path_pdf)
      
      try {
        if (await fs.pathExists(finalPath)) {
          await fs.remove(finalPath)
        }
      } catch (e) {
        console.warn('File delete failed:', e)
      }
    }

    // 3. Delete from SQLite
    await run(db, 'DELETE FROM segments WHERE law_id = ?', [id])
    await run(db, 'DELETE FROM files WHERE law_id = ?', [id])
    await run(db, 'DELETE FROM laws WHERE id = ?', [id])

    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

// Admin: Edit law (re-parse text if provided)
app.put('/api/admin/laws/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    const { title, jurisdiction, date, gazette_key, text } = req.body
    
    if (!title || !jurisdiction) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    const existing = await get(db, 'SELECT * FROM laws WHERE id = ?', [id])
    if (!existing) return res.status(404).json({ error: 'Law not found' })

    // 1. Update Metadata
    const title_normalized = normalizeTitle(title)
    await run(
      db,
      `UPDATE laws 
       SET title = ?, jurisdiction = ?, gazette_key = ?, gazette_date = ?, title_normalized = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [title, jurisdiction, gazette_key || null, date || null, title_normalized, id]
    )

    // 2. Handle Text Update (if provided and different)
    // Note: If text is provided, we regenerate PDF and segments.
    // If text is NOT provided (e.g. metadata only edit), we skip this.
    // Ideally frontend should send text if it wants to edit it.
    
    if (text) {
        // Save raw text if we support it (adding column if missing)
        try {
            await run(db, 'UPDATE laws SET text_content = ? WHERE id = ?', [text, id])
        } catch (e) {
            // Column might not exist, ignore or migrate
        }

        // Regenerate PDF
        // Remove old PDF if path changes? Path is derived from title + gazette.
        // If title changed, we might want to delete old file.
        // For simplicity, generate new PDF and update path.
        // Old PDF might remain as orphan if we don't delete it.
        if (existing.path_pdf) {
            try {
                const oldPath = path.resolve(existing.path_pdf)
                if (await fs.pathExists(oldPath)) await fs.remove(oldPath)
            } catch {}
        }

        const path_pdf = await pdfService.generatePdf(title, text, jurisdiction, gazette_key)
        await run(db, 'UPDATE laws SET path_pdf = ? WHERE id = ?', [path_pdf, id])

        // Re-parse Segments
        // 1. Fetch old segment IDs to delete from Meili
        const oldSegments = await all(db, 'SELECT id FROM segments WHERE law_id = ?', [id])
        const oldSegmentIds = oldSegments.map(s => s.id)

        // 2. Delete from Meili (if exists)
        if (meili && oldSegmentIds.length > 0) {
            try {
                await meili.index('segments').deleteDocuments(oldSegmentIds)
            } catch (e) {
                console.warn('Failed to delete old segments from Meili:', e)
            }
        }

        // 3. Delete old segments from SQLite
        await run(db, 'DELETE FROM segments WHERE law_id = ?', [id])

        // Parse new
        const segments = await parseSegmentsFromPdf(path_pdf)
        for (const s of segments) {
            await run(
                db,
                'INSERT INTO segments (law_id, segment_type, label, number, text, page_hint) VALUES (?, ?, ?, ?, ?, ?)',
                [id, 'article', s.label, s.number, s.text, s.page_hint]
            )
        }

        // Update MeiliSearch Segments
        if (meili) {
            try {
                // Index new segments
                const insertedSegments = await all(db, 'SELECT id, label, number, text FROM segments WHERE law_id = ?', [id])
                const meiliDocs = insertedSegments.map(s => ({
                    id: s.id,
                    law_id: id,
                    label: s.label,
                    number: s.number,
                    text: s.text,
                    law_title: title,
                    jurisdiction: jurisdiction,
                    gazette_key: gazette_key
                }))
                await meili.index('segments').addDocuments(meiliDocs)
            } catch (e) {
                console.warn('Meili re-indexing failed:', e)
            }
        }
    }

    // Update MeiliSearch Law Metadata
    if (meili) {
        try {
            await meili.index('laws').addDocuments([{
                id: id,
                title: title,
                jurisdiction: jurisdiction,
                gazette_key: gazette_key,
                title_normalized: title_normalized
            }])
        } catch (e) {
             console.warn('Meili law update failed:', e)
        }
    }

    res.json({ ok: true })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: String(e) })
  }
})

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`)
})
