import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { io } from '/socket.io/socket.io.esm.min.js';
import { buildPlan, WORLD, EDGE, lakeValue, COMPOUND, LAKE, MAHAKALA } from './bbsr_plan.js';
import { hourAt, clockText, skyAt } from './bbsr_time.js';
import { createNightSky, collectLights, createLightGlow, createBeacon } from './bbsr_night.js';
import { createMissions, spotsFromPlan, ITEMS, SPOT_LABELS, QUEST_LIST, isNight } from './bbsr_missions.js';
import { buildCity } from './bbsr_mesh.js';
import { ZONES, ZONE_BY_ID, zoneId, zoneRoom, buildZonePlan } from './bbsr_zones.js';
import { buildZoneExtras } from './bbsr_zone_mesh.js';
import { LAYOUT, BOUNDS, inBounds, areaAt, distToArea, offsetPlan, buildConnectors, edgeExits, computeLinks } from './bbsr_city.js';
import { makeCityTextures } from './bbsr_tex.js';
import { makeTextures } from './textures.js';
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
// Default: ONE connected Bhubaneswar (every area in one world). ?zone=<id> shows a single area on its own (for testing).
const CITY = !new URLSearchParams(location.search).has('zone');
const ZONE = zoneId(new URLSearchParams(location.search).get('zone'));
document.title = CITY ? 'Bhubaneswar' : ZONE_BY_ID[ZONE].name + ' · Bhubaneswar';
const inWorld = (x, z) => (CITY ? inBounds(x, z) : Math.abs(x) < EDGE && Math.abs(z) < EDGE);

const FOG_COLOR = 0xdde8f1, FOG_NEAR = 70, FOG_FAR = 900;
const UNDER_COLOR = 0x0a4f73;

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
const moon = new THREE.DirectionalLight(0x9fb4ff, 0);       // moonlight: no shadows, just a cool wash from above
moon.target = sun.target; scene.add(moon);
const nightFill = new THREE.HemisphereLight(0x5b73c0, 0x1b1f30, 0);
scene.add(nightFill);
const nightSky = createNightSky(THREE); scene.add(nightSky.group);
const beacon = createBeacon(THREE); scene.add(beacon.group);
let glow = null, zoneMats = null;
const zoneGlass = [], towns = [], parts = [];   // the city: glass materials, per-area meshes, per-area plans
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
Object.assign(tex, makeCityTextures(Math.min(8, renderer.capabilities.getMaxAnisotropy())));
const windU = { uTime: { value: 0 }, uWindV: { value: new THREE.Vector4(1, 0, 0.3, 0.2) } };
const terrainWet = { value: 0 };
const BASE_EXPOSURE = 0.78, BASE_SUN = 3.0;

// ======================= world state =======================
let plan = null, town = null;
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
// Walking surface: natural terrain (flat except the Khandagiri hill), or the top of a flyover if your feet are at deck height.
// refY is your feet height: walk up a ramp and the deck carries you; stand below it and the ground stays at the ground.
function deckAt(f, s) { const g = (f.off || 0) + s, T = f.tot || f.L; return g < f.ramp ? (f.h * g) / f.ramp : T - g < f.ramp ? (f.h * (T - g)) / f.ramp : f.h; }
function ground(x, z, refY) {
  let h = plan && plan.height ? plan.height(x, z) : 0;
  if (refY !== undefined && plan && plan.flyovers) {
    for (const f of plan.flyovers) {
      const rx = x - f.x0, rz = z - f.z0, s = rx * f.dx + rz * f.dz;
      if (s < 0 || s > f.L) continue;
      if (Math.abs(rx * f.dz - rz * f.dx) > f.w / 2) continue;
      const y = deckAt(f, s);
      if (y > h && refY >= y - 0.7) h = y;
    }
  }
  return h;
}
// Same formula as the water shader, so boats float on the visible waves
let waveAmp = 1;
const waveHeight = (x, z, t) => waveAmp * (Math.sin(x * 0.045 + t * 0.9) * 0.35 + Math.sin(z * 0.06 - t * 0.7 + x * 0.02) * 0.28 + Math.sin((x + z) * 0.11 + t * 1.4) * 0.12);

let waterUniforms = null;

// ======================= vegetation =======================
let vegetation = null;
function buildVegetation() {
  const data = { palms: plan.trees.palms, broad: plan.trees.broad, pines: [], rocks: plan.trees.rocks };
  const ground = { shrubs: [], ferns: [], grass: [] };
  vegetation = createVegetation({ THREE, mergeGeometries, tex, scene, data, ground, lite: LITE, shadows: !LITE, addCollider, wind: windU });
}

// ======================= time of day =======================
// One shared clock (30 real minutes per day, same for everyone). T lets you look at another time, just for you.
let todOverride = null, todStep = 0, curHour = 9, ts = skyAt(9), lastEnv = -1, envMats = [], envSeen = new Set();
const TOD_STEPS = [null, 6.3, 12, 17.4, 21], TOD_NAMES = ['Live clock (shared)', 'Dawn', 'Noon', 'Evening', 'Night'];
function cycleTime() {
  todStep = (todStep + 1) % TOD_STEPS.length; todOverride = TOD_STEPS[todStep];
  hud.toast('Time of day: ' + TOD_NAMES[todStep] + (todOverride === null ? '' : ' (only you see this)'));
}
const _warm = new THREE.Color(0xff8a3d), _white = new THREE.Color(0xfff0d6), _dusk = new THREE.Color(0xe9a574), _nightFog = new THREE.Color(0x0a1022);
function collectEnvMats() {
  scene.traverse((o) => {
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) if (m.isMeshStandardMaterial && !envSeen.has(m)) { envSeen.add(m); m.userData.envBase = m.envMapIntensity === undefined ? 1 : m.envMapIntensity; envMats.push(m); lastEnv = -1; }
  });
}
function applyTime(camPos, t, cover) {
  curHour = todOverride !== null ? todOverride : hourAt(worldTime());
  ts = skyAt(curHour);
  sunDir.set(ts.dir[0], ts.dir[1], ts.dir[2]);
  sky.material.uniforms.sunPosition.value.copy(sunDir);
  sun.color.copy(_white).lerp(_warm, Math.min(1, ts.glow * 0.9));
  moon.intensity = 0.7 * ts.night * (1 - 0.7 * cover);
  nightFill.intensity = 0.9 * ts.night * (1 - 0.5 * cover);
  if (Math.abs(ts.env - lastEnv) > 0.003) { for (const m of envMats) m.envMapIntensity = m.userData.envBase * ts.env; lastEnv = ts.env; }
  for (const tw of towns) { tw.mats.lamp.emissiveIntensity = 0.12 + 3.4 * ts.lampOn; tw.mats.stone.emissiveIntensity = 0.5 * ts.lampOn; }
  for (const g of zoneGlass) g.emissiveIntensity = 1.0 * ts.lampOn;
  nightSky.update(camPos, ts, cover);
  if (glow) glow.update(camPos, ts.lampOn, cover, t, frameNo % 8 === 0);
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
  applyTime(camPos, t, wx.cover);
  sun.intensity = BASE_SUN * ts.sunI * (1 - 0.82 * wx.cover) * (1 - 0.3 * wx.storm) + wx.flash * 9;
  renderer.toneMappingExposure = BASE_EXPOSURE * ts.exposure * (1 - 0.3 * wx.cover - 0.1 * wx.storm) + wx.flash * 0.7;
  const u = sky.material.uniforms;
  u.turbidity.value = 4 + 16 * wx.cover + 6 * ts.glow; u.rayleigh.value = 1.6 - 1.15 * wx.cover + 0.6 * ts.glow; u.mieCoefficient.value = 0.004 + 0.02 * wx.cover + 0.01 * ts.glow;
  wxFogColor.copy(_clear).lerp(_gray, Math.min(1, wx.cover * 0.8 + wx.rain * 0.3)).lerp(_dark, wx.storm * 0.55);
  wxFogColor.lerp(_dusk, ts.glow * 0.55 * (1 - ts.night)).lerp(_nightFog, ts.night * 0.94);
  if (wx.flash > 0.02) wxFogColor.lerp(_clear, Math.min(1, wx.flash));
  wxFogNear = FOG_NEAR * (1 - 0.65 * wx.rain); wxFogFar = FOG_FAR * (1 - 0.58 * wx.rain - 0.15 * wx.cover);
  if (clouds) {
    const gl = ts.glow * (1 - ts.night), nt = ts.night;
    clouds.update(dt, camPos, wx, [(1 - 0.05 * wx.cover) * (1 - 0.0 * gl) * (1 - nt * 0.91), (1 - 0.03 * wx.cover) * (1 - 0.3 * gl) * (1 - nt * 0.89), (1 - 0.45 * gl) * (1 - nt * 0.8)]);
  }
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
  const sp = plan.spawn;
  for (let tries = 0; tries < 60; tries++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * sp.r, x = sp.x + Math.cos(a) * r, z = sp.z + Math.sin(a) * r;
    if (blocked(x, z, PR + 0.3)) continue;
    player.x = x; player.z = z; player.y = ground(x, z); player.vy = 0; player.yaw = sp.yaw;
    return;
  }
  player.x = sp.x; player.z = sp.z; player.y = ground(sp.x, sp.z); player.yaw = sp.yaw;
}
function moveH(dx, dz) {
  const ox = player.x, oz = player.z, nx = ox + dx, nz = oz + dz;
  if (!inWorld(nx, nz)) return false;
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
    if (inWorld(x, z) && !blocked(x, z, PR + 0.1, y)) { player.x = x; player.z = z; player.y = y; player.vy = 0; return; }
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
  hud.setPrompt(best ? (best.labels ? best.labels[doorOpen.get(best.door) ? 1 : 0] : best.dyn ? best.dyn() : best.label) : null, best && best.soon);
}
function interact() {
  if (player.sit && player.sit.bench) { stopEmote(); return; }
  if (!nearest) return;
  if (nearest.type === 'sit') sitOn(nearest);
  else if (nearest.type === 'door') setDoorOpen(nearest.door, !doorOpen.get(nearest.door), true);
  else if (nearest.type === 'npc') {
    const n = npcs.find((q) => q.id === nearest.npc);
    if (n) {
      n.waveUntil = performance.now() + 2500;
      const extra = missions ? missions.talk(n.id) : [];
      const chat = n.name.split(' · ')[0] + ': ' + n.lines[n.line++ % n.lines.length];
      showLines(n.id === 'sibu' && extra.length ? extra : [chat, ...extra], 5600);
      rearmSpots();
    }
  }
  else if (nearest.type === 'travel') openTravel();
  else if (nearest.type === 'stall' && missions) { const lines = missions.buy(nearest.key); showLines([nearest.text, ...lines], 7000); rearmSpots(); }
  else if (nearest.text) hud.toast(nearest.text, 8000);
  else hud.toast(INTERACT_MSG[nearest.type] || `${nearest.label}: coming soon`);
}

// ======================= missions, jobs, coins =======================
let missions = null, journalOpen = false, spotList = [], spotArmed = {}, lastCoins = null, lastObjSig = '';
const STORE_KEY = 'bbsr_progress_v1';
function showLines(lines, ms = 4200) {
  lines = lines.filter(Boolean);
  if (!lines.length) return;
  hud.toast(lines.join('\n'), Math.min(14000, Math.max(ms, 2600 + lines.join(' ').length * 48)));
  for (const l of lines) if (/^(Quest complete|Job done|Level up|New quest|Delivered|You have finished)/.test(l)) hud.addChat(null, l);
  refreshQuest();
}
function rearmSpots() { spotArmed = {}; }
function initMissions() {
  const old = CITY ? parts[0].plan : plan;   // the Old Town plan (it sits at the origin, so its story coordinates are unchanged)
  const spots = (CITY || ZONE === 'oldtown') ? spotsFromPlan(old, { COMPOUND, LAKE, MAHAKALA }) : Object.fromEntries(plan.spots.map((s) => [s.id, { x: s.x, z: s.z, r: s.r }]));
  let extra = null;
  if (CITY) {
    extra = { spots: [], zones: {} };
    for (const pt of parts.slice(1)) {
      extra.zones[pt.id] = { name: ZONE_BY_ID[pt.id].name };
      for (const sp of pt.plan.spots) {
        const info = pt.plan.spotInfo[sp.id] || {};
        extra.spots.push({ id: sp.id, label: info.label || sp.label, text: info.text, xp: info.xp || 0, zone: pt.id, x: sp.x, z: sp.z });
        spots[sp.id] = { x: sp.x, z: sp.z, r: sp.r };
      }
    }
  }
  spotList = Object.entries(spots).map(([id, p]) => ({ id, ...p }));
  missions = createMissions({
    plan: old, spots, extra, hour: () => curHour,
    load: () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } },
    save: (s) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* private window: progress lasts for this visit only */ } },
  });
  for (const it of plan.interactables) {
    if (it.type !== 'stall') continue;
    it.key = it.id.slice(6);
    const item = ITEMS[it.key];
    it.dyn = () => { const j = missions.state.job; return j && j.stage === 'buy' && j.key === it.key ? `Pick up Sibu's order (${item.name})` : `${item.carry ? 'Buy' : 'Eat'} ${item.name} · ${item.price} coins`; };
  }
  $('quest').addEventListener('click', () => toggleJournal());
  refreshQuest();
}
function checkSpots() {
  if (!missions) return;
  for (const sp of spotList) {
    const d = Math.hypot(player.x - sp.x, player.z - sp.z);
    if (d < sp.r) { if (!spotArmed[sp.id]) { spotArmed[sp.id] = true; showLines(missions.spot(sp.id), 5200); } }
    else if (d > sp.r * 1.5) spotArmed[sp.id] = false;
  }
}
let objNow = null, lastArea = null, welcomed = false;
function refreshQuest() {
  if (!missions) return;
  const st = missions.state, o = missions.objective(); objNow = o;
  const lv = missions.level(), lo = missions.thisLevelXp(), hi = missions.nextLevelXp();
  const coins = $('qCoins');
  coins.textContent = '\u{1FA99} ' + st.coins;
  if (lastCoins !== null && st.coins !== lastCoins) { coins.classList.remove('bump'); void coins.offsetWidth; coins.classList.add('bump'); }
  lastCoins = st.coins;
  $('qLevel').textContent = `Lv ${lv} · ${missions.levelName()}`;
  $('qBar').firstElementChild.style.width = Math.round(100 * (st.xp - lo) / (hi - lo)) + '%';
  $('qTitle').textContent = o.title; $('qTitle').className = o.kind === 'job' ? 'job' : '';
  $('qText').textContent = o.text;
  $('qArrow').firstElementChild.querySelector('path').setAttribute('fill', o.kind === 'job' ? '#55e0ff' : '#ffd24a');
  const sig = o.title + o.text + o.x; if (sig !== lastObjSig) { lastObjSig = sig; beacon.set(o); }
  if (journalOpen) renderJournal();
}
function updateQuestDistance() {
  if (!objNow || objNow.x === undefined) { $('qMeters').textContent = ''; $('qArrow').style.visibility = 'hidden'; return; }
  const dx = objNow.x - player.x, dz = objNow.z - player.z, d = Math.hypot(dx, dz);
  $('qMeters').textContent = d < 8 ? 'You are here' : Math.round(d) + ' m';
  const rel = Math.atan2(dx, dz) - (player.yaw + Math.PI);
  $('qArrow').style.visibility = d < 8 ? 'hidden' : 'visible';
  $('qArrow').style.transform = `rotate(${-rel}rad)`;
}
function renderJournal() {
  const st = missions.state, cur = missions.currentQuest(), lv = missions.level();
  const bag = [];
  if (st.bag.flowers) bag.push(`Marigold garland x${st.bag.flowers}`);
  if (st.bag.bangles) bag.push(`Glass bangles x${st.bag.bangles}`);
  if (st.bag.job) bag.push(`Sibu's order: ${ITEMS[st.bag.job].name}`);
  const quests = missions.quests().map((q) => {
    const done = q.st.done, now = cur && cur.id === q.id, step = q.steps[Math.min(q.st.step, q.steps.length - 1)];
    return `<div class="q ${done ? 'done' : ''} ${now ? 'now' : ''}"><b>${done ? '\u2713 ' : ''}${q.title}</b><span>${done ? q.end : now ? step.text : 'Locked: finish the quest before this one'}</span></div>`;
  }).join('');
  const menu = Object.entries(ITEMS).map(([k, it]) => `<span>${it.name}</span><span>${it.price} coins</span>`).join('');
  $('jbox').innerHTML = `<h2>Journal</h2>
    <div class="stats"><span>\u{1FA99} ${st.coins} coins</span><span>Level ${lv} · ${missions.levelName()}</span><span>${st.xp} XP</span><span>${st.jobsDone} deliveries</span><span>${missions.discovered()} places found</span></div>
    <h3>Quests</h3>${quests}
    <h3>Your bag</h3><div>${bag.length ? bag.join(' · ') : 'Empty'}</div>
    <h3>Bazaar prices</h3><div class="menu">${menu}</div>
    <h3>Delivery jobs</h3><div>Talk to Sibu at the chai adda for a delivery. He pays for the goods, you keep the tip (more after dark).</div>
    <div class="row"><button class="main" id="jClose">Close</button><button id="jReset">Start over</button></div>`;
  $('jClose').onclick = () => toggleJournal(false);
  $('jReset').onclick = () => { if (confirm('Erase your coins, XP and quest progress?')) { missions.reset(); lastCoins = null; refreshQuest(); } };
}
function toggleJournal(force) {
  if (!missions) return;
  const open = force === undefined ? !journalOpen : force;
  if (open === journalOpen) return;
  journalOpen = open;
  $('journal').classList.toggle('open', open);
  if (open) { for (const k in keys) keys[k] = false; document.exitPointerLock?.(); renderJournal(); }
  else if (!isTouch) { try { renderer.domElement.requestPointerLock(); } catch (e) { /* the overlay offers Play */ } }
}
// ======================= travel by auto-rickshaw =======================
let travelOpen = false, travelling = false;
function openTravel() {
  if (travelOpen || travelling) return;
  travelOpen = true; for (const k in keys) keys[k] = false; document.exitPointerLock?.();
  const cur = CITY ? (areaAt(player.x, player.z) || nearestArea()) : ZONE;
  const rows = ZONES.map((z) => {
    const here = z.id === cur;
    return `<button class="tz ${here ? 'here' : ''}" data-z="${z.id}" ${here ? 'disabled' : ''}><span class="ic">${z.icon}</span><span class="tx"><b>${z.name}</b><span>${z.blurb}</span></span><span class="km">${here ? 'You are here' : (z.km ? '~' + (Math.round(Math.abs(z.km - (ZONE_BY_ID[cur].km || 0)) * 2) / 2) + ' km' : 'Start')}</span></button>`;
  }).join('');
  $('tbox').innerHTML = `<h2>Where to?</h2><div class="sub">Raju the auto driver can take you anywhere in Bhubaneswar. The ride is free.</div><div class="tlist">${rows}</div><div class="row"><button id="tClose">Stay here</button></div>`;
  $('travel').classList.add('open');
  $('tClose').onclick = closeTravel;
  $('tbox').querySelectorAll('.tz').forEach((b) => { b.onclick = () => travelTo(b.dataset.z); });
}
function closeTravel() {
  if (!travelOpen) return;
  travelOpen = false; $('travel').classList.remove('open');
  if (!isTouch) { try { renderer.domElement.requestPointerLock(); } catch (e) { /* the overlay offers Play */ } }
}
function nearestArea() { let b = 'oldtown', bd = 1e9; for (const id in LAYOUT) { const d = distToArea(id, player.x, player.z); if (d < bd) { bd = d; b = id; } } return b; }
function travelTo(id) {
  if (travelling || !ZONE_BY_ID[id] || (!CITY && id === ZONE)) return;
  travelling = true;
  if (CITY) {   // same world: the auto drives you across town
    $('tbox').innerHTML = `<h2>${ZONE_BY_ID[id].icon} Off to ${ZONE_BY_ID[id].short}...</h2><div class="sub">Hold on tight. Tr-r-r-ring!</div>`;
    setTimeout(() => {
      const pt = parts.find((q) => q.id === id), sp = pt.plan.spawn;
      player.x = sp.x; player.z = sp.z; player.yaw = sp.yaw; player.y = ground(sp.x, sp.z); player.vy = 0;
      if (vegetation) vegetation.update(player.x, player.z);
      travelling = false; closeTravel(); lastArea = null;
    }, 900);
    return;
  }
  $('tbox').innerHTML = `<h2>${ZONE_BY_ID[id].icon} Off to ${ZONE_BY_ID[id].short}...</h2><div class="sub">Hold on tight. Tr-r-r-ring!</div>`;
  const u = new URL(location.href);
  if (id === 'oldtown') u.searchParams.delete('zone'); else u.searchParams.set('zone', id);
  setTimeout(() => { location.href = u.toString(); }, 900);
}
const clockLine = () => {
  const night = isNight(curHour);
  return (night ? describe(wx).replace('\u2600\ufe0f', '\u{1F319}') : describe(wx)) + ' · ' + clockText(curHour);
};

// ======================= people of the Old Town (no doors here) =======================
function setDoorOpen() {}
const npcs = [];
function buildNpcs() {
  for (const d of plan.npcs) {
    const av = makeAvatar(d.cfg, d.name, true);
    av.group.position.set(d.x, 0, d.z); av.group.rotation.y = d.yaw;
    scene.add(av.group);
    npcs.push({ id: d.id, name: d.name, av, x: d.x, z: d.z, y: 0, baseYaw: d.yaw, near: false, waveUntil: 0, lines: d.lines, line: 0 });
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
const isIndoors = () => false;   // streets and courtyards are open air
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
const active = () => ready && overlay.style.display === 'none' && !hud.isChatOpen() && !customizer.isOpen() && !journalOpen && !travelOpen;
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
  if (!locked && !isTouch && ready && !hud.isChatOpen() && !hud.isBigMap() && !customizer.isOpen() && !journalOpen && !travelOpen) overlay.style.display = 'flex';
});
document.addEventListener('pointerlockerror', () => { if (ready && !hud.isChatOpen() && !customizer.isOpen() && !journalOpen && !travelOpen) overlay.style.display = 'flex'; });
addEventListener('keydown', (e) => {
  if (journalOpen && (e.code === 'KeyJ' || e.code === 'Escape')) { e.preventDefault(); toggleJournal(false); }
  else if (travelOpen && e.code === 'Escape') { e.preventDefault(); closeTravel(); }
});
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
  if (e.code === 'KeyT') cycleTime();
  if (e.code === 'KeyJ') toggleJournal(true);
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
  socket.on('connect', () => { statusEl.textContent = 'Joining...'; socket.emit('join', { name, avatar: myCfg, world: zoneRoom(ZONE) }); });
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
    if (!spawned) { spawn(); spawned = true; hud.toast(CITY ? 'Welcome to Bhubaneswar. Roads and auto stands link the whole city.' : 'Welcome to ' + ZONE_BY_ID[ZONE].name + (ZONE === 'oldtown' ? '' : '. Find the auto stand to go back.'), 4200); if (CITY) { lastArea = 'oldtown'; welcomed = true; } }
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
  if (!plan) { renderer.render(scene, camera); return; }

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
    const uw = false;
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
    if (vegetation && frameNo % 8 === 1) vegetation.update(player.x, player.z);
    if (frameNo % 6 === 3) {
      const h = ground(player.x, player.z, player.y);
      audio.update({ indoors, wind: wx.wind, gust: wx.gust, rain: wx.rain, storm: wx.storm, cover: wx.cover, water: plan.lake ? 0.3 * Math.max(0, Math.min(1, (1.5 - lakeValue(player.x, player.z)) / 0.5)) : 0, forest: 0.3, underwater: false });
    }
    if (frameNo % 30 === 11) $('wx').textContent = clockLine();
    if (frameNo % 6 === 1) { checkSpots(); updateQuestDistance(); }
    if (frameNo % 90 === 5) refreshQuest();
    if (frameNo % 240 === 17) collectEnvMats();
    beacon.update(t, 1 - ts.night);
    if (frameNo % 30 === 7 && !player.fly && !player.sit) pushOut();
    if (!isTouch || frameNo % 2 === 0) hud.drawMinimap(player, [...others.values()].filter((o) => o.seen).map((o) => ({ x: o.group.position.x, z: o.group.position.z })), objNow);
  }
  for (const tw of towns) tw.update(t, waveHeight);
  if (CITY && ready && frameNo % 12 === 4) {
    const px = player.x, pz = player.z;
    for (const pt of parts) pt.town.group.visible = distToArea(pt.id, px, pz) < FOG_FAR + 120;   // only draw the areas you can see
    const a = areaAt(px, pz);
    if (a && a !== lastArea) { if (lastArea !== null || !welcomed) hud.toast(ZONE_BY_ID[a].name, 2600); lastArea = a; welcomed = true; }
    else if (!a) lastArea = null;
  }
  if (waterUniforms) waterUniforms.uTime.value = t;
  if (!ready) updateWeather(dt, t, camera.position);
  renderer.render(scene, camera);
}

// ======================= startup =======================
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
// real streets, flyovers and buildings of an area (made from OpenStreetMap by tools/make_real_zones.py); null = use the hand-drawn layout
async function loadReal(id) { try { const r = await fetch('/data/real_' + id + '.json'); return r.ok ? await r.json() : null; } catch (e) { return null; } }
// ---- the connected city: build every area at its place in one world ----
async function buildCityWorld(osm) {
  for (const z of ZONES) {
    statusEl.textContent = 'Building ' + z.name + '...'; await nextFrame();
    const p = z.id === 'oldtown' ? buildPlan(osm) : buildZonePlan(z.id, await loadReal(z.id));
    p.hoardings = [];                                    // the "edge of the map" signs are not needed any more
    const [ox, oz] = LAYOUT[z.id];
    const tw = buildCity({ THREE, mergeGeometries }, p, tex, { shadows: !LITE });
    if (z.id !== 'oldtown') { const ex = buildZoneExtras({ THREE, mergeGeometries }, p, tex, tw.mats.M, { shadows: !LITE }); tw.group.add(ex.group); if (ex.mats && ex.mats.glass) zoneGlass.push(ex.mats.glass); }
    const gm = tw.group.userData.groundMesh; if (gm) tw.group.remove(gm);   // one shared ground for the whole city (below)
    tw.group.position.set(ox, 0, oz);
    scene.add(tw.group);
    towns.push(tw);
    parts.push({ id: z.id, ox, oz, plan: p, town: tw, map: tw.mapCanvas(), exits: edgeExits(p) });
  }
  // one big ground, and the roads that join the areas
  const M0 = towns[0].mats.M, W = BOUNDS.x1 - BOUNDS.x0, D = BOUNDS.z1 - BOUNDS.z0;
  const g = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2), uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (W / 8), uv.getY(i) * (D / 8));
  const gnd = new THREE.Mesh(g, M0.ground); gnd.position.set((BOUNDS.x0 + BOUNDS.x1) / 2, -0.02, (BOUNDS.z0 + BOUNDS.z1) / 2); gnd.receiveShadow = true; scene.add(gnd);
  const conn = buildConnectors(THREE, M0, computeLinks(parts)); scene.add(conn.group);
  parts.forEach((pt) => offsetPlan(pt.plan, pt.ox, pt.oz));      // gameplay data moves into world coordinates (meshes already sit in place)
  const cat = (k) => parts.flatMap((pt) => pt.plan[k] || []), old = parts[0].plan;
  const hz = parts.filter((pt) => pt.plan.height);
  plan = {
    city: true, short: 'Bhubaneswar', name: 'Bhubaneswar', osm: old.osm, lake: old.lake, chai: old.chai, spawn: old.spawn, travel: old.travel,
    boxes: cat('boxes'), circles: cat('circles'), interactables: cat('interactables'), npcs: cat('npcs'), landmarks: cat('landmarks'), lamps: cat('lamps'), stalls: cat('stalls'), temples: cat('temples'),
    flyovers: cat('flyovers'),
    trees: { palms: parts.flatMap((pt) => pt.plan.trees.palms), broad: parts.flatMap((pt) => pt.plan.trees.broad), pines: [], rocks: parts.flatMap((pt) => pt.plan.trees.rocks) },
    height: hz.length ? (x, z) => { for (const pt of hz) if (Math.abs(x - pt.ox) <= 500 && Math.abs(z - pt.oz) <= 500) return pt.plan.height(x - pt.ox, z - pt.oz); return 0; } : null,
  };
  town = towns[0];
  cityLinks = conn.links;
}
let cityLinks = [];
async function boot() {
  statusEl.textContent = 'Surveying Old Town...'; await nextFrame();
  let osm = null;   // real OpenStreetMap streets and buildings, if tools/fetch_osm.mjs has been run
  if (ZONE === 'oldtown') { try { const r = await fetch('/data/oldtown_osm.json'); if (r.ok) osm = await r.json(); } catch (e) { /* none: use the hand-drawn layout */ } }
  if (CITY) await buildCityWorld(osm);
  else { plan = ZONE === 'oldtown' ? buildPlan(osm) : buildZonePlan(ZONE, await loadReal(ZONE)); plan.short = ZONE_BY_ID[ZONE].short; }
  { const c = document.createElement('div'); c.style.cssText = 'opacity:.55;font-size:11px;margin-top:6px'; c.textContent = ZONE !== 'oldtown' ? ZONE_BY_ID[ZONE].name + ': a hand-drawn approximation of the real place (landmarks right, exact street layout not surveyed).' : plan.osm ? 'Map data \u00a9 OpenStreetMap contributors' : 'Street layout: hand-drawn alpha (run tools/fetch_osm.mjs for the real OpenStreetMap streets)'; $('help').appendChild(c); }
  statusEl.textContent = 'Planting trees...'; await nextFrame();
  buildVegetation();
  clouds = createClouds(THREE, { puff: tex.puff, noise: tex.noise, count: LITE ? 26 : 46 }); scene.add(clouds.group);
  rainFx = createRain(THREE, { count: LITE ? 3200 : 7500 }); scene.add(rainFx.object);
  statusEl.textContent = 'Raising the temples...'; await nextFrame();
  if (!CITY) {
    town = buildCity({ THREE, mergeGeometries }, plan, tex, { shadows: !LITE });
    scene.add(town.group); towns.push(town);
    if (ZONE !== 'oldtown') { const ex = buildZoneExtras({ THREE, mergeGeometries }, plan, tex, town.mats.M, { shadows: !LITE }); town.group.add(ex.group); zoneMats = ex.mats; zoneGlass.push(ex.mats.glass); }
  }
  plan.boxes.forEach(addBoxCollider);
  plan.circles.forEach((c) => addCollider(c.x, c.z, c.r, c.y0, c.y1));
  buildNpcs();
  interactables = plan.interactables;
  glow = createLightGlow(THREE, CITY ? parts.flatMap((pt) => collectLights(pt.plan)) : collectLights(plan), { lite: LITE }); scene.add(glow.group);
  collectEnvMats();
  initMissions();
  if (CITY) hud.initMinimapTiles(parts.map((pt) => ({ canvas: pt.map, ox: pt.ox, oz: pt.oz })), BOUNDS, cityLinks, plan.landmarks);
  else hud.initMinimapImage(town.mapCanvas(), WORLD, plan.landmarks);
  // park the camera over the plaza looking at the Lingaraja tower until the player joins
  camera.position.set(150, 24, 280); camera.lookAt(-72, 28, 185);
  statusEl.textContent = 'Connecting to server...'; await nextFrame();
  connect();
}
window.__vw = { scene, camera, renderer, player, keys, hud, voice, setDoorOpen, doorOpen, get indoors() { return indoors; }, npcs, wx, setWeather: (m) => { weatherMode = m; wxInit = false; }, setWind: (v) => { windOverride = v; }, get vegetation() { return vegetation; }, get plan() { return plan; }, ground, blocked, setEmote, interact, get nearest() { return nearest; }, get missions() { return missions; }, ZONE, CITY, parts, areaAt, openTravel, travelTo, get travelOpen() { return travelOpen; }, get ts() { return ts; }, get hour() { return curHour; }, setTime: (h) => { todOverride = h; }, showLines, checkSpots, get glow() { return glow; }, get beacon() { return beacon; }, toggleJournal };
requestAnimationFrame(frame);
boot().catch((e) => { statusEl.textContent = 'Error: ' + e.message; console.error(e); });
