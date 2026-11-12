// Realistic vegetation: leaf-card canopies, barked trunks with branches, curved palms, conifers, shrubs, ferns and grass.
// Everything is GPU-instanced per map tile, swaying in the wind (see windMaterial).
import { HALF } from './island.js';

const TILE = 256;
const rng = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const rotAxis = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2]; return [v[0] * c + kv[0] * s + k[0] * d * (1 - c), v[1] * c + kv[1] * s + k[1] * d * (1 - c), v[2] * c + kv[2] * s + k[2] * d * (1 - c)]; };

export function createVegetation(deps) {
  const { THREE, mergeGeometries, tex, scene, data, ground, lite, shadows, addCollider, wind } = deps;

  // ---------- geometry building blocks ----------
  function cardGeo(cards) {
    const pos = [], nor = [], uv = [], idx = [];
    for (const c of cards) {
      const b = pos.length / 3, n = c.n || norm(cross(c.r, c.u)), hw = c.w / 2, hh = c.h / 2;
      for (const [a, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        pos.push(c.p[0] + c.r[0] * hw * a + c.u[0] * hh * v, c.p[1] + c.r[1] * hw * a + c.u[1] * hh * v, c.p[2] + c.r[2] * hw * a + c.u[2] * hh * v);
        nor.push(n[0], n[1], n[2]);
        uv.push((a < 0) !== !!c.flip ? 0 : 1, v < 0 ? 0 : 1);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  function tubeGeo(profile, radial, bend, uRep = 2, vRep = 3) {
    const pos = [], nor = [], uv = [], idx = [];
    profile.forEach(([y, r], i) => {
      const cx = bend ? bend(y) : 0;
      for (let k = 0; k <= radial; k++) {
        const a = (k / radial) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(cx + c * r, y, s * r); nor.push(c, 0.15, s); uv.push((k / radial) * uRep, y * vRep);
      }
      if (i > 0) for (let k = 0; k < radial; k++) { const a = (i - 1) * (radial + 1) + k, b = a + radial + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }
  const withUV = (g) => g; // (cylinders already have uv)
  const mergeAll = (list) => mergeGeometries(list.map((g) => (g.index ? g : g.toNonIndexed())), false);

  // broadleaf canopy: lobes of outward-facing leaf cards with soft radial normals
  function canopy(seed, lobes, perLobe, flat = 1) {
    const r = rng(seed), cards = [];
    lobes.forEach(([lx, ly, lz, lr]) => {
      for (let i = 0; i < perLobe; i++) {
        const d = norm([r() * 2 - 1, (r() * 2 - 1) * 0.85, r() * 2 - 1]), rad = lr * (0.5 + 0.5 * r());
        const p = [lx + d[0] * rad, ly + d[1] * rad * 0.85, lz + d[2] * rad];
        const n = norm([p[0], (p[1] + 0.1) / flat + 0.35, p[2]]);
        let right = cross([0, 1, 0], n); if (Math.hypot(...right) < 0.2) right = [1, 0, 0];
        right = rotAxis(norm(right), n, r() * 6.283);
        const u = norm(cross(n, right)), s = (0.85 + 0.55 * r()) * (0.6 + 0.4 * lr);
        cards.push({ p, r: right, u, w: s, h: s, n, flip: r() < 0.5 });
      }
    });
    return cardGeo(cards);
  }
  const PL = lite ? 7 : 13;
  const roundGeo = canopy(7, [[0, 0, 0, 1], [0.62, -0.12, 0.15, 0.68], [-0.58, -0.08, -0.28, 0.72], [0.08, 0.4, -0.38, 0.6], [-0.12, 0.2, 0.55, 0.62], [0.3, 0.28, 0.45, 0.55]], PL);
  const tallGeo = canopy(19, [[0, 0.2, 0, 0.8], [0.85, 0, 0.1, 0.62], [-0.8, 0, -0.15, 0.66], [0.15, 0, 0.85, 0.6], [-0.2, 0, -0.85, 0.62], [0.55, 0.1, -0.6, 0.55], [-0.55, 0.05, 0.6, 0.55]], PL, 0.5);

  function pineCrown() {
    const r = rng(29), cards = [], N = lite ? 7 : 9, per = lite ? 5 : 7;
    for (let i = 0; i < N; i++) {
      const y = 0.15 + (i / (N - 1)) * 3.9, R = 1.55 * Math.pow(1 - i / (N + 0.5), 0.9) + 0.18;
      for (let k = 0; k < per; k++) {
        const th = (k / per) * 6.283 + i * 0.7 + r() * 0.3, d = [Math.cos(th), 0, Math.sin(th)], phi = 0.32 + r() * 0.2;
        const rr = norm([d[0] * Math.cos(phi), -Math.sin(phi), d[2] * Math.cos(phi)]), u = [-Math.sin(th), 0, Math.cos(th)], w = R * 1.25 + 0.3;
        cards.push({ p: [rr[0] * w * 0.5, y + rr[1] * w * 0.5, rr[2] * w * 0.5], r: rr, u, w, h: w * 0.5, n: norm([d[0] * 0.55, 0.85, d[2] * 0.55]), flip: r() < 0.5 });
      }
    }
    cards.push({ p: [0, 4.15, 0], r: [1, 0, 0], u: [0, 1, 0], w: 0.7, h: 1.2, n: [0, 1, 0] }, { p: [0, 4.15, 0], r: [0, 0, 1], u: [0, 1, 0], w: 0.7, h: 1.2, n: [0, 1, 0] });
    return cardGeo(cards);
  }
  const pineGeo = pineCrown();

  function palmCrown() {
    const r = rng(41), list = [], N = lite ? 9 : 13, S = 7;
    for (let f = 0; f < N; f++) {
      const L = 3.2 + r() * 0.8, pitch = f % 3 === 0 ? 0.55 : -0.05 + r() * 0.25, pos = [], uv = [], idx = [];
      for (let s = 0; s <= S; s++) {
        const u = s / S, w = (0.62 * Math.sin(Math.PI * (0.1 + 0.9 * u)) * (1 - u * 0.45) + 0.05), x = u * L, y = L * (pitch * u - 0.66 * u * u);
        for (const side of [-1, 1]) { pos.push(x, y + 0.14 * w, side * w); uv.push(u, side < 0 ? 1 : 0); }
        if (s < S) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
      g.rotateZ((r() - 0.5) * 0.2); g.rotateY((f / N) * Math.PI * 2 + r() * 0.25);
      g.computeVertexNormals();
      list.push(g);
    }
    return mergeGeometries(list);
  }
  const palmGeo = palmCrown();
  const palmBend = (y) => 0.16 * y * y;
  const palmTrunkGeo = tubeGeo([[0, 0.26], [0.03, 0.2], [0.1, 0.165], [0.3, 0.15], [0.6, 0.135], [0.85, 0.12], [1, 0.11]], 8, palmBend, 1, 4);

  const roundTrunkGeo = (() => {
    const t = tubeGeo([[0, 0.3], [0.03, 0.2], [0.08, 0.15], [0.2, 0.125], [0.45, 0.108], [0.7, 0.095], [0.9, 0.08], [1, 0.07]], 9, null, 2, 2.5);
    const parts = [t];
    [[0.62, 0, 0.75], [0.74, 2.1, 0.8], [0.84, 4.2, 0.7]].forEach(([y, yaw, tilt]) => { const b = new THREE.CylinderGeometry(0.022, 0.042, 0.4, 5).translate(0, 0.2, 0); b.rotateZ(-tilt); b.rotateY(yaw); b.translate(0, y, 0); parts.push(b); });
    return mergeGeometries(parts.map((g) => g.index ? g : g.toNonIndexed()), false);
  })();
  const tallTrunkGeo = tubeGeo([[0, 0.36], [0.02, 0.24], [0.06, 0.14], [0.15, 0.098], [0.5, 0.082], [0.85, 0.07], [1, 0.062]], 9, null, 2, 3);
  const pineTrunkGeo = tubeGeo([[0, 0.17], [0.05, 0.12], [0.3, 0.092], [0.7, 0.06], [1, 0.03]], 7, null, 2, 3);

  const bushGeo = (() => {
    const r = rng(53), cards = [];
    for (let k = 0; k < (lite ? 5 : 8); k++) {
      const th = (k / 8) * 6.283 + r() * 0.5, d = [Math.cos(th), 0, Math.sin(th)], n = norm([d[0] * 0.55, 0.85, d[2] * 0.55]);
      const right = [-d[2], 0, d[0]], u = norm([d[0] * 0.45, 0.9, d[2] * 0.45]);
      cards.push({ p: [d[0] * 0.28, 0.45, d[2] * 0.28], r: right, u, w: 1.15, h: 1.1, n, flip: r() < 0.5 });
    }
    cards.push({ p: [0, 0.55, 0], r: [1, 0, 0], u: [0, 0.2, 1], w: 1.1, h: 1.1, n: [0, 1, 0] });
    return cardGeo(cards);
  })();
  const fernGeo = (() => {
    const r = rng(61), cards = [], N = lite ? 5 : 7;
    for (let k = 0; k < N; k++) {
      const th = (k / N) * 6.283 + r() * 0.4, d = [Math.cos(th), 0, Math.sin(th)], right = [-d[2], 0, d[0]];
      const u1 = norm([d[0] * 0.72, 0.7, d[2] * 0.72]), u2 = norm([d[0] * 0.9, 0.0, d[2] * 0.9]);
      cards.push({ p: [d[0] * 0.28, 0.27, d[2] * 0.28], r: right, u: u1, w: 0.46, h: 0.62, n: [0, 1, 0] }, { p: [d[0] * 0.66, 0.5, d[2] * 0.66], r: right, u: u2, w: 0.4, h: 0.55, n: [0, 1, 0] });
    }
    return cardGeo(cards);
  })();
  const grassGeo = (() => {
    const cards = [];
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; cards.push({ p: [0, 0.3, 0], r: [Math.cos(a), 0, Math.sin(a)], u: [0, 1, 0], w: 0.8, h: 0.62, n: [0, 1, 0] }); }
    return cardGeo(cards);
  })();
  const rockGeo = (() => {
    const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
    const h = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + 5.5) * 43758.5453; return s - Math.floor(s); };
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + (h(Math.round(x * 50) / 50, Math.round(y * 50) / 50, Math.round(z * 50) / 50) - 0.5) * 0.45; p.setXYZ(i, x * k, y * k, z * k); }
    g.computeVertexNormals();
    return g;
  })();

  // ---------- materials (with wind) ----------
  const nfb = THREE.ShaderChunk.normal_fragment_begin.replace('gl_FrontFacing ? 1.0 : - 1.0', '1.0');
  function windMaterial(mat, o) {
    mat.customProgramCacheKey = () => 'veg' + (o.cards ? 'c' : 't');
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = wind.uTime; shader.uniforms.uWindV = wind.uWindV;
      shader.uniforms.uK = { value: o.k }; shader.uniforms.uOriginH = { value: o.originH }; shader.uniforms.uFlutter = { value: o.flutter }; shader.uniforms.uFade = { value: new THREE.Vector2(o.fade0, o.fade1) };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec4 uWindV;\nuniform float uK;\nuniform float uOriginH;\nuniform float uFlutter;\nuniform vec2 uFade;')
        .replace('#include <project_vertex>', `
          vec4 mvPosition = vec4( transformed, 1.0 );
          vec3 org = vec3(0.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            org = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #endif
          float hgt = max(0.0, uOriginH + (mvPosition.y - org.y));
          float gw = 0.5 + 0.5 * sin(uTime * 1.6 + org.x * 0.045 + org.z * 0.035);
          float ws = uWindV.z * (0.4 + 0.6 * mix(1.0, gw, uWindV.w));
          float osc = 0.75 + 0.25 * sin(uTime * 2.3 + org.x * 0.21 + org.z * 0.17);
          vec2 wd = uWindV.xy;
          vec2 off = wd * (ws * osc * uK * hgt * hgt);
          off += vec2(-wd.y, wd.x) * (sin(uTime * 1.3 + org.x * 0.11) * 0.25 * ws * uK * hgt * hgt);
          float fl = uFlutter * ws * sin(uTime * 7.0 + mvPosition.x * 2.3 + mvPosition.z * 1.9 + mvPosition.y * 3.1);
          mvPosition.xz += off + vec2(fl, fl * 0.7);
          mvPosition.y += fl * 0.5 - length(off) * 0.12;
          float fade = 1.0 - smoothstep(uFade.x, uFade.y, distance(org, cameraPosition));
          mvPosition.xyz = org + (mvPosition.xyz - org) * fade;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;
        `);
      if (o.cards) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', nfb);
    };
    return mat;
  }
  const std = (extra) => new THREE.MeshStandardMaterial({ roughness: 0.85, envMapIntensity: 0.5, ...extra });
  const far = [1e9, 2e9];
  const M = {
    bark: windMaterial(std({ map: tex.bark, roughness: 1, envMapIntensity: 0.35 }), { k: 0.0065, originH: 0, flutter: 0, fade0: far[0], fade1: far[1] }),
    palmBark: windMaterial(std({ map: tex.palmBark, roughness: 1, envMapIntensity: 0.35 }), { k: 0.0085, originH: 0, flutter: 0, fade0: far[0], fade1: far[1] }),
    leafRound: windMaterial(std({ map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide }), { cards: true, k: 0.0065, originH: 5.5, flutter: 0.04, fade0: far[0], fade1: far[1] }),
    leafTall: windMaterial(std({ map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide, color: 0xdde8d0 }), { cards: true, k: 0.0065, originH: 10, flutter: 0.04, fade0: far[0], fade1: far[1] }),
    pine: windMaterial(std({ map: tex.needles, alphaTest: 0.45, side: THREE.DoubleSide }), { cards: true, k: 0.0065, originH: 3.5, flutter: 0.03, fade0: far[0], fade1: far[1] }),
    frond: windMaterial(std({ map: tex.frond, alphaTest: 0.4, side: THREE.DoubleSide }), { cards: true, k: 0.0085, originH: 8, flutter: 0.16, fade0: far[0], fade1: far[1] }),
    bush: windMaterial(std({ map: tex.leaves, alphaTest: 0.45, side: THREE.DoubleSide }), { cards: true, k: 0.1, originH: 0, flutter: 0.03, fade0: lite ? 90 : 150, fade1: lite ? 140 : 230 }),
    fern: windMaterial(std({ map: tex.fern, alphaTest: 0.4, side: THREE.DoubleSide }), { cards: true, k: 0.16, originH: 0, flutter: 0.03, fade0: lite ? 55 : 85, fade1: lite ? 90 : 140 }),
    grass: windMaterial(std({ map: tex.grassBlades, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9 }), { cards: true, k: 0.24, originH: 0, flutter: 0.02, fade0: lite ? 38 : 60, fade1: lite ? 62 : 100 }),
    rock: std({ map: tex.rock, color: 0xbbbbbb, roughness: 1, envMapIntensity: 0.4 }),
  };

  // ---------- group instances by tile ----------
  const groups = new Map();
  const push = (kind, t) => {
    const k = Math.floor((t.x + HALF) / TILE) * 100 + Math.floor((t.z + HALF) / TILE);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { palms: [], round: [], tall: [], pines: [], rocks: [], shrubs: [], ferns: [], grass: [] }));
    g[kind].push(t);
  };
  data.palms.forEach((t) => push('palms', t));
  data.broad.forEach((t) => push(t.k < 0.2 ? 'tall' : 'round', t));
  data.pines.forEach((t) => push('pines', t));
  data.rocks.forEach((t) => push('rocks', t));
  const thin = (arr) => (lite ? arr.filter((_, i) => i % 2 === 0) : arr);
  thin(ground.shrubs).forEach((t) => push('shrubs', t));
  thin(ground.ferns).forEach((t) => push('ferns', t));
  (lite ? ground.grass.filter((_, i) => i % 3 === 0) : ground.grass).forEach((t) => push('grass', t));

  const list = []; // { mesh, range }
  const d = new THREE.Object3D(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  const make = (geo, mat, count, range, cast = shadows) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = cast; m.receiveShadow = shadows; m.frustumCulled = true;
    return { m, range };
  };
  const done = (o) => { const { m } = o; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); scene.add(m); list.push(o); };
  const TREE_R = lite ? 330 : 700;

  for (const g of groups.values()) {
    const addTrees = (arr, spec) => {
      if (!arr.length) return;
      const trunks = make(spec.trunkGeo, spec.trunkMat, arr.length, TREE_R), crowns = make(spec.crownGeo, spec.crownMat, arr.length, TREE_R);
      arr.forEach((t, i) => {
        const H = spec.height(t), w = spec.width(t);
        d.position.set(t.x, t.y - 0.12, t.z); d.rotation.set((t.k - 0.5) * spec.lean, t.a, Math.sin(t.a * 7) * 0.5 * spec.lean); d.scale.set(w, H, w); d.updateMatrix();
        trunks.m.setMatrixAt(i, d.matrix);
        const top = new THREE.Vector3(spec.topX || 0, 1, 0).applyMatrix4(d.matrix);
        addCollider(t.x, t.z, spec.collide(t, w), t.y - 3, t.y + H + 1);
        spec.place(d, t, top, H);
        d.updateMatrix(); crowns.m.setMatrixAt(i, d.matrix);
        if (spec.tint) { spec.tint(c, t); crowns.m.setColorAt(i, c); }
        c.setHSL(0.08 + t.k * 0.04, 0.12 + t.s * 0.05, 0.38 + t.k * 0.2); trunks.m.setColorAt(i, c);
      });
      done(trunks); done(crowns);
    };
    addTrees(g.round, {
      trunkGeo: roundTrunkGeo, trunkMat: M.bark, crownGeo: roundGeo, crownMat: M.leafRound, lean: 0.12, height: (t) => 3.6 + t.s * 2.6, width: (t) => 1.2 + t.s * 0.9, collide: (t, w) => 0.18 * w + 0.15,
      place: (o, t, top) => { const r = 2.0 + t.s * 1.7; o.position.set(top.x, top.y + r * 0.45, top.z); o.rotation.set(0, t.a, 0); o.scale.set(r, r * 0.85, r); },
      tint: (col, t) => col.setHSL(0.24 + t.k * 0.1, 0.32 + t.s * 0.1, 0.66 + t.s * 0.2),
    });
    addTrees(g.tall, {
      trunkGeo: tallTrunkGeo, trunkMat: M.bark, crownGeo: tallGeo, crownMat: M.leafTall, lean: 0.06, height: (t) => 9 + t.s * 5.5, width: (t) => 1.6 + t.s * 1.0, collide: (t, w) => 0.2 * w + 0.2,
      place: (o, t, top) => { const r = 3.4 + t.s * 2.2; o.position.set(top.x, top.y + 0.9, top.z); o.rotation.set(0, t.a, 0); o.scale.set(r, r * 0.62, r); },
      tint: (col, t) => col.setHSL(0.26 + t.k * 0.08, 0.28 + t.s * 0.1, 0.58 + t.s * 0.16),
    });
    addTrees(g.pines, {
      trunkGeo: pineTrunkGeo, trunkMat: M.bark, crownGeo: pineGeo, crownMat: M.pine, lean: 0.04, height: (t) => 6 + t.s * 4, width: (t) => 1.3 + t.s * 0.5, collide: (t, w) => 0.13 * w + 0.12,
      place: (o, t, top, H) => { const s = (0.8 + t.s * 0.45) * (H / 8); o.position.set(t.x, t.y + H * 0.22, t.z); o.rotation.set(0, t.a, 0); o.scale.setScalar(s * 1.5); },
      tint: (col, t) => col.setHSL(0.36 + t.k * 0.05, 0.3, 0.55 + t.k * 0.18),
    });
    addTrees(g.palms, {
      trunkGeo: palmTrunkGeo, trunkMat: M.palmBark, crownGeo: palmGeo, crownMat: M.frond, lean: 0.3, topX: 0.16, height: (t) => 6 + t.s * 3.4, width: (t) => 1.0 + t.s * 0.35, collide: (t, w) => 0.16 * w + 0.12,
      place: (o, t, top) => { o.position.copy(top); o.rotation.set(0, t.a * 1.7, 0); o.scale.setScalar(0.85 + t.s * 0.4); },
      tint: (col, t) => col.setHSL(0.27 + t.k * 0.05, 0.45, 0.78 + t.k * 0.15),
    });
    if (g.rocks.length) {
      const o = make(rockGeo, M.rock, g.rocks.length, TREE_R);
      g.rocks.forEach((t, i) => {
        d.position.set(t.x, t.y + t.s * 0.25, t.z); d.rotation.set(t.k * 3, t.a, t.k * 2); d.scale.set(t.s, t.s * (0.55 + t.k * 0.3), t.s * (0.8 + t.k * 0.4)); d.updateMatrix();
        o.m.setMatrixAt(i, d.matrix); addCollider(t.x, t.z, t.s * 0.8, t.y - 3, t.y + t.s * 1.1);
      });
      done(o);
    }
    const cover = (arr, geo, mat, range, scale, tint) => {
      if (!arr.length) return;
      const o = make(geo, mat, arr.length, range, false);
      arr.forEach((t, i) => { d.position.set(t.x, t.y - 0.03, t.z); d.rotation.set(0, t.a, 0); d.scale.setScalar(scale(t)); d.updateMatrix(); o.m.setMatrixAt(i, d.matrix); tint(c, t); o.m.setColorAt(i, c); });
      done(o);
    };
    cover(g.shrubs, bushGeo, M.bush, lite ? 160 : 260, (t) => 0.9 + t.s * 0.8, (col, t) => col.setHSL(0.22 + t.k * 0.12, 0.3 + t.k * 0.15, 0.55 + t.s * 0.2));
    cover(g.ferns, fernGeo, M.fern, lite ? 100 : 160, (t) => 0.8 + t.s * 0.6, (col, t) => col.setHSL(0.27 + t.k * 0.06, 0.4, 0.62 + t.s * 0.2));
    cover(g.grass, grassGeo, M.grass, lite ? 70 : 110, (t) => 0.7 + t.s * 0.7, (col, t) => col.setHSL(0.2 + t.k * 0.1, 0.35 + t.k * 0.2, 0.62 + t.s * 0.25));
  }
  const stats = { instances: 0 };
  list.forEach(({ m }) => { stats.instances += m.count; });
  return {
    stats, meshes: list.length,
    update(px, pz) {
      for (const o of list) { const bs = o.m.boundingSphere, dd = Math.hypot(bs.center.x - px, bs.center.z - pz) - bs.radius; o.m.visible = dd < o.range; }
    },
  };
}