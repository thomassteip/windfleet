// Small helpers shared by the hand-drawn and Recharts charts.

// Round axis ticks from 0 to just past `max`: 113 -> 0 25 50 75 100 125, not
// the 0 28 57 85 113 you get from cutting the max into quarters. Integers only;
// every count in this app is whole vessels or devices.
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Whole steps only: a 2.5 step on a small axis rounds to labels 0 3 5 8.
  const step = Math.max(
    1,
    [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw && Number.isInteger(s))
  );
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let t = 0; t <= top + 1e-9; t += step) ticks.push(Math.round(t));
  return ticks;
}
