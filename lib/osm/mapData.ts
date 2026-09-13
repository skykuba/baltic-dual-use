import type { LatLon } from "@/lib/geo/types";
import { distance } from "@/lib/geo/projection";
import { NavGraph } from "./graph";
import { Buildings } from "./buildings";
import { overpassQuery, type OverpassSource } from "./overpass";
import { buildingsQuery, poiQuery, walkableWaysQuery } from "./queries";
import { POI_CATEGORIES, findCategory, type Poi, type PoiPriority } from "./poi";
import {
  BUILDINGS_RADIUS_M,
  OPERATION_AREA_M,
  tileAt,
  tilesInArea,
  type Tile,
} from "./tiles";

/**
 * Warstwa mapowa obszaru operacji, dociągana kaflami.
 *
 * To jest realizacja scenariusza „w zasięgu pobieramy, bez zasięgu
 * korzystamy" w wersji, która nie zakłada, że wszystko zmieści się
 * w jednym zapytaniu. Obszar operacji ma 30×30 km i jedzie za pieszym;
 * kafle dociągane są od najbliższego, pojedynczo, dopóki jest łączność.
 *
 * Graf, budynki i POI rosną PRZYROSTOWO — każdy kafel dokłada się do tego,
 * co już jest, zamiast budować struktury od nowa. Bez tego koszt byłby
 * kwadratowy względem liczby kafli.
 */

export type MapLayer = "ways" | "buildings" | "pois";

export type MapProgress = {
  /** Kafli w obszarze operacji. */
  total: number;
  /** Kafli z pobraną siecią dróg. */
  ready: number;
  /** Kafli z zaległą robotą. */
  pending: number;
  /** Bok obszaru operacji, w metrach. */
  areaMeters: number;
};

export type MapStats = {
  nodes: number;
  edges: number;
  buildings: number;
  pois: number;
  /**
   * Skąd realnie przyszły dane ostatniego kafla — najsłabsze z użytych
   * źródeł. Jeśli choć jedno zapytanie musiało pójść na publiczną instancję,
   * demo NIE jest w pełni offline i warto o tym wiedzieć przed prezentacją,
   * a nie w jej trakcie.
   */
  origin: OverpassSource;
  elapsedMs: number;
  progress: MapProgress;
};

export type TileJob = { tile: Tile; layers: MapLayer[] };

/** Jak długo odpoczywa kafel, którego nie udało się pobrać. */
const RETRY_AFTER_MS = 60_000;

export class OperationMap {
  readonly graph = new NavGraph();
  readonly buildings = new Buildings();
  readonly pois: Poi[] = [];

  /** Środek obszaru operacji. Jedzie za pieszym co RECENTER_M. */
  private center: LatLon;
  private readonly done = new Map<string, Set<MapLayer>>();
  private readonly poiIds = new Set<string>();
  private lastOrigin: OverpassSource = "cache";
  /**
   * Kafle, które ostatnio się nie udały, wraz z czasem porażki.
   *
   * Bez tego jeden kafel nie do pobrania — przekroczony limit czasu
   * Overpassa w gęstej zabudowie, dziura w cache'u przy braku łączności —
   * blokowałby kolejkę i wracał przy każdym sprawdzeniu co kilka sekund,
   * w kółko. Karencja przesuwa go na koniec zainteresowania, a reszta
   * obszaru dociąga się dalej.
   */
  private readonly failedAt = new Map<string, number>();
  private lastElapsedMs = 0;
  private tileCount = 0;
  private pendingCount = 0;
  private readyCount = 0;

  constructor(
    center: LatLon,
    private readonly maxPoiPriority: PoiPriority = 2,
  ) {
    this.center = center;
  }

  get areaCenter(): LatLon {
    return this.center;
  }

  recenter(point: LatLon): void {
    this.center = point;
  }

  /** Czy w miejscu pieszego jest na czym pracować. */
  covers(point: LatLon): boolean {
    return this.done.get(tileAt(point).key)?.has("ways") ?? false;
  }

  get ready(): boolean {
    return this.graph.size.edges > 0;
  }

  /**
   * Czego brakuje, w kolejności od najbliższego pieszemu.
   *
   * Budynki tylko w promieniu BUILDINGS_RADIUS_M — patrz komentarz przy tej
   * stałej. Reszta obszaru dostaje drogi i POI, bo to one decydują o tym,
   * czy da się tam w ogóle wyznaczyć trasę.
   */
  plan(walker: LatLon, now = Date.now()): TileJob[] {
    const tiles = tilesInArea(this.center, walker, OPERATION_AREA_M);
    this.tileCount = tiles.length;

    // Liczymy kafle gotowe W BIEŻĄCYM obszarze, a nie wszystkie kiedykolwiek
    // pobrane. Obszar jedzie za pieszym, więc te z tyłu wypadają z okna —
    // bez tego licznik pokazywał „50 / 49 kafli".
    let ready = 0;

    const jobs: TileJob[] = [];
    for (const tile of tiles) {
      if (this.done.get(tile.key)?.has("ways")) ready++;

      const failed = this.failedAt.get(tile.key);
      if (failed !== undefined && now - failed < RETRY_AFTER_MS) continue;

      const have = this.done.get(tile.key);
      const wanted: MapLayer[] = ["ways", "pois"];
      if (distance(walker, tile.center) <= BUILDINGS_RADIUS_M) {
        wanted.push("buildings");
      }

      const missing = wanted.filter((layer) => !have?.has(layer));
      if (missing.length > 0) jobs.push({ tile, layers: missing });
    }

    this.pendingCount = jobs.length;
    this.readyCount = ready;
    return jobs;
  }

  /**
   * Pobiera jeden kafel i wchłania go.
   *
   * `cacheOnly` to tryb bez łączności: kafle zapisane wcześniej na dysku
   * nadal się wczytują, bo cache JEST pamięcią urządzenia — a sieci nie
   * ruszamy, żeby nie czekać na limit czasu przy każdej próbie.
   */
  async fetchTile(job: TileJob, cacheOnly = false): Promise<boolean> {
    const started = Date.now();
    const sources: OverpassSource[] = [];
    const fetched = this.done.get(job.tile.key) ?? new Set<MapLayer>();

    for (const layer of job.layers) {
      const query =
        layer === "ways"
          ? walkableWaysQuery(job.tile.bbox)
          : layer === "buildings"
            ? buildingsQuery(job.tile.bbox)
            : poiQuery(job.tile.bbox, this.maxPoiPriority);

      const result = await overpassQuery(query, { cacheOnly });
      if (!result) {
        this.failedAt.set(job.tile.key, Date.now());
        return false;
      }

      sources.push(result.source);
      if (layer === "ways") this.graph.addElements(result.data.elements);
      else if (layer === "buildings") this.buildings.addElements(result.data.elements);
      else this.addPois(result.data.elements);

      fetched.add(layer);
      this.done.set(job.tile.key, fetched);
    }

    this.failedAt.delete(job.tile.key);
    this.lastOrigin = weakestSource(sources);
    this.lastElapsedMs = Date.now() - started;
    return true;
  }

  /** Odnotowuje kafel, na którym Overpass rzucił błędem. */
  markFailed(tile: Tile): void {
    this.failedAt.set(tile.key, Date.now());
  }

  private addPois(elements: Parameters<typeof parsePois>[0]): void {
    for (const poi of parsePois(elements, this.maxPoiPriority)) {
      if (this.poiIds.has(poi.id)) continue;
      this.poiIds.add(poi.id);
      this.pois.push(poi);
    }
  }

  get stats(): MapStats {
    return {
      nodes: this.graph.size.nodes,
      edges: this.graph.size.edges,
      buildings: this.buildings.count,
      pois: this.pois.length,
      origin: this.lastOrigin,
      elapsedMs: this.lastElapsedMs,
      progress: {
        total: this.tileCount,
        ready: this.readyCount,
        pending: this.pendingCount,
        areaMeters: OPERATION_AREA_M,
      },
    };
  }
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
