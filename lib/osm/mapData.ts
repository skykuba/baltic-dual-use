import type { LatLon } from "@/lib/geo/types";
import { NavGraph } from "./graph";
import { Buildings } from "./buildings";
import { overpassQuery, type OverpassSource } from "./overpass";
import { buildingsQuery, poiQuery, walkableWaysQuery, type BBox } from "./queries";
import { POI_CATEGORIES, findCategory, type Poi, type PoiPriority } from "./poi";

/**
 * Pobranie i przygotowanie warstwy mapowej dla obszaru operacji.
 *
 * To jest realizacja scenariusza „w zasięgu pobierz, bez zasięgu korzystaj":
 * wszystko ściągamy z góry, jednym strzałem, i od tej chwili estymacja
 * działa bez sieci.
 */

export type MapBundle = {
  graph: NavGraph;
  buildings: Buildings;
  pois: Poi[];
  bbox: BBox;
  stats: {
    nodes: number;
    edges: number;
    buildings: number;
    pois: number;
    sources: Record<string, OverpassSource>;
    /** Skąd realnie przyszły dane — najsłabsze z użytych źródeł. */
    origin: OverpassSource;
    elapsedMs: number;
  };
};

/** Prostokąt obejmujący podane punkty, powiększony o margines w metrach. */
export function bboxAround(points: LatLon[], marginMeters = 500): BBox {
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;

  const dLat = marginMeters / 111_320;
  const dLon = marginMeters / (111_320 * Math.cos((midLat * Math.PI) / 180));

  return {
    south: Math.min(...lats) - dLat,
    west: Math.min(...lons) - dLon,
    north: Math.max(...lats) + dLat,
    east: Math.max(...lons) + dLon,
  };
}

export async function fetchMapBundle(
  bbox: BBox,
  maxPoiPriority: PoiPriority = 2,
): Promise<MapBundle> {
  const started = Date.now();

  // Trzy zapytania równolegle. Lokalna instancja nie ma limitu równoległości
  // (OVERPASS_RATE_LIMIT=0), więc nie ma powodu czekać szeregowo.
  const [ways, buildingsResult, pois] = await Promise.all([
    overpassQuery(walkableWaysQuery(bbox)),
    overpassQuery(buildingsQuery(bbox)),
    overpassQuery(poiQuery(bbox, maxPoiPriority)),
  ]);

  const graph = NavGraph.fromElements(ways.data.elements);
  const buildings = Buildings.fromElements(buildingsResult.data.elements);
  const parsedPois = parsePois(pois.data.elements, maxPoiPriority);

  return {
    graph,
    buildings,
    pois: parsedPois,
    bbox,
    stats: {
      nodes: graph.size.nodes,
      edges: graph.size.edges,
      buildings: buildings.count,
      pois: parsedPois.length,
      sources: {
        ways: ways.source,
        buildings: buildingsResult.source,
        pois: pois.source,
      },
      // Najsłabsze z użytych źródeł: jeśli choć jedno zapytanie musiało
      // pójść na publiczną instancję, demo NIE jest w pełni offline
      // i warto o tym wiedzieć przed prezentacją, a nie w jej trakcie.
      origin: weakestSource([ways.source, buildingsResult.source, pois.source]),
      elapsedMs: Date.now() - started,
    },
  };
}

/** Kolejność od najlepszego do najsłabszego źródła. */
function weakestSource(sources: OverpassSource[]): OverpassSource {
  const rank: Record<OverpassSource, number> = { cache: 0, local: 1, fallback: 2 };
  return sources.reduce((worst, s) => (rank[s] > rank[worst] ? s : worst), "cache");
}

/**
 * Zamiana elementów Overpassa na punkty POI.
 *
 * Jeden obiekt może pasować do kilku kategorii (apteka w szpitalu),
 * więc przypisujemy go do kategorii o najwyższym priorytecie i nie
 * dublujemy wpisów.
 */
function parsePois(
  elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[],
  maxPriority: PoiPriority,
): Poi[] {
  const out: Poi[] = [];
  const seen = new Set<string>();

  for (const element of elements) {
    const tags = element.tags;
    if (!tags) continue;

    // `out center` daje ways środek obrysu; nodes mają własne współrzędne.
    const lat = element.lat ?? element.center?.lat;
    const lon = element.lon ?? element.center?.lon;
    if (lat === undefined || lon === undefined) continue;

    const key = `${element.type}/${element.id}`;
    if (seen.has(key)) continue;

    const category = matchCategory(tags, maxPriority);
    if (!category) continue;

    seen.add(key);
    out.push({
      id: key,
      lat,
      lon,
      categoryId: category.id,
      priority: category.priority,
      name: tags.name,
      tags,
    });
  }

  // Sortowanie po priorytecie sprawia, że przy przycinaniu listy
  // odpadają najpierw punkty najmniej istotne.
  return out.sort((a, b) => a.priority - b.priority);
}

function matchCategory(tags: Record<string, string>, maxPriority: PoiPriority) {
  let best: ReturnType<typeof findCategory> | undefined;

  for (const [key, value] of Object.entries(tags)) {
    for (const category of POI_LOOKUP) {
      if (category.priority > maxPriority) continue;
      if (best && category.priority >= best.priority) continue;
      if (category.pairs.some((p) => p.key === key && p.value === value)) {
        best = findCategory(category.id);
      }
    }
  }

  return best;
}

/**
 * Filtry kategorii przetworzone raz na pary klucz/wartość.
 *
 * Parsowanie łańcuchów Overpass QL przy każdym elemencie odpowiedzi
 * (a tych bywają tysiące) byłoby marnotrawstwem.
 */
const POI_LOOKUP = POI_CATEGORIES.map((category) => ({
  id: category.id,
  priority: category.priority,
  pairs: category.filters
    .map((filter) => {
      const match = /\["([^"]+)"="([^"]+)"\]/.exec(filter);
      return match ? { key: match[1], value: match[2] } : null;
    })
    .filter((p): p is { key: string; value: string } => p !== null),
}));
