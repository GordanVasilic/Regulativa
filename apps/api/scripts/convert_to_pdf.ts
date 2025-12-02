import fs from 'fs-extra'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

interface ConversionTask {
    inputPath: string
    outputPath: string
    lawId: number
    title: string
}

async function convertToPDF() {
    const originalsDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/Originals'
    const outputDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Clean'

    await fs.ensureDir(outputDir)

    // Get all downloaded files
    const files = await fs.readdir(originalsDir)
    const docFiles = files.filter(f => f.endsWith('.docx') || f.endsWith('.doc') || f.endsWith('.rtf'))

    console.log(`Found ${docFiles.length} files to convert\n`)

    // Check if we can use Word automation (Windows only)
    let useWord = false
    try {
        // Try to detect if Microsoft Word is available via PowerShell
        const { stdout } = await execAsync('powershell -Command "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\App` Paths\\Winword.exe -ErrorAction SilentlyContinue"')
        if (stdout.trim()) {
            useWord = true
            console.log('✓ Microsoft Word detected, will use for conversion\n')
        }
    } catch {
        console.log('⚠ Microsoft Word not detected')
    }

    if (!useWord) {
        console.log('\n⚠ Neither LibreOffice nor Microsoft Word is available.')
        console.log('Please install one of the following:')
        console.log('  1. LibreOffice: https://www.libreoffice.org/download/')
        console.log('  2. Microsoft Office (Word)')
        console.log('\nAlternatively, I can create a PowerShell script that uses Word automation.')
        return
    }

    // Convert using Word automation via PowerShell
    let converted = 0
    let failed = 0

    for (const file of docFiles) {
        try {
            const inputPath = path.join(originalsDir, file)
            const outputFilename = file.replace(/\.(docx?|rtf)$/i, '.pdf')
            const outputPath = path.join(outputDir, outputFilename)

            console.log(`[${converted + 1}/${docFiles.length}] Converting: ${file}`)

            // PowerShell script to convert using Word
            const psScript = `
        $word = New-Object -ComObject Word.Application
        $word.Visible = $false
        $doc = $word.Documents.Open("${inputPath.replace(/\//g, '\\')}")
        $doc.SaveAs([ref]"${outputPath.replace(/\//g, '\\')}", [ref]17)
        $doc.Close()
        $word.Quit()
        [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
      `

            await execAsync(`powershell -Command "${psScript.replace(/"/g, '\\"')}"`, {
                timeout: 60000 // 60 second timeout per file
            })

            converted++
        } catch (err) {
            failed++
            console.error(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    console.log(`\n✓ Converted: ${converted}`)
    console.log(`✗ Failed: ${failed}`)

    return { converted, failed }
}

convertToPDF().catch(console.error)
