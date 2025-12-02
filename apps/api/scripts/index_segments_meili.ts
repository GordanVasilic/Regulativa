import 'dotenv/config'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { MeiliSearch } from 'meilisearch'
import fs from 'fs-extra'

const ROOT = path.resolve(process.cwd())
const DATA_DIR = path.join(ROOT, 'data')
const DB_PATH = path.join(DATA_DIR, 'regulativa.db')

sqlite3.verbose()
const db = new sqlite3.Database(DB_PATH)

function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  })
}

async function main() {
  const host = process.env.MEILI_HOST
  const apiKey = process.env.MEILI_KEY
  if (!host) {
    console.error('MEILI_HOST is not set. Skipping indexing.')
    process.exit(1)
  }
  const meili = new MeiliSearch({ host, apiKey })
  if (process.env.AUDIT_HEURISTICS === '1') {
    const sqliteRows: any[] = await all(
      "SELECT l.id AS law_id, l.title, l.jurisdiction, COUNT(*) AS cnt FROM segments s JOIN laws l ON l.id = s.law_id WHERE s.text LIKE 'Heuristički%' GROUP BY l.id, l.title, l.jurisdiction ORDER BY cnt DESC"
    )
    const byJur: any = {}
    for (const r of sqliteRows) byJur[r.jurisdiction] = (byJur[r.jurisdiction] || 0) + 1
    console.log(JSON.stringify({ sqlite: { total_laws_with_heuristics: sqliteRows.length, by_jurisdiction: byJur, top10: sqliteRows.slice(0, 10) } }, null, 2))
    await meili.createIndex('segments', { primaryKey: 'id' }).catch(() => null)
    const indexAudit = meili.index('segments')
    const agg: any = {}
    let offset = 0
    const limit = 1000
    while (true) {
      const res: any = await indexAudit.search('Heuristički', { limit, offset })
      const hits = Array.isArray(res.hits) ? res.hits : []
      if (!hits.length) break
      for (const h of hits) {
        const k = `${h.law_id}|${h.jurisdiction}`
        agg[k] = (agg[k] || 0) + 1
      }
      offset += hits.length
      if (hits.length < limit) break
    }
    const meiliAgg = Object.entries(agg).map(([k, v]: any) => { const [law_id, jurisdiction] = String(k).split('|'); return { law_id: Number(law_id), jurisdiction, cnt: Number(v) } }).sort((a: any, b: any) => b.cnt - a.cnt)
    const totalDocs = meiliAgg.reduce((a: number, b: any) => a + b.cnt, 0)
    console.log(JSON.stringify({ meili: { total_docs: totalDocs, count_laws: meiliAgg.length, top10: meiliAgg.slice(0, 10) } }, null, 2))
    process.exit(0)
  }
  await meili.createIndex('segments', { primaryKey: 'id' }).catch(() => null)
  const index = meili.index('segments')
  await index.updateSettings({
    // Prioritize matches in the label (e.g., "Član 4") to improve ranking
    searchableAttributes: ['label', 'text', 'law_title'],
    filterableAttributes: ['law_id', 'number', 'jurisdiction', 'gazette_key'],
    // Common synonyms to normalize queries with/without dijakritike and skraćenice
    synonyms: {
      clan: ['član', 'cl.', 'čl', 'čl.', 'članak', 'clanak'],
      'član': ['clan', 'cl.', 'čl', 'čl.', 'članak', 'clanak'],
      clanak: ['član', 'clan', 'članak', 'cl.', 'čl', 'čl.'],
      'članak': ['član', 'clan', 'clanak', 'cl.', 'čl', 'čl.'],
      pozar: ['požar', 'požara'],
      pozara: ['požara', 'požar']
    }
  })
  const oneLawId = process.env.LAW_ID ? Number(process.env.LAW_ID) : null
  const jurisdiction = process.env.JURISDICTION ? String(process.env.JURISDICTION) : null
  if (!oneLawId && !jurisdiction) {
    await index.deleteAllDocuments().catch(() => null)
  } else if (oneLawId) {
    try {
      const limit = 1000
      const filter = `law_id = ${oneLawId}`
      // Prefer native delete by filter if supported by client
      const anyIndex: any = index as any
      if (typeof anyIndex.deleteDocuments === 'function') {
        try {
          await anyIndex.deleteDocuments({ filter })
        } catch {
          // Fallback to paged deletion
          while (true) {
            const res: any = await index.search('', { filter, limit })
            const hits = Array.isArray(res.hits) ? res.hits : []
            if (!hits.length) break
            const ids = hits.map((h: any) => h.id)
            await index.deleteDocuments(ids)
          }
        }
      } else {
        // Fallback to paged deletion
        while (true) {
          const res: any = await index.search('', { filter, limit })
          const hits = Array.isArray(res.hits) ? res.hits : []
          if (!hits.length) break
          const ids = hits.map((h: any) => h.id)
          await index.deleteDocuments(ids)
        }
      }
    } catch (e) {
      console.warn('Failed to clean existing documents for LAW_ID', oneLawId, e)
    }
  }

  if (jurisdiction && !oneLawId) {
    const lawIds = await all<{ id: number }>(`SELECT id FROM laws WHERE jurisdiction = ?`, [jurisdiction])
    if (!lawIds.length) {
      console.log(`No laws found for jurisdiction=${jurisdiction}.`)
      process.exit(0)
    }
    const limit = 1000
    for (const li of lawIds) {
      try {
        const filter = `law_id = ${li.id}`
        const anyIndex: any = index as any
        if (typeof anyIndex.deleteDocuments === 'function') {
          try { await anyIndex.deleteDocuments({ filter }) } catch {
            while (true) {
              const res: any = await index.search('', { filter, limit })
              const hits = Array.isArray(res.hits) ? res.hits : []
              if (!hits.length) break
              const ids = hits.map((h: any) => h.id)
              await index.deleteDocuments(ids)
            }
          }
        } else {
          while (true) {
            const res: any = await index.search('', { filter, limit })
            const hits = Array.isArray(res.hits) ? res.hits : []
            if (!hits.length) break
            const ids = hits.map((h: any) => h.id)
            await index.deleteDocuments(ids)
          }
        }
        const rowsJur = await all(`
          SELECT s.id, s.law_id, s.label, s.number, s.text, s.page_hint,
                 l.title AS law_title, l.path_pdf, l.jurisdiction, l.gazette_key, l.gazette_date
          FROM segments s
          JOIN laws l ON l.id = s.law_id
          WHERE s.law_id = ?
          ORDER BY s.id ASC
        `, [li.id])
        const filtered = rowsJur.filter((r: any) => !/^Heuristički/i.test(String(r.text || '')))
        if (!filtered.length) continue
        const chunksize = 1000
        for (let i = 0; i < filtered.length; i += chunksize) {
          const chunk = filtered.slice(i, i + chunksize)
          await index.addDocuments(chunk)
        }
        console.log(`Indexed law_id=${li.id} (${filtered.length} documents) for jurisdiction=${jurisdiction}`)
      } catch (e) {
        console.warn(`Failed indexing law_id=${li.id}:`, e)
      }
    }
    console.log('Done.')
    process.exit(0)
  }

  let rows = oneLawId
    ? await all(`
    SELECT s.id, s.law_id, s.label, s.number, s.text, s.page_hint,
           l.title AS law_title, l.path_pdf, l.jurisdiction, l.gazette_key, l.gazette_date
    FROM segments s
    JOIN laws l ON l.id = s.law_id
    WHERE s.law_id = ?
    ORDER BY s.id ASC
  `, [oneLawId])
    : await all(`
    SELECT s.id, s.law_id, s.label, s.number, s.text, s.page_hint,
           l.title AS law_title, l.path_pdf, l.jurisdiction, l.gazette_key, l.gazette_date
    FROM segments s
    JOIN laws l ON l.id = s.law_id
    ORDER BY s.id ASC
  `)

  rows = rows.filter((r: any) => !/^Heuristički/i.test(String(r.text || '')))

  if (!rows.length) {
    console.log('No segments found to index.')
    process.exit(0)
  }

  console.log(`Indexing ${rows.length} segments to MeiliSearch...`)
  const chunksize = 1000
  for (let i = 0; i < rows.length; i += chunksize) {
    const chunk = rows.slice(i, i + chunksize)
    await index.addDocuments(chunk)
    console.log(`Indexed ${Math.min(i + chunksize, rows.length)}/${rows.length}`)
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error('Indexing failed:', e)
  process.exit(1)
})
