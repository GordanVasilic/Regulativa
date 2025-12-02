## Problem
- Lokalni PDF za Porodični zakon je neupotrebljiv u vieweru, dok se originalni PDF iz ZIP-a normalno otvara. Uzrok je verovatno u načinu kako se ZIP preuzima/otpakuje u `Dokumenti\Srbija\PDF` tokom importa.

## Jednostavan plan bez komplikacija
1. Popraviti ZIP granu u uvozu (`apps/api/scripts/import_srb_from_xlsx.ts`):
- Umesto ručnog `getData()` + `fs.writeFile`, koristiti `zip.extractEntryTo()` da se iz ZIP-a direktno i bez transformacija izdvoji `*.pdf` u izlazni folder.
- Nakon ekstrakcije, validirati sadržaj: pročitati prvih nekoliko bajtova i proveriti da fajl počinje sa `%PDF-`. Ako ne, probati drugi PDF iz ZIP-a (ako postoji) ili fallback na LibreOffice konverziju za DOC/RTF.
- Osigurati atomski upis: ekstrakt u privremenu putanju i zatim `fs.move` → `outPath`.

2. Ponovni uvoz samo za Porodični zakon
- Pokrenuti import sa filterom `--titleContains="porodicni zakon"` da se obnovi baš taj PDF.

3. Verifikacija
- Otvoriti `http://localhost:5000/pdf/<id>` direktno u browseru.
- Otvoriti viewer `/viewer/<id>` u `apps/web` i potvrditi da nema više poruke "Failed to load PDF file".

## Opseg promene
- Menja se samo ZIP→PDF ekstrakcija u import skripti; nema izmene klijenta niti server rute.

Ako potvrdiš, odmah ću primeniti ove izmene i ponovo uvesti samo Porodični zakon.