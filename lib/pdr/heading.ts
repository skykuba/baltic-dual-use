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

  /** Fuzja z surowym magnetometrem — droga symulatora i czujnika sprzętowego. */
  update(gyro: Vec3, mag: Vec3, dt: number): number {
    return this.fuse(gyro[2], headingFromMagnetometer(mag), dt);
  }

  /**
   * Fuzja z gotowym kursem kompasowym — droga telefonu.
   *
   * Przeglądarka nie udostępnia surowego magnetometru. Daje za to kurs
   * z `DeviceOrientationEvent`, który system operacyjny sam zfuzował
   * z akcelerometru, magnetometru i żyroskopu. Jest więc lepszy niż surowy
   * odczyt magnetyczny i nie wymaga kompensacji przechyłu.
   *
   * Nadal jednak przepuszczamy go przez ten sam filtr, z dwóch powodów:
   * fuzja systemowa też daje się oszukać anomalii magnetycznej w zabudowie
   * (a bramka odrzucenia to wyłapie), i nadal chcemy krótkoterminowej
   * gładkości żyroskopu między odczytami kompasu, które przychodzą rzadziej
   * niż próbki IMU.
   *
   * `heading === null` znaczy „kompas nie podał kursu odniesionego do
   * północy" — wtedy całkujemy sam żyroskop, zamiast wstawiać zmyśloną wartość.
   */
  updateWithCompass(gyroZ: number, heading: number | null, dt: number): number {
    if (heading === null) {
      this.heading = normalizeDeg(this.heading + ((gyroZ * 180) / Math.PI) * dt);
      return this.heading;
    }
    return this.fuse(gyroZ, heading, dt);
  }

  /** Wspólne jądro filtru komplementarnego. */
  private fuse(gyroZ: number, reference: number, dt: number): number {
    // Całkowanie prędkości kątowej wokół osi pionowej.
    const gyroDelta = ((gyroZ * 180) / Math.PI) * dt;
    const predicted = normalizeDeg(this.heading + gyroDelta);

    if (this.magSmoothed === null) {
      this.magSmoothed = reference;
    } else {
      // Uśrednianie kołowe — naiwne uśrednianie psuje się przy przejściu przez 0°.
      this.magSmoothed = normalizeDeg(
        this.magSmoothed + 0.08 * angleDiff(reference, this.magSmoothed),
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

  /**
   * Częściowe ściągnięcie kursu w stronę zadanej wartości.
   *
   * Różnica kątowa liczona przez angleDiff, bo naiwne mieszanie stopni
   * psuje się przy przejściu przez północ: średnia z 350° i 10° to 0°,
   * a nie 180°.
   */
  nudge(heading: number, weight: number): void {
    if (!this.initialized) {
      this.set(heading);
      return;
    }
    const w = Math.min(Math.max(weight, 0), 1);
    this.heading = normalizeDeg(
      this.heading + w * angleDiff(heading, this.heading),
    );
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
