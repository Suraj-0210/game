// Vehicles in the city: parked cars you can get into, traffic that keeps to the left on the real roads, and the driving itself.
// Needs no DOM: the game passes in what it knows (roads, collision test, ground height).
import { PAINTS } from './bbsr_vehicles_kit.js';
import { laneOffset, signalState } from './bbsr_roads.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const VEHICLE_NAMES = { hatch: 'hatchback', sedan: 'sedan', suv: 'SUV', auto: 'auto-rickshaw', bus: 'bus', truck: 'truck' };
export const TYPE_ID = { hatch: 1, sedan: 2, suv: 3, auto: 4, bus: 5, truck: 6 };
export const TYPE_BY_ID = [null, 'hatch', 'sedan', 'suv', 'auto', 'bus', 'truck'];
const PAINT_OF = { auto: [0x2e8b57, 0xf0c020, 0x2e8b57, 0xe6b800], bus: [0xc23b22, 0x1d5fa8], truck: [0xcf5a1a, 0x2a5da8, 0x4f6b3a, 0x8c2f2f] };
const TRAFFIC_MIX = [['hatch', 0.3], ['sedan', 0.2], ['suv', 0.12], ['auto', 0.16], ['bus', 0.09], ['truck', 0.13]];
const PARKED_MIX = [['hatch', 0.38], ['sedan', 0.26], ['suv', 0.16], ['auto', 0.14], ['truck', 0.06]];
const CAPACITY = { hatch: 50, sedan: 40, suv: 28, auto: 36, bus: 10, truck: 18 };
const CELL = 240;

function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pickMix = (mix, r) => { let a = 0; for (const [k, w] of mix) { a += w; if (r < a) return k; } return mix[0][0]; };
const paintFor = (type, rnd) => { const l = PAINT_OF[type] || PAINTS; return l[Math.floor(rnd() * l.length)]; };

// roads: [{ pts: [[x,z],...], w, main }] in world coordinates
export function prepareRoads(roads) {
  const out = [], ends = new Map(), key = (x, z) => Math.floor(x / 20) + ',' + Math.floor(z / 20);
  for (const r of roads) {
    if (!r.pts || r.pts.length < 2 || r.w < 5) continue;
    const cum = [0]; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < r.pts.length; i++) {
      const p = r.pts[i]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
      if (i) cum.push(cum[i - 1] + Math.hypot(p[0] - r.pts[i - 1][0], p[1] - r.pts[i - 1][1]));
    }
    const len = cum[cum.length - 1];
    if (len < 25) continue;
    const S = r.src || r;
    out.push({ pts: r.pts, w: r.w, main: !!r.main, cum, len, n: r.pts.length, x0, x1, z0, z1, id: out.length, src: S, oneway: !!S.oneway, cw: S.cw || Math.max(3.2, r.w - 2), lanes: S.lanes || 1, med: S.med || 0, laneW: S.laneW || 3.3, stops: [] });
  }
  for (const r of out) for (const e of [0, 1]) { const p = r.pts[e ? r.n - 1 : 0], k = key(p[0], p[1]); if (!ends.has(k)) ends.set(k, []); ends.get(k).push({ r, end: e, x: p[0], z: p[1] }); }
  const near = (x, z, rad) => { const l = []; for (let cx = Math.floor((x - rad) / 20); cx <= Math.floor((x + rad) / 20); cx++) for (let cz = Math.floor((z - rad) / 20); cz <= Math.floor((z + rad) / 20); cz++) { const a = ends.get(cx + ',' + cz); if (a) for (const e of a) if (Math.hypot(e.x - x, e.z - z) <= rad) l.push(e); } return l; };
  const bySrc = new Map(); for (const o of out) bySrc.set(o.src, o);
  return { roads: out, near, bySrc };
}
// point and direction on a road at arc length s
function locate(r, s, hint) { let i = Math.min(hint | 0, r.n - 2); while (i > 0 && r.cum[i] > s) i--; while (i < r.n - 2 && r.cum[i + 1] < s) i++; return i; }
function pointOn(r, s, hint, out) {
  const i = locate(r, s, hint), a = r.pts[i], b = r.pts[i + 1], L = r.cum[i + 1] - r.cum[i] || 1, t = Math.max(0, Math.min(1, (s - r.cum[i]) / L));
  out.i = i; out.x = a[0] + (b[0] - a[0]) * t; out.z = a[1] + (b[1] - a[1]) * t; out.dx = (b[0] - a[0]) / L; out.dz = (b[1] - a[1]) / L;
  return out;
}

export function createVehicles({ THREE, kit, scene, roads, blocked, ground, inWorld, spawn, seed = 7, lite = false, getAudio, reach = lite ? 560 : 780 }) {
  const rnd = mulberry(seed), world = prepareRoads(roads);
  const fleets = {};
  for (const k of kit.TYPE_KEYS) fleets[k] = kit.createFleet(k, CAPACITY[k], scene);
  const flush = () => { for (const k in fleets) fleets[k].flush(); for (const l of pfleets.values()) for (const f of l) f.flush(); };

  // ---------------- parked cars ----------------
  const parked = [], pgrid = new Map(), PK = (x, z) => Math.floor(x / 12) + ',' + Math.floor(z / 12);
  const gridAdd = (c) => { const k = PK(c.x, c.z); let a = pgrid.get(k); if (!a) pgrid.set(k, (a = [])); a.push(c); };
  const gridDel = (c) => { const a = pgrid.get(PK(c.x, c.z)); if (a) { const i = a.indexOf(c); if (i >= 0) a.splice(i, 1); } };
  const parkedNear = (x, z, rad) => { const l = []; for (let cx = Math.floor((x - rad) / 12); cx <= Math.floor((x + rad) / 12); cx++) for (let cz = Math.floor((z - rad) / 12); cz <= Math.floor((z + rad) / 12); cz++) { const a = pgrid.get(cx + ',' + cz); if (a) for (const c of a) l.push(c); } return l; };
  const model = (t) => kit.model(t);
  // parked cars live in small fleets, one per kind and 240 m cell, so the camera and the distance check skip the ones you cannot see
  const pfleets = new Map();
  function parkedFleet(type, x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL), key = type + '|' + cx + ',' + cz;
    let l = pfleets.get(key); if (!l) pfleets.set(key, (l = []));
    let f = l.find((q) => q.free > 0);
    if (!f) { f = kit.createFleet(type, 10, scene); f.bounds((cx + 0.5) * CELL, (cz + 0.5) * CELL, CELL * 0.75 + 8); l.push(f); }
    return f;
  }
  function placeParked(type, x, z, yaw, hex) {
    const f = parkedFleet(type, x, z), idx = f.alloc(hex); if (idx < 0) return null;
    const c = { type, x, z, y: ground(x, z), yaw, hex, idx, fl: f, parked: true };
    f.set(idx, c.x, c.y, c.z, yaw); gridAdd(c); parked.push(c); return c;
  }
  function removeParked(c) { c.fl.release(c.idx); gridDel(c); const i = parked.indexOf(c); if (i >= 0) parked.splice(i, 1); }
  // is a car shape (two circles along its length) in the way of something solid?
  const carBlocked = (type, x, z, yaw, py) => {
    const m = model(type), sx = -Math.sin(yaw), sz = -Math.cos(yaw), h = m.L / 2 - m.W / 2 + 0.2, r = m.W / 2 + 0.05;
    return blocked(x + sx * h, z + sz * h, r, py) || blocked(x - sx * h, z - sz * h, r, py) || blocked(x, z, r, py);
  };
  // distance from a point to the nearest road other than `skip`
  function nearOtherRoad(x, z, skip, rad) {
    for (const r of world.roads) {
      if (r === skip || x < r.x0 - rad || x > r.x1 + rad || z < r.z0 - rad || z > r.z1 + rad) continue;
      for (let i = 0; i + 1 < r.n; i++) {
        const ax = r.pts[i][0], az = r.pts[i][1], bx = r.pts[i + 1][0], bz = r.pts[i + 1][1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
        if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < r.w / 2 + rad) return true;
      }
    }
    return false;
  }
  function seedParked(count) {
    const cands = [];
    for (const r of world.roads) {
      if (r.w < 6.5 || r.len < 50) continue;
      for (let s = 14 + rnd() * 12; s < r.len - 14; s += 22 + rnd() * 26) {
        const P = pointOn(r, s, 0, {}), side = rnd() < 0.5 ? 1 : -1;       // side 1 = the left of the travel direction
        const off = r.cw / 2 - 1.15, lx = P.dz, lz = -P.dx;
        cands.push({ x: P.x + lx * off * side, z: P.z + lz * off * side, yaw: Math.atan2(-P.dx * side, -P.dz * side), w: r.w, r });
      }
    }
    // shuffle; the nearest to the start come first so there is a car to try straight away
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const sp = spawn || { x: 0, z: 0 };
    const near = cands.filter((c) => Math.hypot(c.x - sp.x, c.z - sp.z) < 140).sort((a, b) => Math.hypot(a.x - sp.x, a.z - sp.z) - Math.hypot(b.x - sp.x, b.z - sp.z));
    const order = [...near.slice(0, 8), ...cands];
    for (const c of order) {
      if (parked.length >= count) break;
      if (!inWorld(c.x, c.z) || ground(c.x, c.z) < -0.4) continue;
      const type = pickMix(PARKED_MIX, rnd());
      if (c.w < 8 && (type === 'truck')) continue;
      if (parkedNear(c.x, c.z, 6).some((o) => Math.hypot(o.x - c.x, o.z - c.z) < 6.5)) continue;
      if (carBlocked(type, c.x, c.z, c.yaw, ground(c.x, c.z))) continue;
      if (nearOtherRoad(c.x, c.z, c.r, 7)) continue;                 // never at a junction or in another road
      placeParked(type, c.x, c.z, c.yaw, paintFor(type, rnd) ?? 0xffffff);
    }
  }

  // ---------------- traffic ----------------
  const traffic = [], P0 = {}, GAPV = { hatch: 1, sedan: 1, suv: 1, auto: 0.8, bus: 0.85, truck: 0.85 };
  const target = lite ? 26 : 48;
  function newAgent(px, pz, minD, maxD) {
    const cand = world.roads.filter((r) => r.x1 > px - maxD && r.x0 < px + maxD && r.z1 > pz - maxD && r.z0 < pz + maxD);
    if (!cand.length) return null;
    for (let tries = 0; tries < 12; tries++) {
      const r = cand[Math.floor(rnd() * cand.length)];
      if (!r.main && rnd() < 0.5) continue;
      const s = 6 + rnd() * (r.len - 12), P = pointOn(r, s, 0, P0), dir = r.oneway || rnd() < 0.5 ? 1 : -1;
      const d = Math.hypot(P.x - px, P.z - pz);
      if (d < minD || d > maxD) continue;
      let type = pickMix(TRAFFIC_MIX, rnd()); if (r.cw < 6.4 && (type === 'bus' || type === 'truck')) type = 'hatch';
      const lane = pickLane(r, type), off = laneOffset(r, lane), fx = P.dx * dir, fz = P.dz * dir, x = P.x + fz * off, z = P.z - fx * off;
      if (!inWorld(x, z) || ground(x, z) < -0.4 || blocked(x, z, 1.2, ground(x, z))) continue;
      let clash = false; for (const o of traffic) if (Math.hypot(o.x - x, o.z - z) < 11) { clash = true; break; }
      if (clash || parkedNear(x, z, 4).some((o) => Math.hypot(o.x - x, o.z - z) < 3.5)) continue;
      const hex = paintFor(type, rnd), idx = fleets[type].alloc(hex); if (idx < 0) continue;
      return { type, idx, r, s, dir, lane, seg: P.i, x, z, y: ground(x, z), yaw: Math.atan2(-fx, -fz), v: 0, vmax: (type === 'bus' ? 8 : type === 'truck' ? 7.5 : type === 'auto' ? 6.5 + rnd() * 2.5 : 8.5 + rnd() * 5.5) * (r.main ? 1 : 0.75), off, wait: 0, ghost: 0, hex };
    }
    return null;
  }
  // slow vehicles keep to the left-most lane, cars use any
  const pickLane = (r, type) => { const n = Math.max(1, r.lanes | 0), slow = type === 'bus' || type === 'truck' || type === 'auto'; return slow ? (r.oneway ? 0 : n - 1) : Math.floor(rnd() * n); };
  const dropAgent = (a) => { fleets[a.type].release(a.idx); const i = traffic.indexOf(a); if (i >= 0) traffic.splice(i, 1); };
  let spawnT = 0, filled = false;
  function stepTraffic(dt, px, pz, cur) {
    const nowSec = Date.now() / 1000;
    // keep about `target` vehicles around the player
    spawnT -= dt;
    if (!filled) { for (let i = 0; i < target; i++) { const a = newAgent(px, pz, 30, 300); if (a) traffic.push(a); } filled = true; }
    else if (spawnT <= 0 && traffic.length < target) { spawnT = 0.35; const a = newAgent(px, pz, 140, 300); if (a) traffic.push(a); }
    for (let n = traffic.length - 1; n >= 0; n--) {
      const a = traffic[n], r = a.r, m = model(a.type);
      if (Math.hypot(a.x - px, a.z - pz) > 360) { dropAgent(a); continue; }
      // who is in front?
      let vt = a.vmax; const fx = -Math.sin(a.yaw), fz = -Math.cos(a.yaw), look = 5 + a.v * 1.1 + m.L * 0.5;
      const check = (ox, oz, ov, olen) => {
        const rx = ox - a.x, rz = oz - a.z, f = rx * fx + rz * fz;
        if (f <= 0 || f > look + olen) return;
        const lat = Math.abs(rx * fz - rz * fx);
        if (lat > 1.9) return;
        vt = Math.min(vt, f < 3 + (m.L + olen) / 2 ? 0 : Math.max(0, ov * 0.9));
      };
      if (a.ghost <= 0) {
        for (const b of traffic) if (b !== a) check(b.x, b.z, b.v, model(b.type).L / 2);
        if (cur) check(cur.x, cur.z, Math.max(0, cur.v), cur.L / 2);
        for (const c of parkedNear(a.x + fx * 6, a.z + fz * 6, 6)) { const rx = c.x - a.x, rz = c.z - a.z, f = rx * fx + rz * fz; if (f > 0 && f < look && Math.abs(rx * fz - rz * fx) < 1.7) vt = 0; }
      } else a.ghost -= dt;
      // traffic signals: stop at the line on red (and on amber when there is room to stop)
      let sigHold = false;
      for (const st of r.stops) {
        if (st.mv !== a.dir) continue;
        const d = (st.s - a.s) * a.dir - m.L / 2;
        if (d < -0.3 || d > 55) continue;
        const state = signalState(st.sg, st.group, nowSec);
        if (state === 'g' || (state === 'a' && d < (a.v * a.v) / 6.4 + 0.6)) continue;
        const lim = d < 0.5 ? 0 : Math.sqrt(2 * 2.4 * Math.max(0, d - 0.8));
        if (lim < vt) { vt = lim; sigHold = true; }
      }
      a.v += Math.max(-10 * dt, Math.min(2.6 * dt * (GAPV[a.type] || 1), vt - a.v));
      a.wait = a.v < 0.3 && vt < 0.3 && !sigHold ? a.wait + dt : 0;
      if (a.wait > 7) { a.ghost = 3; a.wait = 0; }
      a.s += a.dir * a.v * dt;
      if (a.s >= r.len || a.s <= 0) {
        const end = a.s >= r.len ? 1 : 0, p = r.pts[end ? r.n - 1 : 0], fwx = -Math.sin(a.yaw), fwz = -Math.cos(a.yaw);
        // roads that start here (one-way roads only in their own direction), not turning back on ourselves
        const opts = world.near(p[0], p[1], 14).filter((e) => {
          if (e.r === r || (e.r.oneway && e.end !== 0)) return false;
          const q = e.end ? e.r.pts[e.r.n - 2] : e.r.pts[1], l = Math.hypot(q[0] - e.x, q[1] - e.z) || 1;   // the way we would head after entering it
          return ((q[0] - e.x) / l) * fwx + ((q[1] - e.z) / l) * fwz > -0.35;
        });
        if (opts.length) {
          const e = opts[Math.floor(rnd() * opts.length)]; a.r = e.r; a.dir = e.end ? -1 : 1; a.s = e.end ? e.r.len - 0.1 : 0.1; a.seg = 0; a.lane = pickLane(e.r, a.type);
          if (e.r.cw < 6.4 && (a.type === 'bus' || a.type === 'truck')) a.v = Math.min(a.v, 3); a.vmax = Math.max(a.vmax, 5.5) * (e.r.main ? 1 : 0.9);
        } else if (r.oneway) { dropAgent(a); continue; }
        else { a.dir = -a.dir; a.s = Math.max(0.1, Math.min(r.len - 0.1, a.s)); a.v *= 0.3; }
      }
      const R = a.r, P = pointOn(R, a.s, a.seg, P0); a.seg = P.i;
      const fdx = P.dx * a.dir, fdz = P.dz * a.dir, offT = laneOffset(R, a.lane);
      a.off += (offT - a.off) * Math.min(1, dt * 2.5);
      a.x = P.x + fdz * a.off; a.z = P.z - fdx * a.off;
      a.yaw += angDiff(a.yaw, Math.atan2(-fdx, -fdz)) * Math.min(1, dt * 5);
      a.y = ground(a.x, a.z);
      fleets[a.type].set(a.idx, a.x, a.y, a.z, a.yaw);
    }
  }

  // ---------------- the vehicle you drive ----------------
  let cur = null, horn = null, eng = null, lightsManual = null, headlight = null, lightsOn = false;
  const ptSolid = (x, z, y, pr) => blocked(x, z, pr, y);
  function mkLight() {
    headlight = new THREE.SpotLight(0xfff0d0, 0, 70, 0.62, 0.65, 1.1); headlight.castShadow = false; headlight.visible = true;
    scene.add(headlight); scene.add(headlight.target);
  }
  mkLight();
  function enter(c, player) {
    if (cur) return null;
    removeParked(c);
    const g = kit.buildGroup(c.type, c.hex), m = model(c.type);
    g.position.set(c.x, c.y, c.z); g.rotation.order = 'YXZ'; g.rotation.y = c.yaw; scene.add(g);
    cur = { type: c.type, hex: c.hex, group: g, m, x: c.x, y: c.y, z: c.z, yaw: c.yaw, v: 0, steer: 0, pitch: 0, roll: 0, L: m.L, W: m.W, spec: m.spec, brake: false, accelF: 0, wheelSpin: 0, look: 0, lookT: 0 };
    player.x = c.x; player.z = c.z; player.y = c.y; player.yaw = c.yaw; player.vy = 0;
    startEngine();
    return cur;
  }
  function parkCurrent() {
    if (!cur) return;
    const c = placeParked(cur.type, cur.x, cur.z, cur.yaw, cur.hex);
    if (c) c.y = cur.y;
    scene.remove(cur.group); kit.disposeGroup(cur.group);
    stopEngine(); const was = cur; cur = null; if (headlight) headlight.intensity = 0; return was;
  }
  // step out on the left (the door side); try the right, then front and back
  function exit(player) {
    if (!cur) return false;
    const c = cur, lx = -Math.cos(c.yaw), lz = Math.sin(c.yaw), fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw), d = c.W / 2 + 0.85;
    const spots = [[lx * d, lz * d], [-lx * d, -lz * d], [fx * (c.L / 2 + 1), fz * (c.L / 2 + 1)], [-fx * (c.L / 2 + 1), -fz * (c.L / 2 + 1)], [lx * (d + 1.5), lz * (d + 1.5)]];
    let at = null;
    for (const [ox, oz] of spots) { const x = c.x + ox, z = c.z + oz; if (inWorld(x, z) && !blocked(x, z, 0.4, ground(x, z, c.y))) { at = [x, z]; break; } }
    if (!at) at = [c.x + spots[0][0], c.z + spots[0][1]];
    const was = parkCurrent();
    player.x = at[0]; player.z = at[1]; player.y = ground(at[0], at[1], was.y); player.vy = 0; player.yaw = was.yaw;
    return true;
  }
  function startEngine() {
    const ctx = getAudio && getAudio(); if (!ctx || eng) return;
    try {
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 500; g.gain.value = 0;
      o1.connect(f); o2.connect(f); f.connect(g); g.connect(ctx.destination); o1.start(); o2.start();
      eng = { ctx, o1, o2, f, g };
    } catch (e) { eng = null; }
  }
  function stopEngine() { if (!eng) return; try { eng.g.gain.setTargetAtTime(0, eng.ctx.currentTime, 0.05); eng.o1.stop(eng.ctx.currentTime + 0.3); eng.o2.stop(eng.ctx.currentTime + 0.3); } catch (e) { /* ignore */ } eng = null; }
  function engineSound(throttle, soundOn) {
    if (!eng) return;
    const v = Math.abs(cur.v), spec = cur.spec, gears = 5, ratio = Math.min(1, v / spec.vmax), gear = Math.min(gears - 1, Math.floor(ratio * gears)), within = ratio * gears - gear;
    const rpm = 0.18 + 0.82 * Math.min(1, 0.25 + within * 0.75 + throttle * 0.1), base = (cur.type === 'truck' || cur.type === 'bus' ? 38 : cur.type === 'auto' ? 62 : 52) * (1 + rpm * 2.6);
    const t = eng.ctx.currentTime;
    eng.o1.frequency.setTargetAtTime(base, t, 0.06); eng.o2.frequency.setTargetAtTime(base * 0.5, t, 0.06);
    eng.f.frequency.setTargetAtTime(260 + rpm * 700 + throttle * 300, t, 0.08);
    eng.g.gain.setTargetAtTime(soundOn ? 0.035 + 0.05 * throttle + 0.02 * rpm : 0, t, 0.08);
  }
  function honk(on, soundOn) {
    if (on && !horn && cur && getAudio) {
      const ctx = getAudio(); if (!ctx || !soundOn) return;
      try { const a = ctx.createOscillator(), b = ctx.createOscillator(), g = ctx.createGain(); a.type = 'square'; b.type = 'square'; a.frequency.value = cur.type === 'bus' || cur.type === 'truck' ? 280 : 420; b.frequency.value = a.frequency.value * 1.26; g.gain.value = 0.05; a.connect(g); b.connect(g); g.connect(ctx.destination); a.start(); b.start(); horn = { ctx, a, b, g }; } catch (e) { horn = null; }
    } else if (!on && horn) { try { horn.g.gain.setTargetAtTime(0, horn.ctx.currentTime, 0.02); horn.a.stop(horn.ctx.currentTime + 0.1); horn.b.stop(horn.ctx.currentTime + 0.1); } catch (e) { /* ignore */ } horn = null; }
  }

  // Drive: input { f: -1..1 throttle, s: -1..1 steer (right is +), brake, boost, horn }. Writes the new position into player.
  function drive(dt, inp, player, soundOn = true) {
    const c = cur, sp = c.spec, m = c.m;
    const throttle = Math.max(-1, Math.min(1, inp.f)), steerIn = Math.max(-1, Math.min(1, inp.s));
    const vmax = sp.vmax * (inp.boost ? 1.18 : 1);
    // longitudinal
    let a = 0;
    if (throttle > 0.02) a = c.v < -0.3 ? 14 * throttle : sp.accel * throttle * Math.max(0.05, 1 - Math.max(0, c.v) / vmax);
    else if (throttle < -0.02) a = c.v > 0.4 ? -15 * -throttle : (-2.8 * -throttle) * Math.max(0, 1 - Math.max(0, -c.v) / 7);
    else a = -Math.sign(c.v) * Math.min(Math.abs(c.v) / dt, 1.6 + Math.abs(c.v) * 0.05);
    if (inp.brake) a = -Math.sign(c.v) * Math.min(Math.abs(c.v) / dt, 19);
    a -= Math.sign(c.v) * 0.0035 * c.v * c.v;                          // air drag
    c.v += a * dt; c.accelF += (a - c.accelF) * Math.min(1, dt * 6);
    // steering: smooth wheel angle; less lock at speed (like a real car)
    const maxLock = 0.58 / (1 + Math.abs(c.v) / 11);
    c.steer += (steerIn * maxLock - c.steer) * Math.min(1, dt * 7);
    const yawRate = (c.v / m.wb) * Math.tan(c.steer) * (inp.brake && Math.abs(c.v) > 6 ? 1.5 : 1);
    const nyaw = c.yaw - yawRate * dt;
    // move, then test the shape of the car against the world
    const fx = -Math.sin(nyaw), fz = -Math.cos(nyaw), step = c.v * dt, nx = c.x + fx * step, nz = c.z + fz * step;
    const hL = m.L / 2 - 0.3, hW = m.W / 2 - 0.15, rx = -fz, rz = fx;                // right vector
    const probes = [[hL, 0], [hL, hW], [hL, -hW], [-hL, hW], [-hL, -hW], [-hL, 0], [0, hW], [0, -hW]];
    const hit = (x, z, yaw, y) => {
      if (!inWorld(x, z)) return true;
      const sx = -Math.sin(yaw), sz = -Math.cos(yaw), px2 = -sz, pz2 = sx;
      for (const [f, s] of probes) if (ptSolid(x + sx * f + px2 * s, z + sz * f + pz2 * s, y, 0.35)) return true;
      for (const o of parkedNear(x, z, 6)) if (Math.hypot(o.x - x, o.z - z) < (model(o.type).L + m.L) * 0.34 && closeEnough(o, x, z, yaw, m)) return true;
      for (const t of traffic) if (Math.hypot(t.x - x, t.z - z) < (model(t.type).L + m.L) * 0.34 && closeEnough(t, x, z, yaw, m)) { t.v = Math.max(0, t.v - 2); return true; }
      return false;
    };
    const y0 = c.y;
    if (hit(nx, nz, nyaw, y0) && !hit(c.x, c.z, c.yaw, y0)) {
      // crash: bounce back a little and lose speed; sliding along walls by trying each axis
      let slid = false;
      if (!hit(nx, c.z, nyaw, y0) && Math.abs(nx - c.x) > 1e-4) { c.x = nx; slid = true; }
      else if (!hit(c.x, nz, nyaw, y0) && Math.abs(nz - c.z) > 1e-4) { c.z = nz; slid = true; }
      if (Math.abs(c.v) > 4) { c.crash = Math.min(1, Math.abs(c.v) / 14); }
      c.v = slid ? c.v * 0.55 : -c.v * 0.25;
      if (hit(c.x, c.z, nyaw, y0)) { /* turning in place would clip: keep the old heading */ } else c.yaw = nyaw;
    } else { c.x = nx; c.z = nz; c.yaw = nyaw; }
    // height: sample the surface under the axles so the car follows ramps and the hill
    const sfx = -Math.sin(c.yaw), sfz = -Math.cos(c.yaw), gf = ground(c.x + sfx * m.wb / 2, c.z + sfz * m.wb / 2, c.y), gr = ground(c.x - sfx * m.wb / 2, c.z - sfz * m.wb / 2, c.y);
    const gc = (gf + gr) / 2, tp = Math.atan2(gf - gr, m.wb);
    c.y += Math.max(-9 * dt, Math.min(9 * dt, gc - c.y)); if (Math.abs(gc - c.y) > 2) c.y = gc;
    c.pitch += (tp - c.accelF * 0.006 - c.pitch) * Math.min(1, dt * 8);
    c.roll += (-Math.tan(c.steer) * (c.v * c.v) * 0.0016 * (1 + 0) - c.roll) * Math.min(1, dt * 5);
    // visuals
    const g = c.group;
    g.position.set(c.x, c.y, c.z); g.rotation.set(c.pitch, c.yaw, Math.max(-0.07, Math.min(0.07, c.roll)));
    kit.animateWheels(g, c.v * dt, c.steer);
    const braking = inp.brake || (throttle < -0.02 && c.v > 0.4);
    g.userData.tailMat.emissiveIntensity = braking ? 2.6 : lightsOn ? 0.9 : 0.3;
    c.brake = braking;
    player.x = c.x; player.z = c.z; player.y = c.y; player.vy = 0; player.onGround = true;
    engineSound(Math.max(0, throttle), soundOn); honk(!!inp.horn, soundOn);
    return c;
  }
  // do two car shapes overlap? (each is approximated with two circles along its length)
  function closeEnough(o, x, z, yaw, m) {
    const om = model(o.type), oh = om.L / 2 - om.W / 2, mh = m.L / 2 - m.W / 2, osx = -Math.sin(o.yaw), osz = -Math.cos(o.yaw), msx = -Math.sin(yaw), msz = -Math.cos(yaw), rr = (om.W + m.W) / 2 - 0.1;
    for (const a of [-oh, 0, oh]) for (const b of [-mh, 0, mh]) if (Math.hypot(o.x + osx * a - (x + msx * b), o.z + osz * a - (z + msz * b)) < rr) return true;
    return false;
  }

  // ---------------- other players' vehicles (visual only) ----------------
  function makeRemote(typeId, colorIdx) {
    const type = TYPE_BY_ID[typeId]; if (!type) return null;
    const g = kit.buildGroup(type, colorIdx > 0 ? colorIdx : 0xffffff); g.rotation.order = 'YXZ';
    return { type, group: g, last: null };
  }
  function animateRemote(rv, x, y, z, yaw, dt) {
    const g = rv.group, m = kit.model(rv.type);
    let d = 0; if (rv.last) d = Math.hypot(x - rv.last[0], z - rv.last[1]) * (Math.cos(angDiff(yaw, Math.atan2(-(x - rv.last[0]), -(z - rv.last[1]))) ) >= 0 ? 1 : -1); rv.last = [x, z];
    const turn = rv.lastYaw === undefined ? 0 : angDiff(rv.lastYaw, yaw); rv.lastYaw = yaw;
    g.position.set(x, y, z); g.rotation.set(0, yaw, 0);
    kit.animateWheels(g, d, Math.max(-0.5, Math.min(0.5, -turn * (m.wb / Math.max(0.5, Math.abs(d) || 0.5)) * 0.5)));
  }
  function disposeRemote(rv) { scene.remove(rv.group); kit.disposeGroup(rv.group); }

  let cullN = 0;
  // ---------------- per frame ----------------
  function update(dt, px, pz, night, soundOn = true) {
    lightsOn = lightsManual === null ? night > 0.4 : lightsManual;
    kit.mats.head.emissiveIntensity = night > 0.4 ? 2.2 : 0.35; kit.mats.tail.emissiveIntensity = night > 0.4 ? 0.8 : 0.3;
    stepTraffic(dt, px, pz, cur);
    flush();
    if ((cullN = (cullN + 1) % 10) === 0) for (const l of pfleets.values()) for (const f of l) f.show(Math.hypot(f.cx - px, f.cz - pz) < reach + CELL * 0.75);
    if (cur) {
      const c = cur, fx = -Math.sin(c.yaw), fz = -Math.cos(c.yaw);
      headlight.intensity = lightsOn ? 140 : 0;
      headlight.position.set(c.x + fx * (c.L / 2 - 0.2), c.y + 0.8, c.z + fz * (c.L / 2 - 0.2));
      headlight.target.position.set(c.x + fx * 30, c.y + 0.2 + c.pitch * -8, c.z + fz * 30);
      if (c.crash) { c.crash = 0; }
    }
  }
  function toggleLights() { lightsManual = lightsManual === null ? !lightsOn : !lightsManual; return lightsManual; }
  // nearest parked car you could get into
  function nearestParked(x, z, y) {
    let best = null, bd = 3.6;
    for (const c of parkedNear(x, z, 5)) { const m = model(c.type), d = Math.hypot(c.x - x, c.z - z) - m.W * 0.3; if (d < bd && Math.abs(c.y - y) < 2.5) { best = c; bd = d; } }
    return best;
  }
  // solid for people on foot (each parked car is two circles) and for the driven one
  function solid(x, z, pr) {
    for (const c of parkedNear(x, z, 4)) {
      const m = model(c.type), h = m.L / 2 - m.W / 2, sx = -Math.sin(c.yaw), sz = -Math.cos(c.yaw), r = m.W / 2 + pr - 0.12;
      for (const k of [-h, 0, h]) if (Math.hypot(x - (c.x + sx * k), z - (c.z + sz * k)) < r) return true;
    }
    if (cur) {
      const h = cur.L / 2 - cur.W / 2, sx = -Math.sin(cur.yaw), sz = -Math.cos(cur.yaw), r = cur.W / 2 + pr;
      for (const k of [-h, 0, h]) if (Math.hypot(x - (cur.x + sx * k), z - (cur.z + sz * k)) < r) return true;
    }
    return false;
  }
  function setSignals(list) {
    for (const sg of list) for (const arm of sg.arms) { const pr = world.bySrc.get(arm.road); if (pr) pr.stops.push({ s: arm.s - arm.mv * arm.clr, mv: arm.mv, sg, group: arm.group }); }
  }
  return {
    setSignals, parked, traffic, fleets, world, seedParked, enter, exit, drive, update, nearestParked, solid, toggleLights, makeRemote, animateRemote, disposeRemote,
    get cur() { return cur; }, get lightsOn() { return lightsOn; }, flush,
  };
}
