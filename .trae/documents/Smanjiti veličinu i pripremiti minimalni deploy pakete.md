## Sažetak Analize
- Glavni uzroci velike veličine:
  - `node_modules` sa `puppeteer` koji preuzima Chromium (stotine MB–>GB) u `d:\Projekti\Regulativa\node_modules` i/ili ispod aplikacija.
  - MeiliSearch podaci: `tools/meili/data.ms` i `apps/api/data.ms` — veoma veliki indeksni fajlovi i dnevnički update fajlovi.
  - Debug dumpovi: `apps/api/dumps/` s hiljadama `debug_law_*.txt` fajlova.
  - Frontend `apps/web/node_modules/` (za develop), a za produkciju su dovoljni buildovani fajlovi u `apps/web/dist`.
  - Lokalne binarke i podaci (npr. `apps/api/data/meilisearch.exe`, razni `.xlsx` u rootu) koje nisu potrebne za server.
- Šta je stvarno potrebno za produkcijski server:
  - API: kompajlirani fajlovi (`apps/api/dist`), `apps/api/package.json` (+ `package-lock.json`), konfiguracija (`.env` ili sistemski env), i baza `apps/api/data/regulativa.db`. Meili je opcionalan (ako postoji `MEILI_HOST`).
  - Web: statički build `apps/web/dist` (HTML/CSS/JS). 

## Minimalni Paket za Deploy
- API paket (≈ mali):
  - Uključiti: `apps/api/dist/`, `apps/api/package.json`, `apps/api/package-lock.json`, `apps/api/.env` (ili varijable na serveru), `apps/api/data/regulativa.db`.
  - Isključiti: `apps/api/dumps/`, `apps/api/data.ms/`, `apps/api/data/meilisearch.exe`, `apps/api/scripts/` (samo dev/ETL), `apps/api/node_modules/` (instalira se na serveru), bilo kakve lokalne debug fajlove.
  - Napomena: API koristi SQLite lokaciju i podatke iz `data` (vidi `apps/api/src/server.ts:15–18` za `DATA_DIR`/`DB_PATH`). Meili je opcionalan i inicijalizuje se samo kad postoji `MEILI_HOST` (`apps/api/src/server.ts:125–155`). PDF-ovi se šalju iz `path_pdf` polja, koje može biti apsolutna/relativna staza (`apps/api/src/server.ts:379–386`); ako ih koristite, odgovarajuće fajlove/foldere treba prenijeti.
- Web paket (≈ vrlo mali):
  - Uključiti: `apps/web/dist/`.
  - Isključiti: `apps/web/node_modules/`, source (`apps/web/src/`), konfiguracije koje nisu potrebne na serveru.
- Root scraper:
  - Isključiti cijeli root scraper (`package.json` s `puppeteer`) osim ako namjerno želite pokretati scraping na serveru. On uvodi Chromium download i drži monorepo velikim.
- Vercel fajlovi:
  - Isključiti `.vercel/` ako ne deployate na Vercel.

## Koraci za Pripremu i Deploy
1. Web build:
   - Ako već imate `apps/web/dist`, možemo ga direktno prenijeti na server (npr. u `nginx` ili kao static u okviru API-ja).
2. API build:
   - Pokrenuti TypeScript build (`npm run build` u `apps/api`) da se osvježi `apps/api/dist`.
3. Smanjiti težinu instalacije na serveru:
   - Na serveru instalirati samo prod zavisnosti u `apps/api`:
     - `npm ci --omit=dev` (ili `npm ci --production`).
   - Postaviti `PUPPETEER_SKIP_DOWNLOAD=true` tokom instalacije ako `puppeteer` nije potreban u runtime-u (sprječava Chromium download i uštedi stotine MB).
   - Ako je potreban scraping, razmotriti zamjenu `puppeteer` → `puppeteer-core` i eksplicitno dati stazu do postojećeg `chrome`/`chromium` (manji paket).
4. MeiliSearch (opcija):
   - Ako imate Meili servis na glavnoj aplikaciji, postaviti `MEILI_HOST` i `MEILI_KEY` u env; nije potrebno prenositi `data.ms` ni lokalnu binarku.
   - Ako nemate Meili, API radi fallback pretragu preko SQLite.
5. Pakovanje i transfer:
   - Napraviti dva tar/zip paketa:
     - `deploy-api.zip` s tačno: `apps/api/dist`, `apps/api/package.json`, `apps/api/package-lock.json`, `apps/api/.env` (po potrebi), `apps/api/data/regulativa.db` (+ eventualni folder s PDF-ovima ako ga koristite).
     - `deploy-web.zip` s: `apps/web/dist`.
   - Prenijeti ih na server i raspakovati u odgovarajuće lokacije.
6. Pokretanje:
   - API: u `apps/api` na serveru: `npm ci --omit=dev` (uz `PUPPETEER_SKIP_DOWNLOAD=true` ako scraping nije potreban), zatim `node dist/server.js`.
   - Web: poslužiti `apps/web/dist` preko `nginx`/`caddy` ili `serve`.
7. Verifikacija:
   - Provjeriti `GET /health` (`apps/api/src/server.ts:165–167`) da vidimo `db` i `meili` status.
   - Proći osnovne API rute (`/laws`, `/laws/top`, `/segments/search`).

## Eksplcitno Izuzeti iz Deploya
- `tools/meili/` i `apps/api/data.ms/` (Meili indeksi i update fajlovi — veliki).
- `apps/api/dumps/` (debug tekstualni dumpovi — nepotrebni).
- `apps/api/scripts/` i root scraper (`d:\Projekti\Regulativa\package.json` s `puppeteer`) — dev/ETL.
- Svi `node_modules/` (instaliraju se direktno na serveru, uz opcije gore).
- `.vercel/`, top-level `.xlsx` i `.txt` koji služe kao ulazni setovi podataka, ali nisu potrebni za runtime.

## Procjena Uštede Veličine
- Uklanjanjem Meili podataka i dumpova dobijate najveću uštedu (često GB+).
- Izbjegavanjem Chromium download-a (`PUPPETEER_SKIP_DOWNLOAD`) značajno se smanjuje `node_modules`.
- Deploy paketi (API dist + SQLite + Web dist) bi trebali stati u desetine do stotine MB, umjesto više GB.

## Sljedeći Koraci (nakon odobrenja)
- Pripremiti skriptu/konfiguraciju za izgradnju i izdvajanje minimalnog seta (npr. `scripts/make-deploy.js` ili `.dockerignore` + `Dockerfile`).
- Automatizovati upload (npr. `rsync`/`scp`) s eksplicitnim include/exclude pravilima.
- Dodati `README-deploy.md` sa kratkim uputama za pokretanje na serveru.

Potvrdi da želiš ovakav minimalni paket (bez Meili i bez root scraper-a), pa ću izraditi konkretne pakete, include/exclude listu i pomoćne skripte za transfer.