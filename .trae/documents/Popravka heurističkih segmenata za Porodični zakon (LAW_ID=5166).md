## Zašto vidiš “Heuristički segment…”
- U `apps/api/scripts/extract_segments_srb.ts:268-277` se popunjavaju propušteni brojevi 1..max. Ako naslov za neki član nije tačno detektovan, za taj broj se ubacuje placeholder tekst: “Heuristički segment…”.
- Kod člana 22, detekcija naslova nije prepoznala obrazac i zato je ubačen placeholder.

## Šta ću promeniti
1. Pojačati detekciju naslova člana:
- Proširiti regexe da bolje pokriju varijante sa razmakom u slovima i bez interpunkcije (NBSP, line-break između “Č” i “lan”, bez tačke), i lokalnu pretragu po stranicama.
- Dodati drugi prolaz “po stranici”: ako globalni tekst ne pronađe “Član N”, pokušati po svakoj strani pojedinačno sa tolerantnijim obrascima.
2. Zameniti placeholder za nedetektovane naslove:
- Umesto teksta “Heuristički segment…”, pokušaću da izvučem pravi isječak oko najbližeg brojčanog zaglavlja na istoj strani (tolerantni obrazac), tako da segment dobije realan sadržaj.

## Izvršenje (samo za ovaj zakon)
- Izmena koda u `extract_segments_srb.ts` u blokovima za regex-e i heuristički fill.
- Ponovno pokretanje segmentiranja sa `JURISDICTION=SRB` i `LAW_ID=5166`.
- Reindeksiranje segmenata u Meili sa `LAW_ID=5166`.

## Verifikacija
- Proveriti da se “Član 22” pojavljuje kao regularan segment sa realnim tekstom (bez heurističke poruke).
- Preleteti nekoliko susednih članova (21, 23) da potvrdimo konzistentnost.

Ako potvrdiš, implementiram izmene, segmentiram i reindeksiram samo Porodični zakon (LAW_ID=5166).