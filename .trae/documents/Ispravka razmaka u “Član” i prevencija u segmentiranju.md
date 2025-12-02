## Zašto se dešava
- PDF ekstrakcija u `apps/api/scripts/extract_segments_srb.ts:83–89` konkatenira svaku tekstualnu stavku sa dodatnim razmakom (`text += str + ' '`), pa kada su „Č“ i „lan“ razdvojeni u PDF glifovima, dobija se „Č lan“.
- Razmaci po Y‑osi se tretiraju kao novi red (`item.transform[5]`), ali se razmak po X‑osi ne uzima u obzir — zato se razmak ubacuje i unutar riječi.

## Šta ću uraditi
1. Ukloniti bezuslovni razmak u konkatenaciji i uvesti heuristiku za X/Y razmake:
   - Dodati provjeru X‑gapa (`item.transform[4]`) i ubaciti razmak samo kada je stvarni razmak između riječi (npr. `xGap > 2.0` i granica između alfanumerika).
   - Zadržati novi red na većem Y‑gapu kao i sada.
2. Dodati post‑normalizaciju koja ispravlja najčešće razdvojene oblike:
   - `Č\s+lan → Član`, `C\s+lan → Clan`, `Ч\s+лан → Члан`, plus slučajeve skraćenice: `Č\s*l\. → Čl.`.
   - Implementirati u `normalizeText` tako da važi za sve jurisdikcije.
3. Napraviti skriptu za čišćenje postojećih segmenata u bazi:
   - `apps/api/scripts/fix_segments_heading_spacing.ts`: iterira kroz `segments.text` i primjenjuje iste zamjene; radi u batchu (jurisdikcija → law_id), loguje broj izmjena.
   - Backup `data/regulativa.db` prije bulk update.
4. Reindeksirati Meili za pogođene zakone
   - Korištenjem postojeće `index_segments_meili.ts` po `LAW_ID` ili `JURISDICTION`.
5. Verifikacija
   - API: `GET /segments/search?q=član 3&law_id=4651` mora počinjati sa “Član 3…”.
   - UI smoke test u “Pronađeni članci” za SRB/RS/BRCKO.
   - Mjerenje performansi (cilj <300 ms po upitu, kao i trenutno).

## Dodatno
- Ne diram `label` jer je već ispravan (`normalizeLabel` daje “Član 3”).
- Promjene će biti analogno uvedene i u `extract_segments_rs.ts`, da CG/RS/Brčko ne dobiju isti problem.

Molim potvrdu da krenem, pa ću završiti skriptu za čišćenje i izmjenu ekstraktora, odraditi backup, bulk update i reindeks, i poslati rezultate verifikacije.