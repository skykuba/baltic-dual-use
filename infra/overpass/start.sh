#!/usr/bin/env bash
#
# Uruchamia lokalną instancję Overpass API bez `docker compose`.
#
# Dlaczego nie compose: plugin Compose V2 bywa nieobecny albo przesłonięty
# przez shim (podman-docker, snapowy docker), a objawia się to błędem
# "unknown shorthand flag: 'd' in -d", który nie mówi nic o przyczynie.
# Czysty `docker run` nie zależy od żadnego pluginu.
#
# Użycie:
#   ./start.sh          — uruchom (lub wznów istniejący kontener)
#   ./start.sh --reset  — skasuj bazę i zaimportuj od nowa
#   ./start.sh --logs   — pokaż logi importu
#   ./start.sh --status — sprawdź, czy API odpowiada

set -euo pipefail

NAME="overpass-pomorskie"
VOLUME="overpass-db"
PORT="${OVERPASS_PORT:-12345}"
REGION="${OVERPASS_REGION:-europe/poland/pomorskie}"
IMAGE="wiktorn/overpass-api:latest"

PLANET_URL="https://download.geofabrik.de/${REGION}-latest.osm.pbf"
DIFF_URL="https://download.geofabrik.de/${REGION}-updates/"

# Silnik: docker albo podman — cokolwiek jest dostępne.
if command -v docker >/dev/null 2>&1; then
  ENGINE=docker
elif command -v podman >/dev/null 2>&1; then
  ENGINE=podman
else
  echo "✗ Nie znaleziono ani docker, ani podman." >&2
  exit 1
fi

api_url="http://localhost:${PORT}/api/interpreter"

# Czy demon w ogóle odpowiada. Bez tego sprawdzenia każde kolejne polecenie
# wypisuje surowy błąd gniazda uniksowego, z którego nie wynika, że problemem
# jest po prostu niedziałająca usługa.
daemon_up() {
  $ENGINE info >/dev/null 2>&1
}

require_daemon() {
  if daemon_up; then return; fi
  echo "✗ ${ENGINE} jest zainstalowany, ale demon nie odpowiada." >&2
  echo >&2
  echo "  Linux:  sudo systemctl start docker" >&2
  echo "          (i raz: sudo usermod -aG docker \$USER, potem wyloguj się i zaloguj)" >&2
  echo "  macOS:  uruchom Docker Desktop" >&2
  echo >&2
  echo "  Demo zadziała bez tego — aplikacja pobierze dane z publicznego" >&2
  echo "  Overpassa i zapisze je w .cache/osm." >&2
  exit 1
}

status() {
  echo "── Stan ──"
  if ! daemon_up; then
    echo "  demon:    NIE ODPOWIADA (uruchom usługę ${ENGINE})"
    return
  fi
  if ! $ENGINE ps -a --filter "name=^${NAME}$" --format '{{.Names}}' 2>/dev/null | grep -q .; then
    echo "  kontener: nie istnieje"
    return
  fi
  echo "  kontener: $($ENGINE ps -a --filter "name=^${NAME}$" --format '{{.Status}}')"

  local body
  if body=$(curl -s --max-time 15 "$api_url" \
      --data-urlencode 'data=[out:json][timeout:10];out count;' 2>/dev/null); then
    if echo "$body" | grep -q '"elements"'; then
      echo "  API:      odpowiada ✓"
      local probe
      probe=$(curl -s --max-time 20 "$api_url" \
        --data-urlencode 'data=[out:json][timeout:15];node(54.35,18.60,54.37,18.65)["amenity"="pharmacy"];out 3;' 2>/dev/null || true)
      local n
      n=$(echo "$probe" | grep -o '"type"' | wc -l | tr -d ' ')
      if [ "$n" -gt 0 ]; then
        echo "  dane:     obecne ✓ (znaleziono apteki w centrum Gdańska)"
      else
        echo "  dane:     BRAK — import prawdopodobnie jeszcze trwa"
        echo "            podgląd: ./start.sh --logs"
      fi
    else
      echo "  API:      odpowiada, ale nie JSON-em — import trwa"
    fi
  else
    echo "  API:      brak odpowiedzi (import trwa albo kontener nie wstał)"
  fi
}

case "${1:-}" in
  --status) status; exit 0 ;;
  --logs)   require_daemon; exec $ENGINE logs -f "$NAME" ;;
  --reset)
    require_daemon
    echo "Kasowanie kontenera i bazy…"
    $ENGINE rm -f "$NAME" >/dev/null 2>&1 || true
    $ENGINE volume rm "$VOLUME" >/dev/null 2>&1 || true
    ;;
esac

require_daemon

# Kontener już jest? Wznów zamiast tworzyć drugi.
if $ENGINE ps -a --filter "name=^${NAME}$" --format '{{.Names}}' | grep -q .; then
  if $ENGINE ps --filter "name=^${NAME}$" --format '{{.Names}}' | grep -q .; then
    echo "Kontener ${NAME} już działa."
  else
    echo "Wznawianie istniejącego kontenera…"
    $ENGINE start "$NAME" >/dev/null
  fi
  status
  exit 0
fi

echo "Uruchamianie Overpass dla regionu: ${REGION}"
echo "Pierwszy start to import bazy — orientacyjnie 20–45 min."
echo

$ENGINE volume create "$VOLUME" >/dev/null

$ENGINE run -d --name "$NAME" \
  -p "${PORT}:80" \
  -v "${VOLUME}:/db" \
  -e OVERPASS_MODE=init \
  -e OVERPASS_PLANET_URL="$PLANET_URL" \
  -e OVERPASS_DIFF_URL="$DIFF_URL" \
  `# Obraz pobiera plik jako planet.osm.bz2 i od razu podaje bunzipowi.` \
  `# Geofabrik serwuje PBF, więc bez konwersji import pada po kilkunastu` \
  `# minutach pobierania na "bunzip2: (stdin) is not a bzip2 file".` \
  -e OVERPASS_PLANET_PREPROCESS='mv /db/planet.osm.bz2 /db/planet.osm.pbf && osmium cat -o /db/planet.osm.bz2 /db/planet.osm.pbf && rm /db/planet.osm.pbf' \
  -e OVERPASS_META=no \
  -e OVERPASS_COMPRESSION=lz4 \
  `# Bez tego kontener ZATRZYMUJE SIĘ po zakończeniu importu.` \
  -e OVERPASS_STOP_AFTER_INIT=false \
  -e OVERPASS_UPDATE_SLEEP=86400 \
  -e OVERPASS_RULES_LOAD=10 \
  -e OVERPASS_USE_AREAS=false \
  `# Domyślnie identyczne zapytanie z tego samego IP jest odrzucane —` \
  `# przy hot-reloadzie Next.js to paraliżuje pracę.` \
  -e OVERPASS_ALLOW_DUPLICATE_QUERIES=yes \
  -e OVERPASS_RATE_LIMIT=0 \
  -e OVERPASS_MAX_TIMEOUT=300 \
  -e OVERPASS_FASTCGI_PROCESSES=8 \
  --restart unless-stopped \
  "$IMAGE" >/dev/null

echo "✓ Kontener wystartował."
echo
echo "  podgląd importu:  ./start.sh --logs"
echo "  sprawdzenie:      ./start.sh --status"
echo
echo "Demo NIE czeka na ten import — bez lokalnej instancji aplikacja"
echo "pobierze dane z publicznego Overpassa i zapisze je w .cache/osm."
