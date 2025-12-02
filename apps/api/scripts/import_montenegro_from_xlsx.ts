import 'dotenv/config'
import path from 'node:path'
import fs from 'fs-extra'
import sqlite3 from 'sqlite3'
import xlsx from 'xlsx'
import puppeteer from 'puppeteer'
import { execFile } from 'node:child_process'
import AdmZip from 'adm-zip'

type LawItem = {
    title: string
    url: string
    year?: number | null
    gazetteDate?: string | null
    variant?: string | null
}

function stripDiacritics(s: string) {
    return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function normalizeTitle(s: string) {
    return stripDiacritics(s).toLowerCase().replace(/\s+/g, ' ').trim()
}
function sanitizeFileName(name: string) {
    const cleaned = name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim()
    const MAX = 120
    return cleaned.length > MAX ? cleaned.slice(0, MAX) : cleaned
}
function toIsoDate(val: any): string | null {
    if (val == null) return null
    if (val instanceof Date && !isNaN(val.getTime())) {
        const Y = val.getFullYear(), M = val.getMonth() + 1, D = val.getDate()
        return `${String(Y).padStart(4, '0')}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`
    }
    const s = String(val).trim()
    const m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/)
    if (m) {
        const d = Number(m[1]), mo = Number(m[2]), yRaw = m[3], yNum = Number(yRaw)
        let Y = yNum
        if (yRaw.length === 2) Y = yNum <= 39 ? 2000 + yNum : 1900 + yNum
        return `${String(Y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    }
    return null
}

async function ensurePdfFromUrl(item: LawItem, pdfDir: string): Promise<string | null> {
    await fs.ensureDir(pdfDir)
    const baseName = sanitizeFileName(item.title.trim())
    const suffix = item.year ? `-${item.year}` : ''
    const variant = item.variant ? String(item.variant) : ''
    const outPath = path.join(pdfDir, `${baseName}${suffix}${variant}.pdf`)

    // If exact target file exists and je > 0 bytes, koristi ga; ne reusovati druge varijante
    if (await fs.pathExists(outPath)) {
        const stat = await fs.stat(outPath)
        if (stat.size > 0) return outPath
    }

    const urlLower = (item.url || '').toLowerCase()
    try {
        const res = await fetch(item.url, {
            redirect: 'follow' as any,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
                'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/zip,application/octet-stream,text/html,*/*;q=0.8',
                'Accept-Language': 'sr-Latn-RS,sr;q=0.8,en-US;q=0.6,en;q=0.4',
                'Referer': 'https://www.gov.me/'
            }
        })
        if (res.ok) {
            const ct = String(res.headers.get('content-type') || '').toLowerCase()
            const cd = String(res.headers.get('content-disposition') || '')
            const filenameMatch = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i)
            const hintedName = decodeURIComponent(filenameMatch?.[1] || filenameMatch?.[2] || '')
            const hintedExt = hintedName ? hintedName.split('.').pop()?.toLowerCase() : undefined
            const ab = await res.arrayBuffer()
            const buf = Buffer.from(ab)
            const isPdfMagic = buf.slice(0, 4).toString('utf8') === '%PDF'
            if (ct.includes('application/pdf') || isPdfMagic) {
                await fs.writeFile(outPath, buf)
                return outPath
            }
            const tmpDir = path.join(pdfDir, '__tmp')
            await fs.ensureDir(tmpDir)
            if (ct.includes('application/msword') || ct.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document') || ct.includes('application/rtf') || hintedExt === 'doc' || hintedExt === 'docx' || hintedExt === 'rtf' || ct.includes('application/octet-stream')) {
                const ext = hintedExt === 'doc' ? '.doc' : hintedExt === 'rtf' ? '.rtf' : hintedExt === 'docx' ? '.docx' : (ct.includes('msword') ? '.doc' : ct.includes('rtf') ? '.rtf' : ct.includes('officedocument') ? '.docx' : '.doc')
                const tmpSrc = path.join(tmpDir, `${baseName}${suffix}${ext}`)
                await fs.writeFile(tmpSrc, buf)
                const produced = await sofficeConvertToPdf(tmpSrc, tmpDir)
                await fs.copy(produced, outPath)
                await fs.remove(tmpSrc)
                await fs.remove(produced)
                return outPath
            }
            if (ct.includes('application/zip') || hintedExt === 'zip') {
                const tmpZip = path.join(tmpDir, `${baseName}${suffix}.zip`)
                await fs.writeFile(tmpZip, buf)
                const zip = new AdmZip(tmpZip)
                const entries = zip.getEntries()
                const pick = (ext: string) => entries.find((e) => e.entryName.toLowerCase().endsWith(ext))
                const chosen = pick('.docx') || pick('.doc') || pick('.rtf')
                if (!chosen) {
                    await fs.remove(tmpZip)
                    // fall through to Puppeteer below
                } else {
                    const chosenBuf = chosen.getData()
                    const ext = chosen.entryName.toLowerCase().endsWith('.rtf') ? '.rtf' : chosen.entryName.toLowerCase().endsWith('.doc') ? '.doc' : '.docx'
                    const tmpSrc = path.join(tmpDir, `${baseName}${suffix}${ext}`)
                    await fs.writeFile(tmpSrc, chosenBuf)
                    const produced = await sofficeConvertToPdf(tmpSrc, tmpDir)
                    await fs.copy(produced, outPath)
                    await fs.remove(tmpZip)
                    await fs.remove(tmpSrc)
                    await fs.remove(produced)
                    return outPath
                }
            }
            // If HTML or unknown: fallback to Puppeteer print
        }

        // Fallback to Puppeteer for non-PDF URLs or failed fetch
        console.log(`[DEBUG] Launching Puppeteer for ${item.url}...`)
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        })
        try {
            const page = await browser.newPage()
            await page.goto(item.url, { waitUntil: 'networkidle0', timeout: 60000 })
            await page.pdf({ path: outPath, format: 'A4', printBackground: true })
        } finally {
            await browser.close()
        }

        if (await fs.pathExists(outPath)) {
            return outPath
        }
        return null
    } catch (e) {
        console.warn(`Failed to download PDF for "${item.title}":`, e)
        return null
    }
}

async function sofficeConvertToPdf(srcPath: string, outDir: string): Promise<string> {
    const sofficePath = await findSoffice()
    await new Promise<void>((resolve, reject) => {
        execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath], (err) => {
            if (err) return reject(err)
            resolve()
        })
    })
    const stem = path.basename(srcPath, path.extname(srcPath))
    const produced = path.join(outDir, `${stem}.pdf`)
    if (!(await fs.pathExists(produced))) {
        throw new Error('conversion failed')
    }
    return produced
}

async function main() {
    const ROOT = path.resolve(process.cwd())
    const DATA_DIR = path.join(ROOT, 'data')
    const DB_PATH = path.join(DATA_DIR, 'regulativa.db')
    const PDF_DIR = path.join(ROOT, '..', '..', 'Dokumenti', 'Crna Gora', 'PDF')
    await fs.ensureDir(DATA_DIR)
    await fs.ensureDir(PDF_DIR)

    const argv = process.argv.slice(2)
    const getArg = (name: string) => { const pref = `--${name}=`; const hit = argv.find((a) => a.startsWith(pref)); return hit ? hit.slice(pref.length) : undefined }
    const xlsxPath = getArg('xlsx') || path.join(ROOT, '..', '..', 'Dokumenti', 'Crna Gora', 'zakoni_crna_gora_complete.xlsx')
    const limitArg = getArg('limit')
    const LIMIT = limitArg ? Math.max(1, parseInt(limitArg, 10)) : 3
    const metaOnlyArg = getArg('metaOnly')
    const META_ONLY = metaOnlyArg ? /^(1|true|yes)$/i.test(metaOnlyArg) : false
    const repairArg = getArg('repair')
    const REPAIR_ONLY = repairArg ? /^(1|true|yes)$/i.test(repairArg) : false
    const normalizeArg = getArg('normalize')
    const NORMALIZE = normalizeArg ? /^(1|true|yes)$/i.test(normalizeArg) : false

    if (NORMALIZE) {
        const db = new sqlite3.Database(DB_PATH)
        const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
        const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/zip,application/octet-stream,text/html,*/*;q=0.8'
        }
        const measureSize = async (u: string): Promise<number | null> => {
            if (!u) return null
            try {
                const head = await fetch(u, { method: 'HEAD', headers })
                const cl = head.headers.get('content-length')
                if (cl) return parseInt(cl, 10)
            } catch {}
            try {
                const res = await fetch(u, { method: 'GET', headers })
                const ab = await res.arrayBuffer()
                return ab.byteLength
            } catch {
                return null
            }
        }

        const rows = await all<{ id: number; title: string; title_normalized: string | null; gazette_key: string | null; path_pdf: string | null; source_url: string | null }>(
            "SELECT id, title, title_normalized, gazette_key, path_pdf, source_url FROM laws WHERE jurisdiction='Crna Gora'"
        )

        type Row = { id: number; title: string; title_normalized: string; year: string | null; path_pdf: string | null; source_url: string | null }
        const groups = new Map<string, Row[]>()
        for (const r of rows) {
            const tn = (r.title_normalized || normalizeTitle(r.title))
            const y = r.gazette_key || null
            const key = `${tn}|${y ?? ''}`
            const arr = groups.get(key) || []
            arr.push({ id: r.id, title: r.title, title_normalized: tn, year: y, path_pdf: r.path_pdf || null, source_url: r.source_url || null })
            groups.set(key, arr)
        }

        let updated = 0
        let ensured = 0
        for (const [key, arr] of groups.entries()) {
            const [tn, y] = key.split('|')
            const baseName = sanitizeFileName(arr[0].title)
            const suffix = y ? `-${y}` : ''
            const canonical = path.join(PDF_DIR, `${baseName}${suffix}.pdf`)

            const bySize = new Map<number, Row[]>()
            for (const r of arr) {
                let size: number | null = null
                if (r.path_pdf) {
                    try { const st = await fs.stat(r.path_pdf); size = st.size } catch { size = null }
                }
                if (size == null && r.source_url) {
                    size = await measureSize(r.source_url)
                }
                if (size == null) continue
                const bucket = bySize.get(size) || []
                bucket.push(r)
                bySize.set(size, bucket)
            }

            for (const [size, bucket] of bySize.entries()) {
                let sharedPath: string | null = null
                try {
                    const st = await fs.stat(canonical)
                    if (st.size === size) sharedPath = canonical
                } catch {}
                if (!sharedPath) {
                    const having = bucket.find((r) => r.path_pdf && fs.existsSync(String(r.path_pdf)))
                    if (having?.path_pdf) sharedPath = String(having.path_pdf)
                }
                if (!sharedPath) {
                    const first = bucket[0]
                    if (first?.source_url) {
                        const item: LawItem = { title: first.title, url: String(first.source_url), year: y ? Number(y) : null, variant: '' }
                        const out = await ensurePdfFromUrl(item, PDF_DIR)
                        if (out) { sharedPath = out; ensured++ }
                    }
                }
                if (!sharedPath) continue
                for (const r of bucket) {
                    if (r.path_pdf !== sharedPath) {
                        const port = process.env.PORT ? Number(process.env.PORT) : 5000
                        const localUrl = `http://localhost:${port}/pdf/${r.id}`
                        await run('UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime("now") WHERE id = ?', [sharedPath, localUrl, r.id])
                        updated++
                    }
                }
            }
        }

        console.log(JSON.stringify({ ok: true, mode: 'normalize', groups: groups.size, updated, ensured }, null, 2))
        db.close()
        return
    }

    const picked: LawItem[] = []
    if (REPAIR_ONLY) {
        const db = new sqlite3.Database(DB_PATH)
        const all = <T = any>(sql: string, params: any[] = []) => new Promise<T[]>((resolve, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows as T[]))))
        const rows = await all<{ id: number; title: string; source_url: string | null; gazette_date: string | null; gazette_key: string | null }>(
            "SELECT id, title, source_url, gazette_date, gazette_key FROM laws WHERE jurisdiction='Crna Gora' AND (path_pdf IS NULL OR path_pdf='') AND source_url IS NOT NULL"
        )
        for (const r of rows) {
            const title = String(r.title || '').trim()
            const url = String(r.source_url || '').trim()
            if (!title || !url) continue
            const gd = r.gazette_date ? String(r.gazette_date) : null
            const gazetteDate = gd
            const yf = gazetteDate ? Number(gazetteDate.slice(0, 4)) : (r.gazette_key ? Number(String(r.gazette_key)) : null)
            const year = yf ?? null
            picked.push({ title, url, year, gazetteDate })
        }
        console.log(`Repair mode: selected ${picked.length} laws without PDF`)
        db.close()
    } else {
        console.log(`Reading Excel from: ${xlsxPath}`)
        const wb = xlsx.readFile(xlsxPath)
        const sheetName = wb.SheetNames[0]
        const sheet = wb.Sheets[sheetName]
        const rows = xlsx.utils.sheet_to_json<any>(sheet, { defval: '' })
        for (const row of rows) {
            const title = row['Naziv'] || row['naziv'] || ''
            const url = row['URL'] || row['url'] || ''
            if (!title || !url) continue
            const datumField = row['Datum'] || row['datum'] || null
            const gazetteDate = datumField != null ? toIsoDate(datumField) : null
            const yearFromDate = gazetteDate ? Number(String(gazetteDate).slice(0, 4)) : null
            const year = yearFromDate ?? (row['Godina'] || row['godina'] || null)
            picked.push({ title: String(title).trim(), url: String(url).trim(), year, gazetteDate, variant: null })
            if (picked.length >= LIMIT) break
        }
        console.log(`Selected ${picked.length} laws for import (limit=${LIMIT})`)
    }

    const db = new sqlite3.Database(DB_PATH)
    const run = (sql: string, params: any[] = []) => new Promise<void>((resolve, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolve())))
    const get = <T = any>(sql: string, params: any[] = []) => new Promise<T | undefined>((resolve, reject) => db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row as T))))

    await run(
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

    let inserted = 0
    let repaired = 0
    let failed = 0
    for (const it of picked) {
        const jurisdiction = 'Crna Gora'
        const title = it.title.trim()
        const title_normalized = normalizeTitle(title)
        const gazette_date = it.gazetteDate || null
        const yearFromDate = gazette_date ? Number(String(gazette_date).slice(0, 4)) : (it.year ?? null)
        const gazette_key = yearFromDate != null ? String(yearFromDate) : null
        const gazette_number = null
        const source_url = it.url
        const url_pdf = /\.pdf($|\?)/i.test(it.url) ? it.url : null

        const existingRows = await new Promise<any[]>((resolve, reject) => db.all(
            `SELECT id, source_url, path_pdf FROM laws WHERE jurisdiction = ? AND title = ? AND (gazette_date = ? OR (gazette_date IS NULL AND ? IS NULL)) AND COALESCE(source_url,'') = COALESCE(?, '')`,
            [jurisdiction, title, gazette_date, gazette_date, source_url],
            (err, rows) => err ? reject(err) : resolve(rows as any[])
        ))

        const headers: Record<string, string> = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Accept': 'application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,application/zip,application/octet-stream,text/html,*/*;q=0.8'
        }
        const measureSize = async (u: string): Promise<number | null> => {
            try {
                const head = await fetch(u, { method: 'HEAD', headers })
                const cl = head.headers.get('content-length')
                if (cl) return parseInt(cl, 10)
            } catch {}
            try {
                const res = await fetch(u, { method: 'GET', headers })
                const ab = await res.arrayBuffer()
                return ab.byteLength
            } catch {
                return null
            }
        }
        const remoteSize = await measureSize(source_url)

        let matchedId: number | null = null
        if (existingRows.length > 0 && remoteSize != null) {
            for (const r of existingRows) {
                if (r.path_pdf) {
                    try {
                        const st = await fs.stat(r.path_pdf)
                        if (st.size === remoteSize) { matchedId = r.id; break }
                    } catch {}
                } else if (r.source_url) {
                    const sz = await measureSize(String(r.source_url))
                    if (sz != null && sz === remoteSize) { matchedId = r.id; break }
                }
            }
        }

        let lawId = matchedId ?? (existingRows[0]?.id || null)
        if (!lawId && !REPAIR_ONLY) {
            await run(
                `INSERT INTO laws (jurisdiction, title, title_normalized, slug, doc_type, gazette_key, gazette_number, gazette_date, source_url, url_pdf, path_pdf)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, NULL)`,
                [jurisdiction, title, title_normalized, gazette_key, gazette_number, gazette_date, source_url, url_pdf]
            )
            const row = await get<{ id: number }>(
                `SELECT id FROM laws WHERE jurisdiction = ? AND title = ? AND (gazette_date = ? OR (gazette_date IS NULL AND ? IS NULL)) AND COALESCE(source_url,'') = COALESCE(?, '') ORDER BY id DESC LIMIT 1`,
                [jurisdiction, title, gazette_date, gazette_date, source_url]
            )
            lawId = row?.id
            console.log(`✓ Inserted law_id=${lawId} title="${title}"`)
        } else {
            await run('UPDATE laws SET gazette_key = ?, gazette_date = ?, source_url = ?, updated_at = datetime("now") WHERE id = ?', [gazette_key, gazette_date, source_url, lawId])
            console.log(`✓ Updated law_id=${lawId} title="${title}"`)
        }
        if (lawId && !META_ONLY) {
            console.log(`  Checking PDF for ${it.url}...`)
            let path_pdf: string | null = null
            const yearForFile = yearFromDate ?? null
            const baseName = sanitizeFileName(title)
            const suffix = yearForFile ? `-${yearForFile}` : ''
            const canonicalPath = path.join(PDF_DIR, `${baseName}${suffix}.pdf`)
            let useVariant = `-law${lawId}`
            if (remoteSize != null && yearForFile) {
                try {
                    const st = await fs.stat(canonicalPath)
                    if (st.size === remoteSize) {
                        useVariant = ''
                    }
                } catch {}
            }
            const withVariant = { ...it, year: yearForFile, variant: useVariant }
            path_pdf = await ensurePdfFromUrl(withVariant, PDF_DIR)
            if (path_pdf) {
                const port = process.env.PORT ? Number(process.env.PORT) : 5000
                const localUrl = `http://localhost:${port}/pdf/${lawId}`
                await run('UPDATE laws SET path_pdf = ?, url_pdf = ?, updated_at = datetime("now") WHERE id = ?', [path_pdf, localUrl, lawId])
                console.log(`  ✓ PDF saved to ${path_pdf}`)
                if (REPAIR_ONLY) repaired++
            } else {
                console.log(`  ✗ PDF download failed`)
                if (REPAIR_ONLY) failed++
            }
        }
        inserted++
    }

    if (REPAIR_ONLY) {
        console.log(JSON.stringify({ ok: true, mode: 'repair', processed: picked.length, repaired, failed }, null, 2))
    } else {
        console.log(JSON.stringify({ ok: true, inserted, count: picked.length }, null, 2))
    }
    db.close()
}

main().catch((e) => { console.error(e); process.exit(1) })
async function findSoffice(): Promise<string> {
    const candidates = [
        'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
        'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    ]
    for (const p of candidates) {
        if (await fs.pathExists(p)) return p
    }
    const pf = process.env['ProgramFiles']
    if (pf) {
        const p = path.join(pf, 'LibreOffice', 'program', 'soffice.exe')
        if (await fs.pathExists(p)) return p
    }
    // Fallback to typical 64-bit path even if pathExists failed (user reported installed)
    return 'C:\\Program Files\\LibreOffice\\program\\soffice.exe'
}
