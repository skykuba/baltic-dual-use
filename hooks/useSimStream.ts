"use client";

import { useEffect, useRef } from "react";
import { loadMapLayer, useSimStore } from "@/lib/store";
import type { SimStatus, SimTick } from "@/lib/types";

/**
 * Podłącza się do strumienia SSE i wlewa ticki do store'u.
 *
 * EventSource sam wznawia zerwane połączenie, więc nie ma tu logiki
 * ponawiania — jest tylko oznaczanie stanu połączenia dla interfejsu.
 */
export function useSimStream(): void {
  useEffect(() => {
    const source = new EventSource("/api/sim/stream");
    const { setConnected, setStatus, pushTick } = useSimStore.getState();

    source.addEventListener("open", () => setConnected(true));

    source.addEventListener("tick", (event) => {
      try {
        pushTick(JSON.parse((event as MessageEvent).data) as SimTick);
        setConnected(true);
      } catch {
        // Uszkodzona ramka nie może zabić strumienia.
      }
    });

    source.addEventListener("status", (event) => {
      try {
        setStatus(JSON.parse((event as MessageEvent).data) as SimStatus);
      } catch {
        /* jw. */
      }
    });

    source.addEventListener("error", () => setConnected(false));

    return () => {
      source.close();
      setConnected(false);
    };
  }, []);
}

/** Odpytuje status silnika — SSE niesie ticki, nie zmiany ustawień. */
export function useSimStatusPolling(intervalMs = 1000): void {
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const response = await fetch("/api/sim/control");
        if (!response.ok || cancelled) return;
        useSimStore.getState().setStatus((await response.json()) as SimStatus);
      } catch {
        /* brak połączenia obsługuje strumień SSE */
      }
    };

    void poll();
    const timer = setInterval(poll, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [intervalMs]);
}


/**
 * Pobiera warstwę mapową automatycznie, gdy jeszcze jej nie ma.
 *
 * Scenariusz zakłada, że dane mapowe ściąga się DOPÓKI jest łączność —
 * a więc zanim ktokolwiek pomyśli o zagłuszaniu. Wymaganie od operatora
 * kliknięcia przycisku odwracało tę kolejność: demo startowało w stanie,
 * w którym mapa jeszcze nie działa, choć nic jej nie przeszkadza.
 *
 * Ręczny przycisk zostaje — do pobrania ponownie po zmianie obszaru.
 */
export function useAutoLoadMap(): void {
  const attempted = useRef(false);
  const status = useSimStore((s) => s.status);

  useEffect(() => {
    if (attempted.current) return;
    if (!status || status.mapLoaded || status.mapLoading) return;

    attempted.current = true;
    void loadMapLayer();
  }, [status]);
}
