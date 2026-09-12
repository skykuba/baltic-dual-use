"use client";

import { MapView } from "@/components/map/MapView";
import { SimControls } from "@/components/panels/SimControls";
import { StatusPanel } from "@/components/panels/StatusPanel";
import { SensorFeed } from "@/components/panels/SensorFeed";
import { useSimStatusPolling, useSimStream } from "@/hooks/useSimStream";
import { useSimStore } from "@/lib/store";

export function Dashboard() {
  useSimStream();
  useSimStatusPolling();

  const connected = useSimStore((s) => s.connected);

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

function Legend() {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-md border border-zinc-800 bg-zinc-950/85 px-3 py-2.5 backdrop-blur">
      <LegendRow color="#ef4444" label="Pozycja bieżąca" dot />
      <LegendRow color="#f59e0b" label="Niepewność pozycji (1σ)" circle />
      <LegendRow color="#22d3ee" label="Ślad GNSS" />
      <LegendRow color="#64748b" label="Trasa rzeczywista" dashed />
      <LegendRow color="#ef4444" label="Punkty kryzysowe" />
      <p className="mt-2 max-w-52 text-[10px] leading-snug text-zinc-600">
        Trasa rzeczywista służy wyłącznie do oceny błędu — estymator jej nie widzi.
      </p>
    </div>
  );
}

function LegendRow({
  color,
  label,
  dashed,
  circle,
  dot,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  circle?: boolean;
  dot?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {circle ? (
        <span
          className="size-3.5 rounded-full border border-dashed"
          style={{ backgroundColor: `${color}33`, borderColor: color }}
        />
      ) : dot ? (
        <span
          className="size-2.5 rounded-full border border-white"
          style={{ backgroundColor: color }}
        />
      ) : (
        <span
          className="h-0.5 w-5"
          style={
            dashed
              ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 8px)` }
              : { backgroundColor: color }
          }
        />
      )}
      <span className="text-[11px] text-zinc-400">{label}</span>
    </div>
  );
}
