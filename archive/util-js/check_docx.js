const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph } = require('docx');

async function checkDocxFile(docxPath) {
  try {
    // Read the DOCX file
    const buffer = fs.readFileSync(docxPath);
    
    // Create a temporary file to extract the text
    const tempPath = path.join(path.dirname(docxPath), 'temp_extract.txt');
    
    // Use LibreOffice to convert DOCX to text
    const { exec } = require('child_process');
    
    await new Promise((resolve, reject) => {
      exec(`"C:\\Program Files\\LibreOffice\\program\\soffice.exe" --headless --convert-to txt --outdir "${path.dirname(docxPath)}" "${docxPath}"`, (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout);
      });
    });
    
    // Read the extracted text
    const txtPath = docxPath.replace('.docx', '.txt');
    const text = fs.readFileSync(txtPath, 'utf8');
    
    // Display the first 500 characters
    console.log('First 500 characters of extracted text:');
    console.log(text.substring(0, 500));
    
    // Clean up the temporary text file
    fs.unlinkSync(txtPath);
  } catch (error) {
    console.error('Error:', error);
  }
}

// Check the DOCX file
checkDocxFile('D:\\Projekti\\Regulativa\\Dokumenti\\Federacija BiH\\Doc\\Zakon o štrajku FBiH-14_00.docx');