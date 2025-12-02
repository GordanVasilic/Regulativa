const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PDFDocument: PDFLib } = require('pdf-lib');
const iconv = require('iconv-lite');

async function cleanPdfFile() {
    const inputFile = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'PDF', 'Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH-48_99.pdf');
    const outputDir = path.join(__dirname, 'Dokumenti', 'Federacija BiH', 'PDF', 'output');
    const outputFile = path.join(outputDir, 'Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH-48_99.pdf');
    
    // Create output directory if it doesn't exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    
    try {
        // Read the original PDF
        const existingPdfBytes = fs.readFileSync(inputFile);
        
        // Extract text content from the PDF
        const { PDFParse } = require('pdf-parse');
        const uint8Array = new Uint8Array(existingPdfBytes);
        const parser = new PDFParse(uint8Array, {
            standardFontDataUrl: path.resolve(__dirname, 'node_modules/pdfjs-dist/standard_fonts/')
        });
        await parser.load();
        const data = await parser.getText();
        
        // Fix Croatian character encoding
        let fixedText = data.text;
        
        // First fix the most common encoding issues
        fixedText = fixedText.replace(/nađe/g, 'nje');
        fixedText = fixedText.replace(/rađe/g, 're');
        fixedText = fixedText.replace(/nađed/g, 'njeđ');
        fixedText = fixedText.replace(/rađed/g, 'ređ');
        fixedText = fixedText.replace(/nađen/g, 'njen');
        fixedText = fixedText.replace(/rađen/g, 'ren');
        fixedText = fixedText.replace(/nađem/g, 'njem');
        fixedText = fixedText.replace(/rađem/g, 'rem');
        fixedText = fixedText.replace(/nađel/g, 'njl');
        fixedText = fixedText.replace(/rađel/g, 'rl');
        fixedText = fixedText.replace(/nađes/g, 'njes');
        fixedText = fixedText.replace(/rađes/g, 'res');
        fixedText = fixedText.replace(/nađeu/g, 'njeu');
        fixedText = fixedText.replace(/rađeu/g, 'reu');
        fixedText = fixedText.replace(/nađei/g, 'njei');
        fixedText = fixedText.replace(/rađei/g, 'rei');
        fixedText = fixedText.replace(/nađeo/g, 'njeo');
        fixedText = fixedText.replace(/rađeo/g, 'reo');
        fixedText = fixedText.replace(/nađea/g, 'njea');
        fixedText = fixedText.replace(/rađea/g, 'rea');
        fixedText = fixedText.replace(/nađe/g, 'nje');
        fixedText = fixedText.replace(/rađe/g, 're');
        
        // Fix specific Croatian characters
        fixedText = fixedText.replace(/\^lanak/g, 'Članak');
        fixedText = fixedText.replace(/~lanak/g, 'Članak');
        fixedText = fixedText.replace(/~lanku/g, 'članku');
        fixedText = fixedText.replace(/~lanak/g, 'članak');
        fixedText = fixedText.replace(/~lanka/g, 'članka');
        fixedText = fixedText.replace(/mo'e/g, 'može');
        fixedText = fixedText.replace(/na|e/g, 'nađe');
        fixedText = fixedText.replace(/za{iti/g, 'zaštiti');
        fixedText = fixedText.replace(/gra|anina/g, 'građanina');
        fixedText = fixedText.replace(/zajam~enih/g, 'zajamčenih');
        fixedText = fixedText.replace(/dono{enja/g, 'donošenja');
        fixedText = fixedText.replace(/pravomo}nog/g, 'pravomoćnog');
        fixedText = fixedText.replace(/slu'benih/g, 'službenih');
        fixedText = fixedText.replace(/ovla{}ene/g, 'ovlašćene');
        fixedText = fixedText.replace(/rje{avanja/g, 'rješavanja');
        fixedText = fixedText.replace(/Slu'bene/g, 'Službene');
        fixedText = fixedText.replace(/"Slu'bene novine/g, '"Službene novine');
        fixedText = fixedText.replace(/"Slu'benim novinama/g, '"Službenim novinama');
        
        // Fix special apostrophe characters (Unicode 8217/0x2019)
        fixedText = fixedText.replace(/\u2019/g, 'ž');
        
        // Fix common Croatian character patterns
        fixedText = fixedText.replace(/šće/g, 'še');
        fixedText = fixedText.replace(/Šće/g, 'Še');
        fixedText = fixedText.replace(/će/g, 'će');
        fixedText = fixedText.replace(/Će/g, 'Će');
        fixedText = fixedText.replace(/đ/g, 'đ');
        fixedText = fixedText.replace(/Đ/g, 'Đ');
        fixedText = fixedText.replace(/č/g, 'č');
        fixedText = fixedText.replace(/Č/g, 'Č');
        fixedText = fixedText.replace(/ć/g, 'ć');
        fixedText = fixedText.replace(/Ć/g, 'Ć');
        fixedText = fixedText.replace(/š/g, 'š');
        fixedText = fixedText.replace(/Š/g, 'Š');
        fixedText = fixedText.replace(/ž/g, 'ž');
        fixedText = fixedText.replace(/Ž/g, 'Ž');
        
        // Fix specific problematic patterns
        fixedText = fixedText.replace(/možće/g, 'može');
        fixedText = fixedText.replace(/će|će/g, 'će');
        fixedText = fixedText.replace(/će šće/g, 'će se');
        fixedText = fixedText.replace(/će sjednici/g, 'će sjednici');
        fixedText = fixedText.replace(/će šćegu/g, 'će se na');
        fixedText = fixedText.replace(/daće/g, 'dane');
        fixedText = fixedText.replace(/daće/g, 'dane');
        fixedText = fixedText.replace(/objavće/g, 'objave');
        fixedText = fixedText.replace(/novićema/g, 'novinama');
        fixedText = fixedText.replace(/prćeglćedati/g, 'pregledati');
        fixedText = fixedText.replace(/služžbene/g, 'službene');
        fixedText = fixedText.replace(/služžbenih/g, 'službenih');
        fixedText = fixedText.replace(/ovlašććenće/g, 'ovlaštena');
        fixedText = fixedText.replace(/rješavanje/g, 'rješavanje');
        fixedText = fixedText.replace(/pošćebno/g, 'posebno');
        fixedText = fixedText.replace(/potrćebnih/g, 'potrebnih');
        fixedText = fixedText.replace(/dokumćećeta/g, 'dokumenta');
        fixedText = fixedText.replace(/prćedmćet/g, 'predmet');
        fixedText = fixedText.replace(/prćedsjedatćelj/g, 'predsjedatelj');
        fixedText = fixedText.replace(/instrumćentima/g, 'instrumentima');
        fixedText = fixedText.replace(/ćevćedćenim/g, 'načinjenim');
        fixedText = fixedText.replace(/Anćeksu/g, 'Aneksu');
        fixedText = fixedText.replace(/zajamčćenih/g, 'zajamčenih');
        fixedText = fixedText.replace(/vanrćednih/g, 'vanrednih');
        fixedText = fixedText.replace(/lijekova/g, 'lijekova');
        fixedText = fixedText.replace(/prćeglćedati/g, 'pregledati');
        fixedText = fixedText.replace(/službćeće/g, 'službene');
        fixedText = fixedText.replace(/dokumćenta/g, 'dokumenta');
        fixedText = fixedText.replace(/odnošće/g, 'odnose');
        fixedText = fixedText.replace(/upravnće/g, 'upravne');
        fixedText = fixedText.replace(/spišće/g, 'spise');
        fixedText = fixedText.replace(/zahtijevati/g, 'zahtijevati');
        fixedText = fixedText.replace(/osobće/g, 'osobe');
        fixedText = fixedText.replace(/informacija/g, 'informacija');
        fixedText = fixedText.replace(/spisa/g, 'spisa');
        fixedText = fixedText.replace(/odnošće/g, 'odnose');
        fixedText = fixedText.replace(/upravnu/g, 'upravnu');
        fixedText = fixedText.replace(/stvar/g, 'stvar');
        fixedText = fixedText.replace(/prćedmćet/g, 'predmet');
        fixedText = fixedText.replace(/postupka/g, 'postupka');
        fixedText = fixedText.replace(/ombudsmćen/g, 'ombudsman');
        fixedText = fixedText.replace(/će šćegu/g, 'će se na');
        fixedText = fixedText.replace(/osmog daće/g, 'osmog dana');
        fixedText = fixedText.replace(/od daće/g, 'od dana');
        fixedText = fixedText.replace(/objavće/g, 'objave');
        fixedText = fixedText.replace(/novićema/g, 'novinama');
        fixedText = fixedText.replace(/prćedsjedatćelj/g, 'predsjedatelj');
        
        // Fix remaining specific patterns
        fixedText = fixedText.replace(/Fnađednađeracijnađe/g, 'Federacije');
        fixedText = fixedText.replace(/Bosnnađe/g, 'Bosne');
        fixedText = fixedText.replace(/Hnađercnađegovinnađe/g, 'Hercegovine');
        fixedText = fixedText.replace(/Parlamnađent/g, 'Parlament');
        fixedText = fixedText.replace(/Zastupni~kog/g, 'Zastupničkog');
        fixedText = fixedText.replace(/odr'anoj/g, 'održanoj');
        fixedText = fixedText.replace(/odr\u2019anoj/g, 'održanoj');
        fixedText = fixedText.replace(/svibnja/g, 'svibnja');
        fixedText = fixedText.replace(/godinnađe/g, 'godine');
        fixedText = fixedText.replace(/studnađenog/g, 'studenog');
        fixedText = fixedText.replace(/Sarajnađevo/g, 'Sarajevo');
        fixedText = fixedText.replace(/Prnađedsjnađednik/g, 'Predsjednik');
        fixedText = fixedText.replace(/Andri}/g, 'Andrić');
        fixedText = fixedText.replace(/Lu'anski/g, 'Lužanski');
        fixedText = fixedText.replace(/Lu\u2019anski/g, 'Lužanski');
        fixedText = fixedText.replace(/Članađek/g, 'Članak');
        fixedText = fixedText.replace(/Slu'bnađennađe/g, 'Službene');
        fixedText = fixedText.replace(/Slu\u2019bnađennađe/g, 'Službene');
        fixedText = fixedText.replace(/novinnađe/g, 'novine');
        fixedText = fixedText.replace(/rnađedu/g, 'redu');
        fixedText = fixedText.replace(/rijnađe~i/g, 'riječi');
        fixedText = fixedText.replace(/posnađebnim/g, 'poslovnim');
        fixedText = fixedText.replace(/Ombudsmnađen/g, 'Ombudsman');
        fixedText = fixedText.replace(/mo'nađe/g, 'može');
        fixedText = fixedText.replace(/mo\u2019nađe/g, 'može');
        fixedText = fixedText.replace(/tnađemnađelja/g, 'temelja');
        fixedText = fixedText.replace(/tnađemnađelju/g, 'temelju');
        fixedText = fixedText.replace(/snađe/g, 'šće');
        fixedText = fixedText.replace(/nađe/g, 'će');
        fixedText = fixedText.replace(/fnađednađeralnim/g, 'federalnim');
        fixedText = fixedText.replace(/fnađednađeralna/g, 'federalna');
        fixedText = fixedText.replace(/fnađednađeralni/g, 'federalni');
        fixedText = fixedText.replace(/fnađednađeracije/g, 'federacije');
        fixedText = fixedText.replace(/fnađednađeracija/g, 'federacija');
        fixedText = fixedText.replace(/fnađednađeral/g, 'federal');
        fixedText = fixedText.replace(/fnađednađer/g, 'feder');
        fixedText = fixedText.replace(/fnađed/g, 'fede');
        fixedText = fixedText.replace(/nađed/g, 'fed');
        fixedText = fixedText.replace(/nađe/g, 'će');
        fixedText = fixedText.replace(/nađi/g, 'ći');
        fixedText = fixedText.replace(/nađo/g, 'ćo');
        fixedText = fixedText.replace(/nađu/g, 'ću');
        fixedText = fixedText.replace(/nađa/g, 'ća');
        fixedText = fixedText.replace(/nađ/g, 'ć');
        fixedText = fixedText.replace(/snađ/g, 'šć');
        fixedText = fixedText.replace(/znađ/g, 'žđ');
        fixedText = fixedText.replace(/cnađ/g, 'čđ');
        fixedText = fixedText.replace(/dnađ/g, 'dž');
        fixedText = fixedText.replace(/izmjćećema/g, 'izmjenama');
        fixedText = fixedText.replace(/dopućema/g, 'dopunama');
        fixedText = fixedText.replace(/Zakoće/g, 'Zakona');
        fixedText = fixedText.replace(/jće/g, 'je');
        fixedText = fixedText.replace(/sjćednici/g, 'sjednici');
        fixedText = fixedText.replace(/ćeroda/g, 'naroda');
        fixedText = fixedText.replace(/odr'anoj/g, 'održanoj');
        fixedText = fixedText.replace(/Slu'bćenće/g, 'Službene');
        fixedText = fixedText.replace(/dodajće/g, 'dodaje');
        fixedText = fixedText.replace(/rijće~/g, 'riječi');
        fixedText = fixedText.replace(/fćedćeralnim/g, 'federalnim');
        fixedText = fixedText.replace(/mijćenja/g, 'mijenja');
        fixedText = fixedText.replace(/mo'će/g, 'može');
        fixedText = fixedText.replace(/ima/g, 'ima');
        fixedText = fixedText.replace(/odr'anoj/g, 'održanoj');
        fixedText = fixedText.replace(/odr'ano/g, 'održano');
        fixedText = fixedText.replace(/odr'an/g, 'održan');
        fixedText = fixedText.replace(/Slu'bćenće/g, 'Službene');
        fixedText = fixedText.replace(/Slu'bćen/g, 'Služben');
        fixedText = fixedText.replace(/rije~/g, 'riječi');
        fixedText = fixedText.replace(/rije~/g, 'riječ');
        fixedText = fixedText.replace(/mo'će/g, 'može');
        fixedText = fixedText.replace(/mo'ć/g, 'mož');
        fixedText = fixedText.replace(/će|će/g, 'će');
        fixedText = fixedText.replace(/šć/g, 'šć');
        fixedText = fixedText.replace(/đ/g, 'đ');
        fixedText = fixedText.replace(/č/g, 'č');
        fixedText = fixedText.replace(/ć/g, 'ć');
        fixedText = fixedText.replace(/š/g, 'š');
        fixedText = fixedText.replace(/ž/g, 'ž');
        // Fix special character encodings
        fixedText = fixedText.replace(/~/g, 'č');
        fixedText = fixedText.replace(/{/g, 'š');
        fixedText = fixedText.replace(/}/g, 'ć');
        fixedText = fixedText.replace(/\[/g, 'č');
        fixedText = fixedText.replace(/\]/g, 'ć');
        
        // Fix specific Croatian character patterns
        fixedText = fixedText.replace(/šće/g, 'će');
        fixedText = fixedText.replace(/će/g, 'će');
        fixedText = fixedText.replace(/može/g, 'može');
        fixedText = fixedText.replace(/mož/g, 'mož');
        fixedText = fixedText.replace(/održanoj/g, 'održanoj');
        fixedText = fixedText.replace(/održano/g, 'održano');
        fixedText = fixedText.replace(/održan/g, 'održan');
        fixedText = fixedText.replace(/Službene/g, 'Službene');
        fixedText = fixedText.replace(/Služben/g, 'Služben');
        fixedText = fixedText.replace(/riječi/g, 'riječi');
        fixedText = fixedText.replace(/riječ/g, 'riječ');
        fixedText = fixedText.replace(/federalnim/g, 'federalnim');
        fixedText = fixedText.replace(/mijenja/g, 'mijenja');
        fixedText = fixedText.replace(/PROGLAŠENJU/g, 'PROGLAŠENJU');
        fixedText = fixedText.replace(/Proglašava/g, 'Proglašava');
        fixedText = fixedText.replace(/izmjenama/g, 'izmjenama');
        fixedText = fixedText.replace(/dopunama/g, 'dopunama');
        fixedText = fixedText.replace(/Zakona/g, 'Zakona');
        fixedText = fixedText.replace(/upravnom/g, 'upravnom');
        fixedText = fixedText.replace(/postupku/g, 'postupku');
        fixedText = fixedText.replace(/je/g, 'je');
        fixedText = fixedText.replace(/sjednici/g, 'sjednici');
        fixedText = fixedText.replace(/Doma naroda/g, 'Doma naroda');
        fixedText = fixedText.replace(/Broj/g, 'Broj');
        fixedText = fixedText.replace(/v\. r\./g, 'v. r.');
        fixedText = fixedText.replace(/Lužanski/g, 'Lužanski');
        fixedText = fixedText.replace(/prisustvovati/g, 'prisustvovati');
        fixedText = fixedText.replace(/ljudskog/g, 'ljudskog');
        fixedText = fixedText.replace(/dostojanstva/g, 'dostojanstva');
        fixedText = fixedText.replace(/prava/g, 'prava');
        fixedText = fixedText.replace(/sloboda/g, 'sloboda');
        fixedText = fixedText.replace(/građanina/g, 'građanina');
        fixedText = fixedText.replace(/zajamčenih/g, 'zajamčenih');
        fixedText = fixedText.replace(/ustavom/g, 'ustavom');
        fixedText = fixedText.replace(/instrumentima/g, 'instrumentima');
        fixedText = fixedText.replace(/navedenim/g, 'navedenim');
        fixedText = fixedText.replace(/Aneksu/g, 'Aneksu');
        fixedText = fixedText.replace(/Federacije/g, 'Federacije');
        fixedText = fixedText.replace(/pravomoćnog/g, 'pravomoćnog');
        fixedText = fixedText.replace(/upravnog/g, 'upravnog');
        fixedText = fixedText.replace(/akta/g, 'akta');
        fixedText = fixedText.replace(/postupcima/g, 'postupcima');
        fixedText = fixedText.replace(/vanrednih/g, 'vanrednih');
        fixedText = fixedText.replace(/pravnih/g, 'pravnih');
        fixedText = fixedText.replace(/lijekova/g, 'lijekova');
        fixedText = fixedText.replace(/toku/g, 'toku');
        fixedText = fixedText.replace(/ovog/g, 'ovog');
        fixedText = fixedText.replace(/članka/g, 'članka');
        fixedText = fixedText.replace(/pregledati/g, 'pregledati');
        fixedText = fixedText.replace(/sva/g, 'sva');
        fixedText = fixedText.replace(/službene/g, 'službene');
        fixedText = fixedText.replace(/dokumenta/g, 'dokumenta');
        fixedText = fixedText.replace(/koja/g, 'koja');
        fixedText = fixedText.replace(/odnose/g, 'odnose');
        fixedText = fixedText.replace(/se/g, 'se');
        fixedText = fixedText.replace(/upravnim/g, 'upravnim');
        fixedText = fixedText.replace(/spisima/g, 'spisima');
        fixedText = fixedText.replace(/zahtijevati/g, 'zahtijevati');
        fixedText = fixedText.replace(/suradnju/g, 'suradnju');
        fixedText = fixedText.replace(/službenih/g, 'službenih');
        fixedText = fixedText.replace(/osoba/g, 'osoba');
        fixedText = fixedText.replace(/ovlaštenih/g, 'ovlaštenih');
        fixedText = fixedText.replace(/rješavanje/g, 'rješavanje');
        fixedText = fixedText.replace(/upravih/g, 'upravih');
        fixedText = fixedText.replace(/stvari/g, 'stvari');
        fixedText = fixedText.replace(/upravnom/g, 'upravnom');
        fixedText = fixedText.replace(/postupku/g, 'postupku');
        fixedText = fixedText.replace(/drugih/g, 'drugih');
        fixedText = fixedText.replace(/posebno/g, 'posebno');
        fixedText = fixedText.replace(/pribavljanju/g, 'pribavljanju');
        fixedText = fixedText.replace(/potrebnih/g, 'potrebnih');
        fixedText = fixedText.replace(/informacija/g, 'informacija');
        fixedText = fixedText.replace(/dokumenata/g, 'dokumenata');
        fixedText = fixedText.replace(/spisa/g, 'spisa');
        fixedText = fixedText.replace(/koji/g, 'koji');
        fixedText = fixedText.replace(/odnose/g, 'odnose');
        fixedText = fixedText.replace(/se/g, 'se');
        fixedText = fixedText.replace(/upravnu/g, 'upravnu');
        fixedText = fixedText.replace(/stvar/g, 'stvar');
        fixedText = fixedText.replace(/koja/g, 'koja');
        fixedText = fixedText.replace(/je/g, 'je');
        fixedText = fixedText.replace(/predmet/g, 'predmet');
        fixedText = fixedText.replace(/upravnog/g, 'upravnog');
        fixedText = fixedText.replace(/postupka/g, 'postupka');
        fixedText = fixedText.replace(/ombudsman/g, 'ombudsman');
        fixedText = fixedText.replace(/osmog/g, 'osmog');
        fixedText = fixedText.replace(/dana/g, 'dana');
        fixedText = fixedText.replace(/od/g, 'od');
        fixedText = fixedText.replace(/dana/g, 'dana');
        fixedText = fixedText.replace(/objave/g, 'objave');
        fixedText = fixedText.replace(/Službenim/g, 'Službenim');
        fixedText = fixedText.replace(/novinama/g, 'novinama');
        fixedText = fixedText.replace(/Predsjedatelj/g, 'Predsjedatelj');
        
        // Ensure Croatian characters are properly encoded
        fixedText = fixedText.replace(/šć/g, 'šć');
        fixedText = fixedText.replace(/đ/g, 'đ');
        fixedText = fixedText.replace(/č/g, 'č');
        fixedText = fixedText.replace(/ć/g, 'ć');
        fixedText = fixedText.replace(/š/g, 'š');
        fixedText = fixedText.replace(/ž/g, 'ž');
        fixedText = fixedText.replace(/'/g, 'ž');
        fixedText = fixedText.replace(/~/g, 'č');
        fixedText = fixedText.replace(/{/g, 'š');
        fixedText = fixedText.replace(/}/g, 'ć');
        fixedText = fixedText.replace(/\[/g, 'č');
        fixedText = fixedText.replace(/\]/g, 'ć');
        fixedText = fixedText.replace(/će|će/g, 'će');
        fixedText = fixedText.replace(/šć/g, 'šć');
        fixedText = fixedText.replace(/đ/g, 'đ');
        fixedText = fixedText.replace(/č/g, 'č');
        fixedText = fixedText.replace(/ć/g, 'ć');
        fixedText = fixedText.replace(/š/g, 'š');
        fixedText = fixedText.replace(/ž/g, 'ž');
        fixedText = fixedText.replace(/prisustvovati/g, 'prisustvovati');
        fixedText = fixedText.replace(/PROGLAčENJU/g, 'PROGLAŠENJU');
        fixedText = fixedText.replace(/PROGLA\[ENJU/g, 'PROGLAŠENJU');
        fixedText = fixedText.replace(/Progla{ava/g, 'Proglašava');
        fixedText = fixedText.replace(/izmjnađenađema/g, 'izmjenama');
        fixedText = fixedText.replace(/dopunađema/g, 'dopunama');
        fixedText = fixedText.replace(/Zakonađe/g, 'Zakona');
        fixedText = fixedText.replace(/upravnom/g, 'upravnom');
        fixedText = fixedText.replace(/postupku/g, 'postupku');
        fixedText = fixedText.replace(/jnađe/g, 'je');
        fixedText = fixedText.replace(/sjnađednici/g, 'sjednici');
        fixedText = fixedText.replace(/Doma nađeroda/g, 'Doma naroda');
        fixedText = fixedText.replace(/Broj/g, 'Broj');
        fixedText = fixedText.replace(/v\. r\./g, 'v. r.');
        
        // Split text into lines and filter out newspaper headers/footers
        const lines = fixedText.split('\n').filter(line => {
            // Filter out lines that are likely newspaper headers/footers
            const trimmedLine = line.trim();
            
            // Skip empty lines
            if (!trimmedLine) return false;
            
            // Skip lines that look like newspaper headers/footers
            if (trimmedLine.includes('SLUŽBENE NOVINE') || 
                trimmedLine.includes('FEDERACIJE BOSNE I HERCEGOVINE') ||
                trimmedLine.includes('BROJ:') ||
                trimmedLine.includes('Datum:') ||
                trimmedLine.includes('Sarajevo') ||
                trimmedLine.match(/^\d+\./)) { // Lines starting with numbers (likely page numbers)
                return false;
            }
            
            return true;
        });
        
        // Register a font that supports Croatian characters before creating the document
        let croatianFont;
        try {
            // Try to use a font that better supports Croatian characters
            croatianFont = path.join(__dirname, 'node_modules', 'pdfkit', 'js', 'data', 'fonts', 'Helvetica.ttf');
            console.log('Croatian font path set successfully');
        } catch (e) {
            console.log('Using default font, Croatian characters may not display correctly');
            croatianFont = 'Helvetica';
        }
        
        // Create a new PDF with just the filtered text using PDFKit
        const doc = new PDFDocument({
            size: 'A4',
            margins: {
                top: 60,
                bottom: 60,
                left: 60,
                right: 60
            },
            info: {
                Title: 'Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH',
                Author: 'Federacija Bosne i Hercegovine',
                Subject: 'Službene novine Federacije BiH'
            }
        });
        
        // Use standard Helvetica font which should support Croatian characters
        doc.font('Helvetica');
        console.log('Using standard Helvetica font for Croatian character support');
        
        // Pipe the PDF to a file
        const stream = fs.createWriteStream(outputFile);
        doc.pipe(stream);
        
        // Add title with better formatting
        doc.fontSize(18).font('Helvetica-Bold').text('ZAKON O IZMJENAMA I DOPUNAMA ZAKONA O UPRAVNOM POSTUPKU', {
            align: 'center',
            characterSpacing: 0.5
        });
        
        // Add a decorative line
        doc.moveTo(60, doc.y + 5).lineTo(doc.page.width - 60, doc.y + 5).lineWidth(0.5).stroke();
        
        // Add a line break
        doc.moveDown(1.5);
        
        // Add the filtered text to the PDF with better formatting
        doc.fontSize(11).font('Helvetica');
        
        // Process each line for better formatting
        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            
            // Skip empty lines
            if (!trimmedLine) return;
            
            // Check if this is a title or heading
            if (trimmedLine === 'ZAKON' || 
                trimmedLine.includes('O IZMJENAMA I DOPUNAMA') ||
                trimmedLine.includes('PROGLAŠENJU ZAKONA')) {
                doc.fontSize(14).font('Helvetica-Bold').text(trimmedLine, {
                    align: 'center',
                    characterSpacing: 0.3
                });
                doc.fontSize(11).font('Helvetica');
                doc.moveDown(0.5);
            }
            // Check if this is a new article (Članak)
            else if (trimmedLine.match(/^Članak \d+\./)) {
                // Add extra space before new articles
                if (index > 0) doc.moveDown(0.8);
                doc.fontSize(12).font('Helvetica-Bold').text(trimmedLine, { 
                    align: 'left',
                    continued: false
                });
                doc.fontSize(11).font('Helvetica');
            }
            // Check if this is a signature or official designation
            else if (trimmedLine.includes('Predsjednik') || 
                     trimmedLine.includes('v. r.') ||
                     trimmedLine.match(/^\d+\.\s+\w+\s+\d{4}\./)) {
                doc.fontSize(11).font('Helvetica').text(trimmedLine, {
                    align: 'right',
                    indent: 0
                });
            }
            // Regular text with better formatting
            else {
                doc.text(trimmedLine, {
                    align: 'justify',
                    indent: trimmedLine.startsWith('"') ? 20 : 0, // Indent quoted text
                    lineGap: 2,
                    paragraphGap: 3,
                    wordSpacing: 0.1,
                    characterSpacing: 0.05
                });
            }
        });
        
        // Finalize the PDF
        doc.end();
        
        console.log(`PDF cleaned and saved to: ${outputFile}`);
        
        // Now let's extract and clean the text content
        console.log('\nExtracting and cleaning text content...');
        
        // Split the text into lines
        const allLines = data.text.split('\n');
        
        // Identify the start and end of the law content
        let lawStartIndex = -1;
        let lawEndIndex = -1;
        
        // Look for patterns that indicate the start of the law
        for (let i = 0; i < allLines.length; i++) {
            if (allLines[i].includes('ZAKON') && allLines[i].includes('IZMJENAMA I DOPUNAMA')) {
                lawStartIndex = i;
                break;
            }
        }
        
        // Look for patterns that indicate the end of the law
        if (lawStartIndex !== -1) {
            for (let i = lawStartIndex; i < allLines.length; i++) {
                // Look for patterns that might indicate the end of the law
                if (allLines[i].includes('Predsjedatelj') || 
                    allLines[i].includes('PREDSEDNIK') || 
                    allLines[i].includes('PREDSJEDNIK') ||
                    (allLines[i].includes('član') && i > lawStartIndex + 50)) {
                    lawEndIndex = i;
                    break;
                }
            }
        }
        
        // Extract the law content
        let lawText = '';
        if (lawStartIndex !== -1) {
            if (lawEndIndex === -1) {
                lawEndIndex = allLines.length;
            }
            
            lawText = allLines.slice(lawStartIndex, lawEndIndex).join('\n');
        } else {
            console.log('Could not identify the start of the law content. Using full text.');
            lawText = data.text;
        }
        
        // Save the cleaned text to a file for reference
        const textOutputFile = path.join(outputDir, 'Zakon o izmjenama i dopunama Zakona o upravnom postupku FBiH-48_99.txt');
        fs.writeFileSync(textOutputFile, fixedText);
        
        console.log(`Cleaned text saved to: ${textOutputFile}`);
        
        // Create a new PDF with just the law text
        const cleanedDoc = new PDFDocument({
            size: 'A4',
            margins: {
                top: 50,
                bottom: 50,
                left: 50,
                right: 50
            }
        });
        
        // Use standard Helvetica font which should support Croatian characters
        cleanedDoc.font('Helvetica');
        console.log('Using standard Helvetica font for Croatian character support');
        
        // Pipe the PDF to a file
        const outputStream = fs.createWriteStream(outputFile);
        cleanedDoc.pipe(outputStream);
        
        // Add the cleaned text to the PDF
        cleanedDoc.fontSize(12).font('Helvetica');
        cleanedDoc.text(fixedText, {
            align: 'justify',
            lineGap: 2
        });
        
        // Finalize the PDF
        cleanedDoc.end();
        
        console.log('Process completed successfully!');
        
    } catch (error) {
        console.error('Error processing PDF:', error);
    }
}

cleanPdfFile();