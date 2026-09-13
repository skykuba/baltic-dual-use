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
 * Wzorzec `out body; >; out skel qt;` zamiast `out geom`:
 *   - `out body` zwraca ways z listą identyfikatorów węzłów,
 *   - `>` (recurse down) dobiera wszystkie węzły, do których te ways się
 *     odwołują,
 *   - `out skel qt` wypisuje je jako same współrzędne, posortowane.
 *
 * Jest to konstrukcja obsługiwana przez każdą wersję Overpassa, podczas gdy
 * `out geom` bywa niedostępne albo zachowuje się inaczej na starszych
 * instancjach. Identyfikatory węzłów są tu niezbędne niezależnie od wariantu:
 * bez nich trzeba by sklejać skrzyżowania przez porównywanie liczb
 * zmiennoprzecinkowych, a to zawodzi dokładnie tam, gdzie graf jest
 * najważniejszy.
 */
export function walkableWaysQuery(bbox: BBox, timeout = 60): string {
  return `[out:json][timeout:${timeout}];
way["highway"]
   ["highway"!~"^(motorway|motorway_link|trunk|trunk_link|construction|proposed|raceway)$"]
   ["area"!~"yes"]
   (${bboxString(bbox)});
out body;
>;
out skel qt;`;
}

/**
 * Budynki jako przeszkody dla filtru cząsteczkowego.
 *
 * Ten sam wzorzec recurse-down co przy drogach. Uwzględnione są też węzły
 * z tagiem `building` — w OSM zdarzają się budynki zmapowane jako pojedynczy
 * punkt, a wtedy `way` ich nie złapie.
 *
 * Relacje (multipolygony) pominięte: wymagałyby składania pierścieni,
 * a ich udział w typowej zabudowie jest na tyle mały, że nie zmienia
 * jakości map matchingu.
 */
<<<<<<< HEAD
export function buildingsQuery(bbox: BBox, timeout = 60): string {
  return `[out:json][timeout:${timeout}];
way["building"](${bboxString(bbox)});
out body geom;`;
=======
export function buildingsQuery(bbox: BBox, timeout = 180): string {
  // maxsize podniesiony ponad domyślne 512 MiB: obrysy budynków w gęstej
  // zabudowie to najcięższe z naszych zapytań i domyślny limit potrafi
  // je odrzucić bez czytelnego powodu.
  return `[out:json][timeout:${timeout}][maxsize:1073741824];
(
  node["building"](${bboxString(bbox)});
  way["building"](${bboxString(bbox)});
);
out body;
>;
out skel qt;`;
>>>>>>> 594d9d3 (loks working)
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
