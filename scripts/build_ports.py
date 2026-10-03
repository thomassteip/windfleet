#!/usr/bin/env python3
"""
Build data/ports.json — UN/LOCODE -> port coordinates, for the Python scripts
=============================================================================
AIS "destination" is typed by the crew, and on most of the fleet it is already
a UN/LOCODE in some spelling: "SGSIN", "BE ANR", "DE HAM >> NL RTM". To turn
those into voyage lines we need coordinates for every port code, not just the
~50 hand-picked ones in lib/locodes.js.

No single free source has them all, so this merges three, best first:

  1. UN/LOCODE (UNECE, via github.com/datasets/un-locode) — the official code
     list, ~11,800 seaports with coordinates. But many major ports have NONE
     (Dublin, Riga, Dakar, Tarragona, Newcastle NSW...).
  2. NGA World Port Index (US government, public domain) — fills some of those
     gaps, by its own LOCODE field, or by port name within the same country.
  3. lib/locodes.js (hand-curated) — wins over both. scripts/portlib.py merges
     it in at load time, so it is NOT copied in here.

Run by hand, rarely (UN/LOCODE is revised twice a year):
    python3 scripts/build_ports.py      # -> data/ports.json

The output is read only by scripts/ (portlib.py). The browser never loads it —
it is ~600 KB, far too big to ship to every visitor for a marker-arrow fallback.

Codes still missing after this are printed by refresh_positions.py each run as
"unplaced destination codes". Add them to lib/locodes.js by hand; that is the
intended way to close the long tail.
"""

import csv
import io
import json
import os
import re
import unicodedata
import urllib.request

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(APP, "data", "ports.json")

UNLOCODE_CSV = "https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv"
WPI_JSON = "https://msi.nga.mil/api/publications/world-port-index?output=json"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "windfleet-build-ports"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode("utf-8")


def norm_name(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Z]", "", s.upper())


def parse_unlocode_coord(c):
    """'5155N 00430E' -> (lng, lat), or None."""
    m = re.match(r"(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])", (c or "").strip())
    if not m:
        return None
    lat = (int(m[1]) + int(m[2]) / 60) * (1 if m[3] == "N" else -1)
    lng = (int(m[4]) + int(m[5]) / 60) * (1 if m[6] == "E" else -1)
    return round(lng, 3), round(lat, 3)


def main():
    print("Fetching UN/LOCODE...")
    un = {}  # code -> (name, has_port_function, coord|None)
    for r in csv.DictReader(io.StringIO(fetch(UNLOCODE_CSV))):
        if r["Change"].strip() == "X" or not r["Location"].strip():
            continue  # X = marked for deletion
        code = r["Country"] + r["Location"]
        un[code] = (r["NameWoDiacritics"] or r["Name"],
                    r["Function"][:1] == "1",
                    parse_unlocode_coord(r["Coordinates"]))

    print("Fetching World Port Index...")
    wpi_by_code, wpi_by_name = {}, {}
    for p in json.loads(fetch(WPI_JSON))["ports"]:
        xy = (round(p["xcoord"], 3), round(p["ycoord"], 3))
        code = (p.get("unloCode") or "").replace(" ", "").upper()
        if len(code) == 5:
            wpi_by_code.setdefault(code, (p["portName"], xy))
        wpi_by_name.setdefault((p["countryCode"], norm_name(p["portName"])), xy)

    ports, src = {}, {"unlocode": 0, "wpi-code": 0, "wpi-name": 0}
    for code, (name, is_port, xy) in un.items():
        if not is_port and code not in wpi_by_code:
            continue
        if xy:
            src["unlocode"] += 1
        elif code in wpi_by_code:
            xy = wpi_by_code[code][1]
            src["wpi-code"] += 1
        elif (code[:2], norm_name(name)) in wpi_by_name:
            xy = wpi_by_name[(code[:2], norm_name(name))]
            src["wpi-name"] += 1
        else:
            continue
        ports[code] = [xy[0], xy[1], name]
    # WPI ports whose LOCODE UN/LOCODE doesn't list at all.
    for code, (name, xy) in wpi_by_code.items():
        if code not in ports:
            ports[code] = [xy[0], xy[1], name]
            src["wpi-code"] += 1

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf8") as f:
        json.dump(dict(sorted(ports.items())), f, separators=(",", ":"), ensure_ascii=False)
    print(f"Wrote data/ports.json — {len(ports)} ports  {src}")


if __name__ == "__main__":
    main()
