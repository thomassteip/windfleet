// Pure data aggregations for the analytics page.
//
// IMPORTANT: everything here is a function of the fleet you pass in. The globe
// reads the live fleet from Supabase, so the dashboard must aggregate that SAME
// array — otherwise the two views silently disagree (this is exactly how the
// map once showed 104 vessels while the KPI said 102). Never import
// data/vessels.json here; that snapshot is only the offline fallback, and
// lib/data.js already owns that decision.
import { FALLBACK_VESSELS } from "@/lib/data";
import { TECH_ORDER } from "./theme";

const num = (x) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// Static ordering constants — independent of the data.
export const SHIP_ORDER = [
  "Tanker",
  "Bulk Carrier",
  "General Cargo",
  "Ro-Ro / Ropax",
  "Other",
];
export const INSTALL_ORDER = ["Newbuild", "Retrofit"];

// Ship-type buckets used by the "by ship type" charts. Exported because the
// globe cross-filter has to reproduce the SAME bucketing to know which vessels
// a clicked band ("Bulk Carrier", "Other", …) stands for.
export const shipBucket = (t) => {
  if (t === "Ro-Ro" || t === "Ropax") return "Ro-Ro / Ropax";
  if (["Tanker", "Bulk Carrier", "General Cargo"].includes(t)) return t;
  return "Other";
};

/**
 * Build every aggregation the dashboard needs from one fleet array.
 * @param {Array} fleet vessels in the camelCase shape lib/data.js produces
 */
export function buildAnalytics(fleet) {
  const V = (fleet || []).map((v) => ({
    ...v,
    installedYear: num(v.installedYear),
    builtYear: num(v.builtYear),
    units: num(v.units) || 1,
    dwt: num(v.dwt),
  }));

  const TOTAL = V.length;

  const YEARS = [...new Set(V.map((v) => v.installedYear).filter(Boolean))].sort(
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

  const CUMULATIVE = {
    ship: { keys: SHIP_ORDER, data: cumulativeBy((v) => shipBucket(v.type), SHIP_ORDER) },
    tech: { keys: TECH_ORDER, data: cumulativeBy((v) => v.technology, TECH_ORDER) },
    inst: {
      keys: INSTALL_ORDER,
      data: cumulativeBy((v) => v.installType, INSTALL_ORDER),
    },
  };

  // --- Installations per year, stacked by install type ---
  const INSTALLS_PER_YEAR = YEARS.map((y) => ({
    year: String(y),
    Newbuild: V.filter((v) => v.installedYear === y && v.installType === "Newbuild")
      .length,
    Retrofit: V.filter((v) => v.installedYear === y && v.installType === "Retrofit")
      .length,
  }));

  // --- Annual installations per technology (non-cumulative), for the ribbon chart ---
  const INSTALLS_BY_TECH = YEARS.map((y) => {
    const row = { year: String(y) };
    TECH_ORDER.forEach((t) => {
      row[t] = V.filter((v) => v.installedYear === y && v.technology === t).length;
    });
    return row;
  });

  // The most recent year is in progress (year-to-date), so its totals undercount.
  const LAST_YEAR = YEARS.length ? String(YEARS[YEARS.length - 1]) : null;

  // --- Technology mix (vessels) ---
  const TECH_MIX = TECH_ORDER.map((t) => ({
    name: t,
    value: V.filter((v) => v.technology === t).length,
  })).filter((d) => d.value > 0);

  // --- Technology x install type ---
  const TECH_INSTALL = TECH_ORDER.map((t) => ({
    tech: t,
    Newbuild: V.filter((v) => v.technology === t && v.installType === "Newbuild").length,
    Retrofit: V.filter((v) => v.technology === t && v.installType === "Retrofit").length,
  })).filter((d) => d.Newbuild + d.Retrofit > 0);

  // --- OEM landscape (treemap): size = installs, plus dominant technology ---
  const OEM_TREEMAP = (() => {
    const map = {};
    V.forEach((v) => {
      const name = v.oem && v.oem !== "None" ? v.oem : "Other";
      if (!map[name]) map[name] = { name, size: 0, tech: {} };
      map[name].size += 1;
      map[name].tech[v.technology] = (map[name].tech[v.technology] || 0) + 1;
    });
    const rows = Object.values(map).map((d) => {
      const top = Object.entries(d.tech).sort((a, b) => b[1] - a[1])[0];
      return { name: d.name, size: d.size, tech: top ? top[0] : "Other" };
    });
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
  function marketSize(metric) {
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
  const KPIS = (() => {
    const lastY = YEARS.length ? YEARS[YEARS.length - 1] : null;
    const byYear = (y) => V.filter((v) => v.installedYear === y).length;
    const prev = lastY ? byYear(lastY - 2) : 0;
    const cur = lastY ? byYear(lastY - 1) : 0;
    const yoy = prev ? Math.round(((cur - prev) / prev) * 100) : null;
    return {
      total: TOTAL,
      yoy,
      yoyLabel: lastY ? `${String(lastY - 2).slice(2)}→${String(lastY - 1).slice(2)}` : "",
      devices: V.reduce((s, v) => s + v.units, 0),
      retrofitPct: TOTAL
        ? Math.round((V.filter((v) => v.installType === "Retrofit").length / TOTAL) * 100)
        : 0,
      oems: new Set(
        V.map((v) => (v.oem && v.oem !== "None" ? v.oem : null)).filter(Boolean)
      ).size,
      countries: new Set(V.map((v) => v.oemCountry).filter(Boolean)).size,
    };
  })();

  return {
    TOTAL,
    YEARS,
    CUMULATIVE,
    INSTALLS_PER_YEAR,
    INSTALLS_BY_TECH,
    LAST_YEAR,
    TECH_MIX,
    TECH_INSTALL,
    OEM_TREEMAP,
    marketSize,
    KPIS,
    SHIP_ORDER,
    INSTALL_ORDER,
  };
}

// Offline/first-paint aggregation, from the bundled snapshot. The dashboard
// replaces this as soon as the live fetch resolves.
export const FALLBACK_ANALYTICS = buildAnalytics(FALLBACK_VESSELS);
