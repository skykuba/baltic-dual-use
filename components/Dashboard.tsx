"use client";

import { MapView } from "@/components/map/MapView";
import { SimControls } from "@/components/panels/SimControls";
import { StatusPanel } from "@/components/panels/StatusPanel";
import { SensorFeed } from "@/components/panels/SensorFeed";
import {
  useAutoLoadMap,
  useSimStatusPolling,
  useSimStream,
} from "@/hooks/useSimStream";
import { useSimStore } from "@/lib/store";

export function Dashboard() {
  useSimStream();
  useSimStatusPolling();
  useAutoLoadMap();

  const connected = useSimStore((s) => s.connected);
  const status = useSimStore((s) => s.status);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden bg-zinc-950 text-zinc-100">
      <aside className="z-10 flex w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <header className="border-b border-zinc-800 px-4 py-3">
          <h1 className="text-sm font-semibold tracking-tight">
            Nawigacja w środowisku GPS-denied
          </h1>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
            <span
              className={[
                "size-1.5 rounded-full",
                connected ? "bg-emerald-500" : "bg-red-500",
              ].join(" ")}
            />
            {connected ? "Strumień aktywny" : "Brak połączenia"}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-4">
          <SimControls />
        </div>
      </aside>

      <main className="relative flex-1">
        <MapView />
        <Legend />
        <MapLayerBanner
          loading={status?.mapLoading ?? false}
          loaded={status?.mapLoaded ?? false}
          error={status?.mapError ?? null}
        />
      </main>

      <aside className="z-10 flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
        <div className="border-b border-zinc-800 p-4">
          <StatusPanel />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <SensorFeed />
        </div>
      </aside>
    </div>
  );
}

/**
 * Pasek stanu warstwy mapowej.
 *
 * Bez niego brak danych OSM objawia się wyłącznie tym, że map matching
 * po cichu nie działa — a to jest najgorszy rodzaj awarii: taki,
 * którego nie widać.
 */
function MapLayerBanner({
  loading,
  loaded,
  error,
}: {
  loading: boolean;
  loaded: boolean;
  error: string | null;
}) {
  if (loaded && !error) return null;

  return (
    <div
      className={[
        "absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-md border px-3 py-2 text-xs backdrop-blur",
        error
          ? "border-red-900 bg-red-950/85 text-red-200"
          : "border-zinc-700 bg-zinc-950/85 text-zinc-300",
      ].join(" ")}
    >
      {loading && "Pobieranie warstwy mapowej z Overpassa…"}
      {!loading && error && (
        <>
          <div className="font-medium">Nie udało się pobrać warstwy mapowej</div>
          <div className="mt-1 max-w-md text-red-300/80">{error}</div>
        </>
      )}
      {!loading && !error && !loaded && "Warstwa mapowa nie została pobrana"}
    </div>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-md border border-zinc-800 bg-zinc-950/85 px-3 py-2.5 backdrop-blur">
      <LegendDot color="#f8fafc" label="Pozycja rzeczywista" hollow />
      <LegendDot color="#f59e0b" label="Pozycja estymowana" />
      <LegendDot color="#34d399" label="Estymata z map matchingiem" />
      <LegendRow color="#22d3ee" label="Ślad GNSS" />
      <LegendRow color="#64748b" label="Trasa rzeczywista" dashed />
      <LegendDot color="#fbbf24" label="Miejsce docelowe" hollow />
      <LegendRow color="#60a5fa" label="Trasa do celu" />
      <LegendRow color="#ef4444" label="Punkty kryzysowe" />
      <p className="mt-2 max-w-52 text-[10px] leading-snug text-zinc-600">
        Trasa rzeczywista służy wyłącznie do oceny błędu — estymator jej nie widzi.
      </p>
    </div>
  );
}

function LegendDot({
  color,
  label,
  hollow,
}: {
  color: string;
  label: string;
  hollow?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className="size-3 shrink-0 rounded-full"
        style={
          hollow
            ? { border: `2px solid ${color}` }
            : { backgroundColor: color, border: "2px solid #0b0f14" }
        }
      />
      <span className="text-[11px] text-zinc-300">{label}</span>
    </div>
  );
}

function LegendRow({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span
        className="h-0.5 w-5"
        style={
          dashed
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)` }
            : { backgroundColor: color }
        }
      />
      <span className="text-[11px] text-zinc-400">{label}</span>
    </div>
  );
}
