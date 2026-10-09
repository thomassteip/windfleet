"use client";

import { useEffect, useRef, useState } from "react";
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useTheme } from "./ThemeProvider";
import { techColor, SHIP_COLORS, INSTALL_COLORS } from "@/lib/theme";
import { SHIP_ORDER, INSTALL_ORDER } from "@/lib/analytics";
import { niceTicks } from "@/lib/chart";
import ChartTip from "./analytics/ChartTip";

// Right-hand panel inside FleetExplorer for the WAPS makers: an index of every
// maker, or one maker's profile. All figures come from buildAnalytics(fleet)'s
// MAKERS, i.e. the same live fleet the globe draws — see THE RULE in CLAUDE.md.
//
// slug === "index" shows the list; any other slug shows that maker.

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

function Timeline({ maker, lastYear }) {
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
      <ResponsiveContainer width="100%" height={130}>
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

function MakerProfile({ maker, lastYear, selectedId, onSelectVessel }) {
  const [showAll, setShowAll] = useState(false);
  const color = techColor(maker.techs[0]);
  const list = showAll ? maker.vessels : maker.vessels.slice(0, LIST_PREVIEW);
  const noFix = maker.vessels.filter((v) => v.lat == null).length;

  return (
    <>
      <div className="flex items-center gap-3">
        <Monogram name={maker.name} color={color} />
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
        </div>
      </div>

      <div className="mt-4 border-y border-edge/50 py-3">
        <div className="flex gap-6">
          <Stat value={maker.count} label="vessels" />
          <Stat value={maker.units} label="devices fitted" />
          <Stat value={maker.first} label="since" />
          <Stat value={pct(maker.retrofits / maker.count)} label="retrofit" />
        </div>
      </div>

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
        <p className="mt-1.5 px-2 text-[10px] text-muted/70">
          N = newbuild · R = retrofit{noFix > 0 && " · ○ = no AIS position, not on the globe"}
        </p>
      </section>

      {(maker.repeatCustomers.length > 0 || maker.singleCustomers > 0) && (
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
      )}

      {maker.yards.length > 0 && (
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
      )}

      <section className="mt-6">
        <Timeline maker={maker} lastYear={lastYear} />
      </section>
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
      <div className="px-4 py-5">
        <div className="mb-5 flex items-center justify-between">
          {/* The header's tabs stay visible above this panel (theme toggle
              included), so the panel itself only needs a way back and out. */}
          {slug === "index" ? (
            <span />
          ) : (
            <button onClick={() => onOpen("index")} className="font-mono text-xs text-muted transition hover:text-fg">
              ← all makers
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close maker panel"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/70 text-muted transition hover:border-accent hover:text-fg"
          >
            ✕
          </button>
        </div>

        {slug === "index" ? (
          <MakerIndex makers={makers} onOpen={onOpen} />
        ) : maker ? (
          <MakerProfile
            key={maker.slug}
            maker={maker}
            lastYear={lastYear}
            selectedId={selectedId}
            onSelectVessel={onSelectVessel}
          />
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
