"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FALLBACK_VESSELS, fetchVessels } from "@/lib/data";
import GlobeView from "./GlobeView";
import FilterPanel from "./FilterPanel";
import VesselCard from "./VesselCard";
import ThemeToggle from "./ThemeToggle";
import AnalyticsDashboard from "./analytics/AnalyticsDashboard";
import { useTheme } from "./ThemeProvider";
import { TECH_ORDER, techColor } from "@/lib/theme";
import { speedColor, SPEED_MAX } from "@/lib/wind";
import { useIsMobile, useHasHover } from "@/lib/useMediaQuery";

const WIND_GRADIENT = `linear-gradient(90deg, ${[0, 4, 8, 11, 15, 20]
  .map((s) => {
    const [r, g, b] = speedColor(s);
    return `rgb(${r},${g},${b}) ${(s / SPEED_MAX) * 100}%`;
  })
  .join(", ")})`;

function WindToggle({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
        on
          ? "border-accent bg-accent/15 text-fg"
          : "border-edge/60 text-muted hover:text-fg"
      }`}
    >
      <span>{label}</span>
      <span
        className={`relative h-4 w-7 rounded-full transition ${
          on ? "bg-accent" : "bg-edge"
        }`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${
            on ? "left-3.5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export default function FleetExplorer() {
  const { theme } = useTheme();
  const isMobile = useIsMobile();
  const hasHover = useHasHover();
  // On phones the filter/wind column is a slide-up sheet rather than a
  // permanently-floating panel.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({
    techs: new Set(),
    types: new Set(),
    installTypes: new Set(),
  });
  const [vessels, setVessels] = useState(FALLBACK_VESSELS);
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  // "closed" | "quarter" | "full"
  const [analyticsMode, setAnalyticsMode] = useState("closed");
  const [analyticsHl, setAnalyticsHl] = useState(null);
  const [windColor, setWindColor] = useState(false);
  const [windBarbs, setWindBarbs] = useState(false);
  const [windMeta, setWindMeta] = useState(null);

  const analyticsOpen = analyticsMode !== "closed";
  const closeAnalytics = () => {
    setAnalyticsMode("closed");
    setAnalyticsHl(null);
  };

  // Load the live fleet from Supabase once on mount; keep the bundled snapshot
  // if Supabase isn't configured or is unreachable.
  useEffect(() => {
    let active = true;
    fetchVessels().then((live) => {
      if (active && live) setVessels(live);
    });
    return () => {
      active = false;
    };
  }, []);

  // Filter options derived from whatever fleet is loaded.
  const TECHS = useMemo(
    () => TECH_ORDER.filter((t) => vessels.some((v) => v.technology === t)),
    [vessels]
  );
  const TYPES = useMemo(
    () => [...new Set(vessels.map((v) => v.type).filter(Boolean))].sort(),
    [vessels]
  );
  const INSTALL_TYPES = useMemo(
    () => [...new Set(vessels.map((v) => v.installType).filter(Boolean))].sort(),
    [vessels]
  );

  const windInfo = windMeta
    ? (windMeta.source || "").toLowerCase().includes("era5")
      ? `${windMeta.source}. Grid ${windMeta.nlat}×${windMeta.nlon} (2.5°). Colour = mean wind speed (m/s); arrows = prevailing direction.`
      : "Modelled placeholder wind — run scripts/fetch_era5_wind.py for the real ERA5 field. Colour = speed, arrows = direction."
    : "Loading wind data…";

  // Hover handler: store the vessel and the cursor position so the preview
  // card can sit next to the pointer. Memoized so GlobeView (which is memo'd)
  // doesn't re-render — and rebuild every marker — on each pointer move.
  const handleHover = useCallback((v, e) => {
    setHovered(v);
    if (v && e) setPointer({ x: e.clientX, y: e.clientY });
  }, []);

  // While hovering, follow the cursor — and clear the preview as soon as the
  // pointer is no longer over a vessel marker (relying on the dot's mouseleave
  // alone is unreliable while the globe rotates).
  useEffect(() => {
    if (!hovered) return;
    const move = (e) => {
      if (e.target && e.target.closest && e.target.closest(".vessel-marker")) {
        setPointer({ x: e.clientX, y: e.clientY });
      } else {
        setHovered(null);
      }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, [hovered]);

  // On phones, opening a vessel card or the analytics panel should tuck the
  // filter sheet away so it isn't stacked behind them.
  useEffect(() => {
    if (selected || analyticsOpen) setFiltersOpen(false);
  }, [selected, analyticsOpen]);

  const activeFilterCount =
    filters.techs.size + filters.types.size + filters.installTypes.size;

  const filtered = useMemo(() => {
    return vessels.filter((v) => {
      if (filters.techs.size && !filters.techs.has(v.technology)) return false;
      if (filters.types.size && !filters.types.has(v.type)) return false;
      if (filters.installTypes.size && !filters.installTypes.has(v.installType))
        return false;
      return true;
    });
  }, [vessels, filters]);

  // When a technology is highlighted in the analytics charts, narrow the globe
  // to just those vessels so the related dots stand out.
  const globeVessels = useMemo(() => {
    if (analyticsHl && TECHS.includes(analyticsHl)) {
      return filtered.filter((v) => v.technology === analyticsHl);
    }
    return filtered;
  }, [filtered, analyticsHl]);

  // Fleet sea-routes are precomputed offline (scripts/build_routes.py →
  // public/routes.json) with the searoute engine, so the whole-fleet overlay
  // AND each vessel's click route load instantly from one static file — no live
  // /api/searoute calls, nothing to restart. Each entry is
  //   { id, travelled: [[lat,lng],...]|null, planned: [[lat,lng],...]|null }
  // travelled = last port → current position, planned = current → destination.
  const [allRoutes, setAllRoutes] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/routes.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (!cancelled) setAllRoutes(Array.isArray(list) ? list : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  // Faint whole-fleet overlay: the travelled leg of every shown vessel, coloured
  // by technology. Filtered to the vessels currently visible so the tech/type
  // filters dim their routes too. Colour at full strength here; opacity/glow is
  // controlled in the map layer.
  const fleetRoutes = useMemo(() => {
    const byId = new Map(globeVessels.map((v) => [v.id, v]));
    return allRoutes
      .filter((r) => byId.has(r.id) && r.travelled)
      .map((r) => ({
        coords: r.travelled,
        color: techColor(byId.get(r.id).technology),
        fleet: true,
      }));
  }, [allRoutes, globeVessels]);

  const counts = useMemo(() => {
    const tech = {};
    filtered.forEach((v) => {
      tech[v.technology] = (tech[v.technology] || 0) + 1;
    });
    return { tech };
  }, [filtered]);

  // Full voyage for the selected vessel — looked up instantly from the same
  // precomputed routes.json (no fetch, no pathfinding). Two legs:
  //   travelled  last port → current position  (solid)
  //   planned    current position → destination (dashed, animated in GlobeView)
  // Either leg may be null (vessel in port, no destination, or no sea route);
  // we simply draw whichever exists.
  const routePaths = useMemo(() => {
    if (!selected) return [];
    const entry = allRoutes.find((r) => r.id === selected.id);
    if (!entry) return [];
    const color = techColor(selected.technology);
    const paths = [];
    if (entry.travelled)
      paths.push({ coords: entry.travelled, color, planned: false });
    if (entry.planned)
      paths.push({ coords: entry.planned, color, planned: true });
    return paths;
  }, [selected, allRoutes]);

  // Faint fleet routes underneath; the selected vessel's brighter, detailed
  // route (with its destination leg) drawn on top.
  const allPaths = useMemo(
    () => [...fleetRoutes, ...routePaths],
    [fleetRoutes, routePaths]
  );

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            theme === "dark"
              ? "radial-gradient(circle at 50% 45%, rgba(255,255,255,0.05), transparent 62%)"
              : "radial-gradient(circle at 50% 45%, rgba(31,134,196,0.07), transparent 62%)",
        }}
      />

      {/* Globe lives at z-0 so its dots stay below the UI panels. In quarter
          mode it shrinks to the left so the analytics panel sits beside it. */}
      <div
        className={`absolute inset-y-0 left-0 z-0 transition-[right] duration-500 ease-in-out ${
          analyticsMode === "quarter" ? "right-0 md:right-1/4" : "right-0"
        }`}
      >
        <GlobeView
          vessels={globeVessels}
          paths={allPaths}
          selected={selected}
          onSelect={setSelected}
          onHover={handleHover}
          theme={theme}
          showWindColor={windColor}
          showWindBarbs={windBarbs}
          onWindMeta={setWindMeta}
        />
      </div>

      {/* Header */}
      <header className="pointer-events-none absolute left-0 top-0 z-10 flex w-full items-start justify-between p-4 sm:p-6">
        <div className="pointer-events-auto">
          <h1 className="font-mono text-xl font-medium lowercase tracking-tight text-fg">
            wind<span className="text-muted">fleet</span>
          </h1>
          <p className="mt-1 text-xs text-muted">
            Global wind-assisted propulsion · market intel
          </p>
        </div>
        <div className="pointer-events-auto flex items-center gap-3">
          <ThemeToggle />
          <div className="rounded-xl border border-edge/60 bg-panel/70 px-4 py-2 text-right backdrop-blur-md">
            <div className="font-mono text-2xl font-semibold leading-none tabular-nums text-fg">
              {String(filtered.length).padStart(2, "0")}
            </div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted">
              vessels
            </div>
          </div>
        </div>
      </header>

      {/* Backdrop behind the mobile filter sheet — tap to dismiss. */}
      {isMobile && filtersOpen && (
        <button
          aria-label="Close filters"
          onClick={() => setFiltersOpen(false)}
          className="fixed inset-0 z-20 bg-ink/50 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Left column: filters + wind layer. A floating column on desktop; a
          slide-up sheet on phones (toggled by the Filters button). Hidden while
          the analytics panel is open. */}
      <div
        className={`z-30 flex flex-col gap-3 transition-all duration-300 ${
          isMobile
            ? `scroll-thin fixed inset-x-3 bottom-3 max-h-[78vh] overflow-y-auto ${
                filtersOpen && !analyticsOpen
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-[115%] opacity-0"
              }`
            : `pointer-events-none absolute bottom-6 left-6 top-24 ${
                analyticsOpen ? "opacity-0" : "opacity-100"
              }`
        }`}
        aria-hidden={isMobile ? !filtersOpen : analyticsOpen}
      >
        {isMobile && (
          <div className="pointer-events-auto flex items-center justify-between px-1.5 pt-0.5">
            <span className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Filters &amp; layers
            </span>
            <button
              onClick={() => setFiltersOpen(false)}
              className="text-muted hover:text-fg"
              aria-label="Close filters"
            >
              ✕
            </button>
          </div>
        )}
        <FilterPanel
          techs={TECHS}
          types={TYPES}
          installTypes={INSTALL_TYPES}
          filters={filters}
          setFilters={setFilters}
          counts={counts}
        />

        {/* Wind layer (compact, under the filters) */}
        <div className="pointer-events-auto shrink-0 w-full rounded-2xl border border-edge/60 bg-panel/80 p-3 backdrop-blur-md md:w-72">
          <div className="mb-2 flex items-center gap-1.5">
            <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted">
              Wind layer
            </h2>
            <div className="group relative flex items-center">
              <button
                aria-label="About the wind data"
                className="flex h-4 w-4 items-center justify-center rounded-full border border-edge/70 text-[9px] font-semibold text-muted transition hover:border-accent hover:text-fg"
              >
                i
              </button>
              <div className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-60 rounded-lg border border-edge bg-ink/95 p-3 text-[11px] leading-relaxed text-muted opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-150 group-hover:opacity-100">
                {windInfo}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <WindToggle label="Wind speed" on={windColor} onClick={() => setWindColor((v) => !v)} />
            <WindToggle label="Wind direction" on={windBarbs} onClick={() => setWindBarbs((v) => !v)} />
          </div>
          {windColor && (
            <div className="mt-2.5">
              <div className="h-2 w-full rounded-full" style={{ background: WIND_GRADIENT }} />
              <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
                <span>0</span>
                <span>mean m/s</span>
                <span>{SPEED_MAX}+</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Vessel card — sits on the right normally, slides to the left when the
          analytics panel is open so both stay visible. */}
      <div
        className={`transition-all duration-500 ease-in-out ${
          isMobile
            ? "fixed inset-x-3 bottom-3 z-40"
            : `absolute top-24 z-20 ${analyticsOpen ? "left-6" : "right-6"}`
        }`}
      >
        <VesselCard vessel={selected} onClose={() => setSelected(null)} />
      </div>

      {/* Hover preview — follows the pointer (pointer devices only; phones use
          tap-to-open the full card instead) */}
      {hasHover && hovered && !selected && (
        <div
          className="pointer-events-none fixed z-30 w-60 rounded-xl border border-edge/60 bg-panel/95 p-3 shadow-xl backdrop-blur-md"
          style={{
            left:
              typeof window !== "undefined" && pointer.x > window.innerWidth - 260
                ? pointer.x - 252
                : pointer.x + 16,
            top:
              typeof window !== "undefined" && pointer.y > window.innerHeight - 140
                ? pointer.y - 130
                : pointer.y + 16,
          }}
        >
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: techColor(hovered.technology), boxShadow: `0 0 8px ${techColor(hovered.technology)}` }}
            />
            <h3 className="text-sm font-semibold leading-tight text-fg">{hovered.name}</h3>
          </div>
          <p className="mt-1 text-[11px] text-muted">
            {hovered.technology} · {hovered.type}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {hovered.speed != null && (
              <span className="font-mono tabular-nums text-fg/80">{hovered.speed} kn</span>
            )}
            {hovered.destination && <span>→ {hovered.destination}</span>}
            {hovered.shipowner && hovered.shipowner !== "None" && (
              <span>{hovered.shipowner}</span>
            )}
          </div>
          <p className="mt-2 text-[10px] uppercase tracking-widest text-muted/60">
            Click for full details
          </p>
        </div>
      )}

      {/* Footer — data attributions + feedback link. Slim and low-opacity so it
          sits under the globe without competing with the UI. */}
      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 -translate-x-1/2 px-4 text-center">
        <p className="text-[10px] leading-relaxed text-muted/60">
          Routes © Eurostat SeaRoute · Land: Natural Earth
          {" · "}
          <a
            href="https://www.linkedin.com/in/thomas-steip/"
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto underline decoration-dotted underline-offset-2 transition hover:text-fg"
          >
            Feedback &amp; corrections welcome
          </a>
        </p>
      </div>

      {/* Mobile-only Filters button — opens the slide-up sheet. */}
      {isMobile && !filtersOpen && !analyticsOpen && !selected && (
        <button
          onClick={() => setFiltersOpen(true)}
          aria-label="Open filters and layers"
          className="pointer-events-auto fixed bottom-4 left-4 z-30 flex items-center gap-2 rounded-full border border-edge/60 bg-panel/90 px-4 py-2.5 text-xs font-medium text-fg shadow-xl backdrop-blur-md"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] font-semibold text-ink">
              {activeFilterCount}
            </span>
          )}
        </button>
      )}

      {/* Right-edge handle to open analytics */}
      {!analyticsOpen && (
        <button
          onClick={() => setAnalyticsMode("quarter")}
          aria-label="Open fleet analytics"
          className="group absolute right-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-2 rounded-l-xl border border-r-0 border-edge/60 bg-panel/80 py-5 pl-3 pr-2 backdrop-blur-md transition hover:bg-panel"
        >
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted [writing-mode:vertical-rl] rotate-180 transition group-hover:text-fg">
            Analytics
          </span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted transition group-hover:text-accent">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      {/* Analytics panel — quarter-width beside the globe, or full screen */}
      <div
        className={`absolute inset-y-0 right-0 z-40 bg-ink/95 backdrop-blur-md transition-all duration-500 ease-in-out ${
          analyticsMode === "full"
            ? "left-0 border-l-0"
            : "left-0 border-l-0 md:left-auto md:w-1/4 md:min-w-[360px] md:border-l md:border-edge/60"
        } ${analyticsOpen ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!analyticsOpen}
      >
        {analyticsOpen && (
          <AnalyticsDashboard
            compact={analyticsMode === "quarter"}
            onClose={closeAnalytics}
            onExpand={() => setAnalyticsMode("full")}
            onCollapse={() => setAnalyticsMode("quarter")}
            onHighlight={setAnalyticsHl}
          />
        )}
      </div>
    </main>
  );
}
