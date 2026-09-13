import type { LatLon } from "@/lib/geo/types";
import { distance } from "@/lib/geo/projection";
import type { BBox } from "./queries";

/**
 * Podział obszaru operacji na kafle.
 *
 * Obszar 30×30 km to 900 km² — około dziewięćdziesiąt razy więcej niż
 * pierwotne pobranie wokół trasy scenariusza. Jednym zapytaniem Overpass
 * tego nie odda: same obrysy budynków szłyby w setki megabajtów, a parser
 * JSON w Node dostałby odpowiedź, której nie ma gdzie zmieścić.
 *
 * Dlatego obszar jest siatką kafli dociąganych pojedynczo, od najbliższego
 * pieszemu. Dzięki temu to, co potrzebne teraz, jest na miejscu po kilku
 * sekundach, a reszta dojeżdża w tle — i w każdej chwili można przerwać,
 * nie tracąc tego, co już pobrane.
 */

/** Bok obszaru operacji, w metrach. */
export const OPERATION_AREA_M = 30_000;

/** Bok kafla, w metrach. */
export const TILE_M = 5_000;

/**
 * Promień, w którym pobieramy obrysy budynków.
 *
 * Budynki służą wyłącznie karze dla cząstek, które znalazły się wewnątrz
 * ściany — a chmura cząstek ma promień metrów, nie kilometrów. Obrysy
 * z drugiego końca obszaru operacji nie zostałyby nigdy o nic zapytane,
 * a są najcięższą częścią odpowiedzi Overpassa.
 */
export const BUILDINGS_RADIUS_M = 10_000;

/**
 * Przesunięcie pieszego, po którym obszar operacji jedzie za nim.
 *
 * Wymaganie brzmi: „po odległości min. 2 km od ostatniego miejsca
 * natychmiast staramy się pobrać mapę". Przesunięcie środka wprowadza
 * do obszaru nowy pas kafli i tym samym nową pracę dla pobierania.
 */
export const RECENTER_M = 2_000;

const LAT_METERS_PER_DEG = 111_320;
const TILE_LAT_DEG = TILE_M / LAT_METERS_PER_DEG;

export type Tile = {
  row: number;
  col: number;
  /** Klucz stabilny globalnie — nadaje się na klucz cache'u. */
  key: string;
  bbox: BBox;
  center: LatLon;
};

/**
 * Szerokość kafla w stopniach długości, dla danego wiersza siatki.
 *
 * Liczona z szerokości geograficznej WIERSZA, a nie z pozycji pieszego.
 * Gdyby zależała od bieżącej pozycji, siatka przesuwałaby się razem z nim,
 * a wtedy każdy kafel dostawałby przy kolejnym przeliczeniu inny prostokąt
 * i inny klucz cache'u — pobieralibyśmy w kółko te same dane.
 */
function lonStep(row: number): number {
  const centerLat = (row + 0.5) * TILE_LAT_DEG;
  const scale = Math.max(Math.cos((centerLat * Math.PI) / 180), 0.05);
  return TILE_M / (LAT_METERS_PER_DEG * scale);
}

function makeTile(row: number, col: number): Tile {
  const step = lonStep(row);
  const south = row * TILE_LAT_DEG;
  const west = col * step;

  return {
    row,
    col,
    key: `${row}:${col}`,
    bbox: {
      south,
      west,
      north: south + TILE_LAT_DEG,
      east: west + step,
    },
    center: { lat: south + TILE_LAT_DEG / 2, lon: west + step / 2 },
  };
}

/** Kafel, w którym leży punkt. */
export function tileAt(point: LatLon): Tile {
  const row = Math.floor(point.lat / TILE_LAT_DEG);
  return makeTile(row, Math.floor(point.lon / lonStep(row)));
}

/**
 * Kafle obszaru operacji wokół środka, posortowane od najbliższego punktowi
 * odniesienia.
 *
 * Kolejność jest tu treścią, nie kosmetyką: pobieranie idzie po tej liście,
 * więc decyduje o tym, czy w pierwszych sekundach mamy mapę pod nogami,
 * czy na drugim końcu obszaru.
 */
export function tilesInArea(
  center: LatLon,
  nearest: LatLon,
  sideMeters = OPERATION_AREA_M,
): Tile[] {
  const half = sideMeters / 2;
  const dLat = half / LAT_METERS_PER_DEG;
  const scale = Math.max(Math.cos((center.lat * Math.PI) / 180), 0.05);
  const dLon = half / (LAT_METERS_PER_DEG * scale);

  const rowFrom = Math.floor((center.lat - dLat) / TILE_LAT_DEG);
  const rowTo = Math.floor((center.lat + dLat) / TILE_LAT_DEG);

  const tiles: Tile[] = [];
  for (let row = rowFrom; row <= rowTo; row++) {
    const step = lonStep(row);
    const colFrom = Math.floor((center.lon - dLon) / step);
    const colTo = Math.floor((center.lon + dLon) / step);
    for (let col = colFrom; col <= colTo; col++) {
      tiles.push(makeTile(row, col));
    }
  }

  return tiles.sort(
    (a, b) => distance(nearest, a.center) - distance(nearest, b.center),
  );
}
