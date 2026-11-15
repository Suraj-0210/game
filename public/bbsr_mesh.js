// Bhubaneswar Old Town: turns the plan into 3D meshes (one merged mesh per material, so the whole town is only a few draw calls).
import { signTexture, ludoBoardTexture } from './textures.js';
import { hoardingTexture } from './bbsr_tex.js';
import { LAKE, lakeRing, lakeValue, COMPOUND, WORLD } from './bbsr_plan.js';

// ---------- a growable triangle batch: boxes, flat quads, ribbons, lofted surfaces ----------
class Batch {
  constructor(THREE) { this.T = THREE; this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.v = 0; this.cache = new Map(); }
  col(hex) { let c = this.cache.get(hex); if (!c) { const k = new this.T.Color(hex); c = [k.r, k.g, k.b]; this.cache.set(hex, c); } return c; }
  vert(x, y, z, nx, ny, nz, u, v, c) { this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(c[0], c[1], c[2]); return this.v++; }
  // a quad a-b-c-d, wound so that it faces the given normal
  quad(a, b, c, d, nrm, uvs, cc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
    const flip = gx * nrm[0] + gy * nrm[1] + gz * nrm[2] < 0;
    const i0 = this.vert(a[0], a[1], a[2], nrm[0], nrm[1], nrm[2], uvs[0][0], uvs[0][1], cc), i1 = this.vert(b[0], b[1], b[2], nrm[0], nrm[1], nrm[2], uvs[1][0], uvs[1][1], cc),
      i2 = this.vert(c[0], c[1], c[2], nrm[0], nrm[1], nrm[2], uvs[2][0], uvs[2][1], cc), i3 = this.vert(d[0], d[1], d[2], nrm[0], nrm[1], nrm[2], uvs[3][0], uvs[3][1], cc);
    if (flip) this.i.push(i0, i2, i1, i0, i3, i2); else this.i.push(i0, i1, i2, i0, i2, i3);
  }
  // box centred at (cx, cz), base at y0, size w (local x) x h x d (local z), turned by yaw like a three.js rotation.y
  box(cx, cz, y0, w, h, d, yaw, hex, o = {}) {
    const us = o.us || 6, vs = o.vs || 6, cc = this.col(hex), cy = Math.cos(yaw), sy = Math.sin(yaw), hw = w / 2, hd = d / 2, y1 = y0 + h;
    const W = (lx, lz) => [cx + lx * cy + lz * sy, cz - lx * sy + lz * cy];
    const P = [W(-hw, -hd), W(hw, -hd), W(hw, hd), W(-hw, hd)];
    if (o.sides !== false) {
      const N = [[0, -1], [1, 0], [0, 1], [-1, 0]], L = [w, d, w, d];
      for (let k = 0; k < 4; k++) {
        const a = P[k], b = P[(k + 1) % 4], nx = N[k][0] * cy + N[k][1] * sy, nz = -N[k][0] * sy + N[k][1] * cy;
        const u0 = o.uOff ? o.uOff(k) : 0;
        this.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], [nx, 0, nz], [[u0, y0 / vs], [u0 + L[k] / us, y0 / vs], [u0 + L[k] / us, y1 / vs], [u0, y1 / vs]], cc);
      }
    }
    if (o.top !== false) this.quad([P[0][0], y1, P[0][1]], [P[1][0], y1, P[1][1]], [P[2][0], y1, P[2][1]], [P[3][0], y1, P[3][1]], [0, 1, 0], [[P[0][0] / us, P[0][1] / us], [P[1][0] / us, P[1][1] / us], [P[2][0] / us, P[2][1] / us], [P[3][0] / us, P[3][1] / us]], cc);
  }
  // a flat horizontal rectangle (roads, paving, awnings seen from above)
  flat(cx, cz, y, w, d, yaw, hex, us = 6) {
    const cc = this.col(hex), cy = Math.cos(yaw), sy = Math.sin(yaw), hw = w / 2, hd = d / 2;
    const W = (lx, lz) => [cx + lx * cy + lz * sy, y, cz - lx * sy + lz * cy], P = [W(-hw, -hd), W(hw, -hd), W(hw, hd), W(-hw, hd)];
    this.quad(P[0], P[1], P[2], P[3], [0, 1, 0], P.map((q) => [q[0] / us, q[2] / us]), cc);
  }
  // flat quad between two edges (a-b inner, c-d outer), for the promenade ring
  flatQuad(p0, p1, p2, p3, y, hex, us = 6) {
    const P = [p0, p1, p2, p3].map((q) => [q[0], y, q[1]]);
    this.quad(P[0], P[1], P[2], P[3], [0, 1, 0], P.map((q) => [q[0] / us, q[2] / us]), this.col(hex));
  }
  // gable roof: ridge along local x
  prism(cx, cz, y0, w, d, rise, yaw, hex) {
    const cc = this.col(hex), cy = Math.cos(yaw), sy = Math.sin(yaw), hw = w / 2, hd = d / 2;
    const W = (lx, lz, y) => [cx + lx * cy + lz * sy, y, cz - lx * sy + lz * cy];
    const A = W(-hw, -hd, y0), B = W(hw, -hd, y0), C = W(hw, hd, y0), D = W(-hw, hd, y0), R1 = W(-hw, 0, y0 + rise), R2 = W(hw, 0, y0 + rise);
    const nS = [0, hd, -rise], nN = [0, hd, rise], rot = (n) => [n[0] * cy + n[2] * sy, n[1], -n[0] * sy + n[2] * cy], nrmz = (n) => { const q = rot(n), l = Math.hypot(...q); return [q[0] / l, q[1] / l, q[2] / l]; };
    const uvq = [[0, 0], [w / 6, 0], [w / 6, 1], [0, 1]];
    this.quad(A, B, R2, R1, nrmz([0, hd, -rise]), uvq, cc);
    this.quad(D, C, R2, R1, nrmz([0, hd, rise]), uvq, cc);
    const tri = (p, q, r, n) => { const i0 = this.vert(p[0], p[1], p[2], n[0], n[1], n[2], 0, 0, cc), i1 = this.vert(q[0], q[1], q[2], n[0], n[1], n[2], 1, 0, cc), i2 = this.vert(r[0], r[1], r[2], n[0], n[1], n[2], 0.5, 1, cc); const g = [(q[1] - p[1]) * (r[2] - p[2]) - (q[2] - p[2]) * (r[1] - p[1]), (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]), (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])]; if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) this.i.push(i0, i2, i1); else this.i.push(i0, i1, i2); };
    const e = nrmz([-1, 0, 0]), f = nrmz([1, 0, 0]);
    tri(A, D, R1, e); tri(B, C, R2, f);
  }
  // lofted surface through rings of points (each ring closes on itself: its last point repeats the first). Smooth normals.
  loft(rings, uRep, vScale, hex) {
    const cc = this.col(hex), R = rings.length, M = rings[0].length - 1, base = this.v, nacc = new Float32Array(R * M * 3);
    for (let r = 0; r < R; r++) for (let k = 0; k <= M; k++) { const q = rings[r][k]; this.vert(q[0], q[1], q[2], 0, 1, 0, (k / M) * uRep, q[1] / vScale, cc); }
    const id = (r, k) => base + r * (M + 1) + k;
    let flip = null;
    const tri = (a, b, c, ra, kb) => {
      const pa = [this.p[a * 3], this.p[a * 3 + 1], this.p[a * 3 + 2]], pb = [this.p[b * 3], this.p[b * 3 + 1], this.p[b * 3 + 2]], pc = [this.p[c * 3], this.p[c * 3 + 1], this.p[c * 3 + 2]];
      const ux = pb[0] - pa[0], uy = pb[1] - pa[1], uz = pb[2] - pa[2], vx = pc[0] - pa[0], vy = pc[1] - pa[1], vz = pc[2] - pa[2];
      let gx = uy * vz - uz * vy, gy = uz * vx - ux * vz, gz = ux * vy - uy * vx;
      if (flip === null) { let mx = 0, mz = 0; for (const q of rings[0]) { mx += q[0]; mz += q[2]; } mx /= rings[0].length; mz /= rings[0].length; flip = gx * (pa[0] - mx) + gz * (pa[2] - mz) < 0; }
      if (flip) { gx = -gx; gy = -gy; gz = -gz; this.i.push(a, c, b); } else this.i.push(a, b, c);
      for (const v of [a, b, c]) { const lr = Math.floor((v - base) / (M + 1)), lk = ((v - base) % (M + 1)) % M, o = (lr * M + lk) * 3; nacc[o] += gx; nacc[o + 1] += gy; nacc[o + 2] += gz; }
    };
    for (let r = 0; r < R - 1; r++) for (let k = 0; k < M; k++) { tri(id(r, k), id(r, k + 1), id(r + 1, k + 1)); tri(id(r, k), id(r + 1, k + 1), id(r + 1, k)); }
    for (let r = 0; r < R; r++) for (let k = 0; k <= M; k++) { const o = (r * M + (k % M)) * 3, l = Math.hypot(nacc[o], nacc[o + 1], nacc[o + 2]) || 1, vi = (id(r, k)) * 3; this.n[vi] = nacc[o] / l; this.n[vi + 1] = nacc[o + 1] / l; this.n[vi + 2] = nacc[o + 2] / l; }
  }
  mesh(material, shadows = true) {
    if (!this.v) return null;
    const T = this.T, g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new T.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new T.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.v > 65535 ? new T.Uint32BufferAttribute(this.i, 1) : new T.Uint16BufferAttribute(this.i, 1));
    const m = new T.Mesh(g, material); m.castShadow = shadows; m.receiveShadow = true; return m;
  }
}

// ---------- Kalinga temple parts ----------
// rekha deul: a square body (bada) and a tall curved tower (gandi) that narrows to a ribbed disc (amalaka) and a pot finial (kalasa)
function rekha(B, G, cx, cz, w, H, yaw, o = {}) {
  const STONE = o.stone || 0xf4e6cc, levels = o.levels || 44, M = o.sides || 72, bodyH = H * 0.27, cy = Math.cos(yaw), sy = Math.sin(yaw);
  const rot = (x, z) => [cx + x * cy + z * sy, cz - x * sy + z * cy];
  // lower body: base mouldings, the wall with a projecting panel on each side, a cornice
  B.box(cx, cz, 0, w * 1.04, bodyH * 0.12, w * 1.04, yaw, STONE); B.box(cx, cz, bodyH * 0.12, w * 1.0, bodyH * 0.1, w * 1.0, yaw, STONE);
  B.box(cx, cz, bodyH * 0.22, w * 0.95, bodyH * 0.62, w * 0.95, yaw, STONE);
  for (const [lx, lz, bw, bd] of [[1, 0, 0.9, w * 0.3], [-1, 0, 0.9, w * 0.3], [0, 1, w * 0.3, 0.9], [0, -1, w * 0.3, 0.9]]) {
    const q = rot(lx * (w * 0.475 + 0.3), lz * (w * 0.475 + 0.3));
    B.box(q[0], q[1], bodyH * 0.24, bw, bodyH * 0.58, bd, yaw, STONE, { top: false });
  }
  B.box(cx, cz, bodyH * 0.84, w * 1.03, bodyH * 0.16, w * 1.03, yaw, STONE);
  // curved tower
  const hw0 = w * 0.475, neck = hw0 * 0.40, rings = [], yTop = H * 0.86;
  for (let l = 0; l <= levels; l++) {
    const t = l / levels, y = bodyH + (yTop - bodyH) * t, hw = hw0 - (hw0 - neck) * Math.pow(t, 1.75), ring = [];
    for (let k = 0; k <= M; k++) {
      const th = (k / M) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), e = 2 / 6;
      const rib = 1 + 0.05 * Math.cos(12 * th) * (1 - 0.5 * t) + (t > 0.015 && Math.floor(t * 26) % 2 === 0 ? 0.012 : 0);
      const x = hw * Math.sign(c) * Math.pow(Math.abs(c), e) * rib, z = hw * Math.sign(s) * Math.pow(Math.abs(s), e) * rib, q = rot(x, z);
      ring.push([q[0], y, q[1]]);
    }
    rings.push(ring);
  }
  B.loft(rings, 6, 6, STONE);
  // amalaka (ribbed disc) and kalasa (pot) with a flagstaff
  const ar = neck * 1.55, ah = H * 0.065, ay = yTop, arings = [];
  const prof = [[0.86, 0], [1.0, 0.18], [1.1, 0.45], [1.0, 0.75], [0.7, 1]];
  for (const [rf, hf] of prof) { const ring = []; for (let k = 0; k <= 36; k++) { const th = (k / 36) * Math.PI * 2, rr = ar * rf * (1 + 0.07 * Math.cos(32 * th)), q = rot(Math.cos(th) * rr, Math.sin(th) * rr); ring.push([q[0], ay + ah * hf, q[1]]); } arings.push(ring); }
  B.loft(arings, 4, 4, STONE);
  const ky = ay + ah, kh = H * 0.07, krings = [], kp = [[0.25, 0], [0.7, 0.12], [1.0, 0.35], [0.8, 0.62], [0.35, 0.8], [0.25, 0.9], [0.0, 1.0]];
  for (const [rf, hf] of kp) { const ring = []; for (let k = 0; k <= 20; k++) { const th = (k / 20) * Math.PI * 2, rr = neck * 0.55 * rf + 0.001, q = rot(Math.cos(th) * rr, Math.sin(th) * rr); ring.push([q[0], ky + kh * hf, q[1]]); } krings.push(ring); }
  G.loft(krings, 2, 2, 0xd9a830);
  const pole = H * 0.07;
  G.box(cx, cz, ky + kh, 0.12, pole, 0.12, 0, 0x7a6038, { us: 2, vs: 2 });
  G.box(cx + 0.55, cz, ky + kh + pole * 0.55, 1.0, 0.55, 0.05, 0, 0xe05a2a, { us: 2, vs: 2 });
}

// pidha deul / mandapa: a stone block under a stepped pyramid roof
function pidha(B, G, cx, cz, w, d, h, tiers, yaw, o = {}) {
  const STONE = o.stone || 0xf2e2c6, baseH = o.noBase ? 0 : h * 0.5, th = (h - baseH) / tiers;
  if (!o.noBase) { B.box(cx, cz, 0, w * 1.04, 0.9, d * 1.04, yaw, STONE); B.box(cx, cz, 0.9, w, baseH - 0.9, d, yaw, STONE); }
  let y = (o.y0 || 0) + baseH;
  for (let i = 0; i < tiers; i++) {
    const f = 1 - 0.8 * (i / tiers), wi = Math.max(1.2, w * f), di = Math.max(1.2, d * f);
    B.box(cx, cz, y, wi + 0.7, th * 0.35, di + 0.7, yaw, STONE);
    B.box(cx, cz, y + th * 0.35, wi, th * 0.65, di, yaw, STONE);
    y += th;
  }
  const ar = Math.max(w, d) * 0.12;
  B.box(cx, cz, y, ar * 2.2, ar * 0.8, ar * 2.2, yaw, STONE);
  G.box(cx, cz, y + ar * 0.8, 0.5, ar * 1.8, 0.5, 0, 0xd9a830, { us: 2, vs: 2 });
  return y + ar * 2.6;
}

// the points of a closed ring pushed outwards by d metres (numeric gradient of the tank's equation)
function offsetRing(ring, d) {
  return ring.map(([x, z]) => {
    const e = 0.5, gx = lakeValue(x + e, z) - lakeValue(x - e, z), gz = lakeValue(x, z + e) - lakeValue(x, z - e), l = Math.hypot(gx, gz) || 1;
    return [x + (gx / l) * d, z + (gz / l) * d];
  });
}

export function buildCity({ THREE, mergeGeometries }, plan, tex, opts = {}) {
  const shadows = opts.shadows !== false, group = new THREE.Group();
  const std = (extra) => new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0, envMapIntensity: 0.5, ...extra });
  const M = {
    ground: std({ map: tex.cityGround }),
    asphalt: std({ map: tex.asphalt, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
    paving: std({ map: tex.paving, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    marks: std({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    stone: std({ map: tex.sandstone, vertexColors: true }),
    laterite: std({ map: tex.laterite, vertexColors: true }),
    facade: std({ map: tex.facade, vertexColors: true }),
    plain: std({ vertexColors: true }),
    gold: std({ vertexColors: true, metalness: 0.65, roughness: 0.35, envMapIntensity: 1.2 }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xfff1c0, emissive: 0xffe29a, emissiveIntensity: 1.6 }),
  };
  const add = (mesh) => { if (mesh) group.add(mesh); return mesh; };

  // ----- ground -----
  {
    const g = new THREE.PlaneGeometry(3600, 3600).rotateX(-Math.PI / 2), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 450, uv.getY(i) * 450);
    const m = new THREE.Mesh(g, M.ground); m.position.y = -0.02; m.receiveShadow = true; group.add(m);
  }

  // ----- roads, centre lines, courtyard paving -----
  const road = new Batch(THREE), marks = new Batch(THREE), pave = new Batch(THREE);
  for (const r of plan.roads) {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
      road.flat((ax + bx) / 2, (az + bz) / 2, 0.03, L + 0.4, r.w, yaw, 0xffffff, 8);
      road.flat(bx, bz, 0.03, r.w, r.w, yaw, 0xffffff, 8);   // fills the corner at each joint
      if (r.main) for (let s = 2; s < L - 2; s += 7) marks.flat(ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L, 0.035, 2.6, 0.18, yaw, 0xeeeeee);
    }
  }
  for (const p of plan.pave) pave.flat((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2, 0.05, p.x1 - p.x0, p.z1 - p.z0, 0, 0xffffff, 6);
  // the walkway around the tank
  const inner = lakeRing(1.9, 260), outer = offsetRing(inner, 6.6);
  for (let i = 0; i < inner.length; i++) { const j = (i + 1) % inner.length; pave.flatQuad(inner[i], inner[j], outer[j], outer[i], 0.06, 0xffffff, 6); }
  add(road.mesh(M.asphalt, false)); add(marks.mesh(M.marks, false)); add(pave.mesh(M.paving, false));

  // ----- Bindusagar: embankment, water -----
  {
    const lat = new Batch(THREE), ring = lakeRing(1.3, 320);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      lat.box((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0, L + 0.25, 0.95, 1.5, yaw, 0xffffff);
    }
    add(lat.mesh(M.laterite, shadows));
    const shape = new THREE.Shape(), pts = lakeRing(0.4, 300);
    pts.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
    const wg = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), wuv = wg.attributes.uv;
    for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) / 14, wuv.getY(i) / 14);
    const nm = tex.waterNormal;
    const wm = new THREE.MeshStandardMaterial({ color: 0x35706a, roughness: 0.12, metalness: 0.05, normalMap: nm, normalScale: new THREE.Vector2(0.55, 0.55), envMapIntensity: 1.5, });
    const water = new THREE.Mesh(wg, wm); water.position.y = 0.012; water.receiveShadow = true; group.add(water);
    group.userData.waterNormal = nm;
  }

  // ----- Lingaraja compound: walls, gatehouse, temples -----
  const stone = new Batch(THREE), lat2 = new Batch(THREE), gold = new Batch(THREE);
  for (const w of plan.walls) {
    lat2.box(w.x, w.z, 0, w.hw * 2, w.h, w.hd * 2, 0, 0xffffff);
    stone.box(w.x, w.z, w.h, w.hw * 2 + 0.3, 0.45, w.hd * 2 + 0.3, 0, 0xf0dcbc);
  }
  {
    const g = plan.gate, gapW = g.w / 2;
    for (const s of [-1, 1]) { stone.box(g.x, g.z + s * (gapW + 2.5), 0, 6.4, 7, 5, 0, 0xf0dcbc); stone.box(g.x, g.z + s * (gapW + 2.5), 7, 7, 0.5, 5.6, 0, 0xe6d2ae); }
    stone.box(g.x, g.z, 5.0, 6.4, 2.5, g.w + 0.1, 0, 0xf0dcbc);
    pidha(stone, gold, g.x, g.z, 6.4, g.w + 10, 3.6, 3, 0, { noBase: true, y0: 7.5, stone: 0xecd9b8 });   // roof only: the passage underneath stays open
  }
  for (const t of plan.temples) {
    if (t.id === 'lingaraj') rekha(stone, gold, t.x, t.z, t.w, t.h, 0, { levels: 56, sides: 96, stone: 0xf4e4c8 });
    else if (t.kind === 'hall') pidha(stone, gold, t.x, t.z, t.w, t.d, t.h, t.tiers, 0, { stone: 0xf0dfc2 });
    else if (t.kind === 'minor') {
      const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
      stone.box(t.x, t.z, 0, t.w + 3, 0.6, t.w + 3, 0, 0xe6d2ae);
      rekha(stone, gold, t.x, t.z, t.w, t.h, 0, { levels: 26, sides: 48, stone: 0xf4e4c8 });
      pidha(stone, gold, t.x + Math.sin(t.yaw) * (t.w * 0.7), t.z + Math.cos(t.yaw) * (t.w * 0.7), t.w * 0.7, t.w * 0.9, t.h * 0.45, 3, 0, { stone: 0xf0dfc2 });
    } else {
      stone.box(t.x, t.z, 0, t.w + 1.4, 0.45, t.w + 1.4, 0, 0xe6d2ae);
      rekha(stone, gold, t.x, t.z, t.w, t.h, t.yaw, { levels: 16, sides: 28, stone: 0xfaf0dc });
    }
  }
  add(lat2.mesh(M.laterite, shadows)); add(stone.mesh(M.stone, shadows)); add(gold.mesh(M.gold, false));

  // ----- houses -----
  {
    const fa = new Batch(THREE), roofs = new Batch(THREE);
    for (const h of plan.houses) {
      fa.box(h.x, h.z, 0, h.w, h.h, h.d, h.yaw, h.color, { us: 6, vs: 3.2, top: false });
      if (h.pitched) roofs.prism(h.x, h.z, h.h, h.w + 0.5, h.d + 0.5, 1.5 + h.d * 0.12, h.yaw, h.roof);
      else {
        roofs.box(h.x, h.z, h.h, h.w + 0.3, 0.4, h.d + 0.3, h.yaw, 0xcfc8b8, { sides: true });
        if (h.tank) { const c = Math.cos(h.yaw), s = Math.sin(h.yaw); roofs.box(h.x + 0.28 * h.w * c, h.z - 0.28 * h.w * s, h.h + 0.4, 1.4, 1.3, 1.4, h.yaw, 0x2a2f33); }
      }
    }
    // shop awnings over the ground floor, facing the street
    for (const a of plan.awnings) {
      const off = a.d / 2 + 0.95;
      roofs.box(a.x + a.fx * off, a.z + a.fz * off, 2.7, Math.min(a.w * 0.85, 7), 0.12, 2.0, a.yaw, a.color, { us: 2, vs: 2 });
    }
    add(fa.mesh(M.facade, shadows)); add(roofs.mesh(M.plain, shadows));
  }

  // ----- street furniture: lamps, benches, stalls, autos, the chai adda -----
  const fur = new Batch(THREE), lampHeads = new Batch(THREE);
  for (const l of plan.lamps) { fur.box(l.x, l.z, 0, 0.16, 4.8, 0.16, 0, 0x3a3f44, { us: 2, vs: 2 }); lampHeads.box(l.x, l.z, 4.8, 0.55, 0.22, 0.55, 0, 0xffffff, { us: 2, vs: 2 }); }
  for (const b of plan.benches) { fur.box(b.x, b.z - 0.0, 0.0, 1.9, 0.45, 0.55, b.yaw, 0xe6d2ae); fur.box(b.x - Math.sin(b.yaw) * 0.3, b.z - Math.cos(b.yaw) * 0.3, 0.45, 1.9, 0.5, 0.12, b.yaw, 0xe6d2ae); }
  const signs = [];
  for (const s of plan.stalls) {
    const sy = s.yaw, c = Math.cos(sy), sn = Math.sin(sy), P = (lx, lz) => [s.x + lx * c + lz * sn, s.z - lx * sn + lz * c];
    fur.box(s.x, s.z, 0, 3.2, 1.0, 1.6, sy, 0x8b6a45, { us: 2, vs: 2 });
    for (const [lx, lz] of [[-1.7, -1.1], [1.7, -1.1], [-1.7, 1.1], [1.7, 1.1]]) { const q = P(lx, lz); fur.box(q[0], q[1], 0, 0.12, 2.5, 0.12, sy, 0x5b4630, { us: 2, vs: 2 }); }
    fur.box(s.x, s.z, 2.5, 3.8, 0.16, 2.5, sy, parseInt(s.color.slice(1), 16), { us: 2, vs: 2 });
    for (let k = -1; k <= 1; k++) { const q = P(k * 0.9, 0); fur.box(q[0], q[1], 1.0, 0.55, 0.25, 0.55, sy, [0xe8b04a, 0xf2e6c8, 0xc86a3a][k + 1], { us: 2, vs: 2 }); }
    signs.push({ x: P(0, 1.25)[0], z: P(0, 1.25)[1], y: 2.1, yaw: sy, text: s.label, color: s.color });
  }
  for (const a of plan.autos) {
    const c = Math.cos(a.yaw), sn = Math.sin(a.yaw), P = (lx, lz) => [a.x + lx * c + lz * sn, a.z - lx * sn + lz * c];
    fur.box(a.x, a.z, 0.3, 1.35, 0.8, 2.0, a.yaw, 0xf2c230, { us: 2, vs: 2 });
    fur.box(a.x, a.z, 1.1, 1.3, 0.12, 1.7, a.yaw, 0x1f6b3a, { us: 2, vs: 2 });
    const f = P(0, -1.0); fur.box(f[0], f[1], 0.3, 0.6, 0.7, 0.5, a.yaw, 0x1f6b3a, { us: 2, vs: 2 });
    for (const [lx, lz] of [[-0.62, 0.7], [0.62, 0.7], [0, -1.1]]) { const q = P(lx, lz); fur.box(q[0], q[1], 0, 0.22, 0.5, 0.5, a.yaw, 0x1b1b1b, { us: 2, vs: 2 }); }
    for (const lx of [-0.62, 0.62]) { const q = P(lx, -0.6); fur.box(q[0], q[1], 0.35, 0.06, 0.75, 0.06, a.yaw, 0x1f6b3a, { us: 2, vs: 2 }); }
  }
  {
    const ch = plan.chai;
    fur.box(ch.x, ch.z - 5, 0, 17, 3.2, 0.5, 0, 0xc2b08a); fur.box(ch.x, ch.z - 0.5, 3.2, 18, 0.2, 11, 0, 0x6b7478, { us: 2, vs: 2 });
    for (const lx of [-8.5, 8.5]) for (const lz of [-5, 4]) fur.box(ch.x + lx, ch.z + lz, 0, 0.2, 3.3, 0.2, 0, 0x5b4630, { us: 2, vs: 2 });
    fur.box(ch.x, ch.z - 4.4, 0, 4.2, 1.0, 0.9, 0, 0x8b6a45, { us: 2, vs: 2 });                       // the tea counter
    plan.tables.forEach((t) => {
      fur.box(t.x, t.z, 0, 1.8, 0.75, 1.8, 0, 0x8b6a45, { us: 2, vs: 2 });
      for (const [dx, dz] of [[-1.5, 0], [1.5, 0], [0, -1.5], [0, 1.5]]) fur.box(t.x + dx, t.z + dz, 0, 0.5, 0.42, 0.5, 0, 0xc86a3a, { us: 2, vs: 2 });
    });
    signs.push({ x: ch.x, z: ch.z - 4.6, y: 3.9, yaw: 0, text: 'CHAI ADDA', color: '#6e4527', w: 5, flip: true });
  }
  add(fur.mesh(M.plain, shadows)); add(lampHeads.mesh(M.lamp, false));
  const signGeo = new THREE.PlaneGeometry(2.6, 0.8);
  for (const s of signs) {
    const tx = signTexture(s.text.toUpperCase(), s.color, '#ffffff'), m = new THREE.Mesh(s.w ? new THREE.PlaneGeometry(s.w, s.w * 0.31) : signGeo, new THREE.MeshStandardMaterial({ map: tx, side: THREE.DoubleSide, roughness: 0.8 }));
    m.position.set(s.x, s.y, s.z); m.rotation.y = s.yaw + (s.flip ? Math.PI : 0); group.add(m);
  }
  // Ludo boards on the chai adda tables
  {
    const lt = ludoBoardTexture(4), pm = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.7 });
    plan.tables.forEach((t) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), pm); m.position.set(t.x, 0.77, t.z); group.add(m); });
  }

  // ----- edge hoardings -----
  {
    const hb = new Batch(THREE), mats = new Map();
    for (const h of plan.hoardings) {
      const key = h.text.join('|');
      if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ map: hoardingTexture(h.text), roughness: 0.8 }));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 10), mats.get(key)); m.position.set(h.x, 8.5, h.z); m.rotation.y = h.yaw + Math.PI; group.add(m);
      const m2 = m.clone(); m2.rotation.y = h.yaw; m2.position.set(h.x - Math.sin(h.yaw) * 0.3, 8.5, h.z - Math.cos(h.yaw) * 0.3); m2.material = mats.get(key); group.add(m2);
      for (const dx of [-18, 18]) hb.box(h.x + (Math.abs(Math.cos(h.yaw)) > 0.5 ? dx : 0), h.z + (Math.abs(Math.cos(h.yaw)) > 0.5 ? 0 : dx), 0, 0.5, 8.5, 0.5, 0, 0x4a4036, { us: 2, vs: 2 });
    }
    add(hb.mesh(M.plain, false));
  }

  // ----- minimap picture -----
  function mapCanvas() {
    const N = 1024, k = N / WORLD, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), X = (x) => (x + WORLD / 2) * k, Z = (z) => (z + WORLD / 2) * k;
    g.fillStyle = '#c9b88f'; g.fillRect(0, 0, N, N);
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const r of plan.roads) { g.strokeStyle = r.main ? '#7c7a76' : '#8d8a84'; g.lineWidth = r.w * k * 1.05; g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); }
    for (const p of plan.pave) { g.fillStyle = '#d9cbab'; g.fillRect(X(p.x0), Z(p.z0), (p.x1 - p.x0) * k, (p.z1 - p.z0) * k); }
    g.fillStyle = '#e7dcc6';
    for (const h of plan.houses) { g.save(); g.translate(X(h.x), Z(h.z)); g.rotate(-h.yaw); g.fillStyle = '#e9dfca'; g.fillRect((-h.w / 2) * k, (-h.d / 2) * k, h.w * k, h.d * k); g.restore(); }
    g.fillStyle = '#6f9a50'; for (const t of plan.trees.broad) { g.beginPath(); g.arc(X(t.x), Z(t.z), 2.2 * k * 2, 0, 7); g.fill(); }
    g.beginPath(); lakeRing(0, 200).forEach(([x, z], i) => (i ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.closePath();
    g.fillStyle = '#4a9aa6'; g.fill(); g.strokeStyle = '#2f6f78'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#e8c47a'; for (const t of plan.temples) { if (t.kind === 'shrine') { g.fillRect(X(t.x) - 2, Z(t.z) - 2, 4, 4); } }
    g.strokeStyle = '#6b3a28'; g.lineWidth = 3; const C = COMPOUND; g.strokeRect(X(C.cx - C.hw), Z(C.cz - C.hd), C.hw * 2 * k, C.hd * 2 * k);
    return c;
  }

  return {
    group, mapCanvas, setDoor() {},
    update(t) { const nm = group.userData.waterNormal; if (nm) nm.offset.set(t * 0.012, t * 0.007); },
  };
}
