"use client";

import { useSimStore } from "@/lib/store";

/**
 * Podgląd surowych danych z czujników.
 *
 * Ma pokazywać, że estymacja naprawdę pracuje na sygnale, a nie na
 * z góry znanej trasie. Wykres modułu przyspieszenia jest tu najważniejszy:
 * widać na nim rytm kroków, czyli dokładnie to, co wykrywa detektor.
 */
export function SensorFeed() {
  const tick = useSimStore((s) => s.tick);
  const accelWindow = useSimStore((s) => s.accelWindow);
  const errorWindow = useSimStore((s) => s.errorWindow);

  if (!tick) return null;

  const { accel, gyro, mag } = tick.imu;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Przyspieszenie — moduł wektora</Label>
        <Sparkline values={accelWindow} color="#34d399" baseline={9.81} />
        <p className="mt-1 text-[11px] leading-snug text-zinc-600">
          Każdy wierzchołek to jeden krok. Na tym sygnale pracuje detektor.
        </p>
      </div>

      <div>
        <Label>Błąd estymacji w czasie</Label>
        <Sparkline values={errorWindow} color="#fbbf24" />
      </div>

      <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
        <Axis label="accel" unit="m/s²" values={accel} />
        <Axis label="gyro" unit="rad/s" values={gyro} />
        <Axis label="mag" unit="µT" values={mag} />
      </div>
    </div>
  );
}

function Axis({
  label,
  unit,
  values,
}: {
  label: string;
  unit: string;
  values: [number, number, number];
}) {
  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      {(["x", "y", "z"] as const).map((axis, i) => (
        <div key={axis} className="flex justify-between text-zinc-300">
          <span className="text-zinc-600">{axis}</span>
          <span>{values[i].toFixed(2)}</span>
        </div>
      ))}
      <div className="mt-0.5 text-right text-[9px] text-zinc-600">{unit}</div>
    </div>
  );
}

function Sparkline({
  values,
  color,
  baseline,
}: {
  values: number[];
  color: string;
  baseline?: number;
}) {
  const width = 260;
  const height = 48;

  if (values.length < 2) {
    return <div className="h-12 rounded-md border border-zinc-800 bg-zinc-900/40" />;
  }

  const min = Math.min(...values, baseline ?? Infinity);
  const max = Math.max(...values, baseline ?? -Infinity);
  const span = max - min || 1;

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  const baselineY =
    baseline !== undefined ? height - ((baseline - min) / span) * height : null;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-12 w-full rounded-md border border-zinc-800 bg-zinc-900/40"
      preserveAspectRatio="none"
      role="img"
      aria-label="wykres przebiegu wartości"
    >
      {baselineY !== null && (
        <line
          x1="0"
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="#3f3f46"
          strokeWidth="1"
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}
