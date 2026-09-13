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

/**
 * Czy operator w ogóle skonfigurował własną instancję.
 *
 * Bez `.env.local` zmienna jest pusta i lecimy na adres domyślny — co
 * w komunikacie o błędzie wygląda jak „lokalna instancja nie odpowiada",
 * a naprawdę znaczy „nikt nie powiedział, gdzie ona jest". To dwie różne
 * awarie i tylko jedna z nich ma sens naprawiać na serwerze.
 */
const PRIMARY_CONFIGURED = Boolean(process.env.OVERPASS_URL?.trim());

/**
 * Adres instancji, doprowadzony do postaci, którą Overpass faktycznie
 * obsługuje.
 *
 * Sam host — `https://cos.ngrok-free.dev/` — to najczęstsza pomyłka przy
 * konfiguracji: POST leci wtedy na stronę główną, a ta odpowiada HTML-em
 * albo XML-em, co wychodzi dopiero przy parsowaniu JSON-a jako
 * „Unexpected token '<'". Ścieżkę dopisujemy sami, zamiast kazać komuś
 * zgadywać przy komunikacie, który o niej nie wspomina.
 */
const PRIMARY_URL = withInterpreterPath(
  process.env.OVERPASS_URL?.trim() || "http://localhost:12345/api/interpreter",
);

function withInterpreterPath(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/api/interpreter";
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Nagłówek User-Agent.
 *
 * Publiczne instancje Overpass tego wymagają i mówią to wprost: kumi.systems
 * odpowiada 429 z prośbą o „meaningful User-Agent", a overpass-api.de
 * odrzuca ruch bez niego przez 406. Node domyślnie nie wysyła żadnego,
 * więc zapas — jedyne, co zostaje, gdy własna instancja nie wstała —
 * nie działał ANI RAZU, mimo że w kodzie był.
 */
const USER_AGENT =
  process.env.OVERPASS_USER_AGENT ??
  "baltic-dual-use/0.1 (demo nawigacji GPS-denied; kontakt przez repozytorium)";

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
export async function overpassQuery(
  query: string,
  options: { cacheOnly?: boolean } = {},
): Promise<OverpassResult | null> {
  const started = Date.now();
  const key = cacheKey(query);

  const cached = await readCache(key);
  if (cached) {
    return { data: cached, source: "cache", elapsedMs: Date.now() - started };
  }

  // Bez łączności nie ma po co próbować sieci: każda próba to czekanie na
  // limit czasu, a odpowiedzi i tak nie będzie. `null` znaczy „tego kafla
  // nie mamy i teraz nie zdobędziemy".
  if (options.cacheOnly) return null;

  const failures: string[] = [];

  try {
    const data = await post(PRIMARY_URL, query);
    await writeCache(key, data);
    return { data, source: "local", elapsedMs: Date.now() - started };
  } catch (error) {
    failures.push(
      PRIMARY_CONFIGURED
        ? `skonfigurowana (${PRIMARY_URL}): ${describe(error)}`
        : `BRAK KONFIGURACJI: nie ustawiono OVERPASS_URL, więc próbowano ` +
          `adresu domyślnego (${PRIMARY_URL}). Utwórz .env.local — ` +
          `Next.js nie czyta pliku env.example.`,
    );
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
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: query }),
    // Overpass potrafi liczyć długo; własny timeout jest w samym zapytaniu.
    signal: AbortSignal.timeout(120_000),
  });

  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Overpass ${response.status} z ${url}: ${summarize(body)}`);
  }

  // Odpowiedź czytamy jako tekst i dopiero parsujemy.
  //
  // Overpass potrafi oddać HTTP 200 ze stroną błędu w XML-u albo HTML-u —
  // wtedy `response.json()` rzuca „Unexpected token '<'", co nie mówi ani
  // co odpowiedziało, ani że w ogóle nie był to Overpass. Z tekstem w ręku
  // możemy pokazać początek odpowiedzi.
  try {
    return JSON.parse(body) as OverpassResponse;
  } catch {
    throw new Error(
      `${url} nie zwrócił JSON-a (czy to na pewno adres /api/interpreter?): ${summarize(body)}`,
    );
  }
}

/** Pierwsza linijka treści odpowiedzi, przycięta do czytelnej długości. */
function summarize(body: string): string {
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
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
