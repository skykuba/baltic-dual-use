import type { LatLon } from "@/lib/geo/types";
import type { OverpassElement } from "./overpass";

/**
 * Obrysy budynków jako przeszkody dla filtru cząsteczkowego.
 *
 * Pieszy nie przechodzi przez ścianę. Cząstka, która znalazła się wewnątrz
 * budynku, jest prawie na pewno błędna — i to jest jedno z najsilniejszych
 * ograniczeń dostępnych za darmo w OpenStreetMap.
 */

type Ring = { lats: number[]; lons: number[] };

type IndexedBuilding = {
  ring: Ring;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export class Buildings {
  private readonly items: IndexedBuilding[] = [];
  private readonly grid = new Map<string, number[]>();
  private readonly cellSize = 0.001;
  /** Obrysy już wchłonięte — budynek na granicy kafli wraca dwa razy. */
  private readonly seenWays = new Set<number>();

  /**
   * Buduje indeks z odpowiedzi Overpassa.
   *
   * Jak w grafie dróg, obsługiwane są oba kształty odpowiedzi: z tablicą
   * `geometry` (`out geom`) i z osobnymi węzłami (`out body; >; out skel qt`).
   */
  static fromElements(elements: OverpassElement[]): Buildings {
    const buildings = new Buildings();
    buildings.addElements(elements);
    return buildings;
  }

  /** Dokłada kolejną porcję obrysów. Indeks siatkowy rośnie przyrostowo. */
  addElements(elements: OverpassElement[]): void {
    const coords = new Map<number, { lat: number; lon: number }>();
    for (const element of elements) {
      if (element.type !== "node") continue;
      if (element.lat === undefined || element.lon === undefined) continue;
      coords.set(element.id, { lat: element.lat, lon: element.lon });
    }

    for (const element of elements) {
      if (element.type !== "way") continue;
      if (this.seenWays.has(element.id)) continue;
      this.seenWays.add(element.id);

      const ring =
        element.geometry ??
        element.nodes
          ?.map((id) => coords.get(id))
          .filter((p): p is { lat: number; lon: number } => p !== undefined);

      // Poniżej czterech punktów obrys nie domyka się w wielokąt.
      // Dotyczy to także budynków częściowo wychodzących poza bbox,
      // którym brakuje węzłów — lepiej je pominąć niż traktować
      // niedomknięty łańcuch jako przeszkodę.
      if (!ring || ring.length < 4) continue;

      this.add({
        lats: ring.map((p) => p.lat),
        lons: ring.map((p) => p.lon),
      });
    }
  }

  private add(ring: Ring): void {
    const item: IndexedBuilding = {
      ring,
      minLat: Math.min(...ring.lats),
      maxLat: Math.max(...ring.lats),
      minLon: Math.min(...ring.lons),
      maxLon: Math.max(...ring.lons),
    };
    const index = this.items.length;
    this.items.push(item);

    for (
      let la = Math.floor(item.minLat / this.cellSize);
      la <= Math.floor(item.maxLat / this.cellSize);
      la++
    ) {
      for (
        let lo = Math.floor(item.minLon / this.cellSize);
        lo <= Math.floor(item.maxLon / this.cellSize);
        lo++
      ) {
        const key = `${la}:${lo}`;
        const bucket = this.grid.get(key);
        if (bucket) bucket.push(index);
        else this.grid.set(key, [index]);
      }
    }
  }

  get count(): number {
    return this.items.length;
  }

  /** Czy punkt leży wewnątrz któregoś budynku. */
  contains(point: LatLon): boolean {
    const key = `${Math.floor(point.lat / this.cellSize)}:${Math.floor(point.lon / this.cellSize)}`;
    const bucket = this.grid.get(key);
    if (!bucket) return false;

    for (const index of bucket) {
      const item = this.items[index];
      // Test prostokąta otaczającego odrzuca większość kandydatów
      // przed kosztowniejszym testem wielokąta.
      if (
        point.lat < item.minLat ||
        point.lat > item.maxLat ||
        point.lon < item.minLon ||
        point.lon > item.maxLon
      ) {
        continue;
      }
      if (pointInRing(point, item.ring)) return true;
    }

    return false;
  }
}

/** Algorytm promienia (ray casting) z parzystością przecięć. */
function pointInRing(point: LatLon, ring: Ring): boolean {
  const { lats, lons } = ring;
  let inside = false;

  for (let i = 0, j = lats.length - 1; i < lats.length; j = i++) {
    const intersects =
      lats[i] > point.lat !== lats[j] > point.lat &&
      point.lon <
        ((lons[j] - lons[i]) * (point.lat - lats[i])) / (lats[j] - lats[i]) +
          lons[i];
    if (intersects) inside = !inside;
  }

  return inside;
}
