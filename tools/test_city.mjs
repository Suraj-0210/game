// The connected city, without a browser: every area is placed, the connector roads are clear, and every area stays walkable from the spawn.
// Run: node tools/test_city.mjs
import { buildPlan } from '../public/bbsr_plan.js';
import { ZONES, buildZonePlan } from '../public/bbsr_zones.js';
import { LAYOUT, LINKS, BOUNDS, HALF_TILE, offsetPlan, areaAt } from '../public/bbsr_city.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const realFile = (id) => { try { return JSON.parse(fs.readFileSync(new URL(`../public/data/real_${id}.json`, import.meta.url), 'utf8')); } catch (e) { return null; } };

const PR = 0.4, parts = [];
for (const z of ZONES) { const p = z.id === 'oldtown' ? buildPlan(realFile('oldtown') || JSON.parse(fs.readFileSync(new URL('../public/data/oldtown_osm.json', import.meta.url), 'utf8'))) : buildZonePlan(z.id, realFile(z.id)); const [ox, oz] = LAYOUT[z.id]; offsetPlan(p, ox, oz); parts.push({ id: z.id, ox, oz, plan: p }); }
// no two areas overlap, and all links join areas that share an edge
const ids = Object.keys(LAYOUT);
for (const a of ids) for (const b of ids) if (a < b) { const [ax, az] = LAYOUT[a], [bx, bz] = LAYOUT[b]; assert.ok(Math.abs(ax - bx) > 2 * HALF_TILE || Math.abs(az - bz) > 2 * HALF_TILE, `${a} overlaps ${b}`); }
for (const [a, b] of LINKS) { const [ax, az] = LAYOUT[a], [bx, bz] = LAYOUT[b]; assert.ok(ax === bx || az === bz, `${a}-${b} not aligned`); }
// spot and object ids are unique across the city
const seen = new Set();
for (const pt of parts) for (const sp of pt.plan.spots || []) { assert.ok(!seen.has(sp.id), 'duplicate spot ' + sp.id); seen.add(sp.id); }
for (const pt of parts) { const nid = new Set(); for (const n of pt.plan.npcs) assert.ok(!nid.has(n.id)); }
const allNpc = parts.flatMap((p) => p.plan.npcs.map((n) => n.id)); assert.equal(new Set(allNpc).size, allNpc.length, 'duplicate npc ids');
// everything gameplay-related lies inside its own area after the offset
for (const pt of parts) {
  for (const it of pt.plan.interactables) assert.equal(areaAt(it.x, it.z), pt.id, `${pt.id}: interactable ${it.id} outside its area (${it.x},${it.z})`);
  for (const sp of pt.plan.spots || []) assert.equal(areaAt(sp.x, sp.z), pt.id, `${pt.id}: spot ${sp.id} outside its area`);
}
// connector roads: sample along each road and 40 m into both areas; nothing solid may stand on the road
const boxes = parts.flatMap((p) => p.plan.boxes), circles = parts.flatMap((p) => p.plan.circles);
const solid = (x, z, y = 0) => {
  for (const c of circles) if (Math.hypot(x - c.x, z - c.z) < c.r + PR && !(c.y1 < y || c.y0 > y + 1.8)) return true;
  for (const b of boxes) {
    if (Math.abs(x - b.x) > 60 || Math.abs(z - b.z) > 60) continue;
    if ((b.y0 !== undefined && b.y0 > y + 1.8) || (b.y1 !== undefined && b.y1 < y)) continue;
    const c = Math.cos(b.theta), s = Math.sin(b.theta), dx = x - b.x, dz = z - b.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
    const ex = Math.max(Math.abs(lx) - b.hw, 0), ez = Math.max(Math.abs(lz) - b.hd, 0);
    if (ex * ex + ez * ez < PR * PR) return true;
  }
  return false;
};
// flyovers: you can walk up the ramp, along the deck and down the other side, and walk underneath the high part
const deckAt = (f, s) => { const g = (f.off || 0) + s, T = f.tot || f.L; return g < f.ramp ? (f.h * g) / f.ramp : T - g < f.ramp ? (f.h * (T - g)) / f.ramp : f.h; };
let nfly = 0;
for (const pt of parts) for (const f of pt.plan.flyovers || []) {
  nfly++;
  for (let s = 0; s <= f.L; s += 0.5) for (const lat of [0]) {   // the centre line (real dual carriageways run close together, so their parapets can touch near the sides)
    const x = f.x0 + f.dx * s - f.dz * lat, z = f.z0 + f.dz * s + f.dx * lat, y = deckAt(f, s);
    assert.ok(!solid(x, z, y), `${pt.id}: cannot walk the flyover deck at s=${s} lat=${lat} (${Math.round(x)},${Math.round(z)}, y=${y.toFixed(1)})`);
  }
}
console.log('flyovers walkable:', nfly);
let bad = 0;
for (const [a, b] of LINKS) {
  const [ax, az] = LAYOUT[a], [bx, bz] = LAYOUT[b], h = az === bz;
  const x0 = h ? Math.min(ax, bx) + HALF_TILE - 40 : ax, x1 = h ? Math.max(ax, bx) - HALF_TILE + 40 : bx, z0 = h ? az : Math.min(az, bz) + HALF_TILE - 40, z1 = h ? bz : Math.max(az, bz) - HALF_TILE + 40;
  let blockedAt = [];
  for (let t = 0; t <= 1; t += 0.004) for (const off of [-6, -3, 0, 3, 6]) {
    const x = x0 + (x1 - x0) * t + (h ? 0 : off), z = z0 + (z1 - z0) * t + (h ? off : 0);
    if (solid(x, z)) blockedAt.push([Math.round(x), Math.round(z)]);
  }
  console.log(`${a} - ${b}: ${blockedAt.length ? 'BLOCKED at ' + JSON.stringify(blockedAt.slice(0, 4)) : 'clear'}`);
  bad += blockedAt.length ? 1 : 0;
}
console.log('bounds', JSON.stringify(BOUNDS));
assert.equal(bad, 0, 'some connector roads are blocked');
console.log('ALL OK');
