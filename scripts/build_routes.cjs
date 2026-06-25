/*
 * Precompute fleet sea-routes  ->  public/routes.json
 * ---------------------------------------------------
 * The globe draws a faint "last port -> current position" sea-lane route for
 * every vessel. Computing those in the browser meant ~100 calls to
 * /api/searoute on each page load. This script runs the same searoute engine
 * once, offline, and writes a single static routes.json the app loads instantly.
 *
 * Run it from the windfleet-app folder AFTER scraping positions:
 *     python3 ../scripts/fetch_positions.py   # updates data/vessels.json
 *     node scripts/build_routes.cjs           # -> public/routes.json
 *
 * Port coordinates are read directly from lib/ports.js + lib/locodes.js, so
 * there's no duplicated data to keep in sync.
 */

const fs = require("fs");
const path = require("path");
const { seaRoute } = require("../lib/seaRouter.cjs");

const APP = path.join(__dirname, "..");

// Tech palette mirrors lib/theme.js (resolved hex of the POP colours).
const TECH_COLORS = {
  "Rotor Sail": "#2FB8A8",
  "Suction Sail": "#9B7BD4",
  "Wing Sail": "#7FC75B",
  "Rigid Sail": "#5C8AC9",
  "Traditional Sail": "#E0719E",
  Kite: "#F2B33D",
};
const techColor = (t) => TECH_COLORS[t] || "#B9C0CC";
const hexToRgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

// Pull every `KEY: [lng, lat]` pair out of a lib/*.js coordinate file.
function parseCoordFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const re = /(?:"([^"]+)"|([A-Za-z0-9][A-Za-z0-9 .\-]*?))\s*:\s*\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g;
  const map = {};
  let m;
  while ((m = re.exec(text))) {
    const key = (m[1] || m[2]).trim().toUpperCase();
    map[key] = [parseFloat(m[3]), parseFloat(m[4])];
  }
  return map;
}

const PORTS = parseCoordFile(path.join(APP, "lib", "ports.js"));
const LOCODES = parseCoordFile(path.join(APP, "lib", "locodes.js"));

function portByName(name) {
  if (!name) return null;
  let key = String(name).trim().toUpperCase().split(",")[0].trim();
  key = key.replace(/\s+(ANCH\.?|ANCHORAGE|BUNKERING.*|AREA.*)$/i, "").trim();
  const p = PORTS[key];
  return p ? { lng: p[0], lat: p[1] } : null;
}
function resolvePort(name, locode) {
  if (locode) {
    const c = LOCODES[String(locode).trim().toUpperCase()];
    if (c) return { lng: c[0], lat: c[1] };
  }
  return portByName(name);
}

// Great-circle distance (km) between {lng,lat} points.
function gcKm(a, b) {
  const r = Math.PI / 180, R = 6371;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function main() {
  const vessels = JSON.parse(
    fs.readFileSync(path.join(APP, "data", "vessels.json"), "utf8")
  );
  const out = [];
  let missing = 0, skippedShort = 0, inPort = 0;
  for (const v of vessels) {
    if (v.lat == null || v.lng == null) continue;
    const origin = resolvePort(v.lastPort, v.lastPortLocode);
    if (!origin) {
      missing++;
      continue;
    }
    const cur = { lng: v.lng, lat: v.lat };
    const straight = gcKm(origin, cur);
    if (straight < 25) {
      inPort++; // vessel still at/near its last port — no meaningful route
      continue;
    }
    // Robust k-nearest router (lib/seaRouter.cjs) returns the full polyline
    // INCLUDING the true endpoints, already best-scored + joint-trimmed (no
    // spikes) and detour-gated, or null when no plausible path exists.
    const coords = seaRoute(origin, cur);
    if (!coords) {
      skippedShort++;
      continue;
    }
    out.push({
      id: v.id,
      color: hexToRgba(techColor(v.technology), 0.4),
      coords,
    });
  }
  console.log(
    `Filtered: ${inPort} in-port, ${skippedShort} no route found, ` +
      `${missing} unresolved ports.`
  );
  const dest = path.join(APP, "public", "routes.json");
  fs.writeFileSync(dest, JSON.stringify(out));
  console.log(
    `Wrote public/routes.json — ${out.length} routes ` +
      `(${missing} vessels skipped: last port not in the coordinate list)`
  );
}

main();
