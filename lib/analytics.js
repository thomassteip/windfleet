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

// The OEM column uses placeholder values for "no maker" — "None" on most rows,
// "na" on the traditional-sail rows (rigs built by the owner or a sailmaker).
// Every place that counts or lists makers goes through this one check, so a
// placeholder can never show up as a company.
const NO_MAKER = new Set(["", "none", "na", "n/a", "-", "unknown"]);
export const hasMaker = (oem) =>
  typeof oem === "string" && !NO_MAKER.has(oem.trim().toLowerCase());

// URL slug for a maker page: "MOL & Oshima" -> "mol-oshima". Every link to a
// maker is built with this, so the links and the pages can't drift apart.
export const makerSlug = (name) =>
  String(name)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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
      const name = hasMaker(v.oem) ? v.oem : "Other";
      if (!map[name]) map[name] = { name, slug: makerSlug(name), size: 0, tech: {} };
      map[name].size += 1;
      map[name].tech[v.technology] = (map[name].tech[v.technology] || 0) + 1;
    });
    const rows = Object.values(map).map((d) => {
      const top = Object.entries(d.tech).sort((a, b) => b[1] - a[1])[0];
      return { name: d.name, slug: d.slug, size: d.size, tech: top ? top[0] : "Other" };
    });
    // Fold singletons into one "Other" tile to keep the map legible.
    const big = rows.filter((d) => d.size >= 2 && d.name !== "Other");
    const smallSize = rows
      .filter((d) => d.size < 2 || d.name === "Other")
      .reduce((s, d) => s + d.size, 0);
    big.sort((a, b) => b.size - a.size);
    if (smallSize) big.push({ name: "Other", slug: null, size: smallSize, tech: "Other" });
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

  // --- Makers: one profile per OEM, for the maker panel and its index ---
  const MAKERS = (() => {
    const groups = new Map();
    V.forEach((v) => {
      if (!hasMaker(v.oem)) return;
      const slug = makerSlug(v.oem);
      if (!groups.has(slug)) groups.set(slug, { name: v.oem, slug, vessels: [] });
      groups.get(slug).vessels.push(v);
    });
    const tally = (list, get) => {
      const m = {};
      list.forEach((v) => {
        const k = get(v);
        if (k) m[k] = (m[k] || 0) + 1;
      });
      return Object.entries(m).sort((a, b) => b[1] - a[1]);
    };
    return [...groups.values()]
      .map(({ name, slug, vessels }) => {
        const years = vessels.map((v) => v.installedYear).filter(Boolean);
        const first = years.length ? Math.min(...years) : null;
        const owners = tally(vessels, (v) => (v.shipowner && v.shipowner !== "None" ? v.shipowner : null));
        // Installs per year, stacked two ways (same buckets and order as the
        // dashboard's charts, so a maker's chart reads like the fleet's).
        const span = first ? YEARS.filter((y) => y >= first) : [];
        const perYear = (get, keys) =>
          span.map((y) => {
            const row = { year: String(y) };
            keys.forEach((k) => {
              row[k] = vessels.filter((v) => v.installedYear === y && get(v) === k).length;
            });
            return row;
          });
        return {
          name,
          slug,
          country: tally(vessels, (v) => v.oemCountry)[0]?.[0] || null,
          techs: tally(vessels, (v) => v.technology).map(([t]) => t),
          count: vessels.length,
          units: vessels.reduce((s, v) => s + v.units, 0),
          first,
          latest: years.length ? Math.max(...years) : null,
          vessels: [...vessels].sort(
            (a, b) => (b.installedYear || 0) - (a.installedYear || 0) || a.name.localeCompare(b.name)
          ),
          repeatCustomers: owners.filter(([, n]) => n > 1).map(([owner, n]) => ({ owner, n })),
          singleCustomers: owners.filter(([, n]) => n === 1).length,
          unknownCustomers: vessels.filter((v) => !v.shipowner || v.shipowner === "None").length,
          perYear: {
            ship: perYear((v) => shipBucket(v.type), SHIP_ORDER),
            inst: perYear((v) => v.installType, INSTALL_ORDER),
          },
        };
      })
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  })();

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
      oems: new Set(V.filter((v) => hasMaker(v.oem)).map((v) => v.oem)).size,
      countries: new Set(
        V.filter((v) => hasMaker(v.oem)).map((v) => v.oemCountry).filter(Boolean)
      ).size,
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
    MAKERS,
    marketSize,
    KPIS,
    SHIP_ORDER,
    INSTALL_ORDER,
  };
}

// Offline/first-paint aggregation, from the bundled snapshot. The dashboard
// replaces this as soon as the live fetch resolves.
export const FALLBACK_ANALYTICS = buildAnalytics(FALLBACK_VESSELS);
