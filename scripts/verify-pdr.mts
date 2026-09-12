/**
 * Weryfikacja łańcucha PDR na danych z symulatora.
 *
 * Sprawdza trzy rzeczy, które muszą działać, zanim ma sens budowanie
 * czegokolwiek wyżej:
 *   1. czy detektor kroków w ogóle wykrywa kroki i ile ich gubi,
 *   2. jaki jest błąd estymacji dystansu,
 *   3. jak duży jest błąd pozycji po całkowaniu, wyrażony w % przebytej drogi.
 */
import { buildPath, getScenario, sampleAt } from "@/lib/sim/scenario";
import { initGait, stepGait } from "@/lib/sim/gait";
import { driftImu, initImu, synthImu } from "@/lib/sim/imu";
import { Rng } from "@/lib/sim/random";
import { PdrEngine } from "@/lib/pdr/pdr";
import { angleDiff, distance, fromEnu } from "@/lib/geo/projection";
import type { LatLon } from "@/lib/geo/types";

const SAMPLE_RATE = 50;
const DT = 1 / SAMPLE_RATE;

function run(scenarioId: string, seed: number) {
  const scenario = getScenario(scenarioId);
  const path = buildPath(scenario);
  const rng = new Rng(seed);

  let gait = initGait(scenario.walkSpeed, rng);
  let imuState = initImu(rng);

  const start = sampleAt(path, 0);
  const pdr = new PdrEngine(SAMPLE_RATE, start.heading);

  let s = 0;
  let t = 0;
  let estimate: LatLon = { ...start.position };
  let trueSteps = 0;
  let lastPhase = gait.phase;

  const headingErrors: number[] = [];

  while (s < path.totalLength) {
    const sample = sampleAt(path, s);
    const ahead = sampleAt(path, Math.min(s + 1, path.totalLength));
    const turnRate = angleDiff(ahead.heading, sample.heading) / (1 / scenario.walkSpeed);

    gait = stepGait(gait, scenario.walkSpeed, DT, rng);
    imuState = driftImu(imuState, sample.terrain, DT, rng);

    // Liczba kroków wg prawdy: jedno przejście fazy przez 2π to jeden krok.
    if (gait.phase < lastPhase) trueSteps += 1;
    lastPhase = gait.phase;

    const imu = synthImu({
      gait,
      heading: sample.heading,
      turnRate,
      terrain: sample.terrain,
      state: imuState,
      rng,
    });

    const displacement = pdr.push(imu, t, DT);
    if (displacement) {
      const rad = (displacement.heading * Math.PI) / 180;
      estimate = fromEnu(estimate, {
        e: Math.sin(rad) * displacement.length,
        n: Math.cos(rad) * displacement.length,
      });
      headingErrors.push(Math.abs(angleDiff(displacement.heading, sample.heading)));
    }

    s += scenario.walkSpeed * DT;
    t += DT;
  }

  const truthEnd = sampleAt(path, path.totalLength).position;
  const posError = distance(estimate, truthEnd);
  const meanHeadingError =
    headingErrors.reduce((a, b) => a + b, 0) / Math.max(headingErrors.length, 1);

  return {
    name: scenario.name,
    trueDistance: path.totalLength,
    pdrDistance: pdr.distance,
    distanceErrorPct: ((pdr.distance - path.totalLength) / path.totalLength) * 100,
    trueSteps,
    detectedSteps: pdr.steps,
    stepErrorPct: ((pdr.steps - trueSteps) / trueSteps) * 100,
    posError,
    posErrorPct: (posError / path.totalLength) * 100,
    meanHeadingError,
    durationMin: t / 60,
  };
}

const scenarios = ["trojmiasto-mixed", "gdansk-urban", "tpk-forest"];
const seeds = [1, 7, 42, 1337, 2024];

for (const id of scenarios) {
  const runs = seeds.map((seed) => run(id, seed));
  const avg = (f: (r: (typeof runs)[0]) => number) =>
    runs.reduce((a, r) => a + f(r), 0) / runs.length;

  console.log(`\n═══ ${runs[0].name} ═══`);
  console.log(`  Dystans rzeczywisty:  ${runs[0].trueDistance.toFixed(0)} m  (${runs[0].durationMin.toFixed(1)} min marszu)`);
  console.log(`  Kroki: prawda ${avg((r) => r.trueSteps).toFixed(0)}, wykryte ${avg((r) => r.detectedSteps).toFixed(0)}  →  błąd ${avg((r) => r.stepErrorPct).toFixed(2)}%`);
  console.log(`  Dystans wg PDR:       błąd ${avg((r) => r.distanceErrorPct).toFixed(1)}%`);
  console.log(`  Średni błąd kursu:    ${avg((r) => r.meanHeadingError).toFixed(1)}°`);
  console.log(`  BŁĄD POZYCJI:         ${avg((r) => r.posError).toFixed(0)} m  =  ${avg((r) => r.posErrorPct).toFixed(2)}% przebytej drogi`);
  console.log(`    (min ${Math.min(...runs.map((r) => r.posErrorPct)).toFixed(2)}%, max ${Math.max(...runs.map((r) => r.posErrorPct)).toFixed(2)}%)`);
}
