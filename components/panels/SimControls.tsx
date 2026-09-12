"use client";

import { useState } from "react";
import {
  Crosshair,
  Download,
  Footprints,
  Map as MapIcon,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Satellite,
  SatelliteDish,
} from "lucide-react";
import { SCENARIOS } from "@/lib/sim/scenario";
import { loadMapLayer, sendCommand, useSimStore } from "@/lib/store";

const TIME_SCALES = [1, 2, 4, 8, 16];

export function SimControls() {
  const status = useSimStore((s) => s.status);
  const correctionMode = useSimStore((s) => s.correctionMode);
  const setCorrectionMode = useSimStore((s) => s.setCorrectionMode);

  const destinationMode = useSimStore((s) => s.destinationMode);
  const setDestinationMode = useSimStore((s) => s.setDestinationMode);
  const destinationMessage = useSimStore((s) => s.destinationMessage);

  const routeMode = useSimStore((s) => s.routeMode);
  const setRouteMode = useSimStore((s) => s.setRouteMode);
  const route = useSimStore((s) => s.route);
  const routeError = useSimStore((s) => s.routeError);
  const setRoute = useSimStore((s) => s.setRoute);

  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);

  const running = status?.running ?? false;
  const gnss = status?.gnssEnabled ?? true;
  const mapLoaded = status?.mapLoaded ?? false;
  const mapMatching = status?.mapMatchingEnabled ?? true;

  const handleLoadMap = async () => {
    setLoadingMap(true);
    setMapMessage(null);
    try {
      setMapMessage(await loadMapLayer());
    } finally {
      setLoadingMap(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <Label>Symulacja</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void sendCommand({ type: running ? "pause" : "start" })}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            {running ? <Pause className="size-4" /> : <Play className="size-4" />}
            {running ? "Pauza" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => void sendCommand({ type: "reset" })}
            className="flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Sygnał GNSS</Label>
        <button
          type="button"
          onClick={() => void sendCommand({ type: "setGnss", enabled: !gnss })}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-semibold transition-colors",
            gnss
              ? "bg-cyan-600 text-white hover:bg-cyan-500"
              : "bg-red-600 text-white hover:bg-red-500",
          ].join(" ")}
        >
          {gnss ? <Satellite className="size-4" /> : <SatelliteDish className="size-4" />}
          {gnss ? "GNSS dostępny — zagłuś" : "ZAGŁUSZONY — przywróć"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          Po zagłuszeniu pozycja liczona jest wyłącznie z czujników inercyjnych.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Warstwa mapowa</Label>
        <button
          type="button"
          onClick={() => void handleLoadMap()}
          disabled={loadingMap}
          className="flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          <Download className={loadingMap ? "size-4 animate-pulse" : "size-4"} />
          {loadingMap
            ? "Pobieranie z Overpassa…"
            : mapLoaded
              ? "Pobierz ponownie"
              : "Pobierz obszar operacji"}
        </button>

        {status?.mapStats && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 font-mono text-[11px] text-zinc-400">
            <div>{status.mapStats.edges.toLocaleString("pl-PL")} krawędzi grafu</div>
            <div>{status.mapStats.buildings.toLocaleString("pl-PL")} budynków</div>
            <div>{status.mapStats.pois.toLocaleString("pl-PL")} punktów kryzysowych</div>
          </div>
        )}

        {mapMessage && !status?.mapStats && (
          <p className="text-xs leading-snug text-red-400">{mapMessage}</p>
        )}

        <button
          type="button"
          onClick={() =>
            void sendCommand({ type: "setMapMatching", enabled: !mapMatching })
          }
          disabled={!mapLoaded}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            mapMatching && mapLoaded
              ? "bg-emerald-700 text-white hover:bg-emerald-600"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <MapIcon className="size-4" />
          {mapMatching ? "Map matching włączony" : "Map matching wyłączony"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          Bez mapy estymata dryfuje swobodnie. Z mapą chmura cząstek jest
          ograniczana geometrią ulic i obrysami budynków.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Korekcja ręczna</Label>
        <button
          type="button"
          onClick={() => setCorrectionMode(!correctionMode)}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            correctionMode
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <Crosshair className="size-4" />
          {correctionMode ? "Wskaż punkt na mapie…" : "Skoryguj pozycję"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          Żołnierz rozpoznaje skrzyżowanie lub budynek i wskazuje, gdzie naprawdę
          jest. Estymacja biegnie dalej od tego punktu.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Cel marszu</Label>
        <button
          type="button"
          onClick={() => setDestinationMode(!destinationMode)}
          disabled={!mapLoaded}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            destinationMode
              ? "bg-amber-600 text-white hover:bg-amber-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <Footprints className="size-4" />
          {destinationMode ? "Wskaż, dokąd ma iść…" : "Zmień cel marszu"}
        </button>

        {status && status.pathLength > 0 && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
            <div className="flex items-baseline justify-between font-mono text-[11px] text-zinc-400">
              <span>
                {formatDistance(status.pathProgress)} / {formatDistance(status.pathLength)}
              </span>
              <span>
                {Math.round((status.pathProgress / Math.max(status.pathLength, 1)) * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-zinc-500 transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, (status.pathProgress / Math.max(status.pathLength, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {destinationMessage && (
          <p className="text-xs leading-snug text-zinc-500">{destinationMessage}</p>
        )}

        <p className="text-xs leading-relaxed text-zinc-500">
          Trasa marszu wyznaczana algorytmem A* po rzeczywistych ulicach z OSM.
          Rodzaj terenu bierze się z typu drogi, więc ścieżka leśna i ulica
          w zabudowie dają inny szum czujników.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Nawigacja do celu</Label>
        <button
          type="button"
          onClick={() => setRouteMode(!routeMode)}
          disabled={!mapLoaded}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            routeMode
              ? "bg-blue-600 text-white hover:bg-blue-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <Navigation className="size-4" />
          {routeMode ? "Wskaż cel na mapie…" : "Wyznacz trasę"}
        </button>

        {route && (
          <div className="rounded-md border border-blue-900/60 bg-blue-950/30 px-2.5 py-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg text-blue-300">
                {formatDistance(route.distance)}
              </span>
              <span className="text-xs text-blue-500/90">
                ~{formatDuration(route.duration)} marszu
              </span>
            </div>
            <button
              type="button"
              onClick={() => setRoute(null)}
              className="mt-1 text-[11px] text-zinc-500 underline-offset-2 hover:underline"
            >
              wyczyść trasę
            </button>
          </div>
        )}

        {routeError && (
          <p className="text-xs leading-snug text-red-400">{routeError}</p>
        )}

        <p className="text-xs leading-relaxed text-zinc-500">
          Trasa liczona jest od pozycji <strong>estymowanej</strong>, nie
          rzeczywistej — bo tylko tę zna żołnierz w terenie.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Tempo symulacji</Label>
        <div className="flex gap-1">
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => void sendCommand({ type: "setTimeScale", scale })}
              className={[
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                status?.timeScale === scale
                  ? "bg-zinc-200 text-zinc-900"
                  : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800",
              ].join(" ")}
            >
              {scale}×
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Scenariusz</Label>
        <div className="flex flex-col gap-1.5">
          {SCENARIOS.map((scenario) => {
            const active = status?.scenarioId === scenario.id;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => void sendCommand({ type: "setScenario", id: scenario.id })}
                className={[
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-emerald-600 bg-emerald-950/40"
                    : "border-zinc-800 hover:bg-zinc-800/60",
                ].join(" ")}
              >
                <div className="text-sm font-medium text-zinc-200">{scenario.name}</div>
                <div className="mt-0.5 text-xs leading-snug text-zinc-500">
                  {scenario.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2).replace(".", ",")} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}
