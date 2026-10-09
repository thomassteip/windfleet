"use client";

// Recharts tooltip in the app's style (mono numbers, theme surfaces). Shared by
// the analytics dashboard and the maker panel so their tooltips match.
export default function ChartTip({ active, payload, label, suffix }) {
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
            <span className="ml-auto pl-3 tabular-nums text-fg">
              {p.value}
              {suffix || ""}
            </span>
          </div>
        ))}
    </div>
  );
}
