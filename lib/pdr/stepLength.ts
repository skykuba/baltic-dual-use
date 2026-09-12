import type { StepEvent } from "./stepDetect";

/**
 * Estymacja długości kroku metodą Weinberga:
 *
 *     L = K · ⁴√(a_max − a_min)
 *
 * Pierwiastek czwartego stopnia tłumi wpływ pojedynczych wystrzałów
 * amplitudy, co czyni ten model wyraźnie stabilniejszym od modeli
 * opartych na średniej amplitudzie przy zmiennym tempie marszu.
 */

/**
 * Wartość początkowa współczynnika.
 *
 * Celowo NIE jest równa stałej użytej w symulatorze (0,5). Realny system
 * nigdy nie zna idealnej kalibracji użytkownika, a 4% błędu skali to
 * uczciwe odwzorowanie tego, co zostaje po typowej kalibracji.
 */
const DEFAULT_K = 0.52;

/** Granice sensownej długości kroku człowieka — zabezpieczenie przed artefaktami. */
const MIN_STEP_M = 0.3;
const MAX_STEP_M = 1.2;

export class StepLengthEstimator {
  private k: number;

  constructor(k: number = DEFAULT_K) {
    this.k = k;
  }

  estimate(step: StepEvent): number {
    const range = Math.max(step.aMax - step.aMin, 0.01);
    const raw = this.k * Math.pow(range, 0.25);
    return clamp(raw, MIN_STEP_M, MAX_STEP_M);
  }

  /**
   * Rekalibracja współczynnika, gdy znamy rzeczywisty przebyty dystans —
   * np. po odzyskaniu GNSS albo po korekcji ręcznej.
   *
   * To jest cichy bohater całego rozwiązania: każdy powrót sygnału
   * i każda korekcja żołnierza poprawiają estymację NA PRZYSZŁOŚĆ,
   * a nie tylko naprawiają bieżącą pozycję.
   */
  recalibrate(estimatedDistance: number, actualDistance: number): void {
    if (estimatedDistance < 5 || actualDistance < 5) return;
    const ratio = actualDistance / estimatedDistance;
    if (ratio < 0.5 || ratio > 2) return;
    // Wygładzanie — pojedynczy pomiar nie przestawia kalibracji na sztywno.
    this.k = this.k * 0.7 + this.k * ratio * 0.3;
  }

  get coefficient(): number {
    return this.k;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}
