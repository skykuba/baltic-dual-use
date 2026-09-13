import type { ImuSample } from "@/lib/types";
import type { Vec3 } from "@/lib/geo/types";

/**
 * Odczyty z czujników prawdziwego telefonu, sprowadzone do formatu, którego
 * oczekuje estymator.
 *
 * Symulator produkuje `ImuSample` w jednostkach SI w układzie urządzenia.
 * Przeglądarka produkuje coś podobnego, ale NIE identycznego — i każda
 * z tych różnic jest osobnym sposobem na cichą pomyłkę:
 *
 *   1. `rotationRate` jest w STOPNIACH na sekundę (W3C DeviceOrientation),
 *      a nasz żyroskop w radianach. Pominięcie konwersji daje kurs obracający
 *      się 57 razy za szybko — co wygląda jak zepsuty algorytm, a jest
 *      pomyłką jednostek.
 *   2. Osie `rotationRate` to {alpha, beta, gamma}, czyli obrót wokół osi
 *      Z, X, Y — w tej kolejności, nie XYZ.
 *   3. `accelerationIncludingGravity` jest w m/s² i zawiera grawitację,
 *      czyli dokładnie to, czego potrzebuje detektor kroków. Pole
 *      `acceleration` (bez grawitacji) NIE nadaje się — próg detekcji
 *      kroków jest kalibrowany na module z grawitacją.
 *   4. Magnetometru przeglądarka nie udostępnia w ogóle. Zamiast niego
 *      jest gotowy kurs kompasowy z `DeviceOrientationEvent`, już zfuzowany
 *      przez system operacyjny — patrz `compassHeading`.
 */

/** Zdarzenie ruchu w kształcie, jaki daje przeglądarka. */
export type MotionEvent = {
  accelerationIncludingGravity: {
    x: number | null;
    y: number | null;
    z: number | null;
  } | null;
  /** Stopnie na sekundę, wokół osi Z, X, Y. */
  rotationRate: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  } | null;
  /** Milisekundy między próbkami, jeśli urządzenie je podaje. */
  interval?: number;
};

/** Zdarzenie orientacji — źródło kursu kompasowego. */
export type OrientationEvent = {
  /** Obrót wokół osi pionowej, 0–360. Względny, chyba że `absolute`. */
  alpha: number | null;
  /** Czy `alpha` jest odniesiona do północy geograficznej. */
  absolute?: boolean;
  /** Kurs względem północy magnetycznej — wyłącznie Safari na iOS. */
  webkitCompassHeading?: number;
  /** Dokładność kursu w stopniach — wyłącznie Safari na iOS. */
  webkitCompassAccuracy?: number;
};

const DEG_TO_RAD = Math.PI / 180;

/**
 * Zamienia zdarzenie ruchu na próbkę IMU.
 *
 * Zwraca `null`, gdy urządzenie nie podało wartości — zdarza się to na
 * telefonach bez żyroskopu oraz przy pierwszych zdarzeniach po nadaniu
 * uprawnień. Wstawienie zer byłoby gorsze niż pominięcie próbki: estymator
 * potraktowałby je jako rzeczywisty brak obrotu.
 *
 * Pole `mag` wypełniamy zerami, bo przeglądarka magnetometru nie daje.
 * Kurs wchodzi osobną drogą — przez `HeadingEstimator.updateWithCompass`.
 */
export function toImuSample(event: MotionEvent): ImuSample | null {
  const a = event.accelerationIncludingGravity;
  const r = event.rotationRate;

  if (!a || a.x === null || a.y === null || a.z === null) return null;
  if (!r || r.alpha === null || r.beta === null || r.gamma === null) return null;

  // rotationRate: alpha wokół Z, beta wokół X, gamma wokół Y — stąd kolejność.
  const gyro: Vec3 = [
    r.beta * DEG_TO_RAD,
    r.gamma * DEG_TO_RAD,
    r.alpha * DEG_TO_RAD,
  ];

  const accel: Vec3 = [a.x, a.y, a.z];
  const mag: Vec3 = [0, 0, 0];

  return { accel, gyro, mag };
}

/**
 * Kurs kompasowy ze zdarzenia orientacji, w stopniach od północy.
 *
 * Trzy przypadki, bo trzy różne światy:
 *
 *   - Safari na iOS: `webkitCompassHeading` jest już kursem od północy
 *     magnetycznej, rosnącym zgodnie z ruchem wskazówek zegara. Bierzemy wprost.
 *   - Chrome na Androidzie: `alpha` z `absolute: true` to obrót wokół osi
 *     pionowej liczony PRZECIWNIE do ruchu wskazówek zegara, więc kurs to
 *     `360 − alpha`. Pominięcie tego odbicia daje kurs lustrzany — pieszy
 *     idzie na wschód, system melduje zachód.
 *   - `absolute: false`: odniesienie jest dowolne, nie północ. Taki odczyt
 *     jest bezużyteczny jako kurs i zwracamy `null` zamiast udawać, że wiemy.
 */
export function compassHeading(event: OrientationEvent): number | null {
  if (typeof event.webkitCompassHeading === "number") {
    return normalize360(event.webkitCompassHeading);
  }
  if (event.absolute === true && event.alpha !== null) {
    return normalize360(360 - event.alpha);
  }
  return null;
}

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Prośba o zgodę na czujniki.
 *
 * iOS od wersji 13 wymaga jawnej zgody, o którą MOŻNA poprosić wyłącznie
 * w obsłudze gestu użytkownika — wywołanie przy starcie aplikacji zostanie
 * odrzucone bez żadnego komunikatu. Android i Capacitor zgody nie wymagają,
 * więc funkcja zwraca tam `true` od razu.
 *
 * Wymagany jest też kontekst bezpieczny (HTTPS albo localhost). W aplikacji
 * Capacitora zawartość serwowana jest z `capacitor://`, co ten warunek spełnia.
 */
export async function requestSensorPermission(): Promise<boolean> {
  const motion = (
    globalThis as unknown as {
      DeviceMotionEvent?: { requestPermission?: () => Promise<string> };
    }
  ).DeviceMotionEvent;

  if (typeof motion?.requestPermission !== "function") return true;

  try {
    return (await motion.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
