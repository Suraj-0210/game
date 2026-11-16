// Roads the way Bhubaneswar builds them: dual carriageways with a median, 3.5 m lanes, painted edge and lane lines, footpaths with kerbs,
// smooth curves, and traffic signals (with stop lines and zebra crossings) at the big junctions.
// Pure geometry and rules: the meshes are returned in spatial chunks so far-away road is never drawn.

const hyp = Math.hypot;
export const SIGNAL_CYCLE = 46;

// ---------- road classes ----------
// ls: lanes per direction on a two-way road, lane: lane width, med: median width of a divided road, foot: footpath width each side
const KIND = {
  motorway: { ls: 3, lane: 3.6, med: 2.2, foot: 0 }, trunk: { ls: 2, lane: 3.6, med: 2.0, foot: 1.8 }, primary: { ls: 2, lane: 3.5, med: 1.8, foot: 2.0 },
  secondary: { ls: 2, lane: 3.3, med: 1.4, foot: 2.0 }, tertiary: { ls: 1, lane: 3.6, med: 0, foot: 1.6 }, unclassified: { ls: 1, lane: 3.2, med: 0, foot: 1.0 },
  residential: { ls: 1, lane: 2.9, med: 0, foot: 0.8 }, living_street: { ls: 1, lane: 2.7, med: 0, foot: 0.6 }, service: { ls: 1, lane: 2.3, med: 0, foot: 0 }, pedestrian: { ls: 1, lane: 2.4, med: 0, foot: 0 },
  trunk_link: { ls: 1, lane: 4.4, med: 0, foot: 0, link: 1 }, primary_link: { ls: 1, lane: 4.2, med: 0, foot: 0, link: 1 }, secondary_link: { ls: 1, lane: 4.0, med: 0, foot: 0, link: 1 }, tertiary_link: { ls: 1, lane: 3.8, med: 0, foot: 0, link: 1 },
};
const guessKind = (w, main) => (w >= 18 ? 'trunk' : w >= 13 ? 'primary' : w >= 11 ? 'secondary' : w >= 9 ? (main ? 'tertiary' : 'unclassified') : w >= 7 ? 'residential' : w >= 5.5 ? 'living_street' : 'service');

// Centripetal Catmull-Rom: the curve passes through every mapped point (so junctions stay put) and bends smoothly between them.
function cr(p0, p1, p2, p3, t) {
  const d = (a, b) => Math.max(1e-3, Math.sqrt(hyp(a[0] - b[0], a[1] - b[1])));
  const t0 = 0, t1 = d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3), tt = t1 + (t2 - t1) * t;
  const lerp = (a, b, ta, tb) => { const f = (tt - ta) / (tb - ta); return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  const A1 = lerp(p0, p1, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3), B1 = lerp(A1, A2, t0, t2), B2 = lerp(A2, A3, t1, t3);
  return lerp(B1, B2, t1, t2);
}
export function smoothPts(pts) {
  const n = pts.length; if (n < 3) return pts;
  const closed = hyp(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 0.5 && n > 4;
  const turn = (a, b, c) => { const u = Math.atan2(b[1] - a[1], b[0] - a[0]), v = Math.atan2(c[1] - b[1], c[0] - b[0]); return Math.abs(Math.atan2(Math.sin(v - u), Math.cos(v - u))); };
  const at = (i) => (closed ? pts[((i % (n - 1)) + (n - 1)) % (n - 1)] : pts[Math.max(0, Math.min(n - 1, i))]);
  const out = [pts[0]];
  for (let i = 0; i < n - 1; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const p0 = i > 0 || closed ? at(i - 1) : [2 * p1[0] - p2[0], 2 * p1[1] - p2[1]], p3 = i + 2 < n || closed ? at(i + 2) : [2 * p2[0] - p1[0], 2 * p2[1] - p1[1]];
    const t1 = turn(p0, p1, p2), t2 = turn(p1, p2, p3), tm = Math.max(t1, t2), L = hyp(p2[0] - p1[0], p2[1] - p1[1]);
    const k = tm < 0.04 || L < 1.5 ? 1 : Math.min(14, Math.max(2, Math.ceil(tm / 0.1), Math.ceil(L / 12)));
    for (let j = 1; j < k; j++) { const q = cr(p0, p1, p2, p3, j / k); out.push([Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]); }
    out.push(p2);
  }
  return out;
}

// Fills in lane layout, footpaths and the final width of a road. Real (OpenStreetMap) roads have a `kind`; their width follows from
// the lanes. Hand drawn roads keep the width they were given and the lanes are fitted into it.
export function finishRoad(r) {
  if (r.cw) return r;
  if (r.lanes && !r.cw0) r.lanesTagged = r.lanesTagged ?? !!r.lanes;
  const hand = !r.kind, k = r.kind || guessKind(r.w, r.main), K = KIND[k] || KIND.residential;
  r.kind = k; r.foot = K.foot;
  if (r.oneway) {
    let lanes = r.lanes || (K.link ? 1 : /^(trunk|motorway|primary)$/.test(k) ? 3 : k === 'secondary' ? 2 : 1);
    if (hand) lanes = Math.max(1, Math.round((r.w - 2 * K.foot - 0.6) / K.lane));
    r.lanes = lanes; r.med = 0; r.laneW = K.lane; r.cw = hand ? Math.max(3.2, r.w - 2 * K.foot - 0.6) : lanes * K.lane + (lanes > 1 ? 0.4 : 0.8);
    r.laneW = r.cw / lanes;
  } else {
    let ls = K.ls; if (r.lanes && r.lanes >= 4) ls = Math.max(ls, Math.floor(r.lanes / 2));
    const med = K.med;
    if (hand) { const avail = Math.max(3.2, r.w - 2 * K.foot - 0.6); ls = Math.max(1, Math.min(3, Math.floor((avail - med) / (2 * K.lane) + 0.15))); if (ls === 1) r.med = 0; r.cw = avail; r.med = ls === 1 ? 0 : med; }
    else { r.med = med; r.cw = 2 * ls * K.lane + med + (ls === 1 ? 0.6 : 0.4); }
    r.lanes = ls; r.laneW = (r.cw - r.med) / (2 * ls);
  }
  if (!hand) r.w = Math.round((r.cw + 2 * r.foot + 0.6) * 10) / 10;
  if (!r.sm) { r.pts = smoothPts(r.pts); r.sm = 1; }
  r.cum = [0]; for (let i = 1; i < r.pts.length; i++) r.cum.push(r.cum[i - 1] + hyp(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
  r.len = r.cum[r.cum.length - 1];
  r.x0 = Math.min(...r.pts.map((q) => q[0])); r.x1 = Math.max(...r.pts.map((q) => q[0])); r.z0 = Math.min(...r.pts.map((q) => q[1])); r.z1 = Math.max(...r.pts.map((q) => q[1]));
  return r;
}
// Dual carriageways are mapped as two one-way roads. Find the pairs: each half becomes a proper multi-lane carriageway and gets a
// median strip on the side facing its partner (r.medHalf).
export function pairDual(roads) {
  const ow = roads.filter((r) => r.oneway && r.main && !r.round && r.name !== 'Connector' && !/_link$/.test(r.kind || ''));
  for (const r of ow) {
    const gaps = [];
    for (let s = 6; s < r.len - 6; s += 14) {
      const i = Math.min(r.pts.length - 2, r.cum.findIndex((c) => c > s) - 1 < 0 ? 0 : r.cum.findIndex((c) => c > s) - 1), a = r.pts[i], b = r.pts[i + 1], l = hyp(b[0] - a[0], b[1] - a[1]) || 1, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
      const t = (s - r.cum[i]) / l, px = a[0] + (b[0] - a[0]) * t, pz = a[1] + (b[1] - a[1]) * t;
      let best = null;
      for (const q of ow) {
        if (q === r || px < q.x0 - 60 || px > q.x1 + 60 || pz < q.z0 - 60 || pz > q.z1 + 60) continue;
        const d = distToPath(q, px, pz); if (d.d > 45 || d.d < 1) continue;
        const j = Math.min(q.pts.length - 2, Math.max(0, q.cum.findIndex((c) => c > d.s) - 1)), c0 = q.pts[j], c1 = q.pts[j + 1], ql = hyp(c1[0] - c0[0], c1[1] - c0[1]) || 1;
        if (((c1[0] - c0[0]) / ql) * tx + ((c1[1] - c0[1]) / ql) * tz > -0.6) continue;                 // must run the other way
        const right = ((q.pts[j][0] - px) * -tz + (q.pts[j][1] - pz) * tx) > 0;                           // lies to the right (the median side in left-hand traffic)
        if (right && (!best || d.d < best.d)) best = d;
      }
      if (best) gaps.push(best.d);
    }
    if (gaps.length >= 2) { r.dual = true; gaps.sort((p, q) => p - q); r.gap = gaps[Math.floor(gaps.length / 2)]; }
  }
  for (const r of ow) if (r.dual) {
    const want = /^(trunk|motorway|primary)$/.test(r.kind) ? 3 : 2;
    if ((r.lanes || 0) < want && !r.lanesTagged) { r.lanes = want; const keep = r.sm; r.cw = 0; r.w = 0; finishRoad(r); r.sm = keep; }
    r.medHalf = Math.max(0, Math.min(6, (r.gap - r.cw) / 2));
  }
}
// distance from the centre line (positive = to the left of the direction of travel) of the middle of a lane
export function laneOffset(r, lane) {
  if (r.oneway) { const n = Math.max(1, r.lanes | 0), lw = r.cw / n; return r.cw / 2 - ((lane % n) + 0.5) * lw; }
  const ls = Math.max(1, r.lanes | 0); return (r.med || 0) / 2 + ((lane % ls) + 0.5) * (r.laneW || 3.3);
}

// ---------- path with tangents and mitred offsets ----------
function makePath(pts) {
  const n = pts.length, v = [], closed = n > 4 && hyp(pts[0][0] - pts[n - 1][0], pts[0][1] - pts[n - 1][1]) < 0.5;
  const dir = (a, b) => { const l = hyp(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; };
  let s = 0;
  for (let i = 0; i < n; i++) {
    const pi = i > 0 ? pts[i - 1] : closed ? pts[n - 2] : null, ni = i < n - 1 ? pts[i + 1] : closed ? pts[1] : null;
    const din = pi ? dir(pi, pts[i]) : dir(pts[i], ni), dout = ni ? dir(pts[i], ni) : din;
    let tx = din[0] + dout[0], tz = din[1] + dout[1]; const tl = hyp(tx, tz); if (tl < 1e-6) { tx = dout[0]; tz = dout[1]; } else { tx /= tl; tz /= tl; }
    const cosH = Math.max(0.5, tx * dout[0] + tz * dout[1]);
    if (i) s += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    v.push({ x: pts[i][0], z: pts[i][1], tx, tz, rx: -tz, rz: tx, m: 1 / cosH, s });
  }
  return { v, len: s };
}
// point on a path at distance s (no mitre; for markings that are short)
function pathAt(P, s) {
  const v = P.v; let i = 0; s = Math.max(0, Math.min(P.len, s));
  while (i < v.length - 2 && v[i + 1].s < s) i++;
  const a = v[i], b = v[i + 1], L = b.s - a.s || 1, t = (s - a.s) / L;
  let tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t; const l = hyp(tx, tz) || 1; tx /= l; tz /= l;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, tx, tz, rx: -tz, rz: tx, m: 1, s };
}
function subPath(P, s0, s1) {
  const out = [pathAt(P, s0)];
  for (const q of P.v) if (q.s > s0 + 0.05 && q.s < s1 - 0.05) out.push(q);
  out.push(pathAt(P, s1)); return out;
}

// ---------- chunked batches ----------
const CH = 200;
class Chunks {
  constructor(B, THREE) { this.B = B; this.T = THREE; this.map = new Map(); }
  get(kind, x, z) {
    const cx = Math.floor(x / CH), cz = Math.floor(z / CH), key = cx + ',' + cz;
    let c = this.map.get(key); if (!c) this.map.set(key, (c = { cx, cz, b: {} }));
    return c.b[kind] || (c.b[kind] = new this.B(this.T));
  }
  meshes(mats, shadows = {}) {
    const out = [];
    for (const c of this.map.values()) for (const k in c.b) { const m = c.b[k].mesh(mats[k], !!shadows[k]); if (m) { m.receiveShadow = false; out.push({ mesh: m, x: (c.cx + 0.5) * CH, z: (c.cz + 0.5) * CH }); } }
    return out;
  }
}

// ---------- the builder ----------
export function buildRoads(ctx, roads, M, plan) {
  const { THREE, Batch } = ctx, ch = new Chunks(Batch, THREE);
  for (const r of roads) finishRoad(r);
  // grid of road pieces, to know when something would lie inside another road
  const GC = 24, grid = new Map(), gk = (x, z) => Math.floor(x / GC) + ',' + Math.floor(z / GC);
  for (const r of roads) {
    if (r.name === 'Connector') { /* still a road */ }
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], x0 = Math.min(a[0], b[0]) - r.cw / 2 - 2, x1 = Math.max(a[0], b[0]) + r.cw / 2 + 2, z0 = Math.min(a[1], b[1]) - r.cw / 2 - 2, z1 = Math.max(a[1], b[1]) + r.cw / 2 + 2, seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], hw: r.cw / 2, r };
      for (let cx = Math.floor(x0 / GC); cx <= Math.floor(x1 / GC); cx++) for (let cz = Math.floor(z0 / GC); cz <= Math.floor(z1 / GC); cz++) { const k = cx + ',' + cz; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(seg); }
    }
  }
  const inside = (x, z, self, pad) => {
    const l = grid.get(gk(x, z)); if (!l) return false;
    for (const s of l) {
      if (s.r === self || (self && self.grp && s.r.grp === self.grp)) continue;     // pieces of one street (cut at a tile edge) are not junctions
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      if (hyp(x - (s.ax + dx * t), z - (s.az + dz * t)) < s.hw + pad) return true;
    }
    return false;
  };
  const signals = planSignals(roads, plan);
  const stopsOf = new Map();   // road -> [{s, mv, sig}] for the markings
  for (const sg of signals) for (const a of sg.arms) { let l = stopsOf.get(a.road); if (!l) stopsOf.set(a.road, (l = [])); l.push(a); }

  const fine = (v, maxLen) => {                     // split long path segments so a junction cuts a median/footpath cleanly instead of by one coarse midpoint test
    const out = [v[0]];
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i], b = v[i + 1], n = Math.max(1, Math.ceil(hyp(b.x - a.x, b.z - a.z) / maxLen));
      for (let k = 1; k <= n; k++) { const t = k / n; out.push(k === n ? b : { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, m: a.m + (b.m - a.m) * t, s: a.s + (b.s - a.s) * t }); }
    }
    return out;
  };
  const ribbon = (kind, path, q0, q1, y, hex, self, check, us = 8, sub = 0) => {
    const v = check ? fine(path, 2.5) : path;
    for (let i = 0; i + 1 < v.length; i++) {
      const a = v[i], b = v[i + 1];
      if (check) { const mx = (a.x + b.x) / 2 + (a.rx + b.rx) * 0.5 * (q0 + q1) / 2, mz = (a.z + b.z) / 2 + (a.rz + b.rz) * 0.5 * (q0 + q1) / 2; if (inside(mx, mz, self, check.pad)) continue; }
      const B = ch.get(kind, (a.x + b.x) / 2, (a.z + b.z) / 2), cc = B.col(hex);
      const P = (p, q) => [p.x + p.rx * q * p.m, y, p.z + p.rz * q * p.m];
      const A0 = P(a, q0), B0 = P(b, q0), B1 = P(b, q1), A1 = P(a, q1);
      B.quad(A0, B0, B1, A1, [0, 1, 0], [A0, B0, B1, A1].map((p) => [p[0] / us, p[2] / us]), cc);
    }
  };
  const wall = (kind, path0, q, y0, y1, hex, self, pad) => {   // a vertical strip (the kerb face) along offset q, facing outwards (sign of q)
    const path = fine(path0, 2.5);
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i], b = path[i + 1], mx = (a.x + b.x) / 2 + a.rx * q, mz = (a.z + b.z) / 2 + a.rz * q;
      if (inside(mx, mz, self, pad)) continue;
      const B = ch.get(kind, mx, mz), cc = B.col(hex), n = q < 0 ? [-a.rx, 0, -a.rz] : [a.rx, 0, a.rz];
      const pa = [a.x + a.rx * q * a.m, 0, a.z + a.rz * q * a.m], pb = [b.x + b.rx * q * b.m, 0, b.z + b.rz * q * b.m];
      if (q < 0) B.quad([pb[0], y0, pb[2]], [pa[0], y0, pa[2]], [pa[0], y1, pa[2]], [pb[0], y1, pb[2]], n, [[0, 0], [1, 0], [1, 1], [0, 1]], cc);
      else B.quad([pa[0], y0, pa[2]], [pb[0], y0, pb[2]], [pb[0], y1, pb[2]], [pa[0], y1, pa[2]], n, [[0, 0], [1, 0], [1, 1], [0, 1]], cc);
    }
  };
  const WHITE = 0xf0efe8, YELLOW = 0xe9c23a, KERB = 0xc9c6bd;
  const dashes = (P, q, on, off, hex, w, self, y = 0.045) => {
    for (let s = 1.5; s + on < P.len - 1; s += on + off) {
      const sp = subPath(P, s, s + on), mid = pathAt(P, s + on / 2);
      if (inside(mid.x + mid.rx * q, mid.z + mid.rz * q, self, 0.6)) continue;
      ribbon('marks', sp, q - w / 2, q + w / 2, y, hex, self, null);
    }
  };
  const solid = (P, q, hex, w, self, y = 0.045) => {
    // split into pieces so the parts inside junctions are left out
    let run = null; const cut = [];
    for (let s = 0; s <= P.len; s += 2) { const p = pathAt(P, s), bad = inside(p.x + p.rx * q, p.z + p.rz * q, self, 0.4); if (!bad && !run) run = [s]; if ((bad || s + 2 > P.len) && run) { cut.push([run[0], Math.min(P.len, s)]); run = null; } }
    for (const [a, b] of cut) if (b - a > 1.5) ribbon('marks', subPath(P, a, b), q - w / 2, q + w / 2, y, hex, self, null);
  };

  for (const r of roads) {
    if (r.pts.length < 2 || r.len < 1) continue;
    const P = makePath(r.pts), cw = r.cw, hw = cw / 2, foot = r.foot, big = cw >= 5.2;
    // carriageway
    ribbon('road', P.v, -hw, hw, 0.03, 0xffffff, r, null, 8);
    for (const e of [P.v[0], P.v[P.v.length - 1]]) {        // where this road ends on another road, fill the corner wedges the square road end leaves
      if (!inside(e.x, e.z, r, 0.6)) continue;
      const R = hw + 1.2, B = ch.get('road', e.x, e.z), cc = B.col(0xffffff), c = [e.x, 0.031, e.z], N = 14;
      for (let k = 0; k < N; k++) {
        const t0 = (k / N) * Math.PI * 2, t1 = ((k + 1) / N) * Math.PI * 2, p0 = [e.x + Math.cos(t0) * R, 0.031, e.z + Math.sin(t0) * R], p1 = [e.x + Math.cos(t1) * R, 0.031, e.z + Math.sin(t1) * R];
        B.quad(c, p1, p0, c, [0, 1, 0], [[c[0] / 8, c[2] / 8], [p1[0] / 8, p1[2] / 8], [p0[0] / 8, p0[2] / 8], [c[0] / 8, c[2] / 8]], cc);
      }
    }
    if (r.name === 'Connector' && false) continue;
    // footpaths and kerbs
    if (foot > 0.3) for (const side of [-1, 1]) {
      const a = side * hw, b = side * (hw + foot);
      ribbon('foot', P.v, Math.min(a, b), Math.max(a, b), 0.07, 0xffffff, r, { pad: 0.2 }, 5);
      ribbon('plain', P.v, side * (hw + 0.02) - 0.12, side * (hw + 0.02) + 0.12, 0.078, KERB, r, { pad: 0.2 });
      wall('plain', P.v, side * (hw + 0.02), 0.03, 0.078, 0xa9a69d, r, 0.2);
    }
    if (!big) continue;
    // markings
    const edge = hw - 0.28;
    if (r.oneway && r.medHalf > 0.35) {          // the median between the two halves of a dual carriageway, on the side facing the other half
      const m = r.medHalf;
      ribbon('plain', P.v, hw, hw + m, 0.2, 0x9b9a93, r, { pad: 0.1 });
      wall('plain', P.v, hw, 0.03, 0.2, 0xb4b2a9, r, 0.1);
      if (m >= 1.4) ribbon('plain', P.v, hw + 0.3, hw + m - 0.1, 0.215, 0x56803c, r, { pad: 0.1 });
      if (m >= 1.2) for (let s = 3; s < P.len - 2; s += 6) { const p = pathAt(P, s), q = hw + m * 0.55; if (inside(p.x + p.rx * q, p.z + p.rz * q, r, 1.5)) continue; const B = ch.get('plain', p.x, p.z), sz = m >= 2.4 ? 0.9 : 0.6; B.box(p.x + p.rx * q, p.z + p.rz * q, 0.2, sz, 0.5 + ((s * 7) % 3) * 0.1, sz, 0, (s * 3) % 2 ? 0x3f6b32 : 0x4c7a38, { us: 2, vs: 2 }); }
      if (plan && plan.lamps) for (let s = 22; s < P.len - 12; s += 38) { const p = pathAt(P, s), q = hw + m * 0.5; const x = p.x + p.rx * q, z = p.z + p.rz * q; if (!inside(x, z, r, 2.5) && !(plan.rounds || []).some((u) => hyp(x - u.x, z - u.z) < u.R + 6) && (plan.worldCoords || (Math.abs(x) < 438 && Math.abs(z) < 438))) plan.lamps.push({ x, z, med: 1 }); }
    }
    if (r.oneway) {
      solid(P, -edge, WHITE, 0.14, r); solid(P, edge, WHITE, 0.14, r);
      for (let k = 1; k < r.lanes; k++) dashes(P, -hw + (k * cw) / r.lanes, 3, 6, WHITE, 0.12, r);
    } else if (r.med > 0.3) {
      const m = r.med / 2;
      // median: kerbed, paved edge and a planted strip with shrubs
      ribbon('plain', P.v, -m, m, 0.2, 0x9b9a93, r, { pad: 0.1 });
      for (const side of [-1, 1]) wall('plain', P.v, side * m, 0.03, 0.2, 0xb4b2a9, r, 0.1);
      if (r.med >= 1.2) ribbon('plain', P.v, -m + 0.28, m - 0.28, 0.215, 0x56803c, r, { pad: 0.1 });
      for (let s = 3; s < P.len - 2; s += 5.5) {
        const p = pathAt(P, s); if (inside(p.x, p.z, r, 1.5)) continue;
        const B = ch.get('plain', p.x, p.z), sz = r.med >= 1.8 ? 0.9 : 0.55;
        B.box(p.x, p.z, 0.2, sz, 0.5 + ((s * 7) % 3) * 0.1, sz, 0, (s * 3) % 2 ? 0x3f6b32 : 0x4c7a38, { us: 2, vs: 2 });
      }
      for (const side of [-1, 1]) {
        solid(P, side * (m + 0.22), WHITE, 0.14, r); solid(P, side * edge, WHITE, 0.14, r);
        for (let k = 1; k < r.lanes; k++) dashes(P, side * (m + k * r.laneW), 3, 6, WHITE, 0.12, r);
      }
      // street lights stand in the median
      if (plan && plan.lamps) for (let s = 18; s < P.len - 12; s += 34) { const p = pathAt(P, s); if (!inside(p.x, p.z, r, 2.5) && !(plan.rounds || []).some((q) => hyp(p.x - q.x, p.z - q.z) < q.R + 6) && (plan.worldCoords || (Math.abs(p.x) < 438 && Math.abs(p.z) < 438))) plan.lamps.push({ x: p.x, z: p.z, med: 1 }); }
    } else if (r.lanes >= 2) {
      solid(P, -0.12, YELLOW, 0.1, r); solid(P, 0.12, YELLOW, 0.1, r);
      solid(P, -edge, WHITE, 0.14, r); solid(P, edge, WHITE, 0.14, r);
      for (let k = 1; k < r.lanes; k++) for (const side of [-1, 1]) dashes(P, side * k * r.laneW, 3, 6, WHITE, 0.12, r);
    } else {
      if (r.main || cw >= 6.5) dashes(P, 0, 3, 6, WHITE, 0.14, r); else if (cw >= 5.4) dashes(P, 0, 2.5, 7, WHITE, 0.1, r);
      if (cw >= 6) { solid(P, -edge, WHITE, 0.12, r); solid(P, edge, WHITE, 0.12, r); }
    }
    // stop lines and zebra crossings at signals
    for (const a of stopsOf.get(r) || []) {
      const s = a.s - a.mv * a.clr, sp = pathAt(P, s), yaw = Math.atan2(-sp.tz, sp.tx);
      let q0 = -hw, q1 = hw; if (!r.oneway) { if (a.mv > 0) { q0 = -hw + 0.3; q1 = -(r.med || 0.2) / 2 - 0.1; } else { q0 = (r.med || 0.2) / 2 + 0.1; q1 = hw - 0.3; } }
      const B = ch.get('marks', sp.x, sp.z), qc = (q0 + q1) / 2;
      B.flat(sp.x + sp.rx * qc, sp.z + sp.rz * qc, 0.05, 0.5, q1 - q0, yaw, WHITE);
      const zs = s + a.mv * 3.4, zp = pathAt(P, zs);
      for (let q = -hw + 0.3; q < hw - 0.2; q += 1.05) { if (r.med > 0.3 && Math.abs(q) < r.med / 2 + 0.3) continue; B.flat(zp.x + zp.rx * q, zp.z + zp.rz * q, 0.05, 3.1, 0.52, yaw, WHITE); }
    }
  }

  // ---------- signal heads ----------
  const sigB = (x, z) => ch.get('plain', x, z);
  const lampsAt = { r: [], a: [], g: [] };
  for (const sg of signals) {
    for (const a of sg.arms) {
      const r = a.road, P = makePath(r.pts), sp = pathAt(P, a.s - a.mv * a.clr);
      const fx = sp.tx * a.mv, fz = sp.tz * a.mv, lx = fz, lz = -fx;          // direction of travel and its left
      const edgeQ = r.oneway ? r.cw / 2 : r.cw / 2;                          // kerb on the left of travel
      const px = sp.x + lx * (edgeQ + 0.75), pz = sp.z + lz * (edgeQ + 0.75);
      const armL = Math.min(6.5, edgeQ * 0.9 + 0.8), tx = -lx, tz = -lz;      // the arm reaches over the road (to the right of travel)
      const B = sigB(px, pz), faceYaw = Math.atan2(-fx, -fz);                  // the lamps look back at the driver
      B.box(px, pz, 0, 0.2, 5.5, 0.2, 0, 0x3e4349, { us: 2, vs: 2 });
      B.box(px + tx * armL / 2, pz + tz * armL / 2, 5.0, armL, 0.12, 0.12, Math.atan2(-tz, tx), 0x3e4349, { us: 2, vs: 2 });
      const hx = px + tx * armL, hz = pz + tz * armL;
      const head = (cx, cz, y0, ys) => {
        B.box(cx, cz, y0, 0.46, 1.06, 0.34, faceYaw, 0x15171a, { us: 2, vs: 2 });
        B.box(cx - fx * 0.0, cz - fz * 0.0, y0 + 1.04, 0.62, 0.05, 0.5, faceYaw, 0x15171a, { us: 2, vs: 2 });
        const fxo = -fx * 0.19, fzo = -fz * 0.19;
        for (const [k, dy] of [['r', 0.8], ['a', 0.53], ['g', 0.26]]) lampsAt[k].push({ x: cx + fxo, y: y0 + dy, z: cz + fzo, yaw: faceYaw, arm: a });
      };
      head(hx, hz, 4.2, 0);
      head(px - fx * 0.15 + tx * 0.35, pz - fz * 0.15 + tz * 0.35, 2.0, 0);
    }
  }
  // lamps are instanced (3 colours), switched on and off by scale
  const lampMeshes = {}, lampIdx = new Map(), Mx = new THREE.Matrix4(), Qt = new THREE.Quaternion(), Eu = new THREE.Euler(0, 0, 0), Ps = new THREE.Vector3(), Sc1 = new THREE.Vector3(1, 1, 1), Sc0 = new THREE.Vector3(0, 0, 0);
  const cols = { r: 0xff2a1c, a: 0xffb21c, g: 0x27e06a };
  const total = lampsAt.r.length;
  const extra = [];
  if (total) {
    const geo = new THREE.CylinderGeometry(0.115, 0.115, 0.05, 14).rotateX(Math.PI / 2);
    for (const k of ['r', 'a', 'g']) {
      const mat = new THREE.MeshStandardMaterial({ color: cols[k], emissive: cols[k], emissiveIntensity: 3.2, roughness: 0.4 });
      const im = new THREE.InstancedMesh(geo, mat, total); im.frustumCulled = false; lampMeshes[k] = im;
      lampsAt[k].forEach((l, i) => { Ps.set(l.x, l.y, l.z); Eu.set(0, l.yaw, 0); Qt.setFromEuler(Eu); Mx.compose(Ps, Qt, Sc0); im.setMatrixAt(i, Mx); const key = l.arm; let e = lampIdx.get(key); if (!e) lampIdx.set(key, (e = { r: [], a: [], g: [] })); e[k].push(i); });
      extra.push(im);
    }
  }
  const setLamp = (im, i, on, l) => { Ps.set(l.x, l.y, l.z); Eu.set(0, l.yaw, 0); Qt.setFromEuler(Eu); Mx.compose(Ps, Qt, on ? Sc1 : Sc0); im.setMatrixAt(i, Mx); };
  const update = (tsec) => {
    let dirty = false;
    for (const sg of signals) {
      for (const a of sg.arms) {
        const st = signalState(sg, a.group, tsec); if (a.st === st) continue; a.st = st; dirty = true;
        const e = lampIdx.get(a);
        for (const k of ['r', 'a', 'g']) e[k].forEach((i) => setLamp(lampMeshes[k], i, k === st, lampsAt[k][i]));
      }
    }
    if (dirty) for (const k in lampMeshes) lampMeshes[k].instanceMatrix.needsUpdate = true;
  };
  update(Date.now() / 1000);
  const mats = { road: M.asphalt, foot: M.paving, marks: M.marks, plain: M.plain };
  const meshes = ch.meshes(mats, { plain: true });
  for (const m of extra) meshes.push({ mesh: m, x: 0, z: 0, always: true });
  if (plan) plan.signals = signals;
  return { meshes, signals, update };
}

// ---------- signals ----------
export function signalState(sg, group, tsec) {
  const u = (((tsec + sg.off) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  if (u < 20) return group === 0 ? 'g' : 'r';
  if (u < 23) return group === 0 ? 'a' : 'r';
  if (u < 25) return 'r';
  if (u < 41) return group === 1 ? 'g' : 'r';
  if (u < 44) return group === 1 ? 'a' : 'r';
  return 'r';
}
const distToPath = (r, x, z) => {
  let best = { d: 1e9, s: 0, i: 0 };
  for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i], b = r.pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)), d = hyp(x - (a[0] + dx * t), z - (a[1] + dz * t));
    if (d < best.d) best = { d, s: r.cum[i] + t * Math.sqrt(l2), i };
  }
  return best;
};
// Where the big roads meet: a signal with its stop lines. Real signal positions (OpenStreetMap highway=traffic_signals) are used when
// the map has them; otherwise the busiest junctions of main roads get one.
export function planSignals(roads, plan, opts = {}) {
  if (plan && plan.noSignals) return [];
  const max = opts.max || 12, edge = opts.edge || 470;
  const cand = roads.filter((r) => r.main && r.cw >= 5.2 && !r.round && r.name !== 'Connector' && !/ring$/i.test(r.name || '') && !/_link$/.test(r.kind || ''));
  const side = roads.filter((r) => !r.main && r.cw >= 5 && r.cw < 9 && !/^(service|pedestrian)$/.test(r.kind || '') && r.name !== 'Connector');
  const pts = [];
  for (const a of cand) for (const e of [a.pts[0], a.pts[a.pts.length - 1]]) for (const b of cand) { if (b === a) continue; if (distToPath(b, e[0], e[1]).d < 7 + b.cw / 2) { pts.push(e); break; } }
  if (plan && plan.realSignals) for (const s of plan.realSignals) pts.push([s.x, s.z]);
  // cluster nearby points
  const cl = [];
  for (const p of pts) { const c = cl.find((q) => hyp(q.x / q.n - p[0], q.z / q.n - p[1]) < 30); if (c) { c.x += p[0]; c.z += p[1]; c.n++; } else cl.push({ x: p[0], z: p[1], n: 1 }); }
  const out = [];
  for (const c of cl.map((q) => ({ x: q.x / q.n, z: q.z / q.n }))) {
    if (Math.abs(c.x) > edge || Math.abs(c.z) > edge) continue;
    if (plan && (plan.rounds || []).some((q) => hyp(c.x - q.x, c.z - q.z) < q.R + 14)) continue;
    const ar = [];
    for (const r of cand) { const d = distToPath(r, c.x, c.z); if (d.d < 16) ar.push({ r, s: d.s, i: d.i, d: d.d }); }
    if (ar.length < 1) continue;
    for (const r of side) { const d = distToPath(r, c.x, c.z); if (d.d < 11 && (hyp(r.pts[0][0] - c.x, r.pts[0][1] - c.z) < 14 || hyp(r.pts[r.pts.length - 1][0] - c.x, r.pts[r.pts.length - 1][1] - c.z) < 14)) ar.push({ r, s: d.s, i: d.i, d: d.d }); }
    if (ar.length < 2) continue;
    ar.sort((p, q) => q.r.cw - p.r.cw);
    const top = ar[0], pi = Math.min(top.i, top.r.pts.length - 2), a0 = top.r.pts[pi], a1 = top.r.pts[pi + 1], bl = hyp(a1[0] - a0[0], a1[1] - a0[1]) || 1, bx = (a1[0] - a0[0]) / bl, bz = (a1[1] - a0[1]) / bl;
    const clr = Math.min(16, Math.max(8, ar[Math.min(1, ar.length - 1)].r.cw / 2 + 5.5, top.r.cw / 2 + 4));
    const arms = [];
    for (const { r, s, i } of ar) {
      const j = Math.min(i, r.pts.length - 2), p0 = r.pts[j], p1 = r.pts[j + 1], l = hyp(p1[0] - p0[0], p1[1] - p0[1]) || 1, tx = (p1[0] - p0[0]) / l, tz = (p1[1] - p0[1]) / l;
      const group = Math.abs(tx * bx + tz * bz) >= 0.72 ? 0 : 1;
      const back = Math.min(clr, s - 1.5), fwd = Math.min(clr, r.len - s - 1.5);
      if (back >= 5.5) arms.push({ road: r, s, mv: 1, group, clr: back });
      if (!r.oneway && fwd >= 5.5) arms.push({ road: r, s, mv: -1, group, clr: fwd });
    }
    if (arms.length < 3 || arms.every((a) => !a.road.main) || !arms.some((a) => a.group === 0) || !arms.some((a) => a.group === 1)) continue;
    out.push({ x: c.x, z: c.z, arms, score: arms.reduce((t, a) => t + a.road.cw, 0) });
  }
  out.sort((p, q) => q.score - p.score);
  const keep = [];
  for (const o of out) { if (keep.length >= max) break; if (keep.every((k) => hyp(k.x - o.x, k.z - o.z) > 90)) keep.push(o); }
  keep.forEach((k, i) => { k.id = i; k.off = (i * 13) % SIGNAL_CYCLE; });
  return keep;
}
