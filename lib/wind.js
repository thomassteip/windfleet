// Wind layer helpers: load the ERA5/placeholder grid and render it to an
// equirectangular canvas (speed colour + direction arrows) used as the globe
// surface texture.

export async function loadWind() {
  const res = await fetch("/wind.json");
  if (!res.ok) throw new Error("wind.json not found");
  return res.json();
}

// Speed (m/s) -> RGB. Saturated calm-blue -> teal -> green -> yellow -> red.
const STOPS = [
  [0, [21, 67, 140]],
  [3, [33, 113, 181]],
  [6, [26, 152, 150]],
  [9, [110, 188, 70]],
  [12, [240, 190, 55]],
  [15, [232, 120, 40]],
  [20, [198, 40, 45]],
];

export function speedColor(s) {
  if (s <= STOPS[0][0]) return STOPS[0][1];
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [s0, c0] = STOPS[i];
    const [s1, c1] = STOPS[i + 1];
    if (s <= s1) {
      const t = (s - s0) / (s1 - s0);
      return c0.map((c, k) => Math.round(c + t * (c1[k] - c)));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const SPEED_MAX = 20;
export const SPEED_LEGEND = STOPS.map(([s]) => s);

function makeSampler(grid) {
  const { nlat, nlon, lat0, lon0, dlat, dlon, u, v } = grid;
  const idx = (i, j) => i * nlon + j;
  return (lat, lng) => {
    let fi = (lat - lat0) / dlat;
    let fj = (lng - lon0) / dlon;
    let i = Math.max(0, Math.min(nlat - 1, Math.round(fi)));
    let j = ((Math.round(fj) % nlon) + nlon) % nlon;
    const uu = u[idx(i, j)];
    const vv = v[idx(i, j)];
    return { u: uu, v: vv, spd: Math.hypot(uu, vv) };
  };
}

// Build an opaque equirectangular texture (power-of-two for clean mipmapping).
// Returns the canvas element.
// `overlay` (used by the MapLibre map): draw a transparent background and
// semi-transparent speed cells so the basemap shows through; otherwise the
// texture is opaque (legacy globe-surface behaviour).
export function buildWindTexture(grid, { color, barbs, theme, oceanColor, overlay }) {
  const W = 4096;
  const H = 2048;
  const unit = W / 1600; // scale strokes drawn at the old reference size
  const sample = makeSampler(grid);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background — speed colours, or a flat ocean tint when colour is off.
  if (color) {
    const small = document.createElement("canvas");
    small.width = grid.nlon;
    small.height = grid.nlat;
    const sctx = small.getContext("2d");
    const img = sctx.createImageData(grid.nlon, grid.nlat);
    for (let i = 0; i < grid.nlat; i++) {
      for (let j = 0; j < grid.nlon; j++) {
        const lat = grid.lat0 + grid.dlat * i;
        const lng = grid.lon0 + grid.dlon * j;
        const { spd } = sample(lat, lng);
        const [r, g, b] = speedColor(spd);
        const p = (i * grid.nlon + j) * 4;
        img.data[p] = r;
        img.data[p + 1] = g;
        img.data[p + 2] = b;
        img.data[p + 3] = overlay ? 150 : 255;
      }
    }
    sctx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(small, 0, 0, W, H);
  } else if (!overlay) {
    ctx.fillStyle = oceanColor;
    ctx.fillRect(0, 0, W, H);
  }
  // overlay + barbs-only: leave the background transparent (basemap shows).

  // Direction arrows.
  if (barbs) {
    const stroke =
      theme === "dark" ? "rgba(235,240,248,0.82)" : "rgba(18,28,44,0.7)";
    ctx.strokeStyle = stroke;
    ctx.fillStyle = stroke;
    ctx.lineWidth = 1.3 * unit;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const stepDeg = 6;
    for (let lat = -84; lat <= 84; lat += stepDeg) {
      for (let lng = -180; lng < 180; lng += stepDeg) {
        const { u, v, spd } = sample(lat, lng);
        if (spd < 0.4) continue;
        const x = ((lng + 180) / 360) * W;
        const y = ((90 - lat) / 180) * H;
        const len = Math.max(6, Math.min(17, spd * 1.5)) * unit;
        const ang = Math.atan2(-v, u); // screen: +x east, -y north
        const ex = x + Math.cos(ang) * len;
        const ey = y + Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
        const ah = 4 * unit;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - ah * Math.cos(ang - 0.5), ey - ah * Math.sin(ang - 0.5));
        ctx.lineTo(ex - ah * Math.cos(ang + 0.5), ey - ah * Math.sin(ang + 0.5));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  return canvas;
}
