"use client";

import { useEffect, useRef, useState } from "react";

// Everything credit-like lives here, in one place: basemap licence text (which
// MapLibre's own "i" used to show), data sources, and the feedback link.
const CREDITS = [
  {
    label: "Basemap",
    body: (
      <>
        ©{" "}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer" className="link">
          OpenStreetMap
        </a>{" "}
        contributors ·{" "}
        <a href="https://carto.com/attributions" target="_blank" rel="noopener noreferrer" className="link">
          CARTO
        </a>{" "}
        · MapLibre
      </>
    ),
  },
  { label: "Positions", body: <>Open Waters AIS</> },
  { label: "Wind", body: <>NOAA GFS (live) · ERA5 1995–2025 (average)</> },
  { label: "Routes", body: <>© Eurostat SeaRoute</> },
  { label: "Land mask", body: <>Natural Earth</> },
];

export default function InfoButton() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="absolute bottom-3 right-3 z-20 flex flex-col items-end gap-2">
      {open && (
        <div
          role="dialog"
          aria-label="About this map"
          className="w-72 rounded-xl border border-edge/60 bg-panel/95 p-4 text-xs shadow-xl backdrop-blur-md"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted">Sources</p>
          <dl className="mt-2 space-y-1.5">
            {CREDITS.map((c) => (
              <div key={c.label} className="flex gap-3">
                <dt className="w-16 shrink-0 text-muted">{c.label}</dt>
                <dd className="text-fg [&_.link]:underline [&_.link]:decoration-dotted [&_.link]:underline-offset-2 [&_.link:hover]:text-accent">
                  {c.body}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 border-t border-edge/60 pt-3">
            <a
              href="https://www.linkedin.com/in/thomas-steip/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-fg underline decoration-dotted underline-offset-2 transition hover:text-accent"
            >
              Feedback &amp; corrections welcome
            </a>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Sources and feedback"
        aria-expanded={open}
        className={`flex h-8 w-8 items-center justify-center rounded-full border font-mono text-xs font-semibold backdrop-blur-md transition ${
          open
            ? "border-accent bg-accent/15 text-fg"
            : "border-edge/60 bg-panel/80 text-muted hover:bg-panel hover:text-fg"
        }`}
      >
        i
      </button>
    </div>
  );
}
