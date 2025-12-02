import path from 'node:path'
import fs from 'fs-extra'
import xlsx from 'xlsx'

async function main() {
  const GK = process.env.GK || '10_25'
  const ROOT = path.resolve(process.cwd())
  const xlsxPath = path.join(ROOT, '..', '..', 'zakoni_srbija.xlsx')
  if (!(await fs.pathExists(xlsxPath))) { console.error('XLSX not found'); process.exit(1) }
  const wb = xlsx.readFile(xlsxPath)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json<any>(sheet!, { defval: '' })
  const out: { title: string; url: string; pub?: string }[] = []
  for (const row of rows) {
    const url = Object.values(row).find((v) => typeof v === 'string' && /^https?:\/\//i.test(String(v))) as string | undefined
    const title = Object.values(row).find((v) => typeof v === 'string' && !/^https?:\/\//i.test(String(v))) as string | undefined
    const pub = Object.values(row).find((v) => typeof v === 'string' && /\d{1,3}\s*\/\s*\d{2,4}/.test(String(v))) as string | undefined
    if (!title || !url || !pub) continue
    const m = String(pub).match(/(\d{1,3})\s*\/\s*(\d{2,4})/)
    if (!m) continue
    const yy = m[2].length === 2 ? m[2] : m[2].slice(-2)
    const gk = `${m[1]}_${yy}`
    if (gk === GK) out.push({ title, url, pub })
  }
  console.log(JSON.stringify(out, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

