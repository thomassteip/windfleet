"use client";

import { useEffect, useRef, useState } from "react";
import { niceTicks } from "@/lib/chart";

// Stacked ordered area / ribbon chart. Columns per year, segments ranked
// (largest on top) and connected across years by ribbons. Absolute values,
// so column height also reflects the annual total.
//
// Drawn at the container's real pixel width (measured), not scaled from a
// fixed canvas: in the ~330px side panel a scaled 820px drawing shrank its
// axis text to about 4px.
export default function RibbonChart({
  data, // [{ year, [cat]: value }]
  cats, // category keys
  colorFn, // (cat) => color
  theme = "dark",
  highlight = null,
  onPick = () => {},
  partialYear = null,
}) {
  const [hover, setHover] = useState(null);
  const boxRef = useRef(null);
  const [W, setW] = useState(820);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = Math.round(Math.min(320, Math.max(200, W * 0.39)));
  const ML = 34;
  const MR = 8;
  const MT = 16;
  const MB = 26;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;
  const baseline = MT + plotH;

  const axis = theme === "dark" ? "#7d8aa3" : "#5d6b82";
  const grid = theme === "dark" ? "#16243a" : "#e6eaf1";

  const totals = data.map((d) => cats.reduce((s, c) => s + (d[c] || 0), 0));
  const ticks = niceTicks(Math.max(...totals, 1), 5);
  const maxTotal = ticks[ticks.length - 1];
  const scale = plotH / maxTotal;

  const n = data.length;
  const slot = plotW / n;
  // Narrow slots get proportionally wider bars, or they vanish into slivers.
  const bw = Math.min(34, slot * (slot < 30 ? 0.55 : 0.32));
  const xCenter = (i) => ML + (i + 0.5) * slot;
  // Year labels: full when there's room, '24 when tight, every other year when
  // even that collides. The newest year is always labelled.
  const shortYears = slot < 36;
  const labelEvery = slot < 20 ? 2 : 1;
  const showYear = (i) => (n - 1 - i) % labelEvery === 0;

  // Per year: ranked segments (largest on top) with y bounds.
  const layout = data.map((d, i) => {
    const ranked = cats
      .map((c) => ({ cat: c, value: d[c] || 0 }))
      .filter((s) => s.value > 0)
      .sort((a, b) => b.value - a.value);
    let y = baseline - totals[i] * scale; // top of column
    const segs = {};
    ranked.forEach((s) => {
      const h = s.value * scale;
      segs[s.cat] = { y0: y, y1: y + h, value: s.value };
      y += h;
    });
    return segs;
  });

  // Fade only when the highlight is one of THIS chart's categories — a
  // technology picked elsewhere must not grey out a ship-type chart entirely.
  const inChart = highlight != null && cats.includes(highlight);
  const opOf = (cat) => (!inChart ? 1 : cat === highlight ? 1 : 0.12);
  const isPartial = (i) => partialYear && data[i].year === partialYear;
  const fgStroke = theme === "dark" ? "#e6ecf5" : "#16202e";

  const ribbons = [];
  for (let i = 0; i < n - 1; i++) {
    const touchesPartial = isPartial(i) || isPartial(i + 1);
    cats.forEach((c) => {
      const a = layout[i][c];
      const b = layout[i + 1][c];
      if (!a || !b) return;
      const xR = xCenter(i) + bw / 2;
      const xL = xCenter(i + 1) - bw / 2;
      const cx = (xR + xL) / 2;
      const d = `M ${xR} ${a.y0} C ${cx} ${a.y0}, ${cx} ${b.y0}, ${xL} ${b.y0}
                 L ${xL} ${b.y1} C ${cx} ${b.y1}, ${cx} ${a.y1}, ${xR} ${a.y1} Z`;
      ribbons.push(
        <path
          key={`r-${i}-${c}`}
          d={d}
          fill={colorFn(c)}
          fillOpacity={(touchesPartial ? 0.16 : 0.34) * opOf(c)}
          stroke={touchesPartial ? colorFn(c) : "none"}
          strokeOpacity={touchesPartial ? 0.55 * opOf(c) : 0}
          strokeDasharray={touchesPartial ? "3 3" : undefined}
          strokeWidth={touchesPartial ? 1 : 0}
        />
      );
    });
  }

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block", maxWidth: "100%" }}>
        {/* gridlines */}
        {ticks.map((t) => {
          const y = baseline - t * scale;
          return (
            <g key={t}>
              <line x1={ML} y1={y} x2={W - MR} y2={y} stroke={grid} />
              <text x={ML - 6} y={y + 3} textAnchor="end" fontSize="10" fill={axis} fontFamily="IBM Plex Mono, monospace">
                {t}
              </text>
            </g>
          );
        })}

        {ribbons}

        {/* columns */}
        {data.map((d, i) => (
          <g key={d.year}>
            {cats.map((c) => {
              const seg = layout[i][c];
              if (!seg) return null;
              const isHover = hover && hover.year === d.year && hover.cat === c;
              const partial = isPartial(i);
              return (
                <rect
                  key={c}
                  x={xCenter(i) - bw / 2}
                  y={seg.y0}
                  width={bw}
                  height={seg.y1 - seg.y0}
                  fill={colorFn(c)}
                  fillOpacity={opOf(c) * (partial ? 0.4 : 1)}
                  stroke={partial ? fgStroke : isHover ? fgStroke : "transparent"}
                  strokeOpacity={partial ? 0.85 * opOf(c) : 1}
                  strokeDasharray={partial ? "2 2" : undefined}
                  strokeWidth={partial ? 1.2 : isHover ? 1 : 0}
                  rx={1.5}
                  style={{ cursor: "pointer" }}
                  onClick={() => onPick(c)}
                  onMouseEnter={() => setHover({ year: d.year, cat: c, value: seg.value })}
                  onMouseLeave={() => setHover(null)}
                />
              );
            })}
            {showYear(i) && (
              <text
                x={xCenter(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize="10"
                fill={axis}
                fontFamily="IBM Plex Mono, monospace"
              >
                {shortYears ? `'${d.year.slice(2)}` : d.year}
              </text>
            )}
            {partialYear && d.year === partialYear && (
              <text x={xCenter(i)} y={MT + 10} textAnchor="middle" fontSize="9" fill={axis}>
                YTD
              </text>
            )}
          </g>
        ))}
      </svg>

      {hover && (
        <div
          style={{
            position: "absolute",
            top: 6,
            left: 44,
            pointerEvents: "none",
          }}
          className="rounded-lg border border-edge bg-ink/95 px-3 py-2 font-mono text-xs"
        >
          <div className="text-muted">{hover.year}</div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: colorFn(hover.cat) }} />
            <span className="text-fg/90">{hover.cat}</span>
            <span className="ml-2 tabular-nums text-fg">{hover.value}</span>
          </div>
        </div>
      )}
    </div>
  );
}
