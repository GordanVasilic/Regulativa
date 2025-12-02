import fs from 'fs-extra'
import path from 'path'
import https from 'https'
import http from 'http'

interface DownloadTask {
    lawId: number
    title: string
    url: string
    year: string
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http

        protocol.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Follow redirect
                const redirectUrl = response.headers.location
                if (redirectUrl) {
                    downloadFile(redirectUrl, outputPath).then(resolve).catch(reject)
                    return
                }
            }

            if (response.statusCode !== 200) {
                reject(new Error(`HTTP ${response.statusCode}: ${url}`))
                return
            }

            const fileStream = fs.createWriteStream(outputPath)
            response.pipe(fileStream)

            fileStream.on('finish', () => {
                fileStream.close()
                resolve()
            })

            fileStream.on('error', (err) => {
                fs.unlink(outputPath, () => { })
                reject(err)
            })
        }).on('error', reject)
    })
}

async function downloadOriginals() {
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

    console.log(`Downloading ${tasks.length} original files...\n`)

    // Create output directory
    const outputDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/Originals'
    await fs.ensureDir(outputDir)

    let downloaded = 0
    let failed = 0
    const failedFiles: Array<{ lawId: number; title: string; error: string }> = []

    for (const task of tasks) {
        try {
            // Determine file extension from URL or content-type
            // For now, assume .docx (most common)
            const filename = `${task.lawId}_${task.title.replace(/[^a-zA-Z0-9]/g, '_')}_${task.year}.docx`
            const outputPath = path.join(outputDir, filename)

            console.log(`[${downloaded + 1}/${tasks.length}] Downloading: ${task.title}`)

            await downloadFile(task.url, outputPath)
            downloaded++

            // Small delay to avoid overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 500))
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

        await fs.writeFile('d:/Projekti/Regulativa/apps/api/download_failed.csv', failedCsv)
        console.log('⚠ Saved failed downloads to download_failed.csv')
    }

    return { downloaded, failed }
}

downloadOriginals().catch(console.error)
