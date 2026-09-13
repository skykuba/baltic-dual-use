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
  /** Numer ticku w obrębie przebiegu. */
  seq: number;
  /**
   * Numer przebiegu symulacji — rośnie przy każdym zerowaniu stanu.
   *
   * Samo `seq` nie wystarcza do rozpoznania resetu: wraca wtedy do zera,
   * więc gdy reset nastąpi przy `seq === 0` (a tak jest zaraz po wczytaniu
   * strony), nowy tick jest nieodróżnialny od poprzedniego. Front gubił
   * przez to pierwszą klatkę po przeniesieniu pieszego.
   */
  run: number;
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
  | { type: "setStart"; lat: number; lon: number }
  | { type: "setDestination"; lat: number; lon: number }
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
    /**
     * "cache"    = odpowiedź zapisana wcześniej na dysku, działa offline,
     * "local"    = skonfigurowana instancja Overpass (OVERPASS_URL),
     * "fallback" = instancja zapasowa.
     */
    origin: "cache" | "local" | "fallback";
    /** Postęp dociągania obszaru operacji. */
    progress: {
      /** Kafli w obszarze operacji. */
      total: number;
      /** Kafli z pobraną siecią dróg. */
      ready: number;
      /** Kafli z zaległą robotą. */
      pending: number;
      /** Bok obszaru operacji, w metrach. */
      areaMeters: number;
    };
  } | null;
  /** Cel marszu wskazany przez operatora. */
  destination: { lat: number; lon: number } | null;
  /** Punkt startowy, jeśli wskazany na mapie zamiast wziętego ze scenariusza. */
  start: { lat: number; lon: number } | null;
  /** Rzeczywista pozycja pieszego — potrzebna, by wiedzieć, czy mapa ją obejmuje. */
  walker: { lat: number; lon: number };
  /**
   * Czy pobrana warstwa mapowa obejmuje pozycję pieszego.
   *
   * Fałsz oznacza, że routing i map matching nie mają na czym pracować —
   * i jest to stan, w który da się wejść jednym kliknięciem (punkt startowy
   * poza pobranym obszarem), więc interfejs musi go widzieć.
   */
  mapCoversWalker: boolean;
  /** Długość bieżącej trasy i przebyty po niej dystans, w metrach. */
  pathLength: number;
  pathProgress: number;
};
