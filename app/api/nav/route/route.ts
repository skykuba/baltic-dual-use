import { findRoute } from "@/lib/osm/router";
import { getEngine } from "@/lib/sim/engine";
import { getScenario } from "@/lib/sim/scenario";
import type { LatLon } from "@/lib/geo/types";

/**
 * Wyznaczanie trasy z bieżącej estymowanej pozycji do celu.
 *
 * Punktem startowym jest ESTYMATA, nie prawda — bo tylko ją zna żołnierz
 * w terenie. To ma znaczenie w demo: gdy estymata odpłynie, trasa też
 * będzie liczona od złego miejsca, i to jest uczciwy obraz sytuacji.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteRequest = {
  to?: { lat?: unknown; lon?: unknown };
  /** Zamiast współrzędnych można wskazać identyfikator POI. */
  poiId?: string;
};

export async function POST(request: Request): Promise<Response> {
  const engine = getEngine();
  const bundle = engine.map;

  if (!bundle) {
    return Response.json(
      { error: "Najpierw pobierz warstwę mapową" },
      { status: 409 },
    );
  }

  let body: RouteRequest;
  try {
    body = (await request.json()) as RouteRequest;
  } catch {
    return Response.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const destination = resolveDestination(body, bundle.pois);
  if (!destination) {
    return Response.json(
      { error: "Podaj cel jako { to: { lat, lon } } albo { poiId }" },
      { status: 400 },
    );
  }

  const tick = engine.currentTick;
  const from: LatLon = { lat: tick.estimate.lat, lon: tick.estimate.lon };
  const walkSpeed = getScenario(engine.status.scenarioId).walkSpeed;

  const route = findRoute(bundle.graph, from, destination, { walkSpeed });
  if (!route) {
    return Response.json(
      { error: "Nie znaleziono trasy — cel może leżeć poza siecią dróg" },
      { status: 404 },
    );
  }

  return Response.json({
    route: {
      points: route.points,
      distance: Math.round(route.distance),
      duration: Math.round(route.duration),
      visited: route.visited,
    },
    from,
    to: destination,
  });
}

function resolveDestination(
  body: RouteRequest,
  pois: { id: string; lat: number; lon: number }[],
): LatLon | null {
  if (body.poiId) {
    const poi = pois.find((p) => p.id === body.poiId);
    return poi ? { lat: poi.lat, lon: poi.lon } : null;
  }

  const { lat, lon } = body.to ?? {};
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

  return { lat, lon };
}
