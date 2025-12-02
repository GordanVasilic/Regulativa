# Root Scraper (arhiva)

## Sadržaj
- `package.json` — projektni opis za stari scraper.
- `server.js` — Express server koji služi `fbih_zakoni_2004_tabela_puna.html` i endpoint za scraping.
- `scrape_fbih_2004.js` — puppeteer scraper za FBiH (2004).
- `law_parser_2004.js` — MHTML parser za FBiH (2004).
- `fbih_zakoni_2004_tabela_puna.html` — statična tabela s opcijama preuzimanja.
- `test_scraper.js`, `debug_scraper.js` — pomoćne skripte za testiranje/debug.
- `public/` — statički asseti.

## Status
- Ne koristi se u aktivnoj aplikaciji.
- Moderni scraping tokovi su u `apps/api/scripts`.

