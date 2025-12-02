import path from 'node:path'
import fs from 'fs-extra'

function stripDiacritics(input: string) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function normalizeTitle(input: string) {
  return stripDiacritics(input)
    .replace(/[čćžšđČĆŽŠĐ]/g, (ch) => ({ č: 'c', ć: 'c', ž: 'z', š: 's', đ: 'dj', Č: 'c', Ć: 'c', Ž: 'z', Š: 's', Đ: 'dj' }[ch] || ch))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

type MissingItem = {
  title: string
  title_normalized: string
  gazette_text?: string
  gazette_number?: string | null
  gazette_key?: string | null
}

type NsrsMeta = {
  title: string
  title_normalized: string
  gazette_key?: string | null
  gazette_number?: string | null
  source_url?: string | null
}

async function loadMissingFromSgTxt() {
  const ROOT = path.resolve(process.cwd())
  const dumpsDir = path.join(ROOT, 'dumps')
  const reportPath = path.join(dumpsDir, 'missing_rs_from_sgtxt.json')
  if (!(await fs.pathExists(reportPath))) {
    throw new Error(`Nije pronađen izvještaj: ${reportPath}. Prvo pokreni: npm run compare:sgtxt`)
  }
  const report = await fs.readJson(reportPath)
  const arr: MissingItem[] = report.missing || []
  return arr.map((x) => ({
    title: x.title,
    title_normalized: normalizeTitle(x.title_normalized || x.title || ''),
    gazette_text: x.gazette_text || null,
    gazette_number: x.gazette_number || null,
    gazette_key: x.gazette_key || null,
  }))
}

async function loadNsrsMeta() {
  const ROOT = path.resolve(process.cwd())
  const dataDir = path.join(ROOT, 'data')
  const metaPath = path.join(dataDir, 'nsrs_rs_meta.json')
  if (!(await fs.pathExists(metaPath))) {
    throw new Error(`Nije pronađen NSRS meta fajl: ${metaPath}. Dostupne stranice: 0–61, prvo ih treba scrapovati.`)
  }
  const meta: NsrsMeta[] = await fs.readJson(metaPath)
  return meta
}

async function main() {
  const missing = await loadMissingFromSgTxt()
  const nsrs = await loadNsrsMeta()

  const nsrsByGazKey = new Map<string, NsrsMeta[]>()
  const nsrsByGazNum = new Map<string, NsrsMeta[]>()
  const nsrsTitleSet = new Set<string>()

  for (const m of nsrs) {
    const key = (m.gazette_key || '').trim()
    const num = (m.gazette_number || '').trim()
    if (key) {
      if (!nsrsByGazKey.has(key)) nsrsByGazKey.set(key, [])
      nsrsByGazKey.get(key)!.push(m)
    }
    if (num) {
      if (!nsrsByGazNum.has(num)) nsrsByGazNum.set(num, [])
      nsrsByGazNum.get(num)!.push(m)
    }
    if (m.title || m.title_normalized) nsrsTitleSet.add(normalizeTitle(m.title_normalized || m.title))
  }

  const found: Array<{ missing: MissingItem; matched_by: 'gazette_key' | 'gazette_number' | 'title'; nsrs_item?: NsrsMeta }> = []
  const notFound: MissingItem[] = []

  for (const it of missing) {
    const key = (it.gazette_key || '').trim()
    const num = (it.gazette_number || '').trim()
    const tnorm = normalizeTitle(it.title_normalized || it.title)

    if (key && nsrsByGazKey.has(key)) {
      const target = nsrsByGazKey.get(key)![0]
      found.push({ missing: it, matched_by: 'gazette_key', nsrs_item: target })
      continue
    }
    if (num && nsrsByGazNum.has(num)) {
      const target = nsrsByGazNum.get(num)![0]
      found.push({ missing: it, matched_by: 'gazette_number', nsrs_item: target })
      continue
    }
    if (tnorm && nsrsTitleSet.has(tnorm)) {
      found.push({ missing: it, matched_by: 'title' })
      continue
    }
    notFound.push(it)
  }

  const ROOT = path.resolve(process.cwd())
  const dumpsDir = path.join(ROOT, 'dumps')
  await fs.ensureDir(dumpsDir)

  const report = {
    source_missing: 'ERP SG TXT missing (filtered)',
    nsrs_pages: '0..61',
    input_missing_total: missing.length,
    found_in_nsrs: found.length,
    not_found_in_nsrs: notFound.length,
    found_examples: found.slice(0, 20).map((f) => ({
      title: f.missing.title,
      gazette_key: f.missing.gazette_key || null,
      gazette_number: f.missing.gazette_number || null,
      matched_by: f.matched_by,
      nsrs_source_url: f.nsrs_item?.source_url || null,
      nsrs_title: f.nsrs_item?.title || null,
    })),
    not_found_examples: notFound.slice(0, 20).map((m) => ({
      title: m.title,
      gazette_key: m.gazette_key || null,
      gazette_number: m.gazette_number || null,
    })),
  }

  const outPath = path.join(dumpsDir, 'missing_rs_from_sgtxt_vs_nsrs.json')
  await fs.writeJson(outPath, report, { spaces: 2 })
  console.log(`Izvještaj sačuvan u: ${outPath}`)
  console.log(JSON.stringify(report, null, 2))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})