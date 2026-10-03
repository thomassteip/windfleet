"""
Port lookup shared by refresh_positions.py and build_routes.py
==============================================================
One place that answers "where is this port?", so the daily refresh and the
route builder can never disagree about it.

Coordinates come from, in priority order:
  1. lib/locodes.js  — hand-curated, always wins (also used by the browser)
  2. data/ports.json — ~13,000 seaports, built by scripts/build_ports.py
  3. lib/ports.js    — hand-curated port NAMES, for free-text destinations

Codes are handled as the 5-character UN/LOCODE ("NLRTM"). lib/locodes.js still
holds VesselFinder's terminal-suffixed form ("NLRTM001"); that is folded down to
5 characters here.
"""

import json
import math
import os
import re

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _parse_coord_file(path):
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


# code5 -> [lng, lat, name]
PORTS = {}
_ports_json = os.path.join(APP, "data", "ports.json")
if os.path.exists(_ports_json):
    PORTS.update(json.load(open(_ports_json, encoding="utf8")))
# lib/locodes.js lines look like:  NLRTM001: [4.14, 51.95],  // Rotterdam, Netherlands
for _m in re.finditer(
        r"([A-Z]{2}[A-Z2-9]{3})\w*\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\],?\s*(?://\s*([^,\n]+))?",
        open(os.path.join(APP, "lib", "locodes.js"), encoding="utf8").read()):
    _c5 = _m.group(1)
    _name = (_m.group(4) or "").strip() or PORTS.get(_c5, [None, None, _c5])[2]
    PORTS[_c5] = [float(_m.group(2)), float(_m.group(3)), _name]

# NAME -> [lng, lat]  (hand-curated; NEWCASTLE deliberately means Australia)
NAMES = _parse_coord_file(os.path.join(APP, "lib", "ports.js"))

# Port name -> code, only where the name is unambiguous worldwide.
_by_name = {}
for _c, (_x, _y, _n) in PORTS.items():
    _by_name.setdefault(re.sub(r"[^A-Z]", "", str(_n).upper()), set()).add(_c)
UNIQUE_NAMES = {k: next(iter(v)) for k, v in _by_name.items() if len(v) == 1 and k}

_LOCODE_RX = re.compile(r"^[A-Z]{2}[A-Z2-9]{3}$")


def _clean_name(name):
    key = str(name).strip().upper().split(",")[0].strip()
    return re.sub(r"\s+(ANCH\.?|ANCHORAGE|BUNKERING.*|AREA.*)$", "", key).strip()


def code_coords(code):
    """[lng, lat] for a UN/LOCODE (5 chars, or VesselFinder's 8), or None."""
    if not code:
        return None
    p = PORTS.get(str(code).strip().upper()[:5])
    return [p[0], p[1]] if p else None


def name_coords(name):
    if not name:
        return None
    return NAMES.get(_clean_name(name))


def resolve_port(name, locode):
    """UN/LOCODE first (reliable), then by name. Returns [lng, lat] or None."""
    return code_coords(locode) or name_coords(name)


def parse_destination(text):
    """Make sense of a crew-typed AIS destination.

    Returns (display_name, locode_or_None, recognised). Handles the common
    spellings: "SGSIN", "BE ANR", "DE HAM >> NL RTM", "USHNL >KRPUS",
    "DKGED-DERSK-DKGED", "FRURO VIA NOK", "FUJAIRAH,UAE", "ROTTERDAM".
    For a multi-leg string the LAST port is the destination. Anything we can't
    place ("SEA TRIALS", "FOR ORDERS") comes back as typed, unrecognised.
    """
    raw = (text or "").strip()
    if not raw:
        return None, None, False
    t = raw.upper()
    t = re.split(r"\s+VIA\s+", t)[0]
    seg = [s for s in re.split(r">+", t) if s.strip()]
    t = seg[-1].strip() if seg else t
    # "DKGED-DERSK-DKGED" / "GED - ROS - GED": a round trip; last piece wins.
    pieces = [p.strip() for p in re.split(r"\s*-\s*", t) if p.strip()]
    if len(pieces) > 1 and all(len(re.sub(r"[^A-Z0-9]", "", p)) <= 5 for p in pieces):
        t = pieces[-1]

    compact = re.sub(r"[^A-Z0-9]", "", t)
    if _LOCODE_RX.match(compact) and compact in PORTS:
        return PORTS[compact][2], compact, True
    xy = name_coords(t)
    if xy:
        # Curated name: borrow the LOCODE too if a same-named port sits close by.
        code = UNIQUE_NAMES.get(re.sub(r"[^A-Z]", "", _clean_name(t)))
        if code and gc_km(xy, PORTS[code][:2]) > 50:
            code = None
        return _clean_name(t).title(), code, True
    code = UNIQUE_NAMES.get(re.sub(r"[^A-Z]", "", _clean_name(t)))
    if code:
        return PORTS[code][2], code, True
    return raw, (compact if _LOCODE_RX.match(compact) else None), False


def gc_km(a, b):
    """Great-circle distance (km) between [lng,lat] points."""
    r = math.pi / 180.0
    dlat = (b[1] - a[1]) * r
    dlng = (b[0] - a[0]) * r
    x = (math.sin(dlat / 2) ** 2
         + math.cos(a[1] * r) * math.cos(b[1] * r) * math.sin(dlng / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(x))


def nearest_port(lng, lat, max_km):
    """(code, name, km) of the closest port within max_km, or None."""
    best = None
    for code, (x, y, name) in PORTS.items():
        if abs(y - lat) > 1 or abs(((x - lng + 180) % 360) - 180) > 2:
            continue  # cheap box filter before the trig
        d = gc_km([lng, lat], [x, y])
        if d <= max_km and (best is None or d < best[2]):
            best = (code, name, d)
    return best
