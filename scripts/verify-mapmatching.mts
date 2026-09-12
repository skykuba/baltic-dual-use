/**
 * Czy ograniczenie mapowe naprawdę redukuje błąd?
 *
 * Porównanie na tym samym strumieniu danych z czujników:
 *   A) czyste całkowanie PDR,
 *   B) filtr cząsteczkowy z ograniczeniem geometrią dróg.
 *
 * Trasa prawdziwa biegnie ulicami syntetycznej siatki, czyli dokładnie tam,
 * gdzie ograniczenie mapowe ma prawo pomagać. To jest test tezy projektu,
 * więc jeśli B nie wygrywa z A, teza jest fałszywa i trzeba to wiedzieć.
 */
import { NavGraph } from "@/lib/osm/graph";
import { ParticleFilter } from "@/lib/fusion/particleFilter";
import { PdrEngine } from "@/lib/pdr/pdr";
import { initGait, stepGait } from "@/lib/sim/gait";
import { driftImu, initImu, synthImu } from "@/lib/sim/imu";
import { Rng } from "@/lib/sim/random";
import { angleDiff, distance, fromEnu } from "@/lib/geo/projection";
import type { OverpassElement } from "@/lib/osm/overpass";
import type { LatLon } from "@/lib/geo/types";

const ORIGIN = { lat: 54.4103, lon: 18.5613 };
const STEP_LAT = 0.0009;
const STEP_LON = 0.00155;
const GRID = 14;
const SAMPLE_RATE = 50;
const DT = 1 / SAMPLE_RATE;
const WALK_SPEED = 1.35;

const nodeId = (row: number, col: number) => 1 + row * GRID + col;
const coord = (row: number, col: number): LatLon => ({
  lat: ORIGIN.lat + row * STEP_LAT,
  lon: ORIGIN.lon + col * STEP_LON,
});

function gridElements(): OverpassElement[] {
  const elements: OverpassElement[] = [];
  let wayId = 1_000_000;

  for (let row = 0; row < GRID; row++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: GRID }, (_, col) => nodeId(row, col)),
      geometry: Array.from({ length: GRID }, (_, col) => coord(row, col)),
      tags: { highway: "residential" },
    });
  }
  for (let col = 0; col < GRID; col++) {
    elements.push({
      type: "way",
      id: wayId++,
      nodes: Array.from({ length: GRID }, (_, row) => nodeId(row, col)),
      geometry: Array.from({ length: GRID }, (_, row) => coord(row, col)),
      tags: { highway: "residential" },
    });
  }
  return elements;
}

/**
 * Trasa realistyczna: głównie ulicami, z jednym przejściem przez park.
 *
 * Tak wygląda typowy marsz przez miasto — sieć dróg obowiązuje przez
 * większość czasu, ale nie zawsze. To jest przypadek, pod który system
 * ma być strojony, a nie żaden z dwóch skrajnych.
 */
function mixedWaypoints(): LatLon[] {
  const points: LatLon[] = [];
  let row = 1;
  let col = 1;
  points.push(coord(row, col));

  // Odcinek ulicami.
  for (let i = 0; i < 3; i++) {
    col += 2;
    points.push(coord(row, col));
    row += 2;
    points.push(coord(row, col));
  }
  // Przecięcie parku na ukos — około 280 m poza siecią dróg.
  row += 2;
  col += 2;
  points.push(coord(row, col));
  // Powrót na ulice.
  for (let i = 0; i < 3; i++) {
    col += 2;
    points.push(coord(row, col));
    row += 2;
    points.push(coord(row, col));
  }
  return points;
}

/**
 * Trasa przecinająca kwartały na ukos, czyli BIEGNĄCA POZA GRAFEM.
 *
 * Test przeciwny do poprzedniego: sprawdza, czy ograniczenie mapowe nie
 * ściąga estymaty na ulicę wtedy, gdy pieszy naprawdę idzie przez park,
 * podwórze albo otwarty teren. Filtr, który tu wygrywa dzięki „przyklejaniu"
 * do dróg, byłby oszustwem — a w realnym użyciu prowadziłby żołnierza
 * w złe miejsce.
 */
function offRoadWaypoints(): LatLon[] {
  const points: LatLon[] = [];
  let row = 1;
  let col = 1;
  points.push(coord(row, col));
  // Przekątne przez środki kwartałów — nigdy wzdłuż ulicy.
  for (let i = 0; i < 5; i++) {
    row += 2.2;
    col += 1.7;
    points.push(coord(row, col));
    row += 0.6;
    col += 2.3;
    points.push(coord(row, col));
  }
  return points;
}

/** Trasa schodkowa ulicami siatki — realistyczny marsz przez miasto. */
function routeWaypoints(): LatLon[] {
  const points: LatLon[] = [];
  let row = 1;
  let col = 1;
  points.push(coord(row, col));
  for (let i = 0; i < 6; i++) {
    col += 2;
    points.push(coord(row, col));
    row += 2;
    points.push(coord(row, col));
  }
  return points;
}

type Leg = { from: LatLon; to: LatLon; heading: number; length: number };

function buildLegs(points: LatLon[]): Leg[] {
  const legs: Leg[] = [];
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const latScale = Math.cos((from.lat * Math.PI) / 180);
    const heading =
      ((Math.atan2((to.lon - from.lon) * latScale, to.lat - from.lat) * 180) /
        Math.PI +
        360) %
      360;
    legs.push({ from, to, heading, length: distance(from, to) });
  }
  return legs;
}

function positionAt(legs: Leg[], s: number): { point: LatLon; heading: number } {
  let remaining = s;
  for (const leg of legs) {
    if (remaining <= leg.length) {
      const t = leg.length > 0 ? remaining / leg.length : 0;
      return {
        point: {
          lat: leg.from.lat + (leg.to.lat - leg.from.lat) * t,
          lon: leg.from.lon + (leg.to.lon - leg.from.lon) * t,
        },
        heading: leg.heading,
      };
    }
    remaining -= leg.length;
  }
  const last = legs[legs.length - 1];
  return { point: last.to, heading: last.heading };
}

type Mode = "road" | "mixed" | "offroad";

function run(seed: number, mode: Mode = "road") {
  const graph = NavGraph.fromElements(gridElements());
  const waypoints =
    mode === "road"
      ? routeWaypoints()
      : mode === "mixed"
        ? mixedWaypoints()
        : offRoadWaypoints();
  const legs = buildLegs(waypoints);
  const total = legs.reduce((a, l) => a + l.length, 0);

  const rng = new Rng(seed);
  let gait = initGait(WALK_SPEED, rng);
  let imuState = initImu(rng);

  const startState = positionAt(legs, 0);
  const pdr = new PdrEngine(SAMPLE_RATE, startState.heading);

  // A) czyste całkowanie
  let deadReckoned: LatLon = { ...startState.point };

  // B) filtr cząsteczkowy z mapą
  const filter = new ParticleFilter({ seed: seed ^ 0xabcd });
  filter.initialize(startState.point, 5);

  let s = 0;
  let t = 0;

  while (s < total) {
    const truth = positionAt(legs, s);
    const ahead = positionAt(legs, Math.min(s + 1, total));
    const turnRate = angleDiff(ahead.heading, truth.heading) * WALK_SPEED;

    gait = stepGait(gait, WALK_SPEED, DT, rng);
    imuState = driftImu(imuState, "urban", DT, rng);

    const imu = synthImu({
      gait,
      heading: truth.heading,
      turnRate,
      terrain: "urban",
      state: imuState,
      rng,
    });

    const displacement = pdr.push(imu, t, DT);
    if (displacement) {
      const rad = (displacement.heading * Math.PI) / 180;
      deadReckoned = fromEnu(deadReckoned, {
        e: Math.sin(rad) * displacement.length,
        n: Math.cos(rad) * displacement.length,
      });
      filter.step(displacement.length, displacement.heading, graph, null);
    }

    s += WALK_SPEED * DT;
    t += DT;
  }

  const truthEnd = positionAt(legs, total).point;
  const filtered = filter.estimate();

  return {
    total,
    pdrError: distance(deadReckoned, truthEnd),
    pfError: distance(filtered.position, truthEnd),
    spread: filtered.spread,
  };
}

const seeds = [1, 7, 42, 99, 1337, 2024, 31337, 5150];
const runs = seeds.map((seed) => run(seed));
const avg = (f: (r: (typeof runs)[0]) => number) =>
  runs.reduce((a, r) => a + f(r), 0) / runs.length;

console.log("═══ Map matching vs czysty PDR ═══");
console.log(`  trasa: ${runs[0].total.toFixed(0)} m ulicami siatki, ${seeds.length} ziaren\n`);
console.log(`  ${"ziarno".padStart(8)} ${"PDR [m]".padStart(10)} ${"PDR+mapa [m]".padStart(14)} ${"poprawa".padStart(9)}`);
for (let i = 0; i < runs.length; i++) {
  const r = runs[i];
  const gain = ((r.pdrError - r.pfError) / r.pdrError) * 100;
  console.log(
    `  ${String(seeds[i]).padStart(8)} ${r.pdrError.toFixed(1).padStart(10)} ${r.pfError.toFixed(1).padStart(14)} ${(gain >= 0 ? "+" : "") + gain.toFixed(0) + "%"}`.padEnd(2),
  );
}

const pdrAvg = avg((r) => r.pdrError);
const pfAvg = avg((r) => r.pfError);
console.log(`\n  ŚREDNIA        ${pdrAvg.toFixed(1).padStart(10)} ${pfAvg.toFixed(1).padStart(14)} ${(((pdrAvg - pfAvg) / pdrAvg) * 100).toFixed(0)}%`);
console.log(`\n  jako % przebytej drogi:  PDR ${((pdrAvg / runs[0].total) * 100).toFixed(2)}%  →  PDR+mapa ${((pfAvg / runs[0].total) * 100).toFixed(2)}%`);
console.log(`  rozrzut chmury cząstek: ${avg((r) => r.spread).toFixed(1)} m`);

const wins = runs.filter((r) => r.pfError < r.pdrError).length;
console.log(`\n  filtr wygrał w ${wins}/${runs.length} przebiegach`);


// ── Test przeciwny: marsz poza siecią dróg ────────────────────────────
const offRoadRuns = seeds.map((seed) => run(seed, "offroad"));
const offAvg = (f: (r: (typeof offRoadRuns)[0]) => number) =>
  offRoadRuns.reduce((a, r) => a + f(r), 0) / offRoadRuns.length;

const offPdr = offAvg((r) => r.pdrError);
const offPf = offAvg((r) => r.pfError);
const offWins = offRoadRuns.filter((r) => r.pfError < r.pdrError).length;

console.log("\n═══ Przypadek przeciwny: marsz POZA drogami ═══");
console.log(`  trasa: ${offRoadRuns[0].total.toFixed(0)} m przekątnymi przez kwartały\n`);
console.log(`  PDR          ${offPdr.toFixed(1).padStart(8)} m   (${((offPdr / offRoadRuns[0].total) * 100).toFixed(2)}% drogi)`);
console.log(`  PDR + mapa   ${offPf.toFixed(1).padStart(8)} m   (${((offPf / offRoadRuns[0].total) * 100).toFixed(2)}% drogi)`);
console.log(`  filtr wygrał w ${offWins}/${offRoadRuns.length} przebiegach`);
console.log(
  offPf < offPdr * 1.5
    ? "\n  → Ograniczenie mapowe nie szkodzi poza drogami."
    : "\n  → UWAGA: mapa ściąga estymatę na ulice, choć pieszy tam nie idzie.",
);


// ── Przypadek realistyczny: ulice + przejście przez park ──────────────
const mixedRuns = seeds.map((seed) => run(seed, "mixed"));
const mixAvg = (f: (r: (typeof mixedRuns)[0]) => number) =>
  mixedRuns.reduce((a, r) => a + f(r), 0) / mixedRuns.length;

const mixPdr = mixAvg((r) => r.pdrError);
const mixPf = mixAvg((r) => r.pfError);
const mixWins = mixedRuns.filter((r) => r.pfError < r.pdrError).length;

console.log("\n═══ Przypadek realistyczny: ulice + przejście przez park ═══");
console.log(`  trasa: ${mixedRuns[0].total.toFixed(0)} m, w tym ~280 m poza siecią dróg\n`);
console.log(`  PDR          ${mixPdr.toFixed(1).padStart(8)} m   (${((mixPdr / mixedRuns[0].total) * 100).toFixed(2)}% drogi)`);
console.log(`  PDR + mapa   ${mixPf.toFixed(1).padStart(8)} m   (${((mixPf / mixedRuns[0].total) * 100).toFixed(2)}% drogi)`);
console.log(`  filtr wygrał w ${mixWins}/${mixedRuns.length} przebiegach`);
