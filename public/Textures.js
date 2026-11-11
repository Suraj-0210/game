// Procedural, tileable textures generated in the browser (no downloads needed).
import * as THREE from 'three';

const hash = (x, y, s) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 7, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
function tnoise(u, v, p, s) {
  const x = u * p, y = v * p;
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const x0 = ((xi % p) + p) % p, x1 = (x0 + 1) % p, y0 = ((yi % p) + p) % p, y1 = (y0 + 1) % p;
  const a = hash(x0, y0, s), b = hash(x1, y0, s), c = hash(x0, y1, s), d = hash(x1, y1, s);
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function tfbm(u, v, base, oct, s) {
  let a = 1, sum = 0, norm = 0, p = base;
  for (let i = 0; i < oct; i++) { sum += tnoise(u, v, p, s + i * 13) * a; norm += a; a *= 0.5; p *= 2; }
  return sum / norm;
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function pixelTexture(size, fn, srgb, aniso) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const col = fn(x / size, y / size, x, y);
      const i = (y * size + x) * 4;
      img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return finish(c, srgb, aniso);
}
function finish(canvas, srgb, aniso) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
const grain = (x, y, s) => hash(x, y, s);

function frondTexture(aniso) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.strokeStyle = '#5b7f2d'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 32); g.lineTo(256, 32); g.stroke();
  for (let i = 0; i < 46; i++) {
    const x = 4 + i * 5.4, len = 30 * (1 - Math.pow(i / 46, 1.5) * 0.55), k = i % 3;
    g.strokeStyle = `rgb(${48 + k * 9},${105 + k * 16},${30 + k * 4})`;
    g.lineWidth = 2.6;
    for (const dir of [-1, 1]) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 14, 32 + dir * len); g.stroke(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// ---------- beach-town textures ----------
function townTextures(S, aniso) {
  const clap = pixelTexture(S, (u, v, x, y) => {
    const boards = 6, b = Math.floor(v * boards), f = v * boards - b;
    let k = 0.9 + 0.1 * hash(b, 3, 23);
    if (f < 0.07) k *= 0.55; else if (f < 0.14) k *= 0.8 + ((f - 0.07) / 0.07) * 0.2;
    k *= 0.93 + 0.1 * tfbm(u, v, 8, 3, 21) + 0.04 * grain(x, y, 22);
    const c = 238 * k; return [c, c * 0.99, c * 0.96];
  }, true, aniso);
  const roofTile = pixelTexture(S, (u, v, x, y) => {
    const rows = 8, cols = 8, r = Math.floor(v * rows), fr = v * rows - r;
    const cu = u * cols + (r % 2) * 0.5, c = Math.floor(cu) % cols, fc = cu - Math.floor(cu);
    let k = 0.74 + 0.26 * Math.sin(Math.PI * fc);
    if (fr > 0.86) k *= 0.5 + ((1 - fr) / 0.14) * 0.5;
    k *= (0.88 + 0.12 * hash(c, r, 24)) * (0.95 + 0.08 * grain(x, y, 25));
    const v2 = 215 * k; return [v2, v2, v2];
  }, true, aniso);
  const planks = pixelTexture(S, (u, v, x, y) => {
    const pl = 5, b = Math.floor(v * pl), f = v * pl - b;
    let k = 0.84 + 0.16 * hash(b, 1, 31);
    if (f < 0.06 || f > 0.94) k *= 0.45;
    k *= 0.9 + 0.1 * Math.sin(u * Math.PI * 2 * 6 + b * 1.7) + 0.12 * (tfbm(u, v, 6, 3, 33) - 0.5);
    return [208 * k, 176 * k, 132 * k];
  }, true, aniso);
  return { clap, roofTile, planks };
}

export function ludoBoardTexture(aniso = 4) {
  const N = 15, size = 750, c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d'), s = size / N;
  const RED = '#e63946', GRN = '#2a9d4a', YEL = '#f4c20d', BLU = '#1d6fd8';
  g.fillStyle = '#f7f3e8'; g.fillRect(0, 0, size, size);
  const home = (x0, y0, col) => {
    g.fillStyle = col; g.fillRect(x0 * s, y0 * s, 6 * s, 6 * s);
    g.fillStyle = '#fffdf6'; g.fillRect((x0 + 1) * s, (y0 + 1) * s, 4 * s, 4 * s);
    g.fillStyle = col;
    for (const [dx, dy] of [[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]]) { g.beginPath(); g.arc((x0 + dx) * s, (y0 + dy) * s, s * 0.55, 0, 7); g.fill(); }
  };
  home(0, 0, RED); home(9, 0, GRN); home(9, 9, YEL); home(0, 9, BLU);
  const cell = (cx, cy, col) => { g.fillStyle = col || '#fffdf6'; g.fillRect(cx * s, cy * s, s, s); g.strokeStyle = '#2b2b2b'; g.lineWidth = 2; g.strokeRect(cx * s, cy * s, s, s); };
  for (let i = 0; i < 6; i++) for (let j = 6; j < 9; j++) { cell(i, j); cell(i + 9, j); cell(j, i); cell(j, i + 9); }
  for (let i = 1; i < 6; i++) { cell(i, 7, RED); cell(7, i, GRN); cell(14 - i, 7, YEL); cell(7, 14 - i, BLU); }
  cell(1, 6, RED); cell(8, 1, GRN); cell(13, 8, YEL); cell(6, 13, BLU);
  const tri = (pts, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0] * s, pts[0][1] * s); for (const p of pts.slice(1)) g.lineTo(p[0] * s, p[1] * s); g.closePath(); g.fill(); g.stroke(); };
  tri([[6, 6], [6, 9], [7.5, 7.5]], RED); tri([[6, 6], [9, 6], [7.5, 7.5]], GRN); tri([[9, 6], [9, 9], [7.5, 7.5]], YEL); tri([[6, 9], [9, 9], [7.5, 7.5]], BLU);
  g.strokeStyle = '#2b2b2b'; g.lineWidth = 4; g.strokeRect(2, 2, size - 4, size - 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
export function lighthouseTexture(aniso = 4) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : '#c8372d'; g.fillRect(0, i * 32, 64, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}
export function signTexture(text, bg, fg, neon = false) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = bg; g.beginPath(); g.roundRect(6, 6, 500, 148, 22); g.fill();
  g.lineWidth = 8; g.strokeStyle = neon ? '#ff4fd8' : 'rgba(255,255,255,0.85)'; g.stroke();
  g.font = 'bold 92px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (neon) { g.shadowColor = '#ff4fd8'; g.shadowBlur = 28; }
  g.fillStyle = fg; g.fillText(text, 256, 84, 460);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function makeTextures(aniso = 4) {
  const S = 256;
  const sand = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 8, 5, 1), gr = grain(x, y, 2), ripple = tfbm(u, v, 3, 2, 5);
    const k = 0.9 + 0.2 * gr;
    const c = mix([212, 182, 126], [240, 214, 158], n * 0.8 + ripple * 0.2);
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true, aniso);
  const grass = pixelTexture(S, (u, v, x, y) => {
    const n1 = tfbm(u, v, 6, 5, 3), n2 = tfbm(u, v, 48, 2, 4), gr = grain(x, y, 6);
    const c = mix([46, 84, 30], [102, 140, 50], n1);
    const k = 0.78 + 0.4 * n2 + (gr > 0.86 ? 0.25 : 0);
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true, aniso);
  const rock = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 5, 6, 8), crack = Math.abs(tfbm(u, v, 7, 4, 9) - 0.5) * 2;
    const c = mix([88, 84, 79], [152, 144, 132], n);
    const k = (crack < 0.07 ? 0.55 : 1) * (0.92 + 0.16 * grain(x, y, 10));
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true, aniso);
  const dirt = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 6, 5, 11), gr = grain(x, y, 12);
    const c = mix([92, 66, 44], [134, 102, 72], n);
    const k = 0.88 + 0.24 * gr;
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true, aniso);
  const leaf = pixelTexture(S, (u, v, x, y) => {
    const n = tfbm(u, v, 10, 4, 14), gr = grain(x, y, 15);
    const c = mix([32, 66, 22], [92, 128, 44], n);
    const k = 0.75 + 0.5 * gr * gr;
    return [c[0] * k, c[1] * k, c[2] * k];
  }, true, aniso);
  const noise = pixelTexture(S, (u, v) => { const n = Math.floor(tfbm(u, v, 8, 4, 17) * 255); return [n, n, n]; }, false, aniso);
  // water normal map from a tileable height field
  const hf = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hf[y * S + x] = tfbm(x / S, y / S, 8, 4, 19);
  const H = (x, y) => hf[((y + S) % S) * S + ((x + S) % S)];
  const waterNormal = pixelTexture(S, (u, v, x, y) => {
    const dx = (H(x - 1, y) - H(x + 1, y)) * 7, dy = (H(x, y - 1) - H(x, y + 1)) * 7;
    const l = Math.hypot(dx, dy, 1);
    return [(dx / l * 0.5 + 0.5) * 255, (dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  }, false, aniso);
  const frond = frondTexture(aniso);
  return { sand, grass, rock, dirt, leaf, noise, waterNormal, frond, ...townTextures(S, aniso) };
}