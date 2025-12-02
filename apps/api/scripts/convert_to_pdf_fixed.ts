import fs from 'fs-extra'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

async function convertWithWord() {
    const originalsDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/Originals'
    const outputDir = 'd:/Projekti/Regulativa/Dokumenti/Crna Gora/PDF_Clean'

    await fs.ensureDir(outputDir)

    const files = await fs.readdir(originalsDir)
    const docFiles = files.filter(f => f.endsWith('.docx') || f.endsWith('.doc') || f.endsWith('.rtf'))

    console.log(`Converting ${docFiles.length} files using Word...\n`)

    let converted = 0
    let failed = 0
    const failedFiles: string[] = []

    for (const file of docFiles) {
        try {
            const inputPath = path.join(originalsDir, file).replace(/\//g, '\\\\')
            const outputFilename = file.replace(/\.(docx?|rtf)$/i, '.pdf')
            const outputPath = path.join(outputDir, outputFilename).replace(/\//g, '\\\\')

            console.log(`[${converted + 1}/${docFiles.length}] Converting: ${file}`)

            // Create a temporary PowerShell script file
            const psScript = `
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open("${inputPath}")
  $doc.SaveAs([ref]"${outputPath}", [ref]17)
  $doc.Close()
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  $word.Quit()
  [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null
}
`

            const scriptPath = path.join(originalsDir, 'convert_temp.ps1')
            await fs.writeFile(scriptPath, psScript)

            await execAsync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}"`, {
                timeout: 60000
            })

            await fs.remove(scriptPath)

            // Verify PDF was created
            if (await fs.pathExists(outputPath.replace(/\\\\/g, '/'))) {
                converted++
            } else {
                failed++
                failedFiles.push(file)
                console.error(`  ✗ PDF not created`)
            }
        } catch (err) {
            failed++
            failedFiles.push(file)
            console.error(`  ✗ Failed: ${err instanceof Error ? err.message : String(err)}`)
        }
    }

    console.log(`\n✓ Converted: ${converted}`)
    console.log(`✗ Failed: ${failed}`)

    if (failedFiles.length > 0) {
        console.log('\nFailed files:')
        failedFiles.forEach(f => console.log(`  - ${f}`))
    }

    return { converted, failed }
}

convertWithWord().catch(console.error)
