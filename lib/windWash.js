// The wind-speed colour wash, drawn as a MapLibre custom WebGL layer: a
// lat/lng mesh wrapped round the whole globe, textured with one colour per
// wind-grid cell and blended smoothly between cells by the GPU.
//
// It replaced a Web-Mercator image source (Oct 2026), which had two flaws:
// - Mercator stops at ±85.05°, so the poles were an empty disc. This mesh
//   runs to ±89.999° (the last ~100 m is under a pixel at any zoom).
// - The image was stretched over exactly -180..180, but the grids don't start
//   there (GFS at -179.75, ERA5 at -177.5), and its two edges were never
//   blended into each other: a visible seam down the mid-Pacific. Here the
//   mesh starts AT the grid's own first column, and the texture carries a copy
//   of column 0 after the last one, so the wrap blends like any other cell.

import { speedColor } from "@/lib/wind";
import { compile, mercX, mercY } from "@/lib/windParticles";

const OPACITY = 0.4;
const STEP = 2; // mesh spacing in degrees: short enough to follow the sphere
const MAX_LAT = 89.999;

// How windy a cell is. The ERA5 "Average" grid carries its own `speed` array,
// because the length of the mean u/v vector is a DIFFERENT, much smaller
// quantity than the mean wind speed: where direction varies the components
// cancel, so the mid South Atlantic averages out to 0.22 m/s despite being
// windy nearly always. Live GFS is a single instant, so there hypot(u,v) is
// simply the speed.
function cellSpeed(grid, idx) {
  return grid.speed ? grid.speed[idx] : Math.hypot(grid.u[idx], grid.v[idx]);
}

// One RGBA texel per grid cell, plus a wrap column (a copy of column 0), in
// the grid's own row order: the shader maps latitude through lat0/dlat, so
// which hemisphere row 0 is doesn't matter (the two wind files disagree).
function gridTexels(grid) {
  const { nlat, nlon } = grid;
  const W = nlon + 1;
  const px = new Uint8Array(W * nlat * 4);
  for (let i = 0; i < nlat; i++) {
    for (let c = 0; c < W; c++) {
      const j = c % nlon;
      const [r, g, b] = speedColor(cellSpeed(grid, i * nlon + j));
      const p = (i * W + c) * 4;
      px[p] = r;
      px[p + 1] = g;
      px[p + 2] = b;
      px[p + 3] = 255;
    }
  }
  return { px, W, H: nlat };
}

// Mesh vertices: mercator position (for MapLibre's projectTile) + texture uv.
// Longitudes run from the grid's lon0 for a full 360°, so u never wraps
// inside a triangle.
function buildMesh(grid) {
  const { nlat, nlon, lat0, lon0, dlat, dlon } = grid;
  const W = nlon + 1;
  const lats = [];
  for (let a = -MAX_LAT; a < MAX_LAT; a += STEP) lats.push(a);
  lats.push(MAX_LAT);
  const cols = Math.round(360 / STEP);
  const verts = new Float32Array(lats.length * (cols + 1) * 4);
  let o = 0;
  for (const lat of lats) {
    const v = ((lat - lat0) / dlat + 0.5) / nlat;
    for (let k = 0; k <= cols; k++) {
      // lon0 .. lon0+360, deliberately NOT wrapped back into -180..180: the
      // globe treats mercator x as periodic, so x a hair past 1 is simply the
      // same meridian, and keeping it continuous means no triangle spans the seam.
      const L = lon0 + (k * 360) / cols;
      verts[o++] = mercX(L);
      verts[o++] = mercY(lat);
      verts[o++] = ((L - lon0) / dlon + 0.5) / W;
      verts[o++] = v;
    }
  }
  const idx = new Uint16Array((lats.length - 1) * cols * 6);
  let n = 0;
  for (let r = 0; r < lats.length - 1; r++) {
    for (let k = 0; k < cols; k++) {
      const a = r * (cols + 1) + k;
      const b = a + 1;
      const c = a + cols + 1;
      const d = c + 1;
      idx[n++] = a; idx[n++] = c; idx[n++] = b;
      idx[n++] = b; idx[n++] = c; idx[n++] = d;
    }
  }
  return { verts, idx };
}

const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() {
  gl_Position = projectTile(a_pos);
  v_uv = a_uv;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(c.rgb * u_opacity, u_opacity);
}`;

export function createWindWashLayer({ id, getGrid }) {
  let map = null;
  let vbo = null;
  let ibo = null;
  let tex = null;
  let count = 0;
  let builtFor = null;
  let failed = false;
  const programs = {};

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
      a_uv: gl.getAttribLocation(p, "a_uv"),
      u: {
        matrix: loc("u_projection_matrix"),
        fallback: loc("u_projection_fallback_matrix"),
        tile: loc("u_projection_tile_mercator_coords"),
        clip: loc("u_projection_clipping_plane"),
        transition: loc("u_projection_transition"),
        tex: loc("u_tex"),
        opacity: loc("u_opacity"),
      },
    };
    return programs[key];
  }

  // (Re)build the mesh and texture for a new grid (Live/Average switch).
  function upload(gl, grid) {
    const { verts, idx } = buildMesh(grid);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    count = idx.length;
    const { px, W, H } = gridTexels(grid);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    builtFor = grid;
  }

  return {
    id,
    type: "custom",
    renderingMode: "2d",

    onAdd(m, gl) {
      map = m;
      vbo = gl.createBuffer();
      ibo = gl.createBuffer();
      tex = gl.createTexture();
      builtFor = null;
    },

    onRemove(_m, gl) {
      gl.deleteBuffer(vbo);
      gl.deleteBuffer(ibo);
      gl.deleteTexture(tex);
      for (const k in programs) gl.deleteProgram(programs[k].p);
      map = null;
    },

    render(gl, args) {
      if (failed || !map) return;
      const grid = getGrid();
      if (!grid) return;
      try {
        if (grid !== builtFor) upload(gl, grid);
        const prog = programFor(gl, args.shaderData);
        gl.useProgram(prog.p);
        const pd = args.defaultProjectionData;
        gl.uniformMatrix4fv(prog.u.matrix, false, pd.mainMatrix);
        gl.uniformMatrix4fv(prog.u.fallback, false, pd.fallbackMatrix);
        gl.uniform4f(prog.u.tile, ...pd.tileMercatorCoords);
        gl.uniform4f(prog.u.clip, ...pd.clippingPlane);
        gl.uniform1f(prog.u.transition, pd.projectionTransition);
        gl.uniform1f(prog.u.opacity, OPACITY);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(prog.u.tex, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.enableVertexAttribArray(prog.a_pos);
        gl.vertexAttribPointer(prog.a_pos, 2, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(prog.a_uv);
        gl.vertexAttribPointer(prog.a_uv, 2, gl.FLOAT, false, 16, 8);

        gl.disable(gl.DEPTH_TEST);
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
        gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, 0);
        gl.disableVertexAttribArray(prog.a_pos);
        gl.disableVertexAttribArray(prog.a_uv);
      } catch (e) {
        console.error("[windWash] disabled:", e);
        failed = true;
      }
    },
  };
}
