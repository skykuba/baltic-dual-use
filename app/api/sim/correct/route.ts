import { getEngine } from "@/lib/sim/engine";

/**
 * Ręczna korekcja pozycji.
 *
 * Osobny endpoint, a nie wariant `/control`, bo to jest operacja
 * o zupełnie innym znaczeniu: jedyny moment, w którym człowiek wnosi
 * do systemu informację, której nie ma żaden czujnik.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  let body: { lat?: unknown; lon?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  const { lat, lon } = body;
  if (typeof lat !== "number" || typeof lon !== "number") {
    return Response.json(
      { error: "Wymagane pola liczbowe: lat, lon" },
      { status: 400 },
    );
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return Response.json({ error: "Współrzędne poza zakresem" }, { status: 400 });
  }

  const engine = getEngine();
  engine.correct({ lat, lon });
  return Response.json(engine.status);
}
