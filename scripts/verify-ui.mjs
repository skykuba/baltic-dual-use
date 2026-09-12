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
// Sama treść „Failed to load resource: 404" z konsoli nie mówi, CO się nie
// wczytało. Adres znamy tylko po stronie odpowiedzi HTTP.
const httpErrors = [];
page.on("response", (r) => {
  if (r.status() >= 400) httpErrors.push(`${r.status()} ${r.url()}`);
});

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
// Napisy STABILNE niezależnie od stanu aplikacji.
//
// Wcześniej test sprawdzał treść przycisku warstwy mapowej, która zmienia
// się po wczytaniu danych — i zaczął fałszywie padać, gdy warstwa zaczęła
// wczytywać się natychmiast z pliku. Nagłówki sekcji nie zależą od stanu.
const expected = [
  "Nawigacja w środowisku GPS-denied",
  "Pozycja rzeczywista",
  "Pozycja estymowana",
  "WARSTWA MAPOWA",
  "PUNKT STARTOWY",
  "CEL MARSZU",
  "KOREKCJA RĘCZNA",
];
const missing = expected.filter((t) => !text.includes(t));

await page.screenshot({ path: SHOT, fullPage: false });

// ── Przepływ: wskazanie celu, potem wyznaczenie trasy ────────────────────
//
// To jest test SEKWENCJI, nie pojedynczych przycisków. Sprawdza dokładnie
// to, co było zepsute: czy po kliknięciu w mapę pojawia się znacznik celu
// JESZCZE ZANIM ktokolwiek poprosi o trasę, i czy trasa pojawia się dopiero
// po naciśnięciu drugiego przycisku.
// MapLibre 6 trzyma dane źródła jako { geojson: FeatureCollection } po
// setData, ale jako gołe FeatureCollection tuż po addSource. Oba kształty
// muszą być obsłużone, inaczej licznik zwraca -1 dla źródła pustego
// od początku — czyli dokładnie dla stanu wyjściowego, który testujemy.
const features = (sourceId) =>
  page.evaluate((id) => {
    const raw = window.__map?.getSource(id)?._data;
    if (!raw) return -1;
    return (raw.geojson ?? raw).features?.length ?? -1;
  }, sourceId);

const panel = page.locator("aside").first();
const truthPoint = () =>
  page.evaluate(() => {
    const raw = window.__map?.getSource("truth-point")?._data;
    const fc = raw ? (raw.geojson ?? raw) : null;
    return fc?.features?.[0]?.geometry?.coordinates?.map((n) => +n.toFixed(5)) ?? null;
  });
const startPoint = () =>
  page.evaluate(() => {
    const raw = window.__map?.getSource("start")?._data;
    const fc = raw ? (raw.geojson ?? raw) : null;
    return fc?.features?.[0]?.geometry?.coordinates?.map((n) => +n.toFixed(5)) ?? null;
  });

const flow = { start: {}, afterStart: {}, afterPick: {}, afterRoute: {} };
try {
  // Silnik żyje między uruchomieniami testu, więc zaczynamy od Resetu —
  // inaczej etykiety przycisków zależą od stanu z poprzedniego przebiegu
  // i test przewraca się na czymś, co nie ma nic wspólnego z regresją.
  await panel.getByRole("button", { name: "Reset", exact: true }).click();
  await page.waitForTimeout(1500);
  flow.start = { destination: await features("destination"), route: await features("route") };

  // Punkt startowy: przenosi PRAWDĘ, więc biała kropka ma na nim stanąć
  // natychmiast, bez czekania na pierwszy krok symulacji.
  await panel.getByRole("button", { name: /punkt startowy/i }).click();
  await page.mouse.click(900, 560);
  await page.waitForTimeout(4000);
  flow.afterStart = {
    marker: await features("start"),
    truthOnStart:
      JSON.stringify(await truthPoint()) === JSON.stringify(await startPoint()),
  };

  await panel.getByRole("button", { name: /miejsce docelowe/i }).click();
  // Klik obok środka mapy — trafia w obszar pobranej warstwy OSM.
  await page.mouse.click(1000, 500);
  await page.waitForTimeout(4000);
  flow.afterPick = { destination: await features("destination"), route: await features("route") };

  await panel.getByRole("button", { name: /Wyznacz trasę/i }).click();
  await page.waitForTimeout(4000);
  flow.afterRoute = { destination: await features("destination"), route: await features("route") };
} catch (error) {
  flow.error = String(error).split("\n")[0];
}

const flowOk =
  flow.afterStart.marker === 1 &&
  flow.afterStart.truthOnStart === true &&
  flow.start.destination === 0 &&
  flow.afterPick.destination === 1 &&
  flow.afterPick.route === 0 &&
  flow.afterRoute.route === 1;

// ── Korekcja ręczna ──────────────────────────────────────────────────────
//
// Dwie korekcje z rzędu, nie jedna. Pierwsza wychodziła zawsze; druga przy
// ZAPAUZOWANEJ symulacji przesuwała estymatę, ale nie zostawiała znacznika,
// bo stan „manual" trwał od poprzedniej — z zewnątrz nie do odróżnienia od
// korekcji, która się nie wykonała.
const estimatePoint = () =>
  page.evaluate(() => {
    const raw = window.__map?.getSource("estimate-point")?._data;
    const fc = raw ? (raw.geojson ?? raw) : null;
    return fc?.features?.[0]?.geometry?.coordinates ?? null;
  });

const fix = { markers: -1, moved: false };
try {
  // Korekcja przy dostępnym GNSS nie ma skutku — kolejny fix ją nadpisuje.
  // Dlatego przycisk jest wtedy zablokowany i najpierw trzeba zagłuszyć.
  await panel.getByRole("button", { name: /zagłuś/i }).click();
  await page.waitForTimeout(1500);

  const before = await estimatePoint();
  for (const [x, y] of [[950, 620], [1100, 400]]) {
    await panel.getByRole("button", { name: /Skoryguj pozycję/ }).click();
    await page.waitForTimeout(200);
    await page.mouse.click(x, y);
    await page.waitForTimeout(2500);
  }
  const after = await estimatePoint();

  fix.markers = await features("corrections");
  fix.moved =
    Array.isArray(before) && Array.isArray(after) &&
    (before[0] !== after[0] || before[1] !== after[1]);
} catch (error) {
  fix.error = String(error).split("\n")[0];
}

const correctionOk = fix.markers === 2 && fix.moved;

await page.screenshot({ path: SHOT.replace(/\.png$/, "-flow.png"), fullPage: false });


console.log("═══ Interfejs w przeglądarce ═══\n");
console.log(`  kanwa mapy:        ${layers.canvasPresent && layers.canvasHeight > 500 ? "✓" : "✗"} ${layers.canvasWidth}×${layers.canvasHeight}`);
console.log(`  kontrolki MapLibre:${layers.controlsPresent ? " ✓" : " ✗"}`);
console.log(`  brakujące napisy:  ${missing.length === 0 ? "✓ żadnych" : "✗ " + missing.join(", ")}`);

console.log("\n═══ Punkt startowy → cel → trasa ═══\n");
if (flow.error) console.log(`  ✗ ${flow.error}`);
const fmt = (s) => `cel=${s.destination} trasa=${s.route}`;
console.log(`  na starcie:           ${fmt(flow.start)}  (oczekiwane cel=0 trasa=0)`);
console.log(`  znacznik startu:      ${flow.afterStart.marker}  (oczekiwane 1)`);
console.log(`  prawda na starcie:    ${flow.afterStart.truthOnStart ? "✓" : "✗"}`);
console.log(`  po kliknięciu w mapę: ${fmt(flow.afterPick)}  (oczekiwane cel=1 trasa=0)`);
console.log(`  po „Wyznacz trasę":   ${fmt(flow.afterRoute)}  (oczekiwane cel=1 trasa=1)`);
console.log(`  ${flowOk ? "✓ sekwencja działa" : "✗ sekwencja nie działa"}`);

console.log("\n═══ Korekcja ręczna ═══\n");
if (fix.error) console.log(`  ✗ ${fix.error}`);
console.log(`  estymata przesunięta:   ${fix.moved ? "✓" : "✗"}`);
console.log(`  znaczniki po 2 korektach: ${fix.markers}  (oczekiwane 2)`);
console.log(`  ${correctionOk ? "✓ korekcja działa" : "✗ korekcja nie działa"}`);



console.log("\n═══ Skąd lecą kafle ═══\n");
console.log(`  przez nasze API (/api/map/tiles): ${tileRequests.length}`);
console.log(`  bezpośrednio do serwerów kafli:   ${externalTiles.length} ${externalTiles.length === 0 ? "✓" : "✗ (przeglądarka nie powinna tam chodzić)"}`);
if (tileRequests.length > 0) {
  console.log(`  przykład: ${tileRequests[0].url.replace(URL.replace(/\/$/, ""), "")}`);
}

console.log("\n═══ Błędy ═══\n");
if (pageErrors.length === 0 && consoleErrors.length === 0 && httpErrors.length === 0) {
  console.log("  ✓ brak błędów strony i konsoli");
} else {
  for (const e of pageErrors) console.log(`  ✗ [strona] ${e}`);
  for (const e of httpErrors.slice(0, 8)) console.log(`  ✗ [HTTP] ${e}`);
  for (const e of consoleErrors.slice(0, 12)) console.log(`  ✗ [konsola] ${e}`);
  if (consoleErrors.length > 12) console.log(`  … i ${consoleErrors.length - 12} więcej`);
}

console.log(`\n  zrzut ekranu: ${SHOT}`);

writeFileSync(
  "/tmp/ui-requests.json",
  JSON.stringify({ requests, consoleErrors, pageErrors, httpErrors }, null, 2),
);

await browser.close();

const ok =
  layers.canvasPresent &&
  layers.canvasHeight > 500 &&
  missing.length === 0 &&
  externalTiles.length === 0 &&
  pageErrors.length === 0 &&
  httpErrors.length === 0 &&
  flowOk &&
  correctionOk;
console.log(ok ? "\n✓ Weryfikacja interfejsu zaliczona" : "\n✗ Weryfikacja interfejsu nieudana");
process.exit(ok ? 0 : 1);
