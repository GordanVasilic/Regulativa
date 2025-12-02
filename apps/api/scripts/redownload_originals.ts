import fs from 'fs-extra'
import path from 'path'
import https from 'https'
import http from 'http'
import { URL } from 'url'

interface DownloadTask {
    lawId: number
    title: string
    url: string
    year: string
}

async function downloadFile(url: string, outputPath: string, maxRedirects = 5): Promise<void> {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url)
        const protocol = parsedUrl.protocol === 'https:' ? https : http

        const request = protocol.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        }, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 307 || response.statusCode === 308) {
                const redirectUrl = response.headers.location
                if (redirectUrl && maxRedirects > 0) {
                    console.log(`  → Following redirect to: ${redirectUrl}`)
                    downloadFile(redirectUrl, outputPath, maxRedirects - 1).then(resolve).catch(reject)
                    return
                } else if (maxRedirects === 0) {
                    reject(new Error('Too many redirects'))
                    return
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${url}`))
                return
            }

            // Determine file extension from content-type or content-disposition
            let extension = '.docx'
            const contentType = response.headers['content-type']
            const contentDisposition = response.headers['content-disposition']

            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/)
                if (filenameMatch && filenameMatch[1]) {
                    const filename = filenameMatch[1].replace(/['"]/g, '')
                    const ext = path.extname(filename)
                    if (ext) extension = ext
                }
            } else if (contentType) {
                if (contentType.includes('msword')) extension = '.doc'
                else if (contentType.includes('wordprocessingml')) extension = '.docx'
                else if (contentType.includes('rtf')) extension = '.rtf'
            }

            // Update output path with correct extension
            const finalOutputPath = outputPath.replace(/\.(docx?|rtf)$/, extension)

            const fileStream = fs.createWriteStream(finalOutputPath)
            response.pipe(fileStream)

            fileStream.on('finish', () => {
                fileStream.close()
                console.log(`  ✓ Saved as: ${path.basename(finalOutputPath)}`)
                resolve()
            })

            fileStream.on('error', (err) => {
                fs.unlink(finalOutputPath, () => { })
                reject(err)
            })
        })

        request.on('error', reject)
        request.setTimeout(30000, () => {
            request.destroy()
            reject(new Error('Download timeout'))
        })
    })
}

async function redownloadOriginals() {
    // Read download URLs
    const csv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_download_urls.csv', 'utf-8')
    const lines = csv.split('\n').slice(1) // Skip header

    const tasks: DownloadTask[] = lines
        .filter(line => line.trim())
        .map(line => {
            const match = line.match(/^(\d+),"([^"]+)","([^"]+)","([^"]+)"/)
            if (!match) return null
            return {
                lawId: parseInt(match[1]),
                title: match[2],
                year: match[3],
                url: match[4]
            }
        })
        .filter(Boolean) as DownloadTask[]

    console.log(`Re-downloading ${tasks.length} original files with improved script...\n`)

    // Clear and recreate output directory
    const outputDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/Originals_v2'
    await fs.remove(outputDir)
    await fs.ensureDir(outputDir)

    let downloaded = 0
    let failed = 0
    const failedFiles: Array<{ lawId: number; title: string; error: string }> = []

    for (const task of tasks) {
        try {
            const filename = `${task.lawId}_${task.title.replace(/[^a-zA-Z0-9]/g, '_')}_${task.year}.docx`
            const outputPath = path.join(outputDir, filename)

            console.log(`[${downloaded + failed + 1}/${tasks.length}] ${task.title}`)

            await downloadFile(task.url, outputPath)
            downloaded++

            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 300))
        } catch (err) {
            failed++
            const errorMsg = err instanceof Error ? err.message : String(err)
            failedFiles.push({
                lawId: task.lawId,
                title: task.title,
                error: errorMsg
            })
            console.error(`  ✗ Failed: ${errorMsg}`)
        }
    }

    console.log(`\n✓ Downloaded: ${downloaded}`)
    console.log(`✗ Failed: ${failed}\n`)

    if (failedFiles.length > 0) {
        const failedCsv = 'law_id,title,error\n' +
            failedFiles.map(f => `${f.lawId},"${f.title}","${f.error}"`).join('\n')

        await fs.writeFile('d:/Projekti/Regulativa/apps/api/download_failed_v2.csv', failedCsv)
        console.log('⚠ Saved failed downloads to download_failed_v2.csv')
    }

    return { downloaded, failed }
}

redownloadOriginals().catch(console.error)
