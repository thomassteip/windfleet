import vesselsRaw from "@/data/vessels.json";
import { supabase } from "@/lib/supabase";

// Static snapshot bundled with the app. Used for the first paint and as a
// fallback whenever Supabase isn't configured or is unreachable, so the map
// never shows up empty.
export const FALLBACK_VESSELS = vesselsRaw.map((v) => ({
  ...v,
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
    type: r.type,
    builtYear: r.built_year,
    dwt: r.dwt,
    gt: r.gt,
    loa: r.loa,
    beam: r.beam,
    technology: r.technology,
    oem: r.oem,
    oemCountry: r.oem_country,
    installedYear: Number(r.installed_year) || null,
    units: r.units,
    systemSize: r.system_size,
    systemSizeUnit: r.system_size_unit,
    installType: r.install_type,
    shipowner: r.shipowner,
    operator: r.operator,
    status: r.status,
    notes: r.notes,
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
  };
}

// Fetch the live fleet from Supabase. Returns null on any failure so callers
// can fall back to FALLBACK_VESSELS.
export async function fetchVessels() {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from("vessels")
      .select("*")
      .order("id");
    if (error || !data || data.length === 0) return null;
    return data.map(rowToVessel);
  } catch {
    return null;
  }
}
