import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { io } from '/socket.io/socket.io.esm.min.js';
import { Terrain, scatter, splatAt, findTownSite, SIZE, HALF } from './island.js';
import { planTown, deckHeightAt, FLATTEN } from './town.js';
import { buildTown } from './townmesh.js';
import { makeTextures, signTexture, ludoBoardTexture, lighthouseTexture } from './textures.js';
import { createHUD } from './hud.js';
import { createAvatar, animateAvatar, sanitizeAvatar, DEFAULT_AVATAR, MAX_EMOTE } from './avatar.js';
import { createCustomizer } from './customize.js';

const $ = (id) => document.getElementById(id);
const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');
// quality: phones get the lighter settings automatically; add ?lite to the URL on any device to force them
const LITE = isTouch || new URLSearchParams(location.search).has('lite');

const STEP = LITE ? 4 : 2;           // terrain grid spacing in metres
const TILE = 128;                       // terrain tile size in metres
const FOG_COLOR = 0xdde8f1, FOG_NEAR = 60, FOG_FAR = 950;
const UNDER_COLOR = 0x0a4f73;
const DMAX = 20;                        // water depth range encoded in the depth texture (m)
const WATER_SIZE = 2400, WATER_SEG = 180, WATER_CELL = WATER_SIZE / WATER_SEG;

// ======================= renderer / scene =======================
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LITE ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.78;
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 4000);
camera.rotation.order = 'YXZ';
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Sky, sun, and sky-based reflections / ambient light
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(56), THREE.MathUtils.degToRad(140));
function makeSky() {
  const s = new Sky();
  s.scale.setScalar(10000);
  const u = s.material.uniforms;
  u.turbidity.value = 4; u.rayleigh.value = 1.6; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDir);
  return s;
}
const sky = makeSky();
scene.add(sky);
{
  const envScene = new THREE.Scene();
  envScene.add(makeSky());
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene).texture;
  pmrem.dispose();
}
const sun = new THREE.DirectionalLight(0xfff0d6, 3.0);
scene.add(sun, sun.target);
if (!LITE) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.05;
}

const tex = makeTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy()));

// ======================= world state =======================
let terrain = null, plan = null, town = null;
const circles = new Map(), boxes = new Map(); // spatial hashes of solid things (8 m cells), each with a vertical extent
const CKEY = (cx, cz) => cx * 4096 + cz;
const BIG = 1e9;
function addCollider(x, z, r, y0 = -BIG, y1 = BIG) {
  const k = CKEY(Math.floor(x / 8), Math.floor(z / 8));
  let a = circles.get(k);
  if (!a) circles.set(k, (a = []));
  a.push(x, z, r, y0, y1);
}
function addBoxCollider(b) {
  const c = Math.cos(b.theta), s = Math.sin(b.theta);
  const rx = Math.abs(c) * b.hw + Math.abs(s) * b.hd, rz = Math.abs(s) * b.hw + Math.abs(c) * b.hd;
  const e = { x: b.x, z: b.z, hw: b.hw, hd: b.hd, c, s, y0: b.y0 === undefined ? -BIG : b.y0, y1: b.y1 === undefined ? BIG : b.y1 };
  for (let cz = Math.floor((b.z - rz) / 8); cz <= Math.floor((b.z + rz) / 8); cz++)
    for (let cx = Math.floor((b.x - rx) / 8); cx <= Math.floor((b.x + rx) / 8); cx++) {
      const k = CKEY(cx, cz);
      let a = boxes.get(k);
      if (!a) boxes.set(k, (a = []));
      a.push(e);
    }
}
// Is a body (feet at py, 1.8 m tall, horizontal radius pr) touching anything solid at x,z?
function blocked(x, z, pr, py) {
  const cx = Math.floor(x / 8), cz = Math.floor(z / 8), top = py + 1.8;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const k = CKEY(cx + dx, cz + dz), a = circles.get(k);
    if (a) for (let i = 0; i < a.length; i += 5) {
      if (py !== undefined && (top < a[i + 3] || py > a[i + 4])) continue;
      const rr = a[i + 2] + pr, ex = x - a[i], ez = z - a[i + 1];
      if (ex * ex + ez * ez < rr * rr) return true;
    }
    const bx = boxes.get(k);
    if (bx) for (const b of bx) {
      if (py !== undefined && (top < b.y0 || py > b.y1)) continue;
      const ddx = x - b.x, ddz = z - b.z, lx = ddx * b.c - ddz * b.s, lz = ddx * b.s + ddz * b.c;
      const ex = Math.max(Math.abs(lx) - b.hw, 0), ez = Math.max(Math.abs(lz) - b.hd, 0);
      if (ex * ex + ez * ez < pr * pr) return true;
    }
  }
  return false;
}
// Walking surface: natural terrain, or a town deck if one is higher
function ground(x, z) {
  let g = terrain.height(x, z);
  if (plan && Math.abs(x - plan.site.x) < 95 && Math.abs(z - plan.site.z) < 95) { const d = deckHeightAt(plan, x, z); if (d > g) g = d; }
  return g;
}
// Same formula as the water shader, so boats float on the visible waves
const waveHeight = (x, z, t) => Math.sin(x * 0.045 + t * 0.9) * 0.35 + Math.sin(z * 0.06 - t * 0.7 + x * 0.02) * 0.28 + Math.sin((x + z) * 0.11 + t * 1.4) * 0.12;

// ======================= terrain meshes =======================
let terrainMat = null, water = null, waterUniforms = null, farOcean = null;

function buildTerrain() {
  terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, envMapIntensity: 0.8 });
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.tSand = { value: tex.sand };
    shader.uniforms.tGrass = { value: tex.grass };
    shader.uniforms.tRock = { value: tex.rock };
    shader.uniforms.tDirt = { value: tex.dirt };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vTW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvTW = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tSand;\nuniform sampler2D tGrass;\nuniform sampler2D tRock;\nuniform sampler2D tDirt;\nvarying vec4 vSplat;\nvarying vec2 vTW;')
      .replace('#include <map_fragment>', `
        vec2 p = vTW;
        vec3 sandC  = mix(texture2D(tSand,  p * 0.33).rgb, texture2D(tSand,  p * 0.047).rgb, 0.45);
        vec3 grassC = mix(texture2D(tGrass, p * 0.28).rgb, texture2D(tGrass, p * 0.041).rgb, 0.5);
        vec3 rockC  = mix(texture2D(tRock,  p * 0.16).rgb, texture2D(tRock,  p * 0.022).rgb, 0.5);
        vec3 dirtC  = mix(texture2D(tDirt,  p * 0.30).rgb, texture2D(tDirt,  p * 0.044).rgb, 0.5);
        vec3 albedo = sandC * vSplat.x + grassC * vSplat.y + rockC * vSplat.z + dirtC * vSplat.w;
        float macro = texture2D(tGrass, p * 0.0043).r;
        albedo *= 0.8 + 0.45 * macro;
        diffuseColor.rgb *= albedo;
      `);
  };

  const n = terrain.n, cells = TILE / STEP, vn = cells + 1, tiles = SIZE / TILE;
  const idxArr = new Uint32Array(cells * cells * 6);
  let q = 0;
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * vn + i, b = a + 1, c = a + vn, d = c + 1;
    idxArr.set([a, c, b, b, c, d], q); q += 6;
  }
  for (let tz = 0; tz < tiles; tz++) {
    for (let tx = 0; tx < tiles; tx++) {
      const pos = new Float32Array(vn * vn * 3), nor = new Float32Array(vn * vn * 3), spl = new Float32Array(vn * vn * 4);
      for (let j = 0; j < vn; j++) for (let i = 0; i < vn; i++) {
        const gi = tx * cells + i, gj = tz * cells + j, gk = gj * n + gi, k = j * vn + i;
        const x = -HALF + gi * STEP, z = -HALF + gj * STEP, h = terrain.h[gk];
        pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
        nor[k * 3] = terrain.nrm[gk * 3]; nor[k * 3 + 1] = terrain.nrm[gk * 3 + 1]; nor[k * 3 + 2] = terrain.nrm[gk * 3 + 2];
        const w = splatAt(x, z, h, terrain.nrm[gk * 3 + 1]);
        spl[k * 4] = w[0]; spl[k * 4 + 1] = w[1]; spl[k * 4 + 2] = w[2]; spl[k * 4 + 3] = w[3];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('splat', new THREE.BufferAttribute(spl, 4));
      g.setIndex(new THREE.BufferAttribute(idxArr, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, terrainMat);
      m.castShadow = m.receiveShadow = !LITE;
      scene.add(m);
    }
  }
}

function buildWater() {
  // depth texture: how deep the sea is at each point (0 = shore) so the water can fade from turquoise to deep blue
  const n = terrain.n, dd = new Uint8Array(n * n);
  for (let k = 0; k < dd.length; k++) dd[k] = Math.round(Math.min(1, Math.max(0, -terrain.h[k] / DMAX)) * 255);
  const depthTex = new THREE.DataTexture(dd, n, n, THREE.RedFormat, THREE.UnsignedByteType);
  depthTex.minFilter = depthTex.magFilter = THREE.LinearFilter;
  depthTex.wrapS = depthTex.wrapT = THREE.ClampToEdgeWrapping;
  depthTex.needsUpdate = true;

  waterUniforms = { uTime: { value: 0 }, uSize: { value: SIZE }, tDepth: { value: depthTex }, tNormal: { value: tex.waterNormal }, tNoise: { value: tex.noise } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a6a8a, roughness: 0.07, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.85 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWXZ = wp.xz;
        transformed.y += sin(wp.x * 0.045 + uTime * 0.9) * 0.35 + sin(wp.z * 0.06 - uTime * 0.7 + wp.x * 0.02) * 0.28 + sin((wp.x + wp.z) * 0.11 + uTime * 1.4) * 0.12;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSize;\nuniform sampler2D tDepth;\nuniform sampler2D tNormal;\nuniform sampler2D tNoise;\nvarying vec2 vWXZ;')
      .replace('#include <map_fragment>', `
        float depth = texture2D(tDepth, (vWXZ + uSize * 0.5) / uSize).r;
        float dk = smoothstep(0.0, 0.5, depth);
        vec3 wcol = mix(vec3(0.10, 0.62, 0.66), vec3(0.01, 0.12, 0.28), dk);
        float fn = texture2D(tNoise, vWXZ * 0.08 + vec2(uTime * 0.03, 0.0)).r;
        float foam = (1.0 - smoothstep(0.0, 0.035 + 0.03 * sin(uTime * 1.5 + vWXZ.x * 0.3), depth)) * smoothstep(0.42, 0.62, fn) * 0.85;
        wcol = mix(wcol, vec3(0.95), foam);
        diffuseColor.rgb = wcol;
        diffuseColor.a = max(mix(0.6, 0.97, dk), foam);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 n1 = texture2D(tNormal, vWXZ * 0.045 + vec2(uTime * 0.020, uTime * 0.012)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, vWXZ * 0.110 + vec2(-uTime * 0.016, uTime * 0.025)).xyz * 2.0 - 1.0;
        vec3 nw = normalize(vec3((n1.x + n2.x) * 0.6, 1.0, (n1.y + n2.y) * 0.6));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
      `);
  };
  water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, WATER_SEG, WATER_SEG).rotateX(-Math.PI / 2), mat);
  water.renderOrder = 2;
  water.frustumCulled = false;
  scene.add(water);
  farOcean = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b4467, roughness: 0.12, metalness: 0, envMapIntensity: 0.6 })
  );
  farOcean.position.y = -0.8;
  farOcean.frustumCulled = false;
  scene.add(farOcean);
}

// ======================= vegetation =======================
function lumpy(geo, amount, seed) {
  const p = geo.attributes.position;
  const h = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453; return s - Math.floor(s); };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + (h(Math.round(x * 50) / 50, Math.round(y * 50) / 50, Math.round(z * 50) / 50) - 0.5) * amount;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}
function broadleafGeometry() {
  const blobs = [[0, 0, 0, 1], [0.7, -0.25, 0.2, 0.75], [-0.6, -0.15, -0.4, 0.8], [0.1, 0.5, -0.3, 0.7]];
  return mergeGeometries(blobs.map(([x, y, z, r], i) => {
    const g = lumpy(new THREE.IcosahedronGeometry(r, LITE ? 0 : 1), LITE ? 0.3 : 0.35, i * 3.1);
    g.translate(x, y, z);
    return g;
  }));
}
function pineGeometry() {
  const parts = [[2.3, 2.8, 0.0], [1.8, 2.6, 1.7], [1.25, 2.4, 3.3]].map(([r, h, y]) => new THREE.ConeGeometry(r, h, 9).translate(0, y + h / 2, 0));
  return mergeGeometries(parts);
}
function palmCrownGeometry() {
  const fronds = [], N = 9, S = 6, L = 3.2;
  for (let f = 0; f < N; f++) {
    const pos = [], uv = [], idx = [];
    for (let s = 0; s <= S; s++) {
      const u = s / S, w = 0.75 * Math.sin(Math.PI * (0.12 + 0.88 * u)) * (1 - u * 0.5) + 0.04;
      const x = u * L, y = L * (0.32 * u - 0.62 * u * u);
      for (const side of [-1, 1]) { pos.push(x, y + 0.12 * w, side * w); uv.push(u, side < 0 ? 1 : 0); }
      if (s < S) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.rotateZ((f % 3 - 1) * 0.18);
    g.rotateY((f / N) * Math.PI * 2 + (f % 2) * 0.2);
    g.computeVertexNormals();
    fronds.push(g);
  }
  return mergeGeometries(fronds);
}

const vegMeshes = [], VEG_RANGE = LITE ? 300 : 650;
function cullVegetation(px, pz) {
  for (const m of vegMeshes) {
    const c = m.boundingSphere.center;
    m.visible = Math.hypot(c.x - px, c.z - pz) - m.boundingSphere.radius < VEG_RANGE;
  }
}
function buildVegetation() {
  const sc = scatter(terrain, plan ? plan.exclusions : []);
  if (plan) sc.palms.push(...plan.palms);
  const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 1, 7).translate(0, 0.5, 0);
  const palmGeo = palmCrownGeometry(), broadGeo = broadleafGeometry(), pineGeo = pineGeometry();
  const rockGeo = lumpy(new THREE.IcosahedronGeometry(1, 1), 0.45, 5.5);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b513a, roughness: 1, envMapIntensity: 0.4 });
  const leafMat = new THREE.MeshStandardMaterial({ map: tex.leaf, roughness: 0.85, envMapIntensity: 0.5 });
  const pineMat = new THREE.MeshStandardMaterial({ map: tex.leaf, color: 0x7fa088, roughness: 0.9, envMapIntensity: 0.5 });
  const frondMat = new THREE.MeshStandardMaterial({ map: tex.frond, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.5 });
  const rockMat = new THREE.MeshStandardMaterial({ map: tex.rock, color: 0xbbbbbb, roughness: 1, envMapIntensity: 0.4 });

  // group everything by terrain tile so the renderer can skip tiles that are off-screen
  const groups = new Map();
  const push = (kind, t) => {
    const k = Math.floor((t.x + HALF) / TILE) * 100 + Math.floor((t.z + HALF) / TILE);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { palms: [], broad: [], pines: [], rocks: [] }));
    g[kind].push(t);
  };
  sc.palms.forEach((t) => push('palms', t));
  sc.broad.forEach((t) => push('broad', t));
  sc.pines.forEach((t) => push('pines', t));
  sc.rocks.forEach((t) => push('rocks', t));

  const d = new THREE.Object3D(), c = new THREE.Color();
  const make = (geo, mat, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.castShadow = m.receiveShadow = !LITE;
    return m;
  };
  const finish = (m) => {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    scene.add(m);
    vegMeshes.push(m);
  };

  for (const g of groups.values()) {
    const treeCount = g.palms.length + g.broad.length + g.pines.length;
    const trunks = treeCount ? make(trunkGeo, trunkMat, treeCount) : null;
    let ti = 0;
    const setTrunk = (t, height, width, lean) => {
      d.position.set(t.x, t.y - 0.15, t.z);
      d.rotation.set((t.k - 0.5) * lean, t.a, Math.sin(t.a * 7) * 0.5 * lean);
      d.scale.set(width, height, width);
      d.updateMatrix();
      trunks.setMatrixAt(ti++, d.matrix);
      addCollider(t.x, t.z, 0.3 * width / 1.4 + 0.15, t.y - 3, t.y + height + 1);
      return new THREE.Vector3(0, 1, 0).applyMatrix4(d.matrix);
    };
    if (g.palms.length) {
      const m = make(palmGeo, frondMat, g.palms.length);
      g.palms.forEach((t, i) => {
        const h = 6 + t.s * 3.2, top = setTrunk(t, h, 1.0 + t.s * 0.3, 0.35);
        d.position.copy(top); d.rotation.set(0, t.a * 1.7, 0); d.scale.setScalar(0.85 + t.s * 0.35); d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
      });
      finish(m);
    }
    if (g.broad.length) {
      const m = make(broadGeo, leafMat, g.broad.length);
      g.broad.forEach((t, i) => {
        const h = 3.2 + t.s * 2.2, top = setTrunk(t, h, 1.2 + t.s * 0.8, 0.12), r = 1.9 + t.s * 1.5;
        d.position.set(top.x, top.y + r * 0.55, top.z); d.rotation.set(0, t.a, 0); d.scale.set(r, r * 0.85, r); d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
        c.setHSL(0.22 + t.k * 0.1, 0.3, 0.7 + t.s * 0.2); m.setColorAt(i, c);
      });
      finish(m);
    }
    if (g.pines.length) {
      const m = make(pineGeo, pineMat, g.pines.length);
      g.pines.forEach((t, i) => {
        const h = 2.4 + t.s, s = 0.8 + t.s * 0.55;
        setTrunk(t, h, 1.3 + t.s * 0.4, 0.05);
        d.position.set(t.x, t.y + h * 0.55, t.z); d.rotation.set(0, t.a, 0); d.scale.setScalar(s); d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
        c.setHSL(0.36 + t.k * 0.05, 0.25, 0.55 + t.k * 0.2); m.setColorAt(i, c);
      });
      finish(m);
    }
    if (trunks) finish(trunks);
    if (g.rocks.length) {
      const m = make(rockGeo, rockMat, g.rocks.length);
      g.rocks.forEach((t, i) => {
        d.position.set(t.x, t.y + t.s * 0.25, t.z); d.rotation.set(t.k * 3, t.a, t.k * 2);
        d.scale.set(t.s, t.s * (0.55 + t.k * 0.3), t.s * (0.8 + t.k * 0.4)); d.updateMatrix();
        m.setMatrixAt(i, d.matrix);
        addCollider(t.x, t.z, t.s * 0.8, t.y - 3, t.y + t.s * 1.1);
      });
      finish(m);
    }
  }
}

// ======================= avatars =======================
function makeLabel(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px sans-serif';
  const w = Math.min(244, g.measureText(text).width + 24);
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.roundRect((256 - w) / 2, 8, w, 48, 12); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33, 232);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, fog: false, toneMapped: false }));
  sp.scale.set(2, 0.5, 1);
  sp.position.y = 2.15;
  sp.renderOrder = 10;
  return sp;
}
// Avatars come from avatar.js (body, face, hair, outfit, accessories, poses); here we only add the name tag.
function makeAvatar(cfg, name, label = true) {
  const av = createAvatar(THREE, cfg, { shadows: !LITE });
  if (label) { const l = makeLabel(name); l.position.y = 2.3; av.group.add(l); }
  return av;
}
function disposeAvatar(av) {
  scene.remove(av.group);
  av.group.traverse((o) => { if (o.isSprite) { o.material.map && o.material.map.dispose(); o.material.dispose(); } });
  av.dispose();
}
const AV_KEY = 'vw_avatar';
let hadSavedAvatar = false;
function loadCfg() {
  try { const raw = localStorage.getItem(AV_KEY); if (raw) { hadSavedAvatar = true; return sanitizeAvatar(JSON.parse(raw)); } } catch (e) { /* ignore */ }
  return sanitizeAvatar(DEFAULT_AVATAR);
}
let myCfg = loadCfg();

// ======================= player =======================
const player = { x: 0, y: 5, z: 0, vy: 0, yaw: 0, pitch: 0, onGround: false, fly: false, emote: 0, emoteUntil: 0, sit: null };
const keys = {};
const touch = { mx: 0, my: 0, jump: false, run: false };
let thirdPerson = false, selfAvatar = null, ready = false;
const PR = 0.35;

function spawn() {
  for (let tries = 0; tries < 40; tries++) {
    const p = plan.toW((Math.random() - 0.5) * 14, Math.min(plan.shoreZ - 6, 33) + (Math.random() - 0.5) * 4);
    if (blocked(p.x, p.z, PR + 0.3)) continue;
    player.x = p.x; player.z = p.z; player.y = ground(p.x, p.z); player.vy = 0;
    player.yaw = plan.theta; // face the town
    return;
  }
  const p = plan.toW(0, 30);
  player.x = p.x; player.z = p.z; player.y = ground(p.x, p.z); player.yaw = plan.theta;
}
function moveH(dx, dz) {
  const ox = player.x, oz = player.z, nx = ox + dx, nz = oz + dz;
  if (Math.hypot(nx, nz) > 470) return false;
  if (!player.fly) {
    const run = Math.hypot(dx, dz);
    if (player.onGround && run > 0) {
      const t0 = terrain.height(ox, oz), t1 = terrain.height(nx, nz);
      if (t1 - t0 > run * 1.15 + 0.02) return false;                       // too steep
      if (ground(nx, nz) - Math.max(ground(ox, oz), t1) > 0.5) return false; // too high a step
    }
  }
  // solid things block you (also while flying); if you are already inside one you may move out of it
  if (blocked(nx, nz, PR, player.y) && !blocked(ox, oz, PR, player.y)) return false;
  player.x = nx; player.z = nz;
  return true;
}
// Move the player to the nearest free spot (used when leaving fly mode above a building, or if stuck)
function pushOut() {
  const g = (x, z) => ground(x, z);
  if (!blocked(player.x, player.z, PR, g(player.x, player.z))) return;
  for (let r = 1; r <= 30; r += 1) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r, y = g(x, z);
    if (Math.hypot(x, z) < 470 && y > -0.8 && !blocked(x, z, PR + 0.1, y)) { player.x = x; player.z = z; player.y = y; player.vy = 0; return; }
  }
}
const EMOTE_TIME = { 1: 3200, 4: 3200, 5: 3500, 6: 3000, 7: 3600, 8: 4200 }; // the rest (dance, sit, sleep) last until you move
function setEmote(id, now = performance.now()) {
  if (id < 1 || id > MAX_EMOTE) return;
  if (player.sit && player.sit.bench && id !== 3) return;
  if (id === player.emote) { stopEmote(); return; }
  player.emote = id;
  player.emoteUntil = EMOTE_TIME[id] ? now + EMOTE_TIME[id] : 0;
  if (id === 3 || id === 9) player.sit = player.sit || { bench: false };
  else if (player.sit && !player.sit.bench) player.sit = null;
}
function stopEmote() {
  if (player.sit && player.sit.bench) {
    // step out in front of the bench
    const f = 1.15;
    player.x += -Math.sin(player.yaw) * f; player.z += -Math.cos(player.yaw) * f;
    player.y = ground(player.x, player.z);
  }
  player.sit = null; player.emote = 0; player.emoteUntil = 0;
}
function sitOn(it) {
  player.x = it.x; player.z = it.z; player.y = it.y; player.yaw = it.yaw; player.vy = 0; player.onGround = true;
  player.sit = { bench: true }; player.emote = 3; player.emoteUntil = 0;
}
function updatePlayer(dt, now) {
  let f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0) - touch.my;
  let s = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0) + touch.mx;
  const len = Math.hypot(f, s);
  const jump = keys.Space || touch.jump;
  if (player.emote && (len > 0.15 || jump)) stopEmote();
  if (EMOTE_TIME[player.emote] && now > player.emoteUntil) stopEmote();
  if (player.sit) { player.vy = 0; return; }
  if (len > 1) { f /= len; s /= len; }
  const g0 = ground(player.x, player.z);
  const swimming = !player.fly && g0 < -1.0;
  const run = keys.ShiftLeft || keys.ShiftRight || touch.run;
  let speed = player.fly ? 18 : swimming ? 2.6 : run ? 7.5 : 4.2;
  if (player.fly && run) speed = 45;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = (-sin * f + cos * s) * speed * dt, wz = (-cos * f - sin * s) * speed * dt;
  moveH(wx, 0);
  moveH(0, wz);

  const g = ground(player.x, player.z);
  if (player.fly) {
    const down = keys.ShiftLeft || keys.ShiftRight;
    player.vy = ((jump ? 1 : 0) - (down && !touch.run ? 1 : 0)) * 14;
    const ny = Math.max(player.y + player.vy * dt, g + 0.3);
    if (!blocked(player.x, player.z, PR, ny) || blocked(player.x, player.z, PR, player.y)) player.y = ny;
    player.onGround = false;
  } else if (swimming) {
    player.y += (-1.15 - player.y) * Math.min(1, dt * 5);
    player.vy = 0; player.onGround = false;
  } else {
    const was = player.onGround;
    if (jump && was) player.vy = 7.5;
    player.vy -= 24 * dt;
    player.y += player.vy * dt;
    if (player.y <= g || (was && player.vy <= 0 && player.y - g < 0.3)) {
      if (player.vy <= 0) { player.y = g; player.vy = 0; player.onGround = true; }
    } else player.onGround = false;
  }
}

// ======================= interactions =======================
let interactables = [], nearest = null;
const INTERACT_MSG = {
  ludo: 'Ludo table: multiplayer Ludo (server-side dice and rules) is the next feature.',
  fish: 'Fishing spot: fishing is coming soon.',
  shop: null,
};
function updateInteraction() {
  if (player.sit && player.sit.bench) { hud.setPrompt('Stand up'); nearest = null; return; }
  let best = null, bd = 1e9;
  for (const it of interactables) {
    const d = Math.hypot(it.x - player.x, it.z - player.z);
    if (d < it.radius && Math.abs(player.y - it.y) < 3 && d < bd) { best = it; bd = d; }
  }
  nearest = best;
  hud.setPrompt(best ? best.label : null, best && best.soon);
}
function interact() {
  if (player.sit && player.sit.bench) { stopEmote(); return; }
  if (!nearest) return;
  if (nearest.type === 'sit') sitOn(nearest);
  else hud.toast(INTERACT_MSG[nearest.type] || `${nearest.label}: coming soon`);
}

// ======================= other players =======================
const others = new Map();
function addOther(p) {
  if (others.has(p.id)) return;
  const av = makeAvatar(p.avatar || DEFAULT_AVATAR, p.name);
  av.group.position.set(p.x, p.y, p.z);
  av.group.rotation.y = p.ry || 0;
  av.group.visible = !!p.hasPos;
  scene.add(av.group);
  others.set(p.id, { ...av, name: p.name, tx: p.x, ty: p.y, tz: p.z, tr: p.ry || 0, em: p.em === 10 ? 3 : p.em || 0, bench: p.em === 10, seen: !!p.hasPos });
  hud.setOnline(others.size + 1);
}
function setOtherAvatar(id, cfg) {
  const o = others.get(id);
  if (!o) return;
  const av = makeAvatar(cfg, o.name);
  av.group.position.copy(o.group.position); av.group.rotation.copy(o.group.rotation); av.group.visible = o.group.visible;
  scene.add(av.group);
  disposeAvatar(o);
  others.set(id, { ...av, name: o.name, tx: o.tx, ty: o.ty, tz: o.tz, tr: o.tr, em: o.em, bench: o.bench, seen: o.seen });
}
function removeOther(id) {
  const o = others.get(id);
  if (!o) return;
  disposeAvatar(o);
  others.delete(id);
  hud.setOnline(others.size + 1);
}
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
function updateOthers(dt, t) {
  const k = 1 - Math.exp(-14 * dt);
  for (const o of others.values()) {
    const g = o.group, px = g.position.x, pz = g.position.z;
    g.position.x += (o.tx - g.position.x) * k;
    g.position.y += (o.ty - g.position.y) * k;
    g.position.z += (o.tz - g.position.z) * k;
    g.rotation.y = lerpAngle(g.rotation.y, o.tr, k);
    animateAvatar(o, { moved: Math.hypot(g.position.x - px, g.position.z - pz), dt, emote: o.em, t, swim: o.ty < -0.6, sitKind: o.bench ? 'bench' : 'ground' });
  }
}

// ======================= HUD + chat =======================
const overlay = $('overlay'), playBtn = $('play'), statusEl = $('status');
let socket = null, locked = false;
const hud = createHUD({
  isTouch,
  onEmote: (id) => { if (active()) setEmote(id); },
  onInteract: () => { if (active()) interact(); },
  onChatSubmit: (text, scope) => { if (socket) socket.emit('chat', { text, scope }); closeChat(); },
});
const active = () => ready && overlay.style.display === 'none' && !hud.isChatOpen() && !customizer.isOpen();
function rebuildSelf() {
  if (selfAvatar) disposeAvatar(selfAvatar);
  selfAvatar = makeAvatar(myCfg, name, false);
  scene.add(selfAvatar.group);
}
const customizer = createCustomizer({
  THREE, getCfg: () => myCfg,
  onSave: (cfg) => {
    myCfg = cfg;
    try { localStorage.setItem(AV_KEY, JSON.stringify(cfg)); hadSavedAvatar = true; } catch (e) { /* ignore */ }
    rebuildSelf();
    if (socket && socket.connected) socket.emit('avatar', cfg);
    hud.toast('Avatar saved');
  },
  onOpen: () => { for (const k in keys) keys[k] = false; document.exitPointerLock?.(); },
  onClose: () => { if (ready && overlay.style.display === 'none' && !isTouch) { try { renderer.domElement.requestPointerLock(); } catch (e) { /* ignore */ } } },
});
$('btnCustom').addEventListener('click', () => { if (ready || overlay.style.display !== 'none') customizer.open(); });
$('btnCustom').addEventListener('touchstart', (e) => { e.preventDefault(); customizer.open(); }, { passive: false });
$('playCustom').addEventListener('click', () => customizer.open());
function openChat() {
  for (const k in keys) keys[k] = false;
  hud.chat.open();
  document.exitPointerLock?.();
}
function closeChat() {
  hud.chat.close();
  if (!isTouch) { try { renderer.domElement.requestPointerLock(); } catch (e) { /* ignore */ } }
}
$('msg').addEventListener('keydown', (e) => { if (e.code === 'Escape') { $('msg').value = ''; closeChat(); } e.stopPropagation(); });
$('msg').addEventListener('keyup', (e) => e.stopPropagation());
$('btnChat').addEventListener('touchstart', (e) => { e.preventDefault(); hud.isChatOpen() ? closeChat() : openChat(); }, { passive: false });
$('chatHint').addEventListener('click', () => { if (ready) openChat(); });

// ======================= input =======================
const toggleFly = () => { if (player.sit) return; player.fly = !player.fly; player.vy = 0; if (!player.fly) pushOut(); };
const toggleView = () => { thirdPerson = !thirdPerson; };

playBtn.addEventListener('click', () => {
  if (!ready) return;
  overlay.style.display = 'none';
  if (!isTouch) renderer.domElement.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && !isTouch && ready && !hud.isChatOpen() && !hud.isBigMap() && !customizer.isOpen()) overlay.style.display = 'flex';
});
document.addEventListener('pointerlockerror', () => { if (ready && !hud.isChatOpen() && !customizer.isOpen()) overlay.style.display = 'flex'; });
addEventListener('keydown', (e) => {
  if (hud.isChatOpen() || !active()) return;
  keys[e.code] = true;
  if (e.code === 'Enter') { e.preventDefault(); openChat(); return; }
  if (e.code === 'KeyF') toggleFly();
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyM') hud.toggleMap();
  if (e.code === 'KeyC') customizer.open();
  if (e.code === 'Space') e.preventDefault();
  const m = /^Digit([1-9])$/.exec(e.code);
  if (m) setEmote(+m[1]);
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  player.yaw -= e.movementX * 0.0022;
  player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - e.movementY * 0.0022));
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

if (isTouch) {
  const pad = $('touchpad'), stick = $('stick'), knob = $('knob');
  let moveId = null, lookId = null, origin = { x: 0, y: 0 }, lastLook = { x: 0, y: 0 };
  pad.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && moveId === null) {
        moveId = t.identifier; origin = { x: t.clientX, y: t.clientY };
        stick.style.left = origin.x + 'px'; stick.style.top = origin.y + 'px'; stick.style.display = 'block';
        knob.style.transform = 'translate(0,0)';
      } else if (lookId === null) { lookId = t.identifier; lastLook = { x: t.clientX, y: t.clientY }; }
    }
  }, { passive: false });
  pad.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) {
        let dx = (t.clientX - origin.x) / 50, dy = (t.clientY - origin.y) / 50;
        const l = Math.hypot(dx, dy);
        if (l > 1) { dx /= l; dy /= l; }
        touch.mx = dx; touch.my = dy;
        knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
      } else if (t.identifier === lookId) {
        player.yaw -= (t.clientX - lastLook.x) * 0.006;
        player.pitch = Math.max(-1.5, Math.min(1.5, player.pitch - (t.clientY - lastLook.y) * 0.006));
        lastLook = { x: t.clientX, y: t.clientY };
      }
    }
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === moveId) { moveId = null; touch.mx = touch.my = 0; stick.style.display = 'none'; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  pad.addEventListener('touchend', end);
  pad.addEventListener('touchcancel', end);
  const hold = (id, on, off) => {
    const el = $(id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(); }, { passive: false });
    const up = (e) => { e.preventDefault(); off && off(); };
    el.addEventListener('touchend', up, { passive: false });
    el.addEventListener('touchcancel', up, { passive: false });
  };
  hold('btnJump', () => (touch.jump = true), () => (touch.jump = false));
  hold('btnFly', toggleFly);
  hold('btnView', toggleView);
  hold('btnRun', () => (touch.run = !touch.run));
}

// ======================= networking =======================
let spawned = false, name = 'Player', autoOpened = false;
function connect() {
  const saved = localStorage.getItem('vw_name');
  name = ((saved || prompt('Choose a player name', '') || '').trim().slice(0, 16)) || 'Player';
  try { localStorage.setItem('vw_name', name); } catch (e) { /* ignore */ }

  socket = io();
  socket.on('connect', () => { statusEl.textContent = 'Joining...'; socket.emit('join', { name, avatar: myCfg }); });
  socket.on('disconnect', () => {
    ready = false; playBtn.disabled = true;
    overlay.style.display = 'flex';
    statusEl.textContent = 'Disconnected. Reconnecting...';
    document.exitPointerLock?.();
  });
  socket.on('init', ({ players, selfId }) => {
    for (const id of [...others.keys()]) removeOther(id);
    if (!spawned) { spawn(); spawned = true; }
    rebuildSelf();
    for (const p of Object.values(players)) if (p.id !== selfId) addOther(p);
    ready = true;
    playBtn.disabled = false;
    statusEl.textContent = `Connected. ${others.size + 1} online.`;
    hud.setOnline(others.size + 1);
    sendPosition(performance.now(), true);
    if (!hadSavedAvatar && !autoOpened) { autoOpened = true; customizer.open(); }
  });
  socket.on('playerJoined', (p) => { addOther(p); hud.addChat(null, `${p.name} joined`); });
  socket.on('playerLeft', (id) => { const o = others.get(id); if (o) hud.addChat(null, `${o.name} left`); removeOther(id); });
  socket.on('playerMoved', ({ id, x, y, z, ry, em }) => {
    const o = others.get(id);
    if (!o) return;
    o.tx = x; o.ty = y; o.tz = z; o.tr = ry; o.em = em === 10 ? 3 : em || 0; o.bench = em === 10;
    if (!o.seen) { o.seen = true; o.group.visible = true; o.group.position.set(x, y, z); o.group.rotation.y = ry; }
  });
  socket.on('playerAvatar', ({ id, avatar }) => setOtherAvatar(id, avatar));
  socket.on('chat', ({ name: n, text, scope }) => hud.addChat(n, text, scope));
}
let lastSent = 0, lastState = '';
function sendPosition(now, force) {
  if (!socket || !socket.connected) return;
  if (!force && now - lastSent < 50) return;
  const em = player.sit && player.sit.bench ? 10 : player.emote; // 10 = seated on a bench
  const st = `${player.x.toFixed(2)},${player.y.toFixed(2)},${player.z.toFixed(2)},${player.yaw.toFixed(2)},${em}`;
  if (!force && st === lastState) return;
  lastState = st; lastSent = now;
  socket.emit('move', { x: player.x, y: player.y, z: player.z, ry: player.yaw, em });
}

// ======================= main loop =======================
const _eye = new THREE.Vector3(), _dir = new THREE.Vector3();
let last = performance.now(), underwater = false, frameNo = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05), t = now * 0.001;
  last = now; frameNo++;
  if (customizer.isOpen()) return; // the world is hidden behind the avatar editor: don't spend GPU on it
  if (!terrain) { renderer.render(scene, camera); return; }

  if (ready) {
    const px = player.x, pz = player.z;
    if (active()) { updatePlayer(dt, now); updateInteraction(); } else if (!hud.isChatOpen()) hud.setPrompt(null);
    sendPosition(now, false);
    updateOthers(dt, t);
    hud.setActiveEmote(player.emote);
    if (selfAvatar) {
      selfAvatar.group.position.set(player.x, player.y, player.z);
      selfAvatar.group.rotation.y = player.yaw;
      selfAvatar.group.visible = thirdPerson;
      const swimSelf = !player.fly && !player.sit && ground(player.x, player.z) < -1.0;
      animateAvatar(selfAvatar, {
        moved: Math.hypot(player.x - px, player.z - pz), dt, emote: player.emote, t, swim: swimSelf,
        air: !player.onGround && !player.fly && !swimSelf && !player.sit, sitKind: player.sit && player.sit.bench ? 'bench' : 'ground',
      });
    }
    // camera
    const eyeDrop = player.sit ? (player.emote === 9 ? 1.25 : player.sit.bench ? 0.45 : 0.85) : 0;
    _eye.set(player.x, player.y + 1.62 - eyeDrop, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0);
    camera.position.copy(_eye);
    if (thirdPerson) {
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      camera.position.addScaledVector(_dir, -4.2);
      camera.position.y += 0.5;
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z) + 0.4);
    }
    // underwater look
    const uw = camera.position.y < 0.15 + Math.sin(now * 0.001) * 0.3 && camera.position.y < 0.45;
    if (uw !== underwater) {
      underwater = uw;
      sky.visible = !uw;
      renderer.setClearColor(UNDER_COLOR);
      scene.fog.color.set(uw ? UNDER_COLOR : FOG_COLOR);
      scene.fog.near = uw ? 1 : FOG_NEAR;
      scene.fog.far = uw ? 55 : FOG_FAR;
    }
    // light, sky and water follow the player
    const tx = Math.round(player.x / 4) * 4, ty = Math.round(player.y / 4) * 4, tz = Math.round(player.z / 4) * 4;
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + sunDir.x * 150, ty + sunDir.y * 150, tz + sunDir.z * 150);
    sky.position.copy(camera.position);
    water.position.x = Math.round(camera.position.x / WATER_CELL) * WATER_CELL;
    water.position.z = Math.round(camera.position.z / WATER_CELL) * WATER_CELL;
    farOcean.position.x = camera.position.x; farOcean.position.z = camera.position.z;
    if (frameNo % 8 === 1) cullVegetation(player.x, player.z);
    if (frameNo % 30 === 7 && !player.fly && !player.sit) pushOut();
    if (!isTouch || frameNo % 2 === 0) hud.drawMinimap(player, [...others.values()].filter((o) => o.seen).map((o) => ({ x: o.group.position.x, z: o.group.position.z })));
  }
  if (town) town.update(t, waveHeight);
  if (waterUniforms) waterUniforms.uTime.value = t;
  renderer.render(scene, camera);
}

// ======================= startup =======================
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function boot() {
  statusEl.textContent = 'Shaping the island...'; await nextFrame();
  const site = findTownSite();
  terrain = new Terrain(STEP, { x: site.x, z: site.z, h: site.h0, ...FLATTEN });
  plan = planTown(terrain, site);
  statusEl.textContent = 'Painting terrain...'; await nextFrame();
  buildTerrain(); buildWater();
  statusEl.textContent = 'Planting trees...'; await nextFrame();
  buildVegetation();
  statusEl.textContent = 'Building the beach town...'; await nextFrame();
  tex.signs = {
    rentals: signTexture('RENTALS', '#d9644a', '#ffffff'), cafe: signTexture('CAFE', '#6e4527', '#fff4d6'),
    games: signTexture('PLAY', '#14101f', '#ff7bec', true), shop: signTexture('SHOP', '#1d6fd8', '#ffffff'), hotel: signTexture('HOTEL', '#274c77', '#ffe9a8'),
  };
  tex.ludo = ludoBoardTexture(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  tex.lighthouse = lighthouseTexture(4);
  town = buildTown({ THREE, mergeGeometries }, plan, tex, { shadows: !LITE });
  scene.add(town.group);
  plan.boxes.forEach(addBoxCollider);
  plan.circles.forEach((c) => addCollider(c.x, c.z, c.r, c.y0, c.y1));
  interactables = plan.interactables;
  hud.initMinimap(terrain, plan.landmarks);
  // park the camera above the sea looking at the town until the player joins
  const cp = plan.toW(0, plan.shoreZ + 38);
  camera.position.set(cp.x, 16, cp.z);
  const tp = plan.toW(0, 14);
  camera.lookAt(tp.x, 5, tp.z);
  statusEl.textContent = 'Connecting to server...'; await nextFrame();
  connect();
}
window.__vw = { scene, camera, renderer, player, keys, hud, get terrain() { return terrain; }, get plan() { return plan; }, ground, blocked, setEmote, interact, get nearest() { return nearest; } };
requestAnimationFrame(frame);
boot().catch((e) => { statusEl.textContent = 'Error: ' + e.message; console.error(e); });