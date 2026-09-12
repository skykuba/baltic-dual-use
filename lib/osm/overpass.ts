import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Klient Overpass API z trwałym cache'em.
 *
 * Cache nie jest optymalizacją, tylko wymaganiem funkcjonalnym: scenariusz
 * zakłada, że dane mapowe pobiera się DOPÓKI jest łączność, a potem działa
 * bez niej. Raz pobrany kafel musi przetrwać restart serwera.
 */

const PRIMARY_URL =
  process.env.OVERPASS_URL ?? "http://localhost:12345/api/interpreter";

/**
 * Publiczne instancje Overpass jako zapas — DOMYŚLNIE WŁĄCZONE.
 *
 * Wcześniej zapas działał tylko po ustawieniu zmiennej środowiskowej, przez
 * co brak `.env.local` albo niewstały kontener oznaczał, że warstwa mapowa
 * nie pobiera się wcale. Na hakatonie to jest różnica między demem, które
 * działa, a demem zablokowanym na godzinę przed prezentacją.
 *
 * Publiczne instancje mają limity i odrzucają powtórzone zapytania, więc
 * NIE nadają się do stałej pracy — ale raz pobrane dane lądują w cache'u
 * na dysku i od tej chwili demo jest niezależne od sieci. Lokalna instancja
 * pozostaje źródłem pierwszego wyboru.
 */
const FALLBACK_URLS = (
  process.env.OVERPASS_FALLBACK_URL ??
  [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
  ].join(",")
)
  .split(",")
  .map((url) => url.trim())
  .filter(Boolean);

const CACHE_DIR = process.env.OSM_CACHE_DIR ?? ".cache/osm";

/** Wersja schematu cache'u — podbicie unieważnia wszystkie wpisy. */
const CACHE_VERSION = "v1";

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

export type OverpassResponse = {
  elements: OverpassElement[];
};

export type OverpassSource = "cache" | "local" | "fallback";

export type OverpassResult = {
  data: OverpassResponse;
  source: OverpassSource;
  elapsedMs: number;
};

/**
 * Wykonuje zapytanie Overpass QL.
 *
 * Kolejność: cache → lokalna instancja → publiczny fallback. Fallback jest
 * świadomie ostatni i tylko awaryjny — publiczna instancja ma limity
 * i odrzuca powtórzone zapytania, więc demo na niej nie może polegać.
 */
export async function overpassQuery(query: string): Promise<OverpassResult> {
  const started = Date.now();
  const key = cacheKey(query);

  const cached = await readCache(key);
  if (cached) {
    return { data: cached, source: "cache", elapsedMs: Date.now() - started };
  }

  const failures: string[] = [];

  try {
    const data = await post(PRIMARY_URL, query);
    await writeCache(key, data);
    return { data, source: "local", elapsedMs: Date.now() - started };
  } catch (error) {
    failures.push(`lokalna (${PRIMARY_URL}): ${describe(error)}`);
  }

  for (const url of FALLBACK_URLS) {
    try {
      const data = await post(url, query);
      await writeCache(key, data);
      return { data, source: "fallback", elapsedMs: Date.now() - started };
    } catch (error) {
      failures.push(`zapasowa (${url}): ${describe(error)}`);
    }
  }

  // Komunikat wymienia KAŻDE nieudane źródło. Pojedyncze „fetch failed"
  // nie mówi, czy padła instancja lokalna, czy zabrakło internetu.
  throw new Error(
    `Żadne źródło Overpass nie odpowiedziało.\n${failures.map((f) => `  • ${f}`).join("\n")}`,
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function post(url: string, query: string): Promise<OverpassResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: query }),
    // Overpass potrafi liczyć długo; własny timeout jest w samym zapytaniu.
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Overpass ${response.status} z ${url}: ${body.slice(0, 200)}`,
    );
  }

  return (await response.json()) as OverpassResponse;
}

function cacheKey(query: string): string {
  return createHash("sha256")
    .update(`${CACHE_VERSION}\n${query}`)
    .digest("hex")
    .slice(0, 32);
}

async function readCache(key: string): Promise<OverpassResponse | null> {
  try {
    const raw = await readFile(join(CACHE_DIR, `${key}.json`), "utf8");
    return JSON.parse(raw) as OverpassResponse;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: OverpassResponse): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(join(CACHE_DIR, `${key}.json`), JSON.stringify(data));
  } catch {
    // Nieudany zapis cache'u nie może wywrócić odpowiedzi — po prostu
    // następnym razem zapytamy ponownie.
  }
}

/** Czy lokalna instancja Overpass odpowiada. */
export async function checkOverpassHealth(): Promise<{
  ok: boolean;
  url: string;
  detail?: string;
}> {
  try {
    const response = await fetch(PRIMARY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ data: "[out:json][timeout:10];out count;" }),
      signal: AbortSignal.timeout(10_000),
    });
    return { ok: response.ok, url: PRIMARY_URL };
  } catch (error) {
    return {
      ok: false,
      url: PRIMARY_URL,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
