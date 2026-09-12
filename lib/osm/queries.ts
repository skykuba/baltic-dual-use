import { categoriesByPriority, type PoiPriority } from "./poi";

/** Prostokąt w kolejności wymaganej przez Overpass: S, W, N, E. */
export type BBox = {
  south: number;
  west: number;
  north: number;
  east: number;
};

export function bboxString(b: BBox): string {
  return `${b.south},${b.west},${b.north},${b.east}`;
}

/**
 * Drogi i ścieżki, po których może poruszać się pieszy.
 *
 * `out body geom` zwraca JEDNOCZEŚNIE identyfikatory węzłów (`nodes`)
 * i ich współrzędne (`geometry`) jako równoległe tablice. Same współrzędne
 * nie wystarczą: bez identyfikatorów trzeba by sklejać skrzyżowania po
 * porównywaniu liczb zmiennoprzecinkowych, a to zawodzi tam, gdzie graf
 * najbardziej się liczy — właśnie na skrzyżowaniach.
 */
export function walkableWaysQuery(bbox: BBox, timeout = 60): string {
  return `[out:json][timeout:${timeout}];
way["highway"]
   ["highway"!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway)$"]
   ["area"!~"yes"]
   (${bboxString(bbox)});
out body geom;`;
}

/**
 * Budynki jako przeszkody dla filtru cząsteczkowego.
 *
 * Ograniczone do `way` — relacje (multipolygony) wymagałyby składania
 * pierścieni, a ich udział w typowej zabudowie jest na tyle mały,
 * że nie zmienia jakości map matchingu.
 */
export function buildingsQuery(bbox: BBox, timeout = 60): string {
  return `[out:json][timeout:${timeout}];
way["building"](${bboxString(bbox)});
out body geom;`;
}

/** Punkty istotne kryzysowo do zadanego priorytetu włącznie. */
export function poiQuery(
  bbox: BBox,
  maxPriority: PoiPriority,
  timeout = 60,
): string {
  const box = bboxString(bbox);
  const parts: string[] = [];

  for (const category of categoriesByPriority(maxPriority)) {
    for (const filter of category.filters) {
      // Zarówno node, jak i way — szpital bywa obiektem punktowym
      // albo obrysem budynku, zależnie od tego, kto go mapował.
      parts.push(`  node${filter}(${box});`);
      parts.push(`  way${filter}(${box});`);
    }
  }

  return `[out:json][timeout:${timeout}];
(
${parts.join("\n")}
);
out center tags;`;
}
