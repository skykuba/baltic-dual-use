import type { Vec3 } from "@/lib/geo/types";

/**
 * Strumieniowa detekcja kroków metodą peak–valley na pionowej składowej
 * przyspieszenia.
 *
 * Implementacja jest strumieniowa, nie okienkowa, bo ma pracować na żywym
 * strumieniu z czujnika — dokładnie tak jak działałaby na urządzeniu.
 */

/** Minimalny odstęp między krokami — odcina drgania o wysokiej częstotliwości. */
const MIN_STEP_INTERVAL_S = 0.25;
/** Maksymalny odstęp — powyżej uznajemy, że marsz się urwał. */
const MAX_STEP_INTERVAL_S = 2.0;
/** Minimalna amplituda peak-to-valley, poniżej której to nie jest krok. */
const MIN_PROMINENCE = 1.2;

export type StepEvent = {
  /** Czas detekcji w sekundach od startu. */
  t: number;
  /** Maksimum przyspieszenia w cyklu kroku, m/s². */
  aMax: number;
  /** Minimum przyspieszenia w cyklu kroku, m/s². */
  aMin: number;
  /** Czas trwania kroku w sekundach. */
  interval: number;
};

type Phase = "idle" | "rising" | "falling";

export class StepDetector {
  /** Wygładzony sygnał (filtr dolnoprzepustowy pierwszego rzędu). */
  private filtered = 9.80665;
  /** Wolno zmienna średnia — pełni rolę adaptacyjnego progu. */
  private baseline = 9.80665;
  private phase: Phase = "idle";
  private peak = 0;
  private valley = 0;
  private lastStepT = -Infinity;
  private readonly alphaLp: number;
  private readonly alphaBase: number;

  /**
   * @param sampleRate częstotliwość próbkowania IMU w Hz
   */
  constructor(sampleRate: number) {
    // Filtr dolnoprzepustowy ~3 Hz: przepuszcza kroki (1,5–2,5 Hz),
    // tłumi drgania i szum czujnika.
    this.alphaLp = cutoffToAlpha(3.0, sampleRate);
    // Baseline ~0,1 Hz: podąża za orientacją urządzenia, nie za krokami.
    this.alphaBase = cutoffToAlpha(0.1, sampleRate);
  }

  /**
   * Przetwarza jedną próbkę. Zwraca zdarzenie kroku, gdy krok został
   * zamknięty, w przeciwnym razie `null`.
   */
  push(accel: Vec3, t: number): StepEvent | null {
    // Moduł wektora przyspieszenia — niewrażliwy na orientację urządzenia,
    // w odróżnieniu od surowej składowej Z.
    const magnitude = Math.hypot(accel[0], accel[1], accel[2]);

    this.filtered += this.alphaLp * (magnitude - this.filtered);
    this.baseline += this.alphaBase * (this.filtered - this.baseline);

    const signal = this.filtered;
    const threshold = this.baseline;

    switch (this.phase) {
      case "idle":
        if (signal > threshold) {
          this.phase = "rising";
          this.peak = signal;
        }
        break;

      case "rising":
        if (signal > this.peak) {
          this.peak = signal;
        } else if (signal < threshold) {
          this.phase = "falling";
          this.valley = signal;
        }
        break;

      case "falling":
        if (signal < this.valley) {
          this.valley = signal;
        } else if (signal > threshold) {
          // Zamknięcie cyklu: przejście przez próg w górę po dolinie.
          const step = this.closeStep(t);
          this.phase = "rising";
          this.peak = signal;
          if (step) return step;
        }
        break;
    }

    return null;
  }

  private closeStep(t: number): StepEvent | null {
    const prominence = this.peak - this.valley;
    const interval = t - this.lastStepT;

    if (prominence < MIN_PROMINENCE) return null;
    if (interval < MIN_STEP_INTERVAL_S) return null;

    const event: StepEvent = {
      t,
      aMax: this.peak,
      aMin: this.valley,
      // Pierwszy krok nie ma poprzednika — przyjmujemy typową kadencję.
      interval: Number.isFinite(interval)
        ? Math.min(interval, MAX_STEP_INTERVAL_S)
        : 0.55,
    };
    this.lastStepT = t;
    return event;
  }

  reset(): void {
    this.filtered = 9.80665;
    this.baseline = 9.80665;
    this.phase = "idle";
    this.lastStepT = -Infinity;
  }
}

/** Stała filtru EMA odpowiadająca zadanej częstotliwości odcięcia. */
function cutoffToAlpha(cutoffHz: number, sampleRate: number): number {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  return dt / (rc + dt);
}
