#!/usr/bin/env bash
#
# Usuwa pliki, które wypadły z projektu przy odchudzaniu, a zostały na dysku.
#
# Nie dało się ich skasować zdalnie, więc wisiały dalej i psuły build:
# `app/api/osm/diagnose/route.ts` importuje `bboxAround`, którego już nie ma
# w `lib/osm/mapData.ts`, a `components/ui/*` importuje pakiety npm usunięte
# z package.json. Skrypt dotyka WYŁĄCZNIE wymienionych niżej ścieżek.
#
#   bash posprzataj.sh
#
set -u

cd "$(dirname "$0")" || exit 1

# Zabezpieczenie przed uruchomieniem w przypadkowym katalogu.
if [ ! -f package.json ] || ! grep -q '"baltic-dual-use"' package.json; then
  echo "To nie jest katalog projektu baltic-dual-use — przerywam." >&2
  exit 1
fi

MARTWE=(
  infra                       # lokalny Overpass w Dockerze — hostowany gdzie indziej
  app/api/osm/diagnose        # endpoint diagnostyczny Overpassa
  app/api/osm/status          # health check, z którego nic nie korzystało
  app/api/sim/correct         # korekcja idzie teraz przez /api/sim/control
  components/ui               # badge i button z shadcn — nieużywane
  components.json             # konfiguracja shadcn
  lib/utils.ts                # re-eksport `cn`, używany tylko przez powyższe
  app/favicon.ico             # zastąpiony przez app/icon.svg
)

usuniete=0
for sciezka in "${MARTWE[@]}"; do
  if [ -e "$sciezka" ]; then
    git rm -r -q --cached --ignore-unmatch "$sciezka" 2>/dev/null
    rm -rf "$sciezka"
    echo "  usunięto  $sciezka"
    usuniete=$((usuniete + 1))
  fi
done

# Next.js trzyma w .next wygenerowane walidatory tras. Po usunięciu endpointu
# zostaje w nich odwołanie do pliku, którego już nie ma — i typecheck pada
# na czymś, czego nie widać w źródłach.
rm -rf .next
echo "  usunięto  .next (wygenerowane typy tras)"

echo
echo "Gotowe — $usuniete pozycji. Teraz:"
echo "  npm install && npm run dev"
