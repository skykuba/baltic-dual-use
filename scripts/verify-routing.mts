/**
 * Weryfikacja routingu A*.
 *
 * Najważniejszy test: czy A* znajduje trasę o TAKIM SAMYM koszcie jak
 * Dijkstra. Niedopuszczalna heurystyka (przeszacowująca koszt) daje trasy
 * gorsze od optymalnej, a błąd tego rodzaju jest niewidoczny gołym okiem —
 * trasa wygląda sensownie, tylko jest dłuższa, niż musi.
 */
import { NavGraph } from "@/lib/osm/graph";
import { findRoute } from "@/lib/osm/router";
import { buildPath, sampleAt, scenarioFromRoute, terrainForHighway } from "@/lib/sim/scenario";
import { distance } from "@/lib/geo/projection";
import type { OverpassElement } from "@/lib/osm/overpass";
import type { LatLon } from "@/lib/geo/types";

const O = { lat: 54.4103, lon: 18.5613 };
const STEP_LAT = 0.0009;
const STEP_LON = 0.00155;
const N = 20;

const nid = (r: number, c: number) => 1 + r * N + c;
const coord = (r: number, c: number): LatLon => ({
  lat: O.lat + r * STEP_LAT,
  lon: O.lon + c * STEP_LON,
});

function gridElements(): OverpassElement[] {
  const elements: OverpassElement[] = [];
  let wayId = 1_000_000;

  for (let r = 0; r < N; r++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: N }, (_, c) => nid(r, c)),
      geometry: Array.from({ length: N }, (_, c) => coord(r, c)),
      tags: { highway: "residential" },
    });
  }
  for (let c = 0; c < N; c++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: N }, (_, r) => nid(r, c)),
      geometry: Array.from({ length: N }, (_, r) => coord(r, c)),
      // Co trzecia ulica jako ścieżka dla pieszych — tańsza, więc routing
      // powinien ją preferować. To sprawdza, czy koszty w ogóle działają.
      tags: { highway: c % 3 === 0 ? "footway" : "residential" },
    });
  }
  return elements;
}

/** Referencja: Dijkstra bez heurystyki. */
function dijkstra(graph: NavGraph, startId: number, goalId: number): number {
  const dist = new Map<number, number>([[startId, 0]]);
  const visited = new Set<number>();

  for (;;) {
    let current: number | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!visited.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === null) return Infinity;
    if (current === goalId) return best;
    visited.add(current);

    const node = graph.nodes.get(current);
    if (!node) continue;
    for (const edgeIndex of node.edges) {
      const edge = graph.edges[edgeIndex];
      const next = edge.a === current ? edge.b : edge.a;
      if (visited.has(next)) continue;
      const candidate = best + edge.cost;
      if (candidate < (dist.get(next) ?? Infinity)) dist.set(next, candidate);
    }
  }
}

/** Koszt trasy zwróconej przez A*, odtworzony z krawędzi grafu. */
function costOfRoutePoints(graph: NavGraph, points: LatLon[]): number {
  let cost = 0;
  // Pomijamy pierwszy i ostatni odcinek — to dopięcia do punktów
  // spoza grafu, których Dijkstra nie widzi.
  for (let i = 2; i < points.length - 1; i++) {
    const a = points[i - 1];
    const b = points[i];
    const edge = graph.edges.find((e) => {
      const na = graph.nodes.get(e.a);
      const nb = graph.nodes.get(e.b);
      if (!na || !nb) return false;
      return (near(na, a) && near(nb, b)) || (near(nb, a) && near(na, b));
    });
    cost += edge ? edge.cost : distance(a, b);
  }
  return cost;
}

function near(a: LatLon, b: LatLon): boolean {
  return Math.abs(a.lat - b.lat) < 1e-9 && Math.abs(a.lon - b.lon) < 1e-9;
}

const graph = NavGraph.fromElements(gridElements());
console.log("═══ Routing A* ═══");
console.log(`  graf: ${graph.size.nodes} węzłów, ${graph.size.edges} krawędzi\n`);

const cases: [number, number, number, number][] = [
  [1, 1, 18, 18],
  [0, 0, 19, 0],
  [5, 2, 5, 17],
  [3, 15, 16, 4],
  [10, 10, 11, 11],
];

let optimal = 0;
let maxExcess = 0;

for (const [r1, c1, r2, c2] of cases) {
  const from = coord(r1, c1);
  const to = coord(r2, c2);
  const route = findRoute(graph, from, to);

  if (!route) {
    console.log(`  ${r1},${c1} → ${r2},${c2}:  BRAK TRASY`);
    continue;
  }

  const reference = dijkstra(graph, nid(r1, c1), nid(r2, c2));
  const astarCost = costOfRoutePoints(graph, route.points);
  const excess = ((astarCost - reference) / reference) * 100;
  maxExcess = Math.max(maxExcess, excess);
  if (excess < 0.001) optimal++;

  const straight = distance(from, to);
  console.log(
    `  ${`${r1},${c1}`.padStart(6)} → ${`${r2},${c2}`.padEnd(6)}` +
      ` dł. ${route.distance.toFixed(0).padStart(5)} m` +
      ` | prosta ${straight.toFixed(0).padStart(5)} m` +
      ` | ${route.points.length.toString().padStart(3)} pkt` +
      ` | odwiedzone ${route.visited.toString().padStart(4)}` +
      ` | vs Dijkstra ${excess < 0.001 ? "optymalna" : `+${excess.toFixed(2)}%`}`,
  );
}

console.log(`\n  trasy optymalne: ${optimal}/${cases.length}`);
console.log(`  największa nadwyżka nad Dijkstrą: ${maxExcess.toFixed(3)}%`);

// Wydajność — routing ma być natychmiastowy z punktu widzenia interfejsu.
const t0 = performance.now();
for (let i = 0; i < 50; i++) findRoute(graph, coord(0, 0), coord(19, 19));
const ms = (performance.now() - t0) / 50;
console.log(`\n  czas wyznaczenia trasy przez cały graf: ${ms.toFixed(1)} ms`);

// ── Trasa jako trajektoria symulowanego marszu ──────────────────────────
console.log("\n═══ Trasa jako nowa trajektoria pieszego ═══");

const walkRoute = findRoute(graph, coord(1, 1), coord(15, 12));
let walkOk = false;

if (!walkRoute) {
  console.log("  ✗ nie znaleziono trasy");
} else {
  const tagged = walkRoute.highways.filter((h) => h !== null).length;
  console.log(`  punktów: ${walkRoute.points.length}, z typem drogi: ${tagged}`);

  // Typ drogi musi trafić do rodzaju terenu — inaczej każda trasa byłaby
  // traktowana jak zabudowa i szum czujników byłby zawsze ten sam.
  const scenario = scenarioFromRoute(walkRoute.points, walkRoute.highways, 1.35);
  const terrains = new Set(scenario.waypoints.map((w) => w.terrain));
  console.log(`  rodzaje terenu na trasie: ${[...terrains].join(", ")}`);

  const path = buildPath(scenario);
  const midpoint = sampleAt(path, path.totalLength / 2);
  const endpoint = sampleAt(path, path.totalLength);

  const lengthMatches = Math.abs(path.totalLength - walkRoute.distance) < 1;
  const endMatches = distance(endpoint.position, coord(15, 12)) < 1;

  console.log(`  ${lengthMatches ? "✓" : "✗"} długość trajektorii zgodna z trasą (${path.totalLength.toFixed(0)} m)`);
  console.log(`  ${endMatches ? "✓" : "✗"} trajektoria kończy się w celu`);
  console.log(`  ${endpoint.finished ? "✓" : "✗"} koniec trasy oznaczony jako zakończony`);
  console.log(`  ${!midpoint.finished ? "✓" : "✗"} połowa trasy nieoznaczona jako koniec`);

  walkOk = lengthMatches && endMatches && endpoint.finished && !midpoint.finished;
}

console.log("\n═══ Odwzorowanie typu drogi na teren ═══");
const terrainCases: [string | null, string][] = [
  ["footway", "urban"],
  ["residential", "urban"],
  ["path", "forest"],
  ["track", "forest"],
  [null, "open"],
  ["unknown_type", "open"],
];
let terrainOk = true;
for (const [highway, expected] of terrainCases) {
  const actual = terrainForHighway(highway);
  const pass = actual === expected;
  if (!pass) terrainOk = false;
  console.log(`  ${pass ? "✓" : "✗"} ${String(highway).padEnd(14)} → ${actual}`);
}

const ok = maxExcess < 0.01 && optimal === cases.length && walkOk && terrainOk;
console.log(
  ok
    ? "\n✓ Heurystyka dopuszczalna, trasy optymalne"
    : "\n✗ Heurystyka przeszacowuje — trasy nieoptymalne",
);
process.exit(ok ? 0 : 1);
