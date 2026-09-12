import type { TerrainKind, Vec3 } from "@/lib/geo/types";
import type { GaitState } from "./gait";
import type { Rng } from "./random";

const G = 9.80665;

/** Natężenie pola magnetycznego Ziemi w Polsce, w µT (przybliżone). */
const MAG_HORIZONTAL = 18.5;
const MAG_VERTICAL = 45.5;

/**
 * Całkowite zaburzenie magnetometru wg terenu, w stopniach (1σ).
 *
 * To nie jest ozdobnik — w zabudowie stal zbrojeniowa, pojazdy i instalacje
 * potrafią przesunąć wskazanie o kilkadziesiąt stopni. Właśnie dlatego samo
 * „idź za kompasem" nie działa, a filtr komplementarny musi ważyć
 * magnetometr ostrożnie.
 */
const MAG_DISTURBANCE: Record<TerrainKind, number> = {
  urban: 22,
  forest: 6,
  open: 3,
};

/**
 * Podział zaburzenia na część skorelowaną przestrzennie i białą.
 *
 * Sama biała dałaby się uśrednić do zera i filtr komplementarny miałby zbyt
 * łatwo. Realny problem polega na tym, że anomalia magnetyczna utrzymuje się
 * na przestrzeni dziesiątek metrów — czyli jest skorelowana.
 */
const CORRELATED_FRACTION = 0.7;
/** Stała czasowa zaniku anomalii, w sekundach. */
const MAG_ANOMALY_TAU_S = 25;

export type ImuState = {
  /** Dryfujący bias żyroskopu w rad/s — główne źródło błędu kursu. */
  gyroBias: Vec3;
  /** Stały offset akcelerometru w m/s². */
  accelBias: Vec3;
  /** Skorelowana anomalia magnetyczna, w stopniach. */
  magAnomaly: number;
};

export function initImu(rng: Rng): ImuState {
  return {
    // ~0,02 °/s — typowy bias konsumenckiego MEMS po kalibracji
    gyroBias: [
      rng.gauss(0, 0.0003),
      rng.gauss(0, 0.0003),
      rng.gauss(0, 0.0003),
    ],
    accelBias: [rng.gauss(0, 0.04), rng.gauss(0, 0.04), rng.gauss(0, 0.04)],
    magAnomaly: 0,
  };
}

/**
 * Błądzenie losowe biasów. Bez tego kurs nie dryfowałby realistycznie,
 * a filtr komplementarny nie miałby czego korygować.
 */
export function driftImu(
  state: ImuState,
  terrain: TerrainKind,
  dt: number,
  rng: Rng,
): ImuState {
  const walk = (v: number, sigma: number) =>
    v + rng.gauss(0, sigma) * Math.sqrt(dt);

  // Proces AR(1) o zadanej wariancji stacjonarnej — anomalia utrzymuje się
  // przez dziesiątki sekund, po czym ustępuje miejsca kolejnej.
  const decay = Math.exp(-dt / MAG_ANOMALY_TAU_S);
  const target = MAG_DISTURBANCE[terrain] * CORRELATED_FRACTION;
  const drive = target * Math.sqrt(1 - decay * decay);

  return {
    gyroBias: [
      walk(state.gyroBias[0], 0.00008),
      walk(state.gyroBias[1], 0.00008),
      walk(state.gyroBias[2], 0.00012),
    ],
    accelBias: state.accelBias,
    magAnomaly: state.magAnomaly * decay + rng.gauss(0, drive),
  };
}

export type ImuSynthInput = {
  gait: GaitState;
  /** Kurs rzeczywisty w stopniach od północy. */
  heading: number;
  /** Prędkość zmiany kursu w °/s (z krzywizny trasy). */
  turnRate: number;
  terrain: TerrainKind;
  state: ImuState;
  rng: Rng;
};

/**
 * Synteza jednej próbki IMU.
 *
 * Układ urządzenia przyjmujemy jako „telefon noszony stabilnie na torsie,
 * osią Z w górę". Upraszcza to transformację i nie zmienia niczego istotnego
 * dla detekcji kroków, która pracuje na module wektora przyspieszenia.
 *
 * UWAGA na pułapkę: każdy człon modelujący kołysanie ciała MUSI mieć zerową
 * średnią po pełnym cyklu kroku. Człon typu sin(phase/2) ma średnią 0,637,
 * czyli wstrzykuje do żyroskopu stały bias — i estymator kursu, choć
 * poprawny, dostaje dane, w których kurs naprawdę systematycznie odpływa.
 */
export function synthImu(input: ImuSynthInput): {
  accel: Vec3;
  gyro: Vec3;
  mag: Vec3;
} {
  const { gait, heading, turnRate, terrain, state, rng } = input;
  const { phase, verticalAmplitude: A } = gait;

  // Pionowe przyspieszenie: pierwsza i druga harmoniczna cyklu kroku.
  const az =
    G +
    A * Math.sin(phase) +
    A * 0.35 * Math.sin(2 * phase + 0.8) +
    state.accelBias[2] +
    rng.gauss(0, 0.18);

  // Kołysanie boczne: jeden cykl na dwa kroki, zerowa średnia.
  const ax =
    A * 0.28 * Math.cos(phase / 2) + state.accelBias[0] + rng.gauss(0, 0.15);
  const ay = A * 0.22 * Math.cos(phase) + state.accelBias[1] + rng.gauss(0, 0.15);

  const turnRateRad = (turnRate * Math.PI) / 180;
  const gyro: Vec3 = [
    0.12 * Math.sin(phase) + state.gyroBias[0] + rng.gauss(0, 0.01),
    0.09 * Math.cos(phase) + state.gyroBias[1] + rng.gauss(0, 0.01),
    turnRateRad +
      0.05 * Math.cos(phase / 2) +
      state.gyroBias[2] +
      rng.gauss(0, 0.01),
  ];

  // Magnetometr: pole ziemskie obrócone o kurs, plus zaburzenie terenowe.
  const whiteSigma =
    MAG_DISTURBANCE[terrain] * Math.sqrt(1 - CORRELATED_FRACTION ** 2);
  const disturbed = heading + state.magAnomaly + rng.gauss(0, whiteSigma);
  const rad = (disturbed * Math.PI) / 180;
  const mag: Vec3 = [
    MAG_HORIZONTAL * Math.cos(rad) + rng.gauss(0, 0.6),
    -MAG_HORIZONTAL * Math.sin(rad) + rng.gauss(0, 0.6),
    MAG_VERTICAL + rng.gauss(0, 0.6),
  ];

  return { accel: [ax, ay, az], gyro, mag };
}
