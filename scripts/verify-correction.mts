/**
 * Czy korekcja ręczna faktycznie pomaga?
 *
 * To wydaje się oczywiste — wskazujemy prawdziwą pozycję, więc błąd musi
 * spaść. I spada, na chwilę. Pytanie brzmi, co dzieje się PÓŹNIEJ: korekcja
 * ma nie tylko przestawić punkt, ale też nauczyć estymator czegoś o jego
 * własnych błędach. Źle zrobiona potrafi zepsuć kurs i pogorszyć całą
 * dalszą drogę, mimo że w chwili kliknięcia wygląda na sukces.
 *
 * Porównanie: ta sama trasa i te same dane z czujników, raz bez korekcji,
 * raz z jedną korekcją w połowie.
 */
import { buildPath, getScenario, sampleAt } from "@/lib/sim/scenario";
import { initGait, stepGait } from "@/lib/sim/gait";
import { driftImu, initImu, synthImu } from "@/lib/sim/imu";
import { initGnss, synthGnss } from "@/lib/sim/gnss";
import { Rng } from "@/lib/sim/random";
import { Estimator } from "@/lib/fusion/estimator";
import { distance } from "@/lib/geo/projection";

const RATE = 50;
const DT = 1 / RATE;
const GNSS_PERIOD_S = 1;
/** Ułamek trasy przebyty z GNSS, zanim nastąpi zagłuszenie. */
const JAMMING_AT = 0.15;
/** Ułamek trasy, w którym operator koryguje pozycję. */
const CORRECTION_AT = 0.55;

type Result = {
  finalError: number;
  distanceWithoutGnss: number;
  errorAfterCorrection: number;
};

function run(scenarioId: string, seed: number, withCorrection: boolean): Result {
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

  let s = 0;
  let t = 0;
  let lastGnssAt = -Infinity;
  let corrected = false;
  let errorAfterCorrection = 0;

  const jammingAfter = path.totalLength * JAMMING_AT;
  const correctionAfter = path.totalLength * CORRECTION_AT;

  while (s < path.totalLength) {
    const truth = sampleAt(path, s);
    const ahead = sampleAt(path, Math.min(s + 1, path.totalLength));
    const turnRate =
      (((ahead.heading - truth.heading + 540) % 360) - 180) * scenario.walkSpeed;

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

    const jammed = s > jammingAfter;
    let fix = null;
    if (!jammed && t - lastGnssAt >= GNSS_PERIOD_S) {
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
    }

    estimator.update(imu, fix, t, DT);

    // Operator rozpoznaje otoczenie i wskazuje, gdzie naprawdę jest.
    if (withCorrection && !corrected && s > correctionAfter) {
      estimator.applyCorrection(truth.position);
      corrected = true;
      const snap = estimator.snapshot();
      errorAfterCorrection = distance(
        { lat: snap.lat, lon: snap.lon },
        truth.position,
      );
    }

    s += scenario.walkSpeed * DT;
    t += DT;
  }

  const truthEnd = sampleAt(path, path.totalLength).position;
  const snapshot = estimator.snapshot();

  return {
    finalError: distance(
      { lat: snapshot.lat, lon: snapshot.lon },
      truthEnd,
    ),
    distanceWithoutGnss: snapshot.distanceSinceGnssLoss,
    errorAfterCorrection,
  };
}

const scenarios = ["trojmiasto-mixed", "gdansk-urban", "tpk-forest"];
const seeds = [1, 42, 99, 1337, 2024, 31337];

let failures = 0;
let totalWithout = 0;
let totalWith = 0;
let totalWins = 0;
let totalRuns = 0;

console.log("═══ Czy korekcja ręczna pomaga na dalszą drogę? ═══");
console.log("   (GNSS zagłuszony po 15% trasy, korekcja w 55%)\n");

for (const id of scenarios) {
  const without = seeds.map((seed) => run(id, seed, false));
  const withC = seeds.map((seed) => run(id, seed, true));

  const avg = (rows: Result[], pick: (r: Result) => number) =>
    rows.reduce((a, r) => a + pick(r), 0) / rows.length;

  const errNo = avg(without, (r) => r.finalError);
  const errYes = avg(withC, (r) => r.finalError);
  const distNo = avg(without, (r) => r.distanceWithoutGnss);
  const distYes = avg(withC, (r) => r.distanceWithoutGnss);
  const atCorrection = avg(withC, (r) => r.errorAfterCorrection);

  const wins = seeds.filter((_, i) => withC[i].finalError < without[i].finalError).length;

  // Korekcja MUSI wyzerować błąd w chwili wskazania — to jest jej rdzeń
  // i jedyna rzecz, której można być pewnym. Reszta jest statystyką.
  if (atCorrection > 1) failures++;

  totalWithout += errNo;
  totalWith += errYes;
  totalWins += wins;
  totalRuns += seeds.length;

  console.log(`  ${getScenario(id).name}`);
  console.log(`    bez korekcji    ${errNo.toFixed(1).padStart(7)} m  na ${distNo.toFixed(0)} m bez GNSS  (${((errNo / distNo) * 100).toFixed(2)}%)`);
  console.log(`    z korekcją      ${errYes.toFixed(1).padStart(7)} m  na ${distYes.toFixed(0)} m od korekcji  (${((errYes / distYes) * 100).toFixed(2)}%)`);
  console.log(`    ${atCorrection <= 1 ? "✓" : "✗"} błąd tuż po korekcji: ${atCorrection.toFixed(2)} m`);
  console.log(`    wygrała w ${wins}/${seeds.length} przebiegach\n`);
}

// Ocena zbiorcza, nie per scenariusz.
//
// Błąd po zagłuszeniu jest błądzeniem losowym, więc w pojedynczym
// przebiegu korekcja bywa neutralna albo nawet nieznacznie szkodliwa —
// zwłaszcza gdy akurat trafi w moment, w którym dryf i tak szedł
// w dobrą stronę. Sensowny jest bilans po wszystkich scenariuszach.
const gain = ((totalWithout - totalWith) / totalWithout) * 100;
console.log("═══ Bilans zbiorczy ═══\n");
console.log(`  błąd końcowy bez korekcji:  ${totalWithout.toFixed(0)} m (suma scenariuszy)`);
console.log(`  błąd końcowy z korekcją:    ${totalWith.toFixed(0)} m`);
console.log(`  redukcja:                   ${gain.toFixed(0)}%`);
console.log(`  korekcja wygrała w ${totalWins}/${totalRuns} przebiegach\n`);

if (totalWith >= totalWithout) failures++;

console.log(
  failures === 0
    ? "✓ Korekcja zeruje błąd w chwili wskazania i poprawia bilans końcowy"
    : `✗ Nieudane kontrole: ${failures}`,
);
process.exit(failures === 0 ? 0 : 1);
