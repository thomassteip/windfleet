"""
Refresh vessel positions in Supabase
------------------------------------
Reads the fleet roster from Supabase, scrapes the latest known position for
each vessel from MyShipTracking, and writes the positions back to Supabase.

Run automatically by .github/workflows/refresh-positions.yml (daily), or
locally:

    pip install requests beautifulsoup4
    export SUPABASE_URL="https://YOUR-PROJECT.supabase.co"
    export SUPABASE_SERVICE_KEY="your-service-role-key"   # secret! never commit
    python scripts/refresh_positions.py

NOTE: position data comes from scraping MyShipTracking. This works, but a
cloud IP hitting them daily may eventually be rate-limited or blocked. If that
happens, switch to a proper AIS API (AISStream free tier, or MarineTraffic /
Datalastic paid) — only the scrape_mst() function below would need to change.
"""

import os
import re
import sys
import time
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup

# Position, course, last port, destination and ship photo all come from
# MyShipTracking (scraped below). This script needs one extra column on the
# Supabase `vessels` table for the photo:
#   alter table vessels add column photo_url text;
# (The destination_locode / last_port_locode columns from init.sql are optional
#  and simply stay null — route geocoding falls back to the port name.)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
DELAY_S = 1.5  # seconds between requests — be polite

if not SUPABASE_URL or not SERVICE_KEY:
    sys.exit("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables.")

REST = f"{SUPABASE_URL}/rest/v1/vessels"
SB_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}

SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def get_roster():
    """Pull id, name, imo, mmsi for every vessel from Supabase."""
    r = requests.get(
        REST,
        headers=SB_HEADERS,
        params={"select": "id,name,imo,mmsi", "order": "id"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()


def mst_url(mmsi, imo, name):
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return f"https://www.myshiptracking.com/vessels/{slug}-mmsi-{mmsi}-imo-{imo}"


def scrape_mst(url):
    """Return a dict of position fields, or None if no position found."""
    try:
        r = requests.get(url, headers=SCRAPE_HEADERS, timeout=15)
        if r.status_code != 200:
            return None
    except Exception:
        return None

    text = r.text
    out = {}

    m = re.search(r"([-\d]+\.\d{3,})°\s*/\s*([-\d]+\.\d{3,})°", text)
    if m:
        lat, lon = float(m.group(1)), float(m.group(2))
        if not (abs(lat) < 0.001 and abs(lon) < 0.001):
            out["lat"] = round(lat, 5)
            out["lng"] = round(lon, 5)

    m = re.search(r"(\d+\.?\d*)\s*Knots", text)
    if m:
        out["speed"] = float(m.group(1))

    # Course over ground (labelled + degree sign; reject AIS 360/511 sentinels).
    cm = re.search(r"(?:Course|COG)[^\d\-]{0,15}(\d{1,3}(?:\.\d+)?)\s*°", text, re.I)
    if cm and 0 <= float(cm.group(1)) < 360:
        out["course"] = float(cm.group(1))

    soup = BeautifulSoup(text, "html.parser")

    # Nav status from the "Current Position" panel (not the Events log).
    cp = re.search(r"Current Position(.*?)(?:Show on Live Map|Information|Info)", text, re.S)
    region = cp.group(1) if cp else text
    sm = re.search(
        r"Status[\s\S]{0,80}?(At anchor|Moored|Under way(?: using engine)?|Not under command|Restricted manoeuvrability)",
        region, re.I)
    if sm:
        out["nav_status"] = sm.group(1)[0].upper() + sm.group(1)[1:]

    # Vessel photo (photos.myshiptracking.com host; skips the og:image placeholder).
    pm = re.search(r"https://photos\.myshiptracking\.com/vessel/[^\s\"'<>)]+", text)
    if pm:
        out["photo_url"] = pm.group(0)

    # Last port — most recent port call (first Last Port Calls row).
    port_links = soup.select("table a[href*='/ports/']")
    if port_links:
        out["last_port"] = port_links[0].get_text(strip=True)

    # Destination — last distinct port named in the "Current Trip" block.
    tm = re.search(r"Current Trip(.*?)(?:Current Position|Last Port Calls)", text, re.S)
    if tm:
        names = [re.sub(r"<[^>]+>", "", a).strip()
                 for a in re.findall(r"<a[^>]*?/ports/[^>]*?>(.*?)</a>", tm.group(1), re.S)]
        names = [n for n in names if n]
        if not out.get("last_port") and names:
            out["last_port"] = names[0]
        if len(names) >= 2 and names[-1].upper() != names[0].upper():
            out["destination"] = names[-1]

    return out if "lat" in out else None


def patch_vessel(vessel_id, fields):
    """Update one vessel's position fields in Supabase."""
    r = requests.patch(
        REST,
        headers={**SB_HEADERS, "Prefer": "return=minimal"},
        params={"id": f"eq.{vessel_id}"},
        json=fields,
        timeout=30,
    )
    r.raise_for_status()


def main():
    roster = get_roster()
    print(f"Loaded {len(roster)} vessels from Supabase")
    found, missed = 0, 0

    for i, v in enumerate(roster, start=1):
        name, imo, mmsi = v.get("name"), v.get("imo"), v.get("mmsi")
        if not mmsi or not imo:
            print(f"[{i:2d}/{len(roster)}] {name[:36]:36s}  no MMSI/IMO, skip")
            continue

        url = mst_url(mmsi, imo, name)
        pos = scrape_mst(url)

        if pos:
            pos["position_updated"] = datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )
            pos["updated_at"] = pos["position_updated"]
            pos["mst_url"] = url
            pos["vf_url"] = f"https://www.vesselfinder.com/vessels/details/{imo}"
            try:
                patch_vessel(v["id"], pos)
                print(f"[{i:2d}/{len(roster)}] {name[:36]:36s}  OK  "
                      f"lat={pos['lat']:.2f} lng={pos['lng']:.2f}")
                found += 1
            except Exception as e:
                print(f"[{i:2d}/{len(roster)}] {name[:36]:36s}  upsert failed: {e}")
                missed += 1
        else:
            print(f"[{i:2d}/{len(roster)}] {name[:36]:36s}  no position")
            missed += 1

        time.sleep(DELAY_S)

    print(f"\nDone: {found} updated, {missed} without a fresh position.")


if __name__ == "__main__":
    main()
