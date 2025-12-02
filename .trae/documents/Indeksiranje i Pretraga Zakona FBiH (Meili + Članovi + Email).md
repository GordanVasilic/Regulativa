## Cilj
- Omogućiti pretragu zakona FBiH po naslovu, metapodacima i po člancima ("član N") koristeći postojeću infrastrukturu (SQLite + Meili), bez email notifikacija.

## Podaci i priprema
- Provjeriti da su `jurisdiction='FBiH'`, `path_pdf`, `gazette_number/key/date`, `title/title_normalized`, `source_url`, `url_pdf` popunjeni u `laws` (postojeći import skripte su već urađene).
- Pokrenuti završni izvještaj za FBiH (postojeći `report_fbih_import.ts`) i adresirati eventualne nedostatke prije indeksiranja.

## Segmentacija članaka
- Iskoristiti postojeću skriptu `apps/api/scripts/extract_segments_rs.ts` (generična, radi za oba entiteta) sa `JURISDICTION=FBiH`.
- Ulaz: PDF iz `laws.path_pdf`.
- Izlaz: tabela `segments` [law_id, label="Član N"/"Члан N", number=N, text, page_hint].
- Heuristike pokrivaju latinicu/ćirilicu, skraćenice (`čl.`, `cl.`), tačke/crte, te dodaju placeholder segmente za propuštene brojeve.

## Indeksiranje u Meili
- `apps/api/scripts/index_laws_meili.ts`: indeks `laws` (searchable: `title`, `title_normalized`, `gazette_number`, `gazette_key`; filterable: `jurisdiction`, godina/datum).
- `apps/api/scripts/index_segments_meili.ts`: indeks `segments` (searchable: `label`, `text`, `law_title`; filterable: `law_id`, `jurisdiction`).
- Synonyms već pokrivaju `član/clan/čl./cl.` i varijante za bolji matching upita.

## API pretraga
- Postoje rute u `apps/api/src/server.ts`:
  - `GET /laws/search`: prvo Meili, zatim SQLite fallback; podržava filtere (npr. `jurisdiction=FBiH`, `gazette_key`, godina, datum).
  - `GET /segments/search`: razumije upite tipa `član 4`; rangira: `law_title` > `label` > `text` uz boost tačnog člana.
  - `GET /segments?law_id=...`: listanje članaka zakona.
- Potrebno je samo osigurati da se filter `jurisdiction=FBiH` koristi u klijentu gdje je relevantno.

## Operativni tok (bez emaila)
- 1) Segmentacija: `JURISDICTION=FBiH node --import tsx scripts/extract_segments_rs.ts` (opcionalno `LIMIT`, `OFFSET` za batch obradu).
- 2) Indeksiranje zakona: `node --import tsx scripts/index_laws_meili.ts`.
- 3) Indeksiranje članaka: `node --import tsx scripts/index_segments_meili.ts`.
- 4) Brisanje i reindeks: po potrebi `tools/meili/delete_jurisdiction.cjs` sa filterima (`jurisdiction='FBiH'`).

## Validacija i QA
- Upiti: "Zakon o..."; filter `jurisdiction=FBiH`.
- Članci: "član 1", "čl. 12"; provjeriti presjek u `segments` i preciznost `page_hint`.
- Kros-provjera: fallback SQLite daje rezultate kad Meili nema.

## Prihvatni kriteriji
- Svi FBiH zakoni imaju segmente (članke) u DB.
- Pretraga po članovima vraća tačne segmente sa pripadajućim zakonom.
- Meili indeksi `laws` i `segments` uključuju FBiH podatke; filter `jurisdiction=FBiH` radi.
- Nema email funkcionalnosti u ovoj fazi.

## Sljedeći koraci
- Po odobrenju pokrećem segmentaciju i indeksiranje za FBiH, zatim dostavljam kratku verifikaciju (primjeri upita + broj indeksiranih zakona/članaka).