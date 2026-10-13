"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FALLBACK_VESSELS, fetchVessels } from "@/lib/data";
import {
  FIELDS,
  FIELD_GROUPS,
  DEFAULT_COLUMNS,
  FILTER_PARAMS,
  SOURCE_LINE,
  LICENCE,
  fieldLabel,
  filterVessels,
  isBlank,
  needsVerify,
  toCSV,
  toRecords,
} from "@/lib/fields";
import { TECH_ORDER, techColor } from "@/lib/theme";
import PanelBar from "@/components/PanelBar";

const FIELD_BY_KEY = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

// Which filters get a chip row in the toolbar. OEM and flag are still
// filterable through the URL/API, but have too many values for chips.
const CHIP_FILTERS = [
  { param: "technology", label: "Technology" },
  { param: "type", label: "Ship type" },
  { param: "installType", label: "Install" },
];

// ---- URL state: the whole view (filters, search, sort, columns) lives in the
// query string, so any table view can be bookmarked or sent to a colleague, and
// the same params work on /api/v1/vessels. ----

function readUrl() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const filters = {};
  for (const k of Object.keys(FILTER_PARAMS)) {
    const vals = p.getAll(k).filter(Boolean);
    if (vals.length) filters[k] = vals;
  }
  const cols = p.get("cols");
  return {
    filters,
    q: p.get("q") || "",
    sort: p.get("sort") || "installedYear",
    dir: p.get("dir") === "asc" ? "asc" : "desc",
    cols: cols ? cols.split(",").filter((k) => FIELD_BY_KEY[k]) : null,
  };
}

function filterQuery(filters, q) {
  const p = new URLSearchParams();
  for (const [k, vals] of Object.entries(filters)) vals.forEach((v) => p.append(k, v));
  if (q) p.set("q", q);
  return p;
}

function writeUrl({ filters, q, sort, dir, cols }) {
  const p = filterQuery(filters, q);
  if (sort !== "installedYear" || dir !== "desc") {
    p.set("sort", sort);
    p.set("dir", dir);
  }
  if (cols.join(",") !== DEFAULT_COLUMNS.join(",")) p.set("cols", cols.join(","));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

// ---- Sorting: blanks always sink to the bottom, whichever direction. ----
function compare(a, b, field, dir) {
  const av = a[field.key];
  const bv = b[field.key];
  const ab = isBlank(av);
  const bb = isBlank(bv);
  if (ab || bb) return ab === bb ? 0 : ab ? 1 : -1;
  const n = field.type === "number" || field.type === "year";
  const c = n ? Number(av) - Number(bv) : String(av).localeCompare(String(bv));
  return dir === "asc" ? c : -c;
}

function formatCell(v, field) {
  if (isBlank(v)) return null;
  if (field.type === "number") {
    const n = Number(v);
    if (field.key === "lat" || field.key === "lng") return n.toFixed(3);
    return Number.isFinite(n) ? n.toLocaleString("en-US") : v;
  }
  if (field.type === "date") return String(v).slice(0, 10);
  return String(v);
}

function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Small popover that closes on outside click.
function Menu({ label, children, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition ${
          open ? "border-accent text-fg" : "border-edge/70 text-muted hover:text-fg"
        }`}
      >
        {label}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          className={`scroll-thin absolute top-full z-30 mt-2 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-edge bg-panel p-3 shadow-2xl ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
        active ? "border-edge bg-edge/60 text-fg" : "border-edge/50 text-muted hover:border-edge hover:text-fg"
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ background: color, opacity: active ? 1 : 0.45 }} />}
      {label}
    </button>
  );
}

// The Data panel: every vessel and every field as a table, with export.
// Rendered by FleetExplorer, which hands down its live fleet (THE RULE in
// CLAUDE.md: one fleet for the globe, the charts and this table). Only if it's
// ever rendered without one does it fetch for itself.
export default function DataTable({ vessels: given, onClose, onSelectVessel }) {
  const [own, setOwn] = useState(null);
  const vessels = given || own || FALLBACK_VESSELS;
  const live = !!(given || own);
  const [filters, setFilters] = useState({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("installedYear");
  const [dir, setDir] = useState("desc");
  const [cols, setCols] = useState(DEFAULT_COLUMNS);
  const [ready, setReady] = useState(false);

  // Restore the view from the URL once, then load the live fleet.
  useEffect(() => {
    const u = readUrl();
    setFilters(u.filters || {});
    setQ(u.q || "");
    setSort(u.sort || "installedYear");
    setDir(u.dir || "desc");
    if (u.cols && u.cols.length) setCols(u.cols);
    setReady(true);
  }, []);

  useEffect(() => {
    if (given) return undefined;
    let active = true;
    fetchVessels().then((data) => {
      if (active && data) setOwn(data);
    });
    return () => {
      active = false;
    };
  }, [given]);

  useEffect(() => {
    if (ready) writeUrl({ filters, q, sort, dir, cols });
  }, [ready, filters, q, sort, dir, cols]);

  const options = useMemo(() => {
    const uniq = (key) => [...new Set(vessels.map((v) => v[key]).filter((x) => !isBlank(x)))].sort();
    return {
      technology: TECH_ORDER.filter((t) => vessels.some((v) => v.technology === t)),
      type: uniq("type"),
      installType: uniq("installType"),
    };
  }, [vessels]);

  const rows = useMemo(() => {
    const field = FIELD_BY_KEY[sort] || FIELD_BY_KEY.installedYear;
    return filterVessels(vessels, { filters, q }).sort((a, b) => compare(a, b, field, dir));
  }, [vessels, filters, q, sort, dir]);

  const visible = cols.map((k) => FIELD_BY_KEY[k]).filter(Boolean);
  const activeFilters = Object.values(filters).reduce((n, v) => n + v.length, 0) + (q ? 1 : 0);

  const toggleFilter = (param, value) =>
    setFilters((f) => {
      const cur = f[param] || [];
      const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
      const out = { ...f };
      if (next.length) out[param] = next;
      else delete out[param];
      return out;
    });

  const clickHeader = (key) => {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(key);
      const t = FIELD_BY_KEY[key].type;
      setDir(t === "text" ? "asc" : "desc");
    }
  };

  const toggleCol = (key) =>
    setCols((c) =>
      c.includes(key) ? (c.length > 1 ? c.filter((k) => k !== key) : c) : FIELDS.map((f) => f.key).filter((k) => k === key || c.includes(k))
    );

  const stamp = new Date().toISOString().slice(0, 10);
  const exportCsv = (keys) => download(`windfleet-vessels-${stamp}.csv`, toCSV(rows, keys), "text/csv;charset=utf-8");
  const exportJson = (keys) =>
    download(
      `windfleet-vessels-${stamp}.json`,
      JSON.stringify({ source: SOURCE_LINE, licence: `${LICENCE.name} ${LICENCE.url}`, exported: new Date().toISOString(), count: rows.length, data: toRecords(rows, keys) }, null, 2),
      "application/json"
    );

  return (
    <div className="flex h-full w-full flex-col bg-ink">
      {/* Header: the same top bar as every panel */}
      <div className="border-b border-edge/60 px-4 pb-4 pt-5 sm:px-6">
        <PanelBar onClose={onClose} closeLabel="Close data" />
        <h1 className="font-mono text-2xl font-medium lowercase tracking-tight text-fg">fleet data</h1>
        <p className="mt-1 text-sm text-muted">Every wind-assisted vessel, every field. Sort, filter, export.</p>

        {/* Toolbar */}
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 basis-full sm:max-w-xs sm:flex-1 sm:basis-auto">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, IMO, maker, owner…"
              className="w-full rounded-lg border border-edge/70 bg-panel/60 px-3 py-2 text-xs text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
            />
          </div>
          <Menu label="Columns">
            {() => (
              <div className="flex flex-col gap-3">
                <div className="flex justify-between text-[11px]">
                  <button className="text-muted hover:text-fg" onClick={() => setCols(DEFAULT_COLUMNS)}>
                    Default
                  </button>
                  <button className="text-muted hover:text-fg" onClick={() => setCols(FIELDS.map((f) => f.key))}>
                    Show all
                  </button>
                </div>
                {FIELD_GROUPS.map((g) => (
                  <div key={g}>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted">{g}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {FIELDS.filter((f) => f.group === g).map((f) => (
                        <Chip key={f.key} label={f.label} active={cols.includes(f.key)} onClick={() => toggleCol(f.key)} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Menu>
          <Menu label="Export">
            {(close) => (
              <div className="flex flex-col text-xs">
                <p className="mb-2 text-[11px] leading-relaxed text-muted">
                  Exports the <span className="text-fg">{rows.length}</span> rows in the current view.
                </p>
                {[
                  ["CSV · visible columns", () => exportCsv(cols)],
                  ["CSV · all columns", () => exportCsv(null)],
                  ["JSON · all columns", () => exportJson(null)],
                ].map(([label, fn]) => (
                  <button
                    key={label}
                    onClick={() => {
                      fn();
                      close();
                    }}
                    className="rounded-md px-2 py-2 text-left text-fg/90 transition hover:bg-edge/50"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </Menu>
          <div className="ml-auto font-mono text-xs tabular-nums text-muted">
            <span className="text-fg">{rows.length}</span> / {vessels.length} vessels
            {!live && <span className="ml-2 text-muted/60">(snapshot)</span>}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {CHIP_FILTERS.map(({ param, label }) => (
            <div key={param} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-widest text-muted">{label}</span>
              {options[param].map((v) => (
                <Chip
                  key={v}
                  label={v}
                  color={param === "technology" ? techColor(v) : null}
                  active={(filters[param] || []).includes(v)}
                  onClick={() => toggleFilter(param, v)}
                />
              ))}
            </div>
          ))}
          {(filters.oem || []).map((m) => (
            <div key={m} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 shrink-0 text-[10px] uppercase tracking-widest text-muted">Maker</span>
              <Chip label={`${m}  ✕`} active onClick={() => toggleFilter("oem", m)} />
            </div>
          ))}
          {activeFilters > 0 && (
            <button
              onClick={() => {
                setFilters({});
                setQ("");
              }}
              className="self-start text-[11px] text-muted underline decoration-dotted underline-offset-2 hover:text-fg"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table — scrolls on its own, both axes, so the page never scrolls sideways */}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {visible.map((f) => {
                const num = f.type !== "text";
                const active = sort === f.key;
                return (
                  <th
                    key={f.key}
                    className={`sticky top-0 z-10 whitespace-nowrap border-b border-edge/60 bg-ink px-3 py-2.5 font-medium ${
                      num ? "text-right" : "text-left"
                    } ${f.key === "name" ? "left-0 z-20" : ""}`}
                  >
                    <button
                      onClick={() => clickHeader(f.key)}
                      className={`inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] transition ${
                        active ? "text-fg" : "text-muted hover:text-fg"
                      }`}
                    >
                      {fieldLabel(f)}
                      <span className={active ? "opacity-100" : "opacity-0"}>{dir === "asc" ? "↑" : "↓"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="group">
                {visible.map((f) => {
                  const val = formatCell(v[f.key], f);
                  const num = f.type !== "text";
                  const base = `border-b border-edge/30 px-3 py-2 group-hover:bg-panel/70 ${
                    num ? "text-right font-mono tabular-nums" : ""
                  }`;
                  if (f.key === "name") {
                    return (
                      <td key={f.key} className={`${base} sticky left-0 whitespace-nowrap bg-ink`}>
                        <span className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: techColor(v.technology) }} />
                          {v.lat != null && onSelectVessel ? (
                            <button
                              onClick={() => onSelectVessel(v)}
                              title="Show on globe"
                              className="font-medium text-fg hover:underline hover:decoration-dotted hover:underline-offset-2"
                            >
                              {val}
                            </button>
                          ) : (
                            <span className="font-medium text-fg">{val}</span>
                          )}
                          {needsVerify(v) && (
                            <span
                              title="Some fields on this vessel are not yet confirmed"
                              className="rounded border border-edge/70 px-1 font-mono text-[9px] uppercase tracking-wider text-muted"
                            >
                              verify
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={f.key}
                      className={`${base} ${f.key === "notes" ? "min-w-[18rem] max-w-md text-muted" : "whitespace-nowrap"} ${
                        val == null ? "text-muted/40" : "text-fg/85"
                      }`}
                    >
                      {val ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted">No vessels match these filters.</p>}
      </div>

      <div className="border-t border-edge/60 px-4 py-2.5 text-[10px] leading-relaxed text-muted/70 sm:px-6">
        {SOURCE_LINE}. Free to reuse under{" "}
        <a href={LICENCE.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-fg">
          {LICENCE.name}
        </a>
        , with credit to WindFleet. Blank means unknown, not zero.{" "}
        <a
          href="https://www.linkedin.com/in/thomas-steip/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-2 hover:text-fg"
        >
          Corrections welcome
        </a>
      </div>
    </div>
  );
}
