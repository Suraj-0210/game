// Builds the 3D meshes of the beach town from the plan. Everything static is merged into a handful of draw calls.
export function buildTown(deps, plan, tex, opts = {}) {
  const { THREE, mergeGeometries } = deps;
  const shadows = !!opts.shadows;
  const { deckY, endZ, shoreZ } = plan;
  const group = new THREE.Group();
  group.position.set(plan.site.x, 0, plan.site.z);
  group.rotation.y = plan.theta;

  // ---------- materials ----------
  const M = {
    wall: new THREE.MeshStandardMaterial({ map: tex.clap, vertexColors: true, roughness: 0.85, envMapIntensity: 0.5 }),
    roof: new THREE.MeshStandardMaterial({ map: tex.roofTile, vertexColors: true, roughness: 0.8, envMapIntensity: 0.5 }),
    wood: new THREE.MeshStandardMaterial({ map: tex.planks, vertexColors: true, roughness: 0.9, envMapIntensity: 0.4 }),
    plain: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, envMapIntensity: 0.5 }),
    stone: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, envMapIntensity: 0.3 }),
    glass: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x9bbbd4, roughness: 0.06, metalness: 0.35, envMapIntensity: 1.4 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    clear: new THREE.MeshStandardMaterial({ vertexColors: true, color: 0xb9d7ea, transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.2, depthWrite: false, envMapIntensity: 1.4 }),
  };

  // ---------- batching helpers ----------
  const lists = new Map();
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
  const add = (key, geo, t = {}, color = 0xffffff) => {
    const g = geo.clone();
    _e.set(t.rx || 0, t.ry || 0, t.rz || 0);
    _m.compose(_p.set(t.x || 0, t.y || 0, t.z || 0), _q.setFromEuler(_e), _s);
    g.applyMatrix4(_m);
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (!lists.has(key)) lists.set(key, []);
    lists.get(key).push(g);
  };
  const box = (w, h, d, uvs = 2.4) => {
    const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, (uv.getX(i) * dims[f][0]) / uvs, (uv.getY(i) * dims[f][1]) / uvs); }
    return g;
  };
  const cyl = (rt, rb, h, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);
  const tri = (a, b, c) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([a[2] / 2.4, a[1] / 2.4, b[2] / 2.4, b[1] / 2.4, c[2] / 2.4, c[1] / 2.4], 2));
    g.setIndex([0, 1, 2]);
    g.computeVertexNormals();
    return g;
  };
  // gable roof: ridge along x. Origin at the centre of the eave line.
  const roofGeo = (w, d, rh, overX = 0.35, overZ = 0.55) => {
    const W = w / 2 + overX, D = d / 2 + overZ, pos = [], uv = [], idx = [];
    const slopeLen = Math.hypot(D, rh);
    const quad = (pts, uvs) => { const b = pos.length / 3; pts.forEach((p) => pos.push(...p)); uvs.forEach((u) => uv.push(...u)); idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    quad([[-W, 0, D], [W, 0, D], [W, rh, 0], [-W, rh, 0]], [[0, 0], [(2 * W) / 2, 0], [(2 * W) / 2, slopeLen / 2], [0, slopeLen / 2]]);
    quad([[W, 0, -D], [-W, 0, -D], [-W, rh, 0], [W, rh, 0]], [[0, 0], [(2 * W) / 2, 0], [(2 * W) / 2, slopeLen / 2], [0, slopeLen / 2]]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };

  // ---------- houses ----------
  const signs = [];
  // the parts of a hollow building that are drawn the same way as before: awning, chimney and sign
  const addAwningEtc = (b, x, z, fz, y0, w, d, h, rh) => {
    if (b.awning) {
      const n = Math.max(4, Math.round((w - 1.5) / 0.9)), ws = (w - 1.5) / n;
      for (let i = 0; i < n; i++) add('plain', box(ws, 0.07, 1.8), { x: x - (w - 1.5) / 2 + ws * (i + 0.5), y: y0 + 3.0, z: fz + 0.9, rx: 0.28 }, b.awning[i % 2]);
    }
    if (b.chimney) add('stone', box(0.9, 2, 0.9, 1.5), { x: x + w / 4, y: y0 + h + rh * 0.55, z: z - d / 4 }, 0x9c5b45);
    signs.push({ b, x, y: y0 + 3.4, z: fz + 0.09 });
  };
  const addHouse = (b) => {
    const y0 = deckY, { x, z, w, d, h } = b, fz = z + d / 2;
    add('stone', box(w + 0.5, 2.2, d + 0.5, 2), { x, y: y0 - 1.13, z }, 0xb9b3a6);
    if (b.id === 'hotel') {
      const rhh = b.rh || 3;
      add('roof', roofGeo(w, d, rhh), { x, y: y0 + h - 0.1, z }, b.roof);
      for (const sx of [-1, 1]) {
        const px = x + sx * (w / 2), top = y0 + h - 0.1 + rhh;
        const pts = sx > 0 ? [[px, y0 + h, z + d / 2], [px, y0 + h, z - d / 2], [px, top, z]] : [[px, y0 + h, z - d / 2], [px, y0 + h, z + d / 2], [px, top, z]];
        add('wall', tri(...pts), {}, b.wall);
      }
      add('plain', box(w + 0.14, 0.22, d + 0.14), { x, y: y0 + h - 0.11, z }, 0xf5f1e8);
      signs.push({ b, x, y: y0 + 3.75, z: fz + 0.09 });
      return;
    }
    const hollow = ['rentals', 'cafe', 'games', 'shop'].includes(b.id);   // these have real interiors (walls come from the plan)
    if (!hollow) {
      add('wall', box(w, h, d, 2.4), { x, y: y0 + h / 2, z }, b.wall);
      add('plain', box(w + 0.14, 0.35, d + 0.14), { x, y: y0 + 0.175, z }, 0xf5f1e8);          // base trim
    } else {
      for (const sz of [-1, 1]) add('plain', box(w + 0.14, 0.35, 0.14), { x, y: y0 + 0.175, z: z + sz * (d / 2 + 0.05) }, 0xf5f1e8);
      for (const sx of [-1, 1]) add('plain', box(0.14, 0.35, d + 0.14), { x: x + sx * (w / 2 + 0.05), y: y0 + 0.175, z }, 0xf5f1e8);
    }
    add('plain', box(w + 0.14, 0.22, d + 0.14), { x, y: y0 + h - 0.11, z }, 0xf5f1e8);         // eave trim
    const rh = 0.28 * d + 0.3;
    add('roof', roofGeo(w, d, rh), { x, y: y0 + h - 0.1, z }, b.roof);
    // gable end walls
    for (const sx of [-1, 1]) {
      const px = x + sx * (w / 2), top = y0 + h - 0.1 + rh;
      const pts = sx > 0 ? [[px, y0 + h, z + d / 2], [px, y0 + h, z - d / 2], [px, top, z]] : [[px, y0 + h, z - d / 2], [px, y0 + h, z + d / 2], [px, top, z]];
      add('wall', tri(...pts), {}, b.wall);
    }
    if (hollow) { addAwningEtc(b, x, z, fz, y0, w, d, h, rh); return; }
    // door
    const dw = b.neon ? 2.6 : 1.2;
    add('plain', box(dw + 0.35, 2.5, 0.1), { x, y: y0 + 1.25, z: fz + 0.02 }, 0xf5f1e8);
    add('wood', box(dw, 2.3, 0.14, 1.5), { x, y: y0 + 1.15, z: fz + 0.06 }, 0x5a3a24);
    if (b.neon) { add('glass', box(0.95, 1.6, 0.05), { x: x - 0.7, y: y0 + 1.25, z: fz + 0.14 }); add('glass', box(0.95, 1.6, 0.05), { x: x + 0.7, y: y0 + 1.25, z: fz + 0.14 }); }
    add('plain', box(0.08, 0.08, 0.1), { x: x + dw / 2 - 0.2, y: y0 + 1.1, z: fz + 0.2 }, 0xd9b44a);   // handle
    // windows
    const window_ = (wx, wy) => {
      add('plain', box(1.5, 1.5, 0.12), { x: wx, y: wy, z: fz + 0.03 }, 0xf5f1e8);
      add('glass', box(1.2, 1.2, 0.06), { x: wx, y: wy, z: fz + 0.09 });
      add('plain', box(1.2, 0.05, 0.08), { x: wx, y: wy, z: fz + 0.13 }, 0xf5f1e8);
      add('plain', box(0.05, 1.2, 0.08), { x: wx, y: wy, z: fz + 0.13 }, 0xf5f1e8);
      add('plain', box(1.75, 0.1, 0.3), { x: wx, y: wy - 0.8, z: fz + 0.13 }, 0xf5f1e8);
    };
    const offs = [];
    for (let o = dw / 2 + 1.7; o < w / 2 - 0.8; o += 2.7) offs.push(o, -o);
    const rows = b.floors === 2 ? [y0 + 1.7, y0 + 5.1] : [y0 + 1.7];
    rows.forEach((wy, ri) => offs.forEach((o) => window_(x + o, wy)));
    if (b.floors === 2) { window_(x, y0 + 5.1); window_(x - 1.9, y0 + 5.1); window_(x + 1.9, y0 + 5.1); }
    // side windows
    for (const sx of [-1, 1]) { add('plain', box(0.12, 1.5, 1.5), { x: x + sx * (w / 2 + 0.03), y: y0 + 1.7, z }, 0xf5f1e8); add('glass', box(0.06, 1.2, 1.2), { x: x + sx * (w / 2 + 0.09), y: y0 + 1.7, z }); }
    // awning
    if (b.awning) {
      const n = Math.max(4, Math.round((w - 1.5) / 0.9)), ws = (w - 1.5) / n;
      for (let i = 0; i < n; i++) add('plain', box(ws, 0.07, 1.8), { x: x - (w - 1.5) / 2 + ws * (i + 0.5), y: y0 + 3.0, z: fz + 0.9, rx: 0.28 }, b.awning[i % 2]);
    }
    // hotel balcony
    if (b.floors === 2) {
      add('wood', box(w - 1.5, 0.16, 1.3, 3), { x, y: y0 + 3.7, z: fz + 0.65 }, 0xb08a5a);
      add('plain', box(w - 1.5, 0.07, 0.07), { x, y: y0 + 4.65, z: fz + 1.28 }, 0xf5f1e8);
      add('plain', box(w - 1.5, 0.07, 0.07), { x, y: y0 + 4.15, z: fz + 1.28 }, 0xf5f1e8);
      for (let i = 0; i <= 8; i++) add('plain', box(0.07, 0.95, 0.07), { x: x - (w - 1.5) / 2 + ((w - 1.5) / 8) * i, y: y0 + 4.2, z: fz + 1.28 }, 0xf5f1e8);
    }
    if (b.chimney) add('stone', box(0.9, 2, 0.9, 1.5), { x: x + w / 4, y: y0 + h + rh * 0.55, z: z - d / 4 }, 0x9c5b45);
    signs.push({ b, x, y: y0 + (b.floors === 2 ? 3.25 : 3.4), z: fz + 0.09 });
  };
  plan.buildings.forEach(addHouse);

  // ---------- promenade + pier ----------
  const P = plan.promenade;
  add('wood', box(P.hw * 2, 0.18, P.z1 - P.z0, 3), { x: 0, y: deckY - 0.09, z: (P.z0 + P.z1) / 2 }, 0xb8935f);
  add('stone', box(P.hw * 2 - 0.4, 2.2, P.z1 - P.z0 - 0.4, 3), { x: 0, y: deckY - 1.28, z: (P.z0 + P.z1) / 2 }, 0x8e8678);
  const pz0 = plan.pier.z0, len = endZ - pz0;
  add('wood', box(4, 0.18, len, 3), { x: 0, y: deckY - 0.09, z: pz0 + len / 2 }, 0xb08a5a);
  add('wood', box(10, 0.18, 8, 3), { x: 0, y: deckY - 0.09, z: endZ - 4 }, 0xb8935f);
  for (let lz = pz0 + 2; lz <= endZ; lz += 4) {
    for (const sx of [-1.85, 1.85]) {
      const bottom = plan.gh(sx, lz) - 0.6;
      add('wood', cyl(0.14, 0.16, deckY - 0.2 - bottom, 8), { x: sx, y: (deckY - 0.2 + bottom) / 2, z: lz }, 0x6e5238);
    }
    add('wood', box(4.2, 0.14, 0.22, 1), { x: 0, y: deckY - 0.26, z: lz }, 0x6e5238);
  }
  for (const sx of [-4.9, 4.9]) for (const lz of [endZ - 7.5, endZ - 0.5]) {
    const bottom = plan.gh(sx, lz) - 0.6;
    add('wood', cyl(0.15, 0.17, deckY - 0.2 - bottom, 8), { x: sx, y: (deckY - 0.2 + bottom) / 2, z: lz }, 0x6e5238);
  }
  // rails
  const rail = (x, z, lx, lz) => { add('plain', box(lx, 0.07, lz), { x, y: deckY + 1.0, z }, 0xf3efe6); add('plain', box(lx, 0.06, lz), { x, y: deckY + 0.5, z }, 0xf3efe6); };
  const railLen = endZ - 8 - pz0;
  for (const sx of [-1.95, 1.95]) {
    rail(sx, pz0 + railLen / 2, 0.07, railLen);
    for (let lz = pz0; lz <= endZ - 8 + 0.01; lz += 4) add('plain', box(0.1, 1.05, 0.1), { x: sx, y: deckY + 0.52, z: lz }, 0xf3efe6);
  }
  for (const sx of [-4.95, 4.95]) { rail(sx, endZ - 4, 0.07, 8); for (const lz of [endZ - 8, endZ - 4, endZ]) add('plain', box(0.1, 1.05, 0.1), { x: sx, y: deckY + 0.52, z: lz }, 0xf3efe6); }
  rail(0, endZ, 10, 0.07);
  for (const lx of [-4.95, -2.5, 0, 2.5, 4.95]) add('plain', box(0.1, 1.05, 0.1), { x: lx, y: deckY + 0.52, z: endZ }, 0xf3efe6);
  // crates
  plan.crates.forEach((c) => add('wood', box(c.s, c.s, c.s, 1.2), { x: c.x, y: c.y + c.s / 2, z: c.z, ry: c.x }, 0xa07848));

  // ---------- street furniture ----------
  plan.benches.forEach((b) => {
    add('wood', box(1.7, 0.07, 0.5, 3), { x: b.x, y: b.y + 0.45, z: b.z }, 0xa07848);
    add('wood', box(1.7, 0.45, 0.06, 3), { x: b.x, y: b.y + 0.72, z: b.z - 0.24, rx: -0.12 }, 0x9a7040);
    for (const sx of [-0.72, 0.72]) add('plain', box(0.07, 0.45, 0.45), { x: b.x + sx, y: b.y + 0.225, z: b.z }, 0x2d3436);
  });
  plan.lamps.forEach((l) => {
    add('plain', cyl(0.05, 0.07, 3.4, 8), { x: l.x, y: l.y + 1.7, z: l.z }, 0x2d3436);
    add('plain', cyl(0.3, 0.12, 0.18, 10), { x: l.x, y: l.y + 3.55, z: l.z }, 0x2d3436);
    add('glow', new THREE.SphereGeometry(0.2, 10, 8), { x: l.x, y: l.y + 3.35, z: l.z }, 0xffe7a3);
  });
  plan.umbrellas.forEach((u) => {
    add('plain', cyl(0.04, 0.04, 2.4, 6), { x: u.x, y: u.y + 1.2, z: u.z }, 0xdddddd);
    add('plain', new THREE.ConeGeometry(1.55, 0.6, 12), { x: u.x, y: u.y + 2.55, z: u.z }, u.color);
    for (const sx of [-1, 1]) {
      add('plain', box(0.6, 0.08, 1.4), { x: u.x + sx * 1.1, y: u.y + 0.3, z: u.z + 1.5 }, 0xf6efe0);
      add('plain', box(0.6, 0.06, 0.7), { x: u.x + sx * 1.1, y: u.y + 0.55, z: u.z + 0.95, rx: -0.9 }, 0xf6efe0);
      for (const lz of [0.9, 2.1]) add('plain', box(0.5, 0.25, 0.05), { x: u.x + sx * 1.1, y: u.y + 0.15, z: u.z + lz }, 0x8a6f4d);
    }
  });
  // Ludo table (pedestal + stools); the board top is its own mesh
  const L = plan.ludo, seatCols = [0xe63946, 0x2a9d4a, 0xf4c20d, 0x1d6fd8];
  add('plain', cyl(0.2, 0.3, 0.75, 12), { x: L.x, y: L.y + 0.375, z: L.z }, 0x5a3a24);
  add('plain', cyl(0.7, 0.8, 0.1, 16), { x: L.x, y: L.y + 0.05, z: L.z }, 0x5a3a24);
  [[0, -1.95], [1.95, 0], [0, 1.95], [-1.95, 0]].forEach(([dx, dz], i) => add('plain', cyl(0.3, 0.26, 0.45, 12), { x: L.x + dx, y: L.y + 0.225, z: L.z + dz }, seatCols[i]));

  // ---------- hotel interior ----------
  const H = plan.hotel;
  for (const p of H.parts) add(p.mat, box(p.w, p.h, p.d, p.mat === 'wall' ? 2.4 : p.mat === 'wood' ? 3 : 1), { x: p.lx, y: p.y, z: p.lz }, p.color);
  for (const l of H.lamps) add('glow', box(0.5, 0.04, 0.5, 1), { x: l.lx, y: l.y, z: l.lz }, 0xfff3c4);
  const X = plan.extra;
  for (const p of X.parts) add(p.mat, box(p.w, p.h, p.d, p.mat === 'wall' ? 2.4 : p.mat === 'wood' ? 3 : 1), { x: p.lx, y: p.y, z: p.lz }, p.color);
  for (const l of X.lamps) add('glow', box(0.5, 0.04, 0.5, 1), { x: l.lx, y: l.y, z: l.lz }, 0xfff3c4);

  // ---------- merge everything into few meshes ----------
  for (const [key, list] of lists) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), M[key]);
    mesh.castShadow = mesh.receiveShadow = shadows;
    group.add(mesh);
  }

  // ---------- signs ----------
  signs.forEach((s) => {
    const neon = !!s.b.neon;
    const t = tex.signs && tex.signs[s.b.id];
    const mat = new THREE.MeshBasicMaterial({ map: t, toneMapped: false, transparent: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(neon ? 4.6 : 3.4, neon ? 1.44 : 1.06), mat);
    m.position.set(s.x, s.y + 0.1, s.z + 0.02);
    group.add(m);
  });

  // ---------- Ludo board top ----------
  {
    const side = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ map: tex.ludo, roughness: 0.55, envMapIntensity: 0.4 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 2.3), [side, side, top, side, side, side]);
    m.position.set(L.x, L.y + 0.8, L.z);
    m.castShadow = m.receiveShadow = shadows;
    group.add(m);
  }

  // ---------- lighthouse ----------
  {
    const lh = plan.lighthouse, bt = lh.baseTop, g = new THREE.Group();
    g.position.set(lh.x, 0, lh.z);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8d8579, roughness: 1 });
    const parts = [
      [new THREE.CylinderGeometry(3.3, 3.9, bt + 7, 14), stone, (bt - 7) / 2],
      [new THREE.CylinderGeometry(1.35, 1.9, 13, 20), new THREE.MeshStandardMaterial({ map: tex.lighthouse, roughness: 0.7 }), bt + 6.5],
      [new THREE.CylinderGeometry(2.15, 2.15, 0.3, 20), new THREE.MeshStandardMaterial({ color: 0x2d3436 }), bt + 13.15],
      [new THREE.CylinderGeometry(0.95, 0.95, 1.8, 16), new THREE.MeshStandardMaterial({ color: 0xffefb0, emissive: 0xffd37a, emissiveIntensity: 1.4, roughness: 0.2 }), bt + 14.2],
      [new THREE.ConeGeometry(1.35, 1.2, 16), new THREE.MeshStandardMaterial({ color: 0xc8372d, roughness: 0.6 }), bt + 15.7],
    ];
    parts.forEach(([geo, mat, y]) => { const m = new THREE.Mesh(geo, mat); m.position.y = y; m.castShadow = m.receiveShadow = shadows; g.add(m); });
    group.add(g);
  }

  // ---------- boats (animated) ----------
  const boats = [];
  const hullMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, side: THREE.DoubleSide, envMapIntensity: 0.8 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x9a7448, roughness: 0.8 });
  const makeBoat = (kind) => {
    const g = new THREE.Group(), sail = kind === 'sail';
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), hullMat(sail ? 0xf4f1ea : 0xd63031));
    hull.scale.set(sail ? 1.15 : 0.85, sail ? 0.75 : 0.5, sail ? 3.4 : 2.1);
    const deck = new THREE.Mesh(new THREE.CircleGeometry(1, 20).rotateX(-Math.PI / 2), woodMat);
    deck.scale.set(sail ? 1.1 : 0.8, 1, sail ? 3.3 : 2.0); deck.position.y = -0.05;
    const stripe = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 28).rotateX(Math.PI / 2), hullMat(sail ? 0x1d6fd8 : 0xf4f1ea));
    stripe.scale.set(sail ? 1.15 : 0.85, 1, sail ? 3.4 : 2.1); stripe.position.y = -0.1;
    g.add(hull, deck, stripe);
    if (sail) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 6.2, 8), woodMat); mast.position.set(0, 3, 0.5);
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6).rotateX(Math.PI / 2), woodMat); boom.position.set(0, 0.9, -0.8);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.0, 0.45, 0, 5.8, 0.45, 0, 1.0, -2.1], 3));
      sg.setIndex([0, 1, 2]); sg.computeVertexNormals();
      const sailM = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ color: 0xfaf6ea, side: THREE.DoubleSide, roughness: 0.9 }));
      g.add(mast, boom, sailM);
    } else {
      for (const sz of [-0.5, 0.5]) { const seat = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 0.25), woodMat); seat.position.set(0, 0.12, sz); g.add(seat); }
    }
    g.traverse((o) => { if (o.isMesh) o.castShadow = shadows; });
    return g;
  };
  plan.boats.forEach((b) => {
    const g = makeBoat(b.kind);
    g.position.set(b.x, 0.5, b.z); g.rotation.y = b.rot;
    const w = plan.toW(b.x, b.z);
    boats.push({ obj: g, wx: w.x, wz: w.z, phase: b.phase });
    group.add(g);
  });

  // ---------- hotel signs + animated doors ----------
  [...H.signs, ...X.signs].forEach((s) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: tex.signs && tex.signs[s.name], toneMapped: false }));
    m.position.set(s.lx, s.y, s.lz + 0.03); group.add(m);
  });
  // Ludo and chess table tops inside the games hall
  X.tops.forEach((tp) => {
    const side = new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.8 });
    const top = new THREE.MeshStandardMaterial({ map: tp.kind === 'chess' ? tex.chess : tex.ludo, roughness: 0.55, envMapIntensity: 0.4 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(tp.size, 0.08, tp.size), [side, side, top, side, side, side]);
    m.position.set(tp.lx, tp.y - 0.04, tp.lz); m.castShadow = m.receiveShadow = shadows; group.add(m);
  });
  const doorGroups = new Map();
  const brass = new THREE.MeshStandardMaterial({ color: 0xd9b44a, metalness: 0.8, roughness: 0.3 });
  const doorGlass = new THREE.MeshStandardMaterial({ color: 0xbfe0f0, transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0.2, depthWrite: false });
  for (const d of [...H.doors, ...X.doors]) {
    const g = new THREE.Group(); g.position.set(d.lx, d.y, d.lz);
    const alongX = Math.abs(d.dx) > 0.5, geo = new THREE.BoxGeometry(alongX ? d.len : 0.05, d.h, alongX ? 0.05 : d.len).translate(d.dx * d.len / 2, d.h / 2, d.dz * d.len / 2);
    const m = new THREE.Mesh(geo, d.glass ? doorGlass : new THREE.MeshStandardMaterial({ color: d.color, map: tex.planks, roughness: 0.75 }));
    m.castShadow = shadows; g.add(m);
    const hnd = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.14 : 0.1, 0.05, alongX ? 0.1 : 0.14), brass);
    hnd.position.set(d.dx * (d.len - 0.14), 1.0, d.dz * (d.len - 0.14)); g.add(hnd);
    if (d.glass) { const bar = new THREE.Mesh(new THREE.BoxGeometry(alongX ? d.len : 0.07, 0.06, alongX ? 0.07 : d.len).translate(d.dx * d.len / 2, 1.0, d.dz * d.len / 2), new THREE.MeshStandardMaterial({ color: 0xf5f1e8 })); g.add(bar); }
    group.add(g);
    let o = doorGroups.get(d.group);
    if (!o) doorGroups.set(d.group, (o = { leaves: [], cur: 0, target: 0 }));
    o.leaves.push({ g, open: d.open });
  }
  let lastT = 0;
  const setDoor = (id, open, instant = false) => { const o = doorGroups.get(id); if (!o) return; o.target = open ? 1 : 0; if (instant) { o.cur = o.target; o.leaves.forEach((l) => (l.g.rotation.y = o.cur * l.open)); } };

  const update = (t, wave) => {
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    for (const o of doorGroups.values()) {
      if (o.cur === o.target) continue;
      o.cur += (o.target - o.cur) * (1 - Math.exp(-dt * 7)); if (Math.abs(o.target - o.cur) < 0.005) o.cur = o.target;
      for (const l of o.leaves) l.g.rotation.y = o.cur * l.open;
    }
    for (const b of boats) {
      const y = wave(b.wx, b.wz, t);
      b.obj.position.y = 0.42 + y * 0.92;
      b.obj.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.035;
      b.obj.rotation.x = Math.sin(t * 1.15 + b.phase) * 0.02;
    }
  };
  return { group, update, setDoor };
}