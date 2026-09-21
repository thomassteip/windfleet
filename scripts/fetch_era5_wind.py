#!/usr/bin/env python3
"""
Download ERA5 mean 10 m wind (1989-2019) from the Copernicus Climate Data Store
and write public/wind-avg.json in the schema the WindFleet app expects — the
"Average" option in the Wind layer's Live/Average toggle (see lib/wind.js and
GlobeView.jsx). public/wind.json is a separate, live file refreshed every 6
hours by scripts/fetch_gfs_wind.py; this script never touches it.

ONE-TIME SETUP
--------------
1. Create a free account: https://cds.climate.copernicus.eu/
2. Accept the "ERA5 hourly data on single levels" licence on that site.
3. Put your CDS API key in ~/.cdsapirc  (the site shows the exact two lines).
4. pip install cdsapi xarray netCDF4 numpy

RUN
---
    python scripts/fetch_era5_wind.py

It downloads monthly means for 1995-2025, averages them to a single climatology,
coarsens to 2.5 deg, and overwrites public/wind-avg.json.
Then just reload the app and switch the Wind layer to "Average".

SPEED AND DIRECTION COME FROM DIFFERENT VARIABLES, ON PURPOSE
-------------------------------------------------------------
Direction is the mean u/v vector: averaging the components and taking the angle
is exactly how you get a *prevailing* direction.

Speed is NOT the length of that vector. Where wind direction varies, the
components cancel: in the mid South Atlantic the mean vector is 0.22 m/s even
though it is windy there nearly always (a live GFS analysis read 6.87 m/s at
the same spot). Averaging the monthly vectors instead only gets to 1.91 m/s,
because monthly means have already smoothed the day-to-day variation away.

So speed comes from ERA5's own `10m_wind_speed` (si10), which averages the
HOURLY wind speeds before compositing — the honest "how windy is it here,
typically". Both go in the JSON: `speed` for the colour wash, `u`/`v` for the
arrows. Drop si10 and the map silently understates every variable-wind region.
"""

import json
import os

import cdsapi
import numpy as np
import xarray as xr

YEARS = [str(y) for y in range(1995, 2025)]
GRID = 2.5  # output resolution in degrees
NC = "era5_wind_monthly.nc"
SPEED_VAR = "si10"  # ERA5's name for 10m_wind_speed once it's in the netCDF


def needs_download():
    """True unless NC already holds all three variables we need.

    Checked by content rather than mere existence: an older NC from before the
    speed variable was added would otherwise be kept forever, and build() would
    fail on every run with no hint as to why.
    """
    if not os.path.exists(NC):
        return True
    try:
        with xr.open_dataset(NC) as ds:
            if SPEED_VAR in ds.data_vars:
                return False
            print(f"{NC} predates the {SPEED_VAR} (wind speed) variable — refetching.")
            return True
    except Exception as e:
        print(f"Could not read {NC} ({e}) — refetching.")
        return True


def download():
    if not needs_download():
        print(f"{NC} already present and complete — skipping download.")
        return
    print("Requesting ERA5 monthly means from CDS (this queues server-side; "
          "it can take anywhere from a minute to a few hours)...")
    c = cdsapi.Client()
    c.retrieve(
        "reanalysis-era5-single-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": [
                "10m_u_component_of_wind",
                "10m_v_component_of_wind",
                "10m_wind_speed",
            ],
            "year": YEARS,
            "month": [f"{m:02d}" for m in range(1, 13)],
            "time": "00:00",
            "grid": [GRID, GRID],
            "format": "netcdf",
        },
        NC,
    )


def build():
    ds = xr.open_dataset(NC)
    uname = "u10" if "u10" in ds.data_vars else next(d for d in ds.data_vars if d.lower().startswith("u"))
    vname = "v10" if "v10" in ds.data_vars else next(d for d in ds.data_vars if d.lower().startswith("v"))
    if SPEED_VAR not in ds.data_vars:
        raise SystemExit(
            f"{NC} has no '{SPEED_VAR}' variable, so mean wind SPEED can't be computed "
            f"(found: {list(ds.data_vars)}). Delete {NC} and re-run to refetch."
        )
    u = ds[uname]
    v = ds[vname]
    spd = ds[SPEED_VAR]

    # Average over every dimension that isn't lat/lon (time / valid_time / etc.).
    reduce_dims = [d for d in u.dims if d not in ("latitude", "longitude")]
    u = u.mean(dim=reduce_dims)
    v = v.mean(dim=reduce_dims)
    spd = spd.mean(dim=reduce_dims)

    lats = u["latitude"].values   # 90 .. -90
    lons = u["longitude"].values  # 0 .. 357.5 in ERA5

    # Re-centre longitude to -180..180 to match the app.
    roll = np.where(lons > 180, lons - 360, lons)
    order = np.argsort(roll)
    lons_sorted = roll[order]
    u = u.values[:, order]
    v = v.values[:, order]
    spd = spd.values[:, order]

    out = {
        "source": "ERA5 1995-2025 monthly-mean 10m wind",
        "nlat": len(lats),
        "nlon": len(lons_sorted),
        "lat0": float(lats[0]),
        "lon0": float(lons_sorted[0]),
        "dlat": float(lats[1] - lats[0]),
        "dlon": float(lons_sorted[1] - lons_sorted[0]),
        # u/v give the prevailing DIRECTION; speed is the separately-averaged
        # magnitude. See the module docstring for why these can't be one array.
        "u": [round(float(x), 2) for x in u.ravel()],
        "v": [round(float(x), 2) for x in v.ravel()],
        "speed": [round(float(x), 2) for x in spd.ravel()],
    }
    path = os.path.join(os.path.dirname(__file__), "..", "public", "wind-avg.json")
    with open(path, "w") as f:
        json.dump(out, f)
    vec = np.hypot(u, v)
    print(f"Wrote {path} — {out['nlat']}x{out['nlon']} grid, real ERA5 data.")
    print(f"  mean wind speed  : {spd.mean():.2f} m/s  (what the colour wash shows)")
    print(f"  mean vector magn.: {vec.mean():.2f} m/s  (what it showed before this fix)")


if __name__ == "__main__":
    download()
    build()
