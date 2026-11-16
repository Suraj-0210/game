// Vehicles without a browser: every model builds, traffic keeps to its lane on the roads, parked cars are placed on road edges,
// and the driven car accelerates, steers, stops at walls and gets in and out.   Run: node tools/test_vehicles.mjs
import * as THREE from '../node_modules/three/build/three.module.js';
import { mergeGeometries } from '../node_modules/three/examples/jsm/utils/BufferGeometryUtils.js';
import { createKit } from '../public/bbsr_vehicles_kit.js';
import { createVehicles } from '../public/bbsr_vehicles.js';
import assert from 'node:assert/strict';

const kit = createKit(THREE, mergeGeometries);
for (const k of kit.TYPE_KEYS) {
  const m = kit.model(k);
  assert.ok(m.body && m.detail && m.glass && m.head && m.tail, k + ' has all parts');
  assert.ok(m.wheels.length >= 3, k + ' wheels');
  const tris = [m.body, m.glass, m.detail, m.head, m.tail].reduce((a, g) => a + g.attributes.position.count / 3, 0) + m.wheels.length * m.wheelGeo.attributes.position.count / 3;
  assert.ok(tris > 400 && tris < 12000, `${k}: ${tris} triangles`);
  for (const g of [m.body, m.detail]) { g.computeBoundingBox(); const b = g.boundingBox; assert.ok(b.max.y - b.min.y > 0.5 && Math.abs(b.max.z - b.min.z) < m.L + 0.6, k + ' size'); }
  console.log(k.padEnd(6), Math.round(tris), 'triangles');
}

// a small world: a grid of roads and one wall
const roads = [];
for (let i = -3; i <= 3; i++) { roads.push({ pts: [[-300, i * 100], [300, i * 100]], w: 9, main: true }); roads.push({ pts: [[i * 100, -300], [i * 100, 300]], w: 9, main: true }); }
const walls = [{ x: 150, z: 3, hw: 2, hd: 20 }];
const blocked = (x, z, pr) => walls.some((b) => Math.abs(x - b.x) < b.hw + pr && Math.abs(z - b.z) < b.hd + pr);
const scene = new THREE.Scene();
const V = createVehicles({ THREE, kit, scene, roads, blocked, ground: () => 0, inWorld: (x, z) => Math.abs(x) < 400 && Math.abs(z) < 400, spawn: { x: 0, z: 0 }, seed: 3 });
V.seedParked(60);
assert.ok(V.parked.length >= 30, 'parked cars placed: ' + V.parked.length);
for (const c of V.parked) {
  // on the edge of a road, pointing along it
  const onX = Math.abs(((c.z + 50) % 100 + 100) % 100 - 50), onZ = Math.abs(((c.x + 50) % 100 + 100) % 100 - 50), d = Math.min(onX, onZ);
  assert.ok(d > 2.0 && d < 4.6, `parked car ${c.type} ${d.toFixed(2)} m from a road centre`);
}
assert.ok(V.parked.some((c) => Math.hypot(c.x, c.z) < 140), 'some cars near the start');

// traffic: 120 s of simulation
let minLane = 1e9, maxLane = 0, crashes = 0;
for (let t = 0; t < 120; t += 0.05) {
  V.update(0.05, 20, 20, 0);
  const T = V.traffic;
  for (const a of T) {
    const dx = Math.min(Math.abs(((a.z + 50) % 100 + 100) % 100 - 50), Math.abs(((a.x + 50) % 100 + 100) % 100 - 50));
    maxLane = Math.max(maxLane, dx); if (a.v > 1) minLane = Math.min(minLane, dx);
  }
  for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) if (Math.hypot(T[i].x - T[j].x, T[i].z - T[j].z) < 1.5) crashes++;
}
assert.ok(V.traffic.length > 15, 'traffic around the player: ' + V.traffic.length);
assert.ok(maxLane < 5.2, 'traffic stays on the road, max ' + maxLane.toFixed(2));
assert.ok(crashes < 40, 'traffic mostly keeps apart, overlaps: ' + crashes);
assert.ok(V.traffic.some((a) => a.v > 3), 'traffic is moving');
// they keep to the left: a vehicle going east (+x) is on the south side (+z, since north is -z)
for (const a of V.traffic) { if (a.v < 3) continue; const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw); if (Math.abs(fx) > 0.98 && Math.abs(a.z % 100 + (a.z < 0 ? 100 : 0)) > 0.5) { const off = ((a.z + 50) % 100 + 100) % 100 - 50; if (Math.abs(off) < 5) assert.ok((fx > 0) === (off < 0), `drives on the wrong side: ${off.toFixed(2)} going ${fx > 0 ? 'east' : 'west'}`); } }

// driving
const player = { x: 0, y: 0, z: 0, yaw: 0, vy: 0 };
const spot = V.parked[0], car = V.nearestParked(spot.x + 1.5, spot.z, 0);
assert.ok(car, 'a parked car is close enough to get into');
const n0 = V.parked.length, c = V.enter(car, player);
assert.equal(V.parked.length, n0 - 1); assert.ok(V.cur);
const run = (sec, inp) => { for (let t = 0; t < sec; t += 1 / 60) V.drive(1 / 60, inp, player, false); };
// put it in the open, pointing east along a road
Object.assign(V.cur, { x: -200, z: 0, yaw: -Math.PI / 2, v: 0 }); player.x = -200; player.z = 0;
run(4, { f: 1, s: 0 }); assert.ok(V.cur.v > 12, 'accelerates, v=' + V.cur.v.toFixed(1));
const x1 = V.cur.x; assert.ok(x1 > -200 + 20, 'moves forward');
const yaw1 = V.cur.yaw; run(1.5, { f: 1, s: 1 }); assert.ok(V.cur.yaw < yaw1 - 0.15, 'turns right with D (yaw falls)');
run(1.5, { f: 1, s: -1 }); run(2, { f: 0, s: 0, brake: true }); assert.ok(Math.abs(V.cur.v) < 0.5, 'handbrake stops it');
run(2, { f: -1, s: 0 }); assert.ok(V.cur.v < -1, 'reverses');
// the wall at x=150: charge into it
Object.assign(V.cur, { x: 110, z: 0, yaw: -Math.PI / 2, v: 0 });
run(8, { f: 1, s: 0, boost: true });
assert.ok(V.cur.x < 150 - 2 - 0.3, 'stopped by the wall, x=' + V.cur.x.toFixed(2));
// every probe point stays out of the wall
assert.ok(!blocked(V.cur.x, V.cur.z, 0.1), 'not inside the wall');
// get out: the player stands beside the car, which is parked again
V.cur.v = 0; const px = V.cur.x;
assert.ok(V.exit(player)); assert.equal(V.cur, null); assert.equal(V.parked.length, n0);
assert.ok(Math.hypot(player.x - px, player.z) > 1 && Math.hypot(player.x - px, player.z) < 4, 'player beside the car');
assert.ok(V.solid(px, 0, 0.35), 'a parked car is solid for people on foot');
assert.ok(!V.solid(px + 30, 30, 0.35), 'open ground is not');
console.log('vehicles ok:', V.parked.length, 'parked,', V.traffic.length, 'in traffic');
// another player's car (visual only)
const rv = V.makeRemote(2, 0xb3202a); assert.ok(rv && rv.group.children.length > 4);
V.animateRemote(rv, 0, 0, 0, 0, 0.05); V.animateRemote(rv, 0, 0, -1, 0, 0.05); assert.ok(rv.group.userData.wheels[0].mesh.rotation.x !== 0, 'remote wheels turn');
V.disposeRemote(rv); assert.equal(V.makeRemote(0, 0), null);
console.log('remote vehicles ok');

// ---- traffic signals: nobody crosses the stop line on red
{
  const { finishRoad, planSignals, signalState } = await import('../public/bbsr_roads.js');
  const rs = [
    finishRoad({ name: 'EW', w: 22, main: true, pts: [[-400, 0], [0, 0], [400, 0]] }), finishRoad({ name: 'EW2', w: 22, main: true, pts: [[0, 0], [400, 0]] }),
    finishRoad({ name: 'NS', w: 16, main: true, pts: [[0, -400], [0, 0]] }), finishRoad({ name: 'NS2', w: 16, main: true, pts: [[0, 0], [0, 400]] }),
  ];
  rs.splice(1, 1);
  const sigs = planSignals(rs, { rounds: [] }, { edge: 500 });
  assert.equal(sigs.length, 1, 'one signal at the crossing: ' + sigs.length);
  assert.ok(sigs[0].arms.length >= 4, 'arms on every approach: ' + sigs[0].arms.length);
  const sc = new THREE.Scene(), W = createVehicles({ THREE, kit, scene: sc, roads: rs.map((r) => ({ pts: r.pts, w: r.w, main: true, src: r })), blocked: () => false, ground: () => 0, inWorld: () => true, spawn: { x: 0, z: 0 }, seed: 11 });
  W.setSignals(sigs);
  const realNow = Date.now; let clock = 1e6; Date.now = () => clock * 1000;
  let crossings = 0, onRed = 0, stopped = 0; const last = new Map();
  for (let t = 0; t < 400; t += 0.05) {
    clock += 0.05; W.update(0.05, 30, 30, 0);
    for (const a of W.traffic) for (const st of a.r.stops) {
      if (st.mv !== a.dir) continue;
      const d = (st.s - a.s) * a.dir - W.fleets[a.type].model.L / 2, k = a.idx + a.type + st.s, prev = last.get(k);
      if (prev !== undefined && prev >= 0 && d < 0 && prev < 3) { crossings++; if (signalState(st.sg, st.group, clock) === 'r') onRed++; }
      if (d > 0.3 && d < 3 && a.v < 0.3 && signalState(st.sg, st.group, clock) === 'r') stopped++;
      last.set(k, d);
    }
  }
  Date.now = realNow;
  assert.ok(crossings > 10, 'vehicles drive through the junction: ' + crossings);
  assert.ok(onRed <= Math.ceil(crossings * 0.04), `vehicles crossing on red: ${onRed} of ${crossings}`);
  assert.ok(stopped > 5, 'vehicles wait at the line: ' + stopped);
  console.log(`signals ok: ${crossings} crossings, ${onRed} on red, ${stopped} waiting samples`);
}
