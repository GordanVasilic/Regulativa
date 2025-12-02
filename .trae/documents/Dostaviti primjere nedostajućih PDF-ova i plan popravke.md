## Plan

* Provjeriti da li API server radi i da li koristi ispravan DB (`apps/api/data/regulativa.db`).

* Testirati API rute koje početna stranica poziva: `GET /laws?limit=10&sort=gazette_desc` i `GET /laws/top?limit=10`.

* Ako API nije pokrenut, pokrenuti ga sa Meili varijablama.

* Ako odgovori prazni, direktno provjeriti bazu: broj zakona, broj s `path_pdf`, i par posljednjih zakona.

* Nakon verifikacije, potvrditi da se liste renderuju na `http://localhost:5175/`.

