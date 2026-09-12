# Lokalny Overpass API

Publiczna instancja Overpass nie nadaje się do tego projektu: ~10 000 zapytań i <1 GB dziennie,
a dokumentacja wprost odradza uruchamianie na niej aplikacji. Do tego odrzuca **powtórzone
identyczne zapytania z tego samego IP** — czyli dokładnie to, co robi się przy developmencie.

Lokalna instancja rozwiązuje wszystkie trzy problemy i jest osobnym argumentem na demo:
**cały stack działa bez internetu.**

## Zakres danych

Województwo pomorskie (`pomorskie-latest.osm.pbf`, ~111 MB). Pokrywa Trójmiasto
(gęsta zabudowa miejska) i Trójmiejski Park Krajobrazowy (teren leśny) — czyli oba warianty
terenu w scenariuszu demo, i zgadza się z narracją o zakłóceniach GNSS nad Bałtykiem.

## Uruchomienie

```bash
cd infra/overpass
docker compose up -d
docker compose logs -f      # podgląd postępu
```

**Pierwsze uruchomienie to import bazy.** Kolejność: pobranie ~111 MB pbf →
konwersja `osmium cat` do bz2 → budowa indeksów. Orientacyjnie **20–45 min**
na SSD i kilka GB miejsca na dysku.
Uruchom to jako pierwsze i zostaw w tle — reszta pracy nie jest tym zablokowana.

Gotowość sprawdzisz tak:

```bash
docker compose ps           # kolumna STATUS ma pokazać (healthy)
```

## Test dymny

```bash
curl -s 'http://localhost:12345/api/interpreter' \
  --data-urlencode 'data=[out:json][timeout:25];
    node(54.35,18.60,54.37,18.65)["amenity"="pharmacy"];
    out body 5;'
```

Powinieneś dostać JSON z aptekami w centrum Gdańska. Jeśli dostajesz pustą listę —
import jeszcze trwa. Jeśli connection refused — kontener nie wstał, sprawdź logi.

## Nieoczywiste ustawienia w `docker-compose.yml`

| Zmienna | Dlaczego |
|---|---|
| `OVERPASS_STOP_AFTER_INIT: "false"` | **Domyślnie kontener zatrzymuje się po imporcie.** Bez tego po 40 minutach czekania dostaniesz martwy kontener. |
| `OVERPASS_ALLOW_DUPLICATE_QUERIES: "yes"` | Domyślnie identyczne zapytanie z tego samego IP jest odrzucane. Przy hot-reloadzie Next.js to blokuje pracę. |
| `OVERPASS_USE_AREAS: "false"` | Generowanie areas trwa długo i zjada miejsce. Nie używamy `area[]` — filtrujemy bboxami. |
| `OVERPASS_META: "no"` | Nie potrzebujemy autorów ani historii edycji. Mniejsza baza, szybszy import. |
| `OVERPASS_RATE_LIMIT: "0"` | Prefetch obszaru operacji wysyła wiele zapytań równolegle. |
| `OVERPASS_PLANET_PREPROCESS` | **Największa pułapka.** Obraz pobiera plik pod nazwą `planet.osm.bz2` i bez pytania podaje go bunzipowi. Geofabrik serwuje PBF, więc bez konwersji `osmium cat` import kończy się po 17 minutach pobierania błędem `bunzip2: (stdin) is not a bzip2 file`. |

## Reset bazy

```bash
docker compose down -v      # -v kasuje wolumen z bazą; następny start = pełny import od nowa
```

## Zmiana regionu

Podmień `OVERPASS_PLANET_URL` i `OVERPASS_DIFF_URL` na inny region z
[Geofabrik](https://download.geofabrik.de/europe/poland.html) i zrób `docker compose down -v`.
Uwaga: całe `poland-latest.osm.pbf` to ~2 GB i import liczony w godzinach — na hakaton
nie warto.
