"use client";

import { memo, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { techColor } from "@/lib/theme";
import { loadWind, speedColor } from "@/lib/wind";
import { resolvePort } from "@/lib/ports";
import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";

// Coarse land outline, used only as a maths mask to keep wind arrows/dots off
// land (not rendered). 110m is tiny and plenty accurate at ~5° wind spacing.
const LAND_FC = feature(landTopo, landTopo.objects.land);
const LAND_POLYS = [];
{
  const geoms =
    LAND_FC.type === "FeatureCollection"
      ? LAND_FC.features.map((f) => f.geometry)
      : [LAND_FC.geometry];
  for (const g of geoms) {
    if (!g) continue;
    if (g.type === "MultiPolygon") LAND_POLYS.push(...g.coordinates);
    else if (g.type === "Polygon") LAND_POLYS.push(g.coordinates);
  }
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnLand(lng, lat) {
  for (const poly of LAND_POLYS) {
    if (!pointInRing(lng, lat, poly[0])) continue; // outside outer ring
    let inHole = false;
    for (let k = 1; k < poly.length; k++) {
      if (pointInRing(lng, lat, poly[k])) {
        inHole = true;
        break;
      }
    }
    if (!inHole) return true;
  }
  return false;
}

// CARTO basemaps — free, no API key, OpenStreetMap-derived vector tiles.
// Dark Matter / Positron keep the clean "intel" look and drive the dark/light
// toggle. MapLibre streams these by zoom level, so coastlines stay crisp at any
// zoom (no polygon triangulation, no freeze).
const STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

// Wind speed (m/s) → colour ramp, as a MapLibre interpolate expression. Mirrors
// the STOPS palette in lib/wind.js (calm blue → teal → green → amber → red).
const SPEED_COLOR = [
  "interpolate", ["linear"], ["get", "speed"],
  0, "#15438c", 3, "#2171b5", 6, "#1a9896",
  9, "#6ebc46", 12, "#f0be37", 15, "#e87828", 20, "#c6282d",
];
const ARROW_NEUTRAL = "#eaf2ff";

// Great-circle angular distance (degrees) between two lng/lat points.
function angularDistDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return Math.acos(Math.min(1, Math.max(-1, a))) / r;
}

// A thin stem + open chevron head as an SDF icon (icon-rotate turns it to the
// wind bearing). Deliberately a hairline shape, distinct from the filled
// vessel triangles, so it stays subtle and doesn't clutter the map.
function makeArrowImage() {
  const s = 48; // higher-res SDF source → stays crisp when scaled up on zoom
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const x = c.getContext("2d");
  x.clearRect(0, 0, s, s);
  x.strokeStyle = "#ffffff";
  x.lineWidth = 3;
  x.lineCap = "round";
  x.lineJoin = "round";
  // stem
  x.beginPath();
  x.moveTo(24, 40);
  x.lineTo(24, 11);
  x.stroke();
  // open chevron head (points up = north before rotation)
  x.beginPath();
  x.moveTo(14, 21);
  x.lineTo(24, 9);
  x.lineTo(34, 21);
  x.stroke();
  return { width: s, height: s, data: x.getImageData(0, 0, s, s).data };
}

// pointOnLand() walks every land ring, and the zoom-adaptive arrow field
// re-tests the SAME grid cells on every rebuild — so remember each cell's
// verdict. Lazily filled (-1 = not yet tested) rather than precomputed, so a
// coarse sample never pays for cells it doesn't visit. Keyed on the grid
// object, so switching Live/Average drops the stale mask automatically.
const LAND_MASK_CACHE = new WeakMap();
function landMaskFor(grid) {
  let mask = LAND_MASK_CACHE.get(grid);
  if (!mask) {
    mask = new Int8Array(grid.nlat * grid.nlon).fill(-1);
    LAND_MASK_CACHE.set(grid, mask);
  }
  return mask;
}

// Sample the wind grid into ocean-only points. `strideDeg` controls spacing;
// `withBearing` adds the direction (only the sparse arrow layer needs it). The
// dense set (every cell) feeds a blurred speed wash; the sparse set feeds the
// direction arrows.
function windPoints(grid, strideDeg, withBearing) {
  if (!grid) return { type: "FeatureCollection", features: [] };
  const { nlat, nlon, lat0, lon0, dlat, dlon, u, v } = grid;
  const stepI = Math.max(1, Math.round(strideDeg / Math.abs(dlat)));
  const land = landMaskFor(grid);
  const feats = [];
  for (let i = 0; i < nlat; i += stepI) {
    const lat = lat0 + dlat * i;
    if (Math.abs(lat) > 80) continue;
    // Longitude stride widens toward the poles so arrows stay evenly spaced
    // in real (great-circle) distance, not in degrees: a degree of longitude
    // shrinks to ~cos(lat) of its equatorial length as latitude rises, which
    // is what packed arrows on top of each other near the poles before.
    const cosLat = Math.cos((lat * Math.PI) / 180);
    const stepJ = Math.max(1, Math.round(strideDeg / (Math.abs(dlon) * cosLat)));
    for (let j = 0; j < nlon; j += stepJ) {
      const idx = i * nlon + j;
      const uu = u[idx];
      const vv = v[idx];
      const spd = Math.hypot(uu, vv);
      if (spd < 0.5) continue;
      let lng = lon0 + dlon * j;
      if (lng > 180) lng -= 360;
      if (land[idx] === -1) land[idx] = pointOnLand(lng, lat) ? 1 : 0;
      if (land[idx]) continue; // ocean only
      const props = { speed: Math.round(spd * 10) / 10 };
      if (withBearing) {
        props.bearing = Math.round(
          ((Math.atan2(uu, vv) * 180) / Math.PI + 360) % 360
        );
      }
      feats.push({
        type: "Feature",
        properties: props,
        geometry: { type: "Point", coordinates: [lng, lat] },
      });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

const windArrowsFC = (grid, strideDeg = 4.5) => windPoints(grid, strideDeg, true);

// Arrow spacing tightens as you zoom in, so the field reads as "more detail"
// rather than the same handful of arrows just growing bigger. Floored at 1.5°
// (public/wind.json's native grid resolution, see fetch_gfs_wind.py) — spacing
// arrows closer than the data's real resolution would just repeat the nearest
// cell's value, which reads as duplicated arrows rather than genuine detail.
function strideForZoom(zoom) {
  if (zoom < 2.5) return 4.5; // matches the whole-globe default view exactly
  if (zoom < 4) return 3;
  if (zoom < 5.5) return 2;
  return 1.5;
}

// Web-Mercator latitude limit + helper (image sources live in mercator space).
const WIND_MERC = 85.051129;
const WIND_YMAX = Math.log(Math.tan(Math.PI / 4 + (WIND_MERC * Math.PI) / 360));

// Continuous wind-speed colour field as a Web-Mercator PNG (data URL), land
// punched out so it only covers water. Smooth via bilinear upscale of the
// coarse grid; correctly projected so it sits right on the globe.
function buildWindSpeedDataURL(grid) {
  if (!grid || typeof document === "undefined") return null;
  const { nlat, nlon, lat0, lon0, dlat, dlon, u, v } = grid;
  // 1) coarse equirectangular colour image. Land cells are made transparent
  //    here (per grid cell — cheap and robust); the later bilinear upscale
  //    feathers the coastline so the wash stays water-only with a soft edge.
  const small = document.createElement("canvas");
  small.width = nlon;
  small.height = nlat;
  const sctx = small.getContext("2d");
  const img = sctx.createImageData(nlon, nlat);
  // Canvas row 0 has to be the NORTHERNMOST latitude — both the mercator remap
  // below and the image-source coordinates assume north is at the top. The two
  // wind sources disagree on row order: ERA5 (wind-avg.json) starts at +90 and
  // steps south (dlat < 0), GFS (wind.json) starts at -90 and steps north
  // (dlat > 0). Derive the direction from dlat instead of trusting either
  // convention, or the whole field renders upside down for one of them.
  const northFirst = dlat < 0;
  for (let i = 0; i < nlat; i++) {
    const row = northFirst ? i : nlat - 1 - i;
    for (let j = 0; j < nlon; j++) {
      const spd = Math.hypot(u[i * nlon + j], v[i * nlon + j]);
      const [r, g, b] = speedColor(spd);
      const p = (row * nlon + j) * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255; // full globe (land + sea); transparency via layer
    }
  }
  sctx.putImageData(img, 0, 0);
  // 2) smooth upscale (still equirectangular).
  const Wb = 1440, Hb = 720;
  const big = document.createElement("canvas");
  big.width = Wb;
  big.height = Hb;
  const bctx = big.getContext("2d");
  bctx.imageSmoothingEnabled = true;
  bctx.drawImage(small, 0, 0, Wb, Hb);
  // 3) remap rows equirect → mercator.
  const Wm = 1440, Hm = 1440;
  const merc = document.createElement("canvas");
  merc.width = Wm;
  merc.height = Hm;
  const mctx = merc.getContext("2d");
  for (let y = 0; y < Hm; y++) {
    const ym = WIND_YMAX * (1 - (2 * y) / Hm);
    const lat = ((2 * Math.atan(Math.exp(ym)) - Math.PI / 2) * 180) / Math.PI;
    const sv = Math.max(0, Math.min(Hb - 1, ((90 - lat) / 180) * Hb));
    mctx.drawImage(big, 0, sv, Wb, 1, 0, y, Wm, 1);
  }
  return merc.toDataURL("image/png");
}

// Initial great-circle bearing (degrees, 0 = north) from one point to another.
function bearing(from, to) {
  const rad = (d) => (d * Math.PI) / 180;
  const φ1 = rad(from.lat), φ2 = rad(to.lat), Δλ = rad(to.lng - from.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Which way the vessel's arrow should point. Prefers the real AIS course over
// ground, then the bearing toward the destination port, then the heading away
// from the last port. Returns null when no direction can be inferred (→ circle).
function markerDirection(d) {
  if (d.course != null && !Number.isNaN(d.course)) return d.course;
  const cur = { lat: d.lat, lng: d.lng };
  const dest = resolvePort(d.destination, d.destinationLocode);
  if (dest) return bearing(cur, dest);
  const last = resolvePort(d.lastPort, d.lastPortLocode);
  if (last) return bearing(last, cur);
  return null;
}

// Moored / anchored / barely moving vessels are drawn as a circle.
function isStationary(d) {
  if (d.navStatus && /moor|anchor/i.test(d.navStatus)) return true;
  return d.speed != null && d.speed < 0.5;
}

// Split a [lat,lng] polyline into [lng,lat] segments, breaking wherever two
// consecutive points jump more than 180° in longitude — i.e. the route crosses
// the antimeridian. Without this a dateline-crossing leg (common for trans-
// Pacific voyages) would draw as a streak straight across the whole map.
function splitAntimeridian(coords) {
  const segs = [];
  let cur = [];
  for (const [lat, lng] of coords) {
    if (cur.length) {
      const prevLng = cur[cur.length - 1][0];
      const prevLat = cur[cur.length - 1][1];
      if (Math.abs(lng - prevLng) > 180) {
        // The segment crosses the antimeridian. Interpolate the latitude at the
        // ±180 seam and add a point on each side, so the two halves meet at the
        // seam instead of leaving a visible gap in the middle of the ocean.
        const goingEast = lng < prevLng; // prev near +180, cur near -180
        const curUnwrapped = lng + (goingEast ? 360 : -360);
        const t =
          ((goingEast ? 180 : -180) - prevLng) / (curUnwrapped - prevLng);
        const seamLat = prevLat + t * (lat - prevLat);
        cur.push([goingEast ? 180 : -180, seamLat]);
        segs.push(cur);
        cur = [[goingEast ? -180 : 180, seamLat]];
      }
    }
    cur.push([lng, lat]);
  }
  if (cur.length) segs.push(cur);
  return segs.filter((s) => s.length > 1);
}

// paths carry [lat,lng] pairs; GeoJSON wants [lng,lat]. A path that crosses the
// dateline becomes a MultiLineString so it never streaks across the globe.
function routesFeatureCollection(paths) {
  return {
    type: "FeatureCollection",
    features: (paths || [])
      .filter((p) => p.coords && p.coords.length > 1)
      .map((p) => {
        const segs = splitAntimeridian(p.coords);
        return {
          type: "Feature",
          properties: {
            color: p.color,
            fleet: !!p.fleet,
            planned: !!p.planned,
          },
          geometry:
            segs.length > 1
              ? { type: "MultiLineString", coordinates: segs }
              : { type: "LineString", coordinates: segs[0] || [] },
        };
      })
      .filter((f) => f.geometry.coordinates.length > 0),
  };
}

function GlobeView({
  vessels,
  paths = [],
  selected,
  onSelect,
  onHover,
  theme = "dark",
  showWindColor = false,
  showWindBarbs = false,
  windVariant = "average",
  onWindMeta,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const [err, setErr] = useState(null);
  const markersRef = useRef([]);
  const windGridRef = useRef(null);
  const windSpeedUrlRef = useRef(null);
  const windStrideRef = useRef(4.5); // current arrow spacing (degrees), zoom-adaptive
  const spinRef = useRef({ raf: 0, enabled: true });
  const dashRef = useRef({ timer: 0, i: 0 });

  // Latest props mirrored into refs so the long-lived map callbacks always see
  // current values without re-binding.
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const pathsRef = useRef(paths);
  const themeRef = useRef(theme);
  const windFlagsRef = useRef({ showWindColor, showWindBarbs });
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  onHoverRef.current = onHover;
  pathsRef.current = paths;
  themeRef.current = theme;
  windFlagsRef.current = { showWindColor, showWindBarbs };

  // Shrink the basemap's place/country labels (CARTO ships them fairly large).
  //
  // text-size comes back in three different shapes and they don't scale the
  // same way: a plain number, a modern expression array, or CARTO's legacy
  // stop function ({ base, stops: [[zoom, size], ...] }). Feeding that last
  // one to ["*", …] is what MapLibre rejects as "Bare objects invalid" — so
  // scale its stop values directly, which also preserves the basemap's
  // zoom ramp instead of flattening every label to a single size.
  function shrinkLabels(map) {
    const layers = (map.getStyle() && map.getStyle().layers) || [];
    for (const l of layers) {
      if (l.type !== "symbol") continue;
      try {
        const ts = map.getLayoutProperty(l.id, "text-size");
        if (typeof ts === "number") {
          map.setLayoutProperty(l.id, "text-size", ts * 0.7);
        } else if (Array.isArray(ts)) {
          map.setLayoutProperty(l.id, "text-size", ["*", ts, 0.7]);
        } else if (ts && Array.isArray(ts.stops)) {
          map.setLayoutProperty(l.id, "text-size", {
            ...ts,
            stops: ts.stops.map(([zoom, size]) =>
              typeof size === "number" ? [zoom, size * 0.7] : [zoom, size]
            ),
          });
        } else {
          map.setLayoutProperty(l.id, "text-size", 9);
        }
      } catch (_) {}
    }
  }

  // ── Route line layers (re-added on every style load) ────────────────────
  function addRouteLayers(map) {
    if (!map.getSource("routes")) {
      map.addSource("routes", {
        type: "geojson",
        data: routesFeatureCollection(pathsRef.current),
      });
    }
    // Wide, blurred under-stroke gives every route a soft glow so it reads
    // clearly against the dark basemap.
    if (!map.getLayer("routes-glow")) {
      map.addLayer({
        id: "routes-glow",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["case", ["get", "fleet"], 3, 7],
          "line-blur": ["case", ["get", "fleet"], 2.5, 5],
          "line-opacity": 0.45,
        },
      });
    }
    // Fleet routes: crisp, bright, solid.
    if (!map.getLayer("routes-fleet")) {
      map.addLayer({
        id: "routes-fleet",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "fleet"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.7,
          "line-opacity": 0.95,
        },
      });
    }
    // Selected vessel's route: thicker, dashed (animated below).
    if (!map.getLayer("routes-active")) {
      map.addLayer({
        id: "routes-active",
        type: "line",
        source: "routes",
        filter: ["!=", ["get", "fleet"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3.2,
          "line-opacity": 1,
          "line-dasharray": [0.4, 0.4],
        },
      });
    }
  }

  // ── Vector wind layers (arrows for direction, dots for speed) ────────────
  // Replaces the old equirectangular raster: real geographic points are
  // occluded by the globe like any GL layer, never cover land as a solid
  // sheet, and don't distort at the poles.
  function addWindLayers(map) {
    if (!map.hasImage("wind-arrow")) {
      try {
        map.addImage("wind-arrow", makeArrowImage(), { sdf: true });
      } catch (_) {}
    }
    if (!windSpeedUrlRef.current) {
      windSpeedUrlRef.current = buildWindSpeedDataURL(windGridRef.current);
    }
    if (!map.getSource("wind-speed-img") && windSpeedUrlRef.current) {
      map.addSource("wind-speed-img", {
        type: "image",
        url: windSpeedUrlRef.current,
        coordinates: [
          [-180, WIND_MERC],
          [180, WIND_MERC],
          [180, -WIND_MERC],
          [-180, -WIND_MERC],
        ],
      });
    }
    if (!map.getSource("wind-arrows")) {
      windStrideRef.current = strideForZoom(map.getZoom());
      map.addSource("wind-arrows", {
        type: "geojson",
        data: windArrowsFC(windGridRef.current, windStrideRef.current),
      });
    }
    const firstSymbol = (map.getStyle().layers || []).find(
      (l) => l.type === "symbol"
    );
    const before = firstSymbol && firstSymbol.id;
    // Speed: a continuous, water-masked colour field (raster image), so it
    // reads as one smooth layer rather than dots.
    if (!map.getLayer("wind-speed") && map.getSource("wind-speed-img")) {
      // Keep the wash beneath the arrows (and labels).
      const speedBefore = map.getLayer("wind-arrows-layer")
        ? "wind-arrows-layer"
        : before;
      map.addLayer(
        {
          id: "wind-speed",
          type: "raster",
          source: "wind-speed-img",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.28, "raster-fade-duration": 0 },
        },
        speedBefore
      );
    }
    // Direction: sparse, thin chevron arrows.
    if (!map.getLayer("wind-arrows-layer")) {
      map.addLayer(
        {
          id: "wind-arrows-layer",
          type: "symbol",
          source: "wind-arrows",
          layout: {
            visibility: "none",
            "icon-image": "wind-arrow",
            "icon-rotate": ["get", "bearing"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            // Grows alongside strideForZoom()'s tightening spacing, so denser
            // fields also read as "more detail" rather than a wall of icons
            // the same size as the sparse world view (SDF keeps them crisp).
            // Kept deliberately small — vessels and routes are the point of
            // this map, wind is context, not the headline.
            "icon-size": [
              "interpolate", ["linear"], ["zoom"],
              1, 0.16, 2, 0.2, 3.5, 0.28, 5, 0.4, 7, 0.55, 10, 0.7,
            ],
          },
          paint: { "icon-color": ARROW_NEUTRAL, "icon-opacity": 0.7 },
        },
        before
      );
    }
  }

  function updateWindData() {
    const map = mapRef.current;
    if (!map) return;
    windSpeedUrlRef.current = buildWindSpeedDataURL(windGridRef.current);
    // Ensure the image source/layer exist now that the grid (and URL) are ready.
    if (map.isStyleLoaded()) addWindLayers(map);
    const f = map.getSource("wind-speed-img");
    if (f && windSpeedUrlRef.current) {
      f.updateImage({
        url: windSpeedUrlRef.current,
        coordinates: [
          [-180, WIND_MERC],
          [180, WIND_MERC],
          [180, -WIND_MERC],
          [-180, -WIND_MERC],
        ],
      });
    }
    const a = map.getSource("wind-arrows");
    if (a) a.setData(windArrowsFC(windGridRef.current, windStrideRef.current));
    updateWindVisibility();
  }

  // Re-samples the arrow field at a coarser/finer spacing as the camera zooms,
  // so arrows stay evenly spaced-looking rather than either a sparse wall of
  // icons up close or an illegible smear zoomed out.
  //
  // Not cheap: a rebuild at the tightest spacing is ~14k points on the live
  // grid, and it runs on the main thread. So skip it entirely while the arrows
  // are hidden — both wind toggles start off, which is the path most visitors
  // take. `windStrideRef` is only advanced when the data is actually rebuilt,
  // so it keeps describing what's really in the source; switching the arrows
  // on re-runs this (see the toggle effect) and picks up the current zoom.
  function updateWindArrowDensity() {
    const map = mapRef.current;
    if (!map || !windGridRef.current) return;
    if (!windFlagsRef.current.showWindBarbs) return;
    const stride = strideForZoom(map.getZoom());
    if (stride === windStrideRef.current) return;
    windStrideRef.current = stride;
    const a = map.getSource("wind-arrows");
    if (a) a.setData(windArrowsFC(windGridRef.current, stride));
  }

  function updateWindVisibility() {
    const map = mapRef.current;
    if (!map) return;
    const { showWindColor, showWindBarbs } = windFlagsRef.current;
    // Guard each layer independently: the wind grid loads after the map style,
    // so on first paint the arrows layer can exist before the speed layer does
    // (or vice-versa). Styling a layer that isn't there yet throws a maplibre
    // error — these layers get styled again once the grid finishes loading.
    if (map.getLayer("wind-speed")) {
      map.setLayoutProperty(
        "wind-speed",
        "visibility",
        showWindColor ? "visible" : "none"
      );
    }
    if (map.getLayer("wind-arrows-layer")) {
      map.setLayoutProperty(
        "wind-arrows-layer",
        "visibility",
        showWindBarbs ? "visible" : "none"
      );
      // Tint the arrows by speed when the speed layer is also on, else neutral.
      map.setPaintProperty(
        "wind-arrows-layer",
        "icon-color",
        showWindColor ? SPEED_COLOR : ARROW_NEUTRAL
      );
    }
  }

  // Hide vessel markers on the far side of the globe (DOM markers aren't
  // occluded by the GL sphere, so without this you see ships "through" the
  // earth). A point is on the near hemisphere when its great-circle angle from
  // the screen-centre lng/lat is < ~90°.
  function updateMarkerOcclusion() {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    for (const m of markersRef.current) {
      const ll = m.getLngLat();
      const hidden = angularDistDeg(c.lat, c.lng, ll.lat, ll.lng) > 91;
      const el = m.getElement();
      if (el) el.style.visibility = hidden ? "hidden" : "visible";
    }
  }

  // ── Vessel markers ──────────────────────────────────────────────────────
  function buildMarkerEl(d) {
    const isSelected = selectedRef.current && selectedRef.current.id === d.id;
    const color = isSelected ? "#34bbe6" : techColor(d.technology);
    const ring = themeRef.current === "dark" ? "#0b1220" : "#ffffff";
    const sz = isSelected ? 22 : 16;
    const glow = isSelected ? 7 : 4;

    const dir = markerDirection(d);
    const moving = dir != null && !isStationary(d);

    const el = document.createElement("div");
    el.className = "vessel-marker";
    el.style.cssText = "pointer-events:auto;cursor:pointer;line-height:0;";

    const marker = document.createElement("div");
    const base = moving ? `rotate(${dir}deg)` : "";
    marker.style.cssText = `transform:${base};transform-origin:50% 50%;transition:transform .15s ease;filter:drop-shadow(0 0 ${glow}px ${color});line-height:0;`;

    if (moving) {
      marker.innerHTML = `<svg width="${sz}" height="${sz}" viewBox="0 0 24 24" style="display:block"><path d="M12 1.5 L19.5 22 L12 17 L4.5 22 Z" fill="${color}" stroke="${ring}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    } else {
      const cd = Math.round(sz * 0.62);
      marker.innerHTML = `<div style="width:${cd}px;height:${cd}px;border-radius:50%;background:${color};border:2px solid ${ring};"></div>`;
    }
    el.appendChild(marker);

    el.addEventListener("click", (e) => {
      e.stopPropagation();
      onSelectRef.current && onSelectRef.current(d);
    });
    el.addEventListener("mouseenter", (e) => {
      marker.style.transform = `${base} scale(1.4)`;
      onHoverRef.current && onHoverRef.current(d, e);
    });
    el.addEventListener("mouseleave", () => {
      marker.style.transform = base;
      onHoverRef.current && onHoverRef.current(null);
    });
    el.title = `${d.name} · ${d.technology}`;
    return el;
  }

  function refreshMarkers() {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    (vessels || [])
      .filter((d) => d.lat != null && d.lng != null)
      .forEach((d) => {
        const m = new maplibregl.Marker({
          element: buildMarkerEl(d),
          rotationAlignment: "viewport",
          pitchAlignment: "viewport",
        })
          .setLngLat([d.lng, d.lat])
          .addTo(map);
        markersRef.current.push(m);
      });
    updateMarkerOcclusion();
  }

  // ── Map init (once) ─────────────────────────────────────────────────────
  useEffect(() => {
    let map;
    try {
      map = new maplibregl.Map({
        container: wrapRef.current,
        style: STYLE_URL[themeRef.current] || STYLE_URL.dark,
        center: [0, 25],
        zoom: 1.4,
        minZoom: 1.05,
        maxZoom: 15,
        dragRotate: false,
      });
    } catch (e) {
      console.error("[GlobeView] map init failed:", e);
      setErr("Map init failed: " + (e && e.message ? e.message : String(e)));
      return;
    }
    mapRef.current = map;

    // Surface style/tile/runtime errors on screen (Safari console is awkward).
    map.on("error", (e) => {
      const msg = e && e.error && e.error.message ? e.error.message : "unknown map error";
      console.error("[GlobeView] maplibre error:", e && e.error);
      setErr("Map error: " + msg);
    });

    map.on("style.load", () => {
      try {
        map.setProjection({ type: "globe" });
        shrinkLabels(map);
        addRouteLayers(map);
        addWindLayers(map);
        updateWindVisibility();
        setErr(null);
      } catch (e) {
        console.error("[GlobeView] style.load failed:", e);
        setErr("style.load failed: " + (e && e.message ? e.message : String(e)));
      }
    });

    // Click on empty ocean/land clears the selection. Marker clicks call
    // stopPropagation, and marker DOM sits above the canvas, so this only fires
    // for true background clicks.
    map.on("click", () => {
      onSelectRef.current && onSelectRef.current(null);
    });

    // Pause the idle spin as soon as the user grabs the globe.
    const stopSpin = () => {
      spinRef.current.enabled = false;
    };
    map.on("mousedown", stopSpin);
    map.on("touchstart", stopSpin);
    map.on("wheel", stopSpin);

    // Keep far-side markers hidden as the globe turns.
    map.on("render", updateMarkerOcclusion);

    // Wind arrows re-sample to a tighter/looser grid as the camera zooms.
    map.on("zoom", updateWindArrowDensity);

    // Gentle auto-rotate while idle and nothing is selected.
    const spin = () => {
      const m = mapRef.current;
      if (m && spinRef.current.enabled && !selectedRef.current && m.loaded()) {
        const c = m.getCenter();
        c.lng += 0.06;
        m.setCenter(c);
      }
      spinRef.current.raf = requestAnimationFrame(spin);
    };
    spinRef.current.raf = requestAnimationFrame(spin);

    // Animate the selected route's dashes (marching ants).
    const DASH_SEQ = [
      [0, 4, 3], [1, 4, 2, 1], [2, 4, 1, 2], [3, 4, 0, 3],
      [0, 1, 3, 3], [0, 2, 3, 2], [0, 3, 3, 1],
    ];
    dashRef.current.timer = setInterval(() => {
      const m = mapRef.current;
      if (!m || !m.isStyleLoaded() || !m.getLayer("routes-active")) return;
      dashRef.current.i = (dashRef.current.i + 1) % DASH_SEQ.length;
      m.setPaintProperty(
        "routes-active",
        "line-dasharray",
        DASH_SEQ[dashRef.current.i]
      );
    }, 90);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(wrapRef.current);

    return () => {
      cancelAnimationFrame(spinRef.current.raf);
      clearInterval(dashRef.current.timer);
      ro.disconnect();
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the wind grid (live GFS or ERA5 average, per windVariant); report
  // metadata; feed the vector wind layers. Re-runs whenever the variant
  // toggle changes, rebuilding both the colour wash and the arrow field.
  useEffect(() => {
    loadWind(windVariant)
      .then((g) => {
        windGridRef.current = g;
        onWindMeta &&
          onWindMeta({ source: g.source, nlat: g.nlat, nlon: g.nlon });
        updateWindData();
        updateWindVisibility();
      })
      .catch(() => {
        windGridRef.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWindMeta, windVariant]);

  // Theme change → swap basemap style (style.load re-adds routes + wind).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(STYLE_URL[theme] || STYLE_URL.dark);
    refreshMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  // Rebuild markers when the fleet or selection changes.
  useEffect(() => {
    refreshMarkers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vessels, selected]);

  // Push new route data into the live source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("routes");
    if (src) src.setData(routesFeatureCollection(paths));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  // Wind toggles → flip layer visibility / colouring, then catch the arrow
  // field up to the current zoom (density updates are skipped while hidden).
  useEffect(() => {
    updateWindVisibility();
    updateWindArrowDensity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWindColor, showWindBarbs]);

  // Fly to the selected vessel; stop the spin while focused.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (selected && selected.lat != null) {
      spinRef.current.enabled = false;
      map.flyTo({
        center: [selected.lng, selected.lat],
        zoom: Math.max(map.getZoom(), 3.4),
        duration: 900,
        essential: true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // A Fragment (not a wrapping div) keeps the map container a DIRECT child of
  // the sized parent, so `absolute inset-0` resolves to a real height. The
  // overlays are absolute siblings, so MapLibre never fights React for the
  // container's children.
  return (
    <>
      {/* h-screen = a definite 100vh height, so the map never collapses to 0
          even if the absolute-positioning height chain misbehaves. inset-x-0
          keeps the width following the wrapper (incl. quarter analytics mode). */}
      <div ref={wrapRef} className="absolute inset-x-0 top-0 h-screen" />
      {err && (
        <div className="absolute inset-x-0 top-0 z-50 m-3 rounded-lg border border-red-500/40 bg-red-950/80 p-3 text-center text-xs leading-relaxed text-red-200 backdrop-blur">
          {err}
        </div>
      )}
    </>
  );
}

// Memoized so pointer-move re-renders in the parent (hover card position)
// don't rebuild the map or every marker mid-interaction.
export default memo(GlobeView);
