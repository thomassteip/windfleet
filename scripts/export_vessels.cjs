/*
 * Export the live Supabase fleet → data/vessels.json (the static snapshot).
 * ----------------------------------------------------------------------------
 * The globe markers read live from Supabase, but the analytics page and the
 * route builder read the bundled data/vessels.json snapshot. Run this whenever
 * you edit the database (e.g. fixed a vessel, added Tirranna) to bring the
 * snapshot back in sync, then rebuild the routes:
 *
 *     node scripts/export_vessels.cjs   # Supabase -> data/vessels.json
 *     node scripts/build_routes.cjs     # -> public/routes.json
 *
 * Reads the NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY from .env.local (read-only).
 */

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const APP = path.join(__dirname, "..");

// Minimal .env.local reader (no extra dependency).
function envVar(name) {
  try {
    const txt = fs.readFileSync(path.join(APP, ".env.local"), "utf8");
    const m = txt.match(new RegExp("^" + name + "=(.*)$", "m"));
    return m ? m[1].trim() : "";
  } catch {
    return "";
  }
}

const url = envVar("NEXT_PUBLIC_SUPABASE_URL");
const key = envVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY in .env.local");
  process.exit(1);
}

// Same snake_case → camelCase mapping the app uses (lib/data.js).
function rowToVessel(r) {
  return {
    id: r.id, name: r.name, imo: r.imo, mmsi: r.mmsi, flag: r.flag,
    type: r.type, builtYear: r.built_year, dwt: r.dwt, gt: r.gt,
    loa: r.loa, beam: r.beam, technology: r.technology, oem: r.oem,
    oemCountry: r.oem_country, installedYear: Number(r.installed_year) || null,
    units: r.units, systemSize: r.system_size, systemSizeUnit: r.system_size_unit,
    installType: r.install_type, shipowner: r.shipowner, operator: r.operator,
    status: r.status, notes: r.notes, lat: r.lat, lng: r.lng, speed: r.speed,
    course: r.course, navStatus: r.nav_status, destination: r.destination,
    destinationLocode: r.destination_locode, lastPort: r.last_port,
    lastPortLocode: r.last_port_locode, positionUpdated: r.position_updated,
    mstUrl: r.mst_url, vfUrl: r.vf_url, photoUrl: r.photo_url,
  };
}

(async () => {
  const sb = createClient(url, key);
  const { data, error } = await sb.from("vessels").select("*").order("id");
  if (error) {
    console.error("Supabase read failed:", error.message);
    process.exit(1);
  }
  const vessels = data.map(rowToVessel);
  fs.writeFileSync(
    path.join(APP, "data", "vessels.json"),
    JSON.stringify(vessels, null, 1)
  );
  console.log(`Wrote data/vessels.json — ${vessels.length} vessels.`);
})();
