import { getEngine } from "@/lib/sim/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Punkty istotne kryzysowo z już pobranej warstwy mapowej.
 *
 * Czyta z pamięci, nie z Overpassa — dane pobiera się raz, przez
 * `loadMap`, dopóki jest łączność. Ten endpoint ma działać także wtedy,
 * gdy łączności już nie ma.
 */
export async function GET(request: Request): Promise<Response> {
  const engine = getEngine();
  const bundle = engine.map;

  if (!bundle) {
    return Response.json(
      { error: "Warstwa mapowa nie została jeszcze pobrana", pois: [] },
      { status: 409 },
    );
  }

  const url = new URL(request.url);
  const maxPriority = Number(url.searchParams.get("priority") ?? "3");

  const pois = bundle.pois.filter((poi) => poi.priority <= maxPriority);
  return Response.json({ pois, count: pois.length });
}
