import type { StyleSpecification } from "maplibre-gl";

/**
 * Styl mapy bazowej.
 *
 * Kafle rastrowe serwowane wyłącznie przez własne API, które buforuje je
 * na dysku. Po pierwszym przejrzeniu obszaru tło działa bez internetu.
 */

export function buildStyle(): StyleSpecification {
  return rasterStyle();
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

/**
 * Kafle rastrowe serwowane przez WŁASNE API.
 *
 * Przeglądarka nigdy nie łączy się z zewnętrznym serwerem kafli — wszystko
 * idzie przez `/api/map/tiles`, które buforuje kafle na dysku. Po pierwszym
 * przejrzeniu obszaru mapa rysuje się bez internetu, a to jest dokładnie ta
 * właściwość, o którą chodzi w całym projekcie.
 */
function rasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["/api/map/tiles/{z}/{x}/{y}"],
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
        // Standardowe kafle OSM są jasne, a warstwy danych — ślady, chmura
        // cząstek, kropki pozycji — są zaprojektowane pod ciemne tło.
        // Przyciemnienie i odbarwienie sprowadza mapę do roli podkładu,
        // zamiast konkurować kolorem z danymi.
        paint: {
          "raster-opacity": 0.45,
          "raster-saturation": -0.75,
          "raster-brightness-max": 0.55,
          "raster-contrast": 0.1,
        },
      },
    ],
  };
}
