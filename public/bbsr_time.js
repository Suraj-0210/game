// Time of day for the Old Town. Pure maths (no three.js) so it can be tested in Node.
// One game day is CYCLE_MIN real minutes and everyone in the world shares it. Daylight (6 AM to 6 PM)
// gets 60% of the cycle and the night 40%, so the evenings are long enough to enjoy but the dark does not drag.
export const CYCLE_MIN = 30;
export const DAY_SHARE = 0.6;

export function hourAt(seconds) {
  const f = (((seconds / 60) / CYCLE_MIN) % 1 + 1) % 1;
  return f < DAY_SHARE ? 6 + (f / DAY_SHARE) * 12 : (18 + ((f - DAY_SHARE) / (1 - DAY_SHARE)) * 12) % 24;
}
export function clockText(h) {
  const m = Math.floor(h * 60) % 1440, hh = Math.floor(m / 60), mm = m % 60, ap = hh >= 12 ? 'PM' : 'AM';
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${ap}`;
}
const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
export { ss as smoothstep, lerp };

// Everything the renderer needs for hour h. Sun path: rises in the east (+x), crosses to the south (+z), sets in the west (-x).
export function skyAt(h) {
  const el = (72 * Math.PI / 180) * Math.sin(Math.PI * (h - 6) / 12);           // below zero at night
  const az = (90 - 15 * (h - 6)) * Math.PI / 180;
  const ce = Math.cos(el), e = Math.sin(el);
  const dir = [ce * Math.sin(az), e, ce * Math.cos(az)];
  return {
    hour: h, e, dir,
    moonDir: [-dir[0], -dir[1], -dir[2]],
    sunI: ss(-0.02, 0.28, e),                                // 0 at night, 1 in full daylight
    glow: Math.exp(-Math.pow(e / 0.17, 2)),                  // golden hour / twilight, strongest as the sun touches the horizon
    night: 1 - ss(-0.26, 0.03, e),                           // 1 when the sun is well below the horizon
    lampOn: 1 - ss(-0.07, 0.13, e),                          // street lamps, bulbs, temple lights
    env: lerp(0.07, 1, ss(-0.16, 0.26, e)),                  // how much sky light the surfaces pick up
    exposure: lerp(1, 1.22, 1 - ss(-0.1, 0.2, e)),
  };
}
