const fs = require("fs");
const path = require("path");
// pdf-parse može biti ESM; koristimo dinamički import da osiguramo ispravan default.
const { Document, Packer, Paragraph } = require("docx");

async function ensureDir(dirPath) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function convertPdfToDocx(pdfFilePath, docxFilePath) {
  try {
    const pdfModule = require("pdf-parse");
    const buffer = await fs.promises.readFile(pdfFilePath);
    const uint8 = new Uint8Array(buffer);
    const parser = new pdfModule.PDFParse(uint8, {
      standardFontDataUrl: path.resolve(__dirname, "node_modules", "pdfjs-dist", "standard_fonts"),
    });
    await parser.load();
    const parsed = await parser.getText();
    const text = typeof parsed === "string" ? parsed : (parsed && parsed.text) ? parsed.text : "";

    const paragraphs = text
      .split(/\r?\n/)
      .map((line) => new Paragraph(line));

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs.length ? paragraphs : [new Paragraph("")],
        },
      ],
    });

    const docBuffer = await Packer.toBuffer(doc);
    await fs.promises.writeFile(docxFilePath, docBuffer);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function main() {
  const srcDir = path.resolve(__dirname, "Dokumenti", "Federacija BiH", "PDF");
  const dstDir = path.resolve(__dirname, "Dokumenti", "Federacija BiH", "Doc");

  if (!fs.existsSync(srcDir)) {
    console.error("Izvorni folder ne postoji:", srcDir);
    process.exit(1);
  }

  await ensureDir(dstDir);

  const files = await fs.promises.readdir(srcDir);
  const pdfFiles = files.filter((f) => f.toLowerCase().endsWith(".pdf"));

  if (pdfFiles.length === 0) {
    console.log("Nema PDF fajlova za konverziju u:", srcDir);
    return;
  }

  console.log(`Pronađeno PDF fajlova: ${pdfFiles.length}`);

  let success = 0;
  let failed = 0;
  const errors = [];

  for (const pdfName of pdfFiles) {
    const inputPath = path.join(srcDir, pdfName);
    const baseName = pdfName.replace(/\.pdf$/i, "");
    const outputPath = path.join(dstDir, `${baseName}.docx`);

    const result = await convertPdfToDocx(inputPath, outputPath);
    if (result.ok) {
      success += 1;
      console.log("OK:", pdfName, "->", `${baseName}.docx`);
    } else {
      failed += 1;
      const msg = result.error && result.error.message ? result.error.message : String(result.error);
      errors.push({ file: pdfName, error: msg });
      console.error("ERR:", pdfName, "=>", msg);
    }
  }

  console.log("\nSažetak:");
  console.log("Uspješno konvertovano:", success);
  console.log("Neuspješno:", failed);
  if (errors.length) {
    console.log("Problemi:", JSON.stringify(errors, null, 2));
  }
}

main().catch((e) => {
  console.error("Neočekivana greška:", e);
  process.exit(1);
});