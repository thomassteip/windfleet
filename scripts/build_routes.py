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

Runs DAILY in .github/workflows/refresh-positions.yml, right after the position
refresh, against live Supabase, and commits public/routes.json. Locally:
    pip install searoute
    python3 scripts/build_routes.py      # routes the data/vessels.json snapshot
    SUPABASE_URL=... SUPABASE_ANON_KEY=... python3 scripts/build_routes.py   # live
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


# ── Port coordinate resolution ────────────────────────────────────────────────
# Shared with refresh_positions.py so the two can never disagree about a port:
# lib/locodes.js (curated) > data/ports.json (~13k seaports) > lib/ports.js names.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from portlib import resolve_port  # noqa: E402


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


def load_fleet():
    """The fleet to route: LIVE from Supabase when credentials are set (the daily
    Action), else the bundled data/vessels.json snapshot (a local run).

    Live matters twice over. Positions change daily, so a routes.json built from
    the snapshot ends each line where the ship WAS. And ids come from workbook row
    order: routes.json must be keyed to the ids the app is actually reading, which
    are Supabase's — see the Ilha de Tinhare id-shift note in CLAUDE.md.
    """
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
    if not (url and key):
        print("No SUPABASE_URL/key set: routing the data/vessels.json snapshot.")
        return json.load(open(os.path.join(APP, "data", "vessels.json"), encoding="utf8"))
    import urllib.request
    req = urllib.request.Request(
        f"{url}/rest/v1/vessels?select=id,lat,lng,destination,destination_locode,"
        f"last_port,last_port_locode&order=id",
        headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.load(r)
    print(f"Routing {len(rows)} vessels from live Supabase.")
    return [{"id": r["id"], "lat": r["lat"], "lng": r["lng"],
             "destination": r["destination"], "destinationLocode": r["destination_locode"],
             "lastPort": r["last_port"], "lastPortLocode": r["last_port_locode"]}
            for r in rows]


def main():
    vessels = load_fleet()
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
