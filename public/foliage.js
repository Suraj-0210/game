// Procedural foliage textures with transparency (leaf clusters, needle sprays, ferns, grass, bark, cloud puffs).
import * as THREE from 'three';
import { tfbm, pixelTexture } from './textures.js';

function rng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function cardTex(w, h, draw, aniso) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round';
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
const rgb = (c, k = 1) => `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
function leaf(g, x, y, len, wid, ang, col) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(wid, len * 0.4, 0, len); g.quadraticCurveTo(-wid, len * 0.4, 0, 0);
  g.fillStyle = col; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, len * 0.9); g.stroke();
  g.restore();
}

export function makeFoliage(aniso = 4) {
  // broadleaf cluster: layers of leaves, dark behind, light in front
  const leaves = cardTex(256, 256, (g) => {
    const r = rng(11), pal = [[28, 68, 26], [48, 100, 34], [76, 128, 44], [104, 152, 58]];
    for (let layer = 0; layer < 4; layer++) {
      for (let i = 0; i < 34; i++) {
        const a = r() * 6.283, d = Math.sqrt(r()) * 104;
        const x = 128 + Math.cos(a) * d, y = 128 + Math.sin(a) * d, len = 34 + r() * 22, wid = 10 + r() * 7;
        leaf(g, x, y, len, wid, a + Math.PI / 2 + (r() - 0.5) * 1.4, rgb(pal[layer], 0.85 + r() * 0.3));
      }
    }
    g.strokeStyle = 'rgba(60,44,28,0.8)'; g.lineWidth = 2.5;
    for (let i = 0; i < 6; i++) { const a = r() * 6.283; g.beginPath(); g.moveTo(128, 128); g.lineTo(128 + Math.cos(a) * 40, 128 + Math.sin(a) * 40); g.stroke(); }
  }, aniso);
  // conifer needle spray: a twig with needles swept toward the tip
  const needles = cardTex(256, 128, (g) => {
    const r = rng(23);
    g.strokeStyle = 'rgb(84,62,40)'; g.lineWidth = 3; g.beginPath(); g.moveTo(6, 64); g.lineTo(250, 64); g.stroke();
    for (let x = 14; x < 244; x += 4.2) {
      for (const s of [-1, 1]) {
        const len = 22 + r() * 16 * (1 - x / 330), a = s * (0.7 + r() * 0.5);
        g.strokeStyle = rgb([22 + r() * 18, 62 + r() * 34, 38 + r() * 22]); g.lineWidth = 2 + r();
        g.beginPath(); g.moveTo(x, 64); g.lineTo(x + Math.cos(a) * len * 0.8, 64 + Math.sin(a) * len); g.stroke();
      }
    }
  }, aniso);
  // fern frond
  const fern = cardTex(128, 256, (g) => {
    const r = rng(37);
    g.strokeStyle = 'rgb(58,98,40)'; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 252); g.quadraticCurveTo(70, 130, 60, 8); g.stroke();
    for (let i = 0; i < 26; i++) {
      const t = i / 26, y = 246 - t * 232, x = 64 + Math.sin(t * 2.2) * 6, len = (1 - t) * 52 + 7;
      for (const s of [-1, 1]) {
        g.strokeStyle = rgb([48 + r() * 30, 108 + r() * 36, 40 + r() * 20]); g.lineWidth = 4.2 * (1 - t * 0.6);
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + s * len * 0.55, y - len * 0.4, x + s * len, y - len * 0.2 + 6); g.stroke();
      }
    }
  }, aniso);
  // grass blades
  const grass = cardTex(128, 128, (g) => {
    const r = rng(51);
    for (let i = 0; i < 11; i++) {
      const bx = 14 + r() * 100, tipx = bx + (r() - 0.5) * 46, tipy = 6 + r() * 70, w = 3.5 + r() * 3;
      const gr = g.createLinearGradient(0, 128, 0, tipy);
      gr.addColorStop(0, rgb([34, 78, 26], 0.8 + r() * 0.3)); gr.addColorStop(0.55, rgb([78, 128, 38], 0.85 + r() * 0.3)); gr.addColorStop(1, rgb([160, 190, 78], 0.9 + r() * 0.2));
      g.fillStyle = gr; g.beginPath(); g.moveTo(bx - w, 128); g.quadraticCurveTo(bx + (tipx - bx) * 0.2, 128 - (128 - tipy) * 0.6, tipx, tipy); g.quadraticCurveTo(bx + (tipx - bx) * 0.3 + w * 0.6, 128 - (128 - tipy) * 0.55, bx + w, 128); g.closePath(); g.fill();
    }
  }, aniso);
  // bark: wobbly vertical furrows (tileable)
  const bark = pixelTexture(256, (u, v, x, y) => {
    const wob = (tfbm(u, v, 3, 3, 61) - 0.5) * 5.5, fur = Math.abs(Math.sin(u * Math.PI * 2 * 9 + wob));
    const n = tfbm(u, v, 12, 3, 62), k = 0.45 + 0.55 * Math.pow(fur, 0.6);
    const l = 0.8 + 0.4 * n;
    return [(78 + 70 * k) * l * 0.82, (62 + 56 * k) * l * 0.82, (48 + 44 * k) * l * 0.82];
  }, true, aniso);
  bark.wrapS = bark.wrapT = THREE.RepeatWrapping;
  // palm trunk: ringed
  const palmBark = pixelTexture(256, (u, v) => {
    const ring = Math.pow(Math.abs(Math.sin(v * Math.PI * 2 * 10)), 0.5), n = tfbm(u, v, 8, 3, 63), streak = 0.9 + 0.2 * Math.sin(u * Math.PI * 2 * 7 + n * 3);
    const k = (0.55 + 0.45 * ring) * (0.85 + 0.3 * n) * streak;
    return [150 * k, 128 * k, 98 * k];
  }, true, aniso);
  // soft cloud puff
  const puff = cardTex(128, 128, (g) => {
    const r = rng(71);
    for (let i = 0; i < 46; i++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * 34, x = 64 + Math.cos(a) * d, y = 64 + Math.sin(a) * d * 0.8, rad = 16 + r() * 22;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,0.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, 7); g.fill();
    }
  }, aniso);
  return { leaves, needles, fern, grassBlades: grass, bark, palmBark, puff };
}