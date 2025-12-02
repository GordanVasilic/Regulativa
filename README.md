# Regulativa

Monorepo aplikacija za pretragu i pregled propisa:
- Web: React + Vite (`apps/web`)
- API: Express + TypeScript (`apps/api`)

## Lokalni razvoj
- Pokreni API:
  - `cd apps/api`
  - `npm ci`
  - `npm run dev`
- Pokreni Web:
  - `cd apps/web`
  - `npm ci`
  - `npm run dev`
- Dev proxy mapira `http://localhost:5175/api` na `http://127.0.0.1:5000`.

## Build i produkcijsko pokretanje
- Web:
  - `cd apps/web && npm run build`
  - statika je u `apps/web/dist`
- API:
  - `cd apps/api && npm run build`
  - `node dist/server.js`

## Podaci i veličina repozitorija
- Baze i dokumenti nisu dio repo-a (isključeni `.gitignore`).
- Runtime direktoriji se kreiraju pri pokretanju (`apps/api/data`, `apps/api/uploads`).
- MeiliSearch i njegovi fajlovi nisu uključeni; vidi `DEPLOY.md` po potrebi.

## Deploy
- Windows i Linux koraci opisani su u `DEPLOY.md`.
- Za Windows: skripte u `tools/windows` olakšavaju start API-ja, build Web-a i Nginx proxy.
