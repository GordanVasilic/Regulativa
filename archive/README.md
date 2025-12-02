# Arhiva skripti (root)

- Ovaj direktorij sadrži istorijske i ad‑hoc skripte koje nisu dio aktivne aplikacije.
- Aktivna aplikacija je u `apps/api` (backend) i `apps/web` (frontend).
- MeiliSearch se pokreće iz `apps/api` i koristi podatke u `apps/api/data.ms`.

## Poddirektoriji
- `root-scraper/` — stari scraper i statične HTML stranice vezane za FBiH (2004), nevezano za runtime.
- `util-js/` — pomoćne util skripte za čišćenje/konverziju dokumenata (PDF/DOCX), analize znakova itd.

## Napomena o korištenju
- Skripte ovdje nisu uključene u `npm` tokove aktivne aplikacije.
- Ako ih želite pokrenuti, uradite to izolovano i bez uticaja na `apps/api`/`apps/web` okruženje.

