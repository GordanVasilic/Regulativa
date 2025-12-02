import fs from 'fs-extra'
import path from 'path'
import https from 'https'
import http from 'http'

interface StatusRow {
    law_id: string
    title: string
    url: string
    status: string
}

async function downloadFile(url: string, outputPath: string, maxRedirects = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http
        const req = protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            if ([301,302,307,308].includes(res.statusCode || 0)) {
                const redirectUrl = res.headers.location
                if (redirectUrl && maxRedirects > 0) {
                    downloadFile(redirectUrl, outputPath, maxRedirects - 1).then(resolve).catch(reject)
                    return
                }
                reject(new Error('Too many redirects'))
                return
            }
            if ((res.statusCode || 0) !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${url}`))
                return
            }
            let ext = '.docx'
            const ct = res.headers['content-type'] || ''
            const cd = res.headers['content-disposition'] || ''
            const fnm = cd.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
            if (fnm && fnm[1]) {
                const name = fnm[1].replace(/['"]/g, '')
                const e = path.extname(name)
                if (e) ext = e
            } else if (ct.includes('msword')) ext = '.doc'
            else if (ct.includes('wordprocessingml')) ext = '.docx'
            else if (ct.includes('rtf')) ext = '.rtf'
            const finalPath = outputPath.replace(/\.(docx?|rtf)$/i, ext)
            const ws = fs.createWriteStream(finalPath)
            res.pipe(ws)
            ws.on('finish', () => { ws.close(); resolve() })
            ws.on('error', (err) => { fs.unlink(finalPath, () => {}); reject(err) })
        })
        req.on('error', reject)
        req.setTimeout(30000, () => { req.destroy(); reject(new Error('Download timeout')) })
    })
}

async function run() {
    const statusCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/missing_pdfs_status.csv', 'utf-8')
    const lines = statusCsv.split('\n').slice(1).filter(l => l.trim())
    const rows: StatusRow[] = lines.map(l => {
        const parts = l.match(/^("?)([^",]+)\1,\"([^\"]+)\",\"([^\"]+)\",\"([^\"]+)\",\"([^\"]*)\"$/)
        if (parts) {
            return { law_id: parts[2], title: parts[3], url: parts[4], status: parts[5] }
        }
        const cols = l.split(',')
        return { law_id: cols[0].replace(/\"/g,''), title: cols[1].replace(/\"/g,''), url: cols[2].replace(/\"/g,''), status: cols[3].replace(/\"/g,'') }
    })
    const tasks = rows.filter(r => r.status === '200' && r.url)
    const outDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/Originals_v2'
    await fs.ensureDir(outDir)
    let ok = 0
    let fail = 0
    for (const t of tasks) {
        const safeTitle = t.title.replace(/[^a-zA-Z0-9]/g, '_')
        const filename = `${t.law_id}_${safeTitle}_download.docx`
        const outPath = path.join(outDir, filename)
        try {
            await downloadFile(t.url, outPath)
            ok++
            await new Promise(r => setTimeout(r, 300))
        } catch (e) {
            fail++
        }
    }
    console.log(`Downloaded: ${ok}`)
    console.log(`Failed: ${fail}`)
}

run().catch(console.error)

