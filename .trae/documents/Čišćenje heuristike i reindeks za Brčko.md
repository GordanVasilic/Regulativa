## Cilj
- Ukloniti sve pojave "Heuristički…" u segmentima za jurisdikciju `BRCKO`.
- Očistiti segmente u bazi i u Meili za Brčko, zatim ponovo izvesti segmentaciju iz PDF-ova i reindeksirati u Meili.

## Pristup
- Targetirano brisanje samo `segments` za zakone Brčko u SQLite (bez diranja `laws` i fajlova).
- Ekstrakcija stvarnih članova iz PDF-ova za Brčko, uz potpuno isključenu generaciju heurističkih segmenata.
- Reindeksiranje Meili `segments` indeksa isključivo sa ne-heurističkim podacima.
- Verifikacija kroz audit (DB + Meili + API) da je broj heurističkih segmenata 0.

## Koraci
- Backup baze: kopirati `data/regulativa.db` uz timestamp.
- Brisanje segmenata (SQLite):
  - Napraviti skriptu `apps/api/scripts/sql_delete_segments_by_jurisdiction.ts` koja izvršava:
    - `DELETE FROM segments WHERE law_id IN (SELECT id FROM laws WHERE jurisdiction = 'BRCKO');`
    - Opcionalno `VACUUM`.
- Onemogućavanje heuristike u ekstraktoru:
  - U `apps/api/scripts/extract_segments_rs.ts` dodati kontrolu da za `JURISDICTION='BRCKO'` (ili `DISABLE_HEURISTICS=1`) ne kreira tekstove koji počinju sa "Heuristički".
  - Zadržati fallback `Uvod` kada nema detektovanih članova (nije heuristički).
- Ponovna segmentacija Brčko:
  - Pokrenuti `extract_segments_rs.ts` sa `JURISDICTION='BRCKO'` za sve zakone koji imaju `path_pdf`.
- Čišćenje i Meili reindeks po jurisdikciji:
  - U `apps/api/scripts/index_segments_meili.ts` koristiti mod po jurisdikciji:
    - Prvo obrisati dokumente per-`law_id` za Brčko.
    - Zatim dodati nove (ne-heurističke) segmente.
- Verifikacija:
  - DB audit: `SELECT COUNT(*) FROM segments s JOIN laws l ON l.id=s.law_id WHERE l.jurisdiction='BRCKO' AND s.text LIKE 'Heuristički%';` očekivano 0.
  - Meili audit: pretraga praznim upitom uz filter `jurisdiction = "BRCKO"` i provjera da `text` ne počinje sa "Heuristički"; `estimatedTotalHits > 0`.
  - API provjera: `/api/segments/search?q=član&jurisdiction=BRCKO` vraća rezultate bez heuristike.
  - UI provjera: "Pronađeni članovi" za Brčko prikazuju stvarne članke.

## Implementacijski detalji (reference)
- Generisanje heuristike i fallback `Uvod`: `apps/api/scripts/extract_segments_rs.ts` (detekcija i kreiranje segmenta).
- Meili reindeks i filtriranje heuristike: `apps/api/scripts/index_segments_meili.ts` (čisti po `LAW_ID`/`jurisdiction`, filtrira `text` koji počinje sa "Heuristički").
- Postojeća pomoćna skripta: `apps/api/scripts/add_fallback_segments_brcko.ts` (korisno za slučajeve bez članova; ne generiše "Heuristički").

## Očekivani rezultat
- Svi segmenti za Brčko u bazi i Meili su stvarni (bez "Heuristički"), svaki zakon ima bar jedan segment (u najgorem slučaju `Uvod`), pretraga u UI/API radi bez heurističkog sadržaja.

Potvrdi da krenem sa izvršenjem ovih koraka.