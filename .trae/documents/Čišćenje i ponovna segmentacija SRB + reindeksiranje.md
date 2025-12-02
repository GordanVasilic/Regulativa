## Cilj
Ukloniti sve postojeće segmente za jurisdikciju `SRB` iz baze, ponovo generisati segmente iz PDF-ova, i reindeksirati u Meili sa globalnim filtriranjem heuristike.

## Koraci
1. Backup baze
- Napraviti kopiju `data/regulativa.db` u `data/backups/` sa vremenskim žigom.

2. Čišćenje segmenata za SRB u SQLite
- SQL: `DELETE FROM segments WHERE law_id IN (SELECT id FROM laws WHERE jurisdiction = 'SRB')`.
- Verifikacija: `SELECT COUNT(*) FROM segments s JOIN laws l ON l.id=s.law_id WHERE l.jurisdiction='SRB'` treba da vrati `0`.

3. Ponovna segmentacija za SRB
- Pokrenuti `scripts/extract_segments_srb.ts` za sve zakone sa `jurisdiction='SRB'` (skripta već per‑law radi `DELETE FROM segments WHERE law_id = ?` prije upisa).
- Verifikacija: broj segmenata > 0 za reprezentativne zakone (npr. Zakon o sprečavanju nasilja u porodici).

4. Reindeksiranje u Meili za SRB
- Pokrenuti `scripts/index_segments_meili.ts` sa `JURISDICTION='SRB'` (skripta čisti po `law_id` i dodaje dokumente u chunkovima).
- Globalno filtriranje heuristike je aktivno u `apps/api/scripts/index_segments_meili.ts:148` i `apps/api/scripts/index_segments_meili.ts:182`, tako da "Heuristički" segmenti ne ulaze u indeks.

5. Verifikacija rezultata
- DB: `SELECT COUNT(*) FROM segments s JOIN laws l ON l.id=s.law_id WHERE l.jurisdiction='SRB'` (očekuju se >0 nakon segmentacije).
- Meili: pretraga `Heuristički` uz filter `jurisdiction = SRB` treba da vrati `0`.
- UI: u "Pronađeni članovi" za "Član 54. Zakona o sprečavanju nasilja u porodici (23.11.2016.)" provjeriti da se ne pojavljuje "Heuristički segment...".

## Napomena o sigurnosti
- Backup omogućava brzi rollback.
- Svi koraci su idempotentni: ponovna segmentacija i reindeksiranje ne ostavljaju duplikate jer se prethodno čisti cilj.

## Spremno za izvršenje
Ako potvrdiš, odmah pokrećem backup, čišćenje, segmentaciju, reindeks, i završnu verifikaciju te javim rezultate.