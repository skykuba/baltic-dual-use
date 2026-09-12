import type { ImuSample } from "@/lib/types";
import { StepDetector, type StepEvent } from "./stepDetect";
import { StepLengthEstimator } from "./stepLength";
import { HeadingEstimator } from "./heading";

/**
 * Pedestrian Dead Reckoning — składa detekcję kroków, estymację długości
 * kroku i estymację kursu w przyrosty przemieszczenia.
 *
 * Moduł celowo NIE zna pozycji. Produkuje wyłącznie przyrosty (krok po kroku),
 * a co z nimi zrobić, decyduje warstwa wyżej: filtr cząsteczkowy z mapą albo
 * proste całkowanie. Dzięki temu PDR da się testować w izolacji, a wymiana
 * metody fuzji nie dotyka tego kodu.
 */

export type StepDisplacement = {
  /** Długość kroku w metrach. */
  length: number;
  /** Kurs w chwili kroku, stopnie od północy. */
  heading: number;
  /** Numer kroku od startu. */
  index: number;
  event: StepEvent;
};

export class PdrEngine {
  private readonly detector: StepDetector;
  private readonly stepLength: StepLengthEstimator;
  private readonly headingEstimator: HeadingEstimator;
  private stepCount = 0;
  private distanceAccum = 0;

  constructor(sampleRate: number, initialHeading = 0) {
    this.detector = new StepDetector(sampleRate);
    this.stepLength = new StepLengthEstimator();
    this.headingEstimator = new HeadingEstimator(initialHeading);
  }

  /**
   * Przetwarza jedną próbkę IMU. Zwraca przemieszczenie tylko wtedy,
   * gdy wykryto krok — czyli rzadziej niż raz na 25 próbek przy 50 Hz.
   */
  push(imu: ImuSample, t: number, dt: number): StepDisplacement | null {
    const heading = this.headingEstimator.update(imu.gyro, imu.mag, dt);
    const event = this.detector.push(imu.accel, t);
    if (!event) return null;

    const length = this.stepLength.estimate(event);
    this.stepCount += 1;
    this.distanceAccum += length;

    return { length, heading, index: this.stepCount, event };
  }

  /** Kurs bieżący — potrzebny do wizualizacji także między krokami. */
  get heading(): number {
    return this.headingEstimator.value;
  }

  get steps(): number {
    return this.stepCount;
  }

  /** Dystans przebyty wg PDR od startu, w metrach. */
  get distance(): number {
    return this.distanceAccum;
  }

  get stepLengthCoefficient(): number {
    return this.stepLength.coefficient;
  }

  /**
   * Korekta kursu po uzyskaniu wiarygodnego odniesienia
   * (powrót GNSS albo korekcja ręczna).
   */
  setHeading(heading: number): void {
    this.headingEstimator.set(heading);
  }

  /**
   * Częściowe ściągnięcie kursu w stronę wskazanej wartości.
   *
   * Używane przy kursie z GNSS, który opisuje ŚREDNI kierunek na przebytym
   * odcinku, a nie kierunek bieżący. Twarde ustawienie wprowadzałoby błąd
   * za każdym razem, gdy pieszy skręca.
   */
  nudgeHeading(heading: number, weight: number): void {
    this.headingEstimator.nudge(heading, weight);
  }

  /** Rekalibracja długości kroku znanym dystansem rzeczywistym. */
  recalibrate(estimatedDistance: number, actualDistance: number): void {
    this.stepLength.recalibrate(estimatedDistance, actualDistance);
  }
}
