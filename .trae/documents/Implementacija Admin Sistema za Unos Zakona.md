Proverio sam tačne putanje na vašem sistemu kako ne bi došlo do grešaka. Evo potvrđenih lokacija gde će se snimati novi PDF-ovi:

*   **RS:** `Dokumenti/RepublikaSrpska/PDF`
*   **FBiH:** `Dokumenti/Federacija BiH/PDF` (sa razmakom)
*   **Srbija:** `Dokumenti/Srbija/PDF`
*   **Crna Gora:** `Dokumenti/Crna Gora/PDF`
*   **Brcko:** `Dokumenti/Brcko/PDF`

### Ažurirani Plan Implementacije

#### 1. Backend (API)
*   **Servis za PDF (`PdfService`):**
    *   Koristiće `puppeteer` za generisanje PDF-a iz teksta.
    *   **Ključno:** Implementiraće mapiranje nadležnosti (npr. 'RS' -> 'RepublikaSrpska') kako bi se fajlovi snimali u postojeće foldere koje sam naveo iznad.
*   **Servis za Parsiranje (`LawParsingService`):**
    *   Refaktorisanje postojeće logike iz `extract_segments_rs.ts` za prepoznavanje članova ("Član X").
*   **API Endpoint (`POST /api/admin/laws`):**
    *   Prima: `title`, `jurisdiction`, `date`, `gazette_key` (Broj glasnika), `text`.
    *   Generiše PDF u odgovarajućem folderu.
    *   Upisuje zakon u bazu sa tačnom putanjom (`path_pdf`).
    *   Parsira tekst i upisuje segmente.
    *   Indeksira u MeiliSearch.

#### 2. Frontend (Web)
*   Nova stranica `/admin/laws/new`.
*   Forma uključuje sva tražena polja: Naslov, Nadležnost, Datum, **Broj Službenog Glasnika**, i Tekst zakona.

#### 3. Validacija
*   Nakon unosa prvog zakona, proverićemo fizičko postojanje PDF fajla na disku u odgovarajućem folderu da potvrdimo da nije kreiran novi/pogrešan folder.
