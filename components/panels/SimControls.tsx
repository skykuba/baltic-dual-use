"use client";

import { useState } from "react";
import {
  Crosshair,
  Download,
  Flag,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Satellite,
  SatelliteDish,
} from "lucide-react";
import { SCENARIOS } from "@/lib/sim/scenario";
import {
  loadMapLayer,
  requestRoute,
  sendCommand,
  useSimStore,
} from "@/lib/store";

const TIME_SCALES = [1, 2, 4, 8, 16];

export function SimControls() {
  const status = useSimStore((s) => s.status);
  const clickMode = useSimStore((s) => s.clickMode);
  const setClickMode = useSimStore((s) => s.setClickMode);

  const start = useSimStore((s) => s.start);
  const startMessage = useSimStore((s) => s.startMessage);
  const destination = useSimStore((s) => s.destination);
  const destinationMessage = useSimStore((s) => s.destinationMessage);

  const route = useSimStore((s) => s.route);
  const routeError = useSimStore((s) => s.routeError);
  const routeLoading = useSimStore((s) => s.routeLoading);
  const clearRoute = useSimStore((s) => s.clearRoute);

  const [mapMessage, setMapMessage] = useState<string | null>(null);
  const [loadingMap, setLoadingMap] = useState(false);

  const running = status?.running ?? false;
  const gnss = status?.gnssEnabled ?? true;
  const mapLoaded = status?.mapLoaded ?? false;
  const mapMatching = status?.mapMatchingEnabled ?? true;
  const mapCoversWalker = status?.mapCoversWalker ?? false;

  /** Przełącznik trybu klikania — ponowne naciśnięcie tego samego go wyłącza. */
  const toggle = (mode: "correction" | "start" | "destination") =>
    setClickMode(clickMode === mode ? "none" : mode);

  const handleLoadMap = async () => {
    setLoadingMap(true);
    setMapMessage(null);
    try {
      setMapMessage((await loadMapLayer()).detail);
    } finally {
      setLoadingMap(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <Label>Symulacja</Label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void sendCommand({ type: running ? "pause" : "start" })}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
          >
            {running ? <Pause className="size-4" /> : <Play className="size-4" />}
            {running ? "Pauza" : "Start"}
          </button>
          <button
            type="button"
            onClick={() => void sendCommand({ type: "reset" })}
            className="flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            <RotateCcw className="size-4" />
            Reset
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Sygnał GNSS</Label>
        <button
          type="button"
          onClick={() => void sendCommand({ type: "setGnss", enabled: !gnss })}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-3 text-sm font-semibold transition-colors",
            gnss
              ? "bg-cyan-600 text-white hover:bg-cyan-500"
              : "bg-red-600 text-white hover:bg-red-500",
          ].join(" ")}
        >
          {gnss ? <Satellite className="size-4" /> : <SatelliteDish className="size-4" />}
          {gnss ? "GNSS dostępny — zagłuś" : "ZAGŁUSZONY — przywróć"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          Po zagłuszeniu pozycja liczona jest wyłącznie z czujników inercyjnych.
          W demie ten sam przełącznik odcina łączność, więc obszar operacji
          przestaje się dociągać — zostaje to, co już jest w pamięci urządzenia.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Warstwa mapowa</Label>
        <button
          type="button"
          onClick={() => void handleLoadMap()}
          disabled={loadingMap}
          className="flex items-center justify-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          <Download className={loadingMap ? "size-4 animate-pulse" : "size-4"} />
          {loadingMap
            ? "Wczytywanie…"
            : mapLoaded
              ? "Wczytaj warstwę ponownie"
              : "Wczytaj warstwę mapową"}
        </button>

        {status?.mapStats && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-2 font-mono text-[11px] text-zinc-400">
            <div>{status.mapStats.edges.toLocaleString("pl-PL")} krawędzi grafu</div>
            <div>{status.mapStats.buildings.toLocaleString("pl-PL")} budynków</div>
            <div>{status.mapStats.pois.toLocaleString("pl-PL")} punktów kryzysowych</div>

            <div className="mt-1.5 border-t border-zinc-800 pt-1.5">
              <div className="flex items-baseline justify-between">
                <span>
                  {status.mapStats.progress.ready} / {status.mapStats.progress.total} kafli
                </span>
                <span className="text-zinc-500">
                  obszar {Math.round(status.mapStats.progress.areaMeters / 1000)}×
                  {Math.round(status.mapStats.progress.areaMeters / 1000)} km
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-zinc-800">
                <div
                  className={[
                    "h-full rounded-full transition-[width] duration-500",
                    status.mapStats.progress.pending > 0 ? "bg-cyan-600" : "bg-emerald-600",
                  ].join(" ")}
                  style={{
                    width: `${Math.round((status.mapStats.progress.ready / Math.max(status.mapStats.progress.total, 1)) * 100)}%`,
                  }}
                />
              </div>
              {status.mapStats.progress.pending > 0 && (
                <div className="mt-1 text-zinc-500">
                  {gnss
                    ? `dociąganie w tle — ${status.mapStats.progress.pending} kafli w kolejce`
                    : `bez łączności — ${status.mapStats.progress.pending} kafli czeka`}
                </div>
              )}
            </div>

            <div className="mt-1 border-t border-zinc-800 pt-1">
              <OriginBadge origin={status.mapStats.origin} />
            </div>
          </div>
        )}

        {mapMessage && !status?.mapStats && (
          <p className="text-xs leading-snug text-red-400">{mapMessage}</p>
        )}

        <button
          type="button"
          onClick={() =>
            void sendCommand({ type: "setMapMatching", enabled: !mapMatching })
          }
          disabled={!mapLoaded}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            mapMatching && mapLoaded
              ? "bg-emerald-700 text-white hover:bg-emerald-600"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <MapIcon className="size-4" />
          {mapMatching ? "Map matching włączony" : "Map matching wyłączony"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          Bez mapy estymata dryfuje swobodnie. Z mapą chmura cząstek jest
          ograniczana geometrią ulic i obrysami budynków.
        </p>

      </section>

      <section className="flex flex-col gap-2">
        <Label>Punkt startowy</Label>

        {/*
          Punkt startowy to zmiana PRAWDY, nie estymaty — w odróżnieniu od
          korekcji ręcznej piętro wyżej. Dlatego resetuje symulację: pieszy
          staje w nowym miejscu, estymator i czujniki startują od zera,
          a ślady z poprzedniego miejsca znikają.
        */}
        <button
          type="button"
          onClick={() => toggle("start")}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            clickMode === "start"
              ? "bg-emerald-600 text-white hover:bg-emerald-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <Flag className="size-4" />
          {clickMode === "start"
            ? "Kliknij punkt na mapie…"
            : start
              ? "Zmień punkt startowy"
              : "Wskaż punkt startowy"}
        </button>

        {start && (
          <div className="rounded-md border border-emerald-900/60 bg-emerald-950/25 px-2.5 py-2">
            <div className="font-mono text-[11px] text-emerald-200/90">
              {start.lat.toFixed(5)}, {start.lon.toFixed(5)}
            </div>
            {startMessage && (
              <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                {startMessage}
              </div>
            )}
          </div>
        )}

        {mapLoaded && !mapCoversWalker && (
          <p className="text-xs leading-snug text-amber-400">
            Pobrana warstwa mapowa nie obejmuje tego miejsca — trwa pobieranie
            obszaru operacji. Do tego czasu routing i map matching nie działają.
          </p>
        )}

        <p className="text-xs leading-relaxed text-zinc-500">
          Przenosi żołnierza w nowe miejsce i zaczyna symulację od zera.
          Obszar operacji dociąga się sam, dopóki jest łączność.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Cel marszu</Label>

        {/*
          Dwa kroki, w kolejności: najpierw punkt, potem trasa.

          Wcześniej były to dwa niezależne tryby klikania — jeden zmieniał cel
          symulowanego marszu (bez żadnego znacznika na mapie), drugi od razu
          rysował trasę do miejsca wskazanego osobnym kliknięciem. Operator
          nie miał jak zobaczyć, że pierwszy klik w ogóle zadziałał, a oba
          tryby trzymały własny cel, więc trasa potrafiła prowadzić gdzie
          indziej niż szedł pieszy.
        */}
        <button
          type="button"
          onClick={() => toggle("destination")}
          disabled={!mapLoaded}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            clickMode === "destination"
              ? "bg-amber-600 text-white hover:bg-amber-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <MapPin className="size-4" />
          {clickMode === "destination"
            ? "Kliknij punkt na mapie…"
            : destination
              ? "Zmień miejsce docelowe"
              : "Wyznacz miejsce docelowe"}
        </button>

        {destination && (
          <div className="rounded-md border border-amber-900/60 bg-amber-950/25 px-2.5 py-2">
            <div className="font-mono text-[11px] text-amber-200/90">
              {destination.lat.toFixed(5)}, {destination.lon.toFixed(5)}
            </div>
            {destinationMessage && (
              <div className="mt-0.5 text-[11px] leading-snug text-zinc-500">
                {destinationMessage}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => void requestRoute()}
          disabled={!destination || routeLoading}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            route
              ? "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              : "bg-blue-600 text-white hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500",
          ].join(" ")}
        >
          <Navigation className={routeLoading ? "size-4 animate-pulse" : "size-4"} />
          {routeLoading
            ? "Liczenie trasy…"
            : route
              ? "Przelicz od bieżącej estymaty"
              : "Wyznacz trasę"}
        </button>

        {route && (
          <div className="rounded-md border border-blue-900/60 bg-blue-950/30 px-2.5 py-2">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg text-blue-300">
                {formatDistance(route.distance)}
              </span>
              <span className="text-xs text-blue-500/90">
                ~{formatDuration(route.duration)} marszu
              </span>
            </div>
            <button
              type="button"
              onClick={clearRoute}
              className="mt-1 text-[11px] text-zinc-500 underline-offset-2 hover:underline"
            >
              wyczyść trasę
            </button>
          </div>
        )}

        {routeError && (
          <p className="text-xs leading-snug text-red-400">{routeError}</p>
        )}

        {status?.pathLength === 0 && (
          <p className="text-xs leading-snug text-zinc-500">
            Pieszy stoi w punkcie startowym — wskaż cel, żeby ruszył.
          </p>
        )}

        {status && status.pathLength > 0 && (
          <div className="rounded-md border border-zinc-800 bg-zinc-900/40 px-2.5 py-2">
            <div className="flex items-baseline justify-between font-mono text-[11px] text-zinc-400">
              <span>
                {formatDistance(status.pathProgress)} / {formatDistance(status.pathLength)}
              </span>
              <span>
                {Math.round((status.pathProgress / Math.max(status.pathLength, 1)) * 100)}%
              </span>
            </div>
            <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full bg-zinc-500 transition-[width] duration-300"
                style={{
                  width: `${Math.min(100, (status.pathProgress / Math.max(status.pathLength, 1)) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        <p className="text-xs leading-relaxed text-zinc-500">
          Pieszy idzie do celu trasą A* po rzeczywistych ulicach z OSM. Trasa
          nawigacyjna liczona jest osobno, od pozycji <strong>estymowanej</strong>{" "}
          — bo tylko tę zna żołnierz w terenie. Im większy dryf, tym wyraźniej
          obie się rozjeżdżają.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Korekcja ręczna</Label>
        {/*
          Przy dostępnym GNSS korekcja jest bezcelowa: kolejny fix przychodzi
          w ciągu sekundy i nadpisuje wskazany punkt. Z zewnątrz wygląda to
          jak przycisk, który nie działa — bo estymata wraca na swoje miejsce
          szybciej, niż zdąży się to zobaczyć. Blokada mówi wprost dlaczego,
          zamiast pozwalać na akcję bez widocznego skutku.
        */}
        <button
          type="button"
          onClick={() => toggle("correction")}
          disabled={gnss}
          className={[
            "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40",
            clickMode === "correction"
              ? "bg-violet-600 text-white hover:bg-violet-500"
              : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800",
          ].join(" ")}
        >
          <Crosshair className="size-4" />
          {clickMode === "correction" ? "Wskaż punkt na mapie…" : "Skoryguj pozycję"}
        </button>
        <p className="text-xs leading-relaxed text-zinc-500">
          {gnss
            ? "Dostępny jest sygnał GNSS — korekcja ręczna nie miałaby żadnego skutku, bo kolejny fix nadpisze wskazany punkt. Najpierw zagłusz sygnał."
            : "Żołnierz rozpoznaje skrzyżowanie lub budynek i wskazuje, gdzie naprawdę jest. Estymacja biegnie dalej od tego punktu, a kurs i długość kroku są przy okazji rekalibrowane."}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Tempo symulacji</Label>
        <div className="flex gap-1">
          {TIME_SCALES.map((scale) => (
            <button
              key={scale}
              type="button"
              onClick={() => void sendCommand({ type: "setTimeScale", scale })}
              className={[
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                status?.timeScale === scale
                  ? "bg-zinc-200 text-zinc-900"
                  : "border border-zinc-700 text-zinc-400 hover:bg-zinc-800",
              ].join(" ")}
            >
              {scale}×
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <Label>Scenariusz</Label>
        <div className="flex flex-col gap-1.5">
          {SCENARIOS.map((scenario) => {
            const active = status?.scenarioId === scenario.id;
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => void sendCommand({ type: "setScenario", id: scenario.id })}
                className={[
                  "rounded-md border px-3 py-2 text-left transition-colors",
                  active
                    ? "border-emerald-600 bg-emerald-950/40"
                    : "border-zinc-800 hover:bg-zinc-800/60",
                ].join(" ")}
              >
                <div className="text-sm font-medium text-zinc-200">{scenario.name}</div>
                <div className="mt-0.5 text-xs leading-snug text-zinc-500">
                  {scenario.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/**
 * Skąd przyszły dane mapowe.
 *
 * Istotne przed demem: jeśli warstwa przyszła z publicznej instancji,
 * to znaczy że lokalny Overpass nie działa i całe twierdzenie „stack
 * działa offline" jest w tym uruchomieniu nieprawdziwe. Lepiej zobaczyć
 * to na panelu niż usłyszeć pytanie od jury.
 */
function OriginBadge({ origin }: { origin: "cache" | "local" | "fallback" }) {
  const label = {
    cache: "z cache'u na dysku — offline",
    local: "z instancji Overpass",
    fallback: "z instancji zapasowej",
  }[origin];

  return (
    <span className={origin === "cache" ? "text-emerald-400" : "text-zinc-400"}>
      {label}
    </span>
  );
}

function formatDistance(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(2).replace(".", ",")} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
      {children}
    </h3>
  );
}
