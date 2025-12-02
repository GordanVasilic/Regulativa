import fs from 'fs-extra'
import path from 'path'

interface ReplacementTask {
    lawId: number
    oldPdfPath: string
    newPdfPath: string
    title: string
}

async function replaceCorruptedPDFs() {
    const cleanPdfDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Clean'
    const backupDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Backup'

    // Create backup directory
    await fs.ensureDir(backupDir)
    console.log(`✓ Created backup directory\n`)

    // Read RTF PDFs list to get original paths
    const rtfCsv = await fs.readFile('d:/Projekti/Regulativa/apps/api/rtf_pdfs.csv', 'utf-8')
    const rtfLines = rtfCsv.split('\n').slice(1) // Skip header

    // Get all clean PDFs
    const cleanPdfs = await fs.readdir(cleanPdfDir)
    console.log(`Found ${cleanPdfs.length} clean PDFs\n`)

    const tasks: ReplacementTask[] = []

    for (const line of rtfLines) {
        if (!line.trim()) continue

        const match = line.match(/^(\d+),"([^"]+)","([^"]+)"/)
        if (!match) continue

        const lawId = parseInt(match[1])
        const title = match[2]
        const oldPdfPath = match[3]

        const cleanPdfId = cleanPdfs.find(f => f.startsWith(`${lawId}_`) && f.endsWith('.pdf'))
        let chosen = cleanPdfId
        if (!chosen) {
            const safeTitle = title.replace(/[^a-zA-Z0-9]/g, '_')
            chosen = cleanPdfs.find(f => f.includes(safeTitle) && f.endsWith('.pdf')) || undefined
        }

        if (chosen) {
            tasks.push({
                lawId,
                oldPdfPath,
                newPdfPath: path.join(cleanPdfDir, chosen),
                title
            })
        }
    }

    console.log(`Processing ${tasks.length} PDF replacements\n`)

    let backed_up = 0
    let replaced = 0
    let failed = 0

    for (const task of tasks) {
        try {
            // Check if old PDF exists
            if (!await fs.pathExists(task.oldPdfPath)) {
                console.warn(`⚠ Old PDF not found: ${task.oldPdfPath}`)
                failed++
                continue
            }

            // Check if new PDF exists
            if (!await fs.pathExists(task.newPdfPath)) {
                console.warn(`⚠ New PDF not found: ${task.newPdfPath}`)
                failed++
                continue
            }

            // Backup old PDF
            const backupFilename = path.basename(task.oldPdfPath)
            const backupPath = path.join(backupDir, backupFilename)

            await fs.copy(task.oldPdfPath, backupPath, { overwrite: true })
            backed_up++

            // Replace with new PDF
            await fs.copy(task.newPdfPath, task.oldPdfPath, { overwrite: true })
            replaced++

            console.log(`[${replaced}/${tasks.length}] ✓ Replaced: ${task.title}`)
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

replaceCorruptedPDFs().catch(console.error)
