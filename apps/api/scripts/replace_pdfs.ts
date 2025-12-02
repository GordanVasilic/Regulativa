import fs from 'fs-extra'
import path from 'path'

interface ReplacementTask {
    lawId: number
    title: string
    oldPdfPath: string
    newPdfFilename: string
}

async function replacePDFs() {
    const cleanPdfDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Clean'
    const backupDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Backup'

    // Create backup directory
    await fs.ensureDir(backupDir)
    console.log(`✓ Created backup directory: ${backupDir}\n`)

    // Read RTF PDFs list to get original paths
    const rtfCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_pdfs.csv', 'utf-8')
    const rtfLines = rtfCsv.split('\n').slice(1) // Skip header

    const tasks: ReplacementTask[] = rtfLines
        .filter(line => line.trim())
        .map(line => {
            const match = line.match(/^(\d+),"([^"]+)","([^"]+)"/)
            if (!match) return null

            const lawId = parseInt(match[1])
            const title = match[2]
            const oldPdfPath = match[3]

            // Find corresponding new PDF
            const cleanFiles = fs.readdirSync(cleanPdfDir)
            const newPdfFilename = cleanFiles.find(f => f.startsWith(`${lawId}_`))

            if (!newPdfFilename) {
                console.warn(`⚠ No clean PDF found for law ${lawId}: ${title}`)
                return null
            }

            return { lawId, title, oldPdfPath, newPdfFilename }
        })
        .filter(Boolean) as ReplacementTask[]

    console.log(`Processing ${tasks.length} PDF replacements\n`)

    let backed_up = 0
    let replaced = 0
    let failed = 0

    for (const task of tasks) {
        try {
            const oldPdfPath = task.oldPdfPath
            const newPdfPath = path.join(cleanPdfDir, task.newPdfFilename)

            // Check if old PDF exists
            if (!fs.existsSync(oldPdfPath)) {
                console.warn(`⚠ Old PDF not found: ${oldPdfPath}`)
                failed++
                continue
            }

            // Check if new PDF exists
            if (!fs.existsSync(newPdfPath)) {
                console.warn(`⚠ New PDF not found: ${newPdfPath}`)
                failed++
                continue
            }

            // Backup old PDF
            const backupFilename = path.basename(oldPdfPath)
            const backupPath = path.join(backupDir, backupFilename)

            await fs.copy(oldPdfPath, backupPath, { overwrite: true })
            backed_up++

            // Replace with new PDF
            await fs.copy(newPdfPath, oldPdfPath, { overwrite: true })
            replaced++

            console.log(`[${replaced}/${tasks.length}] Replaced: ${task.title}`)
        } catch (err) {
            failed++
            console.error(`✗ Failed to replace ${task.title}: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    console.log(`\n✓ Backed up: ${backed_up}`)
    console.log(`✓ Replaced: ${replaced}`)
    console.log(`✗ Failed: ${failed}`)

    return { backed_up, replaced, failed }
}

replacePDFs().catch(console.error)
