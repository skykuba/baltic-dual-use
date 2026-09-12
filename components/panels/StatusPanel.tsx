"use client";

import { useSimStore } from "@/lib/store";
import type { PositionSource } from "@/lib/geo/types";

const SOURCE_LABEL: Record<PositionSource, string> = {
  gnss: "GNSS",
  pdr: "PDR (inercja)",
  "pdr+map": "PDR + mapa",
  manual: "Korekcja ręczna",
};

const SOURCE_COLOR: Record<PositionSource, string> = {
  gnss: "text-cyan-400",
  pdr: "text-amber-400",
  "pdr+map": "text-emerald-400",
  manual: "text-violet-400",
};

const TERRAIN_LABEL: Record<string, string> = {
  urban: "zabudowa",
  forest: "las",
  open: "teren otwarty",
};

export function StatusPanel() {
  const tick = useSimStore((s) => s.tick);
  const connected = useSimStore((s) => s.connected);

  if (!tick) {
    return (
      <div className="text-sm text-zinc-500">
        {connected ? "Oczekiwanie na dane…" : "Brak połączenia ze strumieniem."}
      </div>
    );
  }

  const { estimate, gnss, terrain } = tick;
  const drift = estimate.distanceSinceGnssLoss;
  // Procent przebytej drogi ma sens dopiero po kilkudziesięciu metrach —
  // wcześniej mianownik jest zbyt mały, żeby liczba cokolwiek znaczyła.
  const driftPct = drift > 50 ? (estimate.errorVsTruth / drift) * 100 : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Źródło pozycji</Label>
        <div className={`text-xl font-semibold ${SOURCE_COLOR[estimate.source]}`}>
          {SOURCE_LABEL[estimate.source]}
        </div>
        <div className="mt-1 text-xs text-zinc-500">
          {gnss
            ? `${gnss.satellites} satelitów · dokładność ±${gnss.accuracy.toFixed(1)} m`
            : "Brak sygnału satelitarnego"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Metric label="Błąd pozycji" value={`${estimate.errorVsTruth.toFixed(1)} m`} />
        <Metric label="Niepewność 1σ" value={`±${estimate.uncertainty.toFixed(1)} m`} />
        <Metric label="Kroki" value={estimate.steps.toLocaleString("pl-PL")} />
        <Metric label="Kurs" value={`${estimate.heading.toFixed(0)}°`} />
      </div>

      {drift > 0 && (
        <div className="rounded-md border border-amber-900/60 bg-amber-950/30 p-3">
          <Label>Bez GNSS</Label>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-amber-300">
              {driftPct !== null ? `${driftPct.toFixed(1)}%` : "—"}
            </span>
            <span className="text-xs text-amber-600/90">przebytej drogi</span>
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            {estimate.errorVsTruth.toFixed(1)} m błędu na {drift.toFixed(0)} m marszu
            {driftPct === null && " · zbyt krótki dystans na miarodajny wskaźnik"}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-zinc-800 pt-3 text-xs text-zinc-500">
        <span>Teren: {TERRAIN_LABEL[terrain] ?? terrain}</span>
        <span>{(tick.t / 1000).toFixed(0)} s symulacji</span>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="mt-0.5 font-mono text-lg text-zinc-100">{value}</div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}
