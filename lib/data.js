import vesselsRaw from "@/data/vessels.json";

// Rows marked Removed (WAPS taken off, e.g. a trial prototype) or
// Decommissioned stay in the workbook for history but are not part of the
// active fleet. Filtering here, in the one place both data paths pass
// through, keeps the globe and every analytics total in agreement.
const isActive = (v) => !v.status || v.status === "Active";

// Ship types were cut from eleven to seven in Oct 2026 (see the Domain rules in
// CLAUDE.md). Old names are mapped here, in the one place every data path
// passes through, so a deploy that lands before the new init.sql is pasted
// still lands in the right bucket. Two rows also moved Tanker -> Gas Carrier;
// that is a per-ship data correction and arrives with the new init.sql, not
// through this map.
const LEGACY_TYPES = {
  "Cement Carrier": "Bulk Carrier",
  "Wind Ship": "General Cargo",
  "Heavy Lift": "General Cargo",
  "Ropax": "Passenger",
  "Cruise": "Passenger",
};
export const normaliseType = (t) => LEGACY_TYPES[t] || t || null;

// Static snapshot bundled with the app. Used for the first paint and as a
// fallback whenever /api/vessels fails (Supabase unconfigured or unreachable), so the map
// never shows up empty.
export const FALLBACK_VESSELS = vesselsRaw.filter(isActive).map((v) => ({
  ...v,
  type: normaliseType(v.type),
  vesselClass: v.vesselClass ?? null,
  vesselSubtype: v.vesselSubtype ?? null,
  installedYear: Number(v.installedYear) || null,
}));

// Map a Supabase row (snake_case columns) to the camelCase shape the UI uses.
function rowToVessel(r) {
  return {
    id: r.id,
    name: r.name,
    imo: r.imo,
    mmsi: r.mmsi,
    flag: r.flag,
    type: normaliseType(r.type),
    // Size/market class within the type (Kamsarmax, MR2, PCTC…). Curated in
    // the workbook; blank where nobody has set it, never guessed.
    vesselClass: r.vessel_class ?? null,
    // What it carries within the type (Crude, LPG, Cement, Heavy lift…).
    // Optional and curated like the class: blank rather than guessed.
    vesselSubtype: r.vessel_subtype ?? null,
    builtYear: r.built_year,
    dwt: r.dwt,
    gt: r.gt,
    loa: r.loa,
    beam: r.beam,
    // "Traditional Sail" was renamed "Soft Sail" in Oct 2026. Map the old name
    // so a deploy that lands before the new init.sql is pasted still colours
    // and filters those ships.
    technology: r.technology === "Traditional Sail" ? "Soft Sail" : r.technology,
    oem: r.oem,
    oemCountry: r.oem_country,
    installedYear: Number(r.installed_year) || null,
    units: r.units,
    systemSize: r.system_size,
    systemSizeUnit: r.system_size_unit,
    installType: r.install_type,
    buildYard: r.build_yard,
    installYard: r.install_yard,
    shipowner: r.shipowner,
    operator: r.operator,
    status: r.status,
    // The route sends only whether Notes flag the row VERIFY, not the notes.
    needsVerify: r.needs_verify,
    lat: r.lat,
    lng: r.lng,
    speed: r.speed,
    course: r.course,
    navStatus: r.nav_status,
    destination: r.destination,
    destinationLocode: r.destination_locode,
    lastPort: r.last_port,
    lastPortLocode: r.last_port_locode,
    positionUpdated: r.position_updated,
    mstUrl: r.mst_url,
    vfUrl: r.vf_url,
    photoUrl: r.photo_url,
    photoCredit: r.photo_credit,
  };
}

// Fetch the live fleet via the app's own /api/vessels route (the table isn't
// publicly readable; the route reads it with the service key). Returns null on
// any failure so callers can fall back to FALLBACK_VESSELS.
export async function fetchVessels() {
  try {
    const res = await fetch("/api/vessels");
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return data.map(rowToVessel).filter(isActive);
  } catch {
    return null;
  }
}
