import { checkOverpassHealth } from "@/lib/osm/overpass";
import { getEngine } from "@/lib/sim/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Stan warstwy mapowej: czy Overpass żyje i co udało się pobrać. */
export async function GET(): Promise<Response> {
  const [health, engine] = [await checkOverpassHealth(), getEngine()];

  return Response.json({
    overpass: health,
    map: engine.map
      ? { bbox: engine.map.bbox, stats: engine.map.stats }
      : null,
  });
}
