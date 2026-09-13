import type { LatLon, PositionSource, TerrainKind, Vec3 } from "./geo/types";

/** Odczyt GNSS. `null` w strumieniu oznacza aktywne zagłuszanie. */
export type GnssFix = {
  lat: number;
  lon: number;
  /** Błąd 1σ w metrach. */
  accuracy: number;
  satellites: number;
};

/** Surowe odczyty IMU w układzie urządzenia. */
export type ImuSample = {
  /** m/s², z grawitacją. */
  accel: Vec3;
  /** rad/s. */
  gyro: Vec3;
  /** µT. */
  mag: Vec3;
};

/** Najlepsza znana pozycja wraz z miarą zaufania. */
export type Estimate = {
  lat: number;
  lon: number;
  source: PositionSource;
  /** Promień 1σ w metrach. */
  uncertainty: number;
  /** Stopnie od północy. */
  heading: number;
  steps: number;
  /** Metry — liczone wyłącznie na potrzeby demo, nie wchodzi do estymatora. */
  errorVsTruth: number;
  /** Dystans przebyty od utraty GNSS; mianownik metryki „% przebytej drogi". */
  distanceSinceGnssLoss: number;
};

/** Cząstka filtru — eksponowana do wizualizacji chmury niepewności. */
export type ParticleView = {
  lat: number;
  lon: number;
  w: number;
};

/** Pojedynczy tick symulacji wysyłany przez SSE. */
export type SimTick = {
  /** Milisekundy czasu symulacji od startu. */
  t: number;
  seq: number;
  imu: ImuSample;
  gnss: GnssFix | null;
  /** Prawda o pozycji. Służy WYŁĄCZNIE do wizualizacji i metryk. */
  truth: LatLon;
  terrain: TerrainKind;
  estimate: Estimate;
  /** Podpróbkowana chmura cząstek — pusta, gdy filtr nie pracuje. */
  particles: ParticleView[];
};

/** Polecenia sterujące symulacją. */
export type SimCommand =
  | { type: "start" }
  | { type: "pause" }
  | { type: "reset" }
  | { type: "setGnss"; enabled: boolean }
  | { type: "setTimeScale"; scale: number }
  | { type: "setScenario"; id: string }
  | { type: "setMapMatching"; enabled: boolean }
  | { type: "loadMap" }
  | { type: "correct"; lat: number; lon: number };

export type SimStatus = {
  running: boolean;
  gnssEnabled: boolean;
  timeScale: number;
  scenarioId: string;
  t: number;
  seq: number;
  mapMatchingEnabled: boolean;
  mapLoaded: boolean;
  mapLoading: boolean;
  mapError: string | null;
  mapStats: {
    nodes: number;
    edges: number;
    buildings: number;
    pois: number;
    elapsedMs: number;
    /** "local" = własna instancja, "fallback" = publiczna, "cache" = z dysku. */
    origin: "cache" | "local" | "fallback";
  } | null;
};
