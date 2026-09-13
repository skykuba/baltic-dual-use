import type { LatLon } from "@/lib/geo/types";
import type { SimStatus, SimTick } from "@/lib/types";
import { Estimator } from "@/lib/fusion/estimator";
import { OperationMap } from "@/lib/osm/mapData";
import { RECENTER_M } from "@/lib/osm/tiles";
import { angleDiff, distance } from "@/lib/geo/projection";
import { initGait, stepGait, type GaitState } from "./gait";
import { driftImu, initImu, synthImu, type ImuState } from "./imu";
import { initGnss, synthGnss, type GnssState } from "./gnss";
import { Rng } from "./random";
import {
  buildPath,
  CUSTOM_SCENARIO_ID,
  DEFAULT_SCENARIO_ID,
  getScenario,
  sampleAt,
  scenarioAtPoint,
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
/** Co ile emisji sprawdzamy, czy w kolejce kafli coś zostało. ~5 s. */
const PREFETCH_CHECK_TICKS = 50;

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
  /** Numer przebiegu — inkrementowany przy każdym zerowaniu stanu. */
  private run = 0;
  private lastGnssAt = -Infinity;
  private lastTick: SimTick | null = null;
  private pendingCorrection: LatLon | null = null;

  /** Warstwa mapowa obszaru operacji, dociągana kaflami. */
  private mapBundle: OperationMap | null = null;
  private mapLoading = false;
  /** Czy trwa dociąganie kafli w tle. */
  private prefetching = false;
  /** Miejsce, w którym ostatnio ruszyło pobieranie — baza progu 2 km. */
  private prefetchAnchor: LatLon | null = null;
  /** Licznik emisji, do okresowego sprawdzenia, czy jest co dociągać. */
  private sincePrefetchCheck = 0;
  private mapError: string | null = null;
  private mapMatchingEnabled = true;
  /** Cel marszu wskazany przez operatora. */
  private destination: LatLon | null = null;
  /** Punkt startowy wskazany na mapie. */
  private startPoint: LatLon | null = null;

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
    this.run++;
    this.lastGnssAt = -Infinity;
    this.lastTick = null;
    this.destination = null;
    this.startPoint = null;

    // initState() tworzy NOWY estymator, więc raz pobrana mapa musi zostać
    // wpięta ponownie — inaczej reset po cichu wyłączałby map matching.
    this.attachMap();
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

    // Trasa wskazana na mapie nie ma definicji scenariusza, więc reset musi
    // wrócić do scenariusza domyślnego. Bez tego initState() zerował cel
    // i licznik, ale ZOSTAWIAŁ pieszego na trasie „custom-route": panel nie
    // pokazywał żadnego zaznaczonego scenariusza, a marsz biegł do celu,
    // którego już nie było na mapie.
    if (this.scenarioId === CUSTOM_SCENARIO_ID) {
      this.scenarioId = DEFAULT_SCENARIO_ID;
    }
    this.path = buildPath(getScenario(this.scenarioId));

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
    const wasOffline = !this.gnssEnabled;
    this.gnssEnabled = enabled;

    // Odzyskanie łączności ma natychmiast wznowić dociąganie obszaru
    // operacji — to jest ten moment scenariusza, w którym „pobieramy,
    // dopóki się da".
    if (enabled && wasOffline) {
      this.prefetchAnchor = null;
      void this.prefetch();
    }
  }

  setMapMatching(enabled: boolean): void {
    this.mapMatchingEnabled = enabled;
    this.estimator.setMapContext({ enabled });
  }

  /**
   * Czy mamy łączność z siecią.
   *
   * Świadomie sklejone z zagłuszeniem GNSS: demo ma jeden przełącznik
   * „w zasięgu / bez zasięgu" i to on rządzi obiema rzeczami naraz.
   * W rzeczywistości zagłuszanie GNSS nie odcina transmisji danych —
   * to uproszczenie na potrzeby prezentacji, nie model świata.
   */
  private get online(): boolean {
    return this.gnssEnabled;
  }

  private get walker(): LatLon {
    return sampleAt(this.path, this.s).position;
  }

  /**
   * Pobiera obszar operacji wokół pieszego.
   *
   * Czeka wyłącznie na kafel POD PIESZYM, a resztę obszaru dociąga w tle.
   * Czekanie na całe 30×30 km oznaczałoby kilka minut wpatrywania się
   * w pasek postępu, zanim cokolwiek pojawi się na mapie — a kafel pod
   * nogami wystarcza, żeby map matching i routing ruszyły.
   */
  async loadMap(): Promise<{ ok: boolean; detail: string }> {
    if (this.mapLoading) return { ok: false, detail: "Pobieranie już trwa" };

    this.mapLoading = true;
    this.mapError = null;

    try {
      const walker = this.walker;
      if (!this.mapBundle) {
        this.mapBundle = new OperationMap(walker);
        this.attachMap();
      } else {
        this.mapBundle.recenter(walker);
      }
      this.prefetchAnchor = walker;

      const first = this.mapBundle.plan(walker)[0];
      if (first && !(await this.mapBundle.fetchTile(first, !this.online))) {
        this.mapError = "Brak łączności — tego kafla nie ma w pamięci urządzenia";
        return { ok: false, detail: this.mapError };
      }

      const stats = this.mapBundle.stats;
      void this.prefetch();
      return {
        ok: true,
        detail: `${stats.edges} krawędzi, ${stats.progress.pending} kafli w kolejce`,
      };
    } catch (error) {
      this.mapError = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: this.mapError };
    } finally {
      this.mapLoading = false;
    }
  }

  /**
   * Dociąga kafle obszaru operacji, jeden po drugim, od najbliższego.
   *
   * Pojedynczo, a nie równolegle: zapytanie o kafel 5×5 km to dla Overpassa
   * realna praca, a zalanie instancji trzydziestoma naraz kończy się
   * odrzuceniami i niczym więcej. Pętla kończy się, gdy nie ma czego
   * dociągać albo gdy zabrakło łączności; wznawia ją każdy kolejny wyzwalacz.
   */
  private async prefetch(): Promise<void> {
    if (this.prefetching || !this.mapBundle) return;
    this.prefetching = true;

    try {
      // Górny limit obiegów zabezpiecza przed pętlą bez końca, gdyby kafel
      // dał się "pobrać", ale nie zniknął z planu. Pięćdziesiąt kafli razy
      // trzy warstwy mieści się w tym z zapasem.
      for (let guard = 0; guard < 500; guard++) {
        const map = this.mapBundle;
        if (!map) break;

        const job = map.plan(this.walker)[0];
        if (!job) break;

        try {
          // Porażka nie przerywa kolejki — kafel dostaje karencję i schodzi
          // z drogi pozostałym. Inaczej jedna dziura w danych zatrzymywałaby
          // dociąganie całego obszaru operacji.
          if (await map.fetchTile(job, !this.online)) this.mapError = null;
        } catch (error) {
          this.mapError = error instanceof Error ? error.message : String(error);
          map.markFailed(job.tile);
        }
      }
    } finally {
      this.prefetching = false;
    }
  }

  /**
   * Sprawdza, czy trzeba ruszyć z pobieraniem.
   *
   * Dwa powody: pieszy oddalił się o RECENTER_M od miejsca ostatniego
   * pobrania (wtedy obszar operacji jedzie za nim i wchodzi nowy pas kafli),
   * albo po prostu minęła chwila i w kolejce coś zostało — na przykład
   * budynki, które weszły w promień wraz z ruchem.
   */
  private maybePrefetch(): void {
    if (!this.mapBundle || this.prefetching) return;

    const walker = this.walker;
    const moved =
      this.prefetchAnchor === null ||
      distance(walker, this.prefetchAnchor) >= RECENTER_M;

    if (moved) {
      this.prefetchAnchor = walker;
      this.mapBundle.recenter(walker);
      void this.prefetch();
      return;
    }

    if (++this.sincePrefetchCheck >= PREFETCH_CHECK_TICKS) {
      this.sincePrefetchCheck = 0;
      void this.prefetch();
    }
  }

  private attachMap(): void {
    if (!this.mapBundle) return;
    this.estimator.setMapContext({
      graph: this.mapBundle.graph,
      buildings: this.mapBundle.buildings,
      enabled: this.mapMatchingEnabled,
    });
  }

  get map(): OperationMap | null {
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
  /**
   * Przenosi pieszego w wskazane miejsce i zaczyna wszystko od nowa.
   *
   * To NIE jest korekcja — korekcja mówi „estymata się myli, naprawdę jestem
   * tutaj". Tu zmienia się sama prawda: żołnierz startuje w innym punkcie,
   * więc estymator, chód, czujniki i liczniki startują razem z nim.
   *
   * Numer sekwencji wraca do zera, co front rozpoznaje jako reset i czyści
   * ślady. Zostawienie ich rysowałoby trajektorię z poprzedniego miasta.
   *
   * Warstwy mapowej TU nie pobieramy: to trwa sekundy, a znacznik ma się
   * pojawić od razu. Brak pokrycia widać w `mapCoversWalker` i front dociąga
   * mapę sam.
   */
  setStart(point: LatLon): { ok: boolean; detail: string } {
    this.pause();
    this.path = buildPath(scenarioAtPoint(point, this.path.scenario.walkSpeed));
    this.scenarioId = CUSTOM_SCENARIO_ID;
    this.initState();
    this.startPoint = point;

    // Obszar operacji jedzie za pieszym — bez tego pierwsze kafle leciałyby
    // dalej wokół starego miejsca, a pod nowym nie byłoby nic.
    this.mapBundle?.recenter(point);
    this.prefetchAnchor = null;
    void this.prefetch();

    this.emit(this.buildTick());

    return {
      ok: true,
      detail: this.mapCoversWalker
        ? "Pieszy przeniesiony. Wskaż cel marszu."
        : "Punkt poza pobranym obszarem — trwa pobieranie warstwy mapowej.",
    };
  }

  private get mapCoversWalker(): boolean {
    return this.mapBundle?.covers(this.walker) ?? false;
  }

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
    this.maybePrefetch();
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
  private flushCorrection(): void {
    if (!this.pendingCorrection) return;
    this.estimator.applyCorrection(this.pendingCorrection);
    this.pendingCorrection = null;
  }

  private buildTick(): SimTick {
    const snapshot = this.estimator.snapshot();

    // Prawdę o pozycji czytamy z TRASY, a nie z pola zapamiętanego w pętli
    // kroków. Zapamiętane pole aktualizowało się wyłącznie w `stepOnce`,
    // więc każdy tick wysłany bez wykonania kroku — po Resecie, zmianie
    // scenariusza, wskazaniu punktu startowego — niósł pozycję z poprzedniej
    // trasy. Objawiało się to tym, że biała kropka „pozycja rzeczywista"
    // zostawała w starym miejscu, dopóki ktoś nie nacisnął Start.
    const sample = sampleAt(this.path, this.s);

    const tick: SimTick = {
      t: Math.round(this.t * 1000),
      seq: this.seq++,
      run: this.run,
      imu: this.lastImu,
      gnss: this.gnssEnabled ? this.lastGnssFix : null,
      truth: sample.position,
      terrain: sample.terrain,
      estimate: {
        ...snapshot,
        errorVsTruth: distance(
          { lat: snapshot.lat, lon: snapshot.lon },
          sample.position,
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
      mapLoaded: this.mapBundle?.ready ?? false,
      mapLoading: this.mapLoading,
      mapError: this.mapError,
      mapStats: this.mapBundle?.ready ? this.mapBundle.stats : null,
      destination: this.destination,
      start: this.startPoint,
      walker: sampleAt(this.path, this.s).position,
      mapCoversWalker: this.mapCoversWalker,
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
