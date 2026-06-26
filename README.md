# WindFleet

Interactive map and analytics for the global **wind-assisted propulsion (WAPS)** fleet — every commercial vessel installed with rotor sails, wing sails, suction sails, kites or traditional rig. Built with Next.js and react-globe.gl.

**🌐 Live app: https://windfleet.vercel.app**

You don't need to run anything to use WindFleet — just open the link above. The instructions below are for developing or self-hosting it.

## Features

- **3D globe** of the live fleet, coloured by wind technology, with light/dark basemaps (CARTO).
- **Filtering** by technology, vessel type, install status and year.
- **Vessel cards** with per-ship detail and photo.
- **Voyage routes** drawn as great-circle / sea-route ribbons (last port → current → destination).
- **Analytics dashboard** (`/analytics`) — installs by year, technology market share, and retrofit vs. newbuild.
- **Wind overlay** built from ERA5 monthly mean winds.

## Tech stack

- **Next.js 14** (App Router) + React 18, deployed on **Vercel**.
- **react-globe.gl** / **three.js** for the WebGL globe; **maplibre-gl** basemaps.
- **recharts** for the analytics charts.
- **searoute-js** for realistic sea routes between ports.
- **Supabase** (Postgres) as the live data source, with a bundled JSON snapshot as fallback.

## Run locally

```bash
git clone https://github.com/thomassteip/windfleet.git
cd windfleet
npm install
npm run dev
```

Open <http://localhost:3000>.

The app runs with no configuration — without Supabase credentials it serves the bundled `data/vessels.json` snapshot. To connect the live database, create `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The anon key is safe to expose in the browser — reads are read-only and gated by row-level security on the `vessels` table.

## Build / deploy

```bash
npm run build && npm start
```

Deploys to Vercel with zero config: push to a Git repo and import it at vercel.com, or run `vercel` from this folder. Set the two `NEXT_PUBLIC_SUPABASE_*` env vars in the Vercel project to enable the live database.

## Data

- **Source of truth:** the `vessels` table in Supabase (`supabase/init.sql` has the schema). The app reads it via `lib/data.js`; on any failure it falls back to the bundled snapshot.
- **Snapshot:** `data/vessels.json` — 102 vessels, exported from the WindFleet spreadsheet via `scripts/export_vessels.cjs`.
- **Positions are indicative.** They're assigned to plausible maritime regions from each vessel's owner/operator and trade pattern — not live AIS. `lib/ports.js` + `lib/locodes.js` resolve named ports to coordinates. Once IMO/MMSI numbers are filled in, real positions can replace these.
- **Daily refresh:** the GitHub Action `.github/workflows/refresh-positions.yml` runs `scripts/refresh_positions.py` at 05:00 UTC to scrape positions and update Supabase. It needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` repo secrets.

## Project structure

```
app/
  page.jsx              Home — loads the globe explorer (client-only)
  analytics/page.jsx    Analytics dashboard
  api/searoute/route.js Sea-route endpoint (searoute-js)
  layout.jsx, globals.css

components/
  FleetExplorer.jsx     Top-level state (filters, selection) + overlay layout
  GlobeView.jsx         WebGL globe, vessel points, route ribbons
  FilterPanel.jsx       Technology / type / install / year filters
  VesselCard.jsx        Per-vessel detail panel
  ThemeProvider.jsx     Light/dark theme context
  ThemeToggle.jsx       Theme switch
  analytics/            AnalyticsDashboard + RibbonChart

lib/
  data.js               Supabase fetch + snapshot fallback + row mapping
  supabase.js           Supabase client (null when env vars absent)
  analytics.js          Aggregations for the dashboard
  theme.js              Technology colour palette
  ports.js, locodes.js  Port-name -> coordinate resolver (UN/LOCODE)
  seaRouter.cjs, wind.js Sea-route helpers / wind overlay

scripts/
  export_vessels.cjs    Spreadsheet -> data/vessels.json
  build_routes.cjs/.py  Precompute voyage routes
  fetch_era5_wind.py    Build the ERA5 wind overlay
  refresh_positions.py  Daily position scrape -> Supabase

data/vessels.json       Bundled fleet snapshot (102 vessels)
public/routes.json      Precomputed routes
public/wind.json        Wind overlay
```

## Roadmap

- `/data` raw table with CSV export.
- Real AIS positions once IMO/MMSI numbers are available.

---

Built by [Thomas Steip](https://www.linkedin.com/in/thomas-steip/).
