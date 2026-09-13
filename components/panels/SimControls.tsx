"use client";

import { useState } from "react";
import {
  Crosshair,
  Download,
  Map as MapIcon,
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
            <div className="mt-1 border-t border-zinc-800 pt-1">
              <OriginBadge origin={status.mapStats.origin} />
            </div>
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

<<<<<<< HEAD
=======
/**
 * Skąd przyszły dane mapowe.
 *
 * Istotne przed demem: jeśli warstwa przyszła z publicznej instancji,
 * to znaczy że lokalny Overpass nie działa i całe twierdzenie „stack
 * działa offline" jest w tym uruchomieniu nieprawdziwe. Lepiej zobaczyć
 * to na panelu niż usłyszeć pytanie od jury.
 */
function OriginBadge({ origin }: { origin: "cache" | "local" | "fallback" }) {
  const label = {
    local: "z lokalnej instancji Overpass",
    cache: "z cache'u na dysku — offline",
    fallback: "z PUBLICZNEJ instancji — wymaga internetu",
  }[origin];

  const color = {
    local: "text-emerald-400",
    cache: "text-emerald-400",
    fallback: "text-amber-400",
  }[origin];

  return <span className={color}>{label}</span>;
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

>>>>>>> 594d9d3 (loks working)
function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}
