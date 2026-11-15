// Turns an OpenStreetMap (Overpass "out geom") response into the compact JSON the game loads.
// Local coordinates: metres from the game's origin, x = east, z = south (see public/bbsr_plan.js).
import { project } from '../public/bbsr_plan.js';

const ROAD_WIDTH = { motorway: 14, trunk: 14, primary: 13, secondary: 12, tertiary: 10, unclassified: 8, residential: 7, living_street: 6, service: 5, pedestrian: 5 };
const MAIN = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

// smallest rotated rectangle around a footprint (tries every edge direction)
export function fitRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 0.5) continue;
    const c = (b[0] - a[0]) / len, s = (b[1] - a[1]) / len;           // direction (cos, sin) in the x-z plane
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const [x, z] of pts) { const u = x * c + z * s, v = -x * s + z * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) { const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2; best = { area, x: uc * c - vc * s, z: uc * s + vc * c, w: u1 - u0, d: v1 - v0, yaw: -Math.atan2(s, c) }; }
  }
  return best;
}
const polyArea = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return Math.abs(a) / 2; };
const r1 = (v) => Math.round(v * 10) / 10;

export function convert(data, { limit = 495 } = {}) {
  const roads = [], buildings = [], temples = [];
  const inside = (x, z) => Math.abs(x) <= limit && Math.abs(z) <= limit;
  for (const el of data.elements || []) {
    const t = el.tags || {};
    const geom = el.type === 'way' && Array.isArray(el.geometry) ? el.geometry.map((g) => { const p = project(g.lat, g.lon); return [p.x, p.z]; }) : null;
    if (t.amenity === 'place_of_worship' && t.name) {
      let x, z;
      if (el.type === 'node') { const p = project(el.lat, el.lon); x = p.x; z = p.z; }
      else if (geom && geom.length) { x = geom.reduce((s, q) => s + q[0], 0) / geom.length; z = geom.reduce((s, q) => s + q[1], 0) / geom.length; }
      if (x !== undefined && inside(x, z)) temples.push({ name: t.name, religion: t.religion || '', x: r1(x), z: r1(z) });
    }
    if (!geom || geom.length < 2) continue;
    if (t.highway && ROAD_WIDTH[t.highway]) {
      const pts = [];
      for (const p of geom) { const last = pts[pts.length - 1]; if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= 4) pts.push(p); }
      const kept = pts.filter(([x, z]) => inside(x, z)).map(([x, z]) => [r1(x), r1(z)]);
      if (kept.length >= 2) roads.push({ name: t.name || '', w: ROAD_WIDTH[t.highway], main: MAIN.has(t.highway), pts: kept });
    } else if (t.building && geom.length >= 4) {
      const poly = geom.slice(0, geom[0][0] === geom[geom.length - 1][0] && geom[0][1] === geom[geom.length - 1][1] ? -1 : undefined);
      const area = polyArea(poly);
      if (area < 18 || area > 8000) continue;
      const r = fitRect(poly);
      if (!r || !inside(r.x, r.z)) continue;
      const lv = parseInt(t['building:levels'], 10), h = parseFloat(t.height);
      buildings.push({ x: r1(r.x), z: r1(r.z), w: r1(Math.max(r.w, 3)), d: r1(Math.max(r.d, 3)), yaw: Math.round(r.yaw * 1000) / 1000, floors: Number.isFinite(lv) ? lv : Number.isFinite(h) ? Math.max(1, Math.round(h / 3.2)) : 0 });
    }
  }
  return { source: 'OpenStreetMap contributors (ODbL)', roads, buildings, temples };
}
