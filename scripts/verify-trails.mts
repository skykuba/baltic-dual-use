/**
 * Weryfikacja logiki śladów na mapie.
 *
 * Ślad wygląda niewinnie, ale ma trzy pułapki, z których każda daje na mapie
 * artefakt wyglądający jak błąd algorytmu, a nie rysowania:
 *   1. duplikaty — GNSS przychodzi 1 Hz, ticki 10 Hz, więc ta sama pozycja
 *      trafiałaby do bufora wielokrotnie i zjadała jego pojemność,
 *   2. skok po korekcji ręcznej — połączony linią rysuje przez mapę odcinek,
 *      którego nikt nie przeszedł,
 *   3. przerwa w GNSS — sklejona z resztą sugeruje, że sygnał był cały czas.
 */
import { useSimStore } from "@/lib/store";
import type { SimTick } from "@/lib/types";

const START = { lat: 54.4103, lon: 18.5613 };
const M_PER_DEG_LAT = 111_320;

function tickAt(
  seq: number,
  offsetNorthM: number,
  options: { gnss?: boolean; estimateOffsetM?: number } = {},
): SimTick {
  const { gnss = true, estimateOffsetM = offsetNorthM } = options;
  const truthLat = START.lat + offsetNorthM / M_PER_DEG_LAT;
  const estLat = START.lat + estimateOffsetM / M_PER_DEG_LAT;

  return {
    t: seq * 100,
    seq,
    imu: { accel: [0, 0, 9.81], gyro: [0, 0, 0], mag: [18, 0, 45] },
    gnss: gnss
      ? { lat: truthLat, lon: START.lon, accuracy: 5, satellites: 8 }
      : null,
    truth: { lat: truthLat, lon: START.lon },
    terrain: "urban",
    estimate: {
      lat: estLat,
      lon: START.lon,
      source: gnss ? "gnss" : "pdr",
      uncertainty: 5,
      heading: 0,
      steps: seq,
      errorVsTruth: Math.abs(estimateOffsetM - offsetNorthM),
      distanceSinceGnssLoss: gnss ? 0 : offsetNorthM,
    },
    particles: [],
  };
}

const { pushTick } = useSimStore.getState();
const pointCount = (trail: [number, number][][]) =>
  trail.reduce((sum, segment) => sum + segment.length, 0);

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label.padEnd(52)} ${actual} (oczekiwane ${expected})`);
}

// ── 1. Odsiewanie duplikatów ────────────────────────────────────────────
console.log("═══ Duplikaty i punkty zbyt gęste ═══");
useSimStore.setState({ tick: null, truthTrail: [], gnssTrail: [], estimateTrail: [] });

// 20 ticków w tym samym miejscu — tak wygląda GNSS 1 Hz próbkowany 10 Hz.
for (let i = 0; i < 20; i++) pushTick(tickAt(i, 0));
check("20 identycznych pozycji → punktów w śladzie", pointCount(useSimStore.getState().gnssTrail), 1);

// Ruch po 0,5 m: poniżej progu 1,5 m, więc co trzeci punkt ma być zapisany.
useSimStore.setState({ tick: null, truthTrail: [], gnssTrail: [], estimateTrail: [] });
for (let i = 0; i < 30; i++) pushTick(tickAt(i, i * 0.5));
const thinned = pointCount(useSimStore.getState().truthTrail);
check("30 kroków po 0,5 m → punktów (próg 1,5 m)", thinned, 10);

// ── 2. Przerwanie śladu przy korekcji ręcznej ───────────────────────────
console.log("\n═══ Skok estymaty (korekcja ręczna) ═══");
useSimStore.setState({ tick: null, truthTrail: [], gnssTrail: [], estimateTrail: [] });
for (let i = 0; i < 10; i++) pushTick(tickAt(i, i * 2));
check("przed korekcją — odcinków", useSimStore.getState().estimateTrail.length, 1);

// Skok o 82 m: powyżej progu 15 m, więc ma powstać nowy odcinek.
pushTick(tickAt(10, 20, { estimateOffsetM: 100 }));
// Dalej marsz normalnym tempem — przyrosty po 2 m, żeby nie wywoływać
// kolejnych przerwań.
for (let i = 11; i < 20; i++) {
  pushTick(tickAt(i, i * 2, { estimateOffsetM: 100 + (i - 10) * 2 }));
}
check("po korekcji — odcinków", useSimStore.getState().estimateTrail.length, 2);

// ── 3. Przerwa w śladzie GNSS ───────────────────────────────────────────
console.log("\n═══ Utrata i powrót sygnału GNSS ═══");
useSimStore.setState({ tick: null, truthTrail: [], gnssTrail: [], estimateTrail: [] });
for (let i = 0; i < 10; i++) pushTick(tickAt(i, i * 3));
check("z sygnałem — odcinków", useSimStore.getState().gnssTrail.length, 1);

for (let i = 10; i < 20; i++) pushTick(tickAt(i, i * 3, { gnss: false }));
const duringJamming = useSimStore.getState().gnssTrail;
check("podczas zagłuszenia — punktów nie przybywa", pointCount(duringJamming), 10);

for (let i = 20; i < 30; i++) pushTick(tickAt(i, i * 3));
const afterRecovery = useSimStore.getState().gnssTrail.filter((s) => s.length > 0);
check("po powrocie sygnału — rozłącznych odcinków", afterRecovery.length, 2);

// ── 4. Reset symulacji ──────────────────────────────────────────────────
console.log("\n═══ Reset ═══");
pushTick(tickAt(0, 0));
check("cofnięcie seq czyści ślad", pointCount(useSimStore.getState().truthTrail), 1);

// ── 5. Limit bufora ─────────────────────────────────────────────────────
console.log("\n═══ Limit bufora ═══");
useSimStore.setState({ tick: null, truthTrail: [], gnssTrail: [], estimateTrail: [] });
// 4000 punktów odległych o 2 m — wszystkie przechodzą próg, więc limit musi zadziałać.
for (let i = 1; i <= 4000; i++) pushTick(tickAt(i, i * 2));
const capped = pointCount(useSimStore.getState().truthTrail);
check("4000 punktów → bufor przycięty do limitu", capped <= 3000, true);
check("bufor nie jest pusty po przycięciu", capped > 2000, true);

console.log(
  failures === 0
    ? "\n✓ Wszystkie kontrole śladów zaliczone"
    : `\n✗ Nieudane kontrole: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
