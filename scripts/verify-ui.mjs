/**
 * Weryfikacja interfejsu w prawdziwej przeglądarce.
 *
 * Typecheck i testy jednostkowe nie odpowiadają na pytania, które w tym
 * projekcie decydują o demie: czy mapa się w ogóle renderuje, skąd lecą
 * kafle i czy obie kropki — rzeczywista i estymowana — są na niej widoczne.
 *
 * Uruchamia serwer deweloperski (musi już działać) i otwiera stronę
 * w Chromium, notując każde żądanie sieciowe i każdy błąd konsoli.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL = process.env.UI_URL ?? "http://localhost:3000/";
const SHOT = process.env.UI_SHOT ?? "/tmp/ui.png";

// Kontener ma własnego Chromium pod stałą ścieżką, a wersja pakietu
// playwright z npm nie musi się z nim zgadzać. Wskazujemy binarkę wprost,
// zamiast pobierać drugą kopię przeglądarki.
const browser = await chromium.launch({
  executablePath:
    process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const requests = [];
const consoleErrors = [];
const pageErrors = [];

page.on("request", (r) => requests.push({ url: r.url(), type: r.resourceType() }));
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => pageErrors.push(e.message));

// NIE "networkidle": strumień SSE jest trwałym połączeniem, więc sieć
// nigdy nie staje się bezczynna i oczekiwanie kończy się limitem czasu.
await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60_000 });

// Czekamy na kanwę MapLibre, a potem dajemy chwilę na kafle i pierwsze ticki.
await page.waitForSelector(".maplibregl-canvas", { timeout: 30_000 });
await page.waitForTimeout(8000);

// ── Skąd lecą kafle ──────────────────────────────────────────────────────
const tileRequests = requests.filter((r) => r.url.includes("/api/map/tiles/"));
const externalTiles = requests.filter(
  (r) =>
    /tile\.openstreetmap|cartocdn|opentopomap|basemaps\./.test(r.url) &&
    !r.url.includes("/api/map/tiles/"),
);

// ── Czy warstwy danych powstały ──────────────────────────────────────────
const layers = await page.evaluate(() => {
  const canvas = document.querySelector(".maplibregl-canvas");
  return {
    canvasPresent: Boolean(canvas),
    canvasWidth: canvas?.clientWidth ?? 0,
    canvasHeight: canvas?.clientHeight ?? 0,
    controlsPresent: Boolean(document.querySelector(".maplibregl-ctrl")),
  };
});

// Kropki wykrywamy ze zrzutu ekranu, a nie przez readPixels: MapLibre
// nie zachowuje bufora rysowania (preserveDrawingBuffer: false), więc
// odczyt pikseli poza klatką renderowania zwraca pustkę.
// ── Czy interfejs ma to, co ma mieć ──────────────────────────────────────
const text = await page.innerText("body");
const expected = [
  "Nawigacja w środowisku GPS-denied",
  "Pozycja rzeczywista",
  "Pozycja estymowana",
  "Pobierz obszar operacji",
  "Zmień cel marszu",
  "Skoryguj pozycję",
];
const missing = expected.filter((t) => !text.includes(t));

await page.screenshot({ path: SHOT, fullPage: false });

// Kropki liczymy z pliku zrzutu, osobnym skryptem — patrz analyze-shot.py.


console.log("═══ Interfejs w przeglądarce ═══\n");
console.log(`  kanwa mapy:        ${layers.canvasPresent && layers.canvasHeight > 500 ? "✓" : "✗"} ${layers.canvasWidth}×${layers.canvasHeight}`);
console.log(`  kontrolki MapLibre:${layers.controlsPresent ? " ✓" : " ✗"}`);
console.log(`  brakujące napisy:  ${missing.length === 0 ? "✓ żadnych" : "✗ " + missing.join(", ")}`);



console.log("\n═══ Skąd lecą kafle ═══\n");
console.log(`  przez nasze API (/api/map/tiles): ${tileRequests.length}`);
console.log(`  bezpośrednio do serwerów kafli:   ${externalTiles.length} ${externalTiles.length === 0 ? "✓" : "✗ (przeglądarka nie powinna tam chodzić)"}`);
if (tileRequests.length > 0) {
  console.log(`  przykład: ${tileRequests[0].url.replace(URL.replace(/\/$/, ""), "")}`);
}

console.log("\n═══ Błędy ═══\n");
if (pageErrors.length === 0 && consoleErrors.length === 0) {
  console.log("  ✓ brak błędów strony i konsoli");
} else {
  for (const e of pageErrors) console.log(`  ✗ [strona] ${e}`);
  for (const e of consoleErrors.slice(0, 12)) console.log(`  ✗ [konsola] ${e}`);
  if (consoleErrors.length > 12) console.log(`  … i ${consoleErrors.length - 12} więcej`);
}

console.log(`\n  zrzut ekranu: ${SHOT}`);

writeFileSync(
  "/tmp/ui-requests.json",
  JSON.stringify({ requests, consoleErrors, pageErrors }, null, 2),
);

await browser.close();

const ok =
  layers.canvasPresent &&
  layers.canvasHeight > 500 &&
  missing.length === 0 &&
  externalTiles.length === 0 &&
  pageErrors.length === 0;
console.log(ok ? "\n✓ Weryfikacja interfejsu zaliczona" : "\n✗ Weryfikacja interfejsu nieudana");
process.exit(ok ? 0 : 1);
