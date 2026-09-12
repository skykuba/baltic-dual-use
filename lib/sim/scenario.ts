import type { LatLon, TerrainKind } from "@/lib/geo/types";
import { distance } from "@/lib/geo/projection";

export type Waypoint = LatLon & {
  /** Rodzaj terenu na odcinku PROWADZĄCYM DO tego punktu. */
  terrain: TerrainKind;
  label?: string;
};

export type Scenario = {
  id: string;
  name: string;
  description: string;
  /** m/s — typowe tempo marszu pieszego z obciążeniem. */
  walkSpeed: number;
  waypoints: Waypoint[];
  /** Sugerowany moment zagłuszenia GNSS, w sekundach od startu. */
  suggestedJammingAt: number;
};

/**
 * Trójmiasto: od Katedry Oliwskiej przez Park Oliwski w Dolinę Radości
 * i dalej w Trójmiejski Park Krajobrazowy.
 *
 * Trasa celowo przechodzi z gęstej zabudowy w las, bo to właśnie tam
 * widać różnicę: w mieście map matching przykleja estymatę do ulic,
 * w lesie ograniczeń nie ma i dryf narasta swobodnie.
 */
const TROJMIASTO_MIXED: Scenario = {
  id: "trojmiasto-mixed",
  name: "Oliwa → Trójmiejski Park Krajobrazowy",
  description:
    "Teren mieszany: zabudowa Oliwy, potem dolina i las. Pokazuje, jak jakość estymacji zależy od dostępności ograniczeń mapowych.",
  walkSpeed: 1.35,
  suggestedJammingAt: 60,
  waypoints: [
    { lat: 54.4103, lon: 18.5613, terrain: "urban", label: "Katedra Oliwska" },
    { lat: 54.4118, lon: 18.5588, terrain: "urban", label: "ul. Cystersów" },
    { lat: 54.4131, lon: 18.5556, terrain: "urban", label: "Park Oliwski" },
    { lat: 54.4149, lon: 18.5502, terrain: "urban", label: "ul. Kwietna" },
    { lat: 54.4167, lon: 18.5451, terrain: "urban", label: "Wjazd w dolinę" },
    { lat: 54.4186, lon: 18.5398, terrain: "forest", label: "Dolina Radości" },
    { lat: 54.4209, lon: 18.5352, terrain: "forest", label: "Ścieżka leśna" },
    { lat: 54.4238, lon: 18.5310, terrain: "forest", label: "Rozwidlenie" },
    { lat: 54.4266, lon: 18.5281, terrain: "forest", label: "Punkt docelowy" },
  ],
};

/** Wariant czysto miejski — najlepszy pokaz map matchingu. */
const GDANSK_URBAN: Scenario = {
  id: "gdansk-urban",
  name: "Gdańsk Główne Miasto",
  description:
    "Gęsta siatka ulic. Ograniczenia mapowe są silne, więc filtr cząsteczkowy utrzymuje estymatę na ulicy mimo narastającego dryfu kursu.",
  walkSpeed: 1.3,
  suggestedJammingAt: 45,
  waypoints: [
    { lat: 54.3487, lon: 18.6531, terrain: "urban", label: "Złota Brama" },
    { lat: 54.3496, lon: 18.6556, terrain: "urban", label: "Długi Targ" },
    { lat: 54.3505, lon: 18.6583, terrain: "urban", label: "Zielona Brama" },
    { lat: 54.3521, lon: 18.6570, terrain: "urban", label: "Długie Pobrzeże" },
    { lat: 54.3538, lon: 18.6545, terrain: "urban", label: "Żuraw" },
    { lat: 54.3552, lon: 18.6512, terrain: "urban", label: "ul. Szeroka" },
    { lat: 54.3561, lon: 18.6478, terrain: "urban", label: "Hala Targowa" },
  ],
};

/** Wariant leśny — najgorszy przypadek, dryf bez ograniczeń. */
const FOREST_ONLY: Scenario = {
  id: "tpk-forest",
  name: "Trójmiejski Park Krajobrazowy",
  description:
    "Teren otwarty i leśny, rzadka siatka ścieżek. Najtrudniejszy przypadek — pokazuje granice metody i rolę korekcji ręcznej.",
  walkSpeed: 1.2,
  suggestedJammingAt: 30,
  waypoints: [
    { lat: 54.4286, lon: 18.5254, terrain: "forest", label: "Start" },
    { lat: 54.4318, lon: 18.5208, terrain: "forest" },
    { lat: 54.4349, lon: 18.5171, terrain: "forest" },
    { lat: 54.4377, lon: 18.5122, terrain: "open", label: "Polana" },
    { lat: 54.4402, lon: 18.5079, terrain: "forest" },
    { lat: 54.4431, lon: 18.5041, terrain: "forest", label: "Punkt docelowy" },
  ],
};

export const SCENARIOS: Scenario[] = [
  TROJMIASTO_MIXED,
  GDANSK_URBAN,
  FOREST_ONLY,
];

export const DEFAULT_SCENARIO_ID = TROJMIASTO_MIXED.id;

export function getScenario(id: string): Scenario {
  return SCENARIOS.find((s) => s.id === id) ?? TROJMIASTO_MIXED;
}

/** Skumulowane długości odcinków — liczone raz, używane przy każdym ticku. */
export type ScenarioPath = {
  scenario: Scenario;
  /** `cumulative[i]` = dystans od startu do waypointu `i`. */
  cumulative: number[];
  totalLength: number;
};

export function buildPath(scenario: Scenario): ScenarioPath {
  const cumulative: number[] = [0];
  for (let i = 1; i < scenario.waypoints.length; i++) {
    cumulative.push(
      cumulative[i - 1] +
        distance(scenario.waypoints[i - 1], scenario.waypoints[i]),
    );
  }
  return {
    scenario,
    cumulative,
    totalLength: cumulative[cumulative.length - 1],
  };
}

export type PathSample = {
  position: LatLon;
  /** Azymut ruchu w stopniach od północy. */
  heading: number;
  terrain: TerrainKind;
  /** Czy trasa się skończyła. */
  finished: boolean;
};

/** Pozycja na trasie po przebyciu `s` metrów od startu. */
export function sampleAt(path: ScenarioPath, s: number): PathSample {
  const { waypoints } = path.scenario;
  const clamped = Math.min(Math.max(s, 0), path.totalLength);

  let i = 1;
  while (i < path.cumulative.length - 1 && path.cumulative[i] < clamped) i++;

  const segStart = waypoints[i - 1];
  const segEnd = waypoints[i];
  const segLen = path.cumulative[i] - path.cumulative[i - 1];
  const t = segLen > 0 ? (clamped - path.cumulative[i - 1]) / segLen : 0;

  return {
    position: {
      lat: segStart.lat + (segEnd.lat - segStart.lat) * t,
      lon: segStart.lon + (segEnd.lon - segStart.lon) * t,
    },
    heading: headingOfSegment(segStart, segEnd),
    terrain: segEnd.terrain,
    finished: clamped >= path.totalLength,
  };
}

function headingOfSegment(a: LatLon, b: LatLon): number {
  const latScale = Math.cos((a.lat * Math.PI) / 180);
  const deg = (Math.atan2((b.lon - a.lon) * latScale, b.lat - a.lat) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
