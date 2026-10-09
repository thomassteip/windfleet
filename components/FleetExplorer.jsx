"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FALLBACK_VESSELS, fetchVessels } from "@/lib/data";
import GlobeView from "./GlobeView";
import FilterPanel from "./FilterPanel";
import VesselCard from "./VesselCard";
import ThemeToggle from "./ThemeToggle";
import VesselSearch from "./VesselSearch";
import InfoButton from "./InfoButton";
import AnalyticsDashboard from "./analytics/AnalyticsDashboard";
import MakerPanel from "./MakerPanel";
import { useTheme } from "./ThemeProvider";
import { TECH_ORDER, techColor } from "@/lib/theme";
import { shipBucket, buildAnalytics, hasMaker, makerSlug } from "@/lib/analytics";
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

// Two-way segmented control: live GFS analysis vs. the ERA5 climatology.
function WindVariantSwitch({ value, onChange }) {
  return (
    <div className="mb-2 flex gap-1 rounded-lg border border-edge/60 bg-ink/20 p-0.5 text-[11px]">
      {[
        ["live", "Live"],
        ["average", "Average"],
      ].map(([val, label]) => (
        <button
          key={val}
          onClick={() => onChange(val)}
          className={`flex-1 rounded-md px-2 py-1 transition ${
            value === val
              ? "bg-accent/20 text-fg"
              : "text-muted hover:text-fg"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Side rail: the app's sections as a fixed strip down the right edge, each
// opening its panel just to the rail's left. Built to grow: Forecast and
// Performance are planned and shown here greyed out ("soon"). Theme and
// sources live at the bottom of the rail. On phones the same items become a
// bottom tab bar.
// The rail is 72px wide: the w-[72px] / right-[72px] / 72px values below all
// refer to it, so change them together.
const SECTIONS = [
  {
    key: "analytics",
    label: "Analytics",
    icon: <path d="M3 3v18h18M7.5 16v-3M12 16V8M16.5 16v-6" />,
  },
  {
    key: "makers",
    label: "Makers",
    // a factory outline: the companies that build the wind systems
    icon: <path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17zM3 21h18" />,
  },
  {
    key: "forecast",
    label: "Forecast",
    soon: true,
    icon: <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />,
  },
  {
    key: "performance",
    label: "Performance",
    soon: true,
    // a gauge
    icon: <path d="M4.5 18a8.5 8.5 0 1 1 15 0M12 14l4-4.5" />,
  },
];

function SectionButton({ s, on, onToggle, compact }) {
  return (
    <button
      onClick={() => !s.soon && onToggle(s.key)}
      disabled={s.soon}
      aria-pressed={s.soon ? undefined : on}
      title={s.soon ? `${s.label}: coming soon` : on ? `Close ${s.label.toLowerCase()}` : s.label}
      className={`flex flex-col items-center justify-center gap-1 rounded-xl border transition ${
        compact ? "h-12 flex-1" : "h-14 w-14"
      } ${
        s.soon
          ? "cursor-default border-transparent text-muted/40"
          : on
          ? "border-accent/70 bg-accent/15 text-fg"
          : "border-transparent text-muted hover:bg-edge/40 hover:text-fg"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {s.icon}
      </svg>
      <span className="text-[10px] leading-none">{s.label}</span>
    </button>
  );
}

function SideRail({ open, onToggle }) {
  return (
    <aside
      aria-label="Sections"
      className="absolute bottom-0 right-0 top-0 z-[46] hidden w-[72px] flex-col items-center gap-1.5 border-l border-edge/60 bg-panel/70 py-6 backdrop-blur-md md:flex"
    >
      {SECTIONS.map((s) => (
        <SectionButton key={s.key} s={s} on={open === s.key} onToggle={onToggle} />
      ))}
      <div className="mt-auto flex flex-col items-center gap-3">
        <ThemeToggle />
        <InfoButton className="relative" popClass="absolute bottom-0 right-full mr-3" />
      </div>
    </aside>
  );
}

function MobileTabBar({ open, onToggle }) {
  return (
    <nav
      aria-label="Sections"
      className="fixed inset-x-0 bottom-0 z-[46] flex gap-1 border-t border-edge/60 bg-panel/90 px-2 pb-2 pt-1.5 backdrop-blur-md md:hidden"
    >
      {SECTIONS.map((s) => (
        <SectionButton key={s.key} s={s} on={open === s.key} onToggle={onToggle} compact />
      ))}
    </nav>
  );
}

// "/makers" -> "index", "/makers/norsepower" -> "norsepower", else null.
function makerFromPath(path) {
  const m = path.match(/^\/makers(?:\/([^/]+))?\/?$/);
  return m ? m[1] || "index" : null;
}

// initialMaker: set by the /makers routes, so the explorer opens with the
// maker panel already showing ("index" for the list, or a maker's slug).
export default function FleetExplorer({ initialMaker = null }) {
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
  const [windVariant, setWindVariant] = useState("average"); // "live" | "average"
  const [windMeta, setWindMeta] = useState(null);

  // Maker panel: null (closed), "index", or a maker slug. It lives in this
  // component's state rather than in a separate page, so moving between makers
  // never reloads the globe; the address bar is kept in step by hand so every
  // maker view is still a shareable /makers/<slug> link.
  const [maker, setMaker] = useState(initialMaker);
  const makerOpen = maker != null;

  const analyticsOpen = analyticsMode !== "closed";
  // Either right-hand panel (analytics or maker) takes the same slot.
  const panelOpen = analyticsOpen || makerOpen;
  const closeAnalytics = () => {
    setAnalyticsMode("closed");
    setAnalyticsHl(null);
  };

  const openMaker = useCallback((slug) => {
    setMaker(slug);
    setAnalyticsMode("closed");
    setAnalyticsHl(null);
    const path = slug == null ? "/" : slug === "index" ? "/makers" : `/makers/${slug}`;
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
  }, []);

  const openAnalytics = () => {
    if (makerOpen) openMaker(null);
    setAnalyticsMode((m) => (m === "closed" ? "quarter" : m));
  };

  // Which panel is showing, for the toolbar buttons. Clicking a button opens
  // its panel; clicking it again closes it (as do the panel's ✕ and Esc).
  const openPanel = makerOpen ? "makers" : analyticsOpen ? "analytics" : null;
  const closePanels = () => {
    if (makerOpen) openMaker(null);
    closeAnalytics();
  };
  const togglePanel = (key) => {
    if (openPanel === key) closePanels();
    else if (key === "analytics") openAnalytics();
    else openMaker("index");
  };
  const closePanelsRef = useRef(closePanels);
  closePanelsRef.current = closePanels;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      closePanelsRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Panels start just below the header, so the tabs (and theme toggle and
  // vessel count) are never covered. The header's height changes with the
  // screen size, so measure it rather than hard-coding a number.
  // Desktop side panels run the full window height beside the rail, and the
  // header (wordmark + search) shrinks to the globe that's left, so the search
  // stays centred over the map instead of running into the panel. Full-width
  // analytics and phone panels still open below the header.
  const sidePanel = !isMobile && panelOpen && analyticsMode !== "full";
  const headerRight = isMobile ? 0 : sidePanel ? "calc(72px + max(25%, 360px))" : 72;
  const headerRef = useRef(null);
  const [panelTop, setPanelTop] = useState(80);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setPanelTop(Math.round(el.getBoundingClientRect().bottom) + 12));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Back/forward between maker views.
  useEffect(() => {
    const onPop = () => setMaker(makerFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

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
    ? windVariant === "average"
      ? `${windMeta.source}. Grid ${windMeta.nlat}×${windMeta.nlon} (2.5°). Colour = mean wind speed (m/s); arrows = prevailing direction.`
      : `${windMeta.source}. Grid ${windMeta.nlat}×${windMeta.nlon} (1.5°), refreshed twice daily. Colour = wind speed (m/s); arrows = direction.`
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
    if (selected || panelOpen) setFiltersOpen(false);
  }, [selected, panelOpen]);

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

  // When a chart segment is highlighted in the analytics panel, narrow the
  // globe to just those vessels so the related dots stand out. The highlight
  // arrives as { dim, value }: the value alone is ambiguous, and each dimension
  // matches a different vessel field — ship types go through the SAME bucketing
  // the charts use, so clicking "Other" or "Ro-Ro / Ropax" works too.
  // Per-maker profiles, from the same live fleet as everything else.
  const fleetStats = useMemo(() => buildAnalytics(vessels), [vessels]);

  // With a maker open, the globe shows exactly that maker's fleet — ignoring
  // the (hidden) filter column, so the dots always match the panel's list.
  const makerVessels = useMemo(() => {
    if (!maker || maker === "index") return null;
    return vessels.filter((v) => hasMaker(v.oem) && makerSlug(v.oem) === maker);
  }, [vessels, maker]);

  // Keep the tab title in step with the panel. The /makers routes set the
  // first one server-side; moving between makers here doesn't reload the page.
  useEffect(() => {
    const m = fleetStats.MAKERS.find((x) => x.slug === maker);
    document.title = m
      ? `${m.name} — WindFleet`
      : maker === "index"
      ? "WindFleet — WAPS makers"
      : "WindFleet — The Global Wind-Assisted Propulsion Fleet";
  }, [maker, fleetStats]);

  const globeVessels = useMemo(() => {
    if (makerVessels) return makerVessels;
    if (!analyticsHl) return filtered;
    const { dim, value } = analyticsHl;
    const matches =
      dim === "ship"
        ? (v) => shipBucket(v.type) === value
        : dim === "inst"
        ? (v) => v.installType === value
        : (v) => v.technology === value;
    const hit = filtered.filter(matches);
    // A highlight that matches nothing (e.g. filters already exclude it) would
    // blank the globe — leave the current view alone instead.
    return hit.length ? hit : filtered;
  }, [filtered, analyticsHl, makerVessels]);

  // Search pick: select the vessel (card opens, globe flies there). If the
  // current filters or a chart highlight would hide its dot, clear them first
  // so the ship you asked for is actually visible on the globe.
  const handleSearchPick = useCallback(
    (v) => {
      const hidden = !globeVessels.some((g) => g.id === v.id);
      if (isMobile && (maker != null || analyticsMode !== "closed")) {
        // On a phone the panel covers the whole globe: close it to show the ship.
        if (maker != null) openMaker(null);
        setAnalyticsMode("closed");
      } else if (hidden && makerVessels) {
        // A maker profile limits the globe to that maker's fleet: follow the
        // ship to its own maker's profile, or close the panel if it has none.
        openMaker(hasMaker(v.oem) ? makerSlug(v.oem) : null);
      }
      if (hidden) {
        setFilters({ techs: new Set(), types: new Set(), installTypes: new Set() });
        setAnalyticsHl(null);
      }
      // Full-screen analytics hides the globe; step back to the side panel.
      setAnalyticsMode((m) => (m === "full" ? "quarter" : m));
      setSelected(v);
    },
    [globeVessels, makerVessels, openMaker, isMobile, maker, analyticsMode]
  );

  // Sea-routes are precomputed offline (scripts/build_routes.py →
  // public/routes.json) with the searoute engine, so a vessel's route draws
  // instantly from one static file — no live route API, nothing to restart.
  // Each entry is
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

  const counts = useMemo(() => {
    const tech = {};
    filtered.forEach((v) => {
      tech[v.technology] = (tech[v.technology] || 0) + 1;
    });
    return { tech };
  }, [filtered]);

  // Routes are drawn for one vessel at a time, never the whole fleet: a line
  // per ship buried the dots under a tangle, and the longest (least certain)
  // lines took the most ink. Looked up instantly from routes.json. Two legs:
  //   travelled  last port → current position  (solid)
  //   planned    current position → destination (dashed, animated in GlobeView)
  // Either leg may be null (vessel in port, no destination, or no sea route);
  // we simply draw whichever exists.
  const legsFor = useCallback(
    (v, preview) => {
      if (!v) return [];
      const entry = allRoutes.find((r) => r.id === v.id);
      if (!entry) return [];
      const color = techColor(v.technology);
      const paths = [];
      // travelled is a list of pieces, {c, inferred}: inferred = a receiver gap
      // filled by searoute, drawn fainter than the observed track. (Pre-Oct-2026
      // files held one bare coordinate list; still accepted.)
      const t = entry.travelled;
      const pieces = !t ? [] : typeof t[0]?.[0] === "number" ? [{ c: t }] : t;
      for (const p of pieces)
        paths.push({ coords: p.c, color, planned: false, inferred: !!p.inferred, preview });
      if (entry.planned)
        paths.push({ coords: entry.planned, color, planned: true, preview });
      return paths;
    },
    [allRoutes]
  );

  // Clicked vessel: full-strength route. Hovered vessel: a faint preview, so
  // you can skim routes without committing to a card. On touch screens there
  // is no hover, so a tap (= select) is the only way in — same result.
  const selectedPaths = useMemo(
    () => legsFor(selected, false),
    [legsFor, selected]
  );
  const hoveredId = hovered ? hovered.id : null;
  const hoverPaths = useMemo(
    () =>
      hovered && (!selected || hovered.id !== selected.id)
        ? legsFor(hovered, true)
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [legsFor, hoveredId, selected]
  );

  // Preview underneath; the selected vessel's route drawn on top.
  const allPaths = useMemo(
    () => [...hoverPaths, ...selectedPaths],
    [hoverPaths, selectedPaths]
  );

  // overflow-clip, not -hidden: the side panels park off-screen to the right,
  // and with -hidden the browser can still scroll <main> sideways to "reveal" a
  // focused button, shoving the whole view 360px left.
  return (
    <main className="relative h-screen w-screen overflow-clip bg-ink">
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
          analyticsMode === "quarter" || makerOpen
            ? "right-0 md:right-[calc(72px_+_max(25%,360px))]"
            : "right-0 md:right-[72px]"
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
          windVariant={windVariant}
          onWindMeta={setWindMeta}
        />
      </div>

      {/* Header: wordmark left, search dead centre, toolbar right (panel
          buttons, theme, count). Sits above the panels (z-45 vs 40) so search
          results can drop over them. */}
      <header
        style={{ right: headerRight }}
        className="pointer-events-none absolute left-0 top-0 z-[45] p-4 transition-[right] duration-500 ease-in-out sm:p-6"
      >
        <div ref={headerRef}>
          <div className="flex items-start justify-between gap-3">
            <div className="pointer-events-auto">
              <h1 className="font-mono text-xl font-medium lowercase tracking-tight text-fg">
                wind<span className="text-muted">fleet</span>
              </h1>
              {/* hidden where it would run into the centred search */}
              <p className={`mt-1 hidden text-xs text-muted sm:block md:hidden ${sidePanel ? "" : "lg:block"}`}>
                Global wind-assisted propulsion · market intel
              </p>
            </div>
            {/* On desktop the theme toggle sits at the bottom of the rail, and
                the vessel count lives in the Filters card. */}
            <div className="pointer-events-auto md:hidden">
              <ThemeToggle />
            </div>
          </div>
          {/* Phones: search on its own row under the wordmark. */}
          <div className="pointer-events-auto mt-3 md:hidden">
            <VesselSearch vessels={vessels} onPick={handleSearchPick} />
          </div>
        </div>
        {/* Desktop: search centred over the map (the header stops at the rail). */}
        <div
          className={`pointer-events-auto absolute left-1/2 top-6 hidden w-64 -translate-x-1/2 xl:w-80 ${
            sidePanel ? "lg:block" : "md:block"
          }`}
        >
          <VesselSearch vessels={vessels} onPick={handleSearchPick} />
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
            ? `scroll-thin fixed inset-x-3 bottom-[76px] max-h-[70vh] overflow-y-auto ${
                filtersOpen && !panelOpen
                  ? "pointer-events-auto translate-y-0 opacity-100"
                  : "pointer-events-none translate-y-[115%] opacity-0"
              }`
            : `pointer-events-none absolute bottom-6 left-6 top-24 ${
                panelOpen ? "opacity-0" : "opacity-100"
              }`
        }`}
        aria-hidden={isMobile ? !filtersOpen : panelOpen}
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
          shown={filtered.length}
          total={vessels.length}
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
          <WindVariantSwitch value={windVariant} onChange={setWindVariant} />
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
            ? "fixed inset-x-3 bottom-3 z-50"
            : `absolute top-24 z-20 ${panelOpen ? "left-6" : "right-[96px]"}`
        }`}
      >
        <VesselCard
          vessel={selected}
          onClose={() => setSelected(null)}
          onOpenMaker={(name) => openMaker(makerSlug(name))}
        />
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

      {/* One "i" for all credits + feedback (replaces MapLibre's own "i" and
          the old centre-bottom footer line). */}
      <InfoButton className="absolute bottom-[80px] right-3 z-20 md:hidden" />

      {/* Mobile-only Filters button — opens the slide-up sheet. */}
      {isMobile && !filtersOpen && !panelOpen && !selected && (
        <button
          onClick={() => setFiltersOpen(true)}
          aria-label="Open filters and layers"
          className="pointer-events-auto fixed bottom-[80px] left-4 z-30 flex items-center gap-2 rounded-full border border-edge/60 bg-panel/90 px-4 py-2.5 text-xs font-medium text-fg shadow-xl backdrop-blur-md"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Filters
          {/* the vessel count, which on desktop heads the Filters card */}
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-accent px-1.5 font-mono text-[10px] font-semibold tabular-nums text-ink">
              {filtered.length}/{vessels.length}
            </span>
          ) : (
            <span className="font-mono tabular-nums text-muted">{vessels.length}</span>
          )}
        </button>
      )}

      {/* Analytics panel — beside the globe, or full width; below the header */}
      <div
        style={{ top: isMobile || analyticsMode === "full" ? panelTop : 0 }}
        className={`absolute bottom-[64px] right-0 z-40 overflow-hidden border-edge/60 bg-ink/95 md:bottom-0 md:right-[72px] backdrop-blur-md transition-all duration-500 ease-in-out ${
          analyticsMode === "full"
            ? "left-0 border-t"
            : "left-0 border-t md:left-auto md:w-1/4 md:min-w-[360px] md:border-l md:border-t-0"
        } ${analyticsOpen ? "translate-x-0" : "translate-x-[calc(100%_+_72px)]"}`}
        aria-hidden={!analyticsOpen}
      >
        {analyticsOpen && (
          <AnalyticsDashboard
            vessels={vessels}
            compact={analyticsMode === "quarter"}
            onClose={closeAnalytics}
            onExpand={() => setAnalyticsMode("full")}
            onCollapse={() => setAnalyticsMode("quarter")}
            onHighlight={setAnalyticsHl}
          />
        )}
      </div>

      {/* Maker panel — same slot and width as the analytics panel */}
      <div
        style={{ top: isMobile ? panelTop : 0 }}
        className={`absolute bottom-[64px] left-0 right-0 z-40 overflow-hidden border-t border-edge/60 bg-ink/95 backdrop-blur-md transition-all duration-500 ease-in-out md:bottom-0 md:left-auto md:right-[72px] md:w-1/4 md:min-w-[360px] md:border-l md:border-t-0 ${
          makerOpen ? "translate-x-0" : "translate-x-[calc(100%_+_72px)]"
        }`}
        aria-hidden={!makerOpen}
      >
        {makerOpen && (
          <MakerPanel
            makers={fleetStats.MAKERS}
            slug={maker}
            lastYear={fleetStats.LAST_YEAR}
            selectedId={selected?.id}
            onOpen={openMaker}
            onClose={() => openMaker(null)}
            onSelectVessel={setSelected}
          />
        )}
      </div>
      <SideRail open={openPanel} onToggle={togglePanel} />
      <MobileTabBar open={openPanel} onToggle={togglePanel} />
    </main>
  );
}
