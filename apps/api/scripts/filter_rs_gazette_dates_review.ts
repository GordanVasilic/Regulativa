import path from 'node:path'
import fs from 'fs-extra'

type PreviewItem = {
  id: number
  title: string
  gazette_key: string | null
  gazette_number: string | null
  current_date: string | null
  proposed_date: string | null
  source_url: string | null
}

function expectedNumberFromKey(key: string | null): string | null {
  if (!key) return null
  const m = key.match(/^(\d{1,3})_(\d{2})$/)
  if (!m) return null
  return `${m[1]}/${m[2]}`
}

function yearFromKey(key: string | null): number | null {
  if (!key) return null
  const m = key.match(/_(\d{2})$/)
  if (!m) return null
  const yy = Number(m[1])
  return yy < 50 ? 2000 + yy : 1900 + yy
}

function yearFromISO(date: string | null): number | null {
  if (!date) return null
  const m = date.match(/^(\d{4})-\d{2}-\d{2}$/)
  return m ? Number(m[1]) : null
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const PREVIEW_PATH = path.join(ROOT, '..', '..', 'dumps', 'rs_gazette_dates_preview.json')
  const OUT_PATH = path.join(ROOT, '..', '..', 'dumps', 'rs_gazette_dates_review.json')

  const exists = await fs.pathExists(PREVIEW_PATH)
  if (!exists) {
    console.error('Nema preview fajla:', PREVIEW_PATH)
    process.exit(1)
  }

  const data = await fs.readJson(PREVIEW_PATH)
  const items: PreviewItem[] = data.items || []

  const flagged: Array<PreviewItem & { flags: string[] }> = []
  const counts: Record<string, number> = {}

  for (const it of items) {
    const flags: string[] = []
    if (!it.title || !it.title.trim()) flags.push('empty_title')
    const expectedNum = expectedNumberFromKey(it.gazette_key)
    if (expectedNum && it.gazette_number && it.gazette_number !== expectedNum) flags.push('key_number_mismatch')
    const ey = yearFromKey(it.gazette_key)
    const py = yearFromISO(it.proposed_date)
    if (ey && py && Math.abs(ey - py) > 1) flags.push('year_mismatch')
    if (!it.source_url) flags.push('missing_source_url')
    if (flags.length) {
      flagged.push({ ...it, flags })
      for (const f of flags) counts[f] = (counts[f] || 0) + 1
    }
  }

  await fs.writeJson(OUT_PATH, { count: flagged.length, flags_summary: counts, items: flagged }, { spaces: 2 })
  console.log(`Review generisan: ${OUT_PATH} (flagged=${flagged.length})`)
  console.log('Sažetak flagova:', counts)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})