# WindFleet

Interactive map of the global wind-assisted propulsion (WAPS) fleet — a Next.js + react-globe.gl app showing every commercial vessel installed with rotor sails, wing sails, suction sails, kites or traditional sails.

## Run locally

```bash
cd windfleet-app
npm install
npm run dev
```

Open http://localhost:3000.

## Build / deploy

```bash
npm run build && npm start
```

Deploys to Vercel with zero config: push to a Git repo and import it at vercel.com, or run `vercel` from this folder.

## Structure

- `app/` — Next.js App Router pages, layout, global styles.
- `components/FleetExplorer.jsx` — top-level state (filters, selection) and overlay layout.
- `components/GlobeView.jsx` — the WebGL globe and vessel points (client-only).
- `components/FilterPanel.jsx` — technology / type / install / year filters.
- `components/VesselCard.jsx` — per-vessel detail panel.
- `data/vessels.json` — 86 vessels exported from `WindFleet_database_v2.xlsx`.
- `lib/theme.js` — technology colour palette.

## Data notes

Vessel positions are **indicative**, assigned to plausible maritime regions from each vessel's owner/operator and trade pattern — not live AIS. Once IMO/MMSI numbers are filled in the source spreadsheet, real positions can replace these. To refresh the data, re-export from the spreadsheet to `data/vessels.json` keeping the same field names.

## Next steps

- Slide-out analytics panel (installs by year, tech market share, retrofit vs newbuild, top owners).
- `/data` raw table with CSV export.
- Real AIS positions once IMO numbers are available.
