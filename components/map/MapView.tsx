"use client";

import { useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { buildStyle } from "@/lib/map/style";
import {
  sendCommand,
  setDestination,
  setStart,
  useSimStore,
  type NavRoute,
  type Trail,
} from "@/lib/store";
import type { LatLon } from "@/lib/geo/types";
import type { SimTick } from "@/lib/types";

const INITIAL_CENTER: [number, number] = [18.5613, 54.4103];
const INITIAL_ZOOM = 14.5;

/** Kolory warstw danych. Ground truth celowo stonowany — to nie jest wynik. */
const C = {
  truth: "#f8fafc",
  gnss: "#22d3ee",
  estimate: "#f59e0b",
  estimateManual: "#a78bfa",
  estimateMapped: "#34d399",
  uncertainty: "#f59e0b",
  particle: "#34d399",
  poiP1: "#ef4444",
  poiP2: "#eab308",
  poiP3: "#94a3b8",
  route: "#60a5fa",
  destination: "#fbbf24",
  start: "#f472b6",
};

export function MapView() {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const ready = useRef(false);
  /** Czy użytkownik przesunął mapę ręcznie — wtedy przestajemy podążać. */
  const userMoved = useRef(false);

  useEffect(() => {
    if (!container.current || map.current) return;

    // Worker MapLibre serwowany z public/, a nie wyliczany z bundla.
    //
    // MapLibre 6 wyznacza adres workera przez new URL("./maplibre-gl-worker.mjs",
    // import.meta.url). Pod bundlerem Next.js import.meta.url wskazuje na
    // /_next/static/chunks/, gdzie tego pliku nie ma — worker dostaje 404
    // i cicho umiera. Objaw jest mylący: mapa rysuje tło, kontrolki i podziałkę,
    // ale ŻADNE dane GeoJSON się nie pojawiają, a MapLibre nie zgłasza błędu.
    // Wszystkie źródła zostają na zawsze w stanie „niezaładowane".
    //
    // Plik kopiuje skrypt scripts/copy-maplibre-worker.mjs, uruchamiany
    // automatycznie przed `dev` i `build`.
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

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

    // "style.load", a NIE "load".
    //
    // Zdarzenie "load" czeka na wczytanie stylu ORAZ pierwszych kafli tła.
    // Gdy serwer kafli jest wolny albo nieosiągalny, nie nadchodzi wcale —
    // a wtedy nie powstają warstwy danych i mapa zostaje pusta: bez kropek
    // pozycji, bez śladów, bez niczego. Pozycja żołnierza nie ma prawa
    // zależeć od tego, czy załadowało się ładne tło.
    instance.on("style.load", () => {
      addDataLayers(instance);
      ready.current = true;

      // Wymuszenie przeliczenia rozmiaru.
      //
      // W trybie deweloperskim style ładują się asynchronicznie, więc
      // w chwili inicjalizacji kontener bywa jeszcze bez wysokości —
      // MapLibre bierze wtedy domyślne 300 px kanwy HTML i już przy nich
      // zostaje. Objawem jest mapa zajmująca górną jedną trzecią panelu.
      requestAnimationFrame(() => instance.resize());

      // Odrysowanie z bieżącego stanu, a nie czekanie na kolejny tick.
      //
      // Pierwszy tick przychodzi przez SSE zaraz po subskrypcji — zwykle
      // ZANIM MapLibre zgłosi „load". Bez tego wywołania byłby odrzucony,
      // a przy zapauzowanej symulacji następny nigdy by nie nadszedł:
      // mapa zostawałaby pusta, bez obu kropek, dopóki ktoś nie nacisnie
      // Start. Właśnie tak wyglądał stan początkowy demo.
      const state = useSimStore.getState();
      if (state.tick) renderState(instance, state, userMoved.current);
      setPois(instance, state.pois);
      setRoute(instance, state.route);
      setMarker(instance, "destination", state.destination);
      setMarker(instance, "start", state.start);
    });

    instance.on("click", (event: MapMouseEvent) => {
      const state = useSimStore.getState();
      const point = { lat: event.lngLat.lat, lon: event.lngLat.lng };

      // Tryb gaśnie ZANIM poleci żądanie: obie operacje idą do serwera
      // i trwają, a bez tego drugi klik w tym czasie wysyłałby je ponownie.
      if (state.clickMode === "correction") {
        state.setClickMode("none");
        void sendCommand({ type: "correct", ...point });
      } else if (state.clickMode === "start") {
        state.setClickMode("none");
        void setStart(point);
      } else if (state.clickMode === "destination") {
        state.setClickMode("none");
        void setDestination(point);
      }
    });

    map.current = instance;

    // Uchwyt do mapy w trybie deweloperskim.
    //
    // Warstwy MapLibre da się sensownie diagnozować tylko od środka —
    // z zewnątrz widać jedynie, że „mapa jest pusta", bez informacji,
    // czy brakuje warstwy, źródła, czy cech w źródle.
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as { __map?: MapLibreMap }).__map = instance;
    }

    // ResizeObserver na kontenerze, nie na oknie: panele boczne mają stałą
    // szerokość, ale obszar mapy zmienia się także wtedy, gdy okno zostaje
    // nietknięte — na przykład po pojawieniu się paska stanu warstwy.
    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container.current);

    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      ready.current = false;
    };
  }, []);

  // Kursor sygnalizuje tryb wskazywania — inaczej nie widać, że klik coś zrobi.
  const clickMode = useSimStore((s) => s.clickMode);
  useEffect(() => {
    const canvas = map.current?.getCanvas();
    if (canvas) canvas.style.cursor = clickMode === "none" ? "" : "crosshair";
  }, [clickMode]);

  // Trasa zmienia się tylko na żądanie, więc zwykły efekt wystarcza.
  const route = useSimStore((s) => s.route);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    setRoute(instance, route);
  }, [route]);

  // Znacznik celu rysowany NIEZALEŻNIE od trasy.
  //
  // Wcześniej wisiał na źródle „route" i pojawiał się dopiero razem
  // z wyznaczoną trasą — czyli kliknięcie w mapę nie dawało żadnego
  // widocznego efektu aż do osobnej akcji. To był ten błąd.
  const destination = useSimStore((s) => s.destination);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    setMarker(instance, "destination", destination);
  }, [destination]);

  const startPoint = useSimStore((s) => s.start);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    setMarker(instance, "start", startPoint);
  }, [startPoint]);

  // Korekcje dopisują się rzadko, więc zwykły efekt wystarcza.
  const corrections = useSimStore((s) => s.corrections);
  useEffect(() => {
    const instance = map.current;
    if (!instance || !ready.current) return;
    const source = instance.getSource("corrections") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: corrections.map((point) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
      })),
    });
  }, [corrections]);

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
    //
    // Zustand woła subskrybenta przy KAŻDEJ zmianie stanu, także przy
    // przełączeniu trybu klikania czy wpisaniu komunikatu. Bez tej wartowni
    // każda taka zmiana przebudowywała geometrię śladów (do 3000 punktów)
    // i wywoływała easeTo, co przy zapauzowanej symulacji szarpało mapą.
    let lastTick: SimTick | null = null;
    return useSimStore.subscribe((state) => {
      const instance = map.current;
      if (!instance || !ready.current || !state.tick) return;
      // Porównanie po TOŻSAMOŚCI obiektu, nie po numerze: każdy tick jest
      // nowym obiektem, a numery potrafią się powtórzyć po zerowaniu stanu.
      if (state.tick === lastTick) return;
      lastTick = state.tick;
      renderState(instance, state, userMoved.current);
    });
  }, []);

  // h-full/w-full, a NIE absolute inset-0.
  //
  // MapLibre dokłada kontenerowi klasę .maplibregl-map, która ustawia
  // position: relative. Jej arkusz ładuje się po Tailwindzie, więc przy
  // równej swoistości wygrywa — a na elemencie względnym inset-0 nie robi
  // nic i wysokość zapada się do zera. Objaw: kanwa 960×300 (domyślny
  // rozmiar canvas HTML) i mapa zajmująca górną jedną trzecią panelu.
  return <div ref={container} className="h-full w-full" />;
}

/**
 * Przenosi bieżący stan symulacji na warstwy mapy.
 *
 * Wydzielone z subskrypcji, bo ten sam rysunek trzeba wykonać w dwóch
 * momentach: przy każdym ticku ORAZ raz po inicjalizacji mapy — inaczej
 * stan sprzed „load" przepada.
 */
function renderState(
  map: MapLibreMap,
  state: ReturnType<typeof useSimStore.getState>,
  userMoved: boolean,
): void {
  const { tick, truthTrail, gnssTrail, estimateTrail } = state;
  if (!tick) return;

  setParticles(map, tick.particles);
  setLine(map, "truth-line", truthTrail);
  setLine(map, "gnss-line", gnssTrail);
  setLine(map, "estimate-line", estimateTrail);

  setPoint(map, "truth-point", tick.truth);
  setPoint(map, "estimate-point", {
    lat: tick.estimate.lat,
    lon: tick.estimate.lon,
  });

  setCircle(
    map,
    "uncertainty",
    { lat: tick.estimate.lat, lon: tick.estimate.lon },
    tick.estimate.uncertainty,
  );

  const estimateColor =
    tick.estimate.source === "manual"
      ? C.estimateManual
      : tick.estimate.source === "pdr+map"
        ? C.estimateMapped
        : C.estimate;
  map.setPaintProperty("estimate-point-layer", "circle-color", estimateColor);
  map.setPaintProperty("estimate-halo", "circle-color", estimateColor);

  // Mapa nie może uciekać spod kursora, kiedy operator celuje w punkt.
  // Przy tempie 16× estymata przesuwa się o kilkadziesiąt metrów na sekundę,
  // więc trafienie w konkretne skrzyżowanie było kwestią szczęścia.
  if (!userMoved && state.clickMode === "none") {
    map.easeTo({
      center: [tick.estimate.lon, tick.estimate.lat],
      duration: 300,
    });
  }
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
    "route",
    "destination",
    "start",
    "corrections",
  ]) {
    map.addSource(id, { type: "geojson", data: emptyGeoJson() });
  }

  // Kolejność warstw jest znacząca i idzie od najmniej do najbardziej
  // istotnego. Dwie kropki pozycji — rzeczywista i estymowana — są na
  // samej górze, bo cała reszta istnieje po to, żeby wyjaśnić różnicę
  // między nimi.

  // ── tło: niepewność i chmura hipotez ──
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
  map.addLayer({
    id: "particles-layer",
    type: "circle",
    source: "particles",
    paint: {
      "circle-radius": 2.5,
      "circle-color": C.particle,
      // Waga cząstki sterowana przezroczystością: jaśniejsze miejsca chmury
      // to hipotezy, które mapa uznaje za bardziej wiarygodne.
      "circle-opacity": ["interpolate", ["linear"], ["get", "w"], 0, 0.08, 1, 0.75],
    },
  });

  // ── ślady ──
  map.addLayer({
    id: "truth-line-layer",
    type: "line",
    source: "truth-line",
    paint: {
      "line-color": C.truth,
      "line-width": 2,
      "line-opacity": 0.35,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "gnss-line-layer",
    type: "line",
    source: "gnss-line",
    paint: { "line-color": C.gnss, "line-width": 2, "line-opacity": 0.7 },
  });
  map.addLayer({
    id: "estimate-line-layer",
    type: "line",
    source: "estimate-line",
    paint: { "line-color": C.estimate, "line-width": 3 },
  });

  // ── trasa do celu ──
  map.addLayer({
    id: "route-casing",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#0b0f14", "line-width": 7, "line-opacity": 0.8 },
  });
  map.addLayer({
    id: "route-layer",
    type: "line",
    source: "route",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": C.route, "line-width": 3.5 },
  });
  map.addLayer({
    id: "start-layer",
    type: "circle",
    source: "start",
    paint: {
      "circle-radius": 9,
      "circle-color": "transparent",
      "circle-stroke-color": C.start,
      "circle-stroke-width": 3,
    },
  });
  map.addLayer({
    id: "destination-layer",
    type: "circle",
    source: "destination",
    paint: {
      "circle-radius": 9,
      "circle-color": "transparent",
      "circle-stroke-color": C.destination,
      "circle-stroke-width": 3,
    },
  });

  // ── punkty kryzysowe ──
  map.addLayer({
    id: "pois-layer",
    type: "circle",
    source: "pois",
    paint: {
      "circle-radius": ["match", ["get", "priority"], 1, 6, 2, 4.5, 3.5],
      "circle-color": ["match", ["get", "priority"], 1, C.poiP1, 2, C.poiP2, C.poiP3],
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 1.5,
      "circle-opacity": 0.9,
    },
  });

  // ── znaczniki korekcji ręcznej ──
  map.addLayer({
    id: "corrections-layer",
    type: "circle",
    source: "corrections",
    paint: {
      "circle-radius": 6,
      "circle-color": "transparent",
      "circle-stroke-color": C.estimateManual,
      "circle-stroke-width": 2.5,
    },
  });

  // ── na wierzchu: dwie kropki pozycji ──
  //
  // Rzeczywista jest pusta w środku i biała, estymowana wypełniona
  // i kolorowa. Różnica kształtu, nie tylko barwy — na rzutniku
  // i przy daltonizmie sam kolor bywa nieczytelny.
  // Pierścień prawdy jest WIĘKSZY od kropki estymaty.
  //
  // Na starcie obie pozycje pokrywają się co do metra. Przy równych
  // promieniach wypełniona kropka estymaty zasłaniałaby pierścień
  // całkowicie — a to właśnie moment, w którym operator ma zobaczyć,
  // że system startuje ze zgodną pozycją. Większy pierścień otacza
  // kropkę, a w miarę narastania dryfu rozjeżdżają się na oczach widza.
  map.addLayer({
    id: "truth-point-layer",
    type: "circle",
    source: "truth-point",
    paint: {
      "circle-radius": 12,
      "circle-color": "transparent",
      "circle-stroke-color": C.truth,
      "circle-stroke-width": 2.5,
      "circle-stroke-opacity": 0.95,
    },
  });
  map.addLayer({
    id: "estimate-halo",
    type: "circle",
    source: "estimate-point",
    paint: {
      "circle-radius": 18,
      "circle-color": C.estimate,
      "circle-opacity": 0.14,
    },
  });
  map.addLayer({
    id: "estimate-point-layer",
    type: "circle",
    source: "estimate-point",
    paint: {
      "circle-radius": 7,
      "circle-color": C.estimate,
      "circle-stroke-color": "#0b0f14",
      "circle-stroke-width": 2,
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

/** Warstwa trasy nawigacyjnej. */
function setRoute(map: MapLibreMap, route: NavRoute | null): void {
  const routeSource = map.getSource("route") as GeoJSONSource | undefined;
  if (!routeSource) return;

  if (!route || route.points.length < 2) {
    routeSource.setData(emptyGeoJson());
    return;
  }

  routeSource.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: route.points.map((p) => [p.lon, p.lat]),
        },
      },
    ],
  });
}

/**
 * Pojedynczy znacznik punktowy.
 *
 * Celowo niezależny od trasy: znacznik ma się pojawić w chwili kliknięcia,
 * a nie dopiero razem z wynikiem, na który trzeba czekać.
 */
function setMarker(
  map: MapLibreMap,
  id: "destination" | "start",
  point: LatLon | null,
): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return;
  source.setData(
    point
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: { type: "Point", coordinates: [point.lon, point.lat] },
            },
          ],
        }
      : emptyGeoJson(),
  );
}

/** Warstwa POI. Aktualizowana rzadko — tylko po pobraniu mapy. */
function setPois(
  map: MapLibreMap,
  pois: { lat: number; lon: number; priority: number; name?: string }[],
): void {
  const source = map.getSource("pois") as GeoJSONSource | undefined;
  if (!source) return;
  source.setData({
    type: "FeatureCollection",
    features: pois.map((poi) => ({
      type: "Feature",
      properties: { priority: poi.priority, name: poi.name ?? "" },
      geometry: { type: "Point", coordinates: [poi.lon, poi.lat] },
    })),
  });
}

/**
 * Rysuje ślad złożony z rozłącznych odcinków.
 *
 * MultiLineString, nie LineString: trajektoria bywa przerywana korekcją
 * ręczną i utratą sygnału GNSS. Sklejenie jej w jedną linię rysowałoby
 * przez mapę odcinki, których nikt nie przeszedł.
 */
function setLine(map: MapLibreMap, id: string, trail: Trail): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  if (!source) return;

  const segments = trail.filter((segment) => segment.length >= 2);
  if (segments.length === 0) {
    source.setData(emptyGeoJson());
    return;
  }

  source.setData({
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "MultiLineString", coordinates: segments },
      },
    ],
  });
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
