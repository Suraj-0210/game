// Night-time scenery for the Old Town: stars, moon, glowing lamps, a small pool of real lights that follows the player,
// and the pillar of light that marks the current objective.
import { smoothstep } from './bbsr_time.js';

function radialTexture(THREE, stops, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), r = size / 2, grd = g.createRadialGradient(r, r, 0, r, r, r);
  for (const [t, col] of stops) grd.addColorStop(t, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---- stars and moon ----
export function createNightSky(THREE) {
  const group = new THREE.Group();
  const N = 1100, pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  let seed = 4242; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < N; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u), R = 3400;
    pos[i * 3] = R * s * Math.cos(a); pos[i * 3 + 1] = Math.abs(R * u) * 0.98 + 40; pos[i * 3 + 2] = R * s * Math.sin(a);
    const b = 0.45 + rnd() * 0.55, warm = rnd();
    col[i * 3] = b * (0.85 + 0.15 * warm); col[i * 3 + 1] = b * 0.92; col[i * 3 + 2] = b * (1 - 0.15 * warm);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.PointsMaterial({ size: 1.7, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false });
  const stars = new THREE.Points(geo, starMat); stars.frustumCulled = false; stars.renderOrder = 1;
  const moonTex = radialTexture(THREE, [[0, 'rgba(255,255,245,1)'], [0.2, 'rgba(250,250,235,1)'], [0.23, 'rgba(235,240,255,.55)'], [0.5, 'rgba(160,185,255,.16)'], [1, 'rgba(120,150,255,0)']], 128);
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }));
  moon.scale.setScalar(700); moon.renderOrder = 2;
  group.add(stars, moon);
  return {
    group,
    update(camPos, ts, cover) {
      group.position.copy(camPos);
      const a = Math.max(0, ts.night * (1 - Math.min(1, cover * 1.1)));
      starMat.opacity = a;
      moon.material.opacity = Math.min(1, ts.night * 1.1) * (1 - 0.85 * Math.min(1, cover));
      moon.position.set(ts.moonDir[0] * 3000, ts.moonDir[1] * 3000, ts.moonDir[2] * 3000);
      group.visible = a > 0.01 || moon.material.opacity > 0.01;
    },
  };
}

// ---- light sources of the town ----
// kind: lamp (street lamp), bulb (stall), flood (temple), shop (chai adda)
export function collectLights(plan) {
  const L = [];
  for (const l of plan.lamps) L.push({ x: l.x, y: 4.7, z: l.z, kind: 'lamp' });
  for (const s of plan.stalls) L.push({ x: s.x, y: 2.3, z: s.z, kind: 'bulb' });
  if (plan.chai) for (const dx of [-7, 0, 7]) L.push({ x: plan.chai.x + dx, y: 3.0, z: plan.chai.z - 0.5, kind: 'bulb' });
  for (const t of plan.temples) {
    if (t.kind === 'shrine') { L.push({ x: t.x, y: 1.2, z: t.z, kind: 'diya' }); continue; }
    const w = (t.w || 10) * 0.75;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) L.push({ x: t.x + sx * w, y: 1.5, z: t.z + sz * w, kind: 'flood', big: t.kind === 'major' });
    if (t.kind === 'major' || t.kind === 'minor') L.push({ x: t.x, y: t.h * 0.58, z: t.z, kind: 'tower', big: t.kind === 'major' });
  }
  return L;
}

const KIND = {
  lamp: { color: 0xffd9a0, size: 5.5, light: 70, range: 24 },
  bulb: { color: 0xffc27a, size: 3.2, light: 28, range: 12 },
  flood: { color: 0xff9a45, size: 11, light: 150, range: 38 },
  tower: { color: 0xffa860, size: 26, light: 0, range: 1 },
  diya: { color: 0xff8f2e, size: 2.2, light: 6, range: 5 },
};

export function createLightGlow(THREE, lights, { lite }) {
  const group = new THREE.Group();
  const tex = radialTexture(THREE, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,240,210,.85)'], [0.45, 'rgba(255,200,130,.26)'], [1, 'rgba(255,170,90,0)']]);
  const mats = [];
  for (const kind of Object.keys(KIND)) {
    const list = lights.filter((l) => l.kind === kind); if (!list.length) continue;
    const k = KIND[kind], pos = new Float32Array(list.length * 3);
    list.forEach((l, i) => { pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: tex, color: k.color, size: kind === 'tower' ? k.size : k.size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const p = new THREE.Points(g, m); p.frustumCulled = false; group.add(p); mats.push([kind, m]);
  }
  // a few real lights that hop to whatever is nearest to the player
  const N = lite ? 3 : 6, pool = [];
  for (let i = 0; i < N; i++) { const pl = new THREE.PointLight(0xffc88a, 0, 20, 2); pl.position.set(0, -50, 0); group.add(pl); pool.push(pl); }
  const lit = lights.filter((l) => KIND[l.kind].light > 0);
  let flick = 0;
  return {
    group, pool,
    update(camPos, lampOn, cover, t, refresh) {
      for (const [kind, m] of mats) m.opacity = lampOn * (kind === 'tower' ? 0.55 : 0.95) * (1 - 0.3 * Math.min(1, cover));
      group.visible = lampOn > 0.01;
      if (!group.visible) { for (const pl of pool) pl.intensity = 0; return; }
      if (refresh) {
        const cand = [];
        for (const l of lit) { const d = (l.x - camPos.x) ** 2 + (l.z - camPos.z) ** 2; if (d < 2800) cand.push([d, l]); }
        cand.sort((a, b) => a[0] - b[0]);
        pool.forEach((pl, i) => {
          const c = cand[i];
          if (!c) { pl.userData.base = 0; return; }
          const k = KIND[c[1].kind];
          pl.position.set(c[1].x, c[1].y + (c[1].kind === 'lamp' ? -0.3 : 0.6), c[1].z); pl.color.setHex(k.color); pl.distance = k.range; pl.userData.base = k.light;
        });
      }
      flick = 0.94 + 0.06 * Math.sin(t * 9.3) * Math.sin(t * 3.7);
      for (const pl of pool) pl.intensity = (pl.userData.base || 0) * lampOn * flick;
    },
  };
}

// ---- objective beacon: a pillar of light and a ring on the ground ----
export function createBeacon(THREE) {
  const group = new THREE.Group();
  const mk = (color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.9, 90, 14, 1, true).translate(0, 45, 0), mk(0xffd24a));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.6, 2.1, 40).rotateX(-Math.PI / 2), mk(0xffd24a)); ring.position.y = 0.08;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 32).rotateX(-Math.PI / 2), mk(0xffd24a)); disc.position.y = 0.07; disc.material.opacity = 0.14;
  group.add(pillar, ring, disc); group.visible = false;
  return {
    group,
    set(obj) {
      if (!obj || obj.x === undefined) { group.visible = false; return; }
      group.visible = true; group.position.set(obj.x, 0, obj.z);
      const c = obj.kind === 'job' ? 0x55e0ff : 0xffd24a;
      pillar.material.color.setHex(c); ring.material.color.setHex(c); disc.material.color.setHex(c);
    },
    update(t, dayLevel) {
      const p = 0.5 + 0.5 * Math.sin(t * 2.4);
      pillar.material.opacity = (0.16 + 0.18 * p) * (0.55 + 0.45 * (1 - dayLevel * 0.5));
      ring.scale.setScalar(1 + 0.25 * p); ring.material.opacity = 0.55 - 0.3 * p;
    },
  };
}
export { smoothstep };
