import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { io } from '/socket.io/socket.io.esm.min.js';
import { Terrain, scatter, scatterGround, splatAt, findTownSite, SIZE, HALF } from './island.js';
import { planTown, deckHeightAt, FLATTEN } from './town.js';
import { buildTown } from './townmesh.js';
import { HOTEL } from './hotel.js';
import { makeTextures, signTexture, ludoBoardTexture, lighthouseTexture, chessBoardTexture } from './textures.js';
import { createHUD } from './hud.js';
import { createAvatar, animateAvatar, sanitizeAvatar, DEFAULT_AVATAR, MAX_EMOTE } from './avatar.js';
import { createCustomizer } from './customize.js';
import { weatherAt, describe, MODES, MODE_LABEL } from './weather.js';
import { makeFoliage } from './foliage.js';
import { createVegetation } from './vegetation.js';
import { createClouds, createRain } from './atmosphere.js';
import { createAudio } from './audio.js';
import { createVoice } from './voice.js';

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
Object.assign(tex, makeFoliage(Math.min(8, renderer.capabilities.getMaxAnisotropy())));
const windU = { uTime: { value: 0 }, uWindV: { value: new THREE.Vector4(1, 0, 0.3, 0.2) } };
const terrainWet = { value: 0 };
const BASE_EXPOSURE = 0.78, BASE_SUN = 3.0;

// ======================= world state =======================
let terrain = null, plan = null, town = null;
const doorBoxes = new Map(), doorOpen = new Map();
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
  const e = { x: b.x, z: b.z, hw: b.hw, hd: b.hd, c, s, y0: b.y0 === undefined ? -BIG : b.y0, y1: b.y1 === undefined ? BIG : b.y1, fly: !!b.fly, off: false };
  if (b.door) { if (!doorBoxes.has(b.door)) doorBoxes.set(b.door, []); doorBoxes.get(b.door).push(e); }
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
      if (b.off || (b.fly && !player.fly)) continue;      // open doors and ceilings (ceilings only stop flyers)
      if (py !== undefined && (top < b.y0 || py > b.y1)) continue;
      const ddx = x - b.x, ddz = z - b.z, lx = ddx * b.c - ddz * b.s, lz = ddx * b.s + ddz * b.c;
      const ex = Math.max(Math.abs(lx) - b.hw, 0), ez = Math.max(Math.abs(lz) - b.hd, 0);
      if (ex * ex + ez * ez < pr * pr) return true;
    }
  }
  return false;
}
// Walking surface: natural terrain, or a town deck if one is higher
// refY (your feet height) picks the right hotel floor: an upper floor never pulls you up from below
function ground(x, z, refY) {
  let g = terrain.height(x, z);
  if (plan && Math.abs(x - plan.site.x) < 95 && Math.abs(z - plan.site.z) < 95) { const d = deckHeightAt(plan, x, z, refY); if (d > g) g = d; }
  return g;
}
// Same formula as the water shader, so boats float on the visible waves
let waveAmp = 1;
const waveHeight = (x, z, t) => waveAmp * (Math.sin(x * 0.045 + t * 0.9) * 0.35 + Math.sin(z * 0.06 - t * 0.7 + x * 0.02) * 0.28 + Math.sin((x + z) * 0.11 + t * 1.4) * 0.12);

// ======================= terrain meshes =======================
let terrainMat = null, water = null, waterUniforms = null, farOcean = null;

function buildTerrain() {
  terrainMat = new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0, envMapIntensity: 0.8 });
  terrainMat.onBeforeCompile = (shader) => {
    shader.uniforms.tSand = { value: tex.sand };
    shader.uniforms.tGrass = { value: tex.grass };
    shader.uniforms.tRock = { value: tex.rock };
    shader.uniforms.tDirt = { value: tex.dirt };
    shader.uniforms.uWet = terrainWet;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vTW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvTW = position.xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tSand;\nuniform sampler2D tGrass;\nuniform sampler2D tRock;\nuniform sampler2D tDirt;\nuniform float uWet;\nvarying vec4 vSplat;\nvarying vec2 vTW;')
      .replace('#include <map_fragment>', `
        vec2 p = vTW;
        vec3 sandC  = mix(texture2D(tSand,  p * 0.33).rgb, texture2D(tSand,  p * 0.047).rgb, 0.45);
        vec3 grassC = mix(texture2D(tGrass, p * 0.28).rgb, texture2D(tGrass, p * 0.041).rgb, 0.5);
        vec3 rockC  = mix(texture2D(tRock,  p * 0.16).rgb, texture2D(tRock,  p * 0.022).rgb, 0.5);
        vec3 dirtC  = mix(texture2D(tDirt,  p * 0.30).rgb, texture2D(tDirt,  p * 0.044).rgb, 0.5);
        vec3 albedo = sandC * vSplat.x + grassC * vSplat.y + rockC * vSplat.z + dirtC * vSplat.w;
        float macro = texture2D(tGrass, p * 0.0043).r;
        albedo *= 0.8 + 0.45 * macro;
        albedo *= mix(1.0, 0.6, uWet);
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

  waterUniforms = { uTime: { value: 0 }, uSize: { value: SIZE }, tDepth: { value: depthTex }, tNormal: { value: tex.waterNormal }, tNoise: { value: tex.noise }, uAmp: { value: 1 }, uRain: { value: 0 }, uCover: { value: 0 } };
  const mat = new THREE.MeshStandardMaterial({ color: 0x1a6a8a, roughness: 0.07, metalness: 0, transparent: true, depthWrite: false, envMapIntensity: 0.85 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, waterUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uAmp;\nvarying vec2 vWXZ;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWXZ = wp.xz;
        transformed.y += uAmp * (sin(wp.x * 0.045 + uTime * 0.9) * 0.35 + sin(wp.z * 0.06 - uTime * 0.7 + wp.x * 0.02) * 0.28 + sin((wp.x + wp.z) * 0.11 + uTime * 1.4) * 0.12);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSize;\nuniform sampler2D tDepth;\nuniform sampler2D tNormal;\nuniform sampler2D tNoise;\nuniform float uRain;\nuniform float uCover;\nvarying vec2 vWXZ;')
      .replace('#include <map_fragment>', `
        float depth = texture2D(tDepth, (vWXZ + uSize * 0.5) / uSize).r;
        float dk = smoothstep(0.0, 0.5, depth);
        vec3 wcol = mix(vec3(0.10, 0.62, 0.66), vec3(0.01, 0.12, 0.28), dk);
        float fn = texture2D(tNoise, vWXZ * 0.08 + vec2(uTime * 0.03, 0.0)).r;
        float foam = (1.0 - smoothstep(0.0, 0.035 + 0.03 * sin(uTime * 1.5 + vWXZ.x * 0.3), depth)) * smoothstep(0.42, 0.62, fn) * 0.85;
        wcol = mix(wcol, vec3(0.95), foam);
        diffuseColor.rgb = wcol * (1.0 - 0.38 * uCover);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))), uCover * 0.35);
        diffuseColor.a = max(mix(0.6, 0.97, dk), foam);
      `)
      .replace('#include <normal_fragment_maps>', `
        vec3 n1 = texture2D(tNormal, vWXZ * 0.045 + vec2(uTime * 0.020, uTime * 0.012)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(tNormal, vWXZ * 0.110 + vec2(-uTime * 0.016, uTime * 0.025)).xyz * 2.0 - 1.0;
        vec3 n3 = texture2D(tNormal, vWXZ * 0.9 + vec2(uTime * 0.6, -uTime * 0.5)).xyz * 2.0 - 1.0;
        vec3 nw = normalize(vec3((n1.x + n2.x) * 0.6 + n3.x * uRain * 0.9, 1.0, (n1.y + n2.y) * 0.6 + n3.y * uRain * 0.9));
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
let vegetation = null;
function buildVegetation() {
  const data = scatter(terrain, plan ? plan.exclusions : []);
  if (plan) data.palms.push(...plan.palms);
  const ground = scatterGround(terrain, plan ? plan.exclusions : []);
  vegetation = createVegetation({ THREE, mergeGeometries, tex, scene, data, ground, lite: LITE, shadows: !LITE, addCollider, wind: windU });
}

// ======================= weather: sky, clouds, rain, wind, sound =======================
let weatherMode = 'auto', timeOffset = 0, clouds = null, rainFx = null, lastFlash = 0;
const audio = createAudio();
const worldTime = () => (Date.now() + timeOffset) / 1000;
const wx = { cover: 0, rain: 0, storm: 0, wind: 0.3, gust: 0, dir: 0.9, flash: 0 };
let wxInit = false, wxFogColor = new THREE.Color(FOG_COLOR), wxFogNear = FOG_NEAR, wxFogFar = FOG_FAR, windOverride = null;
const _clear = new THREE.Color(FOG_COLOR), _gray = new THREE.Color(0x8d98a3), _dark = new THREE.Color(0x4a525c);
function updateWeather(dt, t, camPos) {
  const tw = weatherAt(worldTime(), weatherMode), k = wxInit ? 1 - Math.exp(-dt / 1.5) : 1;
  wxInit = true;
  for (const key of ['cover', 'rain', 'storm', 'wind', 'gust']) wx[key] += (tw[key] - wx[key]) * k;
  wx.dir += Math.atan2(Math.sin(tw.dir - wx.dir), Math.cos(tw.dir - wx.dir)) * k;
  wx.flash = tw.flash;
  if (windOverride !== null) wx.wind = windOverride;
  windU.uTime.value = t;
  windU.uWindV.value.set(Math.cos(wx.dir), Math.sin(wx.dir), wx.wind, wx.gust);
  waveAmp = 1 + 0.9 * wx.wind + 0.5 * wx.storm;
  if (waterUniforms) { waterUniforms.uAmp.value = waveAmp; waterUniforms.uRain.value = wx.rain; waterUniforms.uCover.value = wx.cover; }
  const wetTarget = Math.min(1, wx.rain * 2.2);
  terrainWet.value += (wetTarget - terrainWet.value) * (1 - Math.exp(-dt / (wetTarget > terrainWet.value ? 25 : 90)));
  // light, sky and fog follow the weather
  const dark = Math.min(1, wx.cover * 0.55 + wx.rain * 0.5 + wx.storm * 0.35);
  sun.intensity = BASE_SUN * (1 - 0.82 * wx.cover) * (1 - 0.3 * wx.storm) + wx.flash * 9;
  renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.3 * wx.cover - 0.1 * wx.storm) + wx.flash * 0.7;
  const u = sky.material.uniforms;
  u.turbidity.value = 4 + 16 * wx.cover; u.rayleigh.value = 1.6 - 1.15 * wx.cover; u.mieCoefficient.value = 0.004 + 0.02 * wx.cover;
  wxFogColor.copy(_clear).lerp(_gray, Math.min(1, wx.cover * 0.8 + wx.rain * 0.3)).lerp(_dark, wx.storm * 0.55);
  if (wx.flash > 0.02) wxFogColor.lerp(_clear, Math.min(1, wx.flash));
  wxFogNear = FOG_NEAR * (1 - 0.65 * wx.rain); wxFogFar = FOG_FAR * (1 - 0.58 * wx.rain - 0.15 * wx.cover);
  if (clouds) clouds.update(dt, camPos, wx, [1 - 0.05 * wx.cover, 1 - 0.03 * wx.cover, 1]);
  if (rainFx) rainFx.update(t, camPos, wx);
  if (wx.flash > 0.6 && lastFlash <= 0.6) audio.thunder(0.8 + Math.random() * 2.6);
  lastFlash = wx.flash;
  return dark;
}
function cycleWeather() {
  weatherMode = MODES[(MODES.indexOf(weatherMode) + 1) % MODES.length];
  hud.toast('Weather: ' + MODE_LABEL[weatherMode] + (weatherMode === 'auto' ? ' (shared by everyone)' : ' (only you see this)'));
}
function toggleSound() { audio.start(); audio.setEnabled(!audio.isOn()); hud.toast(audio.isOn() ? 'Sound on' : 'Sound off'); $('btnSound').textContent = audio.isOn() ? '🔊' : '🔇'; }

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
      if (ground(nx, nz, player.y) - Math.max(ground(ox, oz, player.y), t1) > 0.5) return false; // too high a step
    }
  }
  // solid things block you (also while flying); if you are already inside one you may move out of it
  if (blocked(nx, nz, PR, player.y) && !blocked(ox, oz, PR, player.y)) return false;
  player.x = nx; player.z = nz;
  return true;
}
// Move the player to the nearest free spot (used when leaving fly mode above a building, or if stuck)
function pushOut() {
  const g = (x, z) => ground(x, z, player.y);
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
    player.y = ground(player.x, player.z, player.y);
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
  const g0 = ground(player.x, player.z, player.y);
  const swimming = !player.fly && g0 < -1.0;
  const run = keys.ShiftLeft || keys.ShiftRight || touch.run;
  let speed = player.fly ? 18 : swimming ? 2.6 : run ? 7.5 : 4.2;
  if (player.fly && run) speed = 45;
  const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
  const wx = (-sin * f + cos * s) * speed * dt, wz = (-cos * f - sin * s) * speed * dt;
  moveH(wx, 0);
  moveH(0, wz);

  const g = ground(player.x, player.z, player.y);
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
  chess: 'Chess table: online chess is coming soon.',
  ludo: 'Ludo table: multiplayer Ludo (server-side dice and rules) is the next feature.',
  fish: 'Fishing spot: fishing is coming soon.',
  shop: null,
};
function updateInteraction() {
  if (player.sit && player.sit.bench) { hud.setPrompt('Stand up'); nearest = null; return; }
  let best = null, bd = 1e9;
  for (const it of interactables) {
    const d = Math.hypot(it.x - player.x, it.z - player.z);
    if (d < it.radius && Math.abs(player.y - it.y) < (it.dy || 3)) {
      let score = d;
      if (it.type === 'door' && d > 0.01) { // in a corridor, prefer the door you are looking at
        const dot = (-Math.sin(player.yaw) * (it.x - player.x) + -Math.cos(player.yaw) * (it.z - player.z)) / d;
        if (dot < 0.25) score += 1.5;
      }
      if (score < bd) { best = it; bd = score; }
    }
  }
  nearest = best;
  hud.setPrompt(best ? (best.labels ? best.labels[doorOpen.get(best.door) ? 1 : 0] : best.label) : null, best && best.soon);
}
function interact() {
  if (player.sit && player.sit.bench) { stopEmote(); return; }
  if (!nearest) return;
  if (nearest.type === 'sit') sitOn(nearest);
  else if (nearest.type === 'door') setDoorOpen(nearest.door, !doorOpen.get(nearest.door), true);
  else if (nearest.type === 'npc') { const n = npcs.find((q) => q.id === nearest.npc); if (n) { n.waveUntil = performance.now() + 2500; hud.toast(n.name.split(' · ')[0] + ': ' + n.lines[n.line++ % n.lines.length], 5600); } }
  else hud.toast(INTERACT_MSG[nearest.type] || `${nearest.label}: coming soon`);
}

// ======================= hotel: doors, receptionist, indoors =======================
function setDoorOpen(id, open, send) {
  doorOpen.set(id, open);
  const bx = doorBoxes.get(id);
  if (bx) bx.forEach((e) => { e.off = open; });
  if (town) town.setDoor(id, open);
  if (send && socket && socket.connected) socket.emit('door', { id, open });
}
// Staff NPCs: the hotel receptionist plus the café, shop, rentals and games-hall hosts. They wave when you walk up and turn to face you.
const npcs = [];
const RECEPTION_CFG = { g: 1, skin: 2, hs: 5, hc: 1, face: 1, top: 1, tc: 11, bot: 0, bc: 2, shoe: 1, acc: [0, 0, 0, 0, 0] };
const NPC_LINES = [
  "Welcome to the Island Hotel! I'm the receptionist.",
  'The guest rooms are on floors 1 and 2. Take the stairs at the back of the lobby.',
  'Press E at a door to open it. Every room has its own bathroom.',
  'Rooms have a bed, wardrobe, desk, TV and a bathroom with a shower. Make yourself at home!',
  'The pier and the beach are just outside. Enjoy your stay!',
];
function buildNpcs() {
  const h = plan.hotel.npc;
  const defs = [{ id: 'maya', name: 'Maya · Receptionist', cfg: RECEPTION_CFG, lx: h.lx, lz: h.lz, y: h.y, faceZ: 1, lines: NPC_LINES }, ...plan.extra.npcs];
  for (const d of defs) {
    const p = plan.toW(d.lx, d.lz), av = makeAvatar(d.cfg, d.name, true);
    const baseYaw = plan.theta + (d.faceZ > 0 ? Math.PI : 0);
    av.group.position.set(p.x, d.y, p.z); av.group.rotation.y = baseYaw;
    scene.add(av.group);
    if (d.id === 'maya') addCollider(p.x, p.z, 0.32, d.y, d.y + 1.9);   // (the others got their collider from the plan)
    npcs.push({ id: d.id, name: d.name, av, x: p.x, z: p.z, y: d.y, baseYaw, near: false, waveUntil: 0, lines: d.lines, line: 0 });
  }
}
function updateNpcs(dt, t, now) {
  for (const n of npcs) {
    const dx = player.x - n.x, dz = player.z - n.z, near = Math.abs(player.y - n.y) < 2.5 && Math.hypot(dx, dz) < 6.5;
    if (near && !n.near) n.waveUntil = now + 3200;   // waves when you walk up
    n.near = near;
    const g = n.av.group;
    g.rotation.y = lerpAngle(g.rotation.y, near ? Math.atan2(-dx, -dz) : n.baseYaw, 1 - Math.exp(-dt * 5));
    animateAvatar(n.av, { moved: 0, dt, emote: now < n.waveUntil ? 1 : 0, t });
  }
}
// inside a building (no rain, quieter wind)?
function isIndoors(x, z, y) {
  if (!plan) return false;
  const l = plan.toLocal(x, z);
  return plan.indoorBounds.some((b) => l.lx > b.x0 && l.lx < b.x1 && l.lz > b.z0 && l.lz < b.z1 && y > b.y0 && y < b.y1);
}
let indoors = false;

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
const voice = createVoice({
  getSocket: () => socket,
  getSelf: () => ({ x: player.x, y: player.y + 1.6, z: player.z, yaw: player.yaw, pitch: player.pitch }),
  getOthers: () => [...others].map(([id, o]) => ({ id, name: o.name, seen: o.seen, x: o.group.position.x, y: o.group.position.y + 1.6, z: o.group.position.z })),
  isIndoors,
  getAudioContext: () => { audio.start(); return audio.getContext(); },
  onSpeakers: (list, selfSpeaking) => hud.setSpeakers(list, selfSpeaking, (id) => voice.toggleMute(id)),
  onMic: (on) => hud.setMic(on),
  toast: (m) => hud.toast(m, 3600),
});
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
$('btnSound').addEventListener('click', toggleSound);
$('btnMic').addEventListener('click', () => voice.toggleMic());
$('btnMic').addEventListener('touchstart', (e) => { e.preventDefault(); voice.start(); voice.toggleMic(); }, { passive: false });
$('btnSound').addEventListener('touchstart', (e) => { e.preventDefault(); toggleSound(); }, { passive: false });
$('btnSound').textContent = audio.isOn() ? '🔊' : '🔇';
$('wx').addEventListener('click', cycleWeather);
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
  audio.start(); voice.start();
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
  if (e.code === 'KeyK') cycleWeather();
  if (e.code === 'KeyO') toggleSound();
  if (e.code === 'KeyG') voice.toggleMic();
  audio.start();
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
  socket.on('door', ({ id, open }) => setDoorOpen(id, !!open, false));
  socket.on('rtc', (m) => voice.handleSignal(m));
  socket.on('init', ({ players, selfId, serverTime, doors }) => {
    if (serverTime) timeOffset = serverTime - Date.now();
    for (const id of doorBoxes.keys()) setDoorOpen(id, !!(doors && doors[id]), false);
    for (const id of [...others.keys()]) removeOther(id);
    voice.setSelf(selfId);
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
  socket.on('playerLeft', (id) => { voice.removePeer(id); const o = others.get(id); if (o) hud.addChat(null, `${o.name} left`); removeOther(id); });
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
    indoors = isIndoors(player.x, player.z, player.y);
    updateNpcs(dt, t, now);
    hud.setActiveEmote(player.emote);
    if (selfAvatar) {
      selfAvatar.group.position.set(player.x, player.y, player.z);
      selfAvatar.group.rotation.y = player.yaw;
      selfAvatar.group.visible = thirdPerson && !indoors;
      const swimSelf = !player.fly && !player.sit && ground(player.x, player.z, player.y) < -1.0;
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
    if (thirdPerson && !indoors) { // (rooms are too small for the follow camera: you see through your own eyes indoors)
      _dir.set(-Math.sin(player.yaw) * Math.cos(player.pitch), Math.sin(player.pitch), -Math.cos(player.yaw) * Math.cos(player.pitch));
      camera.position.addScaledVector(_dir, -4.2);
      camera.position.y += 0.5;
      camera.position.y = Math.max(camera.position.y, ground(camera.position.x, camera.position.z, camera.position.y) + 0.4);
    }
    // weather first, then the underwater look overrides the fog
    updateWeather(dt, t, camera.position);
    const uw = camera.position.y < 0.15 + Math.sin(now * 0.001) * 0.3 && camera.position.y < 0.45;
    if (uw !== underwater) { underwater = uw; sky.visible = !uw; renderer.setClearColor(UNDER_COLOR); }
    if (clouds) clouds.group.visible = !uw;
    if (rainFx && (uw || indoors)) rainFx.object.visible = false;
    if (uw) { scene.fog.color.set(UNDER_COLOR); scene.fog.near = 1; scene.fog.far = 55; }
    else { scene.fog.color.copy(wxFogColor); scene.fog.near = wxFogNear; scene.fog.far = wxFogFar; }
    // light, sky and water follow the player
    const tx = Math.round(player.x / 4) * 4, ty = Math.round(player.y / 4) * 4, tz = Math.round(player.z / 4) * 4;
    sun.target.position.set(tx, ty, tz);
    sun.position.set(tx + sunDir.x * 150, ty + sunDir.y * 150, tz + sunDir.z * 150);
    sky.position.copy(camera.position);
    water.position.x = Math.round(camera.position.x / WATER_CELL) * WATER_CELL;
    water.position.z = Math.round(camera.position.z / WATER_CELL) * WATER_CELL;
    farOcean.position.x = camera.position.x; farOcean.position.z = camera.position.z;
    if (vegetation && frameNo % 8 === 1) vegetation.update(player.x, player.z);
    if (frameNo % 6 === 3) {
      const h = ground(player.x, player.z, player.y);
      audio.update({ indoors, wind: wx.wind, gust: wx.gust, rain: wx.rain, storm: wx.storm, cover: wx.cover, water: Math.max(0, Math.min(1, 1 - (h - 0.3) / 7)), forest: Math.max(0, Math.min(1, (h - 2) / 6)) * (h < 38 ? 1 : 0), underwater });
    }
    if (frameNo % 30 === 11) $('wx').textContent = describe(wx);
    if (frameNo % 30 === 7 && !player.fly && !player.sit) pushOut();
    if (!isTouch || frameNo % 2 === 0) hud.drawMinimap(player, [...others.values()].filter((o) => o.seen).map((o) => ({ x: o.group.position.x, z: o.group.position.z })));
  }
  if (town) town.update(t, waveHeight);
  if (waterUniforms) waterUniforms.uTime.value = t;
  if (!ready) updateWeather(dt, t, camera.position);
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
  clouds = createClouds(THREE, { puff: tex.puff, noise: tex.noise, count: LITE ? 26 : 46 }); scene.add(clouds.group);
  rainFx = createRain(THREE, { count: LITE ? 3200 : 7500 }); scene.add(rainFx.object);
  statusEl.textContent = 'Building the beach town...'; await nextFrame();
  tex.signs = {
    rentals: signTexture('RENTALS', '#d9644a', '#ffffff'), cafe: signTexture('CAFE', '#6e4527', '#fff4d6'),
    reception: signTexture('RECEPTION', '#3b2a20', '#f2d9a0'), cafe_menu: signTexture('MENU', '#232a2e', '#fff4d6'), rentals_prices: signTexture('SURF · SUP · KAYAK', '#0f5f7a', '#ffffff'), scoreboard: signTexture('LUDO · CHESS', '#1a1428', '#ff7bec', true), games: signTexture('PLAY', '#14101f', '#ff7bec', true), shop: signTexture('SHOP', '#1d6fd8', '#ffffff'), hotel: signTexture('HOTEL', '#274c77', '#ffe9a8'),
  };
  tex.ludo = ludoBoardTexture(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  tex.lighthouse = lighthouseTexture(4);
  tex.chess = chessBoardTexture(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
  town = buildTown({ THREE, mergeGeometries }, plan, tex, { shadows: !LITE });
  scene.add(town.group);
  plan.boxes.forEach(addBoxCollider);
  buildNpcs();
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
window.__vw = { scene, camera, renderer, player, keys, hud, voice, setDoorOpen, doorOpen, get indoors() { return indoors; }, npcs, wx, setWeather: (m) => { weatherMode = m; wxInit = false; }, setWind: (v) => { windOverride = v; }, get vegetation() { return vegetation; }, get terrain() { return terrain; }, get plan() { return plan; }, ground, blocked, setEmote, interact, get nearest() { return nearest; } };
requestAnimationFrame(frame);
boot().catch((e) => { statusEl.textContent = 'Error: ' + e.message; console.error(e); });