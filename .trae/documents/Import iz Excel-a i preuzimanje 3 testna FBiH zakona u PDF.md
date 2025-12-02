## Sažetak
- Iz `fbihdo22-25.xlsx` čitam naslove i linkove.
- Za svaku stavku: ako je link PDF → preuzimam; ako je HTML → izdvajam samo tekst zakona i renderujem u PDF.
- Usporedno upisujem metapodatke u SQLite (`data/regulativa.db`, tabela `laws`).
- Odrađujem 3 testna zakona i plasiram PDF u `Dokumenti/Federacija BiH/PDF`.

## HTML Struktura FBiH
- Primarni kontejner: `.row.row-single-article` ili `.single-article` (izvor: apps/api/scripts/extract_fbih_single_article.ts:19–31).
- Glavni sadržaj: `.content-article` ili lijeva kolona `.col-md-8` (apps/api/scripts/extract_fbih_single_article.ts:36–40).
- Potpisni blok: dvije kolone `.col-md-3.margin-bottom-10` i srednji `.col-md-6.margin-bottom-10` (apps/api/scripts/extract_fbih_single_article.ts:44–71), uz fallback na `p.text-center` (75–101).
- Generičan ekstraktor za dugačke članke: biranje najdužeg teksta iz `article/main/.content/.page-content/.field--name-body/...` ili prvih `div`-ova (apps/api/scripts/scrape_fbih_laws.ts:299–333).

## Implementacija
- Dodajem skriptu `apps/api/scripts/import_fbih_from_xlsx.ts` koja:
  - Koristi biblioteku `xlsx` za čitanje Excel-a (dodaću je u `apps/api` dependencies).
  - Mapira kolone: `Naslov` (ili prvi kol), `Link` (URL), `Objavljeno u` (za broj i datum).
  - Za svaki red poziva ugrađenu logiku:
    - Ako URL završava na `.pdf` → direktan download (apps/api/scripts/scrape_fbih_laws.ts:287–294).
    - Inače → otvara stranicu i renderuje čist PDF sa samo zakonskim tekstom (299–350).
  - Iz `Objavljeno u` parsira `gazetteNumber`, `gazetteKey` i datum u ISO (apps/api/scripts/scrape_fbih_laws.ts:37–66).
  - Sanitizuje ime fajla i gradi putanju u `Dokumenti/Federacija BiH/PDF`.
  - Upisuje/azurira zapis u `laws` (apps/api/scripts/scrape_fbih_laws.ts:369–468).

## Testni Uzorak (3 zakona)
- Obrada samo prva 3 reda iz `fbihdo22-25.xlsx`.
- Za svaku stavku generišem:
  - `path_pdf` u `Dokumenti/Federacija BiH/PDF` sa sufiksom `-NN_YY` ako je poznat broj.
  - Privremeni HTML preview u `apps/api/tmp/fbih_single_article_preview.html` (apps/api/scripts/extract_fbih_single_article.ts:224–235) za vizuelnu provjeru layout-a.
- Logujem rezultat i broj uspješno obrađenih PDF-a.

## Upis u Bazu
- Kreiram/koristim `data/regulativa.db` i tabelu `laws` sa poljima: `jurisdiction='FBiH'`, `title`, `title_normalized`, `gazette_key`, `gazette_number`, `gazette_date`, `source_url`, `url_pdf`, `path_pdf` (apps/api/scripts/scrape_fbih_laws.ts:371–386).
- Sprječavam duplikate po (`jurisdiction`, `title`, `gazette_key`) ili po `path_pdf`.

## Validacija
- Provjera: otvaranje generisanog PDF-a, pregled privremenog HTML-a, i verifikacija zapisa u bazi.
- Edge slučajevi: stranice bez jasnog kontejnera → koristim generički ekstraktor; linkovi bez PDF-a → pokušaj rendera; nepostojeći datum → ostaje `NULL`.

## Pokretanje
- Nakon potvrde:
  - Instaliram `xlsx` u `apps/api`.
  - Pokrećem: `node --import tsx scripts/import_fbih_from_xlsx.ts --xlsx="d:\\Projekti\\Regulativa\\fbihdo22-25.xlsx" --limit=3`.
- Rezultati: 3 PDF fajla u `Dokumenti/Federacija BiH/PDF` + upis u bazu + HTML preview za vizuelnu potvrdu.