"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Treemap,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import RibbonChart from "./RibbonChart";
import {
  POP,
  TECH_COLORS,
  SHIP_COLORS,
  INSTALL_COLORS,
  TECH_ORDER,
  techColor,
} from "@/lib/theme";
import {
  KPIS,
  CUMULATIVE,
  INSTALLS_BY_TECH,
  LAST_YEAR,
  TECH_MIX,
  TECH_INSTALL,
  OEM_TREEMAP,
  INSTALL_ORDER,
  marketSize,
} from "@/lib/analytics";
import { useTheme } from "@/components/ThemeProvider";
import ThemeToggle from "@/components/ThemeToggle";

const FADE = 0.16;

function colorFor(dim, key) {
  if (dim === "ship") return SHIP_COLORS[key] || POP.grey;
  if (dim === "inst") return INSTALL_COLORS[key] || POP.grey;
  return TECH_COLORS[key] || POP.grey;
}

function Tip({ active, payload, label, suffix }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-edge bg-ink/95 px-3 py-2 font-mono text-xs shadow-xl">
      {label != null && <div className="mb-1 text-muted">{label}</div>}
      {payload
        .filter((p) => p.value)
        .map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color || p.fill }} />
            <span className="text-fg/90">{p.name}</span>
            <span className="ml-auto tabular-nums text-fg">
              {p.value}
              {suffix || ""}
            </span>
          </div>
        ))}
    </div>
  );
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
  return (
    <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((c) => (
        <button
          key={c}
          onClick={() => onPick(c)}
          className="flex items-center gap-1.5 text-[11px] transition"
          style={{ opacity: !hl || hl === c ? 1 : 0.4 }}
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFn(c) }} />
          <span className={hl === c ? "text-fg" : "text-muted"}>{c}</span>
        </button>
      ))}
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
}) {
  const { theme } = useTheme();
  const [dim, setDim] = useState("ship");
  const [metric, setMetric] = useState("devices");
  const [hl, setHl] = useState(null);

  // Surface the current highlight to the parent so the globe can show the
  // related dots (only technology highlights map to vessels).
  useEffect(() => {
    onHighlight && onHighlight(hl);
  }, [hl, onHighlight]);

  // Clear the cross-filter when this panel unmounts.
  useEffect(() => {
    return () => onHighlight && onHighlight(null);
  }, [onHighlight]);

  const cum = CUMULATIVE[dim];
  const market = marketSize(metric);
  const metricSuffix = metric === "dwt" ? "k t" : metric === "vessels" ? "" : " units";

  const AXIS = {
    fontFamily: "IBM Plex Mono, monospace",
    fontSize: 11,
    fill: theme === "dark" ? "#7d8aa3" : "#5d6b82",
  };
  const GRID = theme === "dark" ? "#16243a" : "#e6eaf1";

  const toggleHl = (name) => setHl((h) => (h === name ? null : name));
  // Opacity for a series/category: fade only within charts that contain hl.
  const op = (name, cats) => (!hl || !cats.includes(hl) ? 1 : name === hl ? 1 : FADE);

  const renderTile = (props) => {
    const { x, y, width, height, name, tech, size } = props;
    if (width <= 0 || height <= 0) return null;
    const fill = tech === "Other" ? POP.grey : techColor(tech);
    const o = !hl || !TECH_ORDER.includes(hl) ? 1 : tech === hl ? 1 : FADE;
    const showLabel = width > 54 && height > 26;
    return (
      <g style={{ cursor: "pointer" }} onClick={() => toggleHl(tech)}>
        <rect x={x} y={y} width={width} height={height} fill={fill} fillOpacity={o}
          stroke={theme === "dark" ? "#0a111b" : "#ffffff"} strokeWidth={2} rx={3} />
        {showLabel && (
          <>
            <text x={x + 8} y={y + 18} fill="#10202e" fillOpacity={o} fontSize={12} fontWeight={500}>
              {name}
            </text>
            <text x={x + 8} y={y + 33} fill="#10202e" fillOpacity={o * 0.7} fontSize={11}
              fontFamily="IBM Plex Mono, monospace">
              {size}
            </text>
          </>
        )}
      </g>
    );
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-ink scroll-thin">
      <div className={compact ? "px-4 py-5" : "mx-auto max-w-6xl px-6 py-8"}>
        {/* Header */}
        <div className="mb-6 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {onClose ? (
              <button onClick={onClose} className="font-mono text-xs text-muted transition hover:text-fg">
                ← back to globe
              </button>
            ) : (
              <Link href="/" className="font-mono text-xs text-muted transition hover:text-fg">
                ← windfleet
              </Link>
            )}
            <h1 className={`mt-2 font-mono font-medium lowercase tracking-tight text-fg ${compact ? "text-xl" : "text-2xl"}`}>
              fleet analytics
            </h1>
            {!compact && (
              <p className="mt-1 text-sm text-muted">
                The global wind-assisted propulsion fleet, in numbers
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {hl && (
              <button
                onClick={() => setHl(null)}
                className="rounded-md border border-edge/70 px-2.5 py-1 font-mono text-[11px] text-muted transition hover:text-fg"
              >
                clear: {hl} ✕
              </button>
            )}
            {/* Expand to full screen / collapse back to quarter width */}
            {compact && onExpand && (
              <button
                onClick={onExpand}
                aria-label="Expand analytics to full screen"
                title="Expand to full screen"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/70 text-muted transition hover:border-accent hover:text-fg"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                </svg>
              </button>
            )}
            {!compact && onCollapse && (
              <button
                onClick={onCollapse}
                aria-label="Collapse analytics to side panel"
                title="Collapse to side panel"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/70 text-muted transition hover:border-accent hover:text-fg"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 3H3v6M21 15v6h-6M3 3l7 7M21 21l-7-7" />
                </svg>
              </button>
            )}
            <ThemeToggle />
          </div>
        </div>

        {compact && (
          <p className="mb-4 text-[11px] leading-relaxed text-muted">
            Click any technology in a chart to spotlight its vessels on the globe.
          </p>
        )}

        {/* KPIs */}
        <div className={`mb-6 grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-6"}`}>
          <KPI value={KPIS.total} label="vessels" />
          <KPI value={KPIS.yoy != null ? `+${KPIS.yoy}%` : "—"} label={`yoy ${KPIS.yoyLabel}`} highlight />
          <KPI value={KPIS.devices} label="wind devices" />
          <KPI value={`${KPIS.retrofitPct}%`} label="retrofit" />
          <KPI value={KPIS.oems} label="OEMs" />
          <KPI value={KPIS.countries} label="OEM countries" />
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
          <LegendChips items={cum.keys} colorFn={(k) => colorFor(dim, k)} hl={hl} onPick={toggleHl} />
          <RibbonChart
            data={cum.data}
            cats={cum.keys}
            colorFn={(k) => colorFor(dim, k)}
            theme={theme}
            highlight={hl}
            onPick={toggleHl}
            partialYear={LAST_YEAR}
          />
          <p className="mt-2 text-[11px] text-muted">
            Cumulative fleet in service; column height is the running total. {LAST_YEAR} has a dotted outline — it is year-to-date and will keep growing.
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

        {/* Donut + tech split */}
        <div className={`mb-6 grid gap-6 ${compact ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-2"}`}>
          <Card title="Technology mix · vessels">
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={TECH_MIX}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={2}
                  stroke="transparent"
                  onClick={(d) => toggleHl(d.name)}
                >
                  {TECH_MIX.map((d) => (
                    <Cell
                      key={d.name}
                      fill={techColor(d.name)}
                      fillOpacity={op(d.name, TECH_ORDER)}
                      style={{ cursor: "pointer" }}
                    />
                  ))}
                </Pie>
                <Tooltip content={<Tip />} />
                <Legend
                  iconType="square"
                  layout="vertical"
                  align="right"
                  verticalAlign="middle"
                  wrapperStyle={{ fontSize: 11, cursor: "pointer" }}
                  onClick={(e) => toggleHl(e.value)}
                />
              </PieChart>
            </ResponsiveContainer>
          </Card>

          <Card title="Technology × retrofit / newbuild">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={TECH_INSTALL} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="tech" tick={AXIS} tickLine={false} axisLine={false} width={84} />
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

        {/* Market size */}
        <div className="mb-6">
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
                <YAxis type="category" dataKey="tech" tick={AXIS} tickLine={false} axisLine={false} width={84} />
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

        {/* OEM treemap */}
        <Card title="OEM landscape · tile area = installations, colour = technology" className="mb-10">
          <ResponsiveContainer width="100%" height={260}>
            <Treemap data={OEM_TREEMAP} dataKey="size" aspectRatio={3} content={renderTile} isAnimationActive={false} />
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
