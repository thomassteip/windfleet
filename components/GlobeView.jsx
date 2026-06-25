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
  x.lineWidth = 4;
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

// Sample the wind grid into ocean-only points. `strideDeg` controls spacing;
// `withBearing` adds the direction (only the sparse arrow layer needs it). The
// dense set (every cell) feeds a blurred speed wash; the sparse set feeds the
// direction arrows.
function windPoints(grid, strideDeg, withBearing) {
  if (!grid) return { type: "FeatureCollection", features: [] };
  const { nlat, nlon, lat0, lon0, dlat, dlon, u, v } = grid;
  const stepI = Math.max(1, Math.round(strideDeg / Math.abs(dlat)));
  const stepJ = Math.max(1, Math.round(strideDeg / Math.abs(dlon)));
  const feats = [];
  for (let i = 0; i < nlat; i += stepI) {
    const lat = lat0 + dlat * i;
    if (Math.abs(lat) > 80) continue;
    for (let j = 0; j < nlon; j += stepJ) {
      const uu = u[i * nlon + j];
      const vv = v[i * nlon + j];
      const spd = Math.hypot(uu, vv);
      if (spd < 0.5) continue;
      let lng = lon0 + dlon * j;
      if (lng > 180) lng -= 360;
      if (pointOnLand(lng, lat)) continue; // ocean only
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

const windArrowsFC = (grid) => windPoints(grid, 4.5, true); // arrow field

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
  for (let i = 0; i < nlat; i++) {
    for (let j = 0; j < nlon; j++) {
      const spd = Math.hypot(u[i * nlon + j], v[i * nlon + j]);
      const [r, g, b] = speedColor(spd);
      const p = (i * nlon + j) * 4;
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
    if (cur.length && Math.abs(lng - cur[cur.length - 1][0]) > 180) {
      segs.push(cur);
      cur = [];
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
  onWindMeta,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const [err, setErr] = useState(null);
  const markersRef = useRef([]);
  const windGridRef = useRef(null);
  const windSpeedUrlRef = useRef(null);
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
  function shrinkLabels(map) {
    const layers = (map.getStyle() && map.getStyle().layers) || [];
    for (const l of layers) {
      if (l.type !== "symbol") continue;
      try {
        const ts = map.getLayoutProperty(l.id, "text-size");
        if (typeof ts === "number") {
          map.setLayoutProperty(l.id, "text-size", ts * 0.7);
        } else if (ts) {
          map.setLayoutProperty(l.id, "text-size", ["*", ts, 0.7]);
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
      map.addSource("wind-arrows", {
        type: "geojson",
        data: windArrowsFC(windGridRef.current),
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
          paint: { "raster-opacity": 0.5, "raster-fade-duration": 0 },
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
            // Small at world view, growing modestly with zoom (SDF keeps them
            // crisp at any size).
            "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.28, 4, 0.5, 7, 0.9],
          },
          paint: { "icon-color": ARROW_NEUTRAL, "icon-opacity": 1 },
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
    if (a) a.setData(windArrowsFC(windGridRef.current));
    updateWindVisibility();
  }

  function updateWindVisibility() {
    const map = mapRef.current;
    if (!map || !map.getLayer("wind-arrows-layer")) return;
    const { showWindColor, showWindBarbs } = windFlagsRef.current;
    // Independent toggles: speed = colour wash on water, direction = arrows.
    map.setLayoutProperty(
      "wind-speed",
      "visibility",
      showWindColor ? "visible" : "none"
    );
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

  // Load wind grid once; report metadata; feed the vector wind layers.
  useEffect(() => {
    loadWind()
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
  }, [onWindMeta]);

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

  // Wind toggles → just flip layer visibility / colouring.
  useEffect(() => {
    updateWindVisibility();
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
