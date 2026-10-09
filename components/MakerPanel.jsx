"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useTheme } from "./ThemeProvider";
import { techColor, SHIP_COLORS, INSTALL_COLORS, TECH_ORDER } from "@/lib/theme";
import { SHIP_ORDER, INSTALL_ORDER } from "@/lib/analytics";
import { niceTicks } from "@/lib/chart";
import ChartTip from "./analytics/ChartTip";
import PanelBar, { PANEL_BACK, PANEL_ICON_BTN } from "./PanelBar";
import { makerSites } from "@/lib/makers";

// Right-hand panel inside FleetExplorer for the WAPS makers: an index of every
// maker, or one maker's profile. All figures come from buildAnalytics(fleet)'s
// MAKERS, i.e. the same live fleet the globe draws — see THE RULE in CLAUDE.md.
//
// slug === "index" shows the list; any other slug shows that maker.
//
// Two widths, like analytics: beside the globe (a list, a compact profile), or
// full width (`wide`: a grid of maker cards, a wide profile with the whole
// fleet as a table). Cards are equal-sized and A to Z: WindFleet never ranks
// makers (CLAUDE.md, Domain rules).

const LIST_PREVIEW = 10;

function Caption({ children, className = "" }) {
  return (
    <h3 className={`mb-2 text-[11px] font-medium uppercase tracking-wider text-muted/80 ${className}`}>
      {children}
    </h3>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="font-mono text-lg tabular-nums leading-none text-fg">{value ?? "—"}</div>
      <div className="mt-1 text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}

function Monogram({ name, color }) {
  return (
    <div
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-edge/60 bg-ink font-mono text-lg font-medium text-fg"
      style={{ boxShadow: `inset 0 -3px 0 ${color}` }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function MakerIndex({ makers, onOpen }) {
  return (
    <>
      <h1 className="font-mono text-xl font-medium lowercase tracking-tight text-fg">makers</h1>
      <p className="mt-1 text-xs text-muted">
        {makers.length} companies with a wind propulsion system in commercial service, A to Z
      </p>
      <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_2.5rem_2.75rem] gap-x-3 px-2 pb-1.5 text-[10px] uppercase tracking-wider text-muted/80">
        <span>Maker</span>
        <span>Country</span>
        <span className="text-right">Ships</span>
        <span className="text-right">Since</span>
      </div>
      <ul>
        {makers.map((m) => (
          <li key={m.slug}>
            <button
              onClick={() => onOpen(m.slug)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto_2.5rem_2.75rem] items-center gap-x-3 rounded-md px-2 py-1.5 text-left text-xs transition hover:bg-edge/40"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: techColor(m.techs[0]) }} />
                <span className="truncate text-fg">{m.name}</span>
              </span>
              <span className="text-muted">{m.country || "—"}</span>
              <span className="text-right font-mono tabular-nums text-fg">{m.count}</span>
              <span className="text-right font-mono tabular-nums text-muted">{m.first || "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

// Full-width index: one equal-sized card per maker, A to Z, with technology
// chips to narrow the grid (a filter, not a ranking).
function MakerCards({ makers, onOpen }) {
  const [tech, setTech] = useState(null);
  const techs = TECH_ORDER.filter((t) => makers.some((m) => m.techs.includes(t)));
  const shown = tech ? makers.filter((m) => m.techs.includes(tech)) : makers;
  return (
    <>
      <h1 className="font-mono text-2xl font-medium lowercase tracking-tight text-fg">makers</h1>
      <p className="mt-1 text-sm text-muted">
        {makers.length} companies with a wind propulsion system in commercial service, A to Z
      </p>
      <div className="mt-5 flex flex-wrap gap-1.5">
        {[null, ...techs].map((t) => {
          const on = tech === t;
          const n = t ? makers.filter((m) => m.techs.includes(t)).length : makers.length;
          return (
            <button
              key={t || "all"}
              onClick={() => setTech(t)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                on ? "border-edge bg-edge/60 text-fg" : "border-edge/50 text-muted hover:border-edge hover:text-fg"
              }`}
            >
              {t && <span className="h-2 w-2 rounded-full" style={{ background: techColor(t), opacity: on ? 1 : 0.5 }} />}
              {t || "All"} <span className="font-mono tabular-nums text-muted">{n}</span>
            </button>
          );
        })}
      </div>
      <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((m) => {
          const types = [...new Set(m.vessels.map((v) => v.type).filter(Boolean))].sort();
          return (
            <li key={m.slug}>
              <button
                onClick={() => onOpen(m.slug)}
                className="flex h-full w-full flex-col rounded-2xl border border-edge/60 bg-panel/60 p-4 text-left transition hover:border-accent/70 hover:bg-panel"
              >
                <span className="flex items-center gap-3">
                  <Monogram name={m.name} color={techColor(m.techs[0])} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-fg">{m.name}</span>
                    <span className="block text-[11px] text-muted">{m.country || "—"}</span>
                  </span>
                </span>
                <span className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                  {m.techs.map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full" style={{ background: techColor(t) }} />
                      {t}
                    </span>
                  ))}
                </span>
                <span className="mt-1.5 block truncate text-[11px] text-muted/80" title={types.join(", ")}>
                  {types.join(" · ")}
                </span>
                <span className="mt-auto flex items-baseline justify-between pt-4 text-[11px] text-muted">
                  <span>
                    <span className="font-mono tabular-nums text-fg">{m.count}</span> vessel{m.count === 1 ? "" : "s"}
                  </span>
                  <span>
                    since <span className="font-mono tabular-nums text-fg">{m.first || "—"}</span>
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Timeline({ maker, lastYear, height = 130 }) {
  const { theme } = useTheme();
  const [dim, setDim] = useState("ship");
  const keys = dim === "ship" ? SHIP_ORDER : INSTALL_ORDER;
  const colors = dim === "ship" ? SHIP_COLORS : INSTALL_COLORS;
  const data = maker.perYear[dim];
  const totals = keys
    .map((k) => [k, data.reduce((s, r) => s + r[k], 0)])
    .filter(([, n]) => n > 0);
  const yTicks = niceTicks(Math.max(1, ...data.map((r) => keys.reduce((s, k) => s + r[k], 0))), 4);
  const AXIS = {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 10,
    fill: theme === "dark" ? "#7d8aa3" : "#5d6b82",
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Caption className="mb-0 whitespace-nowrap">Installations per year</Caption>
        <div className="flex gap-0.5 rounded-md border border-edge/60 p-0.5 text-[10px]">
          {[
            ["ship", "Ship type"],
            ["inst", "Newbuild / retrofit"],
          ].map(([val, label]) => (
            <button
              key={val}
              onClick={() => setDim(val)}
              className={`whitespace-nowrap rounded px-2 py-0.5 transition ${dim === val ? "bg-accent/20 text-fg" : "text-muted hover:text-fg"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} maxBarSize={28} margin={{ top: 4, right: 0, bottom: 0, left: -28 }}>
          <XAxis
            dataKey="year"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            interval="preserveEnd"
            minTickGap={4}
            tickFormatter={(y) => `'${y.slice(2)}`}
          />
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            allowDecimals={false}
            ticks={yTicks}
            domain={[0, yTicks[yTicks.length - 1]]}
          />
          <Tooltip cursor={{ fill: theme === "dark" ? "#ffffff08" : "#00000008" }} content={<ChartTip />} />
          {keys.map((k) => (
            <Bar key={k} dataKey={k} stackId="a" fill={colors[k]} isAnimationActive={false}>
              {/* the newest year is year-to-date, so draw it faded */}
              {data.map((r) => (
                <Cell key={r.year} fillOpacity={r.year === lastYear ? 0.55 : 1} />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {totals.map(([k, n]) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: colors[k] }} />
            {k} <span className="font-mono tabular-nums text-fg/80">{n}</span>
          </span>
        ))}
        {lastYear && <span className="text-muted/70">{lastYear} year to date</span>}
      </div>
    </div>
  );
}

const pct = (x) => `${Math.round(x * 100)}%`;

function MakerHeader({ maker }) {
  const sites = makerSites(maker.slug);
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Monogram name={maker.name} color={techColor(maker.techs[0])} />
      <div className="min-w-0">
        <h1 className="truncate text-xl font-medium text-fg">{maker.name}</h1>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          {maker.techs.map((t) => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: techColor(t) }} />
              {t}
            </span>
          ))}
          {maker.country && <span>· {maker.country}</span>}
        </p>
        {/* Website(s), hand-curated in lib/makers.js; none shown if unknown. */}
        {sites.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
            {sites.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-accent underline decoration-dotted underline-offset-2 transition hover:text-fg"
              >
                {s.label}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </a>
            ))}
          </p>
        )}
      </div>
    </div>
  );
}

function MakerStats({ maker }) {
  return (
    <div className="mt-4 border-y border-edge/50 py-3">
      <div className="flex gap-6">
        <Stat value={maker.count} label="vessels" />
        <Stat value={maker.units} label="devices fitted" />
        <Stat value={maker.first} label="since" />
        <Stat value={pct(maker.retrofits / maker.count)} label="retrofit" />
      </div>
    </div>
  );
}

function Customers({ maker }) {
  if (!(maker.repeatCustomers.length > 0 || maker.singleCustomers > 0)) return null;
  return (
    <section className="mt-5">
      <Caption>{maker.repeatCustomers.length ? "Repeat customers" : "Customers"}</Caption>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {maker.repeatCustomers.map((c) => (
          <span key={c.owner} className="rounded-full border border-edge/70 px-2.5 py-0.5 text-fg/90">
            {c.owner} <span className="font-mono text-muted">×{c.n}</span>
          </span>
        ))}
        <span className="px-1 text-muted">
          {[
            maker.singleCustomers &&
              `${maker.repeatCustomers.length ? "+ " : ""}${maker.singleCustomers} single-ship owner${maker.singleCustomers === 1 ? "" : "s"}`,
            maker.unknownCustomers && `${maker.unknownCustomers} unknown`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
    </section>
  );
}

function Yards({ maker }) {
  if (!maker.yards.length) return null;
  return (
    <section className="mt-5">
      <Caption>Fitted at</Caption>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {maker.yards.map((y) => (
          <span key={y.yard} className="rounded-full border border-edge/70 px-2.5 py-0.5 text-fg/90">
            {y.yard}
            {y.n > 1 && <span className="font-mono text-muted"> ×{y.n}</span>}
          </span>
        ))}
        {maker.yardsKnown < maker.count && (
          <span className="px-1 text-muted">
            yard known for {maker.yardsKnown} of {maker.count}
          </span>
        )}
      </div>
    </section>
  );
}

const noFixNote = (maker) =>
  maker.vessels.some((v) => v.lat == null) ? " · ○ = no AIS position, not on the globe" : "";

// Side-panel profile: compact fleet list (first ten, "show all").
function MakerProfile({ maker, lastYear, selectedId, onSelectVessel }) {
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? maker.vessels : maker.vessels.slice(0, LIST_PREVIEW);

  return (
    <>
      <MakerHeader maker={maker} />
      <MakerStats maker={maker} />

      <section className="mt-4">
        <Caption>Fleet · click a ship to find it</Caption>
        <ul>
          {list.map((v) => {
            const on = selectedId === v.id;
            return (
              <li key={v.id}>
                <button
                  onClick={() => onSelectVessel(on ? null : v)}
                  className={`grid w-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_3.5rem] items-center gap-x-3 rounded-md px-2 py-1.5 text-left text-xs transition ${
                    on ? "bg-edge/70" : "hover:bg-edge/40"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`truncate ${v.lat == null ? "text-muted" : "text-fg"}`}>{v.name}</span>
                    {v.lat == null && (
                      <span title="No AIS position: not on the globe" className="shrink-0 text-[10px] text-muted/70">
                        ○
                      </span>
                    )}
                  </span>
                  <span className="truncate text-muted">{v.type}</span>
                  <span className="text-right font-mono tabular-nums text-muted">
                    {v.installedYear || "—"}
                    {v.installType ? ` ${v.installType[0]}` : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {maker.vessels.length > LIST_PREVIEW && (
          <button onClick={() => setShowAll((s) => !s)} className="mt-1 px-2 text-[11px] text-accent hover:underline">
            {showAll ? "Show fewer" : `Show all ${maker.vessels.length}`}
          </button>
        )}
        <p className="mt-1.5 px-2 text-[10px] text-muted/70">N = newbuild · R = retrofit{noFixNote(maker)}</p>
      </section>

      <Customers maker={maker} />
      <Yards maker={maker} />

      <section className="mt-6">
        <Timeline maker={maker} lastYear={lastYear} />
      </section>
    </>
  );
}

// Full-width profile: the whole fleet as a table beside the chart and the
// customer/yard facts. The globe is hidden at this width, so a ship click (or
// "Show fleet on globe") steps back to the side panel to show it there.
function MakerProfileWide({ maker, lastYear, onShowOnGlobe }) {
  const cols = "grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.8fr)_4rem_5rem_3rem_minmax(0,1.3fr)]";
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <MakerHeader maker={maker} />
        <button
          onClick={() => onShowOnGlobe(null)}
          className="flex items-center gap-2 rounded-lg border border-edge/70 px-3 py-2 text-xs text-muted transition hover:border-accent hover:text-fg"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
          Show fleet on globe
        </button>
      </div>
      <MakerStats maker={maker} />

      <div className="mt-6 grid gap-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="min-w-0">
          <Caption>Fleet · click a ship to find it on the globe</Caption>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className={`grid ${cols} gap-x-3 border-b border-edge/50 px-2 pb-1.5 text-[10px] uppercase tracking-wider text-muted/80`}>
                <span>Vessel</span>
                <span>Ship type</span>
                <span>Flag</span>
                <span className="text-right">Installed</span>
                <span>Install</span>
                <span className="text-right">Units</span>
                <span>Owner</span>
              </div>
              <ul>
                {maker.vessels.map((v) => {
                  const onGlobe = v.lat != null;
                  return (
                    <li key={v.id}>
                      <button
                        onClick={() => onGlobe && onShowOnGlobe(v)}
                        disabled={!onGlobe}
                        title={onGlobe ? "Show on globe" : "No AIS position: not on the globe"}
                        className={`grid w-full ${cols} items-center gap-x-3 rounded-md px-2 py-1.5 text-left text-xs transition ${
                          onGlobe ? "hover:bg-edge/40" : "cursor-default"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className={`truncate ${onGlobe ? "text-fg" : "text-muted"}`}>{v.name}</span>
                          {!onGlobe && <span className="shrink-0 text-[10px] text-muted/70">○</span>}
                        </span>
                        <span className="truncate text-muted">{v.type}</span>
                        <span className="truncate text-muted">{v.flag || "—"}</span>
                        <span className="text-right font-mono tabular-nums text-muted">{v.installedYear || "—"}</span>
                        <span className="text-muted">{v.installType || "—"}</span>
                        <span className="text-right font-mono tabular-nums text-muted">{v.units || "—"}</span>
                        <span className="truncate text-muted">{v.shipowner && v.shipowner !== "None" ? v.shipowner : "—"}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
          {noFixNote(maker) && <p className="mt-1.5 px-2 text-[10px] text-muted/70">{noFixNote(maker).slice(3)}</p>}
        </section>

        <div className="min-w-0">
          <Timeline maker={maker} lastYear={lastYear} height={200} />
          <Customers maker={maker} />
          <Yards maker={maker} />
        </div>
      </div>
    </>
  );
}

export default function MakerPanel({
  makers,
  slug,
  lastYear,
  selectedId,
  onOpen,
  onClose,
  onSelectVessel,
  wide = false,
  onExpand,
  onCollapse,
  onShowOnGlobe,
}) {
  const maker = slug !== "index" ? makers.find((m) => m.slug === slug) : null;

  // Each maker (and the list) starts at the top. Without this, opening a maker
  // from far down the A to Z list kept the list's scroll position, so the
  // profile appeared with its name already scrolled out of view.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [slug]);

  return (
    <div ref={scrollRef} className="scroll-thin h-full w-full overflow-y-auto bg-ink">
      <div className={wide ? "mx-auto max-w-6xl px-6 py-8" : "px-4 py-5"}>
        <PanelBar
          back={
            slug !== "index" && (
              <button onClick={() => onOpen("index")} className={PANEL_BACK}>
                ← all makers
              </button>
            )
          }
          onClose={onClose}
          closeLabel="Close makers"
          actions={
            wide
              ? onCollapse && (
                  <button onClick={onCollapse} aria-label="Collapse makers to side panel" title="Back to side panel" className={PANEL_ICON_BTN}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 3H3v6M21 15v6h-6M3 3l7 7M21 21l-7-7" />
                    </svg>
                  </button>
                )
              : onExpand && (
                  <button onClick={onExpand} aria-label="Expand makers to full screen" title="Full width: maker cards" className={PANEL_ICON_BTN}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                    </svg>
                  </button>
                )
          }
        />

        {slug === "index" ? (
          wide ? (
            <MakerCards makers={makers} onOpen={onOpen} />
          ) : (
            <MakerIndex makers={makers} onOpen={onOpen} />
          )
        ) : maker ? (
          wide ? (
            <MakerProfileWide key={maker.slug} maker={maker} lastYear={lastYear} onShowOnGlobe={onShowOnGlobe} />
          ) : (
            <MakerProfile
              key={maker.slug}
              maker={maker}
              lastYear={lastYear}
              selectedId={selectedId}
              onSelectVessel={onSelectVessel}
            />
          )
        ) : (
          <div className="text-sm text-muted">
            <p>No maker with that name in the fleet.</p>
            <button onClick={() => onOpen("index")} className="mt-2 text-accent hover:underline">
              See all makers
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
