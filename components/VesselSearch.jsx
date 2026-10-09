"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { techColor } from "@/lib/theme";

// Lowercase and drop everything that isn't a letter or digit, so "Ilha de
// Tinhare", "ilha-de-tinhare" and "ilhadetinhare" all compare equal.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Lower score = better match. null = no match.
function score(v, q, qn, qDigits) {
  const name = norm(v.name);
  if (qn) {
    if (name === qn) return 0;
    if (name.startsWith(qn)) return 1;
    // Match at the start of any word ("tinhare" finds "Ilha de Tinhare").
    const words = String(v.name ?? "").toLowerCase().split(/[^a-z0-9]+/);
    if (words.some((w) => w.startsWith(qn))) return 2;
    if (name.includes(qn)) return 3;
  }
  if (qDigits.length >= 3) {
    const imo = String(v.imo ?? "");
    const mmsi = String(v.mmsi ?? "");
    if (imo === qDigits || mmsi === qDigits) return 0;
    if (imo.startsWith(qDigits) || mmsi.startsWith(qDigits)) return 2;
    if (imo.includes(qDigits) || mmsi.includes(qDigits)) return 4;
  }
  return null;
}

// Header search: find a ship by name, IMO or MMSI. Picking a result hands the
// vessel to `onPick`; FleetExplorer selects it, which opens the card and makes
// the globe fly there.
export default function VesselSearch({ vessels, onPick, className = "" }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const boxRef = useRef(null);

  const results = useMemo(() => {
    const qn = norm(query);
    const qDigits = query.replace(/\D/g, "");
    if (!qn) return [];
    return vessels
      .map((v) => [v, score(v, query, qn, qDigits)])
      .filter(([, s]) => s !== null)
      .sort((a, b) => a[1] - b[1] || String(a[0].name).localeCompare(String(b[0].name)))
      .slice(0, 8)
      .map(([v]) => v);
  }, [vessels, query]);

  useEffect(() => setActive(0), [query]);

  // "/" focuses the box from anywhere (unless you're already typing somewhere).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Click outside closes the list.
  useEffect(() => {
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const pick = (v) => {
    onPick(v);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e) => {
    if (e.key === "Escape") {
      if (query) setQuery("");
      else {
        setOpen(false);
        inputRef.current?.blur();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      pick(results[active]);
    }
  };

  const showList = open && query.trim() !== "";

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="flex items-center gap-2 rounded-xl border border-edge/60 bg-panel/70 px-3 py-2 backdrop-blur-md focus-within:border-accent">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="shrink-0 text-muted"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls="vessel-search-list"
          aria-label="Search vessels by name, IMO or MMSI"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search name, IMO or MMSI"
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-xs text-fg placeholder:text-muted/70 focus:outline-none"
        />
        <kbd className="hidden rounded border border-edge/70 px-1.5 font-mono text-[10px] text-muted md:block">
          /
        </kbd>
      </div>

      {showList && (
        <ul
          id="vessel-search-list"
          role="listbox"
          className="scroll-thin absolute left-0 right-0 top-full mt-2 max-h-80 overflow-y-auto rounded-xl border border-edge/60 bg-panel/95 p-1 shadow-xl backdrop-blur-md"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-muted">No vessel found</li>
          ) : (
            results.map((v, i) => (
              <li
                key={v.id}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(v)}
                className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 ${
                  i === active ? "bg-accent/15" : ""
                }`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: techColor(v.technology) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-fg">{v.name}</span>
                  <span className="block truncate text-[11px] text-muted">
                    {v.technology} · {v.type}
                  </span>
                </span>
                <span className="shrink-0 text-right font-mono text-[10px] tabular-nums text-muted">
                  {v.imo ? `IMO ${v.imo}` : "no IMO"}
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
