# WindFleet

Live map and market intelligence for the global **wind-assisted propulsion (WAPS)** fleet: every commercial vessel in service with rotor sails, wing sails, suction sails, kites or soft sails.

**🌐 Live app: https://www.wind-fleet.app**

You don't need to run anything to use WindFleet, just open the link. The instructions below are for developing or self-hosting it.

## Features

- **3D globe** of the fleet, coloured by wind technology, with light and dark basemaps.
- **Live AIS positions** from [Open Waters](https://openwaters.io), refreshed daily.
- **Voyage routes**: the travelled leg drawn from the ship's real AIS track, and the planned leg to its reported destination.
- **Live wind** from NOAA's GFS model (refreshed twice daily), next to a 1995–2025 ERA5 average.
- **Search** any vessel by name, IMO or MMSI.
- **Filters** by technology, ship type and class, installation type and year.
- **Analytics**: installs per year, technology mix, retrofit vs newbuild, cross-filtered with the globe.
- **Maker pages** (`/makers`): each maker's fleet, technologies and website, listed A to Z and never ranked.
- **Data table** (`/data`): every vessel and field, sortable, with CSV and JSON export.
- **Coming soon:** forecasted installations and a performance module.

## Tech stack

- **Next.js 14** (App Router) + React 18, deployed on **Vercel**.
- **MapLibre GL** (globe projection) with CARTO vector basemaps; custom WebGL layers for wind.
- **Recharts** for the analytics charts.
- **Supabase** (Postgres) as the live data source, read server-side through `/api/vessels`, with a bundled JSON snapshot as fallback.
- **[searoute](https://github.com/eurostat/searoute)** (Python port of Eurostat SeaRoute) for planned routes and for filling gaps in AIS tracks.
- **GitHub Actions** for the daily position/route refresh and the twice-daily wind refresh.

## Run locally

```bash
git clone https://github.com/thomassteip/windfleet.git
cd windfleet
npm install
npm run dev
```

Open <http://localhost:3000>.

The app runs with no configuration: without Supabase credentials it serves the bundled `data/vessels.json` snapshot. To read the live database, create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
SUPABASE_SERVICE_KEY=your-secret-key
```

The `vessels` table has no public read policy. The browser never talks to Supabase. It calls `/api/vessels`, which reads with the secret key on the server and decides which columns are sent out. Never give the secret key a `NEXT_PUBLIC_` name: `next.config.js` refuses to build if one does.

## Build / deploy

```bash
npm run build && npm start
```

Deploys to Vercel on push to `main`. Set `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in the Vercel project.

## Data

- **Source of truth:** a hand-curated workbook, kept outside this repo, generated into the Supabase `vessels` table. Inclusion rule: a vessel in commercial service with a wind propulsion system **physically installed**. Ships on order are not included.
- **Snapshot:** `data/vessels.json`, used for first paint and as an offline fallback only.
- **Positions:** `scripts/refresh_positions.py` pulls positions from Open Waters AIS daily (`.github/workflows/refresh-positions.yml`, 05:00 UTC), then `scripts/build_routes.py` rebuilds `public/routes.json`. Coverage is dense near Europe and North America and thin mid-ocean, so some positions are a few days old. The card shows when each ship was last seen.
- **Ports:** destinations are parsed from AIS free text (`scripts/portlib.py`) and resolved through `lib/locodes.js` (curated), then `data/ports.json` (UN/LOCODE + NGA World Port Index), then `lib/ports.js`.
- **Wind:** `public/wind.json` (live GFS, `scripts/fetch_gfs_wind.py`, `.github/workflows/refresh-wind.yml`) and `public/wind-avg.json` (ERA5 climatology, `scripts/fetch_era5_wind.py`, run by hand).

## Project structure

```
app/
  page.jsx                 Globe explorer
  analytics/, makers/, data/  Open the explorer with that panel showing
  api/vessels/route.js     Server-side read of the fleet from Supabase

components/
  FleetExplorer.jsx        State owner: filters, selection, panels, side rail
  GlobeView.jsx            MapLibre globe, vessel points, routes, wind
  FilterPanel.jsx, VesselCard.jsx, VesselSearch.jsx, MakerPanel.jsx, PanelBar.jsx
  analytics/               AnalyticsDashboard, RibbonChart, ChartTip
  data/DataTable.jsx       Data table + export

lib/
  data.js                  Fleet fetch + snapshot fallback (the only importer of vessels.json)
  analytics.js             buildAnalytics(fleet): every chart and figure
  makers.js                Maker websites
  wind.js, windWash.js, windParticles.js   Wind layer
  ports.js, locodes.js     Port resolver

scripts/
  refresh_positions.py     Open Waters AIS -> Supabase
  build_routes.py          AIS tracks + searoute -> public/routes.json
  portlib.py, build_ports.py   Destination parsing, port table
  fetch_gfs_wind.py, fetch_era5_wind.py   Wind data
  export_vessels.cjs       Supabase -> data/vessels.json
```

---

Built by [Thomas Steip](https://www.linkedin.com/in/thomas-steip/). Feedback and corrections are welcome.
