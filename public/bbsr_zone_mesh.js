// 3D meshes for the extra areas of Bhubaneswar: glass towers, flyovers, buses and trucks, factory sheds, gate arches, roundabouts,
// fountains, the university building, the Khandagiri hill with its rock-cut caves and the Jain temple on top.
import { Batch, pidha } from './bbsr_mesh.js';
import { signTexture } from './textures.js';
import { HILL, HILL_PATH, hillHeight } from './bbsr_zones.js';

// window pattern for the glass towers: one tile = 4 floors x 4 window bays. A second picture marks which windows are lit at night.
function glassTextures(THREE, aniso) {
  const S = 256, mk = () => { const c = document.createElement('canvas'); c.width = c.height = S; return c; };
  const a = mk(), b = mk(), ga = a.getContext('2d'), gb = b.getContext('2d');
  ga.fillStyle = '#6f8499'; ga.fillRect(0, 0, S, S); gb.fillStyle = '#000'; gb.fillRect(0, 0, S, S);
  let seed = 99; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const cw = S / 4, chh = S / 4;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = i * cw, y = j * chh, tint = 150 + Math.floor(rnd() * 40);
    ga.fillStyle = `rgb(${tint - 70},${tint - 28},${tint + 10})`; ga.fillRect(x + 4, y + 5, cw - 8, chh - 12);
    const g = ga.createLinearGradient(x, y, x, y + chh); g.addColorStop(0, 'rgba(255,255,255,.28)'); g.addColorStop(0.5, 'rgba(255,255,255,0)'); ga.fillStyle = g; ga.fillRect(x + 4, y + 5, cw - 8, chh - 12);
    if (rnd() < 0.55) { gb.fillStyle = rnd() < 0.8 ? '#ffd9a0' : '#cfe6ff'; gb.fillRect(x + 4, y + 5, cw - 8, chh - 12); }
    ga.fillStyle = 'rgba(25,35,45,.9)'; ga.fillRect(x, y + chh - 7, cw, 3);   // floor slab line
  }
  const T = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t; };
  return { map: T(a), emissive: T(b) };
}

// a sloping slab between two points on the ground plan (the deck of a flyover)
function slab(B, ax, az, ay, bx, bz, by, w, thick, hex) {
  const L = Math.hypot(bx - ax, bz - az) || 1, px = (-(bz - az) / L) * (w / 2), pz = ((bx - ax) / L) * (w / 2), cc = B.col(hex);
  const A0 = [ax + px, ay, az + pz], A1 = [ax - px, ay, az - pz], B0 = [bx + px, by, bz + pz], B1 = [bx - px, by, bz - pz];
  const dn = (p) => [p[0], p[1] - thick, p[2]], uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
  B.quad(A0, B0, B1, A1, [0, 1, 0], uv, cc);
  B.quad(dn(A0), dn(A1), dn(B1), dn(B0), [0, -1, 0], uv, cc);
  const nL = [px / (w / 2), 0, pz / (w / 2)];
  B.quad(A0, B0, dn(B0), dn(A0), nL, uv, cc);
  B.quad(A1, B1, dn(B1), dn(A1), [-nL[0], 0, -nL[2]], uv, cc);
}

export function buildZoneExtras({ THREE, mergeGeometries }, plan, tex, M, opts = {}) {
  const shadows = opts.shadows !== false, group = new THREE.Group(), aniso = 4;
  const add = (m) => { if (m) group.add(m); return m; };
  const gt = glassTextures(THREE, aniso);
  const glassMat = new THREE.MeshStandardMaterial({ map: gt.map, vertexColors: true, metalness: 0.25, roughness: 0.32, emissive: 0xffffff, emissiveMap: gt.emissive, emissiveIntensity: 0 });
  const plain = M.plain, facade = M.facade;

  // ----- towers -----
  {
    const gl = new Batch(THREE), cf = new Batch(THREE), roofs = new Batch(THREE), TINT = [0xe6f0f7, 0xcfe0ee, 0xeef0ea, 0xd9e8e4];
    plan.towers.forEach((t, i) => {
      if (t.kind === 'glass') {
        gl.box(t.x, t.z, 0, t.w, t.h, t.d, t.yaw, TINT[i % TINT.length], { us: 14, vs: 14.8, top: false });
        roofs.box(t.x, t.z, t.h, t.w + 0.6, 0.7, t.d + 0.6, t.yaw, 0x5b5f63);
        roofs.box(t.x, t.z, t.h + 0.7, t.w * 0.38, 2.6, t.d * 0.38, t.yaw, 0x888d91);
        roofs.box(t.x + t.w * 0.2, t.z + t.d * 0.1, t.h + 0.7, 1.2, 9, 1.2, t.yaw, 0xb8bcc0);   // mast
        gl.box(t.x, t.z, 0, t.w + 0.4, 3.2, t.d + 0.4, t.yaw, 0x3d444a, { us: 6, vs: 3, top: false });   // dark podium
      } else {
        cf.box(t.x, t.z, 0, t.w, t.h, t.d, t.yaw, t.color || 0xe8dcc0, { us: 6, vs: 3.2, top: false });
        roofs.box(t.x, t.z, t.h, t.w + 0.5, 0.5, t.d + 0.5, t.yaw, 0xcfc8b8);
        roofs.box(t.x + t.w * 0.25, t.z, t.h + 0.5, 1.6, 1.3, 1.6, t.yaw, 0x2a2f33);
      }
    });
    add(gl.mesh(glassMat, shadows)); add(cf.mesh(facade, shadows)); add(roofs.mesh(plain, shadows));
  }

  // ----- flyovers -----
  if (plan.flyovers.length) {
    const deck = new Batch(THREE), piers = new Batch(THREE), marks = new Batch(THREE);
    for (const f of plan.flyovers) {
      const hAt = (s) => (s < f.ramp ? (f.h * s) / f.ramp : f.L - s < f.ramp ? (f.h * (f.L - s)) / f.ramp : f.h);
      const px = -f.dz, pz = f.dx;
      for (let s = 0; s < f.L; s += 5) {
        const e = Math.min(f.L, s + 5), ya = hAt(s), yb = hAt(e), ax = f.x0 + f.dx * s, az = f.z0 + f.dz * s, bx = f.x0 + f.dx * e, bz = f.z0 + f.dz * e;
        slab(deck, ax, az, ya, bx, bz, yb, f.w, 1.0, 0xb9b5ab);
        for (const sd of [-1, 1]) {        // parapet walls on both edges
          const ox = px * (f.w / 2 - 0.2) * sd, oz = pz * (f.w / 2 - 0.2) * sd;
          slab(deck, ax + ox, az + oz, ya + 1.0, bx + ox, bz + oz, yb + 1.0, 0.4, 1.0, 0xa7a399);
        }
        if (Math.floor(s / 5) % 2 === 0) slab(marks, ax, az, ya + 0.02, bx, bz, yb + 0.02, 0.18, 0.02, 0xf2f2f2);
      }
      for (const p of f.piers || []) {
        piers.box(p.x, p.z, 0, 1.5, p.h - 0.9, 1.5, f.yaw, 0xa9a69c);
        piers.box(p.x, p.z, p.h - 1.4, f.w * 0.8, 0.7, 2.0, f.yaw + Math.PI / 2, 0xa0a096);
      }
    }
    add(deck.mesh(plain, shadows)); add(piers.mesh(plain, shadows));
    const mm = marks.mesh(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), false); add(mm);
  }

  // ----- vehicles and sheds -----
  {
    const veh = new Batch(THREE);
    for (const b of plan.buses) {
      const P = (lx, lz) => { const c = Math.cos(b.yaw), s = Math.sin(b.yaw); return [b.x + lx * c + lz * s, b.z - lx * s + lz * c]; };
      veh.box(b.x, b.z, 0.5, 2.5, 2.9, 10.4, b.yaw, b.color, { us: 2, vs: 2 });
      veh.box(b.x, b.z, 3.0, 2.3, 0.35, 10.0, b.yaw, 0xe9e6dd, { us: 2, vs: 2 });
      veh.box(b.x, b.z, 1.6, 2.56, 1.0, 9.3, b.yaw, 0x1d2a33, { us: 2, vs: 2, top: false });
      const f = P(0, -5.2); veh.box(f[0], f[1], 1.5, 2.3, 1.1, 0.16, b.yaw, 0x1d2a33, { us: 2, vs: 2 });
      for (const [lx, lz] of [[-1.3, -3.4], [1.3, -3.4], [-1.3, 3.4], [1.3, 3.4]]) { const q = P(lx, lz); veh.box(q[0], q[1], 0, 0.35, 1.0, 1.0, b.yaw, 0x151515, { us: 2, vs: 2 }); }
    }
    for (const t of plan.trucks) {
      const P = (lx, lz) => { const c = Math.cos(t.yaw), s = Math.sin(t.yaw); return [t.x + lx * c + lz * s, t.z - lx * s + lz * c]; };
      const cab = P(0, -4.1), box = P(0, 1.2);
      veh.box(cab[0], cab[1], 0.7, 2.4, 2.4, 2.3, t.yaw, t.color, { us: 2, vs: 2 });
      veh.box(cab[0], cab[1], 1.9, 2.42, 0.9, 1.0, t.yaw, 0x1d2a33, { us: 2, vs: 2 });
      veh.box(box[0], box[1], 0.9, 2.5, 2.9, 7.4, t.yaw, 0xd8d4c8, { us: 2, vs: 2 });
      veh.box(box[0], box[1], 0.5, 1.6, 0.5, 8.4, t.yaw, 0x2a2a2a, { us: 2, vs: 2 });
      for (const [lx, lz] of [[-1.3, -4.0], [1.3, -4.0], [-1.3, 2.0], [1.3, 2.0], [-1.3, 3.4], [1.3, 3.4]]) { const q = P(lx, lz); veh.box(q[0], q[1], 0, 0.4, 1.0, 1.0, t.yaw, 0x151515, { us: 2, vs: 2 }); }
    }
    add(veh.mesh(plain, shadows));

    const walls = new Batch(THREE), roofs = new Batch(THREE);
    for (const s of plan.sheds) {
      if (s.kind === 'factory') {
        walls.box(s.x, s.z, 0, s.w, s.h, s.d, s.yaw, 0xa7b2ba, { us: 6, vs: 6, top: false });
        walls.box(s.x, s.z, s.h * 0.55, s.w + 0.1, 0.5, s.d + 0.1, s.yaw, 0xd9d4c6, { us: 6, vs: 6, top: false });
        for (let k = -2; k <= 2; k++) walls.box(s.x + k * 10, s.z - s.d / 2 - 0.05, 0, 5, 4.6, 0.2, s.yaw, 0x4d5d6a, { us: 3, vs: 3 });
        const bays = Math.round(s.w / 9);
        for (let k = 0; k < bays; k++) roofs.prism(s.x - s.w / 2 + (k + 0.5) * (s.w / bays), s.z, s.h, s.w / bays + 0.1, s.d + 0.6, 2.4, s.yaw + Math.PI / 2 - Math.PI / 2, 0x8b94a0);
      } else {   // open platform roof for the bus bays
        for (const lx of [-0.45, -0.15, 0.15, 0.45]) walls.box(s.x + lx * s.w, s.z - s.d / 2 + 0.6, 0, 0.5, s.h, 0.5, s.yaw, 0x5b5f63, { us: 2, vs: 2 });
        for (const lx of [-0.45, -0.15, 0.15, 0.45]) walls.box(s.x + lx * s.w, s.z + s.d / 2 - 0.6, 0, 0.5, s.h, 0.5, s.yaw, 0x5b5f63, { us: 2, vs: 2 });
        roofs.box(s.x, s.z, s.h, s.w + 2, 0.5, s.d + 2.4, s.yaw, 0x3f6f9a);
        roofs.box(s.x, s.z + s.d / 2 + 1.2, s.h - 0.9, s.w + 2, 1.4, 0.15, s.yaw, 0xe9e6dd);
      }
    }
    add(walls.mesh(plain, shadows)); add(roofs.mesh(plain, shadows));
  }

  // ----- arches over roads and gates -----
  {
    const B = new Batch(THREE), signGeoCache = new Map();
    for (const a of plan.arches) {
      const cy = Math.cos(a.yaw), sy = Math.sin(a.yaw), P = (lx, lz) => [a.x + lx * cy + lz * sy, a.z - lx * sy + lz * cy];
      for (const sd of [-1, 1]) {
        const q = P(sd * a.span / 2, 0);
        B.box(q[0], q[1], 0, 2.2, 0.8, 2.2, a.yaw, 0xd8c8a6); B.box(q[0], q[1], 0.8, 1.5, a.h - 0.8, 1.5, a.yaw, 0xf0e2c4); B.box(q[0], q[1], a.h, 2.0, 0.6, 2.0, a.yaw, 0xd8c8a6);
      }
      B.box(a.x, a.z, a.h + 0.6, a.span + 2.2, 1.5, 2.0, a.yaw, 0xe9d8b4);
      B.box(a.x, a.z, a.h + 2.1, a.span * 0.55, 0.7, 1.4, a.yaw, 0xd8c8a6);
      const w = Math.min(a.span * 1.05, 20), key = a.text + w;
      if (!signGeoCache.has(key)) signGeoCache.set(key, new THREE.MeshStandardMaterial({ map: signTexture(a.text, '#1f4f7a', '#ffffff'), side: THREE.DoubleSide, roughness: 0.8 }));
      for (const sd of [1, -1]) {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.2), signGeoCache.get(key)), q = P(0, sd * 1.05);
        m.position.set(q[0], a.h + 1.35, q[1]); m.rotation.y = a.yaw + (sd < 0 ? Math.PI : 0); m.scale.set(1, 0.7, 1); group.add(m);
      }
    }
    add(B.mesh(M.plain, shadows));
  }

  // ----- roundabout islands and fountains -----
  {
    const grass = new THREE.MeshStandardMaterial({ color: 0x5f9a4a, roughness: 0.95 }), curb = new THREE.MeshStandardMaterial({ color: 0xcfc6b2, roughness: 0.8 });
    for (const r of plan.rounds) {
      const g = new THREE.Mesh(new THREE.CylinderGeometry(r.r, r.r, 0.5, 48), grass); g.position.set(r.x, 0.25, r.z); g.receiveShadow = true; group.add(g);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(r.r + 0.6, r.r + 0.6, 0.38, 48), curb); c.position.set(r.x, 0.19, r.z); c.receiveShadow = true; group.add(c);
    }
    const water = new THREE.MeshStandardMaterial({ color: 0x3f8fb0, roughness: 0.1, metalness: 0.1 });
    for (const p of plan.props.filter((q) => q.type === 'fountain')) {
      const y0 = plan.rounds.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 1) ? 0.5 : 0;
      const basin = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r + 0.4, 0.9, 32), curb); basin.position.set(p.x, y0 + 0.45, p.z); basin.castShadow = shadows; group.add(basin);
      const w = new THREE.Mesh(new THREE.CylinderGeometry(p.r - 0.35, p.r - 0.35, 0.05, 32), water); w.position.set(p.x, y0 + 0.82, p.z); group.add(w);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.45, p.r * 0.9, 12), curb); col.position.set(p.x, y0 + p.r * 0.45 + 0.4, p.z); col.castShadow = shadows; group.add(col);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.38, 0.4, 0.45, 20), curb); bowl.position.set(p.x, y0 + p.r * 0.9 + 0.5, p.z); group.add(bowl);
      const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.16, p.r * 0.6, 8), new THREE.MeshStandardMaterial({ color: 0xcfeaff, transparent: true, opacity: 0.55 })); jet.position.set(p.x, y0 + p.r * 0.9 + 0.9 + p.r * 0.3, p.z); group.add(jet);
    }
  }

  // ----- one-off props: factory chimneys, the university building, the Jain temple -----
  {
    const B = new Batch(THREE), gold = new Batch(THREE);
    for (const p of plan.props) {
      if (p.type === 'chimney') {
        const n = 8, step = p.h / n;
        for (let i = 0; i < n; i++) { const w = 3.3 - (i / n) * 1.4; B.box(p.x, p.z, i * step, w, step, w, 0, i % 2 ? 0xeeeeee : 0xc0392b, { us: 3, vs: 3 }); }
        B.box(p.x, p.z, p.h, 2.3, 0.5, 2.3, 0, 0x333333);
      } else if (p.type === 'admin') {
        const c = Math.cos(p.yaw), s = Math.sin(p.yaw), P = (lx, lz) => [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
        B.box(p.x, p.z, 0, p.w, 10.5, p.d, p.yaw, 0xf1e6cc, { us: 6, vs: 3.2 });
        B.box(p.x, p.z, 0, p.w + 1.2, 1.0, p.d + 1.2, p.yaw, 0xd9ccb0);
        for (let lx = -p.w / 2 + 3; lx <= p.w / 2 - 2.9; lx += 5.4) { const q = P(lx, p.d / 2 + 1.4); B.box(q[0], q[1], 0.6, 1.2, 9.6, 1.2, p.yaw, 0xfaf3e3); }
        B.box(p.x, p.z, 10.4, p.w + 1.6, 1.2, p.d + 3.4, p.yaw, 0xe6d9bb);
        const f = P(0, p.d / 2 + 1.4); B.prism(f[0], f[1], 11.6, p.w * 0.42, 3.6, 3.0, p.yaw + Math.PI / 2, 0xf3e8cf);
        B.box(p.x, p.z, 11.6, 14, 4.5, 14, p.yaw, 0xf1e6cc);
        const q2 = P(0, p.d / 2 + 4.6); B.box(q2[0], q2[1], 0, p.w * 0.55, 0.5, 3.0, p.yaw, 0xd9ccb0);
        const dome = new THREE.Mesh(new THREE.SphereGeometry(6.2, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe9ddc0, roughness: 0.7 }));
        dome.position.set(p.x, 16.1, p.z); dome.castShadow = shadows; group.add(dome);
        gold.box(p.x, p.z, 22.2, 0.5, 2.6, 0.5, 0, 0xd4a017);
      } else if (p.type === 'jain') {
        const y = p.y, W = 0xfaf3e3;
        B.box(p.x, p.z, y - 3, 17, 4, 17, 0, 0xcdbf9f); B.box(p.x, p.z, y + 0.4, 15, 0.8, 15, 0, 0xe6d9bb);
        B.box(p.x, p.z, y + 1.2, 7.2, 5.2, 7.2, 0, W, { us: 4, vs: 4 });
        for (const [dx, dz] of [[-4.6, -4.6], [4.6, -4.6], [-4.6, 4.6], [4.6, 4.6]]) { B.box(p.x + dx, p.z + dz, y + 1.2, 1.4, 3.2, 1.4, 0, W); B.prism(p.x + dx, p.z + dz, y + 4.4, 1.7, 1.7, 1.0, 0, 0xf3e8cf); }
        pidha(B, gold, p.x, p.z, 7.2, 7.2, 9, 3, 0, { noBase: true, y0: y + 6.4, stone: W });
        gold.box(p.x, p.z, y + 15.4, 0.5, 2.0, 0.5, 0, 0xd4a017);
        B.box(p.x, p.z + 3.9, y + 1.2, 2.2, 3.4, 0.5, 0, 0x2a1a10);        // the doorway
      }
    }
    add(B.mesh(M.stone, shadows)); add(gold.mesh(M.gold, false));
  }

  // ----- Khandagiri hill: terrain, path, rock-cut caves -----
  if (plan.hill) {
    const hl = plan.hill, nx = Math.ceil((hl.rx * 2 + 40) / 3), nz = Math.ceil((hl.rz * 2 + 40) / 3);
    const geo = new THREE.PlaneGeometry(hl.rx * 2 + 40, hl.rz * 2 + 40, nx, nz).rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, uv = geo.attributes.uv, col = new Float32Array(pos.count * 3);
    const dPath = (x, z) => { let d = 1e9; for (let i = 0; i + 1 < HILL_PATH.length; i++) { const [ax, az] = HILL_PATH[i], [bx, bz] = HILL_PATH[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)); d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t)); } return d; };
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + hl.cx, z = pos.getZ(i) + hl.cz, h = hillHeight(x, z);
      pos.setXYZ(i, pos.getX(i), h - 0.012, pos.getZ(i));
      uv.setXY(i, x / 8, z / 8);
      const slope = Math.hypot(hillHeight(x + 2, z) - hillHeight(x - 2, z), hillHeight(x, z + 2) - hillHeight(x, z - 2)) / 4;
      const rock = Math.min(1, h / 14 + slope * 0.9), top = Math.min(1, Math.max(0, (h - 38) / 10));
      let r = 1 - 0.28 * rock, g = 1 - 0.40 * rock, b = 1 - 0.54 * rock;
      r += 0.05 * top; g += 0.03 * top;
      const p = dPath(x, z);
      if (p < 3.4) { const f = Math.max(0, 1 - Math.max(0, p - 1.6) / 1.8); r = r * (1 - f) + 0.96 * f; g = g * (1 - f) + 0.92 * f; b = b * (1 - f) + 0.84 * f; }
      col[i * 3] = Math.min(1, r); col[i * 3 + 1] = Math.min(1, g); col[i * 3 + 2] = Math.min(1, b);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: tex.cityGround, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mesh = new THREE.Mesh(geo, mat); mesh.position.set(hl.cx, 0, hl.cz); mesh.receiveShadow = true; mesh.castShadow = shadows; group.add(mesh);

    const rock = new Batch(THREE), dark = new Batch(THREE);
    for (const c of plan.caves) {
      const g = c.y, P = (lx, lz) => { const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw); return [c.x + lx * cy + lz * sy, c.z - lx * sy + lz * cy]; };
      rock.box(c.x, c.z, g - 1.8, 8.6, 7.4, 3.4, c.yaw, 0xb39a76, { us: 3, vs: 3 });                 // the carved block of rock
      const front = P(0, 1.75);
      dark.box(front[0], front[1], g - 0.4, 5.2, 3.6, 0.3, c.yaw, 0x120d09, { us: 3, vs: 3 });          // the dark doorway
      for (const sd of [-1, 1]) { const q = P(sd * 3.1, 2.15); rock.box(q[0], q[1], g - 1.2, 1.0, 4.9, 1.0, c.yaw, 0xc7ae88, { us: 2, vs: 2 }); }
      const lt = P(0, 2.15); rock.box(lt[0], lt[1], g + 3.6, 7.6, 0.9, 1.3, c.yaw, 0xc7ae88, { us: 3, vs: 3 });
      const fr = P(0, 2.0); rock.box(fr[0], fr[1], g + 4.5, 7.0, 0.8, 0.9, c.yaw, 0xd9bf94, { us: 3, vs: 3 });
      for (let k = -2; k <= 2; k++) { const q = P(k * 1.3, 2.5); rock.box(q[0], q[1], g + 4.5, 0.5, 0.8, 0.3, c.yaw, 0xb39a76); }
    }
    add(rock.mesh(M.stone, shadows)); add(dark.mesh(M.plain, false));
  }

  return { group, mats: { glass: glassMat } };
}
