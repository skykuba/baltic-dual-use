import { getEngine } from "@/lib/sim/engine";

/**
 * Strumień Server-Sent Events z danymi symulacji.
 *
 * SSE, nie WebSocket: przepływ jest jednokierunkowy (serwer → klient),
 * a sterowanie idzie zwykłym POST-em. SSE ma wbudowane wznawianie
 * połączenia i działa przez każde proxy, które przepuszcza HTTP.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const engine = getEngine();
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          cleanup();
        }
      };

      send("status", engine.status);
      unsubscribe = engine.subscribe((tick) => send("tick", tick));

      // Komentarz SSE co 15 s — utrzymuje połączenie przy życiu,
      // gdy symulacja jest zapauzowana.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          cleanup();
        }
      }, 15_000);

      const cleanup = () => {
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
      };

      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // strumień mógł już zostać zamknięty przez klienta
        }
      });
    },

    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Wyłącza buforowanie w nginx — bez tego strumień dociera skokowo.
      "X-Accel-Buffering": "no",
    },
  });
}
