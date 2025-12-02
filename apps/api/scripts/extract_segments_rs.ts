import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

sqlite3.verbose()

function normalizeLabel(input: string) {
  return input.replace(/\s+/g, ' ').trim()
}

// Basic RTF stripper for the specific format found in Montenegro laws
function stripRtf(rtf: string): string {
  // Check for RTF signature OR common RTF commands
  // We check for \par, \pard, \u followed by digits, or the header
  // Note: We run this unconditionally now because RTF content can be split across pages
  // and subsequent pages might not have the header but still contain RTF commands.

  let text = rtf;

  // 1. Handle Unicode characters: \u268? -> Č
  text = text.replace(/\\u(-?\d+)\?/g, (_, code) => String.fromCharCode(Number(code)));

  // 2. Replace common control words with whitespace
  text = text
    .replace(/\\par\b/g, '\n')
    .replace(/\\tab\b/g, '\t')
    .replace(/\\line\b/g, '\n');

  // 3. Remove all other control words
  text = text.replace(/\\[a-z]+\d*/g, '');

  // 4. Remove braces
  text = text.replace(/[{}]/g, '');

  return text;
}

// Normalize Unicode and attempt to fix common mojibake patterns
function normalizeText(input: string) {
  let out = input

  // Always attempt to strip RTF (the function itself has checks/logging)
  out = stripRtf(out);

  // If we detect typical Latin-1/UTF-8 mojibake markers, try to repair via escape/decodeURIComponent
  // This is safe-guarded to avoid double-decoding on already correct text
  if (/[ÃÄÅ]/.test(out)) {
    try {
      // Convert from Latin-1 bytes misinterpreted as UTF-8 back to proper UTF-8
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      out = decodeURIComponent(escape(out))
    } catch {
      // noop if decode fails
    }
  }
  // Final Unicode normalization to a consistent composed form
  try {
    out = out.normalize('NFC')
  } catch { }
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+lan/g, 'Član')
  out = out.replace(/C[\s\u00A0\u2000-\u200B]+lan/g, 'Clan')
  out = out.replace(/Č[\s\u00A0\u2000-\u200B]+l\./g, 'Čl.')
  out = out.replace(/Ч[\s\u00A0\u2000-\u200B]+лан/g, 'Члан')
  return out
}

// Robust detection: support Latin with/without diacritics, Cyrillic, abbreviations, optional punctuation
// Examples matched: "Član 12", "Clan 12.", "Čl. 12", "Члан 12", "Чл. 12", "ČLAN 12", "CLAN 12."
const ARTICLE_RE = /(\b|\n)\s*((?:Č\s*lan|C\s*lan|Č\s*lanak|C\s*lanak|Č\s*l\.|C\s*l\.))\s*(\d{1,3})\s*[\.)\-:\u2013\u2014]?/i

async function extractPageText(filePath: string): Promise<string[]> {
  const buf = await fs.readFile(filePath)
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const loadingTask = getDocument({ data: u8 })
  const pdf = await loadingTask.promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent: any = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
    let lastY = null as number | null
    let lastX = null as number | null
    let lastChar = ''
    let text = ''
    for (const item of textContent.items) {
      const str = String(item.str || '')
      const y = item.transform ? item.transform[5] : null
      const x = item.transform ? item.transform[4] : null
      if (lastY !== null && y !== null && Math.abs(lastY - y) > 9) text += '\n'
      else if (lastX !== null && x !== null && Math.abs(lastX - x) > 2) {
        const f = str.charAt(0)
        if (/\w/.test(lastChar) && /\w/.test(f)) text += ' '
      }
      text += str
      if (y !== null) lastY = y
      if (x !== null) lastX = x
      if (str.length) lastChar = str.charAt(str.length - 1)
    }
    const cleaned = text.replace(/\s+\n/g, '\n').replace(/\s{2,}/g, ' ').trim()
    const cleanedNorm = normalizeText(cleaned)
    pages.push(cleanedNorm)
  }
  await pdf.cleanup()
  return pages
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const DATA_DIR = path.join(ROOT, 'data')
  const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
  const db = new sqlite3.Database(DB_PATH)
  await new Promise<void>((resolve, reject) => db.exec("PRAGMA busy_timeout=5000", (err) => (err ? reject(err) : resolve())))
  const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
  const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))

  // Ensure segments table exists
  await run(
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

  const LIMIT = Number(process.env.LIMIT || 50)
  const OFFSET = Number(process.env.OFFSET || 0)
  const ONE_LAW_ID = process.env.LAW_ID ? Number(process.env.LAW_ID) : null
  const JURISDICTION = String(process.env.JURISDICTION || 'RS')
  const DISABLE_HEURISTICS = process.env.DISABLE_HEURISTICS === '1' || JURISDICTION === 'BRCKO'
  const laws = ONE_LAW_ID
    ? await all<{ id: number; title: string; path_pdf: string }>(
      'SELECT id, title, path_pdf FROM laws WHERE id = ? AND jurisdiction = ? AND path_pdf IS NOT NULL',
      [ONE_LAW_ID, JURISDICTION]
    )
    : await all<{ id: number; title: string; path_pdf: string }>(
      'SELECT id, title, path_pdf FROM laws WHERE jurisdiction = ? AND path_pdf IS NOT NULL ORDER BY id ASC LIMIT ? OFFSET ?',
      [JURISDICTION, LIMIT, OFFSET]
    )

  console.log(`Selected laws jurisdiction=${JURISDICTION} limit=${LIMIT} offset=${OFFSET} count=${laws.length}`)
  if (laws.length) {
    const sample = laws.slice(0, 5).map((l) => l.id).join(',')
    console.log(`Sample law_ids=${sample}`)
  }

  let processed = 0
  let totalSegments = 0
  let failed = 0

  // Remove duplicates before creating unique index to avoid conflicts
  const dups = await all<{ law_id: number; number: number; segment_type: string; min_id: number }>(
    'SELECT law_id, number, segment_type, MIN(id) AS min_id FROM segments GROUP BY law_id, number, segment_type HAVING COUNT(*) > 1'
  )
  for (const d of dups) {
    await run(
      'DELETE FROM segments WHERE law_id = ? AND number = ? AND segment_type = ? AND id <> ?',
      [d.law_id, d.number, d.segment_type, d.min_id]
    )
  }
  // Ensure uniqueness going forward
  await run('CREATE UNIQUE INDEX IF NOT EXISTS ux_segments_unique ON segments(law_id, number, segment_type)')

  for (const law of laws) {
    try {
      const pages = await extractPageText(law.path_pdf)
      const PAGE_SEP = '\n\n'
      const fullText = pages.join(PAGE_SEP)
      // Debug: dump text for analysis when targeting single law
      // Unconditional dump for debugging
      const debugDumpPath = path.join(ROOT, 'dumps', `debug_law_${law.id}.txt`)
      try {
        await fs.ensureDir(path.join(ROOT, 'dumps'))
        await fs.writeFile(debugDumpPath, fullText, 'utf8')
        console.log(`[DEBUG] Dumped to ${debugDumpPath}`)
      } catch (e) {
        console.error(`[DEBUG] Failed to dump:`, e)
      }
      const pageOffsets: number[] = []
      {
        let acc = 0
        for (let i = 0; i < pages.length; i++) {
          pageOffsets.push(acc)
          acc += pages[i].length + PAGE_SEP.length
        }
      }
      const pageForIndex = (idx: number) => {
        let lo = 0, hi = pageOffsets.length - 1
        while (lo <= hi) {
          const mid = (lo + hi) >> 1
          const start = pageOffsets[mid]
          const nextStart = mid + 1 < pageOffsets.length ? pageOffsets[mid + 1] : Number.POSITIVE_INFINITY
          if (idx >= start && idx < nextStart) return mid + 1
          if (idx < start) hi = mid - 1
          else lo = mid + 1
        }
        return 1
      }
      const segments: { label: string; number: number; text: string; page_hint: number }[] = []
      // Generalized deterministic extraction for RS laws:
      // 1) Find candidate article numbers using strict heading (with dot-like punctuation) to estimate max.
      // 2) Enumerate from 1..max and locate exact heading positions per article.
      // 3) Fallback patterns (without dot) if a heading is missing.
      const wsClass = "[\\s\\u00A0\\u2000-\\u200B]"
      const lineStart = "(?:^|\\n)"
      const puncChars = ".·•․‧\-–—"
      const puncClass = `[${puncChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`
      const upperClass = '[A-ZČĆŠŽĐА-ЯЉЊЂЋЏ]'
      const headingTokens = '(?:Č\\s*lan|C\\s*lan|Č\\s*lanak|C\\s*lanak|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)'
      const strictHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?:\.|-|:\u2013|\u2014)${wsClass}*`, 'i')
      const looseHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}${wsClass}*(?:\.|-|:\u2013|\u2014)`, 'i')
      const noDotHeading = (n: number) => new RegExp(`${lineStart}${headingTokens}${wsClass}*${n}(?!\\d)${wsClass}+`, 'i')
      const candidateNums: number[] = []
      {
        const mAll: number[] = []
        const reAll = new RegExp(`${headingTokens}${wsClass}*(\\d{1,3})(?:\\.|-|:\\u2013|\\u2014)${wsClass}*`, 'gi')
        let m: RegExpExecArray | null
        while ((m = reAll.exec(fullText))) {
          const num = Number(m[1])
          if (!Number.isNaN(num)) mAll.push(num)
        }
        const uniq = new Set<number>(mAll)
        candidateNums.push(...uniq)
      }
      const maxNum = candidateNums.length ? Math.max(...candidateNums) : 0
      const matches: { idx: number; num: number; raw: string }[] = []
      if (maxNum > 0) {
        for (let n = 1; n <= maxNum; n++) {
          let idx = fullText.search(strictHeading(n))
          let raw = ''
          if (idx < 0) idx = fullText.search(looseHeading(n))
          if (idx < 0) idx = fullText.search(noDotHeading(n))
          if (idx < 0) {
            const inlineHeading = new RegExp(`(?:^|${wsClass})${headingTokens}${wsClass}*${n}${wsClass}+(?=${upperClass})`, 'iu')
            idx = fullText.search(inlineHeading)
          }
          if (idx < 0) {
            const inlineNoDot = new RegExp(`${headingTokens}${wsClass}*${n}(?!\d)${wsClass}+`, 'i')
            idx = fullText.search(inlineNoDot)
          }
          if (idx >= 0) {
            raw = fullText.slice(idx, Math.min(fullText.length, idx + 48))
            matches.push({ idx, num: n, raw })
          }
        }
        matches.sort((a, b) => a.idx - b.idx)
      } else {
        // Fallback: use ARTICLE_RE across the whole text
        const regex = new RegExp(ARTICLE_RE.source, 'gi')
        let m: RegExpExecArray | null
        while ((m = regex.exec(fullText))) {
          const num = Number(m[3])
          const raw = m[0]
          matches.push({ idx: m.index, num, raw })
        }
      }
      // Prepare unique numbers and slice text until next heading
      const seen = new Set<number>()
      for (let i = 0; i < matches.length; i++) {
        const start = matches[i]
        const endIdx = i + 1 < matches.length ? matches[i + 1].idx : fullText.length
        const isCyr = /Члан/i.test(start.raw)
        const labelBase = isCyr ? 'Члан' : 'Član'
        const label = normalizeLabel(`${labelBase} ${start.num}`)
        const snippetRaw = fullText.slice(start.idx, Math.min(endIdx, start.idx + 8000))
        const snippet = normalizeText(snippetRaw.trim())
        const page_hint = pageForIndex(start.idx)
        if (!seen.has(start.num)) {
          segments.push({ label, number: start.num, text: snippet, page_hint })
          seen.add(start.num)
        }
      }

      // Heuristics: fill missing numbers in 1..max and also any headings detected globally
      const hasCyrillic = /Члан/i.test(fullText)
      const labelBaseAll = hasCyrillic ? 'Члан' : 'Član'
      if (maxNum > 0 && !DISABLE_HEURISTICS) {
        const missing: number[] = []
        for (let n = 1; n <= maxNum; n++) if (!seen.has(n)) missing.push(n)
        for (const n of missing) {
          const label = normalizeLabel(`${labelBaseAll} ${n}`)
          const anyHeading = new RegExp(`(?:Č\\s*lan|C\\s*lan|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)${wsClass}*${n}`, 'i')
          const idx = fullText.search(anyHeading)
          const page_hint = idx >= 0 ? pageForIndex(idx) : 1
          const text = `Heuristički segment za ${label} – standardni naslov nije detektovan.`
          segments.push({ label, number: n, text, page_hint })
          seen.add(n)
        }
      }
      {
        const reGlobal = new RegExp(`(?:Č\\s*lan|C\\s*lan|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)${wsClass}*(\\d{1,3})`, 'gi')
        let m: RegExpExecArray | null
        while ((m = reGlobal.exec(fullText))) {
          const n = Number(m[1])
          if (!Number.isNaN(n) && !seen.has(n)) {
            const label = normalizeLabel(`${labelBaseAll} ${n}`)
            const idx = m.index
            const page_hint = pageForIndex(idx)
            const snippetRaw = fullText.slice(idx, Math.min(fullText.length, idx + 2000))
            const text = normalizeText(snippetRaw.trim())
            segments.push({ label, number: n, text, page_hint })
            seen.add(n)
          }
        }
      }

      if (segments.length === 0) {
        const snippet = normalizeText(fullText.slice(0, Math.min(fullText.length, 4000)).trim())
        segments.push({ label: 'Uvod', number: 0, text: snippet, page_hint: 1 })
      }

      // If targeting one law id, clear previous segments to avoid stale entries
      await run('DELETE FROM segments WHERE law_id = ?', [law.id])
      // Insert segments
      for (const s of segments) {
        await run(
          'INSERT OR IGNORE INTO segments (law_id, segment_type, label, number, text, page_hint) VALUES (?, ?, ?, ?, ?, ?)',
          [law.id, 'article', s.label, s.number, s.text, s.page_hint]
        )
      }
      processed++
      totalSegments += segments.length
      console.log(`OK law_id=${law.id} title="${law.title}" pages=${pages.length} segments=${segments.length}`)
    } catch (e) {
      failed++
      console.log(`FAIL law_id=${law.id} path=${law.path_pdf} reason=${String(e)}`)
    }
  }

  console.log(`Done. processed=${processed}, segments=${totalSegments}, failed=${failed}`)
  db.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
