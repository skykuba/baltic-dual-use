/**
 * Weryfikacja grafu nawigacyjnego na danych syntetycznych.
 *
 * Kluczowy test to porównanie wyniku z indeksu przestrzennego z wynikiem
 * przeglądu wszystkich krawędzi. Indeks, który gubi najbliższą krawędź,
 * jest gorszy niż brak indeksu: filtr cząsteczkowy dostawałby zawyżone
 * odległości i karał cząstki stojące dokładnie na drodze.
 */
import { NavGraph, pointToSegmentMeters } from "@/lib/osm/graph";
import { Buildings } from "@/lib/osm/buildings";
import { distance } from "@/lib/geo/projection";
import type { OverpassElement } from "@/lib/osm/overpass";
import type { LatLon } from "@/lib/geo/types";

/** Siatka ulic à la Manhattan wokół Oliwy: 12×12 przecznic co ~100 m. */
function syntheticGrid(): OverpassElement[] {
  const originLat = 54.4103;
  const originLon = 18.5613;
  const stepLat = 0.0009;   // ~100 m
  const stepLon = 0.00155;  // ~100 m na tej szerokości
  const count = 12;

  const elements: OverpassElement[] = [];
  let nodeId = 1;
  let wayId = 1_000_000;

  // Węzły mają stabilne identyfikatory, żeby ulice poziome i pionowe
  // dzieliły ten sam węzeł na skrzyżowaniu — inaczej graf byłby rozspójniony.
  const id = (row: number, col: number) => 1 + row * count + col;

  const coord = (row: number, col: number) => ({
    lat: originLat + row * stepLat,
    lon: originLon + col * stepLon,
  });

  for (let row = 0; row < count; row++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: count }, (_, col) => id(row, col)),
      geometry: Array.from({ length: count }, (_, col) => coord(row, col)),
      tags: { highway: "residential" },
    });
  }
  for (let col = 0; col < count; col++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: count }, (_, row) => id(row, col)),
      geometry: Array.from({ length: count }, (_, row) => coord(row, col)),
      tags: { highway: "footway" },
    });
  }

  nodeId += count * count;
  return elements;
}

/** Referencja: przegląd wszystkich krawędzi, bez indeksu. */
function bruteForceDistance(graph: NavGraph, point: LatLon): number {
  let best = Infinity;
  for (const edge of graph.edges) {
    const a = graph.nodes.get(edge.a);
    const b = graph.nodes.get(edge.b);
    if (!a || !b) continue;
    best = Math.min(best, pointToSegmentMeters(point, a, b));
  }
  return best;
}

/**
 * Ta sama siatka, ale w kształcie odpowiedzi `out body; >; out skel qt`:
 * ways niosą wyłącznie identyfikatory węzłów, a współrzędne przychodzą
 * jako osobne elementy typu node.
 */
function asRecurseDown(elements: OverpassElement[]): OverpassElement[] {
  const nodes = new Map<number, OverpassElement>();
  const ways: OverpassElement[] = [];

  for (const element of elements) {
    if (element.type !== "way" || !element.nodes || !element.geometry) continue;

    for (let i = 0; i < element.nodes.length; i++) {
      const id = element.nodes[i];
      if (!nodes.has(id)) {
        nodes.set(id, {
          type: "node",
          id,
          lat: element.geometry[i].lat,
          lon: element.geometry[i].lon,
        });
      }
    }
    // Way bez geometry — dokładnie tak, jak zwraca `out body`.
    ways.push({ type: "way", id: element.id, nodes: element.nodes, tags: element.tags });
  }

  // Overpass wypisuje ways przed węzłami, więc zachowujemy tę kolejność:
  // parser nie ma prawa zakładać, że węzły przyjdą pierwsze.
  return [...ways, ...nodes.values()];
}

const graph = NavGraph.fromElements(syntheticGrid());

console.log("═══ Graf nawigacyjny ═══");
console.log(`  węzły: ${graph.size.nodes}  (oczekiwane 144)`);
console.log(`  krawędzie: ${graph.size.edges}  (oczekiwane 264)`);

// Deterministyczne próbkowanie w obrębie siatki.
let seed = 12345;
const rand = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};

let maxDiff = 0;
let mismatches = 0;
const samples = 4000;
for (let i = 0; i < samples; i++) {
  const point: LatLon = {
    lat: 54.4103 + rand() * 0.0009 * 11,
    lon: 18.5613 + rand() * 0.00155 * 11,
  };
  const indexed = graph.distanceToNearestWay(point);
  const brute = bruteForceDistance(graph, point);
  const diff = Math.abs(indexed - brute);
  maxDiff = Math.max(maxDiff, diff);
  if (diff > 0.01) mismatches++;
}

console.log("\n═══ Indeks przestrzenny vs przegląd zupełny ═══");
console.log(`  próbek: ${samples}`);
console.log(`  rozbieżności > 1 cm: ${mismatches}`);
console.log(`  maksymalna rozbieżność: ${maxDiff.toFixed(4)} m`);

console.log("\n═══ Kontrole zdroworozsądkowe ═══");
const onStreet: LatLon = { lat: 54.4103, lon: 18.5613 + 0.00155 * 2.5 };
console.log(`  punkt na ulicy:        ${graph.distanceToNearestWay(onStreet).toFixed(2)} m  (oczekiwane ~0)`);

const midBlock: LatLon = {
  lat: 54.4103 + 0.0009 * 2.5,
  lon: 18.5613 + 0.00155 * 2.5,
};
console.log(`  środek kwartału:       ${graph.distanceToNearestWay(midBlock).toFixed(1)} m  (oczekiwane ~50)`);

const far: LatLon = { lat: 54.3800, lon: 18.5000 };
const farDistance = graph.distanceToNearestWay(far);
console.log(`  daleko poza siatką:    ${Number.isFinite(farDistance) ? farDistance.toFixed(0) + " m" : "Infinity"}  (oczekiwane Infinity lub duża wartość)`);

const node = graph.nearestNode(midBlock);
console.log(`  najbliższy węzeł:      ${node ? distance(midBlock, node).toFixed(1) + " m" : "brak"}  (oczekiwane ~70)`);

// ── Równoważność obu kształtów odpowiedzi Overpassa ─────────────────────
console.log("\n═══ out geom vs out body + recurse down ═══");

const recurseGraph = NavGraph.fromElements(asRecurseDown(syntheticGrid()));
const sameNodes = recurseGraph.size.nodes === graph.size.nodes;
const sameEdges = recurseGraph.size.edges === graph.size.edges;

console.log(`  ${sameNodes ? "✓" : "✗"} węzły:     ${recurseGraph.size.nodes} vs ${graph.size.nodes}`);
console.log(`  ${sameEdges ? "✓" : "✗"} krawędzie: ${recurseGraph.size.edges} vs ${graph.size.edges}`);

// Geometria też musi się zgadzać, nie tylko liczności.
let geometryDiff = 0;
for (let i = 0; i < 500; i++) {
  const point: LatLon = {
    lat: 54.4103 + ((i * 37) % 100) / 100 * 0.0009 * 11,
    lon: 18.5613 + ((i * 53) % 100) / 100 * 0.00155 * 11,
  };
  const a = graph.distanceToNearestWay(point);
  const b = recurseGraph.distanceToNearestWay(point);
  if (Math.abs(a - b) > 0.01) geometryDiff++;
}
console.log(`  ${geometryDiff === 0 ? "✓" : "✗"} geometria: ${geometryDiff} rozbieżności na 500 próbek`);

// Budynki: obrys jako way + osobne węzły.
const buildingWay: OverpassElement[] = [
  { type: "way", id: 9001, nodes: [901, 902, 903, 904, 901], tags: { building: "yes" } },
  { type: "node", id: 901, lat: 54.4103, lon: 18.5613 },
  { type: "node", id: 902, lat: 54.4103, lon: 18.5620 },
  { type: "node", id: 903, lat: 54.4110, lon: 18.5620 },
  { type: "node", id: 904, lat: 54.4110, lon: 18.5613 },
];
const buildings = Buildings.fromElements(buildingWay);
const inside = buildings.contains({ lat: 54.41065, lon: 18.56165 });
const outside = buildings.contains({ lat: 54.4130, lon: 18.5650 });
console.log(`  ${buildings.count === 1 ? "✓" : "✗"} budynki z osobnych węzłów: ${buildings.count}`);
console.log(`  ${inside ? "✓" : "✗"} punkt wewnątrz rozpoznany`);
console.log(`  ${!outside ? "✓" : "✗"} punkt na zewnątrz odrzucony`);

const shapesMatch =
  sameNodes && sameEdges && geometryDiff === 0 &&
  buildings.count === 1 && inside && !outside;

const failed =
  mismatches > 0 || graph.size.nodes !== 144 || graph.size.edges !== 264 || !shapesMatch;
console.log(`\n${failed ? "✗ WERYFIKACJA NIEUDANA" : "✓ Weryfikacja zaliczona"}`);
process.exit(failed ? 1 : 0);
