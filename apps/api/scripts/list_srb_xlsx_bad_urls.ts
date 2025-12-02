import path from 'node:path'
import fs from 'fs-extra'
import xlsx from 'xlsx'

function isUsable(u?: string | null): boolean {
  if (!u) return false
  const l = String(u).toLowerCase()
  return /(\.pdf|\.zip|\.docx?|\.rtf)(\?|$)/.test(l)
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
  const bad: { title: string; url: string }[] = []
  for (const row of rows) {
    const url = Object.values(row).find((v) => typeof v === 'string' && /^https?:\/\//i.test(String(v))) as string | undefined
    const title = Object.values(row).find((v) => typeof v === 'string' && !/^https?:\/\//i.test(String(v))) as string | undefined
    if (!url || !title) continue
    if (!isUsable(url)) {
      bad.push({ title, url })
      if (bad.length >= 10) break
    }
  }
  console.log(JSON.stringify(bad, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })

