# WindFleet — context for Claude Code

Market-intel web app for the global wind-assisted propulsion (WAPS) shipping fleet.
Interactive 3D globe of every WAPS vessel + an analytics dashboard. Built in public
by Thomas Steip; the goal is thought leadership and a portfolio piece, not a product.

**Thomas is new to web development.** Explain tooling in plain terms — what a command
does and why, not just the command. Don't assume familiarity with npm, git internals,
build pipelines, or React idioms.

---

## Repo layout, and the thing that surprises people

The git repo root is `windfleet-app/`. The **database and its build scripts live one
level up, OUTSIDE the repo and untracked**:

```
Wind Assisted Fleet interactive mapping/     <- NOT a git repo
├── WindFleet_database.xlsx                  <- SOURCE OF TRUTH for vessel data
├── scripts/
│   ├── build_snapshot.py                    <- xlsx -> app snapshot
│   ├── build_supabase_sql.py                <- xlsx -> supabase/init.sql
│   └── fetch_positions.py                   <- AIS scrape
└── windfleet-app/                           <- git repo root, deploys to Vercel
```

So `git status` will never show a database edit. Back the workbook up manually before
changing it.

## Data flow

`WindFleet_database.xlsx` (specs, hand-curated) → generated `supabase/init.sql` →
pasted into the Supabase SQL editor → the app reads Supabase live at runtime.
`data/vessels.json` is a bundled snapshot used only for first paint and offline
fallback. Live AIS position/course/destination/photo are layered on by a daily
GitHub Action.

After editing the workbook:

```bash
cd ..
python3 scripts/build_snapshot.py       # xlsx -> windfleet-app/data/vessels.json
python3 scripts/build_supabase_sql.py   # xlsx -> windfleet-app/supabase/init.sql
# then paste init.sql into the Supabase SQL editor and Run (it drops + recreates)
cd windfleet-app
python3 scripts/build_routes.py         # -> public/routes.json (pip install searoute)
```

`init.sql` is a generated artifact — never hand-edit it, regenerate it.

Both build scripts look columns up **by header name**, and hard-fail if an expected
column is missing. Adding or reordering a column in the workbook is therefore safe; it
was not before Aug 2026, when they indexed by position and a single inserted column
would have silently shifted every field by one. Keep it that way. A new column needs
four edits: the workbook, `SHEET_FIELDS`/`FIELDS` in the two build scripts, the `create
table` block and `COLS` in `build_supabase_sql.py`, and `rowToVessel` in `lib/data.js`.

**Deleting a row from the workbook renumbers every vessel after it.** `id` comes from
row position, so removing one ship shifts all the ids below it up by one — and
`public/routes.json` is keyed by `id`. If you delete a row and don't rebuild the routes,
each shifted vessel silently draws *another ship's* voyage line, in that ship's
technology colour. It happened in Sep 2026: dropping "Ilha de Tinhare" (id 92) moved 20
vessels, and four of them ended up with tracks terminating thousands of km from the
actual ship. So after any row deletion, always:

```bash
python3 scripts/build_routes.py       # -> public/routes.json, keyed to the NEW ids
```

To check: the last point of a vessel's `travelled` leg should sit on its current
lat/lng — that's how the corruption was caught, and it's cheap to re-verify.

Pushing to `main` deploys the front end to Vercel but does **nothing** to the database.
Supabase is updated only by running the SQL by hand. Forgetting this step is the single
easiest way to ship a build that looks stale — and after an id shift it's worse than
stale, because a fresh `init.sql` against an old `routes.json` is what actually triggers
the wrong-route bug above.

## THE RULE: one source of truth for the fleet

**Never import `data/vessels.json` anywhere except `lib/data.js`.**

In Aug 2026 the analytics page showed 102 vessels while the map showed 104. It wasn't a
counting bug: `lib/analytics.js` computed every export at module load from the bundled
snapshot, while `FleetExplorer` fetched live from Supabase. The snapshot had gone stale,
so *every chart on the dashboard* was drawing the wrong fleet — the KPI just happened to
be the visible symptom.

The fix, and the invariant to preserve:

- `lib/analytics.js` exports `buildAnalytics(fleet)` — a pure function of the array you
  hand it — plus `FALLBACK_ANALYTICS` for first paint only.
- `AnalyticsDashboard` takes an optional `vessels` prop. `FleetExplorer` passes its live
  fleet down (no second fetch); the standalone `/analytics` route fetches for itself via
  the same `fetchVessels()`.
- Adding a chart means deriving it **inside** `buildAnalytics`. Don't reach for the JSON.

## Stack

Next.js 14 (App Router, JS not TS) · Tailwind · Supabase (read-only anon key, RLS select
policy) · MapLibre GL (globe projection) · Recharts · deployed on Vercel.

`next` is pinned at 14.2.35 deliberately — bump with care.

- `app/` — `/` globe explorer, `/analytics` dashboard
- `components/` — `FleetExplorer` (state owner), `GlobeView`, `FilterPanel`, `VesselCard`
- `components/analytics/` — `AnalyticsDashboard`, `RibbonChart`
- `lib/` — `data.js` (Supabase + fallback), `analytics.js`, `theme.js`, `wind.js`, `ports.js`

`AnalyticsDashboard` renders in two places: the `/analytics` page, and a slide-out panel
inside `FleetExplorer` (right-edge handle). Both paths must keep working — check both
after touching it.

## Design system

Set in June 2026, don't drift from it:

- Type: IBM Plex Mono for the wordmark and **all numbers/data**; IBM Plex Sans for labels.
- Wordmark: lowercase `windfleet`, two-tone monochrome (bright "wind", muted "fleet"),
  no coloured accent.
- Light **and** dark themes, toggle in the header, persisted to `localStorage` key
  `wf-theme`, no-flash script in `layout.jsx`. Tailwind darkMode selector is
  `[data-theme="dark"]`.
- Colours are CSS-variable RGB channels in `globals.css` mapped to tokens
  (ink/panel/edge/muted/fg/accent). **Use `text-fg`, never `text-white`.**
- Palette is IEA "pop" categorical, in `lib/theme.js` as `POP`. `TECH_COLORS`:
  Rotor=cyan, Suction=orange, Wing=green, Traditional=purple, Kite=yellow.
- Charts are cross-filtered: clicking a technology fades non-matching segments across
  the tech-based charts, and highlights the matching dots on the globe.

## Domain rules

A **WAPS vessel** = any vessel in commercial service (cargo or fare-paying passenger)
fitted with a wind propulsion device, at any size — 292 dwt sail-cargo through VLOC,
rotor/suction/wing/rigid/kite/traditional rigs, wind as main or assisting propulsion.
Excluded: private yachts, sail-training vessels, naval ships, pure R&D demonstrators,
and anything on order until the system is **physically installed**.

`Installed Year` = the year the system was fitted, not the year the deal was announced.
`Status` enum is Active / Removed / Decommissioned (all rows currently Active).

`Build Yard` = who built the hull. `Install Yard` = who physically fitted the wind
system. For newbuilds these are usually the same yard (the rig goes on during
construction); for retrofits they diverge, and that gap is the interesting signal —
Baltic Timber was built at Damen Yichang and fitted at Damen Shiprepair Harlingen.
Coverage is deliberately partial (10 of 112 as of Aug 2026): **leave a yard blank rather
than guessing.** Honest gaps beat invented yards.

Rows whose Notes contain `VERIFY` have unconfirmed data — usually a missing IMO or an
inferred spec. Don't treat them as settled, and don't silently "clean" them.

Vessels with no IMO/MMSI are skipped by the position scraper, so they render no globe
dot. They still count in every total — that's intended, not a bug.

## Gotchas

- The globe's rendered land/coastlines come from the CARTO vector-tile basemaps, not
  from GeoJSON polygons — that's what keeps them crisp at any zoom with no freeze.
  `world-atlas/land-110m.json` in `GlobeView` is a separate, invisible thing: a coarse
  land/ocean mask used only to keep wind arrows and the wind-speed wash off land.
- The Wind layer has two data sources, picked with the Live/Average switch
  (`FleetExplorer`'s `windVariant` state, passed to `GlobeView` and `lib/wind.js`'s
  `loadWind(variant)`): "Live" reads `public/wind.json`, refreshed from NOAA's GFS 10m
  wind analysis (free, no API key, straight from NOMADS) twice daily by
  `scripts/fetch_gfs_wind.py` via `.github/workflows/refresh-wind.yml`. "Average" reads
  `public/wind-avg.json`, a static 1995-2025 ERA5 climatology from
  `scripts/fetch_era5_wind.py` (run by hand, needs a free CDS API key — see the script's
  docstring; it changes rarely enough that it isn't automated). Same JSON schema, both
  files — don't let that fool you into thinking they're kept in sync automatically, they
  aren't and shouldn't be. Both the direction arrows and the speed wash read whichever
  file is currently selected.
- **The two wind files store their rows in opposite order**, and it is not cosmetic:
  `wind-avg.json` starts at +90 and steps south (`dlat` negative), `wind.json` starts at
  -90 and steps north (`dlat` positive). Anything that treats row 0 as a fixed hemisphere
  renders one of them upside down — which is exactly what `buildWindSpeedDataURL()` did
  until Sep 2026, painting the Southern Ocean's winds over the Arctic whenever you picked
  "Live". Derive direction from the sign of `dlat`; never assume. It hid for a while
  because the toggle defaults to "Average", the one that happened to match.
- `app/globals.css` line 1 `@import`s Google Fonts. In a sandboxed shell with no network
  this makes `next build` hang forever at ~0% CPU with no error. Build on a machine with
  real network access.
- Position data is scraped by `scripts/refresh_positions.py` (daily GitHub Action,
  patches Supabase by row `id` using the service key), from TWO sources: MyShipTracking
  for position/speed/course/nav-status/photo, VesselFinder for destination, last port
  and their UN/LOCODEs. The VesselFinder pass is best-effort — if it fails, the position
  fields still get written. A cloud IP hitting either daily may eventually get blocked;
  if so only `scrape_mst()` / `scrape_vf_voyage()` need replacing.
- `python3 scripts/refresh_positions.py --probe <IMO>` prints what the VesselFinder
  parser sees for one vessel without touching Supabase. Use it first if the LOCODE
  columns stop filling — it means VesselFinder restructured their markup.
- LOCODEs matter because port NAMES are ambiguous: "NEWCASTLE" is both Australia and
  the Tyne, and `lib/ports.js` has a single entry pointing at Australia. `resolvePort()`
  tries the LOCODE first, so filling those columns is what makes voyage lines correct
  rather than usually-correct.
- `.env.local` holds the Supabase URL + **anon** key (read-only, gitignored). The
  service key lives only in GitHub Actions secrets. Never commit either.

## Open ideas, not yet built

OEM drill-down page (fleet per WAPS maker) · back-filling the yard columns across the
fleet (yard league table) · OEM locations on the map · flat 2D map toggle alongside the globe · alluvial Technology→ship-type chart ·
`/data` raw table with CSV export · handling vessels that installed then uninstalled
(planned as a `Removed Year` column + cumulative-ever-installed vs currently-active).
