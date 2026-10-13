// Animated wind particles: a MapLibre custom layer that draws thin, uncoloured
// streaks drifting with the wind, on top of the static speed-colour wash. The
// look is Windy's: colour says how strong, motion says which way, and because
// the particles carry no colour of their own they never fight the wash.
//
// How it works, briefly:
// - Particles live in lng/lat and are moved on the CPU each frame by the wind
//   at their position (bilinear between the four nearest grid cells, so they
//   glide instead of jerking at cell edges).
// - Each one keeps a short history of positions; that history is its trail.
//   Trails are geometry, redrawn every frame, NOT a faded copy of the previous
//   frame. That's what lets them stay pinned to the globe while it spins or is
//   dragged, and it means nothing ever darkens the colour wash underneath.
// - The GPU projects every point with MapLibre's own projection code
//   (shaderData.vertexShaderPrelude), so particles sit exactly on the globe and
//   the far side is clipped for free.
// - Particles are spawned at random SCREEN pixels, so density is per pixel of
//   visible ocean: zooming in packs more of them into the same stretch of sea.

import { feature } from "topojson-client";
import landTopo from "world-atlas/land-110m.json";

// ── Land mask ──────────────────────────────────────────────────────────────
// Particles are ocean-only, like the arrows they replaced. Testing a point
// against the land polygons is far too slow to do per particle per frame, so
// the coarse 110m land outline is painted once into a 0.25° raster and looked
// up by index. Built lazily (needs a canvas, so browser only).
const MASK_W = 1440;
const MASK_H = 720;
let LAND_MASK = null;

function landMask() {
  if (LAND_MASK) return LAND_MASK;
  const fc = feature(landTopo, landTopo.objects.land);
  const c = document.createElement("canvas");
  c.width = MASK_W;
  c.height = MASK_H;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.beginPath();
  const geoms = fc.type === "FeatureCollection" ? fc.features.map((f) => f.geometry) : [fc.geometry];
  for (const g of geoms) {
    if (!g) continue;
    const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
    for (const poly of polys) for (const ring of poly) traceRing(ctx, ring);
  }
  ctx.fill("evenodd"); // holes (lakes) stay water
  const px = ctx.getImageData(0, 0, MASK_W, MASK_H).data;
  LAND_MASK = new Uint8Array(MASK_W * MASK_H);
  for (let i = 0; i < LAND_MASK.length; i++) LAND_MASK[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  return LAND_MASK;
}

// Some rings cross the antimeridian (eastern Russia, Fiji): a naive trace
// jumps from +180 to -180 and back, and the fill then paints a band of false
// "land" right round the world. That band sat at ~65-70°N and blanked the
// Norwegian Sea. So unwrap the longitudes into one continuous ring and draw it
// at -360/0/+360, letting the canvas edge clip each copy. A ring that encircles
// a pole (Antarctica) doesn't close when unwrapped; it already spans -180..180
// with explicit edges, so it is drawn as-is.
function traceRing(ctx, ring) {
  const lngs = [ring[0][0]];
  for (let k = 1; k < ring.length; k++) {
    let d = ring[k][0] - ring[k - 1][0];
    if (d > 180) d -= 360;
    else if (d < -180) d += 360;
    lngs.push(lngs[k - 1] + d);
  }
  const closes = Math.abs(lngs[lngs.length - 1] - lngs[0]) < 1;
  const offsets = closes ? [-360, 0, 360] : [null];
  for (const off of offsets) {
    ring.forEach(([lng, lat], k) => {
      const L = off === null ? lng : lngs[k] + off;
      const x = ((L + 180) / 360) * MASK_W;
      const y = ((90 - lat) / 180) * MASK_H;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }
}

function onLand(mask, lng, lat) {
  let x = Math.floor(((lng + 180) / 360) * MASK_W);
  const y = Math.floor(((90 - lat) / 180) * MASK_H);
  x = ((x % MASK_W) + MASK_W) % MASK_W;
  if (y < 0 || y >= MASK_H) return true;
  return mask[y * MASK_W + x] === 1;
}

// ── Wind sampling ──────────────────────────────────────────────────────────
// Bilinear u/v at any lng/lat. Row order differs between the two wind files
// (GFS steps north, ERA5 steps south), so everything goes through lat0/dlat
// and never assumes which hemisphere row 0 is.
//
// Speed vs direction, same rule as the colour wash: the ERA5 "Average" grid
// carries its own mean `speed`, which is NOT the length of the mean u/v vector
// (that cancels out wherever the direction varies). So particles move along
// the prevailing u/v direction at the mean speed. Live GFS has no `speed`
// array, and there hypot(u, v) is simply the speed.
function makeSampler(grid) {
  const { nlat, nlon, lat0, lon0, dlat, dlon, u, v, speed } = grid;
  const out = { u: 0, v: 0, s: 0 };
  return (lng, lat) => {
    let fi = (lat - lat0) / dlat;
    if (fi < 0) fi = 0;
    else if (fi > nlat - 1) fi = nlat - 1;
    let fj = (lng - lon0) / dlon;
    fj = ((fj % nlon) + nlon) % nlon;
    const i0 = Math.floor(fi);
    const i1 = Math.min(i0 + 1, nlat - 1);
    const j0 = Math.floor(fj);
    const j1 = (j0 + 1) % nlon;
    const ti = fi - i0;
    const tj = fj - j0;
    const a = i0 * nlon + j0, b = i0 * nlon + j1, c = i1 * nlon + j0, d = i1 * nlon + j1;
    const w00 = (1 - ti) * (1 - tj), w01 = (1 - ti) * tj, w10 = ti * (1 - tj), w11 = ti * tj;
    const uu = u[a] * w00 + u[b] * w01 + u[c] * w10 + u[d] * w11;
    const vv = v[a] * w00 + v[b] * w01 + v[c] * w10 + v[d] * w11;
    const len = Math.hypot(uu, vv);
    if (speed) {
      const ss = speed[a] * w00 + speed[b] * w01 + speed[c] * w10 + speed[d] * w11;
      const k = len > 1e-3 ? ss / len : 0;
      out.u = uu * k;
      out.v = vv * k;
      out.s = ss;
    } else {
      out.u = uu;
      out.v = vv;
      out.s = len;
    }
    return out;
  };
}

// ── Tuning ─────────────────────────────────────────────────────────────────
const PX_PER_PARTICLE = 110; // one particle per this many CSS px² of visible ocean
// Slots vs live particles: a slot whose spawn pixel lands off the globe or on
// land sits dormant (costs nothing to draw), so slots scale with the whole
// screen while the LIVE count follows the visible sea. The live cap keeps the
// per-frame vertex upload bounded on a big screen full of ocean.
const MAX_SLOTS = 20000;
const MAX_LIVE = 4500;
const TRAIL = 10; // positions remembered per particle
const TRAIL_EVERY = 3; // record a trail point every Nth frame (longer trails, same cost)
const SPEED_PX = 0.05; // on-screen px per frame for each m/s of wind
const LIFE_MIN = 80; // frames (at 60 fps)
const LIFE_MAX = 160;
const HALF_WIDTH_CSS = 0.3; // streak half-width in CSS px
const MAX_LAT = 84;

const COLORS = {
  dark: [0.93, 0.96, 1.0, 0.4],
  light: [0.07, 0.12, 0.2, 0.32],
};

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_other;
attribute float a_side;
attribute float a_alpha;
uniform vec2 u_viewport;
uniform float u_half_width;
varying float v_alpha;
void main() {
  vec4 p = projectTile(a_pos);
  vec4 o = projectTile(a_other);
  vec2 d = (o.xy / o.w - p.xy / p.w) * u_viewport;
  float len = length(d);
  vec2 n = len > 1e-6 ? vec2(-d.y, d.x) / len : vec2(0.0);
  gl_Position = p + vec4(n * a_side * u_half_width * 2.0 / u_viewport * p.w, 0.0, 0.0);
  v_alpha = a_alpha;
}`;

const FRAG = `
precision mediump float;
uniform vec4 u_color;
varying float v_alpha;
void main() {
  float a = u_color.a * v_alpha;
  gl_FragColor = vec4(u_color.rgb * a, a);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || "shader compile failed");
  }
  return s;
}

const mercX = (lng) => (lng + 180) / 360;
const mercY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};

// getGrid() returns the current wind grid (or null); getTheme() "dark"|"light".
export function createWindParticleLayer({ id, getGrid, getTheme }) {
  let map = null;
  let buffer = null;
  const programs = {}; // keyed by shaderData.variantName (globe vs mercator)
  let failed = false;

  // Particle state, one entry per slot.
  const N = MAX_SLOTS;
  const lng = new Float32Array(N);
  const lat = new Float32Array(N);
  const age = new Float32Array(N);
  const life = new Float32Array(N);
  const len = new Uint8Array(N); // trail points held; 0 = dormant
  const hx = new Float32Array(N * TRAIL); // trail, mercator x/y, ring indexed by `ring`
  const hy = new Float32Array(N * TRAIL);
  const hs = new Float32Array(N); // last sampled speed (for calm fading)
  let ring = 0;
  let frame = 0;
  let lastT = 0;
  let live = 0;
  let lastCount = 0;
  let sampler = null;
  let samplerGrid = null;
  // 6 floats per vertex: pos.xy, other.xy, side, alpha. (2*TRAIL + 2) vertices
  // per particle: the strip plus one duplicated vertex at each end, which
  // makes zero-area triangles that stitch every trail into one draw call.
  const verts = new Float32Array(MAX_LIVE * (2 * TRAIL + 2) * 6);

  function reset() {
    for (let i = 0; i < N; i++) {
      len[i] = 0;
      age[i] = 0;
      life[i] = Math.random() * LIFE_MAX; // staggered, so they don't all appear at once
    }
    live = 0;
  }

  // Try ONE random screen pixel. Off the globe, on land, or too near a pole →
  // the particle stays dormant for a lifetime and tries again later. One try
  // (not "retry until it lands") keeps the live count proportional to how much
  // of the screen is open sea, which is what makes density follow zoom.
  function spawn(i, w, h, mask) {
    age[i] = 0;
    life[i] = LIFE_MIN + Math.random() * (LIFE_MAX - LIFE_MIN);
    len[i] = 0;
    if (live >= MAX_LIVE) return;
    const x = Math.random() * w;
    const y = Math.random() * h;
    const ll = map.unproject([x, y]);
    if (!ll || Math.abs(ll.lat) > MAX_LAT) return;
    // unproject() of a pixel off the edge of the globe still returns a point
    // (on the horizon); a round trip that doesn't come back is off-globe.
    const back = map.project(ll);
    if (Math.abs(back.x - x) > 2 || Math.abs(back.y - y) > 2) return;
    const L = ((ll.lng + 540) % 360) - 180;
    if (onLand(mask, L, ll.lat)) return;
    lng[i] = L;
    lat[i] = ll.lat;
    len[i] = 1;
    live++;
    hx[i * TRAIL + ring] = mercX(L);
    hy[i * TRAIL + ring] = mercY(ll.lat);
  }

  function step(dtFrames, count, w, h, mask) {
    // On-screen size of one degree at the view centre, MEASURED by projecting
    // two points rather than derived from the zoom level: MapLibre's globe
    // grows with the centre latitude at a fixed zoom (6x at 80°N, 12x at 89°N),
    // so the 512·2^zoom/360 formula made particles race over the poles.
    const c = map.getCenter();
    const p0 = map.project([c.lng, c.lat]);
    const p1 = map.project([c.lng, c.lat > 0 ? c.lat - 1 : c.lat + 1]);
    const pxPerDeg = Math.max(0.5, Math.hypot(p1.x - p0.x, p1.y - p0.y));
    const k = (SPEED_PX * dtFrames) / pxPerDeg; // degrees per (m/s)
    frame++;
    const advance = frame % TRAIL_EVERY === 0;
    if (advance) ring = (ring + 1) % TRAIL;
    for (let i = 0; i < count; i++) {
      age[i] += dtFrames;
      if (age[i] >= life[i]) {
        if (len[i] > 0) live--;
        spawn(i, w, h, mask);
        continue;
      }
      if (len[i] === 0) continue; // dormant
      const wnd = sampler(lng[i], lat[i]);
      hs[i] = wnd.s;
      const cosLat = Math.max(0.05, Math.cos((lat[i] * Math.PI) / 180));
      let L = lng[i] + (wnd.u * k) / cosLat;
      const A = lat[i] + wnd.v * k;
      let wrapped = false;
      if (L > 180) { L -= 360; wrapped = true; }
      else if (L < -180) { L += 360; wrapped = true; }
      if (Math.abs(A) > MAX_LAT || onLand(mask, L, A)) {
        age[i] = life[i]; // ran ashore or off the map: respawn next frame
        continue;
      }
      lng[i] = L;
      lat[i] = A;
      if (advance) {
        // Crossing the antimeridian restarts the trail, so no segment ever
        // spans the whole map (matters once the globe flattens to mercator).
        len[i] = wrapped ? 1 : Math.min(len[i] + 1, TRAIL);
      } else if (wrapped) {
        len[i] = 1;
      }
      hx[i * TRAIL + ring] = mercX(L);
      hy[i * TRAIL + ring] = mercY(A);
    }
  }

  // Pack every live trail into one triangle strip. Returns the vertex count.
  function pack(count) {
    let o = 0;
    const put = (x, y, ox, oy, side, a) => {
      verts[o++] = x; verts[o++] = y; verts[o++] = ox; verts[o++] = oy;
      verts[o++] = side; verts[o++] = a;
    };
    for (let i = 0; i < count; i++) {
      const n = len[i];
      if (n < 2) continue;
      // Fade in after spawning, out before dying; calm air reads quieter.
      const t = age[i];
      const fade = Math.min(1, t / 8, (life[i] - t) / 12);
      const calm = Math.min(1, 0.35 + hs[i] / 4);
      const base = Math.max(0, fade) * calm;
      if (base <= 0.01) continue;
      const startO = o;
      // oldest (k = n-1) → newest (k = 0)
      for (let k = n - 1; k >= 0; k--) {
        const idx = i * TRAIL + ((ring - k + TRAIL) % TRAIL);
        const x = hx[idx], y = hy[idx];
        // Neighbour that defines the streak direction: the next-newer point,
        // or for the head the previous one with the side flipped, so the
        // normal keeps pointing the same way along the whole strip.
        let ox, oy, sgn;
        if (k > 0) {
          const j = i * TRAIL + ((ring - k + 1 + TRAIL) % TRAIL);
          ox = hx[j]; oy = hy[j]; sgn = 1;
        } else {
          const j = i * TRAIL + ((ring - 1 + TRAIL) % TRAIL);
          ox = hx[j]; oy = hy[j]; sgn = -1;
        }
        const a = base * (1 - k / n); // tail fades to nothing
        put(x, y, ox, oy, sgn, a);
        put(x, y, ox, oy, -sgn, a);
      }
      // duplicate first and last vertices → degenerate stitching triangles
      const first = verts.slice(startO, startO + 6);
      verts.copyWithin(startO + 6, startO, o);
      verts.set(first, startO);
      o += 6;
      verts.copyWithin(o, o - 6, o);
      o += 6;
    }
    return o / 6;
  }

  function programFor(gl, shaderData) {
    const key = shaderData.variantName;
    if (programs[key]) return programs[key];
    const vs = compile(gl, gl.VERTEX_SHADER, `${shaderData.vertexShaderPrelude}\n${shaderData.define}\n${VERT}`);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) || "program link failed");
    }
    const loc = (n) => gl.getUniformLocation(p, n);
    programs[key] = {
      p,
      a_pos: gl.getAttribLocation(p, "a_pos"),
      a_other: gl.getAttribLocation(p, "a_other"),
      a_side: gl.getAttribLocation(p, "a_side"),
      a_alpha: gl.getAttribLocation(p, "a_alpha"),
      u: {
        matrix: loc("u_projection_matrix"),
        fallback: loc("u_projection_fallback_matrix"),
        tile: loc("u_projection_tile_mercator_coords"),
        clip: loc("u_projection_clipping_plane"),
        transition: loc("u_projection_transition"),
        viewport: loc("u_viewport"),
        halfWidth: loc("u_half_width"),
        color: loc("u_color"),
      },
    };
    return programs[key];
  }

  return {
    id,
    type: "custom",
    renderingMode: "2d",

    onAdd(m, gl) {
      map = m;
      buffer = gl.createBuffer();
      lastT = 0;
      reset();
    },

    onRemove(_m, gl) {
      if (buffer) gl.deleteBuffer(buffer);
      for (const k in programs) gl.deleteProgram(programs[k].p);
      buffer = null;
      map = null;
    },

    render(gl, args) {
      if (failed || !map) return;
      const grid = getGrid();
      if (!grid) return;
      if (grid !== samplerGrid) {
        sampler = makeSampler(grid);
        samplerGrid = grid;
        reset();
      }
      const now = performance.now();
      // After a pause (layer hidden, tab in background) start over rather than
      // teleporting every particle by a huge time step.
      if (!lastT || now - lastT > 250) reset();
      const dtFrames = lastT ? Math.min(3, (now - lastT) / 16.67) : 1;
      lastT = now;

      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const count = Math.min(N, Math.round((w * h) / PX_PER_PARTICLE));
      if (count !== lastCount) {
        reset(); // resized: start clean so no live particle is stranded past `count`
        lastCount = count;
      }
      const mask = landMask();
      step(dtFrames, count, w, h, mask);
      const nv = pack(count);

      try {
        const prog = programFor(gl, args.shaderData);
        gl.useProgram(prog.p);
        const pd = args.defaultProjectionData;
        gl.uniformMatrix4fv(prog.u.matrix, false, pd.mainMatrix);
        gl.uniformMatrix4fv(prog.u.fallback, false, pd.fallbackMatrix);
        gl.uniform4f(prog.u.tile, ...pd.tileMercatorCoords);
        gl.uniform4f(prog.u.clip, ...pd.clippingPlane);
        gl.uniform1f(prog.u.transition, pd.projectionTransition);
        gl.uniform2f(prog.u.viewport, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(prog.u.halfWidth, HALF_WIDTH_CSS * (gl.drawingBufferWidth / Math.max(1, w)));
        gl.uniform4f(prog.u.color, ...(COLORS[getTheme()] || COLORS.dark));

        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts.subarray(0, nv * 6), gl.DYNAMIC_DRAW);
        const stride = 24;
        gl.enableVertexAttribArray(prog.a_pos);
        gl.vertexAttribPointer(prog.a_pos, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(prog.a_other);
        gl.vertexAttribPointer(prog.a_other, 2, gl.FLOAT, false, stride, 8);
        gl.enableVertexAttribArray(prog.a_side);
        gl.vertexAttribPointer(prog.a_side, 1, gl.FLOAT, false, stride, 16);
        gl.enableVertexAttribArray(prog.a_alpha);
        gl.vertexAttribPointer(prog.a_alpha, 1, gl.FLOAT, false, stride, 20);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // colours are premultiplied
        if (nv > 0) gl.drawArrays(gl.TRIANGLE_STRIP, 0, nv);
        gl.disableVertexAttribArray(prog.a_pos);
        gl.disableVertexAttribArray(prog.a_other);
        gl.disableVertexAttribArray(prog.a_side);
        gl.disableVertexAttribArray(prog.a_alpha);
      } catch (e) {
        // Don't take the map down with us: the colour wash still shows.
        console.error("[windParticles] disabled:", e);
        failed = true;
        return;
      }
      map.triggerRepaint(); // keep animating while the layer is visible
    },
  };
}
