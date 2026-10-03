"""
Refresh vessel positions in Supabase from Open Waters AIS
---------------------------------------------------------
Reads the fleet roster from Supabase, asks Open Waters (aiscast) for each
vessel's last known AIS position, and writes it back to Supabase.

Run automatically by .github/workflows/refresh-positions.yml (daily), or
locally:

    pip install requests
    export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"   # secret! never commit
    python scripts/refresh_positions.py

    python scripts/refresh_positions.py --dry-run   # fetch + print, write nothing

WHY OPEN WATERS. Until Oct 2026 this scraped MyShipTracking (position, photo)
and VesselFinder (ports). MyShipTracking put a Cloudflare bot check in front of
every vessel page on ~27 Sep 2026; each request got a 403, the script found 0
positions out of 113, and still exited 0 — so the Action showed a green tick
for a week while the map froze. Open Waters is a real API (no scraping, nothing
to break when a site changes its markup): https://openwaters.io/api/ais

  * /v1/vessels?mmsi=...  last known position however long ago, with `seen` —
    the time the AIS message was actually heard. That, not the time this
    script ran, is what goes in position_updated, so an old fix reads as old.
  * Anonymous access, 10 MMSIs per request. Set OPENWATERS_TOKEN (a free
    personal token, https://openwaters.io/ais/token) to raise that to 50.
  * Coverage is a volunteer receiver network: dense around Europe and North
    America, thin in mid-ocean. A vessel out of range keeps its last fix.

PORTS. AIS carries the crew-typed destination, which on most of the fleet is a
UN/LOCODE in some spelling ("BE ANR", "DE HAM >> NL RTM"); portlib.py turns it
into a clean port name + 5-char LOCODE. AIS has no "last port" at all, so it is
DETECTED: the most recent time in the last 48 h the vessel sat still within
LAST_PORT_KM of a known port. If none is found, last_port is left as it was.

PHOTOS are not touched here any more — they are curated by hand in the
workbook's "Photo URL" / "Photo Credit" columns (see build_supabase_sql.py).

The run FAILS (exit 1) if fewer than MIN_FOUND_SHARE of the trackable fleet
come back, so a broken source turns the Action red instead of silently green.
"""

import os
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import portlib  # noqa: E402

DRY_RUN = "--dry-run" in sys.argv
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
OW_TOKEN = os.environ.get("OPENWATERS_TOKEN", "")

OW = "https://ais.openwaters.io/v1"
BATCH = 50 if OW_TOKEN else 10   # MMSIs per /v1/vessels request (tier cap)
DELAY_S = 0.6                    # Open Waters allows 120 requests/min
LAST_PORT_KM = 15                # "in port" = stationary this close to a port
MIN_FOUND_SHARE = 0.5

# AIS navigational status codes (ITU-R M.1371). 15 = "not defined" -> omitted.
NAV_STATUS = {
    0: "Under way using engine", 1: "At anchor", 2: "Not under command",
    3: "Restricted manoeuvrability", 4: "Constrained by her draught",
    5: "Moored", 6: "Aground", 7: "Engaged in fishing", 8: "Under way sailing",
}
STATIONARY = {1, 5, 6}

if not DRY_RUN and (not SUPABASE_URL or not SERVICE_KEY):
    sys.exit("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

REST = f"{SUPABASE_URL}/rest/v1/vessels"
SB_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}
OW_HEADERS = {"User-Agent": "windfleet-refresh (github.com/thomassteip/windfleet)"}
if OW_TOKEN:
    OW_HEADERS["Authorization"] = f"Bearer {OW_TOKEN}"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def get_roster():
    """id, name, imo, mmsi + current position stamp for every vessel."""
    if DRY_RUN and not SERVICE_KEY:
        # Read-only fallback for local testing: the app's anon key.
        env = {}
        path = os.path.join(portlib.APP, ".env.local")
        for line in open(path):
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
        url = env["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/") + "/rest/v1/vessels"
        hdr = {"apikey": env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
               "Authorization": f"Bearer {env['NEXT_PUBLIC_SUPABASE_ANON_KEY']}"}
    else:
        url, hdr = REST, SB_HEADERS
    r = requests.get(url, headers=hdr, timeout=30,
                     params={"select": "id,name,imo,mmsi,position_updated", "order": "id"})
    r.raise_for_status()
    return r.json()


def fetch_latest(mmsis):
    """mmsi(str) -> GeoJSON feature, for every MMSI Open Waters has heard."""
    out = {}
    for i in range(0, len(mmsis), BATCH):
        chunk = mmsis[i:i + BATCH]
        r = requests.get(f"{OW}/vessels", headers=OW_HEADERS, timeout=30,
                         params={"mmsi": ",".join(chunk)})
        if r.status_code != 200:
            print(f"  Open Waters {r.status_code} for batch {i // BATCH + 1}: {r.text[:200]}")
        else:
            for f in r.json().get("features", []):
                out[str(f["properties"].get("mmsi"))] = f
        time.sleep(DELAY_S)
    return out


def detect_last_port(mmsi, lng, lat, props):
    """(name, locode) of the most recent port the vessel sat still in, or None.

    Checks the current fix first, then walks the 48 h track backwards.
    """
    def stationary(sog, nav):
        return nav in STATIONARY or (sog is not None and sog < 0.5)

    if stationary(props.get("sog"), props.get("nav_status")):
        hit = portlib.nearest_port(lng, lat, LAST_PORT_KM)
        if hit:
            return hit[1], hit[0]

    since = iso(datetime.now(timezone.utc) - timedelta(hours=48))
    try:
        r = requests.get(f"{OW}/vessels/{mmsi}/track", headers=OW_HEADERS, timeout=30,
                         params={"from": since, "interval": "10m"})
        time.sleep(DELAY_S)
        if r.status_code != 200:
            return None
        track = r.json()
    except Exception:
        return None
    geom, p = track.get("geometry") or {}, track.get("properties") or {}
    coords = geom.get("coordinates") or []
    if geom.get("type") == "Point":
        coords = [coords]
    sogs, navs = p.get("sog") or [], p.get("nav_status") or []
    checked = set()
    for k in range(len(coords) - 1, -1, -1):
        sog = sogs[k] if k < len(sogs) else None
        nav = navs[k] if k < len(navs) else None
        if not stationary(sog, nav):
            continue
        x, y = coords[k][0], coords[k][1]
        cell = (round(x, 2), round(y, 2))   # skip re-checking the same berth
        if cell in checked:
            continue
        checked.add(cell)
        hit = portlib.nearest_port(x, y, LAST_PORT_KM)
        if hit:
            return hit[1], hit[0]
    return None


def to_fields(f):
    """Open Waters feature -> Supabase column dict."""
    p = f["properties"]
    lng, lat = f["geometry"]["coordinates"][:2]
    seen = datetime.fromisoformat(p["seen"].replace("Z", "+00:00"))
    # Every field is written, None when AIS doesn't say: a fresh position must
    # never be paired with an old fix's speed, status or destination.
    num = lambda x, hi=None: (round(float(x), 1)
                              if x is not None and (hi is None or 0 <= float(x) < hi) else None)
    out = {
        "lat": round(lat, 5), "lng": round(lng, 5), "position_updated": iso(seen),
        "speed": num(p.get("sog")),
        "course": num(p.get("cog"), 360),
        "heading": num(p.get("heading"), 360),
        "nav_status": NAV_STATUS.get(p.get("nav_status")),
        "destination": None, "destination_locode": None,
    }
    return out, seen


def patch_vessel(vessel_id, fields):
    r = requests.patch(REST, headers={**SB_HEADERS, "Prefer": "return=minimal"},
                       params={"id": f"eq.{vessel_id}"}, json=fields, timeout=30)
    r.raise_for_status()


def main():
    roster = get_roster()
    tracked = [v for v in roster if v.get("imo") and v.get("mmsi")]
    print(f"Loaded {len(roster)} vessels from Supabase; {len(tracked)} have IMO+MMSI")

    latest = fetch_latest([str(v["mmsi"]) for v in tracked])
    now = datetime.now(timezone.utc)
    found = written = stale = failed = 0
    unplaced = set()

    for i, v in enumerate(tracked, start=1):
        name = (v.get("name") or "")[:32]
        f = latest.get(str(v["mmsi"]))
        if not f:
            print(f"[{i:3d}/{len(tracked)}] {name:32s}  not heard by Open Waters")
            continue
        found += 1
        fields, seen = to_fields(f)
        age_h = (now - seen).total_seconds() / 3600
        if age_h > 24 * 7:
            stale += 1

        # Don't overwrite a NEWER fix (e.g. one pasted in from init.sql).
        if (v.get("position_updated") or "") > fields["position_updated"]:
            print(f"[{i:3d}/{len(tracked)}] {name:32s}  ours is newer, skip")
            continue

        props = f["properties"]
        dest_name, dest_code, placed = portlib.parse_destination(props.get("destination"))
        if dest_name:
            fields["destination"] = dest_name
            fields["destination_locode"] = dest_code if placed else None
            if not placed and dest_code:
                unplaced.add(dest_code)

        lp = detect_last_port(v["mmsi"], fields["lng"], fields["lat"], props)
        if lp:
            fields["last_port"], fields["last_port_locode"] = lp

        fields["updated_at"] = iso(now)
        # Only the write is guarded: an error in the log line below must never
        # count as a failed write (it once did, turning a good run red).
        try:
            if not DRY_RUN:
                patch_vessel(v["id"], fields)
        except Exception as e:
            failed += 1
            print(f"[{i:3d}/{len(tracked)}] {name:32s}  write failed: {e}")
            continue
        written += 1
        print(f"[{i:3d}/{len(tracked)}] {name:32s}  OK  seen {age_h:6.1f} h ago  "
              f"{(fields.get('nav_status') or '-')[:14]:14s}  "
              f"from={fields.get('last_port_locode') or '-':5s} "
              f"to={fields.get('destination_locode') or fields.get('destination') or '-'}")

    print(f"\nDone: {found}/{len(tracked)} heard by Open Waters, {written} written"
          f"{' (dry run — nothing saved)' if DRY_RUN else ''}, {failed} write errors; "
          f"{stale} last heard over a week ago.")
    if unplaced:
        print("Unplaced destination codes (add to lib/locodes.js): " + ", ".join(sorted(unplaced)))

    if tracked and found < MIN_FOUND_SHARE * len(tracked):
        sys.exit(f"FAIL: only {found} of {len(tracked)} vessels found — the source is "
                 f"probably down or has changed. Nothing is wrong with the fleet data.")
    if failed:
        sys.exit(f"FAIL: {failed} Supabase writes failed.")


if __name__ == "__main__":
    main()
