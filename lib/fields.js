// The column catalogue: every vessel field the outside world can see, in one
// place. The Data panel's table and its CSV/JSON export both read this list,
// so a column's label, unit and visibility are defined once.
//
//   key      camelCase field on the vessel object (see rowToVessel in data.js)
//   label    human header, used in the table and as the CSV header
//   group    for the column picker
//   type     "text" | "number" | "year" | "date" — drives sorting/alignment
//   unit     appended in the table header, e.g. "LOA (m)"
//   default  shown in the table before the user picks columns
//   export   included in CSV/JSON/API output. Photos (and their credits) are
//            left out entirely: they're licensed for display on the card, not
//            for redistribution.
//
// Deliberately not here: Notes (internal working notes: corrections, sourcing,
// VERIFY flags; only the "verify" tag is shown) and the live AIS position
// fields. The globe shows where ships are; the table doesn't hand out a
// downloadable tracking feed. Each ship's own card still shows its position.
//
// Adding a workbook column? It also needs an entry here to appear in the table
// and the export (on top of the four edits listed in CLAUDE.md).
export const FIELDS = [
  { key: "name", label: "Vessel", group: "Identity", type: "text", default: true, export: true },
  { key: "imo", label: "IMO", group: "Identity", type: "text", default: true, export: true },
  { key: "mmsi", label: "MMSI", group: "Identity", type: "text", export: true },
  { key: "flag", label: "Flag", group: "Identity", type: "text", default: true, export: true },
  { key: "type", label: "Ship type", group: "Ship", type: "text", default: true, export: true },
  { key: "vesselClass", label: "Class", group: "Ship", type: "text", default: true, export: true },
  { key: "builtYear", label: "Built", group: "Ship", type: "year", default: true, export: true },
  { key: "dwt", label: "DWT", group: "Ship", type: "number", default: true, export: true },
  { key: "gt", label: "GT", group: "Ship", type: "number", export: true },
  { key: "loa", label: "LOA", unit: "m", group: "Ship", type: "number", export: true },
  { key: "beam", label: "Beam", unit: "m", group: "Ship", type: "number", export: true },
  { key: "technology", label: "Technology", group: "Wind system", type: "text", default: true, export: true },
  { key: "oem", label: "Maker", group: "Wind system", type: "text", default: true, export: true },
  { key: "oemCountry", label: "Maker country", group: "Wind system", type: "text", export: true },
  { key: "installedYear", label: "Installed", group: "Wind system", type: "year", default: true, export: true },
  { key: "units", label: "Units", group: "Wind system", type: "number", default: true, export: true },
  { key: "systemSize", label: "System size", group: "Wind system", type: "number", export: true },
  { key: "systemSizeUnit", label: "Size unit", group: "Wind system", type: "text", export: true },
  { key: "installType", label: "Install type", group: "Wind system", type: "text", default: true, export: true },
  { key: "buildYard", label: "Build yard", group: "Commercial", type: "text", export: true },
  { key: "installYard", label: "Install yard", group: "Commercial", type: "text", export: true },
  { key: "shipowner", label: "Shipowner", group: "Commercial", type: "text", default: true, export: true },
  { key: "operator", label: "Operator", group: "Commercial", type: "text", export: true },
];

export const FIELD_GROUPS = [...new Set(FIELDS.map((f) => f.group))];
export const EXPORT_FIELDS = FIELDS.filter((f) => f.export);
export const DEFAULT_COLUMNS = FIELDS.filter((f) => f.default).map((f) => f.key);

export const fieldLabel = (f) => (f.unit ? `${f.label} (${f.unit})` : f.label);

// The workbook uses the literal strings "None" and "na" for some empty cells;
// treat them, null and "" alike everywhere so sorting and exports don't see three kinds of
// blank.
export const isBlank = (v) => v === null || v === undefined || v === "" || v === "None" || v === "na";

// Rows whose Notes say VERIFY carry unconfirmed data (see CLAUDE.md). Surfaced
// as a flag rather than hidden: professional users want to know which numbers
// to double-check.
export const needsVerify = (v) => /VERIFY/.test(v.notes || "");

// ---- Filtering. Query-string keys, so a /data?technology=Rotor%20Sail link
// opens the table already filtered. ----

// Filter keys accepted in query strings, and the vessel field each one matches.
export const FILTER_PARAMS = {
  technology: "technology",
  type: "type",
  installType: "installType",
  oem: "oem",
  flag: "flag",
};

export function filterVessels(vessels, { filters = {}, q = "", installedFrom, installedTo } = {}) {
  const needle = q.trim().toLowerCase();
  return vessels.filter((v) => {
    for (const [param, key] of Object.entries(FILTER_PARAMS)) {
      const wanted = filters[param];
      if (wanted && wanted.length && !wanted.includes(v[key])) return false;
    }
    if (installedFrom && !(v.installedYear >= installedFrom)) return false;
    if (installedTo && !(v.installedYear <= installedTo)) return false;
    if (needle) {
      const hay = [v.name, v.imo, v.mmsi, v.oem, v.shipowner, v.operator, v.flag, v.type, v.vesselClass, v.technology]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

// ---- Export ----

// Plain objects with only the exportable fields, in catalogue order. `keys`
// narrows to a column subset (the table's visible columns).
export function toRecords(vessels, keys) {
  const fields = keys ? EXPORT_FIELDS.filter((f) => keys.includes(f.key)) : EXPORT_FIELDS;
  return vessels.map((v) => {
    const out = { id: v.id };
    for (const f of fields) out[f.key] = isBlank(v[f.key]) ? null : v[f.key];
    return out;
  });
}

const csvCell = (v) => {
  if (isBlank(v)) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(vessels, keys) {
  const fields = keys ? EXPORT_FIELDS.filter((f) => keys.includes(f.key)) : EXPORT_FIELDS;
  const header = fields.map((f) => csvCell(fieldLabel(f))).join(",");
  const rows = vessels.map((v) => fields.map((f) => csvCell(v[f.key])).join(","));
  // Leading BOM so Excel opens accented names (Bound4Blue's "España"…) as UTF-8.
  return "﻿" + [header, ...rows].join("\r\n");
}

export const SOURCE_LINE = "Source: WindFleet (wind-fleet.app)";
export const LICENCE = { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" };
