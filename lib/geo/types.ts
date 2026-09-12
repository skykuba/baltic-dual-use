/** Punkt geograficzny WGS84. */
export type LatLon = {
  lat: number;
  lon: number;
};

/** Przemieszczenie w lokalnym układzie ENU (East-North-Up), w metrach. */
export type Enu = {
  e: number;
  n: number;
};

/** Wektor 3D — używany dla wszystkich odczytów IMU. */
export type Vec3 = [number, number, number];

/** Rodzaj terenu — wpływa na szum GNSS i zaburzenia magnetometru. */
export type TerrainKind = "urban" | "forest" | "open";

/** Skąd pochodzi bieżąca najlepsza znana pozycja. */
export type PositionSource = "gnss" | "pdr" | "pdr+map" | "manual";
