/*
 * Robust sea-route finder (shared by the live /api/searoute endpoint and the
 * offline scripts/build_routes.cjs).
 *
 * Why not searoute-js directly: it snaps each endpoint to the nearest single
 * network LINE, then to the nearest vertex on only that line. If that vertex
 * sits on a poorly-connected stub, geojson-path-finder returns null and the
 * route silently fails (this was happening for ~1 in 4 vessels).
 *
 * The marnet shipping-lane network is also coarse: the nearest usable vertex to
 * a port/vessel can sit 50–260 km away. Naively stitching a straight segment
 * from the true endpoint to that vertex produces sharp "triangle" spikes when
 * the vertex is sideways or behind the direction of travel — and degenerate
 * 2–3 point paths make it worse.
 *
 * This wrapper therefore:
 *   1. snaps each endpoint to the K nearest network vertices (globally);
 *   2. evaluates ALL K×K combinations and keeps the one with the SHORTEST total
 *      stitched length (true-from → vertex → network path → vertex → true-to),
 *      not merely the first that resolves — the shortest is the one without a
 *      doubling-back spike;
 *   3. trims leading/trailing network vertices that backtrack at the stitch
 *      joints (the actual source of the triangles);
 *   4. for short legs (< SHORT_KM) skips the coarse network entirely and draws a
 *      densified great-circle line straight to the destination;
 *   5. returns the FULL polyline including the true endpoints, already
 *      quality-gated — consumers use it as-is (no re-stitching, no re-gating).
 *
 * Returns [[lat, lng], ...] following shipping lanes, or null when a medium/long
 * leg has no plausible path (consumers then simply omit that leg).
 */

const PathFinderMod = require("geojson-path-finder");
const PathFinder = PathFinderMod.default || PathFinderMod;
const { coordEach } = require("@turf/meta");
const { point } = require("@turf/helpers");
const marnet = require("searoute-js/data/marnet_densified.json");

let _pf = null;
let _verts = null;

function ready() {
  if (_pf) return;
  _pf = new PathFinder(marnet, { tolerance: 1e-5 });
  _verts = [];
  const seen = new Set();
  coordEach(marnet, (c) => {
    const key = c[0] + "," + c[1];
    if (!seen.has(key)) {
      seen.add(key);
      _verts.push(c);
    }
  });
}

function gcKm(aLng, aLat, bLng, bLat) {
  const r = Math.PI / 180, R = 6371;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// Initial bearing (deg, 0 = north) from (aLat,aLng) to (bLat,bLng).
function bearingDeg(aLat, aLng, bLat, bLng) {
  const r = Math.PI / 180;
  const y = Math.sin((bLng - aLng) * r) * Math.cos(bLat * r);
  const x =
    Math.cos(aLat * r) * Math.sin(bLat * r) -
    Math.sin(aLat * r) * Math.cos(bLat * r) * Math.cos((bLng - aLng) * r);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Smallest absolute difference between two bearings (0–180).
function angDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function kNearest(lng, lat, k) {
  return _verts
    .map((v) => [v, gcKm(lng, lat, v[0], v[1])])
    .sort((a, b) => a[1] - b[1])
    .slice(0, k)
    .map((a) => a[0]);
}

// Total length (km) of a [[lat,lng], ...] polyline.
function pathKm(coords) {
  let s = 0;
  for (let i = 1; i < coords.length; i++) {
    s += gcKm(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return s;
}

// Densified great-circle polyline [[lat,lng], ...] between two {lng,lat} points.
function greatCircle(from, to, segs) {
  const r = Math.PI / 180;
  const f1 = from.lat * r, l1 = from.lng * r, f2 = to.lat * r, l2 = to.lng * r;
  const d =
    2 *
    Math.asin(
      Math.sqrt(
        Math.sin((f2 - f1) / 2) ** 2 +
          Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2
      )
    );
  if (!(d > 0)) return [[from.lat, from.lng], [to.lat, to.lng]];
  const n = Math.max(2, segs);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    pts.push([
      (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI,
      (Math.atan2(y, x) * 180) / Math.PI,
    ]);
  }
  return pts;
}

// Remove interior "spur" vertices: a near-reversal (turn > TURN°) means the path
// ran out to a dead-end stub and came straight back — a visible triangle even
// when the added distance is small. Dropping the tip collapses the spur into the
// short v[i-1]→v[i+1] segment (both ends sat in open water, so this stays wet).
// Endpoints (i=0 and i=last) are never touched. Iterates until stable.
function despur(coords, turn) {
  const TURN = turn || 130;
  let c = coords.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 50) {
    changed = false;
    for (let i = 1; i < c.length - 1; i++) {
      const b1 = bearingDeg(c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]);
      const b2 = bearingDeg(c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]);
      if (angDiff(b1, b2) > TURN) {
        c.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return c;
}

// Remove network vertices that double back at the two stitch joints. `net` is
// [[lat,lng], ...]; from/to are the true {lng,lat} endpoints. A joint spike is a
// turn > TURN° between the stitch segment and the first/last network segment.
function trimJoints(from, to, net) {
  const TURN = 80;
  let a = net.slice();
  // head: from → a[0] → a[1]
  while (a.length >= 2) {
    const b1 = bearingDeg(from.lat, from.lng, a[0][0], a[0][1]);
    const b2 = bearingDeg(a[0][0], a[0][1], a[1][0], a[1][1]);
    if (angDiff(b1, b2) > TURN) a = a.slice(1);
    else break;
  }
  // tail: a[n-2] → a[n-1] → to
  while (a.length >= 2) {
    const n = a.length;
    const b1 = bearingDeg(a[n - 2][0], a[n - 2][1], a[n - 1][0], a[n - 1][1]);
    const b2 = bearingDeg(a[n - 1][0], a[n - 1][1], to.lat, to.lng);
    if (angDiff(b1, b2) > TURN) a = a.slice(0, n - 1);
    else break;
  }
  return a;
}

/**
 * Find a sea route between two {lng,lat} points.
 * Returns the full polyline [[lat, lng], ...] INCLUDING the true endpoints,
 * following shipping lanes (or a direct great-circle for short legs), or null
 * when a medium/long leg has no plausible path.
 */
function seaRoute(from, to, opts) {
  ready();
  const k = (opts && opts.k) || 8;
  const maxDetour = (opts && opts.maxDetour) || 3;
  const SHORT_KM = (opts && opts.shortKm) || 150;
  const straight = gcKm(from.lng, from.lat, to.lng, to.lat);

  if (straight < 1) return null; // same point

  // Short legs: the coarse network can't represent them without spikes, so draw
  // a direct great-circle line (densified ~ every 40 km).
  if (straight < SHORT_KM) {
    return greatCircle(from, to, Math.max(2, Math.round(straight / 40)));
  }

  const os = kNearest(from.lng, from.lat, k);
  const ds = kNearest(to.lng, to.lat, k);
  const goalBrg = bearingDeg(from.lat, from.lng, to.lat, to.lng);

  let best = null;
  let bestKm = Infinity;
  for (const a of os) {
    // Reject an origin snap that heads sharply away from the goal — that's a
    // guaranteed outbound spike before pathfinding even runs.
    const outBrg = bearingDeg(from.lat, from.lng, a[1], a[0]);
    if (angDiff(goalBrg, outBrg) > 100) continue;
    for (const b of ds) {
      if (a[0] === b[0] && a[1] === b[1]) continue;
      let r;
      try {
        r = _pf.findPath(point(a), point(b));
      } catch (e) {
        continue;
      }
      if (!r || !r.path || r.path.length < 2) continue;
      let net = r.path.map(([lng, lat]) => [lat, lng]); // → [lat,lng]
      net = trimJoints(from, to, net);
      if (net.length < 1) continue; // entirely backtracking — bad combo
      const full = [[from.lat, from.lng], ...net, [to.lat, to.lng]];
      const len = pathKm(full);
      if (len > maxDetour * straight) continue;
      if (len < bestKm) {
        bestKm = len;
        best = full;
      }
    }
  }
  // Final pass: collapse any interior reversal spurs left by the network graph.
  return best ? despur(best) : null;
}

module.exports = { seaRoute, gcKm, greatCircle };
