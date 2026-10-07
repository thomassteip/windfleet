#!/usr/bin/env python3
"""
Precompute fleet voyage lines  ->  public/routes.json
=====================================================
Two legs per vessel, baked into one static file so the app does no live
pathfinding:

  travelled  where the ship has ACTUALLY been: its real AIS track from Open
             Waters (https://openwaters.io/api/ais), since its previous port
             stop, capped at TRACK_DAYS. Where the volunteer receivers lost it
             (mid-ocean, mostly) the gap is filled with a `searoute` path and
             flagged `inferred`, so the globe can draw it fainter: observed
             and guessed never look the same.
  planned    current position -> destination, routed with `searoute` (a Python
             port of Eurostat SeaRoute, https://github.com/eurostat/searoute).
             A forecast is a guess by nature; that's the leg it's fit for.

WHY THE TRACK. Until Oct 2026 the travelled leg was also a searoute guess, from
the "last port" column to the current position. That column only updates when
the daily refresh catches a ship sitting in port, so it went stale for weeks:
Berge Olympus drew Ilha Guaiba -> South Africa while its real track came from
the East China Sea, and Hu Po drew 23,000 km via Suez. Every travelled line over
5,000 km was one of these. The track has none of that problem.

Open Waters only keeps ~6 weeks of history, so TRACK_DAYS stays under that.

Output format (coords are [lat, lng] to match the app's convention):
    [ { "id": <vesselId>,
        "travelled": [ {"c": [[lat,lng], ...], "inferred": bool}, ... ] | null,
        "planned":   [[lat,lng], ...] | null },
      ... ]
The travelled pieces join end to end (except across a gap searoute couldn't
route, which is left empty), and the last one ends on the vessel's current
lat/lng.

Runs DAILY in .github/workflows/refresh-positions.yml, right after the position
refresh, against live Supabase, and commits public/routes.json. It EXITS 1 if
Open Waters returns tracks for under MIN_TRACK_SHARE of the fleet, so an outage
turns the Action red instead of committing a globe with no voyage lines.
Locally:
    pip install searoute requests
    python3 scripts/build_routes.py      # routes the data/vessels.json snapshot
    SUPABASE_URL=... SUPABASE_ANON_KEY=... python3 scripts/build_routes.py   # live
"""

import json
import math
import os
import sys
import time
from datetime import datetime, timedelta, timezone

try:
    import requests
    import searoute as sr
except ImportError:
    sys.exit("Missing dependency. Run:  pip install searoute requests")

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Shared with refresh_positions.py so the two can never disagree about a port:
# lib/locodes.js (curated) > data/ports.json (~13k seaports) > lib/ports.js names.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from portlib import nearest_port, resolve_port  # noqa: E402

OW = "https://ais.openwaters.io/v1"
OW_HEADERS = {"User-Agent": "windfleet-refresh (github.com/thomassteip/windfleet)"}
if os.environ.get("OPENWATERS_TOKEN"):
    OW_HEADERS["Authorization"] = f"Bearer {os.environ['OPENWATERS_TOKEN']}"
DELAY_S = 0.6               # Open Waters allows 120 requests/min

TRACK_DAYS = 30             # longest travelled leg; Open Waters keeps ~6 weeks
GAP_KM = 100                # pings further apart than this = receiver gap
MAX_KN = 45                 # a ping implying more than this is a bad fix
PORT_KM = 15                # "in port" = stationary this close to a known port
STALE_DAYS = 14             # no planned leg from a position older than this
MAX_DETOUR = 3.0            # reject a planned route this much longer than straight
SIMPLIFY_KM = 2.0           # Douglas-Peucker tolerance for the observed track
MIN_TRACK_SHARE = 0.5
STATIONARY = {1, 5, 6}      # AIS nav status: at anchor, moored, aground


# ── Geometry helpers (all [lng,lat]) ──────────────────────────────────────────
def gc_km(a, b):
    """Great-circle distance (km) between [lng,lat] points."""
    r = math.pi / 180.0
    dlat = (b[1] - a[1]) * r
    dlng = (b[0] - a[0]) * r
    x = (math.sin(dlat / 2) ** 2
         + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlng / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(min(1.0, x)))


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
    """Remove interior near-reversal vertices: the out-and-back "spur" searoute
    leaves where it joins a real point to its network. A turn > `turn`° means
    the path doubled back on itself — never legitimate routing. Endpoints are
    never touched. Iterates until stable."""
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


def wrap(lng):
    """searoute keeps longitudes continuous across the dateline (319°, -245°).
    Fold back into [-180,180]; GlobeView splits lines at the antimeridian."""
    return ((lng + 180) % 360 + 360) % 360 - 180


def simplify(coords, tol_km=SIMPLIFY_KM):
    """Douglas-Peucker on [lng,lat], tolerance in km (flat-earth per segment,
    fine at this scale). A month of hourly pings is mostly straight lines."""
    if len(coords) < 3:
        return coords

    def off(p, a, b):
        k = math.cos(math.radians(a[1]))
        ax, ay, bx, by, px, py = a[0] * k, a[1], b[0] * k, b[1], p[0] * k, p[1]
        dx, dy = bx - ax, by - ay
        if dx == dy == 0:
            return math.hypot(px - ax, py - ay) * 111.2
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - ax - t * dx, py - ay - t * dy) * 111.2

    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        i, j = stack.pop()
        if j - i < 2 or abs(coords[j][0] - coords[i][0]) > 180:
            continue  # leave dateline-crossing spans alone
        d, k = max((off(coords[m], coords[i], coords[j]), m) for m in range(i + 1, j))
        if d > tol_km:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [c for c, kp in zip(coords, keep) if kp]


def sea_path(frm, to):
    """searoute between [lng,lat] points, despurred, as [lng,lat] (wrapped), or
    None if routing fails."""
    try:
        coords = sr.searoute(frm, to, append_orig_dest=True).geometry["coordinates"]
    except Exception:
        return None
    if not coords or len(coords) < 2:
        return None
    coords = despur(coords)
    return [[wrap(c[0]), c[1]] for c in coords] if len(coords) >= 2 else None


def path_km(coords):
    return sum(gc_km(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def latlng(coords):
    return [[round(c[1], 4), round(c[0], 4)] for c in coords]


# ── Travelled leg: the real AIS track ─────────────────────────────────────────
def parse_t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fetch_track(mmsi):
    """[(t, [lng,lat], sog, nav_status), ...] oldest first, or None on failure."""
    since = datetime.now(timezone.utc) - timedelta(days=TRACK_DAYS)
    try:
        r = requests.get(f"{OW}/vessels/{mmsi}/track", headers=OW_HEADERS, timeout=30,
                         params={"from": since.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                 "interval": "1h"})
        time.sleep(DELAY_S)
        if r.status_code != 200:
            return None
        j = r.json()
    except Exception:
        return None
    geom, p = j.get("geometry") or {}, j.get("properties") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Point":
        coords = [coords]
    times = p.get("times") or []
    sogs, navs = p.get("sog") or [], p.get("nav_status") or []
    pts = []
    for k, c in enumerate(coords):
        if k >= len(times) or not c or len(c) < 2:
            continue
        pts.append((parse_t(times[k]), [c[0], c[1]],
                    sogs[k] if k < len(sogs) else None,
                    navs[k] if k < len(navs) else None))
    return pts


def drop_bad_fixes(pts):
    """Remove isolated pings that imply an impossible speed (AIS glitches)."""
    def kn(a, b):
        h = (b[0] - a[0]).total_seconds() / 3600
        return gc_km(a[1], b[1]) / 1.852 / h if h > 0 else 0

    out = []
    for i, p in enumerate(pts):
        if out and kn(out[-1], p) > MAX_KN:
            nxt = pts[i + 1] if i + 1 < len(pts) else None
            # Bad if skipping it leaves a plausible path (or it's the last ping).
            if nxt is None or kn(out[-1], nxt) <= MAX_KN:
                continue
        out.append(p)
    return out


def since_last_port(pts):
    """Trim the track to start at the previous port stop. If the ship is in port
    NOW, that stay is skipped, so a berthed ship still shows the voyage that
    brought it there."""
    cache = {}

    def in_port(p):
        if not (p[3] in STATIONARY or (p[2] is not None and p[2] < 0.5)):
            return False
        cell = (round(p[1][0], 2), round(p[1][1], 2))
        if cell not in cache:
            cache[cell] = nearest_port(p[1][0], p[1][1], PORT_KM) is not None
        return cache[cell]

    k = len(pts) - 1
    while k >= 0 and in_port(pts[k]):     # the current stay, if any
        k -= 1
    while k >= 0 and not in_port(pts[k]):  # back to the previous one
        k -= 1
    return pts[max(k, 0):]


def travelled_leg(pts, cur):
    """Observed track -> list of {"c": [[lat,lng]...], "inferred": bool} pieces,
    gap-filled with searoute, ending on `cur` ([lng,lat], the live position)."""
    coords = [p[1] for p in pts]
    if not coords or gc_km(coords[-1], cur) > 1:
        coords.append(cur)  # position can be newer than the track's last point
    pieces, run = [], [coords[0]]
    for a, b in zip(coords, coords[1:]):
        if gc_km(a, b) <= GAP_KM:
            run.append(b)
            continue
        if len(run) > 1:
            pieces.append({"c": simplify(run), "inferred": False})
        # Both ends are real sightings, so no detour limit here: Pyxis Ocean's
        # Chile -> River Plate gap is 3.3x the straight line via Cape Horn, and
        # the straight line runs over the Andes. If routing fails outright,
        # leave the gap empty rather than draw it across land.
        gap = sea_path(a, b)
        if gap:
            pieces.append({"c": gap, "inferred": True})
        run = [b]
    if len(run) > 1:
        pieces.append({"c": simplify(run), "inferred": False})
    pieces = [{"c": latlng(p["c"]), "inferred": p["inferred"]} for p in pieces]
    total = sum(path_km([[c[1], c[0]] for c in p["c"]]) for p in pieces)
    return pieces if pieces and total >= 25 else None


# ── Planned leg: searoute forecast ────────────────────────────────────────────
def planned_leg(frm, to):
    """current -> destination, [[lat,lng], ...] or None. Skips legs under 25 km
    (effectively there already) and implausible detours."""
    if not frm or not to:
        return None
    straight = gc_km(frm, to)
    if straight < 25:
        return None
    coords = sea_path(frm, to)
    if not coords or path_km(coords) > MAX_DETOUR * straight:
        return None
    return latlng(coords)


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
    r = requests.get(
        f"{url}/rest/v1/vessels", timeout=30,
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
        params={"select": "id,name,mmsi,lat,lng,position_updated,destination,"
                          "destination_locode", "order": "id"})
    r.raise_for_status()
    rows = r.json()
    print(f"Routing {len(rows)} vessels from live Supabase.")
    return [{"id": r["id"], "name": r["name"], "mmsi": r["mmsi"],
             "lat": r["lat"], "lng": r["lng"], "positionUpdated": r["position_updated"],
             "destination": r["destination"], "destinationLocode": r["destination_locode"]}
            for r in rows]


def main():
    vessels = load_fleet()
    now = datetime.now(timezone.utc)
    out = []
    n_asked = n_tracks = n_trav = n_plan = n_stale = n_inferred = 0
    for v in vessels:
        if v.get("lat") is None or v.get("lng") is None:
            continue
        cur = [v["lng"], v["lat"]]
        upd = v.get("positionUpdated")
        stale = not upd or now - parse_t(upd) > timedelta(days=STALE_DAYS)

        travelled = None
        if v.get("mmsi"):
            n_asked += 1
            pts = fetch_track(v["mmsi"])
            if pts is not None:
                n_tracks += 1
            # The track window ends now; if the position is older than it, the
            # track is empty and we draw nothing — not an invented line.
            pts = drop_bad_fixes(pts or [])
            if pts:
                travelled = travelled_leg(since_last_port(pts), cur)

        planned = None
        if stale:
            n_stale += 1
        else:
            dest = resolve_port(v.get("destination"), v.get("destinationLocode"))
            planned = planned_leg(cur, dest)

        if travelled:
            n_trav += 1
            n_inferred += any(p["inferred"] for p in travelled)
        if planned:
            n_plan += 1
        if travelled or planned:
            out.append({"id": v["id"], "travelled": travelled, "planned": planned})

    print(f"Open Waters tracks: {n_tracks}/{n_asked} answered.")
    if n_asked and n_tracks < MIN_TRACK_SHARE * n_asked:
        sys.exit(f"ERROR: only {n_tracks}/{n_asked} tracks came back — Open Waters "
                 f"looks down. Not writing routes.json.")

    dest_path = os.path.join(APP, "public", "routes.json")
    with open(dest_path, "w", encoding="utf8") as f:
        json.dump(out, f, separators=(",", ":"))
    print(
        f"Wrote public/routes.json — {len(out)} vessels with routes "
        f"({n_trav} travelled from AIS tracks, {n_inferred} of them with gaps "
        f"filled by searoute; {n_plan} destination legs; {n_stale} positions "
        f"older than {STALE_DAYS} days got no destination leg)."
    )


if __name__ == "__main__":
    main()
