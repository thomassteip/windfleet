#!/usr/bin/env python3
"""
Fetch the latest live NOAA GFS 10 m wind analysis and overwrite public/wind.json.

Replaces scripts/fetch_era5_wind.py (a static 1995-2025 climatology) with genuinely
live data: GFS publishes a fresh global analysis every 6 hours (00/06/12/18 UTC),
free, no account or API key, straight from NOAA's NOMADS GRIB filter service.
public/wind.json keeps the exact schema it always had, so nothing downstream
(GlobeView's speed wash + direction arrows) needs to change.

ONE-TIME SETUP
--------------
    pip install cfgrib xarray numpy

RUN
---
    python3 scripts/fetch_gfs_wind.py

Runs automatically twice a day via .github/workflows/refresh-wind.yml.
"""

import datetime
import glob
import json
import os
import tempfile
import urllib.request

import numpy as np
import xarray as xr

NOMADS_LISTING = "https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod"
NOMADS_FILTER = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
GRID_DEG = 1.5  # public/wind.json resolution — ~109KB gzipped, plenty for zoom-in

ROOT = os.path.join(os.path.dirname(__file__), "..")
WIND_JSON = os.path.join(ROOT, "public", "wind.json")


def latest_cycle():
    """Find the most recent GFS cycle (00/06/12/18Z) whose f000 analysis has
    finished publishing, trying today then yesterday."""
    now = datetime.datetime.now(datetime.timezone.utc)
    for days_back in (0, 1):
        day = now - datetime.timedelta(days=days_back)
        ymd = day.strftime("%Y%m%d")
        for cyc in ("18", "12", "06", "00"):
            if days_back == 0 and int(cyc) > now.hour:
                continue  # hasn't run yet today
            url = f"{NOMADS_LISTING}/gfs.{ymd}/{cyc}/atmos/gfs.t{cyc}z.pgrb2.0p25.f000"
            try:
                req = urllib.request.Request(url, method="HEAD")
                urllib.request.urlopen(req, timeout=15)
                return ymd, cyc
            except Exception:
                continue
    raise RuntimeError("No recent GFS cycle found on NOMADS — is the service down?")


def download_grib(ymd, cyc):
    url = (
        f"{NOMADS_FILTER}?file=gfs.t{cyc}z.pgrb2.0p25.f000"
        "&var_UGRD=on&var_VGRD=on&lev_10_m_above_ground=on"
        "&subregion=&leftlon=0&rightlon=360&toplat=90&bottomlat=-90"
        f"&dir=%2Fgfs.{ymd}%2F{cyc}%2Fatmos"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "windfleet-app/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def load_uv(grib_bytes):
    """Parse UGRD/VGRD out of the GRIB2 bytes and return lat/lon (-180..180,
    sorted ascending) plus u/v arrays re-ordered to match."""
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as f:
        f.write(grib_bytes)
        tmp = f.name
    try:
        ds = xr.open_dataset(tmp, engine="cfgrib")
        lats = ds["latitude"].values  # -90..90 ascending
        lons = ds["longitude"].values  # 0..359.75
        u = ds["u10"].values
        v = ds["v10"].values
    finally:
        os.remove(tmp)
        # cfgrib leaves a sidecar index next to the GRIB file, named with a
        # hash that varies by cfgrib version — match the suffix rather than
        # hard-coding one hash that only cleans up on one version.
        for leftover in glob.glob(tmp + "*.idx"):
            os.remove(leftover)

    # Re-centre longitude to -180..180 and sort ascending, to match the app's
    # existing convention (see the old fetch_era5_wind.py).
    rolled = np.where(lons > 180, lons - 360, lons)
    order = np.argsort(rolled)
    lons = rolled[order]
    u = u[:, order]
    v = v[:, order]
    return lats, lons, u, v


def write_wind_json(lats, lons, u, v, source_label):
    step_i = max(1, round(GRID_DEG / abs(lats[1] - lats[0])))
    step_j = max(1, round(GRID_DEG / abs(lons[1] - lons[0])))
    lat_c = lats[::step_i]
    lon_c = lons[::step_j]
    u_c = u[::step_i, ::step_j]
    v_c = v[::step_i, ::step_j]

    out = {
        "source": source_label,
        "nlat": len(lat_c),
        "nlon": len(lon_c),
        "lat0": float(lat_c[0]),
        "lon0": float(lon_c[0]),
        "dlat": float(lat_c[1] - lat_c[0]),
        "dlon": float(lon_c[1] - lon_c[0]),
        "u": [round(float(x), 2) for x in u_c.ravel()],
        "v": [round(float(x), 2) for x in v_c.ravel()],
    }
    with open(WIND_JSON, "w") as f:
        json.dump(out, f)
    print(f"Wrote {WIND_JSON} — {out['nlat']}x{out['nlon']} grid.")


def main():
    ymd, cyc = latest_cycle()
    print(f"Using GFS cycle {ymd} {cyc}Z (analysis, f000)")
    grib_bytes = download_grib(ymd, cyc)
    lats, lons, u, v = load_uv(grib_bytes)
    label = f"NOAA GFS {ymd} {cyc}Z 10m wind analysis"
    write_wind_json(lats, lons, u, v, label)


if __name__ == "__main__":
    main()
