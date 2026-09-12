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

  static fromElements(elements: OverpassElement[]): Buildings {
    const buildings = new Buildings();

    for (const element of elements) {
      if (element.type !== "way" || !element.geometry) continue;
      // Poniżej czterech punktów obrys nie domyka się w wielokąt.
      if (element.geometry.length < 4) continue;

      const lats = element.geometry.map((p) => p.lat);
      const lons = element.geometry.map((p) => p.lon);
      buildings.add({ lats, lons });
    }

    return buildings;
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
