# Nawigacja pieszego w środowisku GPS-denied

Demo systemu, który utrzymuje pozycję żołnierza po zagłuszeniu GNSS: pobiera
dane mapowe dopóki jest łączność, a bez niej liczy pozycję z czujników
inercyjnych telefonu, ograniczając ją geometrią ulic i budynków z OpenStreetMap.

## Uruchomienie

```bash
cp env.example .env.local     # Next.js NIE czyta env.example
npm install
npm run dev
```

`OVERPASS_URL` w `.env.local` musi wskazywać działającą instancję Overpass.
Odpowiedzi lądują w `.cache/osm/` i od tej chwili aplikacja działa bez sieci —
cache jest wymaganiem funkcjonalnym, nie optymalizacją.

Kafle mapy bazowej idą przez własne proxy (`/api/map/tiles/...`), więc
przeglądarka nigdy nie chodzi bezpośrednio do serwerów kafli.

## Przepływ w demie

1. **Warstwa mapowa** pobiera się automatycznie dla obszaru operacji.
2. **Zagłuś GNSS** — od tej chwili pozycja pochodzi wyłącznie z PDR.
3. **Wyznacz miejsce docelowe** → klik w mapę → pojawia się znacznik celu
   i pieszy rusza tam trasą A* po rzeczywistych ulicach.
4. **Wyznacz trasę** rysuje nawigację do celu liczoną od pozycji
   **estymowanej** — im większy dryf, tym wyraźniej rozjeżdża się
   z trasą rzeczywistą.
5. **Skoryguj pozycję** — żołnierz rozpoznaje skrzyżowanie i wskazuje je
   na mapie; błąd spada do zera, estymacja biegnie dalej od tego punktu.

## Jak to działa

| Warstwa | Plik | Rzecz do zapamiętania |
| --- | --- | --- |
| Synteza IMU | `lib/sim/imu.ts` | każdy człon kołysania ma zerową średnią w cyklu kroku — inaczej wychodzi z tego bias żyroskopu |
| Detekcja kroków | `lib/pdr/stepDetect.ts` | peak–valley na module przyspieszenia, 0 % błędu na 3231 krokach |
| Długość kroku | `lib/pdr/stepLength.ts` | Weinberg, `K = 0.52` po kalibracji |
| Kurs | `lib/pdr/heading.ts` | filtr komplementarny żyroskop + magnetometr |
| Fuzja | `lib/fusion/estimator.ts` | GNSS gdy jest, PDR gdy go nie ma; niepewność z podłogą, bo błąd GNSS jest skorelowany w czasie |
| Filtr cząsteczkowy | `lib/fusion/particleFilter.ts` | 500 cząstek, mieszankowa wiarygodność z mapą |
| Graf i routing | `lib/osm/` | A* z dopuszczalną heurystyką, indeks siatkowy |

## Wyniki pomiarów

Skrypty w `scripts/` liczą wszystkie liczby, którymi posługuje się prezentacja.
Uruchamiane przez `npx tsx scripts/verify-*.mts`.

| Skrypt | Mierzy |
| --- | --- |
| `verify-pdr` | błąd pozycji jako % przebytej drogi (1,74 % na 2,1 km) |
| `verify-gnss-fusion` | zysk z fuzji (−26 % błędu) i uczciwość raportowanej niepewności |
| `verify-correction` | wpływ korekcji ręcznej (−30 % błędu końcowego) |
| `verify-mapmatching` | zysk na ulicach i **udokumentowaną szkodę poza siecią dróg** |
| `verify-osm` | graf z odpowiedzi `out body; >; out skel qt;` |
| `verify-routing` | dopuszczalność heurystyki A* wobec Dijkstry |
| `verify-trails` | bufory śladów |
| `verify-ui` | prawdziwa przeglądarka: mapa, kafle, sekwencja cel → trasa |

`verify-ui` wymaga działającego `npm run dev` i Chromium.

Map matching pogarsza wynik poza siecią dróg i jest to zmierzone, nie
przypuszczane — szczegóły w komentarzu w `lib/fusion/particleFilter.ts`.
Dlatego korekcja ręczna jest jedynym mechanizmem odzysku, na którym system
naprawdę polega.
