import path from 'node:path'
import fs from 'fs-extra'
import xlsx from 'xlsx'

function looksPdf(u: string) { return /\.pdf(\?|$)/i.test(u) }

async function fetchHeadBytes(u: string): Promise<Buffer | null> {
  try {
    const res = await fetch(u)
    if (!res.ok) return null
    const ab = await res.arrayBuffer()
    const buf = Buffer.from(ab)
    return buf.slice(0, Math.min(buf.length, 8))
  } catch {
    return null
  }
}

async function main() {
  const ROOT = path.resolve(process.cwd())
  const xlsxPath = path.join(ROOT, '..', '..', 'zakoni_srbija.xlsx')
  if (!(await fs.pathExists(xlsxPath))) {
    console.error('XLSX not found:', xlsxPath)
    process.exit(1)
  }
  const wb = xlsx.readFile(xlsxPath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json<any>(sheet!, { defval: '' })
  const bad: { title: string; url: string; reason: string }[] = []
  let scanned = 0
  for (const row of rows) {
    const url = Object.values(row).find((v) => typeof v === 'string' && /^https?:\/\//i.test(String(v))) as string | undefined
    const title = Object.values(row).find((v) => typeof v === 'string' && !/^https?:\/\//i.test(String(v))) as string | undefined
    if (!url || !title) continue
    scanned++
    if (!looksPdf(url)) continue
    const head = await fetchHeadBytes(url)
    if (!head) { bad.push({ title, url, reason: 'download_failed_or_non_200' }) }
    else if (!head.toString('ascii').startsWith('%PDF-')) { bad.push({ title, url, reason: 'not_a_pdf_content' }) }
    if (bad.length >= 10 || scanned >= 300) break
  }
  console.log(JSON.stringify({ scanned, bad_examples: bad }, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

