
import path from 'path';
import fs from 'fs-extra';
import puppeteer from 'puppeteer';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const JURISDICTION_PATHS: Record<string, string> = {
  'RS': 'RepublikaSrpska/PDF',
  'FBiH': 'Federacija BiH/PDF',
  'Srbija': 'Srbija/PDF',
  'Crna Gora': 'Crna Gora/PDF',
  'Brcko': 'Brcko/PDF',
  // Fallback
  'BiH': 'BiH/PDF'
};

export class PdfService {
  private getDocsRoot() {
    // Assuming process.cwd() is apps/api
    return path.resolve(process.cwd(), '../../Dokumenti');
  }

  private getPdfPath(jurisdiction: string, filename: string): string {
    const subPath = JURISDICTION_PATHS[jurisdiction] || `${jurisdiction}/PDF`;
    return path.join(this.getDocsRoot(), subPath, filename);
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[\\/:*?"<>|]/g, '').trim();
  }

  private formatTextForHtml(text: string): string {
    // 0. Pre-clean: 
    // Remove [[PAGE_N]] markers
    let cleaned = text.replace(/\[\[PAGE_\d+\]\]/g, '');
    
    // Ensure "Član X." always starts a new line if it's mashed
    cleaned = cleaned
      .replace(/([^\n])\s*((?:Član|Clan|Članak|Clanak|Čl\.|Cl\.|Члан|Члаanak|Чл\.))\s*(\d+)/gi, '$1\n$2 $3');
    
    // Ensure paragraphs like (1), (2), 1., 2., - starts on new line
    // Look for (1) or 1. or - preceded by something that isn't a newline
    cleaned = cleaned.replace(/([^\n])\s+(\(\d+\))/g, '$1\n$2');
    // For bullets, be careful not to break words with hyphens
    cleaned = cleaned.replace(/([^\n])\s+(-\s+)/g, '$1\n$2');

    // 1. Normalize line endings
    const lines = cleaned.split(/\r?\n/);

    // 2. Process line by line
    const htmlLines = lines.map(line => {
      let trimmed = line.trim();
      if (!trimmed) return '<br/>'; // Empty line

      // Escape HTML
      let escaped = trimmed.replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      } as any)[c]);

      // Detect Headers: Short line + All Caps (allowing for some punctuation/digits)
      // e.g. "GLAVA I", "OSNOVNE ODREDBE", "DIO PRVI"
      // Must be at least 3 chars long to avoid "A" or "1"
      const isAllCaps = /^[^a-zčćđšž]{3,}$/.test(trimmed) && trimmed.length < 100;
      if (isAllCaps) {
          // Check for specific keywords to be sure, or just trust all caps short lines?
          // Let's trust short all caps lines as headers (h4)
          // But if it contains "GLAVA" or "DIO" or "ODJELJAK", make it h2
          if (/^(GLAVA|DIO|ODJELJAK|DEO)\s+/i.test(trimmed)) {
              return `<h2 style="text-align: center; font-weight: bold; margin-top: 24px; margin-bottom: 16px;">${escaped}</h2>`;
          }
          return `<h4 style="text-align: center; font-weight: bold; margin-top: 16px; margin-bottom: 8px;">${escaped}</h4>`;
      }

      // Check if it's an article heading
      // Using a more robust regex that ignores extra junk and handles diacritics better
      // Permissive ending: dot, boundary, or end of string
      const articleMatch = /^\s*((?:Član|Clan|Članak|Clanak|Čl\.|Cl\.|Члан|Члаanak|Чл\.))\s*(\d+)(\.?)(\s*)$/i.exec(escaped);
      if (articleMatch) {
        // Use regular space instead of &nbsp; to avoid weird PDF text segmentation
        return `<h3 id="article-${articleMatch[2]}">${articleMatch[1]} ${articleMatch[2]}${articleMatch[3]}</h3>`;
      }
      
      // Handle list items (simple indentation)
      if (/^\(\d+\)/.test(escaped) || /^-\s+/.test(escaped) || /^\d+\./.test(escaped)) {
          return `<div style="padding-left: 30px; text-indent: -10px;">${escaped}</div>`;
      }

      // Default paragraph (justified)
      return `<div style="text-align: justify;">${escaped}</div>`;
    });

    return htmlLines.join('\n');
  }

  async extractText(filePath: string): Promise<{ text: string }> {
    const dataBuffer = await fs.readFile(filePath);
    const uint8Array = new Uint8Array(dataBuffer);

    const doc = await pdfjsLib.getDocument(uint8Array).promise;
    let fullText = '';

    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        
        let pageText = '';
        let lastY = -1;
        let lastX = -1;

        // @ts-ignore
        const items = content.items as any[];

        for (const item of items) {
            const y = item.transform[5];
            const x = item.transform[4];
            
            // If y changes significantly, it's a new line
            // Note: In PDF coordinate system, Y usually goes up? Or down?
            // Usually we just check diff. 
            // Also need to handle small drifts.
            
            if (lastY !== -1) {
                 const diffY = Math.abs(y - lastY);
                 if (diffY > 5) { // Threshold for new line
                     pageText += '\n';
                 } else {
                     // Same line
                     // Add space if X gap is significant?
                     // const width = item.width; // item.width might be needed from font
                     // Simple heuristic: always add space if not empty
                     if (item.str.trim().length > 0) {
                        // Check if previous char was space?
                        // Just adding space is safer than merging words
                        // But we don't want " W o r d "
                        // Usually pdfjs items are words or fragments.
                        
                        // Check distance
                        const dist = Math.abs(x - lastX);
                        // If dist is small, maybe no space?
                        // Let's just add space for now to be safe, normalizeText handles double spaces.
                        pageText += ' '; 
                     }
                 }
            }
            
            pageText += item.str;
            lastY = y;
            lastX = x + item.width; // Approximation
        }

        fullText += `[[PAGE_${i}]]\n` + pageText + '\n\n';
    }

    return { text: fullText };
  }

  async generatePdf(title: string, text: string, jurisdiction: string, gazetteKey?: string): Promise<string> {
    const safeTitle = this.sanitizeFileName(title);
    const suffix = gazetteKey ? `-${this.sanitizeFileName(gazetteKey)}` : '';
    const filename = `${safeTitle}${suffix}.pdf`;
    const outPath = this.getPdfPath(jurisdiction, filename);

    // Ensure directory exists
    await fs.ensureDir(path.dirname(outPath));

    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] } as any);
    try {
      const page = await browser.newPage();

      const formattedBody = this.formatTextForHtml(text);

      // Simple HTML template
      const contentHtml = `
        <!doctype html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: 'Arial', sans-serif; font-size: 11pt; line-height: 1.6; color: #000; padding: 40px; }
            h1 { font-size: 16pt; margin-bottom: 24px; text-align: center; font-weight: bold; }
            h3 { font-size: 13pt; margin-top: 20px; margin-bottom: 10px; font-weight: bold; text-align: center; display: block; }
            .meta { font-size: 10pt; color: #666; margin-bottom: 30px; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 20px; }
            .content { text-align: justify; }
            .content div { margin-bottom: 8px; min-height: 1em; }
            .content br { content: ""; display: block; margin-top: 10px; }
          </style>
        </head>
        <body>
          <h1>${title}</h1>
          <div class="meta">
            <strong>Nadležnost:</strong> ${jurisdiction} <br/>
            <strong>Službeni glasnik:</strong> ${gazetteKey || 'N/A'}
          </div>
          <div class="content">${formattedBody}</div>
        </body>
        </html>
      `;

      await page.setContent(contentHtml, { waitUntil: 'load' });
      await page.pdf({ path: outPath, format: 'A4', printBackground: true, margin: { top: '2cm', bottom: '2cm', left: '2cm', right: '2cm' } });

      return outPath;
    } finally {
      await browser.close();
    }
  }
}

export const pdfService = new PdfService();
