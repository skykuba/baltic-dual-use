"use client";

import { create } from "zustand";
import type { LatLon } from "@/lib/geo/types";
import type { GnssFix, SimCommand, SimStatus, SimTick } from "@/lib/types";

export type MapPoi = {
  id: string;
  lat: number;
  lon: number;
  priority: number;
  categoryId: string;
  name?: string;
};

/**
 * Znaczenie kliknięcia w mapę.
 *
 * Jedno pole zamiast kilku niezależnych flag: tryby się wykluczają, a przy
 * osobnych booleanach nic tego nie pilnowało — dało się włączyć korekcję
 * i wskazywanie celu naraz, po czym pierwszy klik obsługiwał ten tryb,
 * który akurat był wcześniej w kodzie, a drugi zostawał włączony na stałe.
 */
export type MapClickMode = "none" | "correction" | "destination";

export type NavRoute = {
  points: { lat: number; lon: number }[];
  /** Metry. */
  distance: number;
  /** Sekundy. */
  duration: number;
  to: { lat: number; lon: number };
};

/** Ile punktów śladu trzymamy. */
const TRAIL_LIMIT = 3000;

/**
 * Minimalny odstęp między kolejnymi punktami śladu, w metrach.
 *
 * Ticki lecą 10 razy na sekundę, więc przy tempie 1× kolejne pozycje dzieli
 * kilkanaście centymetrów. Bez progu limit 3000 punktów wyczerpuje się po
 * kilkuset metrach i ślad zaczyna znikać od początku — w demo wygląda to
 * jak błąd rysowania, a jest po prostu przepełnionym buforem.
 */
const MIN_TRAIL_STEP_M = 1.5;

/**
 * Skok estymaty, powyżej którego przerywamy ślad zamiast go łączyć.
 *
 * Korekcja ręczna przenosi pozycję o dziesiątki metrów w jednym kroku.
 * Połączenie tych punktów linią rysuje przez mapę odcinek, którego nikt
 * nie przeszedł — a to właśnie ten moment demo, który ma być czytelny.
 */
const TRAIL_BREAK_M = 15;
/** Ile ostatnich odczytów pokazuje podgląd czujników. */
const SENSOR_WINDOW = 80;

/**
 * Ślad jako lista rozłącznych odcinków.
 *
 * Jeden ciągły ślad nie wystarcza, bo trajektoria bywa przerywana:
 * korekcją ręczną, powrotem GNSS albo utratą sygnału.
 */
export type Trail = [number, number][][];

type SimState = {
  connected: boolean;
  status: SimStatus | null;
  tick: SimTick | null;

  truthTrail: Trail;
  gnssTrail: Trail;
  estimateTrail: Trail;

  /**
   * Ostatni odebrany fix GNSS.
   *
   * Odbiornik daje odczyt raz na sekundę, a ticki lecą dziesięć razy —
   * więc `tick.gnss` jest puste w dziewięciu tickach na dziesięć MIMO
   * poprawnego sygnału. Panel czytający je wprost migał komunikatem
   * „brak sygnału satelitarnego" dziesięć razy na sekundę, stojąc obok
   * napisu „GNSS". Ten sam błąd co kiedyś w estymatorze, tylko widoczny.
   */
  lastFix: GnssFix | null;

  /** Pionowe przyspieszenie do wykresu — surowy sygnał, na którym pracuje PDR. */
  accelWindow: number[];
  /** Historia błędu estymacji, do wykresu narastania dryfu. */
  errorWindow: number[];

  /** Co robi kliknięcie w mapę. */
  clickMode: MapClickMode;

  /**
   * Miejsca, w których operator skorygował pozycję.
   *
   * Stan `source: "manual"` trwa dokładnie jeden krok — już przy następnym
   * pozycja pochodzi znowu z PDR, więc fioletowy znacznik mignąłby na
   * ułamek sekundy. Trwała lista jest jedynym sposobem, żeby korekcja
   * została widoczna na mapie tam, gdzie jej dokonano.
   */
  corrections: { lat: number; lon: number }[];

  /** Punkty istotne kryzysowo — pobierane raz, po wczytaniu warstwy mapowej. */
  pois: MapPoi[];

  /**
   * Wskazany na mapie punkt docelowy.
   *
   * Trzymany po stronie klienta, a nie brany ze statusu silnika, bo znacznik
   * ma się pojawić W CHWILI kliknięcia. Silnik odpowiada dopiero po
   * przeliczeniu trasy marszu algorytmem A*, co przy dużym grafie trwa
   * zauważalnie długo — a przez ten czas wyglądałoby to jak zignorowany klik.
   */
  destination: LatLon | null;
  destinationMessage: string | null;

  /** Trasa nawigacyjna do celu, liczona od ESTYMOWANEJ pozycji. */
  route: NavRoute | null;
  routeError: string | null;
  routeLoading: boolean;

  setConnected: (v: boolean) => void;
  setStatus: (s: SimStatus) => void;
  pushTick: (t: SimTick) => void;
  setClickMode: (mode: MapClickMode) => void;
  setPois: (pois: MapPoi[]) => void;
  clearRoute: () => void;
};

export const useSimStore = create<SimState>((set) => ({
  connected: false,
  status: null,
  tick: null,
  truthTrail: [],
  gnssTrail: [],
  estimateTrail: [],
  lastFix: null,
  accelWindow: [],
  errorWindow: [],
  clickMode: "none",
  corrections: [],
  pois: [],
  destination: null,
  destinationMessage: null,
  route: null,
  routeError: null,
  routeLoading: false,

  setConnected: (connected) => set({ connected }),
  setStatus: (status) => set({ status }),

  pushTick: (tick) =>
    set((state) => {
      // Reset symulacji rozpoznajemy po cofnięciu numeru sekwencji.
      const isReset = state.tick !== null && tick.seq < state.tick.seq;
      if (isReset) {
        // Reset cofa silnik do scenariusza wyjściowego, więc cel wskazany
        // na mapie i trasa do niego przestają obowiązywać. Zostawienie ich
        // na mapie pokazywałoby trasę do punktu, do którego nikt już nie idzie.
        return {
          tick,
          truthTrail: [[[tick.truth.lon, tick.truth.lat]]],
          gnssTrail: [],
          estimateTrail: [[[tick.estimate.lon, tick.estimate.lat]]],
          corrections: [],
          lastFix: null,
          accelWindow: [],
          errorWindow: [],
          destination: null,
          destinationMessage: null,
          route: null,
          routeError: null,
        };
      }

      const az = Math.hypot(...tick.imu.accel);

      // Korekcję zapisujemy raz — przy przejściu w stan „manual",
      // a nie przy każdym ticku, w którym ten stan jeszcze trwa.
      const justCorrected =
        tick.estimate.source === "manual" &&
        state.tick?.estimate.source !== "manual";

      return {
        tick,
        // Fix pamiętamy dopóki estymata z niego korzysta; gdy źródłem staje
        // się PDR, sygnał naprawdę zniknął i pamięć trzeba wyczyścić.
        lastFix:
          tick.gnss ??
          (tick.estimate.source === "gnss" ? state.lastFix : null),
        corrections: justCorrected
          ? [...state.corrections, { lat: tick.estimate.lat, lon: tick.estimate.lon }]
          : state.corrections,
        truthTrail: push(state.truthTrail, [tick.truth.lon, tick.truth.lat]),
        // Ślad GNSS przerywamy na czas zagłuszenia — gdyby go połączyć,
        // powstałby odcinek sugerujący, że sygnał był cały czas.
        gnssTrail: tick.gnss
          ? push(state.gnssTrail, [tick.gnss.lon, tick.gnss.lat])
          : breakTrail(state.gnssTrail),
        estimateTrail: push(
          state.estimateTrail,
          [tick.estimate.lon, tick.estimate.lat],
          TRAIL_BREAK_M,
        ),
        accelWindow: pushNumber(state.accelWindow, az, SENSOR_WINDOW),
        errorWindow: pushNumber(
          state.errorWindow,
          tick.estimate.errorVsTruth,
          SENSOR_WINDOW * 3,
        ),
      };
    }),

  setClickMode: (clickMode) => set({ clickMode }),
  setPois: (pois) => set({ pois }),
  clearRoute: () => set({ route: null, routeError: null }),
}));

/**
 * Dopisuje punkt do ostatniego odcinka śladu.
 *
 * Punkt bliższy niż `MIN_TRAIL_STEP_M` od poprzedniego jest pomijany —
 * to jednocześnie odsiewa duplikaty (odczyt GNSS przychodzi raz na sekundę,
 * a ticki dziesięć razy, więc ta sama pozycja trafiałaby do śladu
 * wielokrotnie) i utrzymuje sensowny zasięg bufora.
 *
 * Przekroczenie `breakAbove` rozpoczyna nowy odcinek zamiast łączyć punkty.
 */
function push(
  trail: Trail,
  point: [number, number],
  breakAbove = Infinity,
): Trail {
  const segments = trail.slice();
  const last = segments[segments.length - 1];
  const lastPoint = last?.[last.length - 1];

  if (lastPoint) {
    const moved = metersBetween(lastPoint, point);
    if (moved < MIN_TRAIL_STEP_M) return trail;

    if (moved > breakAbove) {
      segments.push([point]);
      return trim(segments);
    }
    segments[segments.length - 1] = [...last, point];
    return trim(segments);
  }

  segments.push([point]);
  return trim(segments);
}

/** Zamyka bieżący odcinek, żeby kolejny punkt zaczął nowy. */
function breakTrail(trail: Trail): Trail {
  const last = trail[trail.length - 1];
  return last && last.length > 0 ? [...trail, []] : trail;
}

/** Odległość między punktami [lon, lat], w metrach. */
function metersBetween(a: [number, number], b: [number, number]): number {
  const latScale = Math.cos((a[1] * Math.PI) / 180);
  return Math.hypot((b[1] - a[1]) * 111_320, (b[0] - a[0]) * 111_320 * latScale);
}

/** Przycina ślad do limitu punktów, odrzucając najstarsze odcinki. */
function trim(segments: Trail): Trail {
  let total = 0;
  for (const segment of segments) total += segment.length;
  if (total <= TRAIL_LIMIT) return segments;

  const out = segments.slice();
  while (total > TRAIL_LIMIT && out.length > 0) {
    const first = out[0];
    if (first.length <= 1) {
      total -= first.length;
      out.shift();
    } else {
      out[0] = first.slice(1);
      total -= 1;
    }
  }
  return out;
}

function pushNumber(window: number[], value: number, limit: number): number[] {
  const next = window.length >= limit ? window.slice(1) : window.slice();
  next.push(value);
  return next;
}

/**
 * Wysyła polecenie do silnika symulacji i od razu przyjmuje nowy status.
 *
 * Odpowiedź zawiera pełny status, więc wyrzucanie jej i czekanie na kolejne
 * odpytanie (raz na sekundę) oznaczało, że po naciśnięciu Start przycisk
 * przez chwilę dalej pokazywał „Start". Wyglądało to jak zignorowany klik.
 */
export async function sendCommand(body: SimCommand): Promise<void> {
  try {
    const response = await fetch("/api/sim/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) return;
    useSimStore.getState().setStatus((await response.json()) as SimStatus);
  } catch {
    // Zerwane połączenie sygnalizuje już strumień SSE.
  }
}

/**
 * Pobiera warstwę mapową, a po jej wczytaniu — listę POI.
 *
 * Zwraca komunikat do pokazania użytkownikowi, bo to jedyna operacja
 * w interfejsie, która może trwać sekundy i realnie się nie udać.
 */
export async function loadMapLayer(): Promise<string> {
  const response = await fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "loadMap" }),
  });

  const status = (await response.json()) as SimStatus & {
    mapLoad?: { ok: boolean; detail: string };
  };
  useSimStore.getState().setStatus(status);

  if (!status.mapLoad?.ok) {
    return status.mapLoad?.detail ?? "Nie udało się pobrać mapy";
  }

  await refreshPois();
  return status.mapLoad.detail;
}

/**
 * Wskazuje punkt docelowy: znacznik na mapie i nowy cel marszu pieszego.
 *
 * Kolejność jest tu istotna. Najpierw, synchronicznie, ląduje w store'ze
 * sam punkt — żeby znacznik pojawił się natychmiast po kliknięciu. Dopiero
 * potem silnik przelicza trasę marszu, co trwa. Odwrotna kolejność dawała
 * kilkusekundową ciszę, w której interfejs nie potwierdzał kliknięcia
 * niczym poza zniknięciem kursora celownika.
 *
 * Trasa nawigacyjna NIE jest tu wyznaczana — to osobny krok („Wyznacz
 * trasę"), bo liczy się ją od pozycji ESTYMOWANEJ i operator ma prawo
 * zobaczyć ją dopiero wtedy, kiedy jej potrzebuje.
 */
export async function setDestination(to: LatLon): Promise<void> {
  useSimStore.setState({
    destination: to,
    destinationMessage: "Wyznaczanie trasy marszu…",
    // Stara trasa prowadziła gdzie indziej — zostawiona na mapie kłamałaby.
    route: null,
    routeError: null,
  });

  try {
    const response = await fetch("/api/sim/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "setDestination", lat: to.lat, lon: to.lon }),
    });
    const status = (await response.json()) as SimStatus & {
      destinationSet?: { ok: boolean; detail: string };
    };
    const result = status.destinationSet;

    useSimStore.setState({
      status,
      destinationMessage: result?.detail ?? null,
      // Punkt poza siecią dróg nie jest celem — znika też znacznik,
      // inaczej „Wyznacz trasę" celowałoby w miejsce, którego silnik odrzucił.
      destination: result?.ok === false ? null : to,
    });
  } catch {
    useSimStore.setState({
      destination: null,
      destinationMessage: "Brak połączenia z serwerem",
    });
  }
}

/**
 * Wyznacza trasę nawigacyjną do wskazanego wcześniej celu.
 *
 * Start bierze się z estymowanej pozycji po stronie serwera, a nie stąd —
 * front nie ma powodu decydować, gdzie „jesteśmy".
 */
export async function requestRoute(): Promise<void> {
  const to = useSimStore.getState().destination;
  if (!to) {
    useSimStore.setState({ routeError: "Najpierw wskaż miejsce docelowe" });
    return;
  }

  useSimStore.setState({ routeLoading: true, routeError: null });
  try {
    const response = await fetch("/api/nav/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    const data = (await response.json()) as {
      route?: { points: { lat: number; lon: number }[]; distance: number; duration: number };
      error?: string;
    };

    if (!response.ok || !data.route) {
      useSimStore.setState({
        route: null,
        routeError: data.error ?? "Nie udało się wyznaczyć trasy",
      });
      return;
    }

    useSimStore.setState({ route: { ...data.route, to }, routeError: null });
  } catch {
    useSimStore.setState({ route: null, routeError: "Brak połączenia z serwerem" });
  } finally {
    useSimStore.setState({ routeLoading: false });
  }
}

export async function refreshPois(): Promise<void> {
  try {
    const response = await fetch("/api/osm/poi?priority=2");
    if (!response.ok) return;
    const data = (await response.json()) as { pois: MapPoi[] };
    useSimStore.getState().setPois(data.pois);
  } catch {
    // Brak POI nie blokuje niczego innego w interfejsie.
  }
}
