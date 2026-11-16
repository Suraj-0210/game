// Roads without a browser: lane layouts, smooth curves, medians, chunking and signals on the real map data.   Run: node tools/test_roads.mjs
import * as THREE from '../node_modules/three/build/three.module.js';
import { smoothPts, finishRoad, laneOffset, buildRoads, signalState, SIGNAL_CYCLE } from '../public/bbsr_roads.js';
import { Batch } from '../public/bbsr_mesh.js';
import { buildZonePlan } from '../public/bbsr_zones.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const mats = Object.fromEntries(['asphalt', 'paving', 'marks', 'plain'].map((k) => [k, new THREE.MeshBasicMaterial()]));
// --- curves pass through the mapped points and turn gently
const raw = [[0, 0], [40, 0], [70, 25], [70, 70], [110, 95]];
const sm = smoothPts(raw);
for (const p of raw) assert.ok(sm.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.11), 'keeps the junction point ' + p);
const turn = (pts) => { let m = 0; for (let i = 1; i + 1 < pts.length; i++) { const a = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]), b = Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]); m = Math.max(m, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)))); } return m; };
assert.ok(turn(sm) < turn(raw) * 0.55 && turn(sm) < 0.6, `smoother: ${turn(raw).toFixed(2)} -> ${turn(sm).toFixed(2)} rad per vertex`);
assert.deepEqual(smoothPts([[0, 0], [10, 0]]), [[0, 0], [10, 0]]);

// --- lane layouts
const t = finishRoad({ name: 'a', w: 14, main: true, kind: 'trunk', pts: [[0, 0], [100, 0]] });
assert.equal(t.lanes, 2); assert.ok(t.med > 1.5 && t.cw > 14, 'trunk road: 2+2 lanes with a median'); assert.ok(t.w > t.cw + 3);
assert.ok(laneOffset(t, 0) > t.med / 2 && laneOffset(t, 1) > laneOffset(t, 0), 'lanes counted outwards from the median');
const ow = finishRoad({ name: 'b', w: 13, main: true, kind: 'primary', oneway: 1, pts: [[0, 0], [100, 0]] });
assert.ok(ow.lanes >= 2 && ow.med === 0 && ow.cw > 6.5, 'one-way primary: several lanes, no median');
const hand = finishRoad({ name: 'NH-16', w: 22, main: true, pts: [[0, 0], [100, 0]] });
assert.equal(hand.lanes, 2); assert.equal(hand.w, 22); assert.ok(hand.med > 1, 'a 22 m hand-drawn road becomes a divided 4-lane road');
const res = finishRoad({ name: 'c', w: 7, main: false, kind: 'residential', pts: [[0, 0], [100, 0]] });
assert.equal(res.lanes, 1); assert.equal(res.med, 0);

// --- chunked batches keep every triangle
{
  const b = new Batch(THREE);
  for (let i = 0; i < 60; i++) b.box(i * 37 - 900, (i * 53) % 700 - 300, 0, 6, 8, 9, i * 0.3, 0xffffff);
  const whole = b.mesh(mats.plain, false), parts = b.chunks(mats.plain, false, 150);
  assert.ok(parts.length > 5, 'split into chunks: ' + parts.length);
  assert.equal(parts.reduce((t, c) => t + c.mesh.geometry.index.count, 0), whole.geometry.index.count, 'no triangle lost');
}

// --- signal cycle: two conflicting groups are never green together, and there is an all-red gap
const sg = { off: 5 }; let seen = new Set();
for (let s = 0; s < SIGNAL_CYCLE * 3; s += 0.5) { const a = signalState(sg, 0, s), b = signalState(sg, 1, s); assert.ok(!(a !== 'r' && b !== 'r'), 'conflict at ' + s); seen.add(a + b); }
assert.ok(['gr', 'ar', 'rr', 'rg', 'ra'].every((k) => seen.has(k)), 'all phases occur: ' + [...seen]);

// --- real map data, every area
let totalSig = 0;
for (const id of ['khandagiri', 'baramunda', 'jaydev', 'vanivihar', 'rasulgarh', 'patia']) {
  const real = JSON.parse(fs.readFileSync(`public/data/real_${id}.json`, 'utf8'));
  const plan = buildZonePlan(id, real), t0 = Date.now();
  const RD = buildRoads({ THREE, Batch }, plan.roads, mats, plan);
  const ms = Date.now() - t0;
  let tris = 0, chunks = new Set();
  for (const m of RD.meshes) { if (m.always) continue; tris += m.mesh.geometry.index.count / 3; chunks.add(m.x + ',' + m.z); }
  const divided = plan.roads.filter((r) => r.med > 0.3 && !r.oneway), four = plan.roads.filter((r) => r.main && (r.oneway ? r.lanes >= 2 : r.lanes >= 2));
  assert.ok(chunks.size >= 4, id + ': road meshes are split in chunks: ' + chunks.size);
  assert.ok(tris < 160000, id + ' road triangles ' + tris);
  for (const s of RD.signals) {
    assert.ok(s.arms.length >= 3 && s.arms.some((a) => a.group === 0) && s.arms.some((a) => a.group === 1), 'junction has two axes');
    for (const a of s.arms) { const p = a.road.pts; assert.ok(a.s - a.mv * a.clr > 0 && a.s - a.mv * a.clr < a.road.len, 'stop line on the road'); assert.ok(p.length >= 2); }
  }
  totalSig += RD.signals.length;
  console.log(id.padEnd(11), 'roads', String(plan.roads.length).padStart(3), 'divided', String(divided.length).padStart(2), 'multi-lane main', String(four.length).padStart(2), 'chunks', String(chunks.size).padStart(2), 'tris', String(Math.round(tris)).padStart(6), 'signals', RD.signals.length, `(${ms} ms)`);
}
assert.ok(totalSig >= 8, 'signals at the big junctions: ' + totalSig);
console.log('roads ok');
