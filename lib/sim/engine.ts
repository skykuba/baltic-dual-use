import type { LatLon } from "@/lib/geo/types";
import type { SimStatus, SimTick } from "@/lib/types";
import { Estimator } from "@/lib/fusion/estimator";
import { bboxAround, fetchMapBundle, type MapBundle } from "@/lib/osm/mapData";
import { angleDiff, distance } from "@/lib/geo/projection";
import { initGait, stepGait, type GaitState } from "./gait";
import { driftImu, initImu, synthImu, type ImuState } from "./imu";
import { initGnss, synthGnss, type GnssState } from "./gnss";
import { Rng } from "./random";
import {
  buildPath,
  DEFAULT_SCENARIO_ID,
  getScenario,
  sampleAt,
  scenarioFromRoute,
  type ScenarioPath,
} from "./scenario";
import { findRoute } from "@/lib/osm/router";

/** Częstotliwość próbkowania IMU — odpowiada typowemu czujnikowi w telefonie. */
const IMU_HZ = 50;
/** Częstotliwość emisji do frontu. Wyższa tylko zapycha łącze. */
const EMIT_HZ = 10;
const IMU_DT = 1 / IMU_HZ;
const SAMPLES_PER_EMIT = IMU_HZ / EMIT_HZ;
/** Interwał GNSS — 1 Hz, jak w realnym odbiorniku. */
const GNSS_PERIOD_S = 1;

type Subscriber = (tick: SimTick) => void;

/**
 * Silnik symulacji.
 *
 * Trzyma jedną pętlę czasu i rozsyła ticki do wszystkich subskrybentów SSE.
 * Symulacja biegnie z krokiem IMU (50 Hz), a do frontu trafia co piąta próbka —
 * estymator musi widzieć pełny sygnał, front nie.
 */
export class SimulationEngine {
  private subscribers = new Set<Subscriber>();
  private timer: ReturnType<typeof setInterval> | null = null;

  private path: ScenarioPath;
  private rng!: Rng;
  private gait!: GaitState;
  private imuState!: ImuState;
  private gnssState!: GnssState;
  private estimator!: Estimator;

  private scenarioId = DEFAULT_SCENARIO_ID;
  private gnssEnabled = true;
  private timeScale = 4;
  private running = false;

  /** Dystans przebyty po trasie, w metrach. */
  private s = 0;
  /** Czas symulacji w sekundach. */
  private t = 0;
  private seq = 0;
  private lastGnssAt = -Infinity;
  private lastTick: SimTick | null = null;
  private pendingCorrection: LatLon | null = null;

  /** Warstwa mapowa dla bieżącego scenariusza. */
  private mapBundle: MapBundle | null = null;
  private mapLoading = false;
  private mapError: string | null = null;
  private mapMatchingEnabled = true;
  /** Cel marszu wskazany przez operatora. */
  private destination: LatLon | null = null;

  constructor() {
    this.path = buildPath(getScenario(this.scenarioId));
    this.initState();
  }

  private initState(): void {
    this.rng = new Rng(0xbeef);
    const scenario = this.path.scenario;
    const start = sampleAt(this.path, 0);

    this.gait = initGait(scenario.walkSpeed, this.rng);
    this.imuState = initImu(this.rng);
    this.gnssState = initGnss();
    this.estimator = new Estimator({
      sampleRate: IMU_HZ,
      initialPosition: start.position,
      initialHeading: start.heading,
    });

    this.s = 0;
    this.t = 0;
    this.seq = 0;
    this.lastGnssAt = -Infinity;
    this.lastTick = null;
    this.destination = null;

    // initState() tworzy NOWY estymator, więc raz pobrana mapa musi zostać
    // wpięta ponownie — inaczej reset po cichu wyłączałby map matching.
    if (this.mapBundle) {
      this.estimator.setMapContext({
        graph: this.mapBundle.graph,
        buildings: this.mapBundle.buildings,
        enabled: this.mapMatchingEnabled,
      });
    }
  }

  // ─── sterowanie ────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.advance(), 1000 / EMIT_HZ);
  }

  pause(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  reset(): void {
    this.pause();
    this.initState();
    this.gnssEnabled = true;
    this.emit(this.buildTick());
  }

  setScenario(id: string): void {
    const wasRunning = this.running;
    this.pause();
    this.scenarioId = id;
    this.path = buildPath(getScenario(id));
    this.initState();
    this.emit(this.buildTick());
    if (wasRunning) this.start();
  }

  setGnss(enabled: boolean): void {
    this.gnssEnabled = enabled;
  }

  setMapMatching(enabled: boolean): void {
    this.mapMatchingEnabled = enabled;
    this.estimator.setMapContext({ enabled });
  }

  /**
   * Pobiera warstwę mapową dla obszaru bieżącego scenariusza.
   *
   * Wywoływane jawnie, a nie automatycznie przy starcie: pobranie danych
   * to właśnie ten krok scenariusza, który ma się odbyć DOPÓKI jest
   * łączność. W demo warto go pokazać osobno.
   */
  async loadMap(): Promise<{ ok: boolean; detail: string }> {
    if (this.mapLoading) return { ok: false, detail: "Pobieranie już trwa" };

    this.mapLoading = true;
    this.mapError = null;

    try {
      const bbox = bboxAround(this.path.scenario.waypoints, 600);
      const bundle = await fetchMapBundle(bbox);
      this.mapBundle = bundle;
      this.estimator.setMapContext({
        graph: bundle.graph,
        buildings: bundle.buildings,
        enabled: this.mapMatchingEnabled,
      });
      return {
        ok: true,
        detail: `${bundle.stats.edges} krawędzi, ${bundle.stats.buildings} budynków, ${bundle.stats.pois} POI w ${bundle.stats.elapsedMs} ms`,
      };
    } catch (error) {
      this.mapError = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: this.mapError };
    } finally {
      this.mapLoading = false;
    }
  }

  get map(): MapBundle | null {
    return this.mapBundle;
  }

  /**
   * Ustawia nowy cel marszu: trasa A* od BIEŻĄCEJ pozycji rzeczywistej
   * staje się nową trajektorią pieszego.
   *
   * Estymator, model chodu i stan czujników zostają nietknięte — pieszy
   * po prostu skręca w inną stronę. Zerowanie ich oznaczałoby, że każda
   * zmiana celu magicznie naprawia dryf, a to byłoby nieuczciwe.
   */
  setDestination(target: LatLon): { ok: boolean; detail: string } {
    if (!this.mapBundle) {
      return { ok: false, detail: "Najpierw pobierz warstwę mapową" };
    }

    const current = sampleAt(this.path, this.s).position;
    const route = findRoute(this.mapBundle.graph, current, target, {
      walkSpeed: this.path.scenario.walkSpeed,
    });

    if (!route || route.points.length < 2) {
      return { ok: false, detail: "Nie znaleziono trasy do wskazanego punktu" };
    }

    this.path = buildPath(
      scenarioFromRoute(route.points, route.highways, this.path.scenario.walkSpeed),
    );
    this.scenarioId = "custom-route";

    // Nowa trasa zaczyna się tam, gdzie pieszy stoi, więc licznik dystansu
    // po trasie startuje od zera — ale czas symulacji i stan estymacji biegną dalej.
    this.s = 0;
    this.destination = target;

    this.emit(this.buildTick());
    return {
      ok: true,
      detail: `${Math.round(route.distance)} m, ${route.points.length} punktów`,
    };
  }

  get currentDestination(): LatLon | null {
    return this.destination;
  }

  /**
   * Ostatni wyemitowany tick.
   *
   * Gdy symulacja stoi, `lastTick` bywa pusty — budujemy go wtedy na
   * żądanie, żeby routing dało się wywołać także przed naciśnięciem Start.
   */
  get currentTick(): SimTick {
    return this.lastTick ?? this.buildTick();
  }

  setTimeScale(scale: number): void {
    this.timeScale = Math.min(Math.max(scale, 0.5), 20);
  }

  /**
   * Korekcja jest kolejkowana, a nie stosowana natychmiast, żeby nie
   * wejść w środek pętli symulacji z poziomu handlera HTTP.
   */
  correct(position: LatLon): void {
    this.pendingCorrection = position;
    if (!this.running) {
      this.flushCorrection();
      this.emit(this.buildTick());
    }
  }

  // ─── pętla ─────────────────────────────────────────────────────────────

  private advance(): void {
    const scenario = this.path.scenario;
    const samples = Math.max(1, Math.round(SAMPLES_PER_EMIT * this.timeScale));

    for (let i = 0; i < samples; i++) {
      if (this.s >= this.path.totalLength) {
        this.pause();
        break;
      }
      this.stepOnce(scenario.walkSpeed);
    }

    this.flushCorrection();
    this.emit(this.buildTick());
  }

  private stepOnce(walkSpeed: number): void {
    const sample = sampleAt(this.path, this.s);

    // Prędkość kątowa z krzywizny trasy: różnica kursu na najbliższym
    // metrze, podzielona przez czas potrzebny na jego przejście.
    const ahead = sampleAt(this.path, Math.min(this.s + 1, this.path.totalLength));
    const turnRate = angleDiff(ahead.heading, sample.heading) * walkSpeed;

    this.gait = stepGait(this.gait, walkSpeed, IMU_DT, this.rng);
    this.imuState = driftImu(this.imuState, sample.terrain, IMU_DT, this.rng);

    const imu = synthImu({
      gait: this.gait,
      heading: sample.heading,
      turnRate,
      terrain: sample.terrain,
      state: this.imuState,
      rng: this.rng,
    });

    let fix = null;
    if (this.gnssEnabled && this.t - this.lastGnssAt >= GNSS_PERIOD_S) {
      const result = synthGnss(
        sample.position,
        sample.terrain,
        this.gnssState,
        this.t - this.lastGnssAt,
        this.rng,
      );
      this.gnssState = result.state;
      fix = result.fix;
      this.lastGnssAt = this.t;
    }

    this.estimator.update(imu, fix, this.t, IMU_DT);

    this.lastImu = imu;
    this.lastGnssFix = this.gnssEnabled ? fix ?? this.lastGnssFix : null;
    this.lastTruth = sample.position;
    this.lastTerrain = sample.terrain;

    this.s += walkSpeed * IMU_DT;
    this.t += IMU_DT;
  }

  private lastImu = synthImu({
    gait: { cadence: 1.8, stepLength: 0.75, phase: 0, verticalAmplitude: 2.5 },
    heading: 0,
    turnRate: 0,
    terrain: "urban",
    state: {
      gyroBias: [0, 0, 0],
      accelBias: [0, 0, 0],
      magAnomaly: 0,
    },
    rng: new Rng(1),
  });
  private lastGnssFix: SimTick["gnss"] = null;
  private lastTruth: LatLon = { lat: 54.4103, lon: 18.5613 };
  private lastTerrain: SimTick["terrain"] = "urban";

  private flushCorrection(): void {
    if (!this.pendingCorrection) return;
    this.estimator.applyCorrection(this.pendingCorrection);
    this.pendingCorrection = null;
  }

  private buildTick(): SimTick {
    const snapshot = this.estimator.snapshot();
    const tick: SimTick = {
      t: Math.round(this.t * 1000),
      seq: this.seq++,
      imu: this.lastImu,
      gnss: this.gnssEnabled ? this.lastGnssFix : null,
      truth: this.lastTruth,
      terrain: this.lastTerrain,
      estimate: {
        ...snapshot,
        errorVsTruth: distance(
          { lat: snapshot.lat, lon: snapshot.lon },
          this.lastTruth,
        ),
      },
      particles: this.estimator.particles(),
    };
    this.lastTick = tick;
    return tick;
  }

  // ─── subskrypcje ───────────────────────────────────────────────────────

  subscribe(fn: Subscriber): () => void {
    this.subscribers.add(fn);
    if (this.lastTick) fn(this.lastTick);
    else fn(this.buildTick());
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private emit(tick: SimTick): void {
    for (const fn of this.subscribers) {
      try {
        fn(tick);
      } catch {
        // Zerwane połączenie SSE nie może zatrzymać symulacji.
        this.subscribers.delete(fn);
      }
    }
  }

  get status(): SimStatus {
    return {
      running: this.running,
      gnssEnabled: this.gnssEnabled,
      timeScale: this.timeScale,
      scenarioId: this.scenarioId,
      t: Math.round(this.t * 1000),
      seq: this.seq,
      mapMatchingEnabled: this.mapMatchingEnabled,
      mapLoaded: this.mapBundle !== null,
      mapLoading: this.mapLoading,
      mapError: this.mapError,
      mapStats: this.mapBundle?.stats ?? null,
      destination: this.destination,
      pathLength: Math.round(this.path.totalLength),
      pathProgress: Math.round(this.s),
    };
  }
}

/**
 * Singleton przypięty do `globalThis`.
 *
 * Bez tego każdy hot-reload Turbopacka tworzyłby nowy silnik, a stan
 * symulacji przepadałby przy każdej zmianie w kodzie.
 */
const KEY = Symbol.for("baltic.simulation.engine");
type GlobalWithEngine = typeof globalThis & {
  [KEY]?: SimulationEngine;
};

export function getEngine(): SimulationEngine {
  const g = globalThis as GlobalWithEngine;
  if (!g[KEY]) g[KEY] = new SimulationEngine();
  return g[KEY];
}
