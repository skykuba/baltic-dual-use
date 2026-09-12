import type { Enu, LatLon } from "./types";

const EARTH_RADIUS_M = 6_378_137;
const DEG = Math.PI / 180;

/**
 * Lokalna płaska projekcja wokół punktu odniesienia (equirectangular).
 *
 * Dla obszaru operacji rzędu kilkunastu kilometrów błąd tej projekcji jest
 * poniżej metra, czyli o rząd wielkości mniejszy niż błąd estymacji, który
 * badamy. Nie ma powodu sięgać po UTM.
 */
export function metersPerDegree(refLat: number): { lat: number; lon: number } {
  return {
    lat: (EARTH_RADIUS_M * DEG),
    lon: (EARTH_RADIUS_M * DEG) * Math.cos(refLat * DEG),
  };
}

/** Przemieszczenie z `from` do `to`, w metrach w układzie ENU. */
export function toEnu(from: LatLon, to: LatLon): Enu {
  const m = metersPerDegree(from.lat);
  return {
    e: (to.lon - from.lon) * m.lon,
    n: (to.lat - from.lat) * m.lat,
  };
}

/** Przesunięcie punktu o wektor ENU. */
export function fromEnu(origin: LatLon, d: Enu): LatLon {
  const m = metersPerDegree(origin.lat);
  return {
    lat: origin.lat + d.n / m.lat,
    lon: origin.lon + d.e / m.lon,
  };
}

/** Odległość w metrach. Haversine — dokładny również dla dużych dystansów. */
export function distance(a: LatLon, b: LatLon): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLon = (b.lon - a.lon) * DEG;
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Azymut z `a` do `b` w stopniach od północy, w zakresie [0, 360). */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG;
  const lat2 = b.lat * DEG;
  const dLon = (b.lon - a.lon) * DEG;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return normalizeDeg((Math.atan2(y, x) * 180) / Math.PI);
}

/** Przesunięcie o `dist` metrów w kierunku `headingDeg`. */
export function offset(from: LatLon, headingDeg: number, dist: number): LatLon {
  const rad = headingDeg * DEG;
  return fromEnu(from, {
    e: Math.sin(rad) * dist,
    n: Math.cos(rad) * dist,
  });
}

/** Normalizacja kąta do [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Najmniejsza różnica kątowa `a - b`, w zakresie (-180, 180].
 * Potrzebna wszędzie tam, gdzie uśredniamy lub porównujemy kursy —
 * naiwne odejmowanie psuje się przy przejściu przez północ.
 */
export function angleDiff(a: number, b: number): number {
  let d = normalizeDeg(a - b);
  if (d > 180) d -= 360;
  return d;
}

/** Interpolacja liniowa między dwoma punktami, `t` w [0, 1]. */
export function lerpLatLon(a: LatLon, b: LatLon, t: number): LatLon {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lon: a.lon + (b.lon - a.lon) * t,
  };
}
