// Procedural textures for the Bhubaneswar Old Town world (generated in the browser, nothing to download).
import * as THREE from 'three';
import { tfbm, pixelTexture } from './textures.js';

const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clampC = (c) => [Math.max(0, Math.min(255, c[0])), Math.max(0, Math.min(255, c[1])), Math.max(0, Math.min(255, c[2]))];
const grain = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 3, 1274126177); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

export function makeCityTextures(aniso = 4) {
  const S = 256;

  // warm grey-ochre sandstone with fine carved bands, like the Kalinga temples
  const sandstone = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 6, 5, 31), w = tfbm(u, v, 18, 3, 7);
    let c = mix([88, 74, 64], [150, 128, 104], n * 0.8 + w * 0.2);       // weathered brown-grey khondalite
    const band = Math.abs(((v * 16) % 1) - 0.5);                           // fine horizontal ridges
    if (band > 0.44) c = mix(c, [52, 42, 36], 0.6);
    else if (band > 0.36) c = mix(c, [176, 152, 124], 0.18);
    const vert = Math.abs(((u * 12) % 1) - 0.5);                           // vertical grooves between the pilaster bands
    if (vert > 0.45) c = mix(c, [48, 40, 34], 0.55);
    const g = 0.85 + 0.3 * grain(x, y, 4);
    return clampC([c[0] * g, c[1] * g, c[2] * g]);
  }, true, aniso);

  // red-brown laterite blocks (compound walls, tank embankment)
  const laterite = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 10, 4, 51);
    let c = mix([92, 50, 36], [140, 80, 54], n);
    const row = Math.floor(v * 8), off = row % 2 ? 0.5 : 0;
    const bu = ((u * 4 + off) % 1), bv = (v * 8) % 1;
    if (bu < 0.03 || bv < 0.05) c = mix(c, [62, 36, 28], 0.6);
    if (grain(x, y, 9) < 0.05) c = mix(c, [60, 34, 26], 0.5);        // pits
    const g = 0.88 + 0.24 * grain(x, y, 6);
    return clampC([c[0] * g, c[1] * g, c[2] * g]);
  }, true, aniso);

  // grey-pink stone flags for courtyards and the tank-side walkway
  const paving = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 7, 4, 71);
    let c = mix([150, 140, 134], [188, 172, 160], n);
    const fu = (u * 4) % 1, fv = (v * 4) % 1;
    if (fu < 0.025 || fv < 0.025) c = mix(c, [70, 64, 60], 0.65);
    const g = 0.9 + 0.2 * grain(x, y, 8);
    return clampC([c[0] * g, c[1] * g, c[2] * g]);
  }, true, aniso);

  const asphalt = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 9, 4, 91), g = grain(x, y, 2);
    const k = 52 + n * 26 + g * 18;
    return [k, k * 0.98, k * 0.95];
  }, true, aniso);

  // dusty ground with a little grass, for everything that is not road, stone or house
  const ground = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 5, 5, 111), m = tfbm(u, v, 14, 3, 17);
    let c = mix([158, 134, 98], [120, 118, 72], Math.max(0, Math.min(1, (n - 0.45) * 3)));
    c = mix(c, [188, 164, 124], m * 0.35);
    const g = 0.9 + 0.2 * grain(x, y, 5);
    return clampC([c[0] * g, c[1] * g, c[2] * g]);
  }, true, aniso);

  // one floor of a house front (6 m wide x 3.2 m high): plinth, window with shutters, cornice. White, so each house can be tinted.
  const f = document.createElement('canvas'); f.width = 256; f.height = 256;
  const g = f.getContext('2d');
  g.fillStyle = '#f2efe9'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${90 + (i * 7) % 60},${80 + (i * 5) % 50},${70 + (i * 3) % 40},0.05)`; g.fillRect((i * 97) % 256, (i * 57) % 256, 3, 3); }
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 238, 256, 18);          // plinth / floor slab
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(0, 0, 256, 7);       // cornice
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 7, 256, 4);
  const win = (cx) => {
    g.fillStyle = '#d8d2c6'; g.fillRect(cx - 38, 62, 76, 112);              // frame
    g.fillStyle = '#31404a'; g.fillRect(cx - 31, 69, 62, 98);               // glass
    g.fillStyle = 'rgba(160,190,205,0.35)'; g.fillRect(cx - 31, 69, 62, 30);
    g.fillStyle = '#d8d2c6'; g.fillRect(cx - 2, 69, 4, 98); g.fillRect(cx - 31, 116, 62, 4);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(cx - 38, 174, 76, 8);      // sill shadow
  };
  win(64); win(192);
  const facade = new THREE.CanvasTexture(f);
  facade.colorSpace = THREE.SRGBColorSpace; facade.wrapS = facade.wrapT = THREE.RepeatWrapping; facade.anisotropy = aniso;

  // shop-house front: a roll-up shutter and a coloured awning, for the lanes around the lake
  const sc = document.createElement('canvas'); sc.width = 256; sc.height = 256;
  const sg = sc.getContext('2d');
  sg.fillStyle = '#f2efe9'; sg.fillRect(0, 0, 256, 256);
  sg.fillStyle = '#a7a39a'; sg.fillRect(20, 70, 216, 186);
  for (let y = 74; y < 256; y += 9) { sg.fillStyle = 'rgba(0,0,0,0.18)'; sg.fillRect(20, y, 216, 2); }
  sg.fillStyle = 'rgba(0,0,0,0.2)'; sg.fillRect(0, 238, 256, 18);
  sg.fillStyle = 'rgba(255,255,255,0.55)'; sg.fillRect(0, 0, 256, 7);
  const shopfront = new THREE.CanvasTexture(sc);
  shopfront.colorSpace = THREE.SRGBColorSpace; shopfront.wrapS = shopfront.wrapT = THREE.RepeatWrapping; shopfront.anisotropy = aniso;

  return { sandstone, laterite, paving, asphalt, cityGround: ground, facade, shopfront };
}

// painted hoarding at the edge of the playable area
export function hoardingTexture(lines, bg = '#1f3a4a') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 10; g.strokeRect(14, 14, 996, 228);
  g.fillStyle = '#ffd36b'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 84px system-ui, sans-serif'; g.fillText(lines[0], 512, 100, 940);
  g.fillStyle = '#ffffff'; g.font = '48px system-ui, sans-serif'; g.fillText(lines[1] || '', 512, 190, 940);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
