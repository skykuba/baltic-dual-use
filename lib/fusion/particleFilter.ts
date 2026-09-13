import type { LatLon } from "@/lib/geo/types";
import { fromEnu, metersPerDegree, toEnu } from "@/lib/geo/projection";
import type { NavGraph } from "@/lib/osm/graph";
import type { Buildings } from "@/lib/osm/buildings";
import { Rng } from "@/lib/sim/random";

/**
 * Filtr cząsteczkowy z ograniczeniem mapowym.
 *
 * Każda cząstka to hipoteza „gdzie jestem". Propagujemy je przemieszczeniem
 * z PDR, a mapa decyduje, które hipotezy są wiarygodne: cząstka na drodze
 * dostaje wysoką wagę, cząstka w ścianie budynku — bliską zeru.
 *
 * Dlaczego filtr cząsteczkowy, a nie Kalman: rozkład położenia jest
 * wielomodalny. Na skrzyżowaniu istnieją cztery sensowne hipotezy naraz,
 * a Kalman uśredniłby je do jednej pozycji w środku skrzyżowania —
 * czyli do miejsca, w którym pieszy na pewno nie stoi.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ZMIERZONE OGRANICZENIE — przeczytaj przed strojeniem parametrów.
 *
 * Gdy pieszy idzie siecią dróg, filtr redukuje błąd o ~92% (4,11% → 0,34%
 * przebytej drogi, 8/8 przebiegów). Gdy schodzi z sieci, nadal POGARSZA
 * wynik — ale od czasu odrzucania cofnięć (patrz `step`) nie robi tego
 * katastrofalnie i nie cofa widocznie estymaty.
 *
 * Mechanizm resztkowy: skrót przez park jest krótszy niż obejście ulicami.
 * PDR melduje 283 m kroków, a trasa wzdłuż ulic wymaga 400 m, więc filtr
 * trzymany przy drogach kończy przed rzeczywistym punktem — i ten błąd
 * zostaje, bo po wyjściu z parku żadna ulica nie jest lepsza od innej.
 *
 * Zmierzone na trasie mieszanej (2691 m, w tym ~280 m poza siecią):
 *   PDR 4,04% przebytej drogi, PDR+mapa 36,26% → po poprawce 10,97%.
 * Poza siecią dróg (2587 m przekątnymi): PDR 5,46%, PDR+mapa 21,80%.
 *
 * Przemiatanie mapTrust ∈ [0,2; 0,7], mapSigma ∈ [18; 45] i mapUpdateInterval
 * ∈ [1; 40] nie znalazło punktu pracy, który usuwa resztę — to ograniczenie
 * strukturalne, nie kwestia nastaw.
 *
 * Dlatego korekcja ręczna nie jest dodatkiem, tylko elementem konstrukcji:
 * jest jedynym mechanizmem odzyskiwania po utracie zaczepienia.
 * ─────────────────────────────────────────────────────────────────────
 */

export type Particle = {
  lat: number;
  lon: number;
  weight: number;
  /**
   * Trwały błąd kursu tej cząstki, w stopniach.
   *
   * Bez tego cząstki różniłyby się tylko szumem białym i cała chmura
   * dryfowałaby razem, co nie modelowałoby dominującego źródła błędu:
   * skorelowanego w czasie błędu kursu.
   */
  headingBias: number;
};

export type ParticleFilterOptions = {
  count?: number;
  /** Rozrzut początkowy wokół kotwicy, w metrach (1σ). */
  initialSpread?: number;
  /** Względny błąd długości kroku (1σ). */
  stepNoise?: number;
  /** Szum kursu na krok, w stopniach (1σ). */
  headingNoise?: number;
  /** Błądzenie losowe trwałego błędu kursu, w stopniach na krok (1σ). */
  headingBiasWalk?: number;
  /**
   * Tolerancja odległości od drogi, w metrach.
   *
   * Celowo hojna: pieszy chodzi chodnikiem, podwórzem i skrótem przez
   * trawnik, a nie osią jezdni. Zbyt mała wartość „przykleiłaby" estymatę
   * do ulicy nawet wtedy, gdy człowiek naprawdę z niej zszedł.
   */
  mapSigma?: number;
  /**
   * Zaufanie do mapy: prawdopodobieństwo a priori, że pieszy idzie drogą.
   *
   * Wiarygodność jest mieszanką dwóch hipotez:
   *   L = trust · exp(−d²/2σ²) + (1 − trust)
   *
   * Składnik stały to hipoteza „jestem poza drogą" i on ratuje filtr
   * w parku, na podwórzu i w otwartym terenie. Twarde ograniczenie bez
   * tego składnika ściąga estymatę na najbliższą ulicę nawet wtedy, gdy
   * pieszy naprawdę tam nie idzie — a w realnym użyciu prowadzi to
   * żołnierza w złe miejsce z wysoką pewnością siebie.
   */
  mapTrust?: number;
  /**
   * Co ile kroków stosować ograniczenie mapowe.
   *
   * Obserwacje mapowe w kolejnych krokach są silnie skorelowane: po
   * przejściu 75 cm jesteś przy tej samej ulicy co przed chwilą. Traktowanie
   * ich jako niezależnych dowodów mnoży ten sam argument tysiące razy i
   * rozkład zapada się na jednej hipotezie — również wtedy, gdy jest błędna.
   *
   * Stosowanie co K kroków odpowiada podniesieniu wiarygodności do potęgi
   * 1/K, czyli policzeniu skorelowanego dowodu raz zamiast K razy.
   */
  mapUpdateInterval?: number;
  /** Mnożnik wagi dla cząstki wewnątrz budynku. */
  buildingPenalty?: number;

  /**
   * Ile metrów wolno estymacie cofnąć się wbrew kierunkowi marszu
   * w jednej aktualizacji mapowej. Patrz `step`.
   */
  backtrackToleranceMeters?: number;


  /**
   * Siła „szorstkowania" po resamplingu (Gordon i in.).
   *
   * Resampling kopiuje cząstki o wysokiej wadze, więc kopie są identyczne
   * i chmura traci różnorodność. Bez szorstkowania filtr potrafi zamknąć
   * się na jednej hipotezie — a gdy jest ona błędna, ograniczenie mapowe
   * ją UTWIERDZA, bo równoległa ulica też jest ulicą.
   */
  roughening?: number;
  seed?: number;
};

const DEFAULTS = {
  count: 500,
  initialSpread: 8,
  stepNoise: 0.1,
  headingNoise: 5,
  headingBiasWalk: 0.8,
  mapSigma: 18,
  mapTrust: 0.7,
  mapUpdateInterval: 1,
  buildingPenalty: 0.02,
  backtrackToleranceMeters: 0.25,
  roughening: 0.2,
  seed: 0x5eed,
};

export class ParticleFilter {
  private particles: Particle[] = [];
  private readonly options: Required<ParticleFilterOptions>;
  private readonly rng: Rng;
  /** Licznik kroków od ostatniego zastosowania ograniczenia mapowego. */
  private stepsSinceMapUpdate = 0;


  constructor(options: ParticleFilterOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.rng = new Rng(this.options.seed);
  }

  /** Rozsiewa cząstki wokół znanej pozycji. */
  initialize(center: LatLon, spread = this.options.initialSpread): void {
    const { count } = this.options;
    this.stepsSinceMapUpdate = 0;
    this.particles = new Array(count);

    for (let i = 0; i < count; i++) {
      const offset = fromEnu(center, {
        e: this.rng.gauss(0, spread),
        n: this.rng.gauss(0, spread),
      });
      this.particles[i] = {
        lat: offset.lat,
        lon: offset.lon,
        weight: 1 / count,
        headingBias: this.rng.gauss(0, 2),
      };
    }
  }

  get isInitialized(): boolean {
    return this.particles.length > 0;
  }

  /**
   * Jeden krok filtru: propagacja, ważenie mapą, ewentualny resampling.
   *
   * @param stepLength długość kroku wg PDR, w metrach
   * @param heading    kurs wg PDR, w stopniach
   */
  step(
    stepLength: number,
    heading: number,
    graph: NavGraph | null,
    buildings: Buildings | null,
  ): void {
    if (this.particles.length === 0) return;

    this.propagate(stepLength, heading);

    if (!graph) return;

    this.stepsSinceMapUpdate++;
    if (this.stepsSinceMapUpdate < this.options.mapUpdateInterval) return;
    this.stepsSinceMapUpdate = 0;

    // Aktualizacja mapowa jest PRÓBNA — przyjmujemy ją tylko wtedy, gdy nie
    // cofa estymaty wbrew kierunkowi marszu.
    //
    // Uzasadnienie fizyczne: jedyną rzeczą, którą mierzymy wprost, jest to,
    // że pieszy zrobił krok DO PRZODU. Aktualizacja, po której raportowana
    // pozycja cofa się o kilkanaście metrów, zaprzecza temu pomiarowi —
    // nie jest poprawką, tylko artefaktem.
    //
    // Skąd on się bierze: wagi mnożą się przez kolejne kroki, a mieszanka
    // `mapTrust·onRoad + (1 − mapTrust)` daje cząstce „na drodze" przewagę
    // 1/(1 − mapTrust) ≈ 3,3 na krok. Gdy pieszy schodzi z sieci, cząstki
    // które ZOSTAŁY przy ostatniej ulicy zbierają tę przewagę setki razy
    // i resampling przenosi na nie całą chmurę — estymata wraca do
    // ostatniego punktu na drodze. Zmierzone na trasie 2,6 km przez
    // kwartały: do 1185 cofnięć i 1765 m ruchu wstecz.
    //
    // Odrzucane są SAME COFNIĘCIA, nie cała mapa. Ruch w bok i do przodu
    // przechodzi, więc dostrajanie do ulicy działa jak wcześniej.
    const before = this.estimate().position;
    const snapshot = this.particles.map((p) => ({ ...p }));

    this.weightByMap(graph, buildings);

    // Próg N/3, nie N/2: rzadszy resampling to wolniejsza utrata
    // różnorodności, a więc dłużej utrzymywane hipotezy alternatywne.
    if (this.effectiveSampleSize() < this.particles.length / 3) {
      this.resample();
    }

    const after = this.estimate().position;
    const moved = toEnu(before, after);
    const rad = (heading * Math.PI) / 180;
    const along = moved.e * Math.sin(rad) + moved.n * Math.cos(rad);

    if (along < -this.options.backtrackToleranceMeters) {
      this.particles = snapshot;
    }
  }


  private propagate(stepLength: number, heading: number): void {
    const { stepNoise, headingNoise, headingBiasWalk } = this.options;

    for (const particle of this.particles) {
      particle.headingBias += this.rng.gauss(0, headingBiasWalk);

      const length = stepLength * (1 + this.rng.gauss(0, stepNoise));
      const direction =
        heading + particle.headingBias + this.rng.gauss(0, headingNoise);
      const rad = (direction * Math.PI) / 180;

      const m = metersPerDegree(particle.lat);
      particle.lat += (Math.cos(rad) * length) / m.lat;
      particle.lon += (Math.sin(rad) * length) / m.lon;
    }
  }

  /**
   * Ważenie cząstek zgodnością z mapą.
   *
   * Waga jest USTAWIANA z bieżącego odczytu, a nie mnożona przez poprzednią —
   * i to jest cała poprawka.
   *
   * Mnożenie zakłada, że kolejne odczyty niosą niezależne dowody. Nie niosą:
   * cząstka leżąca na ulicy leży na niej także pół metra dalej, więc sto
   * kroków to sto razy ta sama informacja. Przy mieszance
   * `mapTrust·onRoad + (1 − mapTrust)` przewaga cząstki „na drodze" nad
   * cząstką „poza drogą" wynosi 1 / (1 − mapTrust) ≈ 3,3 na krok — niby
   * niewiele, ale mnożone przez sto kroków daje 3,3¹⁰⁰.
   *
   * Skutek był taki, że gdy pieszy schodził z sieci dróg, cząstki które
   * ZOSTAŁY przy ostatniej ulicy zbierały astronomiczną przewagę nad tymi,
   * które poszły za nim. Resampling utrwalał wynik i estymata wracała do
   * ostatniego punktu na drodze. Zmierzone na trasie 2,6 km przecinającej
   * kwartały: do 1185 cofnięć i 1765 m ruchu wstecz.
   *
   * To ten sam błąd, co kiedyś w estymatorze GNSS: pomiar skorelowany
   * w czasie potraktowany jak biały szum. Tam skutkiem była zawyżona
   * pewność, tu — chmura przyklejona do ostatniej ulicy.
   *
   * Sprawdzano też dwa inne tropy i oba są ślepe, więc nie warto do nich
   * wracać: próg odległości od drogi (przy 500 cząstkach MEDIANA odległości
   * najbliższej z nich wynosi 0,0 m nawet 50 m od jakiejkolwiek ulicy —
   * zawsze któraś stoi na drodze przypadkiem) oraz bramka na efektywnej
   * liczności chmury (pojedynczy krok zostawia ESS ≈ 0,75·N, więc nigdy
   * się nie domyka — zapaść jest skutkiem kumulacji, nie jednego kroku).
   */
  private weightByMap(graph: NavGraph, buildings: Buildings | null): void {
    const { mapSigma, mapTrust, buildingPenalty } = this.options;
    const twoSigmaSq = 2 * mapSigma * mapSigma;
    let total = 0;

    for (const particle of this.particles) {
      const point = { lat: particle.lat, lon: particle.lon };
      const d = graph.distanceToNearestWay(point);

      // Brak dróg w zasięgu (las, teren otwarty) — mapa nic nie wnosi
      // i filtr degeneruje się do czystego PDR.
      const onRoad = Number.isFinite(d) ? Math.exp(-(d * d) / twoSigmaSq) : 0;

      let likelihood = mapTrust * onRoad + (1 - mapTrust);

      // Budynek to jedyne ograniczenie twarde: przez ścianę się nie chodzi.
      if (buildings?.contains(point)) likelihood *= buildingPenalty;

      particle.weight *= likelihood;
      total += particle.weight;
    }

    if (total <= 0) {
      const uniform = 1 / this.particles.length;
      for (const particle of this.particles) particle.weight = uniform;
      return;
    }

    for (const particle of this.particles) particle.weight /= total;
  }

  /**
   * Efektywna liczba cząstek.
   *
   * Gdy waga skupia się w kilku cząstkach, reszta przestaje wnosić
   * informację i trzeba przepróbkować.
   */
  private effectiveSampleSize(): number {
    let sumSq = 0;
    for (const particle of this.particles) sumSq += particle.weight ** 2;
    return sumSq > 0 ? 1 / sumSq : 0;
  }

  /**
   * Resampling systematyczny.
   *
   * Wybrany zamiast wielomianowego, bo ma mniejszą wariancję i liniowy
   * koszt — istotne, skoro biegnie przy każdym kroku pieszego.
   */
  private resample(): void {
    const count = this.particles.length;
    const next: Particle[] = new Array(count);
    const start = this.rng.next() / count;

    // Rozrzut przed resamplingiem wyznacza skalę szorstkowania — chmura
    // szeroka potrzebuje mocniejszego rozmycia niż już skupiona.
    const spreadBefore = this.estimate().spread;
    const jitterMeters = Math.max(
      0.5,
      spreadBefore * this.options.roughening,
    );

    let cumulative = this.particles[0].weight;
    let source = 0;

    for (let i = 0; i < count; i++) {
      const target = start + i / count;
      while (target > cumulative && source < count - 1) {
        source++;
        cumulative += this.particles[source].weight;
      }
      const origin = this.particles[source];
      const m = metersPerDegree(origin.lat);

      next[i] = {
        lat: origin.lat + this.rng.gauss(0, jitterMeters) / m.lat,
        lon: origin.lon + this.rng.gauss(0, jitterMeters) / m.lon,
        weight: 1 / count,
        // Bez rozmycia obciążenia kursu kopie odziedziczyłyby ten sam błąd
        // systematyczny i chmura dryfowałaby dalej jako jedna bryła.
        headingBias: origin.headingBias + this.rng.gauss(0, 1.0),
      };
    }

    this.particles = next;
  }

  /** Estymata: średnia ważona położenia i rozrzut chmury jako niepewność. */
  estimate(): { position: LatLon; spread: number } {
    if (this.particles.length === 0) {
      return { position: { lat: 0, lon: 0 }, spread: Infinity };
    }

    let lat = 0;
    let lon = 0;
    for (const particle of this.particles) {
      lat += particle.lat * particle.weight;
      lon += particle.lon * particle.weight;
    }

    const m = metersPerDegree(lat);
    let variance = 0;
    for (const particle of this.particles) {
      const dLat = (particle.lat - lat) * m.lat;
      const dLon = (particle.lon - lon) * m.lon;
      variance += particle.weight * (dLat * dLat + dLon * dLon);
    }

    return { position: { lat, lon }, spread: Math.sqrt(variance) };
  }

  /** Podpróbkowana chmura do wizualizacji — 500 punktów na tick to za dużo. */
  sample(limit = 120): { lat: number; lon: number; w: number }[] {
    const stride = Math.max(1, Math.floor(this.particles.length / limit));
    const out: { lat: number; lon: number; w: number }[] = [];
    for (let i = 0; i < this.particles.length; i += stride) {
      const particle = this.particles[i];
      out.push({ lat: particle.lat, lon: particle.lon, w: particle.weight });
    }
    return out;
  }

  clear(): void {
    this.particles = [];
  }
}
