// Pure data aggregations for the analytics page, derived from vessels.json.
import vessels from "@/data/vessels.json";
import { TECH_ORDER } from "./theme";

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

const V = vessels.map((v) => ({
  ...v,
  installedYear: num(v.installedYear),
  builtYear: num(v.builtYear),
  units: num(v.units) || 1,
  dwt: num(v.dwt),
}));

export const TOTAL = V.length;

export const SHIP_ORDER = [
  "Tanker",
  "Bulk Carrier",
  "General Cargo",
  "Ro-Ro / Ropax",
  "Other",
];
export const INSTALL_ORDER = ["Newbuild", "Retrofit"];

const shipBucket = (t) => {
  if (t === "Ro-Ro" || t === "Ropax") return "Ro-Ro / Ropax";
  if (["Tanker", "Bulk Carrier", "General Cargo"].includes(t)) return t;
  return "Other";
};

export const YEARS = [...new Set(V.map((v) => v.installedYear).filter(Boolean))].sort(
  (a, b) => a - b
);

// --- Cumulative stacked series keyed by a chosen dimension ---
function cumulativeBy(getCat, categories) {
  return YEARS.map((y) => {
    const row = { year: String(y) };
    categories.forEach((c) => {
      row[c] = V.filter(
        (v) => getCat(v) === c && v.installedYear && v.installedYear <= y
      ).length;
    });
    return row;
  });
}

export const CUMULATIVE = {
  ship: { keys: SHIP_ORDER, data: cumulativeBy((v) => shipBucket(v.type), SHIP_ORDER) },
  tech: { keys: TECH_ORDER, data: cumulativeBy((v) => v.technology, TECH_ORDER) },
  inst: {
    keys: INSTALL_ORDER,
    data: cumulativeBy((v) => v.installType, INSTALL_ORDER),
  },
};

// --- Installations per year, stacked by install type ---
export const INSTALLS_PER_YEAR = YEARS.map((y) => ({
  year: String(y),
  Newbuild: V.filter((v) => v.installedYear === y && v.installType === "Newbuild").length,
  Retrofit: V.filter((v) => v.installedYear === y && v.installType === "Retrofit").length,
}));

// --- Annual installations per technology (non-cumulative), for the ribbon chart ---
export const INSTALLS_BY_TECH = YEARS.map((y) => {
  const row = { year: String(y) };
  TECH_ORDER.forEach((t) => {
    row[t] = V.filter((v) => v.installedYear === y && v.technology === t).length;
  });
  return row;
});

// The most recent year is in progress (year-to-date), so its totals undercount.
export const LAST_YEAR = String(YEARS[YEARS.length - 1]);

// --- Technology mix (vessels) ---
export const TECH_MIX = TECH_ORDER.map((t) => ({
  name: t,
  value: V.filter((v) => v.technology === t).length,
})).filter((d) => d.value > 0);

// --- Technology x install type ---
export const TECH_INSTALL = TECH_ORDER.map((t) => ({
  tech: t,
  Newbuild: V.filter((v) => v.technology === t && v.installType === "Newbuild").length,
  Retrofit: V.filter((v) => v.technology === t && v.installType === "Retrofit").length,
})).filter((d) => d.Newbuild + d.Retrofit > 0);

// --- OEM landscape (treemap): size = installs, plus dominant technology ---
export const OEM_TREEMAP = (() => {
  const map = {};
  V.forEach((v) => {
    const name = v.oem && v.oem !== "None" ? v.oem : "Other";
    if (!map[name]) map[name] = { name, size: 0, tech: {} };
    map[name].size += 1;
    map[name].tech[v.technology] = (map[name].tech[v.technology] || 0) + 1;
  });
  const rows = Object.values(map).map((d) => ({
    name: d.name,
    size: d.size,
    tech: Object.entries(d.tech).sort((a, b) => b[1] - a[1])[0][0],
  }));
  // Fold singletons into one "Other" tile to keep the map legible.
  const big = rows.filter((d) => d.size >= 2 && d.name !== "Other");
  const smallSize = rows
    .filter((d) => d.size < 2 || d.name === "Other")
    .reduce((s, d) => s + d.size, 0);
  big.sort((a, b) => b.size - a.size);
  if (smallSize) big.push({ name: "Other", size: smallSize, tech: "Other" });
  return big;
})();

// --- Market size per technology (toggleable metric) ---
export function marketSize(metric) {
  return TECH_ORDER.map((t) => {
    const set = V.filter((v) => v.technology === t);
    let value;
    if (metric === "vessels") value = set.length;
    else if (metric === "dwt")
      value = Math.round(set.reduce((s, v) => s + (v.dwt || 0), 0) / 1000);
    else value = set.reduce((s, v) => s + v.units, 0); // devices
    return { tech: t, value };
  }).filter((d) => d.value > 0);
}

// --- Headline KPIs ---
export const KPIS = (() => {
  const lastY = YEARS[YEARS.length - 1];
  const byYear = (y) => V.filter((v) => v.installedYear === y).length;
  const prev = byYear(lastY - 2);
  const cur = byYear(lastY - 1);
  const yoy = prev ? Math.round(((cur - prev) / prev) * 100) : null;
  return {
    total: TOTAL,
    yoy,
    yoyLabel: `${String(lastY - 2).slice(2)}→${String(lastY - 1).slice(2)}`,
    devices: V.reduce((s, v) => s + v.units, 0),
    retrofitPct: Math.round(
      (V.filter((v) => v.installType === "Retrofit").length / TOTAL) * 100
    ),
    oems: new Set(V.map((v) => (v.oem && v.oem !== "None" ? v.oem : null)).filter(Boolean))
      .size,
    countries: new Set(V.map((v) => v.oemCountry).filter(Boolean)).size,
  };
})();
