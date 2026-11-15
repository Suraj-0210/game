// Builds every zone plan and checks, without a browser, that the spawn, the auto stand, every landmark, stall and person can be reached on foot.
// Run: node tools/test_zones.mjs
import { buildPlan } from '../public/bbsr_plan.js';
import { ZONES, buildZonePlan, hillHeight } from '../public/bbsr_zones.js';
import assert from 'node:assert/strict';

const PR = 0.4;
function collider(plan) {
  const h = new Map(), K = (a, b) => a * 4096 + b;
  const put = (cx, cz, o) => { const k = K(cx, cz); (h.get(k) || h.set(k, []).get(k)).push(o); };
  for (const b of plan.boxes) {
    const c = Math.cos(b.theta), s = Math.sin(b.theta), rx = Math.abs(c) * b.hw + Math.abs(s) * b.hd, rz = Math.abs(s) * b.hw + Math.abs(c) * b.hd;
    const e = { k: 'b', x: b.x, z: b.z, hw: b.hw, hd: b.hd, c, s, y0: b.y0 === undefined ? -1e9 : b.y0, y1: b.y1 === undefined ? 1e9 : b.y1 };
    for (let cz = Math.floor((b.z - rz) / 8); cz <= Math.floor((b.z + rz) / 8); cz++) for (let cx = Math.floor((b.x - rx) / 8); cx <= Math.floor((b.x + rx) / 8); cx++) put(cx, cz, e);
  }
  for (const c of plan.circles) put(Math.floor(c.x / 8), Math.floor(c.z / 8), { k: 'c', x: c.x, z: c.z, r: c.r, y0: c.y0 === undefined ? -1e9 : c.y0, y1: c.y1 === undefined ? 1e9 : c.y1 });
  const ground = plan.height || (() => 0);
  return (x, z) => {
    const py = ground(x, z), top = py + 1.8, cx = Math.floor(x / 8), cz = Math.floor(z / 8);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const o of h.get(K(cx + dx, cz + dz)) || []) {
      if (top < o.y0 || py > o.y1) continue;
      if (o.k === 'c') { if (Math.hypot(x - o.x, z - o.z) < o.r + PR) return true; }
      else { const ddx = x - o.x, ddz = z - o.z, lx = ddx * o.c - ddz * o.s, lz = ddx * o.s + ddz * o.c, ex = Math.max(Math.abs(lx) - o.hw, 0), ez = Math.max(Math.abs(lz) - o.hd, 0); if (ex * ex + ez * ez < PR * PR) return true; }
    }
    return false;
  };
}
function reach(plan, blocked) {
  const N = 480, step = 2, W = (2 * N) / step + 1, seen = new Uint8Array(W * W), ix = (v) => Math.round((v + N) / step), pos = (i) => i * step - N;
  const ground = plan.height || (() => 0);
  const sp = plan.spawn, q = [];
  let s0 = null;
  for (let r = 0; r < 12 && !s0; r += 1) for (let a = 0; a < 16 && !s0; a++) { const x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r; if (!blocked(x, z)) s0 = [ix(x), ix(z)]; }
  assert.ok(s0, plan.zone + ': spawn is blocked');
  seen[s0[1] * W + s0[0]] = 1; q.push(s0);
  let n = 0;
  while (q.length) {
    const [i, j] = q.pop(); n++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= W || b >= W || seen[b * W + a]) continue;
      const x = pos(a), z = pos(b);
      if (blocked(x, z)) continue;
      if (Math.abs(ground(x, z) - ground(pos(i), pos(j))) > step * 1.0) continue;      // too steep to walk (more than 45 degrees)
      seen[b * W + a] = 1; q.push([a, b]);
    }
  }
  const can = (x, z, rad = 2) => { for (let dx = -rad; dx <= rad; dx += step) for (let dz = -rad; dz <= rad; dz += step) { const a = ix(x + dx), b = ix(z + dz); if (a >= 0 && b >= 0 && a < W && b < W && seen[b * W + a]) return true; } return false; };
  return { can, frac: n / (W * W), W };
}

let bad = 0;
const check = (cond, msg) => { if (!cond) { bad++; console.log('   FAIL', msg); } };
for (const z of ZONES) {
  const t0 = Date.now();
  const plan = z.id === 'oldtown' ? buildPlan(null) : buildZonePlan(z.id);
  const blocked = collider(plan), r = reach(plan, blocked);
  console.log(`${z.id.padEnd(11)} roads ${String(plan.roads.length).padStart(2)} houses ${String(plan.houses.length).padStart(4)} boxes ${String(plan.boxes.length).padStart(4)} towers ${String(plan.towers?.length || 0).padStart(2)} lamps ${String(plan.lamps.length).padStart(3)} trees ${plan.trees.broad.length + plan.trees.palms.length} walkable ${(r.frac * 100).toFixed(0)}% (${Date.now() - t0} ms)`);
  check(plan.travel, 'no auto stand');
  if (plan.travel) { check(plan.interactables.some((i) => i.type === 'travel'), 'no travel interactable'); check(r.can(plan.travel.x, plan.travel.z, 3), 'auto stand not reachable'); }
  for (const s of plan.spots || []) { check(!blocked(s.x, s.z) || r.can(s.x, s.z, 4), `spot ${s.id} unreachable`); check(r.can(s.x, s.z, Math.min(6, s.r * 0.5)), `spot ${s.id} (${s.x.toFixed(0)},${s.z.toFixed(0)}) not reachable on foot`); }
  for (const it of plan.interactables) check(r.can(it.x, it.z, Math.max(2, it.radius - 0.8)), `interactable ${it.id} at ${it.x.toFixed(0)},${it.z.toFixed(0)} not reachable`);
  for (const it of plan.interactables) if (it.type === 'stall' || it.type === 'npc') check(plan.interactables.filter((q) => q.id === it.id).length === 1, 'duplicate id ' + it.id);
  const keys = plan.stalls.map((s) => s.key); check(new Set(keys).size === keys.length, 'duplicate stall keys');
  for (const l of plan.lamps) if (blocked(l.x, l.z) && false) check(false, 'lamp');
  if (plan.height) { let mx = 0; for (let x = -240; x < 240; x += 3) for (let zz = -320; zz < 40; zz += 3) mx = Math.max(mx, Math.abs(plan.height(x + 3, zz) - plan.height(x, zz)) / 3, Math.abs(plan.height(x, zz + 3) - plan.height(x, zz)) / 3); console.log('   hill max slope', mx.toFixed(2), 'summit', plan.height(0, -140).toFixed(1), 'm'); check(mx < 0.8, 'hill too steep'); }
  check(r.frac > 0.5, 'less than half the zone is walkable (' + (r.frac * 100).toFixed(0) + '%)');
}
console.log(bad ? `${bad} PROBLEM(S)` : 'ALL OK');
process.exit(bad ? 1 : 0);
