import type { LatLon } from "@/lib/geo/types";
import { distance, metersPerDegree } from "@/lib/geo/projection";
import type { OverpassElement } from "./overpass";

/**
 * Graf nawigacyjny zbudowany z ways OpenStreetMap.
 *
 * Służy dwóm celom naraz:
 *   - jako ograniczenie dla filtru cząsteczkowego (pieszy idzie drogami),
 *   - jako graf do wyznaczania trasy A*.
 *
 * Oba potrzebują szybkiego pytania „jak daleko stąd do najbliższej drogi",
 * wykonywanego setki razy na tick — stąd indeks przestrzenny, a nie
 * liniowe przeszukiwanie krawędzi.
 */

export type GraphNode = {
  id: number;
  lat: number;
  lon: number;
  /** Indeksy krawędzi wychodzących z tego węzła. */
  edges: number[];
};

export type GraphEdge = {
  a: number;
  b: number;
  /** Długość w metrach. */
  length: number;
  wayId: number;
  highway: string;
  /** Koszt przejścia dla pieszego — im mniejszy, tym chętniej wybierany. */
  cost: number;
};

/**
 * Mnożniki kosztu dla pieszego.
 *
 * Ścieżka dla pieszych jest tańsza niż jezdnia o tej samej długości,
 * żeby routing prowadził chodnikami tam, gdzie to możliwe.
 */
const HIGHWAY_COST: Record<string, number> = {
  footway: 0.85,
  path: 0.9,
  pedestrian: 0.85,
  steps: 1.6,
  track: 1.05,
  residential: 1.0,
  living_street: 0.95,
  service: 1.1,
  unclassified: 1.0,
  tertiary: 1.15,
  secondary: 1.3,
  primary: 1.5,
  cycleway: 1.0,
};

export class NavGraph {
  readonly nodes = new Map<number, GraphNode>();
  readonly edges: GraphEdge[] = [];

  /** Indeks siatkowy: klucz komórki → indeksy krawędzi ją przecinających. */
  private grid = new Map<string, number[]>();
  /** Bok komórki w stopniach szerokości; ~110 m. */
  private readonly cellSize = 0.001;

  /**
   * Buduje graf z odpowiedzi Overpassa.
   *
   * Obsługiwane są OBA kształty odpowiedzi:
   *   - `out geom` — ways niosą tablicę `geometry` równoległą do `nodes`,
   *   - `out body; >; out skel qt` — ways niosą tylko identyfikatory węzłów,
   *     a współrzędne przychodzą jako osobne elementy typu `node`.
   *
   * Drugi wariant jest domyślny, bo działa na każdej wersji Overpassa,
   * ale pierwszy zostaje obsłużony: odpowiedzi w cache'u mogły zostać
   * pobrane starszym zapytaniem, a ich milczące odrzucenie objawiłoby się
   * pustym grafem bez żadnego komunikatu.
   */
  static fromElements(elements: OverpassElement[]): NavGraph {
    const graph = new NavGraph();

    // Najpierw współrzędne węzłów — ways mogą się odwoływać do węzłów
    // wypisanych po nich.
    const coords = new Map<number, { lat: number; lon: number }>();
    for (const element of elements) {
      if (element.type !== "node") continue;
      if (element.lat === undefined || element.lon === undefined) continue;
      coords.set(element.id, { lat: element.lat, lon: element.lon });
    }

    for (const element of elements) {
      if (element.type !== "way") continue;
      const { nodes, geometry, tags } = element;
      if (!nodes || nodes.length < 2) continue;

      const highway = tags?.highway ?? "unclassified";
      const costFactor = HIGHWAY_COST[highway] ?? 1.2;

      const useGeometry = geometry !== undefined && geometry.length === nodes.length;
      let previous: number | null = null;

      for (let i = 0; i < nodes.length; i++) {
        const point = useGeometry ? geometry[i] : coords.get(nodes[i]);
        // Way wychodzący poza bbox ma węzły, których Overpass nie zwrócił.
        // Przerywamy wtedy ciągłość zamiast łączyć punkty przez lukę —
        // taka krawędź byłaby fikcyjną drogą na skróty.
        if (!point) {
          previous = null;
          continue;
        }

        graph.ensureNode(nodes[i], point.lat, point.lon);
        if (previous !== null) {
          graph.addEdge(previous, nodes[i], element.id, highway, costFactor);
        }
        previous = nodes[i];
      }
    }

    graph.buildIndex();
    return graph;
  }

  private ensureNode(id: number, lat: number, lon: number): GraphNode {
    let node = this.nodes.get(id);
    if (!node) {
      node = { id, lat, lon, edges: [] };
      this.nodes.set(id, node);
    }
    return node;
  }

  private addEdge(
    a: number,
    b: number,
    wayId: number,
    highway: string,
    costFactor: number,
  ): void {
    const nodeA = this.nodes.get(a);
    const nodeB = this.nodes.get(b);
    if (!nodeA || !nodeB || a === b) return;

    const length = distance(nodeA, nodeB);
    if (length === 0) return;

    const index = this.edges.length;
    this.edges.push({
      a,
      b,
      length,
      wayId,
      highway,
      cost: length * costFactor,
    });
    nodeA.edges.push(index);
    nodeB.edges.push(index);
  }

  private buildIndex(): void {
    this.grid = new Map();
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i];
      const a = this.nodes.get(edge.a);
      const b = this.nodes.get(edge.b);
      if (!a || !b) continue;

      // Krawędź trafia do każdej komórki, którą przecina jej prostokąt
      // otaczający. Przy krawędziach rzędu dziesiątek metrów i komórce
      // ~110 m to prawie zawsze jedna lub dwie komórki.
      const minLat = Math.min(a.lat, b.lat);
      const maxLat = Math.max(a.lat, b.lat);
      const minLon = Math.min(a.lon, b.lon);
      const maxLon = Math.max(a.lon, b.lon);

      for (let la = cellIndex(minLat, this.cellSize); la <= cellIndex(maxLat, this.cellSize); la++) {
        for (let lo = cellIndex(minLon, this.cellSize); lo <= cellIndex(maxLon, this.cellSize); lo++) {
          const key = `${la}:${lo}`;
          const bucket = this.grid.get(key);
          if (bucket) bucket.push(i);
          else this.grid.set(key, [i]);
        }
      }
    }
  }

  get size(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.length };
  }

  /**
   * Odległość do najbliższej drogi, w metrach.
   *
   * To jest gorąca ścieżka filtru cząsteczkowego — wywoływana raz na
   * cząstkę na krok, czyli setki razy na sekundę. Przeszukiwanie ogranicza
   * się do komórek siatki wokół punktu; gdy nic nie znajdzie, promień rośnie.
   */
  distanceToNearestWay(point: LatLon, maxSearchMeters = 150): number {
    const rings = Math.max(1, Math.ceil(maxSearchMeters / 110));
    let best = Infinity;

    const baseLat = cellIndex(point.lat, this.cellSize);
    const baseLon = cellIndex(point.lon, this.cellSize);

    for (let ring = 0; ring <= rings; ring++) {
      for (let dLat = -ring; dLat <= ring; dLat++) {
        for (let dLon = -ring; dLon <= ring; dLon++) {
          // Tylko obwód pierścienia — wnętrze sprawdzono w poprzedniej iteracji.
          if (ring > 0 && Math.abs(dLat) !== ring && Math.abs(dLon) !== ring) continue;

          const bucket = this.grid.get(`${baseLat + dLat}:${baseLon + dLon}`);
          if (!bucket) continue;

          for (const index of bucket) {
            const edge = this.edges[index];
            const a = this.nodes.get(edge.a);
            const b = this.nodes.get(edge.b);
            if (!a || !b) continue;
            best = Math.min(best, pointToSegmentMeters(point, a, b));
          }
        }
      }
      // Znaleziony kandydat jest wiarygodny dopiero, gdy jest bliżej
      // niż zasięg już przeszukanych pierścieni.
      if (best <= ring * 110) return best;
    }

    return best;
  }

  /** Najbliższy węzeł grafu — punkt zaczepienia dla routingu. */
  nearestNode(point: LatLon): GraphNode | null {
    let best: GraphNode | null = null;
    let bestDistance = Infinity;

    const baseLat = cellIndex(point.lat, this.cellSize);
    const baseLon = cellIndex(point.lon, this.cellSize);

    for (let ring = 0; ring <= 5; ring++) {
      for (let dLat = -ring; dLat <= ring; dLat++) {
        for (let dLon = -ring; dLon <= ring; dLon++) {
          if (ring > 0 && Math.abs(dLat) !== ring && Math.abs(dLon) !== ring) continue;
          const bucket = this.grid.get(`${baseLat + dLat}:${baseLon + dLon}`);
          if (!bucket) continue;

          for (const index of bucket) {
            for (const nodeId of [this.edges[index].a, this.edges[index].b]) {
              const node = this.nodes.get(nodeId);
              if (!node) continue;
              const d = distance(point, node);
              if (d < bestDistance) {
                bestDistance = d;
                best = node;
              }
            }
          }
        }
      }
      if (best && bestDistance <= ring * 110) return best;
    }

    return best;
  }
}

function cellIndex(degrees: number, cellSize: number): number {
  return Math.floor(degrees / cellSize);
}

/**
 * Odległość punktu od odcinka, w metrach.
 *
 * Liczona w lokalnym układzie płaskim wokół punktu — przy odcinkach
 * rzędu dziesiątek metrów błąd projekcji jest pomijalny, a rachunek
 * sprowadza się do rzutu wektora, zamiast do trygonometrii sferycznej.
 */
export function pointToSegmentMeters(
  p: LatLon,
  a: LatLon,
  b: LatLon,
): number {
  const m = metersPerDegree(p.lat);

  const px = (p.lon - a.lon) * m.lon;
  const py = (p.lat - a.lat) * m.lat;
  const bx = (b.lon - a.lon) * m.lon;
  const by = (b.lat - a.lat) * m.lat;

  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) return Math.hypot(px, py);

  // Parametr rzutu, obcięty do odcinka.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return Math.hypot(px - t * bx, py - t * by);
}
