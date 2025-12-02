## Cilj
- Za sve SRB zakone sa praznim `path_pdf`, automatski popuniti i validirati lokalni PDF.
- Gdje je moguće, odmah omogućiti segmentaciju i reindeks.

## Ulazi i Izvori
- Baza: tabela `laws` (`jurisdiction='SRB'`, kolone: `id`, `title`, `source_url`, `url_pdf`, `path_pdf`).
- Excel/XLSX: SRB izvor sa validnim URL‑ovima (koristi postojeći čitač u `import_srb_from_xlsx.ts`).

## Pravila preuzimanja i konverzije
- Ako `url_pdf` ili `source_url` sadrži direktan `.pdf` URL:
  - Preuzeti u standardni SRB folder (npr. `Dokumenti/Serbia/PDF`), ime: `<slug|title>-<gazette_key>.pdf`.
- Ako URL ukazuje na `.zip`:
  - Preuzeti ZIP; izdvojiti PDF iz ZIP u isti SRB PDF folder; odabrati najveći PDF ili onaj čiji naziv sadrži ključne riječi naslova zakona.
- Ako URL ukazuje na `.doc`, `.docx`, `.rtf`:
  - Konvertovati u PDF preko `soffice` (LibreOffice), zatim smjestiti u SRB PDF folder.
- Ako URL nije PDF/ZIP/DOC/RTF:
  - Preskočiti (HTML→PDF fallback je uklonjen).

## Validacija PDF‑a
- Header/tail provjera: `%PDF-` na početku, `%%EOF` na kraju.
- `pdfjs` `getDocument` probni otvaranje.
- Ako validacija padne: ponovni download (do 2 puta) ili pokušaj alternativnog URL‑a iz XLSX.

## Upis u bazu
- Nakon uspješnog preuzimanja/konverzije:
  - Postaviti `path_pdf` na apsolutnu lokalnu putanju; `updated_at=now`.
  - Logovati `id`, `title`, `gazette_key`, status: `updated`/`skipped`/`failed`.

## Segmentacija i Meili (ciljana)
- Za zakone kojima smo popunili `path_pdf`:
  - Pokrenuti ekstrakciju segmenata (`JURISDICTION='SRB'`, `DISABLE_HEURISTICS=1`) samo za te `law_id`.
  - Reindeksirati Meili za te `law_id`.

## Audit i Izvještaj
- Prije: broj SRB `path_pdf IS NULL` i broj zakona bez segmenata.
- Poslije: ponoviti oba broja; očekivano značajno smanjenje.
- Izlistati do 20 `failed` slučajeva sa razlogom (npr. „no direct PDF“, „download error“, „invalid PDF“).

## Implementacija
- Iskoristiti postojeću infrastrukturu u `apps/api/scripts/import_srb_from_xlsx.ts` (već podržava ZIP/DOC/RTF→PDF, bez HTML→PDF).
- Dodati batch proces koji:
  1) Učita SRB XLSX i mapira `law_id → url_pdf/source_url`;
  2) Za svaki `law_id` sa `path_pdf=null` pokuša preuzimanje/konverziju;
  3) Validira PDF i ažurira `path_pdf`;
  4) Po potrebi pokreće ciljani extract + Meili reindeks.
- Paralelizacija: do 8–12 paralelnih preuzimanja sa retry/backoff.

## Verifikacija
- SQL: `SELECT COUNT(*) FROM laws WHERE jurisdiction='SRB' AND path_pdf IS NULL` (prije/poslije).
- SQL: broj SRB zakona bez segmenata (prije/poslije).
- API: `GET /segments/search?q=član&jurisdiction=SRB&limit=5` → vraća stavke za uzorke.

Nakon tvoje potvrde pokrećem kompletan proces za Srbiju, sa izvještajem i popravkom segmenata/reindeksa za ažurirane zakone.