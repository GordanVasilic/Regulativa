## Cilj
- Izračunati koliko zakona sadrži članke čiji tekst počinje na "Heuristički…" i prikazati raspodjelu po zakonima i jurisdikcijama.

## Metod (read-only)
- SQLite provjera (autoritet podataka):
  - Upit: `SELECT l.id, l.title, l.jurisdiction, COUNT(*) AS cnt FROM segments s JOIN laws l ON l.id = s.law_id WHERE s.text LIKE 'Heuristički%' GROUP BY l.id, l.title, l.jurisdiction ORDER BY cnt DESC`.
  - Dodatno: ukupno `SELECT COUNT(DISTINCT s.law_id) FROM segments s WHERE s.text LIKE 'Heuristički%'`.
- Meili provjera (stanje indeksa koje UI koristi):
  - Globalna pretraga pojma "Heuristički" u indeksu `segments` s agregacijom po `law_id` i `jurisdiction`.
  - Verifikacija da se za SRB (Srbija) ne pojavljuje niti jedan dokument s "Heuristički".

## Izlaz
- Ukupan broj zakona sa heurističkim člancima (SQLite).
- Tabela: `law_id`, naslov, jurisdikcija, broj heurističkih članaka (SQLite).
- Presek iz Meili: broj dokumenata sa "Heuristički" po zakonu/jurisdikciji; naglasak na SRB.

## Verifikacija
- Uporediti rezultate iz SQLite i Meili (ne moraju biti identični ako indeks nije ažuran), ali navesti eventualna odstupanja.

## Sljedeći koraci (ako odobrite)
- Pokrenuti gore navedene read-only upite nad lokalnom bazom i Meili-jem.
- Pripremiti kratki izvještaj s listom zakona i brojevima, posebno označiti SRB. 