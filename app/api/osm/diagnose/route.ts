import {
  buildingsQuery,
  poiQuery,
  walkableWaysQuery,
  type BBox,
} from "@/lib/osm/queries";
import { bboxAround } from "@/lib/osm/mapData";
import { getEngine } from "@/lib/sim/engine";
import { getScenario } from "@/lib/sim/scenario";

/**
 * Diagnostyka warstwy mapowej.
 *
 * Gdy „pobierz obszar operacji" nie działa, przyczyn może być kilka i każda
 * wymaga innej naprawy: kontener nie wstał, import jeszcze trwa, zapytanie
 * jest odrzucane, albo odpowiedź jest tak duża, że się nie mieści. Ten
 * endpoint wykonuje każde zapytanie OSOBNO i raportuje status HTTP, czas,
 * rozmiar odpowiedzi i liczbę elementów — czyli dokładnie to, co pozwala
 * rozróżnić te przypadki bez zgadywania.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRIMARY_URL =
  process.env.OVERPASS_URL ?? "https://composedly-listless-tinley.ngrok-free.dev/api/interpreter";

type Probe = {
  name: string;
  ok: boolean;
  status: number | null;
  elapsedMs: number;
  bytes: number | null;
  elements: number | null;
  error: string | null;
  /** Początek odpowiedzi, gdy nie jest poprawnym JSON-em. */
  bodyPreview: string | null;
};

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const engine = getEngine();
  const scenario = getScenario(engine.status.scenarioId);

  // Domyślnie mały prostokąt wokół startu scenariusza — chodzi o to, żeby
  // odróżnić „Overpass nie działa" od „obszar jest za duży".
  const small = bboxAround([scenario.waypoints[0]], 300);
  const full = bboxAround(scenario.waypoints, 600);
  const bbox = url.searchParams.get("full") === "1" ? full : small;

  const probes: Probe[] = [];

  probes.push(
    await probe("łączność (out count)", "[out:json][timeout:25];out count;"),
  );
  probes.push(
    await probe(
      "czy baza ma dane (1 apteka)",
      `[out:json][timeout:25];node["amenity"="pharmacy"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});out 1;`,
    ),
  );
  probes.push(await probe("graf dróg", walkableWaysQuery(bbox)));
  probes.push(await probe("budynki", buildingsQuery(bbox)));
  probes.push(await probe("POI", poiQuery(bbox, 2)));

  const failing = probes.filter((p) => !p.ok);

  return Response.json({
    tiles: await probeTiles(),
    overpassUrl: PRIMARY_URL,
    envConfigured: Boolean(process.env.OVERPASS_URL),
    bbox,
    bboxSizeKm: bboxSizeKm(bbox),
    hint: hintFor(probes),
    probes,
    summary: failing.length === 0 ? "Wszystko działa" : `Nieudane: ${failing.length}/${probes.length}`,
  });
}

async function probe(name: string, query: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(PRIMARY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: query }),
      signal: AbortSignal.timeout(200_000),
    });

    const text = await response.text();
    const elapsedMs = Date.now() - started;

    if (!response.ok) {
      return {
        name,
        ok: false,
        status: response.status,
        elapsedMs,
        bytes: text.length,
        elements: null,
        error: `HTTP ${response.status}`,
        bodyPreview: text.slice(0, 400),
      };
    }

    try {
      const data = JSON.parse(text) as { elements?: unknown[] };
      return {
        name,
        ok: true,
        status: response.status,
        elapsedMs,
        bytes: text.length,
        elements: Array.isArray(data.elements) ? data.elements.length : null,
        error: null,
        bodyPreview: null,
      };
    } catch {
      // Overpass zwraca błędy jako HTML ze statusem 200 — bez podejrzenia
      // treści wyglądałoby to na zagadkowy błąd parsowania.
      return {
        name,
        ok: false,
        status: response.status,
        elapsedMs,
        bytes: text.length,
        elements: null,
        error: "Odpowiedź nie jest poprawnym JSON-em",
        bodyPreview: text.slice(0, 400),
      };
    }
  } catch (error) {
    return {
      name,
      ok: false,
      status: null,
      elapsedMs: Date.now() - started,
      bytes: null,
      elements: null,
      error: error instanceof Error ? error.message : String(error),
      bodyPreview: null,
    };
  }
}

/**
 * Sprawdzenie źródła kafli mapy bazowej.
 *
 * Osobno od Overpassa, bo to dwie niezależne warstwy i awaria każdej
 * wygląda inaczej: bez Overpassa nie ma map matchingu i POI, bez kafli
 * nie ma tła — ale kropki pozycji rysują się w obu przypadkach.
 *
 * Kafel „API KEY REQUIRED" przychodzi jako poprawny obrazek ze statusem
 * 200, więc jedyne, co daje się automatycznie sprawdzić, to rozmiar:
 * podkładki z takim komunikatem są charakterystycznie małe.
 */
async function probeTiles(): Promise<{
  sources: string[];
  ok: boolean;
  status: number | null;
  bytes: number | null;
  warning: string | null;
}> {
  const sources = (
    process.env.TILE_SOURCES ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const url = sources[0]
    .replace("{z}", "14")
    .replace("{x}", "8983")
    .replace("{y}", "5316");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "baltic-dual-use/0.1 (GPS-denied navigation demo)" },
      signal: AbortSignal.timeout(10_000),
    });
    const bytes = (await response.arrayBuffer()).byteLength;

    return {
      sources,
      ok: response.ok && bytes > 2000,
      status: response.status,
      bytes,
      warning: tileWarning(response.ok, response.status, bytes),
    };
  } catch (error) {
    return {
      sources,
      ok: false,
      status: null,
      bytes: null,
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

function tileWarning(ok: boolean, status: number, bytes: number): string | null {
  if (!ok) {
    return `Serwer kafli odpowiedział ${status}. Sprawdź łączność albo ustaw inne źródło przez TILE_SOURCES.`;
  }
  if (bytes <= 2000) {
    return "Kafel podejrzanie mały — źródło prawdopodobnie wymaga klucza API i zwraca podkładkę z komunikatem zamiast mapy. Taka podkładka przychodzi ze statusem 200, więc proxy zapisze ją do cache'u. Zmień TILE_SOURCES i wyczyść cache: rm -rf .cache/tiles";
  }
  return null;
}

function bboxSizeKm(bbox: BBox): { width: number; height: number } {
  const midLat = (bbox.north + bbox.south) / 2;
  return {
    width:
      Number((((bbox.east - bbox.west) * 111.32 * Math.cos((midLat * Math.PI) / 180))).toFixed(2)),
    height: Number(((bbox.north - bbox.south) * 111.32).toFixed(2)),
  };
}

/** Zamienia wzorzec nieudanych prób na konkretną podpowiedź. */
function hintFor(probes: Probe[]): string {
  const [connectivity, hasData, ways, buildings] = probes;

  if (!connectivity.ok) {
    return connectivity.error?.includes("fetch failed") ||
      connectivity.error?.includes("ECONNREFUSED")
      ? "Overpass nie odpowiada pod tym adresem. Sprawdź: docker ps | grep overpass — czy kontener działa i czy port zgadza się z OVERPASS_URL."
      : `Overpass odpowiada, ale błędem: ${connectivity.error}. Zajrzyj w docker logs overpass-pomorskie.`;
  }

  if (hasData.ok && hasData.elements === 0) {
    return "Overpass działa, ale baza jest pusta w tym obszarze — import prawdopodobnie jeszcze trwa albo objął inny region. Sprawdź docker logs.";
  }

  if (!ways.ok || !buildings.ok) {
    const failed = [ways, buildings].find((p) => !p.ok);
    return `Zapytanie „${failed?.name}" nie przeszło: ${failed?.error}. Podgląd odpowiedzi jest w polu bodyPreview.`;
  }

  const slow = probes.filter((p) => p.elapsedMs > 30_000);
  if (slow.length > 0) {
    return `Wszystko działa, ale wolno (${slow.map((p) => p.name).join(", ")}). Przy pełnym obszarze może przekroczyć limit czasu — spróbuj ?full=1, żeby to sprawdzić.`;
  }

  return "Wszystkie zapytania przechodzą. Jeśli pobieranie w interfejsie nadal pada, uruchom ten endpoint z ?full=1 — obszar całego scenariusza jest znacznie większy.";
}
