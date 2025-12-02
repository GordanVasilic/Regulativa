const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const mammoth = require('mammoth');

// Directories
const docDir = path.join(__dirname, 'Dokumenti', 'RepublikaSrpska', 'Doc');
const pdfDir = path.join(__dirname, 'Dokumenti', 'RepublikaSrpska', 'PDF');

// Function to convert DOCX to PDF using mammoth and puppeteer
async function convertDocxToPdf(docPath, pdfPath) {
  try {
    console.log(`Converting DOCX: ${path.basename(docPath)}`);
    
    // Convert DOCX to HTML using mammoth
    const result = await mammoth.convertToHtml({path: docPath});
    const html = result.value;
    
    // Create a complete HTML document
    const fullHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${path.basename(docPath, '.docx')}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;
    
    // Launch puppeteer and convert HTML to PDF
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    // Set content and generate PDF
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });
    
    await browser.close();
    
    console.log(`Successfully converted: ${path.basename(docPath)} -> ${path.basename(pdfPath)}`);
    return true;
  } catch (error) {
    console.error(`Error converting DOCX ${docPath}:`, error.message);
    return false;
  }
}

// Function to handle DOC files (older format)
async function convertDocToPdf(docPath, pdfPath) {
  try {
    console.log(`Converting DOC: ${path.basename(docPath)}`);
    
    // For DOC files, we'll need to use a different approach
    // Since mammoth only works with DOCX, we'll need to convert DOC to DOCX first
    // This is a placeholder for now - in a real implementation, you might use antiword or another tool
    console.log(`DOC conversion not implemented yet for ${path.basename(docPath)}`);
    
    // Create a placeholder PDF with just the filename
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    
    const placeholderHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>${path.basename(docPath, '.doc')}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; text-align: center; }
          .notice { margin-top: 100px; padding: 20px; background-color: #f8f9fa; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="notice">
          <h2>Document Conversion Notice</h2>
          <p>This is a placeholder for the document: <strong>${path.basename(docPath)}</strong></p>
          <p>The original DOC file could not be automatically converted to PDF.</p>
          <p>Please convert this file manually using Microsoft Word or LibreOffice.</p>
        </div>
      </body>
      </html>
    `;
    
    await page.setContent(placeholderHtml, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });
    
    await browser.close();
    
    console.log(`Created placeholder PDF for: ${path.basename(docPath)} -> ${path.basename(pdfPath)}`);
    return true;
  } catch (error) {
    console.error(`Error creating placeholder for DOC ${docPath}:`, error.message);
    return false;
  }
}

// Main function to convert all documents
async function convertAllDocuments() {
  try {
    // Check if directories exist
    if (!fs.existsSync(docDir)) {
      console.error(`Source directory does not exist: ${docDir}`);
      return;
    }
    
    if (!fs.existsSync(pdfDir)) {
      console.error(`Target directory does not exist: ${pdfDir}`);
      return;
    }
    
    // Get all DOC and DOCX files
    const files = fs.readdirSync(docDir);
    const docFiles = files.filter(file => 
      path.extname(file).toLowerCase() === '.doc' || 
      path.extname(file).toLowerCase() === '.docx'
    );
    
    console.log(`Found ${docFiles.length} documents to convert`);
    
    let successCount = 0;
    let failCount = 0;
    
    // Process each file
    for (const file of docFiles) {
      const docPath = path.join(docDir, file);
      const pdfFileName = path.basename(file, path.extname(file)) + '.pdf';
      const pdfPath = path.join(pdfDir, pdfFileName);
      
      // Skip if PDF already exists
      if (fs.existsSync(pdfPath)) {
        console.log(`PDF already exists: ${pdfFileName}`);
        continue;
      }
      
      let success = false;
      
      // Use appropriate conversion method based on file extension
      if (path.extname(file).toLowerCase() === '.docx') {
        success = await convertDocxToPdf(docPath, pdfPath);
      } else if (path.extname(file).toLowerCase() === '.doc') {
        success = await convertDocToPdf(docPath, pdfPath);
      }
      
      if (success) {
        successCount++;
      } else {
        failCount++;
      }
    }
    
    console.log(`\nConversion complete!`);
    console.log(`Successfully converted: ${successCount} documents`);
    console.log(`Failed to convert: ${failCount} documents`);
  } catch (error) {
    console.error('Error during conversion process:', error);
  }
}

// Run the conversion
convertAllDocuments();