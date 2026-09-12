import type { LatLon, TerrainKind } from "@/lib/geo/types";
import { fromEnu } from "@/lib/geo/projection";
import type { Rng } from "./random";
import type { GnssFix } from "@/lib/types";

/** Błąd pozycji GNSS (1σ, metry) i liczba widocznych satelitów wg terenu. */
const GNSS_PROFILE: Record<TerrainKind, { sigma: number; sats: number }> = {
  // Kanion miejski: odbicia wielodrogowe psują dokładność mimo dobrej widoczności
  urban: { sigma: 6.5, sats: 7 },
  // Korona drzew tłumi sygnał
  forest: { sigma: 9.0, sats: 5 },
  open: { sigma: 3.0, sats: 11 },
};

/**
 * Symulowany odczyt GNSS.
 *
 * Błąd jest skorelowany w czasie (proces AR(1)), a nie niezależny między
 * próbkami — realny odbiornik „pływa" wokół prawdziwej pozycji zamiast
 * skakać. Ma to znaczenie, bo estymator inicjalizuje chmurę cząstek
 * ostatnim fixem i musi radzić sobie z jego obciążeniem, nie tylko szumem.
 */
export type GnssState = {
  biasE: number;
  biasN: number;
};

export function initGnss(): GnssState {
  return { biasE: 0, biasN: 0 };
}

export function synthGnss(
  truth: LatLon,
  terrain: TerrainKind,
  state: GnssState,
  dt: number,
  rng: Rng,
): { fix: GnssFix; state: GnssState } {
  const { sigma, sats } = GNSS_PROFILE[terrain];

  // AR(1): bias zanika ze stałą czasową ~20 s i jest odświeżany szumem.
  const decay = Math.exp(-dt / 20);
  const driveSigma = sigma * 0.7 * Math.sqrt(1 - decay * decay);
  const next: GnssState = {
    biasE: state.biasE * decay + rng.gauss(0, driveSigma),
    biasN: state.biasN * decay + rng.gauss(0, driveSigma),
  };

  const jitter = sigma * 0.4;
  const pos = fromEnu(truth, {
    e: next.biasE + rng.gauss(0, jitter),
    n: next.biasN + rng.gauss(0, jitter),
  });

  return {
    fix: {
      lat: pos.lat,
      lon: pos.lon,
      accuracy: sigma,
      satellites: Math.max(4, Math.round(sats + rng.gauss(0, 1))),
    },
    state: next,
  };
}
