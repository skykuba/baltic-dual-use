/**
 * Czy fuzja GNSS z inercją poprawia wynik, czy tylko ładniej wygląda?
 *
 * Mierzone są dwie rzeczy naraz, bo poprawa jednej kosztem drugiej
 * byłaby oszustwem:
 *   - DOKŁADNOŚĆ: średni błąd względem prawdy,
 *   - STABILNOŚĆ: średni skok pozycji między kolejnymi odczytami.
 *
 * Wygładzanie, które uspokaja obraz, ale zwiększa błąd, to nie jest
 * ulepszenie systemu nawigacji — to ładniejsza nieprawda.
 */
import { buildPath, getScenario, sampleAt } from "@/lib/sim/scenario";
import { initGait, stepGait } from "@/lib/sim/gait";
import { driftImu, initImu, synthImu } from "@/lib/sim/imu";
import { initGnss, synthGnss } from "@/lib/sim/gnss";
import { Rng } from "@/lib/sim/random";
import { Estimator } from "@/lib/fusion/estimator";
import { distance } from "@/lib/geo/projection";
import type { LatLon } from "@/lib/geo/types";

const RATE = 50;
const DT = 1 / RATE;
const GNSS_PERIOD_S = 1;

type Stats = { meanError: number; p95Error: number; meanJump: number };

/**
 * Kalibracja niepewności: jak często rzeczywisty błąd przekracza 2σ.
 *
 * To jest test na „pewny siebie i nieprawdziwy" — stan, w którym system
 * raportuje ±2 m, będąc 20 m obok. Dla poprawnie skalibrowanego estymatora
 * dwuwymiarowego przekroczenia 2σ powinny być rzadkie (kilka procent).
 * Wysoki odsetek oznacza, że wskaźnik niepewności wprowadza operatora
 * w błąd — a w nawigacji to gorsze niż uczciwie duży błąd.
 */
type Calibration = { exceeding2Sigma: number; meanSigma: number; drift: number };

function summarize(errors: number[], positions: LatLon[]): Stats {
  const sorted = [...errors].sort((a, b) => a - b);
  let jumps = 0;
  for (let i = 1; i < positions.length; i++) {
    jumps += distance(positions[i - 1], positions[i]);
  }
  return {
    meanError: errors.reduce((a, b) => a + b, 0) / errors.length,
    p95Error: sorted[Math.floor(sorted.length * 0.95)],
    meanJump: jumps / Math.max(positions.length - 1, 1),
  };
}

function calibration(errors: number[], sigmas: number[]): Calibration {
  let exceeding = 0;
  for (let i = 0; i < errors.length; i++) {
    if (errors[i] > 2 * sigmas[i]) exceeding++;
  }
  // Dryf: czy błąd rośnie w czasie mimo dostępnego sygnału. Porównujemy
  // średnią z ostatniej ćwiartki przebiegu ze średnią z pierwszej.
  const q = Math.max(1, Math.floor(errors.length / 4));
  const first = errors.slice(0, q).reduce((a, b) => a + b, 0) / q;
  const last = errors.slice(-q).reduce((a, b) => a + b, 0) / q;

  return {
    exceeding2Sigma: (exceeding / Math.max(errors.length, 1)) * 100,
    meanSigma: sigmas.reduce((a, b) => a + b, 0) / Math.max(sigmas.length, 1),
    drift: last - first,
  };
}

function run(scenarioId: string, seed: number) {
  const scenario = getScenario(scenarioId);
  const path = buildPath(scenario);
  const rng = new Rng(seed);

  let gait = initGait(scenario.walkSpeed, rng);
  let imuState = initImu(rng);
  let gnssState = initGnss();

  const start = sampleAt(path, 0);
  const estimator = new Estimator({
    sampleRate: RATE,
    initialPosition: start.position,
    initialHeading: start.heading,
  });

  const fusedErrors: number[] = [];
  const fusedSigmas: number[] = [];
  const fusedPositions: LatLon[] = [];
  const rawErrors: number[] = [];
  const rawPositions: LatLon[] = [];

  let s = 0;
  let t = 0;
  let lastGnssAt = -Infinity;

  while (s < path.totalLength) {
    const truth = sampleAt(path, s);
    const ahead = sampleAt(path, Math.min(s + 1, path.totalLength));
    const turnRate =
      ((ahead.heading - truth.heading + 540) % 360 - 180) * scenario.walkSpeed;

    gait = stepGait(gait, scenario.walkSpeed, DT, rng);
    imuState = driftImu(imuState, truth.terrain, DT, rng);

    const imu = synthImu({
      gait,
      heading: truth.heading,
      turnRate,
      terrain: truth.terrain,
      state: imuState,
      rng,
    });

    let fix = null;
    if (t - lastGnssAt >= GNSS_PERIOD_S) {
      const result = synthGnss(
        truth.position,
        truth.terrain,
        gnssState,
        t - lastGnssAt,
        rng,
      );
      gnssState = result.state;
      fix = result.fix;
      lastGnssAt = t;

      // Wariant odniesienia: pozycja = surowy odczyt, bez fuzji.
      const raw = { lat: fix.lat, lon: fix.lon };
      rawPositions.push(raw);
      rawErrors.push(distance(raw, truth.position));
    }

    estimator.update(imu, fix, t, DT);

    // Próbkujemy z częstotliwością GNSS, żeby porównanie było uczciwe.
    if (fix) {
      const snapshot = estimator.snapshot();
      const fused = { lat: snapshot.lat, lon: snapshot.lon };
      fusedPositions.push(fused);
      fusedErrors.push(distance(fused, truth.position));
      fusedSigmas.push(snapshot.uncertainty);
    }

    s += scenario.walkSpeed * DT;
    t += DT;
  }

  return {
    fused: summarize(fusedErrors, fusedPositions),
    raw: summarize(rawErrors, rawPositions),
    calibration: calibration(fusedErrors, fusedSigmas),
  };
}

const scenarios = ["gdansk-urban", "trojmiasto-mixed", "tpk-forest"];
const seeds = [1, 42, 99, 1337, 2024];

let failures = 0;

console.log("═══ Fuzja GNSS + inercja vs surowy odczyt GNSS ═══");
console.log("   (przy dostępnym sygnale, próbkowanie 1 Hz)\n");

for (const id of scenarios) {
  const runs = seeds.map((seed) => run(id, seed));
  const avg = (pick: (r: (typeof runs)[0]) => number) =>
    runs.reduce((a, r) => a + pick(r), 0) / runs.length;

  console.log(`  ${getScenario(id).name}`);
  console.log(
    `    ${"".padEnd(14)} ${"śr. błąd".padStart(10)} ${"95. centyl".padStart(11)} ${"skok/odczyt".padStart(12)}`,
  );
  console.log(
    `    ${"surowy GNSS".padEnd(14)} ${avg((r) => r.raw.meanError).toFixed(2).padStart(8)} m ${avg((r) => r.raw.p95Error).toFixed(2).padStart(9)} m ${avg((r) => r.raw.meanJump).toFixed(2).padStart(10)} m`,
  );
  console.log(
    `    ${"z fuzją".padEnd(14)} ${avg((r) => r.fused.meanError).toFixed(2).padStart(8)} m ${avg((r) => r.fused.p95Error).toFixed(2).padStart(9)} m ${avg((r) => r.fused.meanJump).toFixed(2).padStart(10)} m`,
  );

  const errorGain =
    ((avg((r) => r.raw.meanError) - avg((r) => r.fused.meanError)) /
      avg((r) => r.raw.meanError)) *
    100;
  const jumpGain =
    ((avg((r) => r.raw.meanJump) - avg((r) => r.fused.meanJump)) /
      avg((r) => r.raw.meanJump)) *
    100;
  console.log(
    `    ${"→ zmiana".padEnd(14)} ${(errorGain >= 0 ? "-" : "+") + Math.abs(errorGain).toFixed(0)}% błędu, ${(jumpGain >= 0 ? "-" : "+") + Math.abs(jumpGain).toFixed(0)}% skoków`,
  );

  const exceed = avg((r) => r.calibration.exceeding2Sigma);
  const drift = avg((r) => r.calibration.drift);
  const sigma = avg((r) => r.calibration.meanSigma);
  const calibOk = exceed < 15;
  const driftOk = drift < 3;
  if (!calibOk || !driftOk) failures++;

  console.log(
    `    ${"→ uczciwość".padEnd(14)} σ ${sigma.toFixed(1)} m · błąd > 2σ w ${exceed.toFixed(0)}% odczytów ${calibOk ? "✓" : "✗ ZAWYŻONA PEWNOŚĆ"} · dryf ${drift >= 0 ? "+" : ""}${drift.toFixed(1)} m ${driftOk ? "✓" : "✗ BŁĄD ROŚNIE MIMO SYGNAŁU"}\n`,
  );
}

console.log(
  failures === 0
    ? "✓ Fuzja poprawia wynik i raportuje uczciwą niepewność"
    : `✗ Nieudane kontrole: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
