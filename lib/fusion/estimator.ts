import type { LatLon, PositionSource } from "@/lib/geo/types";
import type { Estimate, GnssFix, ImuSample } from "@/lib/types";
import { PdrEngine } from "@/lib/pdr/pdr";
import { ParticleFilter } from "./particleFilter";
import type { NavGraph } from "@/lib/osm/graph";
import type { Buildings } from "@/lib/osm/buildings";
import { bearing, distance, fromEnu } from "@/lib/geo/projection";
import {
  angleDiff,
  bearing,
  distance,
  fromEnu,
  normalizeDeg,
  toEnu,
} from "@/lib/geo/projection";

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

<<<<<<< HEAD
=======
/**
 * Przyrost wariancji pozycji na metr marszu wg PDR, w m² na metr.
 *
 * Odpowiada zmierzonemu błędowi rzędu 6% dystansu w zabudowie:
 * po 100 m bez odniesienia odchylenie standardowe rośnie do około 6 m.
 */
const PDR_VARIANCE_PER_METER = 0.36;

/**
 * Dolne ograniczenie raportowanej niepewności, jako ułamek dokładności GNSS.
 *
 * Filtr Kalmana zakładający biały szum pomiaru zbiega do σ ≈ 2 m, bo sądzi,
 * że uśrednianie kolejnych odczytów dowolnie redukuje błąd. Realny błąd GNSS
 * jest SKORELOWANY w czasie (odbicia wielodrogowe utrzymują się dziesiątki
 * sekund), więc uśrednianie go nie usuwa. Bez tej podłogi system raportuje
 * ±2 m, będąc w rzeczywistości 20 m obok — a zawyżona pewność jest
 * w nawigacji gorsza niż uczciwie duży błąd.
 *
 * Wartość dobrana pomiarowo, nie na oko: błąd pozycji w 2D ma rozkład
 * Rayleigha, dla którego średnia wynosi σ·√(π/2) ≈ 1,25σ. Podłoga jest
 * ustawiona tak, żeby raportowana σ odpowiadała zmierzonemu średniemu
 * błędowi po tym przeliczeniu. Sprawdza to verify-gnss-fusion.mts.
 */
const GNSS_UNCERTAINTY_FLOOR = 0.7;

/**
 * Minimalny dystans między fixami, z którego liczymy kurs z GNSS.
 *
 * Kurs z dwóch odczytów oddalonych o metr to głównie szum: przy dokładności
 * 6,5 m kierunek takiego wektora jest praktycznie losowy.
 */
const COURSE_MIN_DISTANCE_M = 12;

>>>>>>> 594d9d3 (loks working)
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
<<<<<<< HEAD
=======
  /** Wariancja pozycji w m² — stan filtru fuzji GNSS z inercją. */
  private variance: number;
  /** Fix, od którego liczymy kurs z GNSS (course over ground). */
  private courseAnchor: LatLon | null = null;
>>>>>>> 594d9d3 (loks working)
  /** Dystans wg PDR przebyty od kotwicy — mianownik metryki błędu. */
  private distanceSinceAnchor = 0;
  /**
   * Wypadkowe przemieszczenie wg PDR od kotwicy, w metrach (ENU).
   *
   * Kluczowa różnica wobec samego dystansu: porównanie WEKTORÓW
   * przemieszczenia wypadkowego daje poprawną ocenę błędu kursu i skali
   * niezależnie od kształtu trasy. Porównanie długości drogi z odległością
   * w linii prostej działa tylko dla marszu po prostej — a żołnierz skręca.
   */
  private displacementSinceAnchor = { e: 0, n: 0 };
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
<<<<<<< HEAD
      this.filter.initialize(this.position, Math.max(this.uncertainty, 3));
=======
      this.displacementSinceAnchor = { e: 0, n: 0 };
      this.filter.initialize(this.position, Math.max(Math.sqrt(this.variance), 3));
>>>>>>> 594d9d3 (loks working)

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
    this.displacementSinceAnchor.e += step.e;
    this.displacementSinceAnchor.n += step.n;

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
      // Powrót sygnału: znamy prawdziwe przemieszczenie od kotwicy,
      // więc możemy ocenić, o ile PDR się pomylił — i w kursie, i w skali.
      const actual = distance(this.anchor, fix);
      this.learnFromReference(fix);
      this.hadGnss = true;
    }
    this.sinceFix = [];

<<<<<<< HEAD
    this.position = fix;
    this.source = "gnss";
    this.uncertainty = gnss.accuracy;
    this.anchor = fix;
=======
    this.updateHeadingFromCourse(fix);

    this.source = "gnss";
    // Podłoga niepewności — patrz komentarz przy GNSS_UNCERTAINTY_FLOOR.
    this.uncertainty = Math.max(
      Math.sqrt(this.variance),
      gnss.accuracy * GNSS_UNCERTAINTY_FLOOR,
    );
    this.anchor = { ...this.position };
>>>>>>> 594d9d3 (loks working)
    this.distanceSinceAnchor = 0;
    this.displacementSinceAnchor = { e: 0, n: 0 };
  }

  /**
   * Wyciąga z wiarygodnego odniesienia to, czego PDR może się nauczyć:
   * błąd kursu i błąd skali kroku.
   *
   * Porównywane są WEKTORY przemieszczenia wypadkowego — ten, który
   * wyliczył PDR, z tym, który wynika z odniesienia. Kąt między nimi to
   * błąd kursu, iloraz długości to błąd skali. Oba są poprawne niezależnie
   * od kształtu trasy.
   *
   * Wcześniejsza wersja ustawiała kurs na azymut „kotwica → punkt
   * odniesienia", czyli na ŚREDNI kierunek marszu. Po każdym skręcie
   * wstawiało to do estymatora kurs, którym pieszy już dawno nie idzie —
   * i korekcja ręczna, zamiast pomagać, psuła estymację na dalszą drogę.
   */
  private learnFromReference(reference: LatLon): void {
    const actualVec = toEnu(this.anchor, reference);
    const pdrVec = this.displacementSinceAnchor;

    const actualLen = Math.hypot(actualVec.e, actualVec.n);
    const pdrLen = Math.hypot(pdrVec.e, pdrVec.n);

    // Przy krótkim przemieszczeniu kąt między wektorami to głównie szum.
    const MIN_DISPLACEMENT_M = 15;
    if (actualLen < MIN_DISPLACEMENT_M || pdrLen < MIN_DISPLACEMENT_M) return;

    const actualBearing = (Math.atan2(actualVec.e, actualVec.n) * 180) / Math.PI;
    const pdrBearing = (Math.atan2(pdrVec.e, pdrVec.n) * 180) / Math.PI;
    const headingError = angleDiff(actualBearing, pdrBearing);

    // Obrót bieżącego kursu o zmierzony błąd, a nie ustawienie wartości
    // bezwzględnej — dzięki temu skręt wykonany tuż przed korekcją nie ginie.
    this.pdr.nudgeHeading(
      normalizeDeg(this.pdr.heading + headingError),
      0.8,
    );

    this.pdr.recalibrate(pdrLen, actualLen);
  }

  /**
   * Korekta kursu PDR kierunkiem ruchu wyliczonym z GNSS.
   *
   * Bez tego sprzężenia raz przekręcony kurs — po korekcji ręcznej, po
   * anomalii magnetycznej — prowadzi estymatę w bok na stałe. Wzmocnienie
   * Kalmana pozycji tego nie naprawia: ono ściąga POZYCJĘ o kilkanaście
   * procent na odczyt, podczas gdy PDR w tym samym czasie odchodzi
   * w błędnym kierunku. Efektem jest trwały błąd boczny przy jednocześnie
   * malejącej raportowanej niepewności.
   *
   * Kurs liczymy dopiero z fixów oddalonych o kilkanaście metrów, bo
   * kierunek wektora między bliskimi odczytami to prawie wyłącznie szum.
   */
  private updateHeadingFromCourse(fix: LatLon): void {
    if (!this.courseAnchor) {
      this.courseAnchor = { ...fix };
      return;
    }

    const travelled = distance(this.courseAnchor, fix);
    if (travelled < COURSE_MIN_DISTANCE_M) return;

    const course = bearing(this.courseAnchor, fix);
    this.courseAnchor = { ...fix };

    // Łagodne ściąganie, nie nadpisanie: pieszy skręca, a kurs z GNSS
    // opisuje średni kierunek na przebytym odcinku, nie kierunek bieżący.
    this.pdr.nudgeHeading(course, 0.35);
  }

  /**
   * Ręczna korekcja pozycji przez operatora.
   *
   * Żołnierz widzi otoczenie — skrzyżowanie, budynek, załom drogi — lepiej
   * niż jakikolwiek czujnik. Wskazanie pozycji na mapie zeruje skumulowany
   * dryf i, co ważniejsze, rekalibruje długość kroku na przyszłość.
   */
  applyCorrection(corrected: LatLon): void {
    this.learnFromReference(corrected);

    this.position = { ...corrected };
    this.anchor = { ...corrected };
    this.distanceSinceAnchor = 0;
    this.displacementSinceAnchor = { e: 0, n: 0 };
    this.sinceFix = [];
    this.uncertainty = 3;
    this.source = "manual";
    // Nowy punkt odniesienia dla kursu z GNSS — stary dotyczył innego miejsca.
    this.courseAnchor = null;

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
