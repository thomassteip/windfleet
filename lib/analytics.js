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

// The seven ship types (Oct 2026 taxonomy, see CLAUDE.md), grouped by what the
// ship carries: liquids, dry cargo, wheels, people. Every filter and table
// lists types in this order.
export const SHIP_TYPES = [
  "Tanker",
  "Gas Carrier",
  "Bulk Carrier",
  "General Cargo",
  "Container",
  "Ro-Ro",
  "Passenger",
];

// The chart buckets: the same order, minus Container. Container holds one
// ship (two more on order), and a one-vessel slice is a sliver nobody can
// read or click, so on the charts it folds into "Other" together with any
// untyped row. It stays a type of its own everywhere else (filter chips,
// vessel card, Data table). Give it its own bucket, and a colour, once there
// are enough container ships to see.
export const SHIP_ORDER = [
  "Tanker",
  "Gas Carrier",
  "Bulk Carrier",
  "General Cargo",
  "Ro-Ro",
  "Passenger",
  "Other",
];

// Vessel Class ladders: within each type, classes in size order (small to
// large), because that is how the market reads them. Alphabetical would put
// VLOC before Handysize. Definitions and band edges are in the taxonomy review
// (drafts/overnight-20261014/ship_taxonomy_review.md); in short: bulk by dwt
// (Handysize 10-40k, Supramax 50-60k, Kamsarmax/Panamax by beam 32.31 m,
// Newcastlemax ~185-220k, VLOC 220k+), tankers by dwt (MR2 40-55k, Aframax/LR2
// 80-125k, VLCC 200k+), gas by cbm (small < 15k, VLGC 60/70k+), container by
// TEU, general cargo by plain dwt bands (WindFleet's own, cut at CII's 20k).
// Ro-Ro and Passenger have no size ladder, so their classes are functional and
// listed in a sensible reading order. Class names are matched exactly as the
// workbook writes them; a class not listed here sorts after these, A to Z.
export const CLASS_LADDER = {
  "Tanker": ["Small tanker", "Intermediate", "Handy (MR1)", "MR (MR2)", "LR1 / Panamax", "Aframax / LR2", "Suezmax", "VLCC", "ULCC"],
  "Gas Carrier": ["Small gas carrier (< 15k cbm)", "Handy gas carrier", "Mid-size (MGC)", "LGC", "VLGC", "LNG small-scale", "LNG large conventional (174k m3)", "Q-Flex", "Q-Max"],
  "Bulk Carrier": ["Mini-bulker", "Handysize", "Handymax", "Supramax", "Ultramax", "Panamax", "Kamsarmax", "Post-Panamax", "Capesize", "Newcastlemax", "VLOC"],
  "General Cargo": ["GC < 5k dwt", "GC 5-10k dwt", "GC 10-20k dwt", "GC ≥ 20k dwt", "GC >= 20k dwt"],
  "Container": ["Small feeder", "Feeder 1,000-1,999 TEU", "Sub-Panamax", "Panamax+"],
  "Ro-Ro": ["Ro-Ro cargo", "Ro-Lo (ro-ro / lift-on)", "Con-Ro", "Vehicle carrier (PCTC)"],
  "Passenger": ["Ro-Pax ferry", "Cruise (sailing)", "Expedition cruise"],
};

// What a blank class is called wherever classes are listed. Shown, not hidden:
// "not set" is a fact about the data, and hiding it would make the classes
// look like they cover every ship.
export const NO_CLASS = "Class not set";
export const classOf = (v) => (v.vesselClass && String(v.vesselClass).trim()) || NO_CLASS;

// Filter key for one class of one type ("Bulk Carrier|Kamsarmax"): class
// names alone can repeat across types ("Panamax" is a bulker and a tanker).
export const classKey = (type, cls) => `${type}|${cls}`;

// Does a vessel pass a class filter? Classes only narrow the types they belong
// to: pick Bulk Carrier > Kamsarmax and Tanker (no class), and you get the
// Kamsarmaxes plus every tanker.
export function passesClassFilter(v, classes) {
  if (!classes || !classes.size) return true;
  const prefix = `${v.type}|`;
  for (const k of classes) if (k.startsWith(prefix)) return classes.has(classKey(v.type, classOf(v)));
  return true;
}

// Sort a type's class names: ladder order first, then unknown ones A to Z,
// "Class not set" last.
const classRank = (type, c) => {
  const ladder = CLASS_LADDER[type] || [];
  return c === NO_CLASS ? 2e3 : ladder.includes(c) ? ladder.indexOf(c) : 1e3;
};
export function sortClasses(type, names) {
  return [...names].sort((a, b) => classRank(type, a) - classRank(type, b) || a.localeCompare(b));
}

// Two vessels by class: type first (SHIP_TYPES order), then up the ladder.
// The Data table sorts its Class column with this, so "Kamsarmax" lands
// between Ultramax and Post-Panamax instead of between Intermediate and LGC.
export function compareClass(a, b) {
  const ti = (t) => (SHIP_TYPES.includes(t) ? SHIP_TYPES.indexOf(t) : SHIP_TYPES.length);
  const ca = classOf(a);
  const cb = classOf(b);
  return ti(a.type) - ti(b.type) || classRank(a.type, ca) - classRank(b.type, cb) || ca.localeCompare(cb);
}

export const INSTALL_ORDER = ["Newbuild", "Retrofit"];

// The OEM column uses placeholder values for "no maker" — "None" on most rows,
// "na" on the traditional-sail rows (rigs built by the owner or a sailmaker).
// Every place that counts or lists makers goes through this one check, so a
// placeholder can never show up as a company.
const NO_MAKER = new Set(["", "none", "na", "n/a", "-", "unknown"]);
export const hasMaker = (oem) =>
  typeof oem === "string" && !NO_MAKER.has(oem.trim().toLowerCase());

// URL slug for a maker page: "Hyundai (HD KSOE)" -> "hyundai-hd-ksoe". Every link to a
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
export const shipBucket = (t) => (t && SHIP_ORDER.includes(t) && t !== "Other" ? t : "Other");

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

  // EVERY year from the first install to the latest, empty ones included. Only
  // listing years that had installs drew 2010, 2014 and 2018 as neighbours,
  // squeezing an eight-year gap into two column widths on every time chart.
  const YEARS = (() => {
    const ys = V.map((v) => v.installedYear).filter(Boolean);
    if (!ys.length) return [];
    const out = [];
    for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push(y);
    return out;
  })();

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

  // "Other" only gets a legend chip when something is in it: the one Container
  // ship is Removed, so with the Oct 2026 data the bucket is empty, and an empty
  // chip would click through to nothing.
  const SHIP_KEYS = SHIP_ORDER.filter((b) => b !== "Other" || V.some((v) => shipBucket(v.type) === "Other"));
  const CUMULATIVE = {
    ship: { keys: SHIP_KEYS, data: cumulativeBy((v) => shipBucket(v.type), SHIP_KEYS) },
    tech: { keys: TECH_ORDER, data: cumulativeBy((v) => v.technology, TECH_ORDER) },
    inst: {
      keys: INSTALL_ORDER,
      data: cumulativeBy((v) => v.installType, INSTALL_ORDER),
    },
  };

  // --- Vessel classes within each ship-type bucket ---
  // Shown on the dashboard when a ship type is picked: how that type splits by
  // size/market class, in ladder order (never sorted by count). "Other" mixes
  // types, so its rows carry the type in the label.
  const CLASSES_BY_SHIP = Object.fromEntries(
    SHIP_ORDER.map((bucket) => {
      const inBucket = V.filter((v) => shipBucket(v.type) === bucket);
      const types = SHIP_TYPES.filter((t) => inBucket.some((v) => v.type === t));
      if (inBucket.some((v) => !SHIP_TYPES.includes(v.type))) types.push(null);
      const rows = types.flatMap((t) => {
        const ofType = inBucket.filter((v) => (t ? v.type === t : !SHIP_TYPES.includes(v.type)));
        const names = sortClasses(t, [...new Set(ofType.map(classOf))]);
        return names.map((cls) => ({
          type: t,
          cls,
          label: bucket === "Other" ? `${t || "Type not set"} · ${cls}` : cls,
          n: ofType.filter((v) => classOf(v) === cls).length,
        }));
      });
      return [bucket, { total: inBucket.length, rows }];
    })
  );

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

  // --- Technology x install type ---
  const TECH_INSTALL = TECH_ORDER.map((t) => ({
    tech: t,
    Newbuild: V.filter((v) => v.technology === t && v.installType === "Newbuild").length,
    Retrofit: V.filter((v) => v.technology === t && v.installType === "Retrofit").length,
  })).filter((d) => d.Newbuild + d.Retrofit > 0);

  // --- Market size per technology (toggleable metric) ---
  const techSum = (t, metric) => {
    const set = V.filter((v) => v.technology === t);
    if (metric === "vessels") return set.length;
    if (metric === "dwt") return set.reduce((s, v) => s + (v.dwt || 0), 0);
    return set.reduce((s, v) => s + v.units, 0); // devices
  };
  function marketSize(metric) {
    return TECH_ORDER.map((t) => {
      const raw = techSum(t, metric);
      return { tech: t, value: metric === "dwt" ? Math.round(raw / 1000) : raw };
    }).filter((d) => d.value > 0);
  }

  // --- Technology share, three ways (100% bars) ---
  // Same technology, different weight: suction sails lead on vessel count, but
  // rotor sails on big tankers and bulkers carry more of the deadweight. The
  // "market size" chart shows the absolute numbers; this shows the split.
  const TECH_SHARE = [
    ["vessels", "Vessels"],
    ["devices", "Devices"],
    ["dwt", "Deadweight"],
  ].map(([metric, label]) => {
    const parts = TECH_ORDER.map((tech) => ({ tech, value: techSum(tech, metric) })).filter(
      (p) => p.value > 0
    );
    const total = parts.reduce((s, p) => s + p.value, 0);
    return {
      metric,
      label,
      parts: parts.map((p) => ({ ...p, share: total ? p.value / total : 0 })),
      // Vessels this row can't weigh (no DWT on record), so the caption can say so.
      missing: metric === "dwt" ? V.filter((v) => !v.dwt).length : 0,
    };
  });

  // --- Makers: one profile per maker (the OEM column), for the maker panel and its index ---
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
    const known = (x) => (x && x !== "None" ? x : null);
    return [...groups.values()]
      .map(({ name, slug, vessels }) => {
        const years = vessels.map((v) => v.installedYear).filter(Boolean);
        const first = years.length ? Math.min(...years) : null;
        const owners = tally(vessels, (v) => known(v.shipowner));
        const techs = tally(vessels, (v) => v.technology);
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
          techs: techs.map(([t]) => t),
          count: vessels.length,
          retrofits: vessels.filter((v) => v.installType === "Retrofit").length,
          // Who physically fitted the systems. Partial coverage by design (see
          // CLAUDE.md, Build Yard / Install Yard): only list what's recorded.
          yards: tally(vessels, (v) => known(v.installYard)).map(([yard, n]) => ({ yard, n })),
          yardsKnown: vessels.filter((v) => known(v.installYard)).length,
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
      // A to Z, deliberately: WindFleet doesn't rank makers or show one as
      // bigger than another (Oct 2026 decision). No rank, no market share, no
      // size ordering anywhere a maker is listed. Each profile states its own
      // facts only.
      .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
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
      // Same grouping as the maker pages, so the KPI and the makers list agree.
      makers: MAKERS.length,
      countries: new Set(
        V.filter((v) => hasMaker(v.oem)).map((v) => v.oemCountry).filter(Boolean)
      ).size,
    };
  })();

  return {
    TOTAL,
    YEARS,
    CUMULATIVE,
    CLASSES_BY_SHIP,
    INSTALLS_PER_YEAR,
    INSTALLS_BY_TECH,
    LAST_YEAR,
    TECH_SHARE,
    TECH_INSTALL,
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
