# Deploy na Oracle Cloud / VPS (Linux + Docker)

## Priprema Servera (Oracle Cloud)
1. **Kreiraj instancu**:
   - Oracle Linux 8/9 ili Ubuntu 22.04/24.04.
   - Standardna "Always Free" ARM instanca (4 OCPU, 24GB RAM) je odlična.

2. **Otvori portove (Firewall)**:
   - **Oracle Cloud Console**: Idi na VCN > Security Lists > Ingress Rules.
   - Dodaj pravila za portove: `80` (HTTP), `443` (HTTPS), `8080` (Web), `5000` (API), `7700` (MeiliSearch - opciono, samo za debug).
   - **Na samom serveru (Ubuntu/iptables)**:
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8080 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 5000 -j ACCEPT
     sudo netfilter-persistent save
     ```

3. **Instaliraj Docker i Git**:
   ```bash
   sudo apt update && sudo apt install -y git
   curl -fsSL https://get.docker.com | sh
   sudo usermod -aG docker $USER
   newgrp docker
   ```

## Deploy Aplikacije

1. **Kloniraj repozitorijum**:
   ```bash
   git clone https://github.com/TVOJ_USERNAME/regulativa.git
   cd regulativa
   ```

2. **Pokreni Deploy Skriptu**:
   Koristi pripremljenu skriptu koja podiže servise i inicijalizuje MeiliSearch:
   ```bash
   chmod +x tools/linux/deploy-oracle.sh
   ./tools/linux/deploy-oracle.sh
   ```

   **Šta skripta radi?**
   - Povlači najnoviji kod (`git pull`).
   - Bilda i pokreće Docker kontejnere (`api`, `web`, `meilisearch`).
   - Čeka da se MeiliSearch podigne.
   - Pokreće indeksiranje zakona (`npm run reindex`).

## Ručno upravljanje

- **Pregled logova**:
  ```bash
  docker compose logs -f api
  docker compose logs -f web
  ```

- **Reindeksiranje (ako dodaš nove zakone)**:
  ```bash
  docker compose exec api npm run reindex
  ```

- **Update aplikacije**:
  Samo ponovo pokreni deploy skriptu:
  ```bash
  ./tools/linux/deploy-oracle.sh
  ```

## Struktura Servisa
- **Web**: Port `8080` (Nginx servira React app).
- **API**: Port `5000` (Node.js Express).
- **MeiliSearch**: Port `7700` (Search engine).
- **Baza**: SQLite (`data/regulativa.db`) perzistirana kroz Docker volumen.

## HTTPS (SSL)
Za produkciju preporučujemo postavljanje Nginx-a kao reverse proxy-ja ispred svega (na portu 80/443) i korišćenje Certbot-a za SSL sertifikate.

---

# Starije instrukcije (Windows/Vultr)
... (zadržano radi reference)
