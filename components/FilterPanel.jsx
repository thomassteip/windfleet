"use client";

import { TECH_ORDER, techColor } from "@/lib/theme";

function Chip({ label, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition
        ${
          active
            ? "border-edge bg-edge/60 text-fg"
            : "border-edge/50 text-muted hover:text-fg hover:border-edge"
        }`}
    >
      {color && (
        <span
          className="h-2.5 w-2.5 rounded-full"
          style={{ background: color, opacity: active ? 1 : 0.4 }}
        />
      )}
      {label}
    </button>
  );
}

export default function FilterPanel({
  techs,
  types,
  installTypes,
  filters,
  setFilters,
  yearRange,
  counts,
}) {
  const toggle = (key, value) => {
    setFilters((f) => {
      const set = new Set(f[key]);
      set.has(value) ? set.delete(value) : set.add(value);
      return { ...f, [key]: set };
    });
  };

  const reset = () =>
    setFilters({
      techs: new Set(),
      types: new Set(),
      installTypes: new Set(),
    });

  const activeCount =
    filters.techs.size + filters.types.size + filters.installTypes.size;

  return (
    <div className="scroll-thin pointer-events-auto flex min-h-0 w-full flex-col gap-5 overflow-y-auto rounded-2xl border border-edge/60 bg-panel/80 p-5 backdrop-blur-md md:w-72">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">
          Filters
        </h2>
        {activeCount > 0 && (
          <button
            onClick={reset}
            className="text-[11px] text-accent hover:underline"
          >
            Reset ({activeCount})
          </button>
        )}
      </div>

      <Section title="WAPS technology">
        <div className="flex flex-wrap gap-2">
          {TECH_ORDER.filter((t) => techs.includes(t)).map((t) => (
            <Chip
              key={t}
              label={`${t} (${counts.tech[t] || 0})`}
              color={techColor(t)}
              active={filters.techs.has(t)}
              onClick={() => toggle("techs", t)}
            />
          ))}
        </div>
      </Section>

      <Section title="Vessel type">
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <Chip
              key={t}
              label={t}
              active={filters.types.has(t)}
              onClick={() => toggle("types", t)}
            />
          ))}
        </div>
      </Section>

      <Section title="Installation">
        <div className="flex flex-wrap gap-2">
          {installTypes.map((t) => (
            <Chip
              key={t}
              label={t}
              active={filters.installTypes.has(t)}
              onClick={() => toggle("installTypes", t)}
            />
          ))}
        </div>
      </Section>

    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-2.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted/80">
        {title}
      </h3>
      {children}
    </div>
  );
}
