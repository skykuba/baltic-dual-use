/**
 * Kategorie punktów istotnych w sytuacji kryzysowej i ich priorytety.
 *
 * Priorytet steruje trzema rzeczami naraz: kolejnością pobierania kafli
 * (gdy pasmo jest ograniczone, P1 pobieramy zawsze), wagą w rankingu
 * „najbliższy użyteczny punkt" oraz domyślną widocznością warstwy.
 */

export type PoiPriority = 1 | 2 | 3;

export type PoiCategory = {
  id: string;
  label: string;
  priority: PoiPriority;
  /** Filtry Overpass QL, np. '["amenity"="hospital"]'. */
  filters: string[];
  icon: string;
};

export const POI_CATEGORIES: PoiCategory[] = [
  // ── P1: ratuje życie ────────────────────────────────────────────────
  {
    id: "medical",
    label: "Opieka medyczna",
    priority: 1,
    filters: [
      '["amenity"="hospital"]',
      '["amenity"="clinic"]',
      '["amenity"="doctors"]',
      '["amenity"="pharmacy"]',
    ],
    icon: "cross",
  },
  {
    id: "shelter",
    label: "Schronienie",
    priority: 1,
    filters: ['["amenity"="shelter"]', '["emergency"="assembly_point"]'],
    icon: "home",
  },
  {
    id: "water",
    label: "Woda pitna",
    priority: 1,
    filters: [
      '["amenity"="drinking_water"]',
      '["man_made"="water_well"]',
      '["emergency"="water_tank"]',
    ],
    icon: "droplet",
  },
  {
    id: "services",
    label: "Służby",
    priority: 1,
    filters: ['["amenity"="fire_station"]', '["amenity"="police"]'],
    icon: "shield",
  },

  // ── P2: infrastruktura i mobilność ──────────────────────────────────
  {
    id: "fuel",
    label: "Paliwo i energia",
    priority: 2,
    filters: [
      '["amenity"="fuel"]',
      '["power"="substation"]',
      '["power"="generator"]',
    ],
    icon: "zap",
  },
  {
    id: "transport",
    label: "Transport",
    priority: 2,
    filters: [
      '["railway"="station"]',
      '["aeroway"="helipad"]',
      '["aeroway"="aerodrome"]',
    ],
    icon: "train",
  },
  {
    id: "crossing",
    label: "Przeprawy",
    priority: 2,
    filters: ['["bridge"="yes"]', '["ford"="yes"]'],
    icon: "git-commit",
  },

  // ── P3: orientacja w terenie ────────────────────────────────────────
  {
    id: "landmark",
    label: "Punkty orientacyjne",
    priority: 3,
    filters: [
      '["man_made"="tower"]',
      '["man_made"="water_tower"]',
      '["man_made"="mast"]',
    ],
    icon: "radio-tower",
  },
];

export function categoriesByPriority(maxPriority: PoiPriority): PoiCategory[] {
  return POI_CATEGORIES.filter((c) => c.priority <= maxPriority);
}

export function findCategory(id: string): PoiCategory | undefined {
  return POI_CATEGORIES.find((c) => c.id === id);
}

export type Poi = {
  id: string;
  lat: number;
  lon: number;
  categoryId: string;
  priority: PoiPriority;
  name?: string;
  tags: Record<string, string>;
};
