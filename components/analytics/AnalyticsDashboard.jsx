"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import RibbonChart from "./RibbonChart";
import Tip from "./ChartTip";
import {
  POP,
  TECH_COLORS,
  SHIP_COLORS,
  INSTALL_COLORS,
  TECH_ORDER,
  techColor,
} from "@/lib/theme";
import { buildAnalytics, FALLBACK_ANALYTICS, INSTALL_ORDER } from "@/lib/analytics";
import { fetchVessels } from "@/lib/data";
import { useTheme } from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";
import PanelBar, { PANEL_BACK, PANEL_ICON_BTN } from "@/components/PanelBar";

const FADE = 0.16;

function colorFor(dim, key) {
  if (dim === "ship") return SHIP_COLORS[key] || POP.grey;
  if (dim === "inst") return INSTALL_COLORS[key] || POP.grey;
  return TECH_COLORS[key] || POP.grey;
}

function Card({ title, action, children, className = "" }) {
  const ref = useRef(null);
  const { theme } = useTheme();

  const exportPng = async () => {
    if (!ref.current) return;
    const { toPng } = await import("html-to-image");
    const url = await toPng(ref.current, {
      pixelRatio: 2,
      backgroundColor: theme === "dark" ? "#0b1220" : "#ffffff",
      filter: (n) => !(n.dataset && n.dataset.noexport),
    });
    const a = document.createElement("a");
    a.download = `windfleet-${title.split(" ")[0].toLowerCase()}.png`;
    a.href = url;
    a.click();
  };

  return (
    <div ref={ref} className={`rounded-2xl border border-edge/60 bg-panel/60 p-5 ${className}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h3 className="min-w-0 text-[11px] font-medium uppercase tracking-[0.16em] text-muted">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-2" data-noexport="true">
          {action}
          <button
            onClick={exportPng}
            title="Download PNG"
            aria-label="Download chart as PNG"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/70 text-muted transition hover:border-accent hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v12M7 11l5 5 5-5M5 21h14" />
            </svg>
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition ${
            value === o.value
              ? "border-accent bg-accent/15 text-fg"
              : "border-edge/70 text-muted hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function LegendChips({ items, colorFn, hl, onPick }) {
  // Dim only when the highlight is one of THIS legend's items, so a technology
  // picked elsewhere doesn't fade a ship-type legend whose bands stay lit.
  const mine = hl != null && items.includes(hl);
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="flex items-center gap-1.5 text-[11px] transition"
          style={{ opacity: !mine || hl === c ? 1 : 0.4 }}
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFn(c) }} />
          <span className={hl === c ? "text-fg" : "text-muted"}>{c}</span>
        </button>
      ))}
    </div>
  );
}

const pct = (x) => `${Math.round(x * 100)}%`;
const fmtShareValue = (metric, v) =>
  metric === "dwt"
    ? `${Math.round(v / 1000).toLocaleString("en-GB")} kt`
    : `${v} ${metric === "vessels" ? (v === 1 ? "vessel" : "vessels") : v === 1 ? "device" : "devices"}`;

// Technology share as 100% bars, one per weighting (vessels, devices, DWT).
// Replaced a vessels-only donut that repeated the market-size chart and could
// only be read by hovering. Plain HTML so every segment is a real button.
function ShareBars({ rows, hl, onPick, fade }) {
  const [hover, setHover] = useState(null);
  const dwt = rows.find((r) => r.metric === "dwt");
  return (
    <div>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.metric} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[11px] text-muted">{r.label}</span>
            {/* 2px gaps between segments, rounded outer ends */}
            <div className="flex h-7 min-w-0 flex-1 gap-[2px] overflow-hidden rounded">
              {r.parts.map((p) => (
                <button
                  key={p.tech}
                  onClick={() => onPick(p.tech)}
                  onMouseEnter={() => setHover({ ...p, metric: r.metric })}
                  onMouseLeave={() => setHover(null)}
                  title={`${p.tech}: ${fmtShareValue(r.metric, p.value)} (${pct(p.share)})`}
                  className="flex min-w-[3px] items-center justify-center overflow-hidden font-mono text-[11px] text-[#10202e] transition-opacity"
                  style={{ width: `${p.share * 100}%`, background: techColor(p.tech), opacity: fade(p.tech) }}
                >
                  {p.share >= 0.1 ? pct(p.share) : ""}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* hover readout, in text ink rather than the series colour */}
      <p className="mt-3 min-h-[1rem] font-mono text-[11px] leading-4 text-muted">
        {hover ? (
          <>
            <span className="text-fg">{hover.tech}</span> · {fmtShareValue(hover.metric, hover.value)} ·{" "}
            <span className="text-fg">{pct(hover.share)}</span>
          </>
        ) : (
          "Hover for numbers · click to spotlight"
        )}
      </p>
      {dwt && dwt.missing > 0 && (
        <p className="mt-1 text-[11px] text-muted/80">
          Deadweight leaves out {dwt.missing} vessel{dwt.missing === 1 ? "" : "s"} with no DWT on record.
        </p>
      )}
    </div>
  );
}

const KPI = ({ value, label, highlight }) => (
  <div className="rounded-xl border border-edge/50 bg-panel/50 px-4 py-3">
    <div
      className="font-mono text-2xl font-semibold leading-none tabular-nums"
      style={{ color: highlight ? POP.teal : "rgb(var(--fg))" }}
    >
      {value}
    </div>
    <div className="mt-1.5 text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
  </div>
);

export default function AnalyticsDashboard({
  onClose,
  compact = false,
  onExpand,
  onCollapse,
  onHighlight,
  vessels,
}) {
  const { theme } = useTheme();
  const [dim, setDim] = useState("ship");
  const [metric, setMetric] = useState("devices");
  const [hl, setHl] = useState(null);
  // Which dimension `hl` belongs to ("tech" | "ship" | "inst"). The value alone
  // isn't enough for the globe: "Bulk Carrier" has to be matched against a
  // vessel's ship-type bucket, "Retrofit" against its installType.
  const [hlDim, setHlDim] = useState("tech");

  // Surface the current highlight to the parent so the globe can show the
  // related dots.
  useEffect(() => {
    onHighlight && onHighlight(hl ? { dim: hlDim, value: hl } : null);
  }, [hl, hlDim, onHighlight]);

  // Clear the cross-filter when this panel unmounts.
  useEffect(() => {
    return () => onHighlight && onHighlight(null);
  }, [onHighlight]);

  // Own fetch only when the parent didn't hand us a fleet (the standalone
  // /analytics route). Falls back to the bundled snapshot until it resolves.
  const [ownFleet, setOwnFleet] = useState(null);
  useEffect(() => {
    if (vessels) return undefined;
    let active = true;
    fetchVessels().then((live) => {
      if (active && live) setOwnFleet(live);
    });
    return () => {
      active = false;
    };
  }, [vessels]);

  const fleet = vessels || ownFleet;
  const A = useMemo(
    () => (fleet ? buildAnalytics(fleet) : FALLBACK_ANALYTICS),
    [fleet]
  );
  const {
    KPIS,
    CUMULATIVE,
    INSTALLS_BY_TECH,
    LAST_YEAR,
    TECH_SHARE,
    TECH_INSTALL,
    marketSize,
  } = A;

  const cum = CUMULATIVE[dim];
  const market = marketSize(metric);
  const metricSuffix = metric === "dwt" ? "k t" : metric === "vessels" ? "" : " units";

  const AXIS = {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    fill: theme === "dark" ? "#7d8aa3" : "#5d6b82",
  };
  const GRID = theme === "dark" ? "#16243a" : "#e6eaf1";

  const toggleHl = (name, forDim = "tech") => {
    setHlDim(forDim);
    setHl((h) => (h === name ? null : name));
  };
  // The hero chart's bands are whichever dimension the toggle is on.
  const pickCum = (name) => toggleHl(name, dim);
  // Opacity for a series/category: fade only within charts that contain hl.
  const op = (name, cats) => (!hl || !cats.includes(hl) ? 1 : name === hl ? 1 : FADE);

  return (
    <div className="h-full w-full overflow-y-auto bg-ink scroll-thin">
      <div className={compact ? "px-4 py-5" : "mx-auto max-w-6xl px-6 py-8"}>
        {/* Same top bar as every side panel: actions and ✕ on the right. The
            standalone /analytics page has no globe to close back to, so it gets
            a link home and its own theme toggle instead. */}
        <PanelBar
          back={
            !onClose && (
              <Link href="/" className={PANEL_BACK}>
                ← windfleet
              </Link>
            )
          }
          onClose={onClose}
          closeLabel="Close analytics"
          actions={
            <>
              {/* Expand to full width / collapse back to the side panel */}
              {compact && onExpand && (
                <button onClick={onExpand} aria-label="Expand analytics to full screen" title="Expand to full width" className={PANEL_ICON_BTN}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                </button>
              )}
              {!compact && onCollapse && (
                <button onClick={onCollapse} aria-label="Collapse analytics to side panel" title="Back to side panel" className={PANEL_ICON_BTN}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 3H3v6M21 15v6h-6M3 3l7 7M21 21l-7-7" />
                  </svg>
                </button>
              )}
              {!onClose && <ThemeToggle />}
            </>
          }
        />
        <div className="mb-6">
          <h1 className={`font-mono font-medium lowercase tracking-tight text-fg ${compact ? "text-xl" : "text-2xl"}`}>
            fleet analytics
          </h1>
          {!compact && (
            <p className="mt-1 text-sm text-muted">
              The global wind-assisted propulsion fleet, in numbers
            </p>
          )}
        </div>

        {hl && (
          <button
            onClick={() => setHl(null)}
            title={`Clear ${hl} highlight`}
            className="mb-4 flex max-w-full items-center gap-1.5 rounded-md border border-edge/70 px-2.5 py-1 font-mono text-[11px] text-muted transition hover:text-fg"
          >
            <span className="truncate">clear: {hl}</span>
            <span className="shrink-0">✕</span>
          </button>
        )}

        {compact && !hl && (
          <p className="mb-4 text-[11px] leading-relaxed text-muted">
            Click any segment in a chart to spotlight its vessels on the globe.
          </p>
        )}

        {/* KPIs */}
        <div className={`mb-6 grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"}`}>
          <KPI value={KPIS.total} label="vessels" />
          <KPI value={KPIS.yoy != null ? `${KPIS.yoy > 0 ? "+" : ""}${KPIS.yoy}%` : "—"} label={`yoy ${KPIS.yoyLabel}`} highlight />
          <KPI value={KPIS.devices} label="wind devices" />
          <KPI value={`${KPIS.retrofitPct}%`} label="retrofit" />
          <KPI value={KPIS.makers} label="makers" />
          <KPI value={KPIS.countries} label="maker countries" />
        </div>

        {/* Hero cumulative area */}
        <Card
          title={`Cumulative fleet · by ${
            { ship: "ship type", tech: "technology", inst: "retrofit / newbuild" }[dim]
          }`}
          action={
            <Toggle
              value={dim}
              onChange={(v) => {
                setDim(v);
                setHl(null);
              }}
              options={[
                { value: "ship", label: "Ship type" },
                { value: "tech", label: "Technology" },
                { value: "inst", label: "Retrofit/NB" },
              ]}
            />
          }
          className="mb-6"
        >
          <LegendChips items={cum.keys} colorFn={(k) => colorFor(dim, k)} hl={hl} onPick={pickCum} />
          <RibbonChart
            data={cum.data}
            cats={cum.keys}
            colorFn={(k) => colorFor(dim, k)}
            theme={theme}
            highlight={hl}
            onPick={pickCum}
            partialYear={LAST_YEAR}
            ranked={false}
          />
          <p className="mt-2 text-[11px] text-muted">
            Cumulative fleet in service; column height is the running total, bands stack in legend order from the bottom. {LAST_YEAR} has a dotted outline — it is year-to-date and will keep growing.
          </p>
        </Card>

        {/* Ribbon: annual installs by technology */}
        <Card title="Installations per year · by technology" className="mb-6">
          <LegendChips items={TECH_ORDER} colorFn={techColor} hl={hl} onPick={toggleHl} />
          <RibbonChart
            data={INSTALLS_BY_TECH}
            cats={TECH_ORDER}
            colorFn={techColor}
            theme={theme}
            highlight={hl}
            onPick={toggleHl}
            partialYear={LAST_YEAR}
          />
          <p className="mt-2 text-[11px] text-muted">
            Ranked ribbons — column height is the annual install count, bands reorder as technologies rise and fall. {LAST_YEAR} has a dotted outline (year-to-date).
          </p>
        </Card>

        {/* Technology share + tech split */}
        <div className={`mb-6 grid gap-6 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          <Card title="Technology share">
            <LegendChips items={TECH_ORDER.filter((t) => TECH_SHARE[0].parts.some((p) => p.tech === t))} colorFn={techColor} hl={hl} onPick={toggleHl} />
            <ShareBars rows={TECH_SHARE} hl={hl} onPick={toggleHl} fade={(t) => op(t, TECH_ORDER)} />
          </Card>

          <Card title="Technology × retrofit / newbuild">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={TECH_INSTALL} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="tech" tick={AXIS} tickLine={false} axisLine={false} width={118} />
                <Tooltip content={<Tip />} cursor={{ fill: theme === "dark" ? "#ffffff08" : "#00000008" }} />
                <Legend iconType="square" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                {INSTALL_ORDER.map((seg, i) => (
                  <Bar
                    key={seg}
                    dataKey={seg}
                    stackId="a"
                    fill={INSTALL_COLORS[seg]}
                    radius={i === INSTALL_ORDER.length - 1 ? [0, 3, 3, 0] : [0, 0, 0, 0]}
                    onClick={(d) => toggleHl(d.tech)}
                  >
                    {TECH_INSTALL.map((row) => (
                      <Cell key={row.tech} fillOpacity={op(row.tech, TECH_ORDER)} style={{ cursor: "pointer" }} />
                    ))}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

        {/* Market size (last card, so it carries the bottom spacing) */}
        <div className="mb-10">
          <Card
            title="Market size per technology"
            action={
              <Toggle
                value={metric}
                onChange={setMetric}
                options={[
                  { value: "devices", label: "Devices" },
                  { value: "vessels", label: "Vessels" },
                  { value: "dwt", label: "DWT" },
                ]}
              />
            }
          >
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={market} layout="vertical" margin={{ left: 8, right: 12 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="tech" tick={AXIS} tickLine={false} axisLine={false} width={118} />
                <Tooltip content={<Tip suffix={metricSuffix} />} cursor={{ fill: theme === "dark" ? "#ffffff08" : "#00000008" }} />
                <Bar dataKey="value" radius={[0, 3, 3, 0]} onClick={(d) => toggleHl(d.tech)}>
                  {market.map((d) => (
                    <Cell key={d.tech} fill={techColor(d.tech)} fillOpacity={op(d.tech, TECH_ORDER)} style={{ cursor: "pointer" }} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </div>

      </div>
    </div>
  );
}
