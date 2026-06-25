#!/usr/bin/env python3
"""
Download ERA5 mean 10 m wind (1989-2019) from the Copernicus Climate Data Store
and write public/wind.json in the schema the WindFleet app expects.

ONE-TIME SETUP
--------------
1. Create a free account: https://cds.climate.copernicus.eu/
2. Accept the "ERA5 hourly data on single levels" licence on that site.
3. Put your CDS API key in ~/.cdsapirc  (the site shows the exact two lines).
4. pip install cdsapi xarray netCDF4 numpy

RUN
---
    python scripts/fetch_era5_wind.py

It downloads monthly-mean u/v for 1995-2025, averages them to a single
climatology, coarsens to 2.5 deg, and overwrites public/wind.json.
Then just reload the app — the wind layer becomes real ERA5 data.
"""

import json
import os

import cdsapi
import numpy as np
import xarray as xr

YEARS = [str(y) for y in range(1995, 2025)]
GRID = 2.5  # output resolution in degrees
NC = "era5_wind_monthly.nc"


def download():
    if os.path.exists(NC):
        print(f"{NC} already present — skipping download.")
        return
    c = cdsapi.Client()
    c.retrieve(
        "reanalysis-era5-single-levels-monthly-means",
        {
            "product_type": "monthly_averaged_reanalysis",
            "variable": ["10m_u_component_of_wind", "10m_v_component_of_wind"],
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
    u = ds[uname]
    v = ds[vname]

    # Average over every dimension that isn't lat/lon (time / valid_time / etc.).
    reduce_dims = [d for d in u.dims if d not in ("latitude", "longitude")]
    u = u.mean(dim=reduce_dims)
    v = v.mean(dim=reduce_dims)

    lats = u["latitude"].values   # 90 .. -90
    lons = u["longitude"].values  # 0 .. 357.5 in ERA5

    # Re-centre longitude to -180..180 to match the app.
    roll = np.where(lons > 180, lons - 360, lons)
    order = np.argsort(roll)
    lons_sorted = roll[order]
    u = u.values[:, order]
    v = v.values[:, order]

    out = {
        "source": "ERA5 1995-2025 monthly-mean 10m wind",
        "nlat": len(lats),
        "nlon": len(lons_sorted),
        "lat0": float(lats[0]),
        "lon0": float(lons_sorted[0]),
        "dlat": float(lats[1] - lats[0]),
        "dlon": float(lons_sorted[1] - lons_sorted[0]),
        "u": [round(float(x), 2) for x in u.ravel()],
        "v": [round(float(x), 2) for x in v.ravel()],
    }
    path = os.path.join(os.path.dirname(__file__), "..", "public", "wind.json")
    with open(path, "w") as f:
        json.dump(out, f)
    print(f"Wrote {path} — {out['nlat']}x{out['nlon']} grid, real ERA5 data.")


if __name__ == "__main__":
    download()
    build()
