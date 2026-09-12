import type { Rng } from "./random";

/**
 * Model chodu pieszego.
 *
 * Celem nie jest biomechaniczna wierność, tylko żeby sygnał z akcelerometru
 * miał te własności, na których opiera się PDR: wyraźną okresowość na
 * częstotliwości kroku i amplitudę skorelowaną z długością kroku. Bez tej
 * korelacji estymacja długości kroku metodą Weinberga nie miałaby czego
 * mierzyć, a demo byłoby ustawką.
 */

/** Współczynnik Weinberga użyty do SYNTEZY sygnału (prawda). */
export const WEINBERG_K_TRUE = 0.5;

export type GaitState = {
  /** Częstotliwość kroku w Hz. */
  cadence: number;
  /** Długość kroku w metrach. */
  stepLength: number;
  /** Faza cyklu kroku w radianach, [0, 2π). */
  phase: number;
  /** Amplituda pionowych oscylacji przyspieszenia w m/s². */
  verticalAmplitude: number;
};

export function initGait(walkSpeed: number, rng: Rng): GaitState {
  const cadence = clamp(rng.gauss(1.8, 0.06), 1.5, 2.1);
  const stepLength = walkSpeed / cadence;
  return {
    cadence,
    stepLength,
    phase: 0,
    verticalAmplitude: amplitudeForStepLength(stepLength),
  };
}

/**
 * Odwrócony wzór Weinberga: L = K·⁴√(Δa)  ⇒  Δa = (L/K)⁴,  A = Δa/2.
 *
 * Dla L = 0,75 m i K = 0,5 daje to Δa ≈ 5 m/s² — wartość zgodna z tym,
 * co widać w rzeczywistych pomiarach marszu.
 */
export function amplitudeForStepLength(stepLength: number): number {
  return 0.5 * Math.pow(stepLength / WEINBERG_K_TRUE, 4);
}

/**
 * Postęp modelu o `dt` sekund. Kadencja podlega powolnej wariancji,
 * żeby detektor kroków nie miał do czynienia z idealnie stałym rytmem.
 */
export function stepGait(
  gait: GaitState,
  walkSpeed: number,
  dt: number,
  rng: Rng,
): GaitState {
  const cadence = clamp(gait.cadence + rng.gauss(0, 0.015) * dt, 1.5, 2.1);
  const stepLength = walkSpeed / cadence;
  return {
    cadence,
    stepLength,
    phase: (gait.phase + 2 * Math.PI * cadence * dt) % (2 * Math.PI),
    verticalAmplitude: amplitudeForStepLength(stepLength),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
