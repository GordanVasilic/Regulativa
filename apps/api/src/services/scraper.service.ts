
import * as cheerio from 'cheerio'
// import fetch from 'node-fetch' // Use native fetch
import sqlite3 from 'sqlite3'
import { normalizeTitle, parseSegments } from './law-parsing.service.js'
import { groupingService } from './grouping.service.js'
import path from 'node:path'
import fs from 'fs-extra'
import AdmZip from 'adm-zip'
import mammoth from 'mammoth'
import { pdfService } from './pdf.service.js'
import { execFile } from 'node:child_process'

export type ScrapedLaw = {
    title: string
    title_normalized: string
    gazette_number: string | null
    gazette_date: string | null // ISO date YYYY-MM-DD
    url_pdf: string
    jurisdiction: string
    status: 'new' | 'exists'
}

export class ScraperService {

    // --- RS Parser ---
    async checkRS(db: sqlite3.Database, url: string): Promise<ScrapedLaw[]> {
        console.log(`Checking RS laws from: ${url}`)
        
        let html = ''
        try {
            const res = await fetch(url)
            html = await res.text()
        } catch (e) {
            console.error('Failed to fetch RS page:', e)
            throw new Error('Ne mogu pristupiti sajtu NSRS')
        }

        const $ = cheerio.load(html)
        const items: ScrapedLaw[] = []

        // Parse table rows. Structure based on provided HTML snippet:
        // Rows seem to be in a table structure, usually <tr>
        // The snippet shows div structure but typically these are in tables or lists. 
        // Based on snippet: 
        // <td class="views-field views-field-title"> ... </td>
        // <td class="views-field views-field-field-sluzbeni-glasnik"> ... 109/25 ... </td>
        // <td class="views-field views-field-field-datum-usvajanja"> ... 19.12.2025. ... </td>
        // <td class="views-field views-field-field-prilog"> ... <a href="...">...</a> ... </td>

        $('.views-row').each((_i, el) => {
            const title = $(el).find('.views-field-title .field-content').text().trim()
            if (!title) return

            // Try multiple selectors for gazette
            let gazetteRaw = $(el).find('.views-field-field-akti-sluzbeni-glasnik .field-content').text().trim()
            if (!gazetteRaw) gazetteRaw = $(el).find('.views-field-field-sluzbeni-glasnik .field-content').text().trim()
            
            // Format: "109/25"
            const gazetteNumber = gazetteRaw || null

            // Try multiple selectors for date
            let dateRaw = $(el).find('.views-field-field-datum-radna-tijela .field-content').text().trim()
            if (!dateRaw) dateRaw = $(el).find('.views-field-field-datum-usvajanja .field-content').text().trim()
            
            // Format: "19.12.2025." -> "2025-12-19"
            let gazetteDate = null
            if (dateRaw) {
                const parts = dateRaw.split('.')
                if (parts.length >= 3) {
                    gazetteDate = `${parts[2]}-${parts[1]}-${parts[0]}`
                }
            }

            // Try multiple selectors for attachment
            let pdfLink = $(el).find('.views-field-field-prilog-radna-tijela a').attr('href')
            if (!pdfLink) pdfLink = $(el).find('.views-field-field-prilog a').attr('href')
            
            // Link is usually relative or absolute? Snippet: "zak_o_izmjen_..."
            // Assuming we need to prepend base URL if relative
            // But usually the href in cheerio is as is. 
            // If it starts with http, use it. If not, prepend domain.
            let urlPdf = ''
            if (pdfLink) {
                if (pdfLink.startsWith('http')) {
                    urlPdf = pdfLink
                } else {
                    // Base url seems to be https://narodnaskupstinars.net
                    // But we should check if link starts with /
                    const base = 'https://narodnaskupstinars.net'
                    urlPdf = pdfLink.startsWith('/') ? base + pdfLink : base + '/' + pdfLink
                }
            }

            if (title && urlPdf) {
                items.push({
                    title,
                    title_normalized: normalizeTitle(title),
                    gazette_number: gazetteNumber,
                    gazette_date: gazetteDate,
                    url_pdf: urlPdf,
                    jurisdiction: 'RS',
                    status: 'new' // default, will check later
                })
            }
        })
        
        // If no items found with .views-row (maybe table structure?), try tr
        if (items.length === 0) {
             $('tr').each((_i, el) => {
                const title = $(el).find('.views-field-title').text().trim()
                if (!title) return

                let gazetteRaw = $(el).find('.views-field-field-akti-sluzbeni-glasnik').text().trim()
                if (!gazetteRaw) gazetteRaw = $(el).find('.views-field-field-sluzbeni-glasnik').text().trim()
                const gazetteNumber = gazetteRaw || null

                let dateRaw = $(el).find('.views-field-field-datum-radna-tijela').text().trim()
                if (!dateRaw) dateRaw = $(el).find('.views-field-field-datum-usvajanja').text().trim()

                let gazetteDate = null
                if (dateRaw) {
                    const parts = dateRaw.split('.')
                    if (parts.length >= 3) {
                        gazetteDate = `${parts[2]}-${parts[1]}-${parts[0]}`
                    }
                }

                let pdfLink = $(el).find('.views-field-field-prilog-radna-tijela a').attr('href')
                if (!pdfLink) pdfLink = $(el).find('.views-field-field-prilog a').attr('href')

                let urlPdf = ''
                if (pdfLink) {
                    if (pdfLink.startsWith('http')) {
                        urlPdf = pdfLink
                    } else {
                        const base = 'https://narodnaskupstinars.net'
                        urlPdf = pdfLink.startsWith('/') ? base + pdfLink : base + '/' + pdfLink
                    }
                }

                if (title && urlPdf) {
                    items.push({
                        title,
                        title_normalized: normalizeTitle(title),
                        gazette_number: gazetteNumber,
                        gazette_date: gazetteDate,
                        url_pdf: urlPdf,
                        jurisdiction: 'RS',
                        status: 'new'
                    })
                }
             })
        }

        // Check against DB
        const results: ScrapedLaw[] = []
        for (const item of items) {
            let exists = false
            
            // 1. Check by Title + Gazette Number (Strong Match)
            if (item.gazette_number) {
                 const row = await new Promise<any>((resolve) => {
                     db.get(
                         `SELECT id FROM laws WHERE jurisdiction = ? AND title_normalized = ? AND gazette_number = ?`,
                         ['RS', item.title_normalized, item.gazette_number],
                         (err, row) => resolve(row)
                     )
                 })
                 if (row) exists = true
            }
            
            // 2. Fallback: Check by Title + Gazette Date (if gazette number missing or different format)
            if (!exists && item.gazette_date) {
                 const row = await new Promise<any>((resolve) => {
                     db.get(
                         `SELECT id FROM laws WHERE jurisdiction = ? AND title_normalized = ? AND gazette_date = ?`,
                         ['RS', item.title_normalized, item.gazette_date],
                         (err, row) => resolve(row)
                     )
                 })
                 if (row) exists = true
            }

            item.status = exists ? 'exists' : 'new'
            
            if (!exists) {
                results.push(item)
            }
        }

        return results
    }

    private async findSoffice(): Promise<string | null> {
        const candidates = [
            'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
            'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
        ]
        for (const c of candidates) {
            if (await fs.pathExists(c)) return c
        }
        // Check path
        try {
             await new Promise((resolve, reject) => {
                 execFile('soffice', ['--version'], (err) => {
                     if (err) reject(err)
                     else resolve(true)
                 })
             })
             return 'soffice'
        } catch {
            return null
        }
    }

    private async convertToPdf(srcPath: string, outDir: string): Promise<string> {
        const sofficePath = await this.findSoffice()
        if (!sofficePath) throw new Error('LibreOffice not found. Please install LibreOffice to process .doc files.')
        
        await new Promise<void>((resolve, reject) => {
            execFile(sofficePath, ['--headless', '--convert-to', 'pdf', '--outdir', outDir, srcPath], (err) => {
                if (err) return reject(err)
                resolve()
            })
        })
        
        const stem = path.basename(srcPath, path.extname(srcPath))
        const produced = path.join(outDir, `${stem}.pdf`)
        if (!(await fs.pathExists(produced))) throw new Error('LibreOffice did not produce PDF')
        return produced
    }

    async importLaws(db: sqlite3.Database, laws: ScrapedLaw[]): Promise<{ imported: number, errors: any[], importedIds: number[] }> {
        let imported = 0
        const errors: any[] = []
        const importedIds: number[] = []
        
        // Ensure PDF directory exists
        const PDF_DIR = path.join(process.cwd(), '../../Dokumenti/RepublikaSrpska/PDF')
        await fs.ensureDir(PDF_DIR)

        for (const law of laws) {
            try {
                // 1. Download File (PDF or ZIP)
                const isZip = law.url_pdf.toLowerCase().endsWith('.zip')
                const ext = isZip ? '.zip' : '.pdf'
                const filename = `${law.title_normalized}-${law.gazette_number?.replace('/', '_') || 'unknown'}${ext}`
                const filePath = path.join(PDF_DIR, filename)
                
                // Check if file exists, if not download
                if (!(await fs.pathExists(filePath))) {
                     const res = await fetch(law.url_pdf)
                     if (!res.ok) throw new Error(`Failed to download file: ${res.statusText}`)
                     const buffer = await res.arrayBuffer()
                     await fs.writeFile(filePath, Buffer.from(buffer))
                }

                let finalPdfPath = filePath

                // Handle ZIP extraction if needed
                if (isZip) {
                    const zip = new AdmZip(filePath)
                    const zipEntries = zip.getEntries()
                    
                    // Try to find PDF
                    let pdfEntry = zipEntries.find(entry => entry.entryName.toLowerCase().endsWith('.pdf'))
                    
                    // If no PDF, try DOCX/DOC (fallback, but we might not support extraction yet)
                    if (!pdfEntry) {
                        const docEntry = zipEntries.find(entry => 
                            entry.entryName.toLowerCase().endsWith('.docx') || 
                            entry.entryName.toLowerCase().endsWith('.doc')
                        )
                        
                        if (docEntry) {
                            const ext = path.extname(docEntry.entryName).toLowerCase()
                            const extractedDocName = `${law.title_normalized}-${law.gazette_number?.replace('/', '_') || 'unknown'}${ext}`
                            const docPath = path.join(PDF_DIR, extractedDocName)
                            
                            if (!(await fs.pathExists(docPath))) {
                                await fs.writeFile(docPath, docEntry.getData())
                            }
                            
                            if (ext === '.doc') {
                                // Convert .doc to PDF using LibreOffice
                                finalPdfPath = await this.convertToPdf(docPath, PDF_DIR)
                            } else {
                                // .docx - use Mammoth
                                // 2. Extract Text from DOCX
                                const result = await mammoth.extractRawText({ path: docPath })
                                const text = result.value
                                
                                // 3. Generate PDF from Text (Fallback)
                                // Since we don't have original PDF, we generate a simple one for the viewer
                                finalPdfPath = await pdfService.generatePdf(
                                    law.title,
                                    text,
                                    law.jurisdiction,
                                    law.gazette_number || undefined
                                )
                            }
                        } else {
                            throw new Error('No PDF or DOCX found in ZIP archive')
                        }
                    }
                    
                    if (pdfEntry) {
                        const extractedName = `${law.title_normalized}-${law.gazette_number?.replace('/', '_') || 'unknown'}.pdf`
                        finalPdfPath = path.join(PDF_DIR, extractedName)
                        
                        // Extract only if not already extracted
                        if (!(await fs.pathExists(finalPdfPath))) {
                            await fs.writeFile(finalPdfPath, pdfEntry.getData())
                        }
                    }
                }

                // 2. Extract Text (if not already done for DOCX)
                let text = ''
                if (finalPdfPath.endsWith('.pdf')) {
                    const res = await pdfService.extractText(finalPdfPath)
                    text = res.text
                } else {
                    // Should be handled above
                }

                // 3. Insert into DB
                // gazette_key usually from gazette_number e.g. "109/25" -> "109_25"
                const gazetteKey = law.gazette_number ? law.gazette_number.replace('/', '_') : null

                await new Promise<void>((resolve, reject) => {
                    db.run(
                        `INSERT INTO laws (
                            jurisdiction, title, title_normalized, gazette_number, gazette_key, gazette_date, 
                            url_pdf, path_pdf, text_content, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
                        [
                            law.jurisdiction,
                            law.title,
                            law.title_normalized,
                            law.gazette_number,
                            gazetteKey,
                            law.gazette_date,
                            law.url_pdf,
                            finalPdfPath,
                            text
                        ],
                        function (this: any, err: Error | null) {
                            if (err) {
                                reject(err)
                            } else {
                                importedIds.push(this.lastID)
                                
                                // Parse and insert segments
                                try {
                                    if (text) {
                                        const segments = parseSegments(text)
                                        if (segments.length > 0) {
                                            const stmt = db.prepare('INSERT INTO segments (law_id, segment_type, label, number, text, page_hint) VALUES (?, ?, ?, ?, ?, ?)')
                                            for (const seg of segments) {
                                                stmt.run([this.lastID, 'article', seg.label, seg.number, seg.text, seg.page_hint])
                                            }
                                            stmt.finalize()
                                        }
                                    }
                                } catch (e) {
                                    console.error(`Failed to parse segments for law ${this.lastID}:`, e)
                                    // Don't fail the whole import
                                 }
                                 
                                 // Try to auto-group the law
                                 groupingService.handleNewLaw(db, this.lastID, law.title, law.jurisdiction)
                                    .catch(err => console.error(`Failed to auto-group law ${this.lastID}:`, err))

                                 resolve()
                             }
                        }
                    )
                })
                
                imported++
            } catch (e) {
                console.error(`Error importing ${law.title}:`, e)
                errors.push({ title: law.title, error: String(e) })
            }
        }

        return { imported, errors, importedIds }
    }
}

export const scraperService = new ScraperService()
