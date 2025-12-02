## Cilj
- Ponoviti segmentiranje i indeksiranje isključivo za Porodični zakon (Srbija), bez dodirivanja ostalih zakona.

## Segmentiranje (samo LAW_ID=5166)
- Pokrenuti `apps/api/scripts/extract_segments_srb.ts` sa env: `JURISDICTION=SRB`, `LAW_ID=5166`.
- Skripta najpre briše stare segmente za taj zakon (`DELETE FROM segments WHERE law_id = ?`) i zatim ubacuje nove, uz jedinstveni indeks `ux_segments_unique` da se izbegnu duplikati.
- Izvlačenje teksta koristi `pdfjs-dist` direktno nad lokalnim PDF-om; fallback na ZIP je već ugrađen i neće biti potreban sada kada je lokalni PDF ispravan.
- Verifikacija: proveriti broj segmenata i uzorak labela “Član X”; lokacija koda: `apps/api/scripts/extract_segments_srb.ts:297-305` (insert segmenata), `152-153` (unique index).

## Indeksiranje (samo LAW_ID=5166)
- Pokrenuti `apps/api/scripts/index_segments_meili.ts` sa env: `LAW_ID=5166`.
- Skripta u tom režimu ne briše ceo indeks, već upisuje/obnavlja samo dokumente za traženi zakon; lokacija izmene: `apps/api/scripts/index_segments_meili.ts:28-63`.
- Potrebno je da `apps/api/.env` ima `MEILI_HOST` i `MEILI_KEY` (već postoji).

## Komande koje ću izvršiti
- `JURISDICTION=SRB LAW_ID=5166 node --import tsx scripts/extract_segments_srb.ts`
- `LAW_ID=5166 node --import tsx scripts/index_segments_meili.ts`

## Verifikacija rezultata
- Proveriti broj segmenata u SQLite i uzorak: `SELECT count(*) FROM segments WHERE law_id=5166` i npr. `SELECT id,label,number FROM segments WHERE law_id=5166 ORDER BY number LIMIT 10`.
- U web aplikaciji otvoriti `/viewer/5166` i vizuelno proveriti listu segmenata i skokove na stranice.

Ako potvrdiš, izvršiću ova dva koraka i dostaviti kratku potvrdu o broju segmenata i uspešnom indeksiranju.