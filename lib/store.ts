"use client";

import { create } from "zustand";
import type { LatLon } from "@/lib/geo/types";
import type { SimStatus, SimTick } from "@/lib/types";

export type MapPoi = {
  id: string;
  lat: number;
  lon: number;
  priority: number;
  categoryId: string;
  name?: string;
};

/** Ile punktów trasy trzymamy. 3000 ticków ≈ 5 min przy 10 Hz. */
const TRAIL_LIMIT = 3000;
/** Ile ostatnich odczytów pokazuje podgląd czujników. */
const SENSOR_WINDOW = 80;

export type Trail = [number, number][];

type SimState = {
  connected: boolean;
  status: SimStatus | null;
  tick: SimTick | null;

  truthTrail: Trail;
  gnssTrail: Trail;
  estimateTrail: Trail;

  /** Pionowe przyspieszenie do wykresu — surowy sygnał, na którym pracuje PDR. */
  accelWindow: number[];
  /** Historia błędu estymacji, do wykresu narastania dryfu. */
  errorWindow: number[];

  /** Tryb, w którym kliknięcie w mapę oznacza korekcję pozycji. */
  correctionMode: boolean;

  /** Punkty istotne kryzysowo — pobierane raz, po wczytaniu warstwy mapowej. */
  pois: MapPoi[];

  setConnected: (v: boolean) => void;
  setStatus: (s: SimStatus) => void;
  pushTick: (t: SimTick) => void;
  setCorrectionMode: (v: boolean) => void;
  setPois: (pois: MapPoi[]) => void;
  clearTrails: () => void;
};

export const useSimStore = create<SimState>((set) => ({
  connected: false,
  status: null,
  tick: null,
  truthTrail: [],
  gnssTrail: [],
  estimateTrail: [],
  accelWindow: [],
  errorWindow: [],
  correctionMode: false,
  pois: [],

  setConnected: (connected) => set({ connected }),
  setStatus: (status) => set({ status }),

  pushTick: (tick) =>
    set((state) => {
      // Reset symulacji rozpoznajemy po cofnięciu numeru sekwencji.
      const isReset = state.tick !== null && tick.seq < state.tick.seq;
      if (isReset) {
        return {
          tick,
          truthTrail: [[tick.truth.lon, tick.truth.lat]],
          gnssTrail: [],
          estimateTrail: [[tick.estimate.lon, tick.estimate.lat]],
          accelWindow: [],
          errorWindow: [],
        };
      }

      const az = Math.hypot(...tick.imu.accel);

      return {
        tick,
        truthTrail: push(state.truthTrail, [tick.truth.lon, tick.truth.lat]),
        gnssTrail: tick.gnss
          ? push(state.gnssTrail, [tick.gnss.lon, tick.gnss.lat])
          : state.gnssTrail,
        estimateTrail: push(state.estimateTrail, [
          tick.estimate.lon,
          tick.estimate.lat,
        ]),
        accelWindow: pushNumber(state.accelWindow, az, SENSOR_WINDOW),
        errorWindow: pushNumber(
          state.errorWindow,
          tick.estimate.errorVsTruth,
          SENSOR_WINDOW * 3,
        ),
      };
    }),

  setCorrectionMode: (correctionMode) => set({ correctionMode }),
  setPois: (pois) => set({ pois }),

  clearTrails: () =>
    set({
      truthTrail: [],
      gnssTrail: [],
      estimateTrail: [],
      accelWindow: [],
      errorWindow: [],
    }),
}));

function push(trail: Trail, point: [number, number]): Trail {
  const next = trail.length >= TRAIL_LIMIT ? trail.slice(1) : trail.slice();
  next.push(point);
  return next;
}

function pushNumber(window: number[], value: number, limit: number): number[] {
  const next = window.length >= limit ? window.slice(1) : window.slice();
  next.push(value);
  return next;
}

/** Wysyła polecenie do silnika symulacji. */
export async function sendCommand(body: unknown): Promise<void> {
  await fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Pobiera warstwę mapową, a po jej wczytaniu — listę POI.
 *
 * Zwraca komunikat do pokazania użytkownikowi, bo to jedyna operacja
 * w interfejsie, która może trwać sekundy i realnie się nie udać.
 */
export async function loadMapLayer(): Promise<string> {
  const response = await fetch("/api/sim/control", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "loadMap" }),
  });

  const status = (await response.json()) as SimStatus & {
    mapLoad?: { ok: boolean; detail: string };
  };
  useSimStore.getState().setStatus(status);

  if (!status.mapLoad?.ok) {
    return status.mapLoad?.detail ?? "Nie udało się pobrać mapy";
  }

  await refreshPois();
  return status.mapLoad.detail;
}

export async function refreshPois(): Promise<void> {
  try {
    const response = await fetch("/api/osm/poi?priority=2");
    if (!response.ok) return;
    const data = (await response.json()) as { pois: MapPoi[] };
    useSimStore.getState().setPois(data.pois);
  } catch {
    // Brak POI nie blokuje niczego innego w interfejsie.
  }
}
