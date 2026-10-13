"use client";

import { memo, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { techColor } from "@/lib/theme";
import { loadWind, speedColor } from "@/lib/wind";
import { createWindParticleLayer } from "@/lib/windParticles";
import { resolvePort } from "@/lib/ports";
// CARTO basemaps — free, no API key, OpenStreetMap-derived vector tiles.
// Dark Matter / Positron keep the clean "intel" look and drive the dark/light
// toggle. MapLibre streams these by zoom level, so coastlines stay crisp at any
// zoom (no polygon triangulation, no freeze).
const STYLE_URL = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

// Great-circle angular distance (degrees) between two lng/lat points.
function angularDistDeg(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180;
  const a =
    Math.sin(lat1 * r) * Math.sin(lat2 * r) +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lng2 - lng1) * r);
  return Math.acos(Math.min(1, Math.max(-1, a))) / r;
}

// How windy a cell is. The ERA5 "Average" grid carries its own `speed` array,
// because the length of the mean u/v vector is a DIFFERENT, much smaller
// quantity than the mean wind speed: where direction varies the components
// cancel, so the mid South Atlantic averages out to 0.22 m/s despite being
// windy nearly always. Live GFS is a single instant, so there hypot(u,v) is
// simply the speed. u/v still give the direction in both cases.
function cellSpeed(grid, idx) {
  return grid.speed
    ? grid.speed[idx]
    : Math.hypot(grid.u[idx], grid.v[idx]);
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
      const spd = cellSpeed(grid, i * nlon + j);
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
            preview: !!p.preview,
            inferred: !!p.inferred,
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
  showWind = false,
  windVariant = "average",
  onWindMeta,
}) {
  const wrapRef = useRef(null);
  const mapRef = useRef(null);
  const [err, setErr] = useState(null);
  const markersRef = useRef([]);
  const windGridRef = useRef(null);
  const windSpeedUrlRef = useRef(null);
  const styleReadyRef = useRef(false); // between style.load and the next setStyle
  const spinRef = useRef({ raf: 0, enabled: true });
  const dashRef = useRef({ timer: 0, i: 0 });

  // Latest props mirrored into refs so the long-lived map callbacks always see
  // current values without re-binding.
  const selectedRef = useRef(selected);
  const onSelectRef = useRef(onSelect);
  const onHoverRef = useRef(onHover);
  const pathsRef = useRef(paths);
  const themeRef = useRef(theme);
  const showWindRef = useRef(showWind);
  selectedRef.current = selected;
  onSelectRef.current = onSelect;
  onHoverRef.current = onHover;
  pathsRef.current = paths;
  themeRef.current = theme;
  showWindRef.current = showWind;

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
          "line-width": ["case", ["get", "preview"], 3, 7],
          "line-blur": ["case", ["get", "preview"], 2.5, 5],
          "line-opacity": [
            "*",
            ["case", ["get", "preview"], 0.3, 0.45],
            ["case", ["get", "inferred"], 0.5, 1],
          ],
        },
      });
    }
    // Hovered vessel's route: a thin, faint preview of both legs.
    if (!map.getLayer("routes-preview")) {
      map.addLayer({
        id: "routes-preview",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "preview"], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 1.7,
          "line-opacity": ["case", ["get", "inferred"], 0.35, 0.75],
        },
      });
    }
    // Selected vessel, where it has been: thick and solid. Stretches where the
    // AIS receivers lost the ship (gaps filled by searoute) are fainter, so
    // the observed track and the inferred one never look the same.
    if (!map.getLayer("routes-travelled")) {
      map.addLayer({
        id: "routes-travelled",
        type: "line",
        source: "routes",
        filter: ["all", ["!=", ["get", "preview"], true], ["!=", ["get", "planned"], true]],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3.2,
          "line-opacity": ["case", ["get", "inferred"], 0.4, 1],
        },
      });
    }
    // Selected vessel, where it is heading: thick, dashed (animated below).
    if (!map.getLayer("routes-active")) {
      map.addLayer({
        id: "routes-active",
        type: "line",
        source: "routes",
        filter: ["all", ["!=", ["get", "preview"], true], ["==", ["get", "planned"], true]],
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

  // ── Wind layers: a static speed-colour wash + animated white particles ───
  // Windy's recipe: colour says how strong, motion says which way. The
  // particles carry no colour of their own, so they never fight the wash.
  function addWindLayers(map) {
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
    const firstSymbol = (map.getStyle().layers || []).find(
      (l) => l.type === "symbol"
    );
    const before = firstSymbol && firstSymbol.id;
    // Particles: a custom WebGL layer (lib/windParticles.js). Only animates
    // while visible; hidden, MapLibre never calls its render().
    if (!map.getLayer("wind-particles")) {
      map.addLayer(
        createWindParticleLayer({
          id: "wind-particles",
          getGrid: () => windGridRef.current,
          getTheme: () => themeRef.current,
        }),
        before
      );
      map.setLayoutProperty("wind-particles", "visibility", "none");
    }
    // Speed: a continuous colour field (raster image), kept beneath the
    // particles (and the labels).
    if (!map.getLayer("wind-speed") && map.getSource("wind-speed-img")) {
      map.addLayer(
        {
          id: "wind-speed",
          type: "raster",
          source: "wind-speed-img",
          layout: { visibility: "none" },
          paint: { "raster-opacity": 0.4, "raster-fade-duration": 0 },
        },
        "wind-particles"
      );
    }
  }

  function updateWindData() {
    const map = mapRef.current;
    if (!map) return;
    windSpeedUrlRef.current = buildWindSpeedDataURL(windGridRef.current);
    // Ensure the image source/layer exist now that the grid (and URL) are ready.
    // Not isStyleLoaded(): that stays false while any source is still
    // fetching, so a grid that arrived just after style.load used to leave
    // the wash un-added for good. Layers can be added any time after
    // style.load; if that hasn't happened yet, style.load adds them itself.
    if (styleReadyRef.current) addWindLayers(map);
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
    updateWindVisibility();
  }

  function updateWindVisibility() {
    const map = mapRef.current;
    if (!map) return;
    const vis = showWindRef.current ? "visible" : "none";
    // Guard each layer: the wind grid loads after the map style, so the
    // particle layer can exist before the speed layer does.
    for (const id of ["wind-speed", "wind-particles"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", vis);
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
        // Credits live in our own InfoButton (OSM/CARTO text included).
        attributionControl: false,
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
        styleReadyRef.current = true;
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

  // Load the wind grid (live GFS or ERA5 average, per windVariant); report
  // metadata; feed the wind layers. Re-runs whenever the variant toggle
  // changes, rebuilding the colour wash (the particles pick the new grid up
  // on their next frame).
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
    styleReadyRef.current = false;
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

  // Wind toggle → show/hide the wash and the particles together.
  useEffect(() => {
    updateWindVisibility();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showWind]);

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
