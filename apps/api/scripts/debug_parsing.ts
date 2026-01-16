
import sqlite3 from 'sqlite3'
import path from 'path'
import { pdfService } from '../src/services/pdf.service.js'
import { parseSegments, normalizeText } from '../src/services/law-parsing.service.js'

const DB_PATH = path.join(process.cwd(), 'data', 'regulativa.db')
const db = new sqlite3.Database(DB_PATH)

async function debug() {
    // Find the law
    db.get(`SELECT * FROM laws WHERE title LIKE '%dragocjenih%' ORDER BY id DESC LIMIT 1`, async (err, law: any) => {
        if (err || !law) {
            console.error('Law not found', err)
            return
        }
        
        console.log('Found law:', law.title)
        console.log('PDF Path:', law.path_pdf)
        
        // Extract text
        console.log('Extracting text...')
        const { text } = await pdfService.extractText(law.path_pdf)
        console.log('Text length:', text.length)
        console.log('First 500 chars:', text.slice(0, 500))
        
        // Normalize
        const normalized = normalizeText(text)
        console.log('Normalized length:', normalized.length)
        console.log('Normalized first 500:', normalized.slice(0, 500))
        
        // Parse segments
        const segments = parseSegments(text)
        console.log('Segments found:', segments.length)
        if (segments.length > 0) {
            console.log('First segment:', segments[0])
        } else {
            console.log('No segments found!')
            // Debug regex
            const headingTokens = '(?:Č\\s*lan|C\\s*lan|Č\\s*lanak|C\\s*lanak|Č\\s*l\\.|C\\s*l\\.|Ч\\s*лан|Ч\\s*л\\.)';
            const wsClass = "[\\s\\u00A0\\u2000-\\u200B]";
            const reAll = new RegExp(`${headingTokens}${wsClass}*(\\d{1,3})(?:\\.|-|:\\u2013|\\u2014|${wsClass}|$)`, 'gi');
            let m;
            let count = 0;
            while ((m = reAll.exec(normalized)) !== null) {
                console.log('Match:', m[0])
                count++
                if (count > 5) break;
            }
        }
    })
}

debug()
