/**
 * Deterministyczny generator liczb pseudolosowych (mulberry32).
 *
 * Powtarzalność jest tu wymaganiem, nie wygodą: demo musi zachować się
 * tak samo na próbie i na prezentacji, a metryki błędu muszą być
 * porównywalne między uruchomieniami.
 */
export class Rng {
  private state: number;

  constructor(seed = 0x9e3779b9) {
    this.state = seed >>> 0;
  }

  /** Równomierny rozkład na [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  /** Równomierny na [min, max). */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Rozkład normalny (Box–Muller). */
  gauss(mean = 0, sigma = 1): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
