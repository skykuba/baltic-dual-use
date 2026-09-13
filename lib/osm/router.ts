import type { LatLon } from "@/lib/geo/types";
import { distance } from "@/lib/geo/projection";
import type { GraphNode, NavGraph } from "./graph";

/**
 * Wyznaczanie trasy pieszej algorytmem A* na grafie OpenStreetMap.
 *
 * Heurystyką jest odległość w linii prostej. Żeby A* dawał trasę optymalną,
 * heurystyka musi być dopuszczalna, czyli nigdy nie przeszacowywać kosztu.
 * Nasze koszty krawędzi to długość razy mnożnik zależny od typu drogi,
 * a najmniejszy mnożnik wynosi 0,85 (ścieżka dla pieszych) — więc czysta
 * odległość geograficzna mogłaby przeszacować. Stąd przeskalowanie
 * heurystyki tym właśnie współczynnikiem.
 */
const MIN_COST_FACTOR = 0.85;

export type Route = {
  /** Wierzchołki trasy, od startu do celu. */
  points: LatLon[];
  /**
   * Typ drogi dla odcinka KOŃCZĄCEGO się w `points[i]`.
   *
   * Potrzebny, żeby symulacja marszu wyznaczoną trasą wiedziała, po jakim
   * terenie idzie pieszy — a od tego zależy szum GNSS i, co ważniejsze,
   * zaburzenie magnetometru. Bez tego każda trasa byłaby traktowana
   * jak zabudowa miejska.
   */
  highways: (string | null)[];
  /** Długość geometryczna w metrach. */
  distance: number;
  /** Szacowany czas marszu w sekundach. */
  duration: number;
  /** Ile węzłów odwiedził algorytm — diagnostyka wydajności. */
  visited: number;
};

export type RouteOptions = {
  /** Prędkość marszu w m/s. */
  walkSpeed?: number;
  /** Górny limit odwiedzonych węzłów — zabezpieczenie przed zawieszeniem. */
  maxVisited?: number;
};

/**
 * Trasa z punktu `from` do `to`.
 *
 * Oba punkty są przyciągane do najbliższych węzłów grafu, bo estymowana
 * pozycja pieszego prawie nigdy nie leży dokładnie na węźle.
 */
export function findRoute(
  graph: NavGraph,
  from: LatLon,
  to: LatLon,
  options: RouteOptions = {},
): Route | null {
  const { walkSpeed = 1.35, maxVisited = 200_000 } = options;

  const start = graph.nearestNode(from);
  const goal = graph.nearestNode(to);
  if (!start || !goal) return null;
  if (start.id === goal.id) {
    return {
      points: [from, to],
      highways: [null, null],
      distance: distance(from, to),
      duration: distance(from, to) / walkSpeed,
      visited: 0,
    };
  }

  const cameFrom = new Map<number, number>();
  /** Krawędź, którą dotarliśmy do danego węzła — do odczytu typu drogi. */
  const cameFromEdge = new Map<number, number>();
  const gScore = new Map<number, number>([[start.id, 0]]);
  const open = new MinHeap();
  open.push(start.id, heuristic(start, goal));

  const closed = new Set<number>();
  let visited = 0;

  while (!open.isEmpty()) {
    const current = open.pop();
    if (current === null) break;
    if (closed.has(current)) continue;
    closed.add(current);
    visited++;

    if (current === goal.id) {
      return buildRoute(
        graph,
        cameFrom,
        cameFromEdge,
        current,
        from,
        to,
        walkSpeed,
        visited,
      );
    }
    if (visited > maxVisited) return null;

    const node = graph.nodes.get(current);
    if (!node) continue;
    const currentG = gScore.get(current) ?? Infinity;

    for (const edgeIndex of node.edges) {
      const edge = graph.edges[edgeIndex];
      // Krawędzie są nieskierowane — sąsiadem jest ten koniec, którym
      // nie jesteśmy my.
      const neighborId = edge.a === current ? edge.b : edge.a;
      if (closed.has(neighborId)) continue;

      const neighbor = graph.nodes.get(neighborId);
      if (!neighbor) continue;

      const tentative = currentG + edge.cost;
      if (tentative >= (gScore.get(neighborId) ?? Infinity)) continue;

      cameFrom.set(neighborId, current);
      cameFromEdge.set(neighborId, edgeIndex);
      gScore.set(neighborId, tentative);
      open.push(neighborId, tentative + heuristic(neighbor, goal));
    }
  }

  return null;
}

function heuristic(node: GraphNode, goal: GraphNode): number {
  return distance(node, goal) * MIN_COST_FACTOR;
}

function buildRoute(
  graph: NavGraph,
  cameFrom: Map<number, number>,
  cameFromEdge: Map<number, number>,
  goalId: number,
  from: LatLon,
  to: LatLon,
  walkSpeed: number,
  visited: number,
): Route {
  const ids: number[] = [goalId];
  let current = goalId;
  while (cameFrom.has(current)) {
    current = cameFrom.get(current)!;
    ids.push(current);
  }
  ids.reverse();

  // Dopinamy rzeczywisty start i cel, bo trasa w grafie zaczyna się
  // i kończy na przyciągniętych węzłach, a nie w tych punktach.
  const points: LatLon[] = [from];
  const highways: (string | null)[] = [null];

  for (const id of ids) {
    const node = graph.nodes.get(id);
    if (!node) continue;
    points.push({ lat: node.lat, lon: node.lon });

    const edgeIndex = cameFromEdge.get(id);
    highways.push(edgeIndex !== undefined ? graph.edges[edgeIndex].highway : null);
  }

  points.push(to);
  highways.push(highways[highways.length - 1] ?? null);

  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }

  return { points, highways, distance: total, duration: total / walkSpeed, visited };
}

/**
 * Kopiec minimalny na parach (węzeł, priorytet).
 *
 * A* bez kolejki priorytetowej działa w czasie kwadratowym względem liczby
 * węzłów. Graf dla obszaru operacji ma ich dziesiątki tysięcy, więc liniowe
 * szukanie minimum zamieniłoby trasę liczoną w milisekundach na sekundy.
 */
class MinHeap {
  private ids: number[] = [];
  private priorities: number[] = [];

  isEmpty(): boolean {
    return this.ids.length === 0;
  }

  push(id: number, priority: number): void {
    this.ids.push(id);
    this.priorities.push(priority);

    let i = this.ids.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.priorities[parent] <= this.priorities[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number | null {
    if (this.ids.length === 0) return null;
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastPriority = this.priorities.pop()!;

    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.priorities[0] = lastPriority;

      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.ids.length && this.priorities[left] < this.priorities[smallest]) smallest = left;
        if (right < this.ids.length && this.priorities[right] < this.priorities[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }

    return top;
  }

  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
  }
}
