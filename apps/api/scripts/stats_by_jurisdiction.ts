import 'dotenv/config'
import path from 'node:path'
import sqlite3 from 'sqlite3'
import { MeiliSearch } from 'meilisearch'

function getDbPath() {
  const dbRel = process.env.DB_PATH || './data/regulativa.db'
  return path.resolve(process.cwd(), dbRel)
}

function all<T = any>(db: sqlite3.Database, sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as unknown as T[])))
  })
}

async function getMeiliCounts(jurisdictions: string[]) {
  const host = process.env.MEILI_HOST || ''
  const apiKey = process.env.MEILI_KEY || ''
  if (!host || !apiKey) return { laws: {}, segments: {}, enabled: false }
  const client = new MeiliSearch({ host, apiKey })
  await client.createIndex('laws', { primaryKey: 'id' }).catch(() => null)
  await client.createIndex('segments', { primaryKey: 'id' }).catch(() => null)
  const lawsIndex = client.index('laws')
  const segmentsIndex = client.index('segments')
  const laws: Record<string, number> = {}
  const segments: Record<string, number> = {}
  const lFacets: any = await lawsIndex.search('', { facets: ['jurisdiction'], limit: 0 })
  const sFacets: any = await segmentsIndex.search('', { facets: ['jurisdiction'], limit: 0 })
  const lDist = (lFacets && lFacets.facetDistribution && lFacets.facetDistribution.jurisdiction) || {}
  const sDist = (sFacets && sFacets.facetDistribution && sFacets.facetDistribution.jurisdiction) || {}
  for (const j of jurisdictions) {
    laws[j] = Number(lDist[j] || 0)
    segments[j] = Number(sDist[j] || 0)
  }
  const lStats: any = await lawsIndex.getStats()
  const sStats: any = await segmentsIndex.getStats()
  return {
    laws,
    segments,
    totals: {
      laws: Number(lStats.numberOfDocuments || 0),
      segments: Number(sStats.numberOfDocuments || 0)
    },
    enabled: true
  }
}

async function main() {
  sqlite3.verbose()
  const dbPath = getDbPath()
  const db = new sqlite3.Database(dbPath)
  try {
    const jurisdictionsRows = await all<{ jurisdiction: string }>(db, 'SELECT DISTINCT jurisdiction FROM laws ORDER BY jurisdiction')
    const jurisdictions = jurisdictionsRows.map((r) => r.jurisdiction)
    const totalsLaws = await all<{ c: number }>(db, 'SELECT COUNT(*) as c FROM laws')
    const totalsSegments = await all<{ c: number }>(db, 'SELECT COUNT(*) as c FROM segments')
    const totalsLawsWithPdf = await all<{ c: number }>(db, "SELECT COUNT(*) as c FROM laws WHERE path_pdf IS NOT NULL AND path_pdf <> ''")

    const breakdown: Record<string, any> = {}
    for (const j of jurisdictions) {
      const [{ c: lawsCount }] = await all<{ c: number }>(db, 'SELECT COUNT(*) as c FROM laws WHERE jurisdiction = ?', [j])
      const [{ c: pdfCount }] = await all<{ c: number }>(db, "SELECT COUNT(*) as c FROM laws WHERE jurisdiction = ? AND path_pdf IS NOT NULL AND path_pdf <> ''", [j])
      const [{ c: segLawsCount }] = await all<{ c: number }>(
        db,
        'SELECT COUNT(DISTINCT l.id) as c FROM laws l JOIN segments s ON s.law_id = l.id WHERE l.jurisdiction = ?',
        [j]
      )
      const [{ c: segmentsCount }] = await all<{ c: number }>(
        db,
        'SELECT COUNT(*) as c FROM segments s JOIN laws l ON l.id = s.law_id WHERE l.jurisdiction = ?',
        [j]
      )
      breakdown[j] = {
        laws: lawsCount,
        pdf_yes: pdfCount,
        pdf_no: lawsCount - pdfCount,
        laws_with_segments: segLawsCount,
        laws_without_segments: lawsCount - segLawsCount,
        segments: segmentsCount
      }
    }

    const meili = await getMeiliCounts(jurisdictions)
    if (meili.enabled) {
      for (const j of jurisdictions) {
        breakdown[j].meili_laws = meili.laws[j] || 0
        breakdown[j].meili_segments = meili.segments[j] || 0
      }
    }

    const result = {
      dbPath,
      totals: {
        laws: totalsLaws[0]?.c || 0,
        segments: totalsSegments[0]?.c || 0,
        laws_with_pdf: totalsLawsWithPdf[0]?.c || 0,
        meili_enabled: meili.enabled,
        meili_totals: meili.enabled ? meili.totals : undefined
      },
      breakdown
    }

    console.log(JSON.stringify(result, null, 2))
  } catch (e) {
    console.error(e)
    process.exit(1)
  } finally {
    db.close()
  }
}

main()
