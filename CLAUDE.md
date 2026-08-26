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
node scripts/build_routes.cjs           # -> public/routes.json
```

`init.sql` is a generated artifact — never hand-edit it, regenerate it.

Both build scripts look columns up **by header name**, and hard-fail if an expected
column is missing. Adding or reordering a column in the workbook is therefore safe; it
was not before Aug 2026, when they indexed by position and a single inserted column
would have silently shifted every field by one. Keep it that way. A new column needs
four edits: the workbook, `SHEET_FIELDS`/`FIELDS` in the two build scripts, the `create
table` block and `COLS` in `build_supabase_sql.py`, and `rowToVessel` in `lib/data.js`.

Pushing to `main` deploys the front end to Vercel but does **nothing** to the database.
Supabase is updated only by running the SQL by hand. Forgetting this step is the single
easiest way to ship a build that looks stale.

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
policy) · react-globe.gl + three · Recharts · deployed on Vercel.

Versions are pinned deliberately: `next` 14.2.35 and `three` 0.180.0. react-globe.gl
breaks on newer three — don't bump casually.

- `app/` — `/` globe explorer, `/analytics` dashboard, `/api/searoute`
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

- The globe freezes on higher-resolution land polygons. There's a custom simplified
  polygon file for this reason — don't raise the resolution.
- `app/globals.css` line 1 `@import`s Google Fonts. In a sandboxed shell with no network
  this makes `next build` hang forever at ~0% CPU with no error. Build on a machine with
  real network access.
- Position data is scraped from MyShipTracking by `scripts/refresh_positions.py` (daily
  GitHub Action, patches Supabase by row `id` using the service key). A cloud IP hitting
  them daily may eventually get blocked — if so, only `scrape_mst()` needs replacing.
- `.env.local` holds the Supabase URL + **anon** key (read-only, gitignored). The
  service key lives only in GitHub Actions secrets. Never commit either.

## Open ideas, not yet built

OEM drill-down page (fleet per WAPS maker) · back-filling the yard columns across the
fleet (yard league table) · OEM locations on the map · flat 2D map toggle alongside the globe · alluvial Technology→ship-type chart ·
`/data` raw table with CSV export · handling vessels that installed then uninstalled
(planned as a `Removed Year` column + cumulative-ever-installed vs currently-active).
