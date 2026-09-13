import { getEngine } from "@/lib/sim/engine";
import type { SimCommand } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const engine = getEngine();

  let command: SimCommand;
  try {
    command = (await request.json()) as SimCommand;
  } catch {
    return Response.json({ error: "Nieprawidłowy JSON" }, { status: 400 });
  }

  switch (command.type) {
    case "start":
      engine.start();
      break;
    case "pause":
      engine.pause();
      break;
    case "reset":
      engine.reset();
      break;
    case "setGnss":
      engine.setGnss(Boolean(command.enabled));
      break;
    case "setTimeScale":
      if (!Number.isFinite(command.scale)) {
        return Response.json({ error: "scale musi być liczbą" }, { status: 400 });
      }
      engine.setTimeScale(command.scale);
      break;
    case "setScenario":
      engine.setScenario(String(command.id));
      break;
    case "setMapMatching":
      engine.setMapMatching(Boolean(command.enabled));
      break;
    case "setStart": {
      if (!Number.isFinite(command.lat) || !Number.isFinite(command.lon)) {
        return Response.json(
          { error: "lat i lon muszą być liczbami" },
          { status: 400 },
        );
      }
      const result = engine.setStart({ lat: command.lat, lon: command.lon });
      return Response.json({ ...engine.status, startSet: result });
    }
    case "setDestination": {
      if (!Number.isFinite(command.lat) || !Number.isFinite(command.lon)) {
        return Response.json(
          { error: "lat i lon muszą być liczbami" },
          { status: 400 },
        );
      }
      const result = engine.setDestination({
        lat: command.lat,
        lon: command.lon,
      });
      return Response.json({ ...engine.status, destinationSet: result });
    }
    case "loadMap": {
      // Pobranie z Overpassa trwa sekundy, więc odpowiadamy dopiero po nim —
      // interfejs pokazuje w tym czasie stan „pobieranie".
      const result = await engine.loadMap();
      return Response.json({ ...engine.status, mapLoad: result });
    }
    case "correct":
      if (!Number.isFinite(command.lat) || !Number.isFinite(command.lon)) {
        return Response.json(
          { error: "lat i lon muszą być liczbami" },
          { status: 400 },
        );
      }
      engine.correct({ lat: command.lat, lon: command.lon });
      break;
    default:
      return Response.json({ error: "Nieznane polecenie" }, { status: 400 });
  }

  return Response.json(engine.status);
}

export async function GET(): Promise<Response> {
  return Response.json(getEngine().status);
}
