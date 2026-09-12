import type { LatLon, PositionSource } from "@/lib/geo/types";
import type { Estimate, GnssFix, ImuSample } from "@/lib/types";
import { PdrEngine } from "@/lib/pdr/pdr";
import { ParticleFilter } from "./particleFilter";
import type { NavGraph } from "@/lib/osm/graph";
import type { Buildings } from "@/lib/osm/buildings";
import { bearing, distance, fromEnu } from "@/lib/geo/projection";

/**
 * Orkiestracja estymacji pozycji.
 *
 * Reguła nadrzędna: jeśli GNSS jest dostępny, jest źródłem prawdy. Gdy znika,
 * ostatni fix staje się kotwicą, od której PDR liczy przemieszczenia.
 * Korekcja ręczna przestawia kotwicę na punkt wskazany przez człowieka.
 *
 * Ten moduł NIGDY nie widzi ground truth. Pole `errorVsTruth` w wyniku jest
 * wypełniane na zewnątrz, wyłącznie do wizualizacji i metryk.
 */

/**
 * Po ilu sekundach bez fixa uznajemy GNSS za utracony.
 *
 * Odbiornik raportuje pozycję raz na sekundę, więc brak fixa w POJEDYNCZEJ
 * próbce IMU nie znaczy nic — przy 50 Hz 49 na 50 próbek jest „bez GNSS".
 * Dopiero kilka pominiętych ramek z rzędu oznacza zagłuszenie.
 */
const GNSS_TIMEOUT_S = 2.5;

export type EstimatorOptions = {
  sampleRate: number;
  initialPosition: LatLon;
  initialHeading: number;
};

/** Dane mapowe dla map matchingu. Bez nich estymator działa jak czysty PDR. */
export type MapContext = {
  graph: NavGraph | null;
  buildings: Buildings | null;
  /** Czy stosować ograniczenie mapowe. */
  enabled: boolean;
};

export class Estimator {
  private readonly pdr: PdrEngine;
  private readonly filter = new ParticleFilter();
  private map: MapContext = { graph: null, buildings: null, enabled: true };
  private position: LatLon;
  private source: PositionSource = "gnss";
  private uncertainty: number;

  /** Ostatnia pozycja, w której mieliśmy zaufane odniesienie. */
  private anchor: LatLon;
  /** Dystans wg PDR przebyty od kotwicy — mianownik metryki błędu. */
  private distanceSinceAnchor = 0;
  /** Czy GNSS jest uznawany za dostępny. */
  private hadGnss = true;
  /** Czas ostatniego odebranego fixa, w sekundach czasu symulacji. */
  private lastGnssT = 0;
  /**
   * Przemieszczenia PDR zebrane od ostatniego fixa.
   *
   * Potrzebne, bo utratę sygnału stwierdzamy dopiero po 2,5 s. Bez bufora
   * ruch wykonany w tym oknie przepadłby i estymata startowałaby
   * z nieaktualnego punktu.
   */
  private sinceFix: {
    e: number;
    n: number;
    length: number;
    heading: number;
  }[] = [];

  constructor(opts: EstimatorOptions) {
    this.pdr = new PdrEngine(opts.sampleRate, opts.initialHeading);
    this.position = { ...opts.initialPosition };
    this.anchor = { ...opts.initialPosition };
    this.uncertainty = 5;
  }

  /**
   * Przetwarza jedną próbkę. Wywoływane z częstotliwością IMU (50 Hz),
   * nie z częstotliwością emisji do frontu.
   */
  update(imu: ImuSample, gnss: GnssFix | null, t: number, dt: number): void {
    const displacement = this.pdr.push(imu, t, dt);
    const step = displacement
      ? {
          e: Math.sin((displacement.heading * Math.PI) / 180) * displacement.length,
          n: Math.cos((displacement.heading * Math.PI) / 180) * displacement.length,
          length: displacement.length,
          heading: displacement.heading,
        }
      : null;

    if (gnss) {
      this.lastGnssT = t;
      this.onGnssAvailable(gnss);
      return;
    }

    if (this.hadGnss) {
      if (t - this.lastGnssT < GNSS_TIMEOUT_S) {
        // Zwykła przerwa między fixami: pozycja zostaje z ostatniego odczytu,
        // ale ruch buforujemy, żeby nie zgubić go przy ewentualnej utracie.
        if (step) this.sinceFix.push(step);
        return;
      }

      // Sygnał uznany za utracony. Chmura cząstek startuje z ostatniego
      // fixa, z rozrzutem równym jego dokładności — nie udajemy, że wiemy
      // więcej, niż wiedzieliśmy w chwili utraty sygnału.
      this.hadGnss = false;
      this.anchor = { ...this.position };
      this.distanceSinceAnchor = 0;
      this.filter.initialize(this.position, Math.max(this.uncertainty, 3));

      for (const buffered of this.sinceFix) this.applyStep(buffered);
      this.sinceFix = [];
    }

    if (step) this.applyStep(step);
  }

  /** Podmienia dane mapowe. Wywoływane po pobraniu obszaru z Overpassa. */
  setMapContext(context: Partial<MapContext>): void {
    this.map = { ...this.map, ...context };
  }

  /** Chmura cząstek do wizualizacji. Pusta, gdy filtr nie pracuje. */
  particles(limit = 120) {
    return this.usingFilter ? this.filter.sample(limit) : [];
  }

  private get usingFilter(): boolean {
    return (
      !this.hadGnss && this.filter.isInitialized && this.map.enabled &&
      this.map.graph !== null
    );
  }

  private applyStep(step: {
    e: number;
    n: number;
    length: number;
    heading: number;
  }): void {
    this.distanceSinceAnchor += step.length;

    if (this.usingFilter) {
      this.filter.step(
        step.length,
        step.heading,
        this.map.graph,
        this.map.buildings,
      );
      const result = this.filter.estimate();
      this.position = result.position;
      this.source = "pdr+map";
      // Niepewność bierzemy z rozrzutu chmury — to miara wyliczona
      // z danych, a nie z góry przyjęty współczynnik.
      this.uncertainty = Math.max(result.spread, 3);
      return;
    }

    this.position = fromEnu(this.position, { e: step.e, n: step.n });
    this.source = "pdr";
    // Bez mapy niepewność narasta proporcjonalnie do dystansu przebytego
    // bez odniesienia. Współczynnik 0,06 odpowiada zmierzonemu błędowi
    // ~6% w zabudowie.
    this.uncertainty = 5 + this.distanceSinceAnchor * 0.06;
  }

  private onGnssAvailable(gnss: GnssFix): void {
    const fix: LatLon = { lat: gnss.lat, lon: gnss.lon };

    if (!this.hadGnss) {
      // Powrót sygnału: wiemy, gdzie naprawdę jesteśmy, więc możemy
      // ocenić, jak bardzo PDR się pomylił — i wykorzystać to do rekalibracji.
      const actual = distance(this.anchor, fix);
      this.pdr.recalibrate(this.distanceSinceAnchor, actual);
      if (actual > 10) {
        this.pdr.setHeading(bearing(this.anchor, fix));
      }
      this.hadGnss = true;
    }
    this.sinceFix = [];

    this.position = fix;
    this.source = "gnss";
    this.uncertainty = gnss.accuracy;
    this.anchor = fix;
    this.distanceSinceAnchor = 0;
  }

  /**
   * Ręczna korekcja pozycji przez operatora.
   *
   * Żołnierz widzi otoczenie — skrzyżowanie, budynek, załom drogi — lepiej
   * niż jakikolwiek czujnik. Wskazanie pozycji na mapie zeruje skumulowany
   * dryf i, co ważniejsze, rekalibruje długość kroku na przyszłość.
   */
  applyCorrection(corrected: LatLon): void {
    const actual = distance(this.anchor, corrected);
    this.pdr.recalibrate(this.distanceSinceAnchor, actual);
    if (actual > 10) {
      this.pdr.setHeading(bearing(this.anchor, corrected));
    }

    this.position = { ...corrected };
    this.anchor = { ...corrected };
    this.distanceSinceAnchor = 0;
    this.sinceFix = [];
    this.uncertainty = 3;
    this.source = "manual";

    // Chmura startuje od nowa wokół wskazanego punktu z małym rozrzutem.
    // To jedyny mechanizm odzyskiwania po tym, jak filtr zaczepi się
    // o złą ulicę — patrz uwaga o ograniczeniu w particleFilter.ts.
    this.filter.initialize(corrected, 3);
  }

  snapshot(): Omit<Estimate, "errorVsTruth"> {
    return {
      lat: this.position.lat,
      lon: this.position.lon,
      source: this.source,
      uncertainty: this.uncertainty,
      heading: this.pdr.heading,
      steps: this.pdr.steps,
      distanceSinceGnssLoss: this.distanceSinceAnchor,
    };
  }

  get currentPosition(): LatLon {
    return this.position;
  }
}
