
import path from 'path';
import fs from 'fs-extra';
import puppeteer from 'puppeteer';

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
    // 1. Normalize line endings and whitespace
    let clean = text
      .replace(/\r\n/g, '\n')
      .replace(/\u00A0/g, ' ') // Replace non-breaking space with normal space
      .replace(/\n{3,}/g, '\n\n'); // Collapse 3+ newlines to 2 (max 1 empty line)

    // 2. Escape HTML
    clean = clean.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    } as any)[c]);

    // 3. Format "Član X" as headings
    // Looks for "Član <digits>" at start of line or after newline
    // Wraps in <h3> for visual distinction and PDF accessibility
    // Use &nbsp; to keep "Član" and number together
    // Supports Latin (Član, Članak, Čl, Cl) and Cyrillic (Члан, Чланак, Чл)
    clean = clean.replace(/(^|\n)\s*((?:Član|Clan|Članak|Clanak|Čl\.|Cl\.|Члан|Чланак|Чл\.))\s*(\d+)\.?\s*/gi, '$1<h3>$2&nbsp;$3</h3>');

    return clean;
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
            body { font-family: 'Arial', sans-serif; font-size: 12pt; line-height: 1.5; color: #000; padding: 40px; }
            h1 { font-size: 18pt; margin-bottom: 24px; text-align: center; font-weight: bold; }
            h3 { font-size: 14pt; margin-top: 24px; margin-bottom: 12px; font-weight: bold; text-align: center; }
            .meta { font-size: 10pt; color: #666; margin-bottom: 30px; text-align: center; border-bottom: 1px solid #eee; padding-bottom: 20px; }
            .content { white-space: pre-wrap; word-wrap: break-word; text-align: justify; }
            /* Ensure h3 inside content breaks out of pre-wrap flow visually */
            .content h3 { margin-top: 1.5em; margin-bottom: 0.5em; display: block; text-align: center; }
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
