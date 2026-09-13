/**
 * Weryfikacja drogi „prawdziwy telefon → estymator".
 *
 * Dwie rzeczy, z których każda potrafi zepsuć wszystko po cichu:
 *
 *   1. ADAPTER. Przeglądarka podaje prędkość kątową w STOPNIACH na sekundę,
 *      a osie w kolejności Z, X, Y. Nasz estymator chce radianów w kolejności
 *      X, Y, Z. Pomyłka w którymkolwiek z tych miejsc nie rzuca wyjątkiem —
 *      daje kurs obracający się 57 razy za szybko albo lustrzany, co wygląda
 *      jak zepsuty algorytm, a jest pomyłką jednostek.
 *
 *   2. JAKOŚĆ KOMPASU. Telefon nie udostępnia surowego magnetometru, tylko
 *      gotowy kurs zfuzowany przez system. Nie wiemy z góry, jak dobry on jest
 *      na konkretnym urządzeniu — ale możemy zmierzyć, jak dobry MUSI być,
 *      żeby system trzymał założoną dokładność. To jest wymaganie, które
 *      da się potem sprawdzić na fizycznym telefonie jednym pomiarem.
 */
import { PdrEngine } from "@/lib/pdr/pdr";
import { compassHeading, toImuSample } from "@/lib/sensors/deviceMotion";
import { initGait, stepGait } from "@/lib/sim/gait";
import { driftImu, initImu, synthImu } from "@/lib/sim/imu";
import { Rng } from "@/lib/sim/random";
import { angleDiff, distance, fromEnu, normalizeDeg } from "@/lib/geo/projection";
import { buildPath, getScenario, sampleAt } from "@/lib/sim/scenario";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(50)} ${actual} (oczekiwane ${expected})`,
  );
}

// ─── 1. Adapter zdarzeń przeglądarki ────────────────────────────────────
console.log("═══ Adapter DeviceMotion ═══\n");

const sample = toImuSample({
  accelerationIncludingGravity: { x: 0.5, y: -0.25, z: 9.81 },
  // 180 °/s wokół osi pionowej — pół obrotu na sekundę.
  rotationRate: { alpha: 180, beta: 90, gamma: -45 },
});

check("próbka powstała", sample !== null, true);
check("accel przepisane bez zmian (x)", sample?.accel[0], 0.5);
check("accel przepisane bez zmian (z)", sample?.accel[2], 9.81);
check(
  "gyro Z z alpha, w radianach",
  sample ? Number(sample.gyro[2].toFixed(6)) : null,
  Number(Math.PI.toFixed(6)),
);
check(
  "gyro X z beta, w radianach",
  sample ? Number(sample.gyro[0].toFixed(6)) : null,
  Number((Math.PI / 2).toFixed(6)),
);
check(
  "gyro Y z gamma, w radianach",
  sample ? Number(sample.gyro[1].toFixed(6)) : null,
  Number((-Math.PI / 4).toFixed(6)),
);

check(
  "brak żyroskopu → próbka odrzucona, nie wyzerowana",
  toImuSample({
    accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
    rotationRate: null,
  }),
  null,
);
check(
  "brak akcelerometru → próbka odrzucona",
  toImuSample({
    accelerationIncludingGravity: null,
    rotationRate: { alpha: 0, beta: 0, gamma: 0 },
  }),
  null,
);

console.log("\n═══ Kurs kompasowy ═══\n");

check(
  "iOS: webkitCompassHeading brany wprost",
  compassHeading({ alpha: 123, webkitCompassHeading: 90 }),
  90,
);
check(
  "Android: alpha odbite, bo rośnie przeciwnie",
  compassHeading({ alpha: 90, absolute: true }),
  270,
);
check(
  "Android: północ zostaje północą",
  compassHeading({ alpha: 0, absolute: true }),
  0,
);
check(
  "kurs względny (absolute: false) odrzucony",
  compassHeading({ alpha: 90, absolute: false }),
  null,
);
check("brak alpha odrzucony", compassHeading({ alpha: null }), null);

// Kurs lustrzany to najbardziej podstępny błąd tej warstwy: wszystko działa,
// tylko pieszy idzie w przeciwną stronę. Sprawdzamy wprost na wschodzie.
check(
  "wschód po odbiciu to wschód, nie zachód",
  compassHeading({ alpha: 270, absolute: true }),
  90,
);

// ─── 2. Jakość kompasu a błąd pozycji ───────────────────────────────────
console.log("\n═══ Jakiego kompasu potrzebujemy ═══\n");

const SAMPLE_RATE = 50;
const DT = 1 / SAMPLE_RATE;

/**
 * Przebieg PDR, w którym kurs pochodzi z KOMPASU o zadanej jakości.
 *
 * Błąd kompasu modelujemy jako proces skorelowany w czasie (AR(1)), a nie
 * biały szum. To istotne: biały szum uśrednia się do zera i prawie nie szkodzi,
 * a realne zaburzenie magnetyczne — stalowa konstrukcja, pojazd, szyna —
 * utrzymuje się dziesiątki sekund i właśnie dlatego przekłada się na dryf.
 */
function run(scenarioId: string, compassSigmaDeg: number, seed: number) {
  const path = buildPath(getScenario(scenarioId));
  const rng = new Rng(seed);
  let gait = initGait(path.scenario.walkSpeed, rng);
  let imuState = initImu(rng);

  const start = sampleAt(path, 0);
  const pdr = new PdrEngine(SAMPLE_RATE, start.heading);

  let position = { ...start.position };
  let s = 0;
  let t = 0;
  let compassError = 0;
  // Stała czasowa zaburzenia 25 s — tyle co w symulatorze magnetometru.
  const decay = Math.exp(-DT / 25);
  const drive = Math.sqrt(1 - decay * decay);

  while (s < path.totalLength) {
    const truth = sampleAt(path, s);
    const ahead = sampleAt(path, Math.min(s + 1, path.totalLength));
    const turnRate = angleDiff(ahead.heading, truth.heading) * path.scenario.walkSpeed;

    gait = stepGait(gait, path.scenario.walkSpeed, DT, rng);
    imuState = driftImu(imuState, truth.terrain, DT, rng);

    const imu = synthImu({
      gait,
      heading: truth.heading,
      turnRate,
      terrain: truth.terrain,
      state: imuState,
      rng,
    });

    compassError = compassError * decay + drive * compassSigmaDeg * rng.gauss();
    const compass = normalizeDeg(truth.heading + compassError);

    // Tu wchodzi droga telefonu: kurs z kompasu zamiast surowego magnetometru.
    const step = pdr.pushWithCompass(imu, compass, t, DT);

    if (step) {
      const rad = (step.heading * Math.PI) / 180;
      position = fromEnu(position, {
        e: Math.sin(rad) * step.length,
        n: Math.cos(rad) * step.length,
      });
    }

    s += path.scenario.walkSpeed * DT;
    t += DT;
  }

  const truthEnd = sampleAt(path, path.totalLength).position;
  return {
    distance: path.totalLength,
    error: distance(position, truthEnd),
  };
}

const SEEDS = [1, 7, 42, 1337, 5150];
const SCENARIOS: [string, string][] = [
  ["tpk-forest", "las"],
  ["trojmiasto-mixed", "mieszany"],
  ["gdansk-urban", "miasto"],
];

console.log(
  `  ${"błąd kompasu 1σ".padStart(16)} ${SCENARIOS.map(([, n]) => n.padStart(12)).join(" ")}`,
);

const table: Record<number, number[]> = {};
for (const sigma of [2, 5, 10, 20, 30]) {
  const row: number[] = [];
  for (const [id] of SCENARIOS) {
    const errors = SEEDS.map((seed) => run(id, sigma, seed));
    const pct =
      errors.reduce((a, r) => a + (r.error / r.distance) * 100, 0) / errors.length;
    row.push(pct);
  }
  table[sigma] = row;
  console.log(
    `  ${(sigma + "°").padStart(16)} ${row.map((v) => (v.toFixed(2) + "%").padStart(12)).join(" ")}`,
  );
}

console.log(
  "\n  Odniesienie: z symulowanym magnetometrem baseline wynosi\n" +
    "  1,74% (las) · 3,24% (mieszany) · 6,39% (miasto).",
);

// Wymaganie na sprzęt.
//
// Kryterium celowo na ŚREDNIEJ ze scenariuszy, a nie na każdym z osobna:
// pojedynczy scenariusz porównuje kompas z symulowanym magnetometrem o innej
// charakterystyce (6° w lesie, 22° w zabudowie), więc „gorzej niż baseline
// w lesie" i „lepiej niż baseline w mieście" to ta sama liczba widziana
// z dwóch stron. Średnia mówi, czy system jako całość trzyma poziom.
const BASELINE = [1.74, 3.24, 6.39];
const baselineMean = BASELINE.reduce((a, b) => a + b, 0) / BASELINE.length;
const mean = (row: number[]) => row.reduce((a, b) => a + b, 0) / row.length;

const acceptable = Object.entries(table)
  .filter(([, row]) => mean(row) <= baselineMean)
  .map(([sigma]) => Number(sigma));

console.log(
  `\n  WYMAGANIE: kompas o błędzie 1σ do ${Math.max(...acceptable)}° utrzymuje system\n` +
    `  na poziomie baseline (średnia ${baselineMean.toFixed(2)}% przebytej drogi).\n` +
    "  Przy 20° wynik pogarsza się półtorakrotnie, przy 30° system się rozjeżdża.",
);

console.log(
  "\n  UWAGA przy czytaniu tej tabeli: w mieście wychodzi LEPIEJ niż baseline,\n" +
    "  bo baseline korzysta z surowego magnetometru z zaburzeniem 22°, a kompas\n" +
    "  systemowy jest już zfuzowany z żyroskopem. Ale korzysta z TEGO SAMEGO\n" +
    "  magnetometru, więc trwałe zaburzenie od stalowej konstrukcji zobaczy tak\n" +
    "  samo. To jest wymaganie do sprawdzenia, nie prognoza.",
);

console.log(
  "\n  Jak to sprawdzić na telefonie: przejść znaną prostą ulicą, zapisać kurs\n" +
    "  z DeviceOrientationEvent i porównać z azymutem tej ulicy z OSM.\n" +
    "  Odchylenie standardowe różnicy to szukana liczba.",
);

console.log(
  `\n${failures > 0 ? "✗ WERYFIKACJA NIEUDANA" : "✓ Adapter czujników zweryfikowany"}`,
);
process.exit(failures > 0 ? 1 : 0);
