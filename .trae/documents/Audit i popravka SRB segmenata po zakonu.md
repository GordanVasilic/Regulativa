## Cilj
- Izlistati samo broj SRB zakona koji nemaju nijedan segment u bazi.

## Korak
- Izvršiti SQL upit:
  `SELECT COUNT(*) AS cnt FROM (SELECT l.id FROM laws l LEFT JOIN segments s ON s.law_id = l.id WHERE l.jurisdiction = 'SRB' GROUP BY l.id HAVING COUNT(s.id) = 0)`
- Vratiti vrijednost `cnt` kao jedini izlaz.

Ako potvrdiš, odmah pokrećem upit i dostavljam broj.