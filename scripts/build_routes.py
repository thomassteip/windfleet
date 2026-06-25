#!/usr/bin/env python3
"""
Precompute fleet sea-routes  ->  public/routes.json   (Python / searoute engine)
================================================================================
Replaces the old searoute-js wrapper (scripts/build_routes.cjs + lib/seaRouter.cjs
+ the live /api/searoute endpoint). We now compute BOTH voyage legs for every
vessel here, offline, with the `searoute` package (a Python port of the Eurostat
SeaRoute project, https://github.com/eurostat/searoute), and bake them into a
single static public/routes.json. The app then loads/looks up routes with no
live pathfinding — instant on page load, nothing to restart.

Why searoute (vs the old JS path):
  * full coverage — every vessel whose ports resolve gets a route that actually
    reaches the port (the JS path silently dropped ~40% of destination legs);
  * proper canals/straits — Suez, Panama, Malacca, Gibraltar, etc. are handled,
    so no more giant detours;
  * `append_orig_dest=True` snaps to the exact origin/destination coordinates.

The one wrinkle searoute shares with any network router: where it joins the real
port point to the nearest network node it can leave a sharp "spur" (an out-and-
back triangle). `despur()` below removes those interior near-reversals, which is
all the cleanup the geometry needs.

Output format (coords are [lat, lng] to match the app's convention):
    [ { "id": <vesselId>,
        "travelled": [[lat,lng], ...] | null,   # last port -> current position
        "planned":   [[lat,lng], ...] | null }, # current position -> destination
      ... ]

Run from the windfleet-app folder, after scraping positions:
    pip install searoute
    python3 scripts/fetch_... (updates data/vessels.json)   # existing pipeline
    python3 scripts/build_routes.py                         # -> public/routes.json
"""

import json
import math
import os
import re
import sys

try:
    import searoute as sr
except ImportError:
    sys.exit("Missing dependency. Run:  pip install searoute")

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ── Port coordinate resolution (mirrors lib/ports.js + lib/locodes.js) ────────
def parse_coord_file(path):
    """Pull every  KEY: [lng, lat]  pair out of a lib/*.js coordinate file."""
    text = open(path, encoding="utf8").read()
    rx = re.compile(
        r'(?:"([^"]+)"|([A-Za-z0-9][A-Za-z0-9 .\-]*?))\s*:\s*'
        r"\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]"
    )
    out = {}
    for m in rx.finditer(text):
        key = (m.group(1) or m.group(2)).strip().upper()
        out[key] = [float(m.group(3)), float(m.group(4))]  # [lng, lat]
    return out


PORTS = parse_coord_file(os.path.join(APP, "lib", "ports.js"))
LOCODES = parse_coord_file(os.path.join(APP, "lib", "locodes.js"))


def port_by_name(name):
    if not name:
        return None
    key = str(name).strip().upper().split(",")[0].strip()
    key = re.sub(r"\s+(ANCH\.?|ANCHORAGE|BUNKERING.*|AREA.*)$", "", key).strip()
    return PORTS.get(key)


def resolve_port(name, locode):
    """UN/LOCODE first (reliable), then by name. Returns [lng, lat] or None."""
    if locode:
        c = LOCODES.get(str(locode).strip().upper())
        if c:
            return c
    return port_by_name(name)


# ── Geometry helpers ──────────────────────────────────────────────────────────
def gc_km(a, b):
    """Great-circle distance (km) between [lng,lat] points."""
    r = math.pi / 180.0
    R = 6371.0
    dlat = (b[1] - a[1]) * r
    dlng = (b[0] - a[0]) * r
    x = (
        math.sin(dlat / 2) ** 2
        + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlng / 2) ** 2
    )
    return 2 * R * math.asin(math.sqrt(x))


def bearing(a, b):
    """Initial bearing (deg) from [lng,lat] a to b."""
    r = math.pi / 180.0
    y = math.sin((b[0] - a[0]) * r) * math.cos(b[1] * r)
    x = math.cos(a[1] * r) * math.sin(b[1] * r) - math.sin(a[1] * r) * math.cos(
        b[1] * r
    ) * math.cos((b[0] - a[0]) * r)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def ang_diff(a, b):
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def despur(coords, turn=120.0):
    """Remove interior near-reversal vertices (the join-spur triangles). A turn
    > `turn`° means the path doubled back on itself — never legitimate routing.
    Endpoints (the real port/vessel points) are never touched. Iterates until
    stable. `coords` is a list of [lng,lat]."""
    c = list(coords)
    changed = True
    guard = 0
    while changed and guard < 200:
        guard += 1
        changed = False
        for i in range(1, len(c) - 1):
            if ang_diff(bearing(c[i - 1], c[i]), bearing(c[i], c[i + 1])) > turn:
                del c[i]
                changed = True
                break
    return c


def route_leg(frm, to):
    """Compute one clean leg between [lng,lat] points. Returns [[lat,lng], ...]
    (app convention) or None. Skips legs under 25 km (vessel effectively in
    port) and obviously failed routes."""
    if not frm or not to:
        return None
    straight = gc_km(frm, to)
    if straight < 25:
        return None
    try:
        feat = sr.searoute(frm, to, append_orig_dest=True)
    except Exception:
        return None
    coords = feat.geometry["coordinates"]  # [[lng,lat], ...]
    if not coords or len(coords) < 2:
        return None
    coords = despur(coords)
    if len(coords) < 2:
        return None
    # Sanity: reject a pathological route far longer than the straight line
    # (real canal routes stay well under this; a blow-up means a routing fault).
    length = sum(gc_km(coords[i - 1], coords[i]) for i in range(1, len(coords)))
    if length > 4 * straight:
        return None
    # searoute keeps longitudes continuous across the dateline (e.g. 319°,
    # -245°). Wrap them back into [-180,180] so the geometry is standard GeoJSON;
    # GlobeView then splits the line at the antimeridian when rendering.
    def wrap(lng):
        return ((lng + 180) % 360 + 360) % 360 - 180

    return [[c[1], wrap(c[0])] for c in coords]  # -> [lat, lng]


def main():
    vessels = json.load(open(os.path.join(APP, "data", "vessels.json"), encoding="utf8"))
    out = []
    n_trav = n_plan = n_missing = 0
    for v in vessels:
        if v.get("lat") is None or v.get("lng") is None:
            continue
        cur = [v["lng"], v["lat"]]
        origin = resolve_port(v.get("lastPort"), v.get("lastPortLocode"))
        dest = resolve_port(v.get("destination"), v.get("destinationLocode"))
        travelled = route_leg(origin, cur)
        planned = route_leg(cur, dest)
        if travelled is None and planned is None:
            if v.get("destination") and not dest:
                n_missing += 1
            continue
        if travelled:
            n_trav += 1
        if planned:
            n_plan += 1
        out.append({"id": v["id"], "travelled": travelled, "planned": planned})

    dest_path = os.path.join(APP, "public", "routes.json")
    with open(dest_path, "w", encoding="utf8") as f:
        json.dump(out, f)
    print(
        f"Wrote public/routes.json — {len(out)} vessels with routes "
        f"({n_trav} travelled legs, {n_plan} destination legs, "
        f"{n_missing} skipped: port not in coordinate list)."
    )


if __name__ == "__main__":
    main()
