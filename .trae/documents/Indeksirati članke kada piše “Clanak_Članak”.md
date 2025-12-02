## Problem
- Neki PDF-ovi koriste naslov oblika “Clanak N” ili “Članak N” (umjesto “Član N”), pa trenutna segmentacija ne prepoznaje članke i ne indeksira ih.
- Primjer: FBiH “ZAKON o bankama” (bez SN/datum), trenutno `segments=0`.

## Rješenje
- Proširiti detekciju naslova članka u skripti za segmentaciju da, pored “Član/Clan/Čl./Cl./ćirilica”, prepoznaje i “Članak/Clanak”.
- Ažurirati sve regexe:
  - `ARTICLE_RE`: dodati alternacije `Članak|Clanak|Cl\.|čl` (case-insensitive).
  - `strictHeading`, `looseHeading`, `noDotHeading`: koristiti zajednički `headingTokens = (Član|Clan|Članak|Clanak|Čl\.|Cl\.|Члан|Чл\.)` umjesto trenutno uže liste.
  - Dozvoliti uobičajenu interpunkciju: tačka, minus/crta, en-dash, em-dash, dvotačka.
- Zadržati postojeće heuristike (line-start, razmak klase `wsClass`, fallback na globalni obrazac) da se smanji lažno pozitivno.

## Operativni koraci
1) Implementirati regex izmjene u `apps/api/scripts/extract_segments_rs.ts` na definicijama `ARTICLE_RE`, `strictHeading`, `looseHeading`, `noDotHeading`.
2) Re-pokrenuti segmentaciju za FBiH:
   - Batch: prvo ciljano za zakone sa `segments=0` i `jurisdiction='FBiH'` (uključujući “ZAKON o bankama”).
   - Po potrebi proširiti na RS ako želite jednako ponašanje.
3) Reindeksirati Meili `segments` nakon popunjavanja.
4) Verifikacija:
   - Meili upiti: “član 4”, “clan 4”, “članak 4”, “clanak 4” sa filterom `jurisdiction=FBiH` vraćaju članke.
   - Provjeriti primjer “ZAKON o bankama” da sada ima članke.

## Prihvatni kriteriji
- PDF-ovi sa “Clanak/Članak N” dobijaju segmente u bazi (`segments` > 0).
- Pretraga po člancima radi za “član/clan/članak/clanak” varijante (zahvaljujući i Meili `synonyms`).
- Nije potrebna prisutnost `gazette_key/date` za segmentaciju; indeksiranje radi samo na osnovu `path_pdf`.

## Napomena
- Ove izmjene ne mijenjaju postojeće rezultate gdje je “Član N”; samo proširuju pokrivenost. Mogu ih primijeniti prvo na FBiH, pa po želji i na RS.