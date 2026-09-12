import type { Vec3 } from "@/lib/geo/types";
import { angleDiff, normalizeDeg } from "@/lib/geo/projection";

/**
 * Estymacja kursu przez fuzję żyroskopu i magnetometru (filtr komplementarny).
 *
 * Podział ról wynika z charakterystyk błędów obu czujników:
 *   - żyroskop jest dokładny w krótkim horyzoncie, ale jego bias się całkuje,
 *     więc dryfuje bez ograniczeń;
 *   - magnetometr nie dryfuje, ale w zabudowie potrafi się mylić
 *     o kilkadziesiąt stopni.
 *
 * Filtr ufa żyroskopowi na krótką metę i pozwala magnetometrowi powoli
 * ściągać wynik do prawdy.
 *
 * Błąd kursu jest DOMINUJĄCYM źródłem błędu pozycji w PDR: 5° błędu
 * to około 87 m odchyłki bocznej na kilometr marszu.
 */

/** Stała czasowa filtru w sekundach — po tylu sekundach magnetometr „wygrywa". */
const TIME_CONSTANT_S = 12;

/**
 * Próg odrzucenia magnetometru. Odczyt odbiegający od predykcji żyroskopu
 * bardziej niż o tę wartość traktujemy jako anomalię magnetyczną i ignorujemy.
 */
const MAG_REJECT_DEG = 45;

export class HeadingEstimator {
  private heading: number;
  /** Wygładzony kurs magnetyczny — tłumi biały szum przed fuzją. */
  private magSmoothed: number | null = null;
  private initialized = false;

  constructor(initialHeading = 0) {
    this.heading = normalizeDeg(initialHeading);
  }

  update(gyro: Vec3, mag: Vec3, dt: number): number {
    // Całkowanie prędkości kątowej wokół osi pionowej.
    const gyroDelta = (gyro[2] * 180) / Math.PI * dt;
    const predicted = normalizeDeg(this.heading + gyroDelta);

    const magHeading = headingFromMagnetometer(mag);

    if (this.magSmoothed === null) {
      this.magSmoothed = magHeading;
    } else {
      // Uśrednianie kołowe — naiwne uśrednianie psuje się przy przejściu przez 0°.
      this.magSmoothed = normalizeDeg(
        this.magSmoothed + 0.08 * angleDiff(magHeading, this.magSmoothed),
      );
    }

    if (!this.initialized) {
      this.heading = this.magSmoothed;
      this.initialized = true;
      return this.heading;
    }

    const innovation = angleDiff(this.magSmoothed, predicted);

    if (Math.abs(innovation) > MAG_REJECT_DEG) {
      // Anomalia magnetyczna — polegamy wyłącznie na żyroskopie.
      this.heading = predicted;
      return this.heading;
    }

    const gain = 1 - Math.exp(-dt / TIME_CONSTANT_S);
    this.heading = normalizeDeg(predicted + gain * innovation);
    return this.heading;
  }

  /** Twarde ustawienie kursu — używane przy korekcji ręcznej. */
  set(heading: number): void {
    this.heading = normalizeDeg(heading);
    this.magSmoothed = this.heading;
    this.initialized = true;
  }

  get value(): number {
    return this.heading;
  }
}

/**
 * Kurs magnetyczny z odczytu magnetometru.
 *
 * Zakładamy poziomą orientację urządzenia. Pełne rozwiązanie wymagałoby
 * kompensacji przechyłu z akcelerometru; przy telefonie noszonym stabilnie
 * na torsie uproszczenie jest akceptowalne i nie zmienia wniosków demo.
 */
export function headingFromMagnetometer(mag: Vec3): number {
  return normalizeDeg((Math.atan2(-mag[1], mag[0]) * 180) / Math.PI);
}
