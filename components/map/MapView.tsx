"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  addProtocol,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle, isOfflineBasemap } from "@/lib/map/style";
import { useSimStore } from "@/lib/store";
import type { LatLon } from "@/lib/geo/types";

const INITIAL_CENTER: [number, number] = [18.5613, 54.4103];
const INITIAL_ZOOM = 14.5;

/** Kolory warstw danych. Ground truth celowo stonowany — to nie jest wynik. */
const C = {
  truth: "#64748b",
  gnss: "#22d3ee",
  estimate: "#f59e0b",
  estimateManual: "#a78bfa",
  estimateMapped: "#34d399",
  uncertainty: "#f59e0b",
  particle: "#34d399",
  poiP1: "#ef4444",
  poiP2: "#eab308",
  poiP3: "#94a3b8",
};

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const estimateMarker = useRef<Marker | null>(null);
  const ready = useRef(false);
  /** Czy użytkownik przesunął mapę ręcznie — wtedy przestajemy podążać. */
  const userMoved = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    // Protokół pmtiles:// musi być zarejestrowany, zanim MapLibre wczyta styl.
    if (isOfflineBasemap()) {
      const protocol = new Protocol();
      addProtocol("pmtiles", protocol.tile);
    }

    const instance = new MapLibreMap({
      container: container.current,
      style: buildStyle(),
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });

    instance.addControl(new NavigationControl({}), "bottom-right");
    instance.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    instance.on("dragstart", () => {
      userMoved.current = true;
    });

    instance.on("load", () => {
      addDataLayers(instance);
      const markerElement = document.createElement("div");
      markerElement.setAttribute("aria-label", "Szacowana pozycja użytkownika");
      markerElement.style.width = "20px";
      markerElement.style.height = "20px";
      markerElement.style.borderRadius = "50%";
      markerElement.style.backgroundColor = "#ef4444";
      markerElement.style.border = "3px solid #ffffff";
      markerElement.style.boxShadow = "0 0 0 2px #991b1b, 0 2px 8px #00000099";
      estimateMarker.current = new Marker({ element: markerElement })
        .setLngLat(INITIAL_CENTER)
        .addTo(instance);
      ready.current = true;
    });

    instance.on("click", (event: MapMouseEvent) => {
      const { correctionMode, setCorrectionMode } = useSimStore.getState();
      if (!correctionMode) return;
      void applyCorrection({ lat: event.lngLat.lat, lon: event.lngLat.lng });
      setCorrectionMode(false);
    });

    map.current = instance;

    return () => {
      instance.remove();
      estimateMarker.current?.remove();
      estimateMarker.current = null;
      map.current = null;
      ready.current = false;
    };
  }, []);

  // Kursor sygnalizuje tryb korekcji — inaczej nie widać, że klik coś zrobi.
  const correctionMode = useSimStore((s) => s.correctionMode);
  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = correctionMode ? "crosshair" : "";
  }, [correctionMode]);

  // POI zmieniają się tylko po pobraniu warstwy mapowej, więc tu zwykły
  // efekt Reacta wystarcza — w odróżnieniu od ticków.
  const pois = useSimStore((s) => s.pois);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    setPois(instance, pois);
  }, [pois]);

  useEffect(() => {
    // Subskrypcja poza Reactem: ticki lecą 10 razy na sekundę, więc
    // przerysowywanie drzewa komponentów przy każdym byłoby marnotrawstwem.
    return useSimStore.subscribe((state) => {
      const instance = map.current;
      if (!instance || !ready.current || !state.tick) return;

      const { tick, truthTrail, gnssTrail, estimateTrail } = state;

      setParticles(instance, tick.particles);
      setLine(instance, "truth-line", truthTrail);
      setLine(instance, "gnss-line", gnssTrail);
      setLine(instance, "estimate-line", estimateTrail);

      setPoint(instance, "truth-point", tick.truth);
      setPoint(instance, "estimate-point", {
        lat: tick.estimate.lat,
        lon: tick.estimate.lon,
      });
      estimateMarker.current?.setLngLat([tick.estimate.lon, tick.estimate.lat]);

      setCircle(
        instance,
        "uncertainty",
        { lat: tick.estimate.lat, lon: tick.estimate.lon },
        tick.estimate.uncertainty,
      );

      if (!userMoved.current) {
        instance.easeTo({
          center: [tick.estimate.lon, tick.estimate.lat],
          duration: 300,
        });
      }
    });
  }, []);

  return <div ref={container} className="absolute inset-0" />;
}

async function applyCorrection(position: LatLon): Promise<void> {
  await fetch("/api/sim/correct", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(position),
  });
}

function emptyGeoJson(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

function addDataLayers(map: MapLibreMap): void {
  for (const id of [
    "truth-line",
    "gnss-line",
    "estimate-line",
    "truth-point",
    "estimate-point",
    "uncertainty",
    "particles",
    "pois",
  ]) {
    map.addSource(id, { type: "geojson", data: emptyGeoJson() });
  }

  // Elipsa niepewności pod wszystkim — nie może zasłaniać pozycji.
  map.addLayer({
    id: "uncertainty-layer",
    type: "fill",
    source: "uncertainty",
    paint: { "fill-color": C.uncertainty, "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "uncertainty-outline",
    type: "line",
    source: "uncertainty",
    paint: { "line-color": C.uncertainty, "line-opacity": 0.4, "line-width": 1 },
  });

  // Chmura cząstek pod śladami — to tło niepewności, nie pierwszy plan.
  map.addLayer({
    id: "particles-layer",
    type: "circle",
    source: "particles",
    paint: {
      "circle-radius": 2.5,
      "circle-color": C.particle,
      // Waga cząstki sterowana przezroczystością: gęstsze i jaśniejsze
      // miejsca chmury to hipotezy, które mapa uznaje za bardziej wiarygodne.
      "circle-opacity": ["interpolate", ["linear"], ["get", "w"], 0, 0.08, 1, 0.75],
    },
  });

  map.addLayer({
    id: "truth-line-layer",
    type: "line",
    source: "truth-line",
    paint: { "line-color": C.truth, "line-width": 2, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: "gnss-line-layer",
    type: "line",
    source: "gnss-line",
    paint: { "line-color": C.gnss, "line-width": 2, "line-opacity": 0.75 },
  });
  map.addLayer({
    id: "estimate-line-layer",
    type: "line",
    source: "estimate-line",
    paint: { "line-color": C.estimate, "line-width": 3 },
  });

  map.addLayer({
    id: "truth-point-layer",
    type: "circle",
    source: "truth-point",
    paint: {
      "circle-radius": 5,
      "circle-color": "transparent",
      "circle-stroke-color": C.truth,
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "estimate-point-layer",
    type: "circle",
    source: "estimate-point",
    paint: {
      "circle-radius": 7,
      "circle-color": "#ef4444",
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 2,
    },
  });

  // POI na samej górze — w sytuacji kryzysowej to one są celem spojrzenia.
  map.addLayer({
    id: "pois-layer",
    type: "circle",
    source: "pois",
    paint: {
      "circle-radius": ["match", ["get", "priority"], 1, 8, 2, 4.5, 3.5],
      "circle-color": [
        "match",
        ["get", "priority"],
        1, C.poiP1,
        2, C.poiP2,
        C.poiP3,
      ],
      "circle-stroke-color": ["match", ["get", "priority"], 1, "#ffffff", "#0b0f14"],
      "circle-stroke-width": ["match", ["get", "priority"], 1, 2.5, 1.5],
      "circle-opacity": 0.9,
    },
  });

  map.addLayer({
    id: "life-poi-labels",
    type: "symbol",
    source: "pois",
    filter: ["==", ["get", "priority"], 1],
    layout: {
      "text-field": [
        "case",
        ["==", ["get", "name"], ""],
        "Punkt pomocy",
        ["get", "name"],
      ],
      "text-size": 11,
      "text-offset": [0, 1.35],
      "text-anchor": "top",
      "text-allow-overlap": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#991b1b",
      "text-halo-width": 1.5,
    },
  });
}

function setParticles(
  map: MapLibreMap,
  particles: { lat: number; lon: number; w: number }[],
): void {
  const source = map.getSource("particles") as GeoJSONSource | undefined;
  if (!source) return;

  if (particles.length === 0) {
    source.setData(emptyGeoJson());
    return;
  }

  // Normalizacja do maksimum: wagi bezwzględne po resamplingu są prawie
  // równe, więc bez tego cała chmura miałaby jednakową przezroczystość
  // i nie byłoby widać, gdzie skupia się prawdopodobieństwo.
  const maxWeight = Math.max(...particles.map((p) => p.w), 1e-9);

  source.setData({
    type: "FeatureCollection",
    features: particles.map((particle) => ({
      type: "Feature",
      properties: { w: particle.w / maxWeight },
      geometry: { type: "Point", coordinates: [particle.lon, particle.lat] },
    })),
  });
}

/** Warstwa POI. Aktualizowana rzadko — tylko po pobraniu mapy. */
function setPois(
  map: MapLibreMap,
  pois: {
    lat: number;
    lon: number;
    priority: number;
    categoryId?: string;
    name?: string;
  }[],
): void {
  const source = map.getSource("pois") as GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature",
      properties: {
        priority: poi.priority,
        name: poi.name ?? "",
        categoryId: poi.categoryId,
      },
      geometry: { type: "Point", coordinates: [poi.lon, poi.lat] },
    })),
  });
}

function setLine(map: MapLibreMap, id: string, coords: [number, number][]): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(
    coords.length < 2
      ? emptyGeoJson()
      : {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: coords },
            },
          ],
        },
  );
}

function setPoint(map: MapLibreMap, id: string, position: LatLon): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [position.lon, position.lat] },
      },
    ],
  });
}

/** Okrąg niepewności jako wielokąt — MapLibre nie rysuje okręgów w metrach. */
function setCircle(
  map: MapLibreMap,
  id: string,
  center: LatLon,
  radiusMeters: number,
): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return;

  const steps = 48;
  const latRad = (center.lat * Math.PI) / 180;
  const dLat = radiusMeters / 111_320;
  const dLon = radiusMeters / (111_320 * Math.cos(latRad));

  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([
      center.lon + Math.cos(angle) * dLon,
      center.lat + Math.sin(angle) * dLat,
    ]);
  }

  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      },
    ],
  });
}
