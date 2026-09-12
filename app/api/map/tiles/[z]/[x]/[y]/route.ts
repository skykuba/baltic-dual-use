import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Proxy kafli mapy bazowej z cache'em dyskowym.
 *
 * Dlaczego nie prosto z tile.openstreetmap.org do przeglądarki:
 *   - polityka użycia OSM zabrania kierowania tam ruchu aplikacji,
 *   - a przede wszystkim: cały sens projektu polega na działaniu bez sieci.
 *     Kafel raz pobrany zostaje na dysku serwera i od tej chwili mapa
 *     rysuje się nawet przy całkowitym odcięciu od internetu.
 *
 * To jest odpowiednik warstwy „pobierz, dopóki masz zasięg" dla tła mapy —
 * tak samo jak Overpass jest nią dla danych semantycznych.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TILE_CACHE_DIR = process.env.TILE_CACHE_DIR ?? ".cache/tiles";

/**
 * Źródła kafli. Pierwsze działające wygrywa.
 *
 * Domyślnie WYŁĄCZNIE tile.openstreetmap.org, bo to jedyne źródło, o którym
 * wiadomo na pewno, że nie wymaga klucza API. Dostawcy „darmowych" map
 * bywają darmowi warunkowo i potrafią to zmienić — a robią to w sposób
 * trudny do wykrycia: zamiast błędu HTTP zwracają poprawny obrazek
 * z napisem „API KEY REQUIRED". Proxy nie ma jak odróżnić takiego kafla
 * od prawdziwego, więc zapisuje go do cache'u na tydzień.
 *
 * Inne źródło ustawia się przez TILE_SOURCES (lista rozdzielona przecinkami).
 * Po zmianie trzeba wyczyścić cache: rm -rf .cache/tiles
 *
 * Ruch idzie przez nasz serwer i jest buforowany na dysku, więc nie
 * obciążamy OSM przy każdym odświeżeniu strony — to zresztą dokładnie
 * ten wzorzec, którego oczekuje ich polityka użycia.
 */
const TILE_SOURCES = (
  process.env.TILE_SOURCES ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_ZOOM = 19;

export async function GET(
  _request: Request,
  context: RouteContext<"/api/map/tiles/[z]/[x]/[y]">,
): Promise<Response> {
  const { z, x, y } = await context.params;

  const zoom = Number(z);
  const tileX = Number(x);
  // Rozszerzenie bywa doklejone przez MapLibre — obcinamy je przed parsowaniem.
  const tileY = Number(String(y).replace(/\.\w+$/, ""));

  if (!isValidTile(zoom, tileX, tileY)) {
    return new Response("Nieprawidłowe współrzędne kafla", { status: 400 });
  }

  const key = `${zoom}_${tileX}_${tileY}`;
  const cached = await readCache(key);
  if (cached) {
    return tileResponse(cached, "HIT");
  }

  for (const template of TILE_SOURCES) {
    const url = template
      .replace("{z}", String(zoom))
      .replace("{x}", String(tileX))
      .replace("{y}", String(tileY));

    try {
      const response = await fetch(url, {
        headers: {
          // Polityka OSM wymaga identyfikującego się klienta.
          "User-Agent": "baltic-dual-use/0.1 (GPS-denied navigation demo)",
          Accept: "image/png,image/*",
        },
        // Krótki limit: przy trzech źródłach w kolejce długie czekanie
        // na każde z nich potrafiłoby zablokować inicjalizację mapy
        // na kilkadziesiąt sekund.
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) continue;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength === 0) continue;

      await writeCache(key, buffer);
      return tileResponse(buffer, "MISS");
    } catch {
      // Próbujemy kolejnego źródła.
    }
  }

  // Brak kafla nie może wywrócić mapy — zwracamy przezroczysty placeholder,
  // żeby MapLibre nie powtarzał żądania w nieskończoność.
  return tileResponse(TRANSPARENT_PNG, "MISS-EMPTY", 200);
}

function isValidTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) {
    return false;
  }
  if (z < 0 || z > MAX_ZOOM) return false;
  const max = 2 ** z;
  return x >= 0 && x < max && y >= 0 && y < max;
}

function tileResponse(body: Buffer, cacheState: string, status = 200): Response {
  return new Response(new Uint8Array(body), {
    status,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=604800, immutable",
      "X-Tile-Cache": cacheState,
    },
  });
}

function cachePath(key: string): string {
  // Kafli są tysiące, więc rozpraszamy je po podkatalogach — jeden katalog
  // z dziesiątkami tysięcy plików potrafi zauważalnie spowolnić odczyt.
  const shard = createHash("md5").update(key).digest("hex").slice(0, 2);
  return join(TILE_CACHE_DIR, shard, `${key}.png`);
}

async function readCache(key: string): Promise<Buffer | null> {
  try {
    return await readFile(cachePath(key));
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: Buffer): Promise<void> {
  try {
    const path = cachePath(key);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, data);
  } catch {
    // Nieudany zapis cache'u nie może zepsuć odpowiedzi.
  }
}

/**
 * Pusty kafel 256×256, w pełni przezroczysty.
 *
 * Rozmiar musi zgadzać się z `tileSize` warstwy rastrowej. Kafel 1×1
 * jest formalnie poprawnym PNG, ale MapLibre traktuje niezgodność rozmiaru
 * jako błąd źródła — a źródło w stanie błędu potrafi zablokować
 * `isStyleLoaded()`, przez co NIE RYSUJĄ SIĘ TAKŻE warstwy wektorowe:
 * kropki pozycji, ślady i chmura cząstek. Mapa wygląda wtedy na martwą,
 * choć dane płyną poprawnie.
 */
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==",
  "base64",
);
