import type { StyleSpecification } from "maplibre-gl";

/**
 * Styl mapy bazowej.
 *
 * Dwa warianty, świadomie:
 *   - PMTiles, gdy skonfigurowany — jeden plik z kaflami wektorowymi,
 *     działa całkowicie offline i to jest wariant docelowy;
 *   - kafle rastrowe OSM jako fallback, żeby dało się uruchomić demo
 *     bez przygotowywania archiwum PMTiles.
 *
 * Wariant offline jest istotą projektu, więc nie jest schowany za flagą
 * eksperymentalną — wystarczy wskazać plik przez NEXT_PUBLIC_PMTILES_URL.
 */

const PMTILES_URL = process.env.NEXT_PUBLIC_PMTILES_URL;

export function isOfflineBasemap(): boolean {
  return Boolean(PMTILES_URL);
}

export function buildStyle(): StyleSpecification {
  return PMTILES_URL ? vectorStyle(PMTILES_URL) : rasterFallbackStyle();
}

/** Ciemna paleta — czytelna przy nałożonych warstwach danych. */
const COLORS = {
  background: "#0b0f14",
  water: "#0d2030",
  land: "#11161d",
  green: "#132019",
  building: "#1b222c",
  road: "#2c3542",
  roadMajor: "#3a4553",
};

function vectorStyle(url: string): StyleSpecification {
  return {
    version: 8,
    glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${url}`,
        attribution: "© OpenStreetMap",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": COLORS.background } },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": COLORS.land },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": COLORS.green, "fill-opacity": 0.6 },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": COLORS.water },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        paint: { "fill-color": COLORS.building },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        paint: {
          "line-color": COLORS.road,
          "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.5, 18, 6],
        },
      },
    ],
  };
}

/**
 * Kafle rastrowe OSM.
 *
 * Wymagają internetu i nie nadają się na produkcję (polityka użycia
 * tile.openstreetmap.org), ale pozwalają uruchomić demo bez dodatkowego
 * przygotowania danych. Filtr CSS ściemnia je do palety interfejsu.
 */
function rasterFallbackStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": COLORS.background } },
      {
        id: "osm",
        type: "raster",
        source: "osm",
        paint: { "raster-opacity": 0.55, "raster-saturation": -0.7, "raster-brightness-max": 0.7 },
      },
    ],
  };
}
