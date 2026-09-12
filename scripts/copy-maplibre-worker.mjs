/**
 * Kopiuje workera MapLibre do public/maplibre.
 *
 * MapLibre 6 ładuje workera jako osobny moduł, wyliczając jego adres
 * z `import.meta.url` własnego chunka. Pod bundlerem Next.js chunk leży
 * w /_next/static/chunks/, więc worker szukany jest tam — i nie istnieje.
 * Skutek jest podstępny: 404 nie trafia do obsługi błędów mapy, worker
 * cicho umiera, a wszystkie źródła GeoJSON zostają na zawsze „niezaładowane".
 * Mapa renderuje tło i kontrolki, ale nie rysuje ŻADNYCH danych.
 *
 * Rozwiązanie: serwujemy workera z public/ i wskazujemy go przez
 * setWorkerUrl(). Skrypt biegnie przed `dev` i `build`, żeby kopia nie
 * rozjechała się z wersją pakietu.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "node_modules/maplibre-gl/dist");
const to = join(root, "public/maplibre");

// Worker importuje plik współdzielony ze ŚCIEŻKI WZGLĘDNEJ, więc oba muszą
// leżeć obok siebie. Warianty -dev są używane przez deweloperski build
// MapLibre, więc kopiujemy komplet.
const FILES = [
  "maplibre-gl-worker.mjs",
  "maplibre-gl-shared.mjs",
  "maplibre-gl-worker-dev.mjs",
  "maplibre-gl-shared-dev.mjs",
];

await mkdir(to, { recursive: true });

for (const file of FILES) {
  try {
    // Odwołanie do source mapy zostaje usunięte zamiast kopiowania mapy:
    // pliki .map ważą megabajty, a jedyne, co dają, to brak 404 w konsoli
    // przy otwartych narzędziach deweloperskich.
    const code = await readFile(join(from, file), "utf8");
    await writeFile(
      join(to, file),
      code.replace(/\n?\/\/# sourceMappingURL=.*$/m, "\n"),
    );
  } catch (error) {
    if (file.includes("-dev")) continue; // warianty dev bywają nieobecne
    throw error;
  }
}

// Zapisujemy wersję, żeby dało się zauważyć rozjazd po aktualizacji pakietu.
const pkg = JSON.parse(
  await readFile(join(root, "node_modules/maplibre-gl/package.json"), "utf8"),
);
await writeFile(join(to, "VERSION"), `${pkg.version}\n`);

console.log(`maplibre worker skopiowany (v${pkg.version}) → public/maplibre/`);
