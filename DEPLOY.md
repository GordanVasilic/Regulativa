# Deploy na Vultr (API + Web)

- Napravi Ubuntu 22.04 VM (2GB+ RAM), podesi DNS na svoj domen.
- Instaliraj Docker i Compose:
  - `sudo apt update && sudo apt install -y ca-certificates curl gnupg`
  - `curl -fsSL https://get.docker.com | sh`
  - `sudo usermod -aG docker $USER && newgrp docker`
- Kloniraj repo i pokreni kontenjere:
  - `git clone <URL_DO_TVOG_REPOA> regulativa && cd regulativa`
  - `docker compose build`
  - `docker compose up -d`
- Web je na `http://SERVER_IP:8080`, API na `http://SERVER_IP:5000`.

## Reverse proxy i HTTPS
- Ako želiš na root domen (`https://tvoj-domen`):
  - Instaliraj Nginx i Certbot ili koristi Cloudflare.
  - Nginx `server` blok: `location / { proxy_pass http://127.0.0.1:8080; }` i `location /api/ { proxy_pass http://127.0.0.1:5000/; }`.
  - Aktiviraj TLS sa `certbot --nginx`.

## Struktura servisa
- `api` servis: Express (`PORT=5000`), volumen `api_data` i `api_uploads` za trajne podatke.
- `web` servis: Vite build + Nginx, servira statiku i proksira `/api` ka `api`.
- Compose fajl: `docker-compose.yml`.

## Ažuriranje aplikacije
- GIT pull + rebuild na serveru (bez uploadovanja 9GB):
  - `cd regulativa`
  - `git pull`
  - `docker compose build web`
  - `docker compose up -d web`
- Ako se menja API:
  - `docker compose build api`
  - `docker compose up -d api`
- Podaci (baza, uploadi) su u volumenima i ostaju netaknuti.

## Dodavanje novih zakona (podataka)
- Putem API upload-a: pošalji `.docx`/`.txt` na `POST /api/upload`.
- Putem skripti u `apps/api/scripts` (npr. import, scrape):
  - `docker compose exec api node dist/server.js` nije potrebno; koristi direktno skripte:
  - `docker compose exec api node --import tsx scripts/index_laws_meili.ts`
- Meili reindeks: `docker compose exec api npm run reindex`.

## Velik sadržaj (9GB) – kako ga izbeći
- Ne uploaduješ ceo repo: koristi `git pull` na serveru.
- Teške fajlove (PDF, dumpovi) drži van Git-a:
  - Montiraj Vultr Block Storage na `/var/regulativa-data` i mapiraj u Compose:
    - `api_data:/app/data` i `api_uploads:/app/uploads` neka budu bind na taj disk.
  - Alternativa: Vultr Object Storage za raw dokumente; u bazi čuvaj URL.
- Ako ipak treba sync: koristi `rsync` sa kompresijom i samo difovima:
  - `rsync -az --delete ./apps/api/data user@server:/var/regulativa-data/data`

## Backup i održavanje
- Backupuj volumene:
  - `docker compose stop`
  - `tar -czf api_data.tgz /var/lib/docker/volumes/<ime>/_data`
- Logovi:
  - `docker compose logs -f api`
  - `docker compose logs -f web`

## Brzi restart
- `docker compose restart api`
- `docker compose restart web`

## Promena konfiguracije
- API port: `docker-compose.yml` `environment: PORT=5000`.
- Proxy ruta: u `apps/web/nginx.conf` `location /api/`.

---

# Windows Server (Vultr) deploy

- Instaliraj Node.js (LTS) i Git:
  - Preko Chocolatey: `Set-ExecutionPolicy Bypass -Scope Process -Force; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))`
  - `choco install -y git nodejs-lts`
- Kloniraj repo: `git clone <URL_DO_TVOG_REPOA> C:\regulativa && cd C:\regulativa`

## API (Express)
- `cd apps\api`
- `npm ci && npm run build`
- Start u pozadini (jednostavno): `Start-Process -FilePath node -ArgumentList 'dist\server.js' -WindowStyle Hidden`
- Servisno pokretanje (preporučeno):
  - `npm i -g pm2`
  - `pm2 start dist\server.js --name regulativa-api`
  - `pm2 save`
  - Opcija: `pm2-windows-service` ili `nssm` za trajni servis.
- Podaci ostaju u `apps\api\data` i uploadi u `apps\api\uploads` (kreiraju se automatski).

## Web (Vite statika)
- `cd apps\web`
- `npm ci && npm run build`
- Kopiraj `dist` u web root, npr. `C:\regulativa\www`:
  - `New-Item -ItemType Directory -Force -Path C:\regulativa\www`
  - `Copy-Item -Recurse -Force .\dist\* C:\regulativa\www\`

## Nginx za Windows kao reverse proxy
- Preuzmi Nginx zip sa `nginx.org`, raspakuj u `C:\nginx`.
- Konfig: koristi `tools\windows\nginx.conf` i postavi ga kao `C:\nginx\conf\nginx.conf`.
- Pokreni: `Start-Process -FilePath C:\nginx\nginx.exe`.
- Konfig radi:
  - Servira statiku iz `C:\regulativa\www`.
  - Proxy `/api` ka `http://127.0.0.1:5000`.

## IIS alternativa
- Instaliraj IIS i URL Rewrite.
- Kreiraj sajt sa fizičkim putem `C:\regulativa\www`.
- Dodaj reverse proxy pravilo za `/api/` ka `http://127.0.0.1:5000/` (ARR).

## Ažuriranje na Windows Serveru
- `cd C:\regulativa && git pull`
- Frontend: `cd apps\web && npm run build && Copy-Item -Recurse -Force .\dist\* C:\regulativa\www\`
- Backend: `cd apps\api && npm run build && pm2 restart regulativa-api`
- Ako koristiš samo `node`: prvo zaustavi stari proces, pa ponovo pokreni novu verziju.

## MeiliSearch na Windows
- `tools\meili\start-meili.ps1 -DbPath 'C:\regulativa\meili-db'` (komanda čita `apps\api\.env` za ključ ako postoji).
- Nakon pokretanja: `npm run reindex` u `apps\api` da popuni indekse.
