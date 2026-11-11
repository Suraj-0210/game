// Procedural avatar: jointed stylised body, canvas-painted face with expressions, hair styles, outfits,
// accessories and a pose/animation system. No model files needed.

export const SKIN = [0xf6d3b8, 0xeab08a, 0xd09468, 0xa8683f, 0x7a4a2c, 0x4e2f1d];
export const HAIR = [0x1c1612, 0x3b2616, 0x6a4228, 0xd4b060, 0xa8481f, 0x9a9a9a, 0x2d6cdf, 0xe05a9a];
export const TOPS = [0x7b3fe4, 0x22252b, 0xb8bcc4, 0xd62f3a, 0xf4c20d, 0x1d6fd8, 0x2a9d4a, 0xf3f3f3, 0x1fb5a8, 0xf5822a, 0xe84393, 0x20356b];
export const BOTTOMS = [0x23262c, 0x3b3f47, 0x1f2f55, 0xa89a78, 0x3d5f94, 0xe8e8e8, 0x55603a, 0x6b4a32];
export const SHOES = [0xf2f2f2, 0x222222, 0xd62f3a, 0x1d6fd8, 0x7b3fe4, 0xf4c20d];
export const HAIR_NAMES = ['Crop', 'Quiff', 'Curly', 'Long', 'Ponytail', 'Bun'];
export const TOP_NAMES = ['Hoodie', 'Jacket', 'Tee'];
export const ACC = [
  { id: 'sun', name: 'Sunglasses', icon: '🕶️' }, { id: 'cap', name: 'Cap', icon: '🧢' }, { id: 'phones', name: 'Headphones', icon: '🎧' },
  { id: 'pack', name: 'Backpack', icon: '🎒' }, { id: 'crown', name: 'Crown', icon: '👑' },
];
export const PRESETS = [
  { name: 'Purple hoodie', top: 0, tc: 0, bot: 0, bc: 0, shoe: 0 }, { name: 'Black jacket', top: 1, tc: 1, bot: 0, bc: 1, shoe: 4 },
  { name: 'Grey hoodie', top: 0, tc: 2, bot: 0, bc: 2, shoe: 0 }, { name: 'Red jacket', top: 1, tc: 3, bot: 0, bc: 0, shoe: 0 },
  { name: 'Yellow jacket', top: 1, tc: 4, bot: 0, bc: 0, shoe: 1 },
];
export const EMOTE_DEFS = [
  { id: 1, name: 'Wave', icon: '👋' }, { id: 2, name: 'Dance', icon: '💃' }, { id: 3, name: 'Sit', icon: '🪑' },
  { id: 4, name: 'Clap', icon: '👏' }, { id: 5, name: 'Cheer', icon: '🙌' }, { id: 6, name: 'Point', icon: '👉' },
  { id: 7, name: 'Laugh', icon: '😂' }, { id: 8, name: 'Think', icon: '🤔' }, { id: 9, name: 'Sleep', icon: '😴' },
];
export const MAX_EMOTE = EMOTE_DEFS.length;
export const DEFAULT_AVATAR = { g: 0, skin: 1, hs: 1, hc: 0, face: 0, top: 0, tc: 0, bot: 0, bc: 0, shoe: 0, acc: [0, 0, 0, 0, 0] };

const ci = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
export function sanitizeAvatar(a) {
  a = a && typeof a === 'object' ? a : {};
  const acc = Array.isArray(a.acc) ? a.acc : [];
  return {
    g: ci(a.g, 0, 1, 0), skin: ci(a.skin, 0, SKIN.length - 1, 1), hs: ci(a.hs, 0, HAIR_NAMES.length - 1, 1), hc: ci(a.hc, 0, HAIR.length - 1, 0),
    face: ci(a.face, 0, 3, 0), top: ci(a.top, 0, 2, 0), tc: ci(a.tc, 0, TOPS.length - 1, 0), bot: ci(a.bot, 0, 1, 0),
    bc: ci(a.bc, 0, BOTTOMS.length - 1, 0), shoe: ci(a.shoe, 0, SHOES.length - 1, 0), acc: [0, 1, 2, 3, 4].map((i) => (acc[i] ? 1 : 0)),
  };
}
export const randomAvatar = () => sanitizeAvatar({
  g: Math.random() < 0.5 ? 0 : 1, skin: Math.floor(Math.random() * SKIN.length), hs: Math.floor(Math.random() * 6), hc: Math.floor(Math.random() * HAIR.length),
  face: Math.floor(Math.random() * 4), top: Math.floor(Math.random() * 3), tc: Math.floor(Math.random() * TOPS.length), bot: Math.random() < 0.25 ? 1 : 0,
  bc: Math.floor(Math.random() * BOTTOMS.length), shoe: Math.floor(Math.random() * SHOES.length), acc: [Math.random() < 0.2, Math.random() < 0.2, Math.random() < 0.2, Math.random() < 0.2, Math.random() < 0.05],
});

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const shade = (n, f) => (Math.min(255, ((n >> 16) & 255) * f) << 16) | (Math.min(255, ((n >> 8) & 255) * f) << 8) | Math.min(255, (n & 255) * f);

// ---------- face painting (equirectangular texture for the head sphere; the face sits at u = 0.75) ----------
export const FACE_W = 512, FACE_H = 256;
export function drawFace(ctx, cfg, expr) {
  const W = FACE_W, H = FACE_H, cx = W * 0.75, cy = H * 0.515;
  ctx.fillStyle = hex(SKIN[cfg.skin]); ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const dark = '#2a1c12', lipc = '#9a4036';
  const st = cfg.face;
  // cheeks + nose
  ctx.fillStyle = 'rgba(255,120,110,0.22)';
  for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * 42, cy + 20, 15, 9, 0, 0, 7); ctx.fill(); }
  ctx.strokeStyle = 'rgba(90,40,20,0.35)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(cx - 5, cy + 14); ctx.quadraticCurveTo(cx, cy + 20, cx + 5, cy + 14); ctx.stroke();
  // eyes
  const rx = [11, 12.5, 12.5, 13][st], ry = [13, 10, 8, 16][st], ir = [8.5, 8, 7.5, 10][st];
  const look = expr === 'think' ? [5, -4] : [0, 0];
  for (const s of [-1, 1]) {
    const ex = cx + s * 26, ey = cy;
    if (expr === 'sleep') { ctx.strokeStyle = dark; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(ex, ey - 3, 10, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke(); }
    else if (expr === 'laugh' || expr === 'cheer') { ctx.strokeStyle = dark; ctx.lineWidth = 4.5; ctx.beginPath(); ctx.arc(ex, ey + 4, 10, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    else {
      ctx.fillStyle = '#fbfbfb'; ctx.beginPath(); ctx.ellipse(ex, ey, rx, ry, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#4a2f1c'; ctx.beginPath(); ctx.arc(ex + look[0], ey + look[1] + 1, ir, 0, 7); ctx.fill();
      ctx.fillStyle = '#0b0b0e'; ctx.beginPath(); ctx.arc(ex + look[0], ey + look[1] + 1, ir * 0.55, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex + look[0] + 3, ey + look[1] - 3, 2.6, 0, 7); ctx.fill();
      if (st === 1) { ctx.strokeStyle = dark; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(ex + s * 8, ey - 8); ctx.lineTo(ex + s * 17, ey - 13); ctx.stroke(); } // lash flick
      if (st === 2) { ctx.fillStyle = hex(SKIN[cfg.skin]); ctx.fillRect(ex - 16, ey - ry - 2, 32, ry * 0.55); ctx.strokeStyle = dark; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(ex - 13, ey - ry * 0.4); ctx.lineTo(ex + 13, ey - ry * 0.4); ctx.stroke(); } // half-lidded
    }
    // eyebrows
    ctx.strokeStyle = dark; ctx.lineWidth = 5;
    const lift = expr === 'think' && s > 0 ? -9 : expr === 'cheer' || expr === 'laugh' ? -4 : 0;
    ctx.beginPath(); ctx.moveTo(ex - 13, ey - 21 + lift + (st === 2 ? 5 : 0)); ctx.quadraticCurveTo(ex, ey - 28 + lift, ex + 13, ey - 21 + lift + (s * 2)); ctx.stroke();
  }
  // mouth
  const my = cy + 36;
  if (expr === 'laugh' || expr === 'cheer') {
    ctx.beginPath(); ctx.moveTo(cx - 19, my - 3); ctx.quadraticCurveTo(cx, my + 36, cx + 19, my - 3); ctx.closePath();
    ctx.fillStyle = '#5a1c1c'; ctx.fill();
    ctx.save(); ctx.clip(); ctx.fillStyle = '#fff'; ctx.fillRect(cx - 22, my - 4, 44, 9); ctx.fillStyle = '#e0707a'; ctx.beginPath(); ctx.ellipse(cx, my + 17, 11, 7, 0, 0, 7); ctx.fill(); ctx.restore();
    ctx.strokeStyle = lipc; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx - 19, my - 3); ctx.quadraticCurveTo(cx, my + 36, cx + 19, my - 3); ctx.closePath(); ctx.stroke();
  } else if (expr === 'think') {
    ctx.fillStyle = '#7a2e28'; ctx.beginPath(); ctx.ellipse(cx + 8, my + 3, 6, 7, 0, 0, 7); ctx.fill();
  } else if (expr === 'sleep') {
    ctx.strokeStyle = lipc; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.moveTo(cx - 8, my + 2); ctx.quadraticCurveTo(cx, my + 7, cx + 8, my + 2); ctx.stroke();
  } else {
    const w = expr === 'happy' ? 17 : 13, d = expr === 'happy' ? 17 : 10;
    ctx.strokeStyle = lipc; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(cx - w, my); ctx.quadraticCurveTo(cx, my + d, cx + w, my); ctx.stroke();
  }
}
export function makeFaceCanvas(cfg, expr = 'neutral') {
  const c = document.createElement('canvas'); c.width = FACE_W; c.height = FACE_H;
  drawFace(c.getContext('2d'), cfg, expr);
  return c;
}
const EXPR = ['neutral', 'happy', 'happy', 'neutral', 'happy', 'cheer', 'happy', 'laugh', 'think', 'sleep'];

// ---------- the avatar ----------
const HIP = 0.948, SCALE = 0.92;
export function createAvatar(THREE, rawCfg, opts = {}) {
  const cfg = sanitizeAvatar(rawCfg), shadows = !!opts.shadows, fem = cfg.g === 1;
  const mat = (c, r = 0.7, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, envMapIntensity: 0.6, ...extra });
  const M = {
    skin: mat(SKIN[cfg.skin], 0.55), top: mat(TOPS[cfg.tc], 0.85), topDark: mat(shade(TOPS[cfg.tc], 0.72), 0.85), bottom: mat(BOTTOMS[cfg.bc], 0.9),
    shoe: mat(SHOES[cfg.shoe], 0.6), sole: mat(0xf4f4f4, 0.7), hair: mat(HAIR[cfg.hc], 0.55), dark: mat(0x15151a, 0.5), white: mat(0xf4f4f4, 0.7),
  };
  const faceTex = {}, hasDoc = typeof document !== 'undefined';
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, envMapIntensity: 0.6 });
  const setExpression = (name) => {
    if (!hasDoc) return;
    if (!faceTex[name]) { const t = new THREE.CanvasTexture(makeFaceCanvas(cfg, name)); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; faceTex[name] = t; }
    if (faceMat.map !== faceTex[name]) { faceMat.map = faceTex[name]; faceMat.needsUpdate = true; }
  };
  const add = (parent, geo, m, x = 0, y = 0, z = 0, s = null) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); if (s) o.scale.set(s[0], s[1], s[2]); o.castShadow = shadows; parent.add(o); return o; };
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body); body.position.y = HIP; root.scale.setScalar(SCALE);

  // torso + outfit
  const torso = new THREE.Group(); body.add(torso);
  const tw = fem ? 0.145 : 0.162;
  add(torso, new THREE.CapsuleGeometry(tw, 0.28, 6, 16), M.top, 0, 0.27, 0, [1, 1, 0.74]);
  add(body, new THREE.SphereGeometry(0.15, 16, 12), M.bottom, 0, -0.01, 0, [fem ? 1.1 : 1.02, 0.6, 0.78]);
  if (cfg.top === 0) { // hoodie: hood, pocket, strings, emblem
    add(torso, new THREE.SphereGeometry(0.125, 14, 10), M.topDark, 0, 0.55, 0.075, [1.15, 0.75, 0.8]);
    add(torso, new THREE.BoxGeometry(0.2, 0.085, 0.02), M.topDark, 0, 0.11, -0.112);
    for (const s of [-1, 1]) add(torso, new THREE.CylinderGeometry(0.007, 0.007, 0.12, 6), M.white, s * 0.035, 0.47, -0.105);
    add(torso, new THREE.BoxGeometry(0.075, 0.05, 0.012), M.white, 0, 0.32, -0.112);
  } else if (cfg.top === 1) { // jacket: collar, zip, hem band
    add(torso, new THREE.CylinderGeometry(0.085, 0.1, 0.06, 14, 1, true), M.topDark, 0, 0.56, 0, [1, 1, 0.9]);
    add(torso, new THREE.BoxGeometry(0.014, 0.5, 0.012), M.white, 0, 0.28, -0.112);
    add(torso, new THREE.CapsuleGeometry(tw + 0.005, 0.0, 4, 16), M.topDark, 0, 0.0, 0, [1, 1, 0.74]);
  }
  // arms
  const sx = fem ? 0.215 : 0.25, forearmM = cfg.top === 2 ? M.skin : M.top;
  const arm = (side) => {
    const sh = new THREE.Group(); sh.position.set(side * sx, 0.5, 0); body.add(sh);
    add(sh, new THREE.SphereGeometry(0.07, 12, 10), M.top);
    add(sh, new THREE.CapsuleGeometry(0.062, 0.17, 5, 12), M.top, 0, -0.14, 0);
    const el = new THREE.Group(); el.position.set(0, -0.265, 0); sh.add(el);
    add(el, new THREE.CapsuleGeometry(0.055, 0.15, 5, 12), forearmM, 0, -0.12, 0);
    if (cfg.top !== 2) add(el, new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), M.topDark, 0, -0.225, 0);
    add(el, new THREE.SphereGeometry(0.062, 12, 10), M.skin, 0, -0.27, 0);
    return { sh, el };
  };
  const armL = arm(-1), armR = arm(1);
  // legs
  const leg = (side) => {
    const hp = new THREE.Group(); hp.position.set(side * (fem ? 0.105 : 0.098), 0, 0); body.add(hp);
    add(hp, new THREE.CapsuleGeometry(0.084, 0.31, 5, 12), M.bottom, 0, -0.23, 0);
    const kn = new THREE.Group(); kn.position.set(0, -0.46, 0); hp.add(kn);
    add(kn, new THREE.CapsuleGeometry(0.073, 0.3, 5, 12), cfg.bot === 1 ? M.skin : M.bottom, 0, -0.22, 0);
    add(kn, new THREE.CapsuleGeometry(0.058, 0.17, 4, 10).rotateX(Math.PI / 2), M.shoe, 0, -0.435, -0.045, [1.15, 0.82, 1]);
    add(kn, new THREE.BoxGeometry(0.125, 0.026, 0.285), M.sole, 0, -0.475, -0.05);
    return { hp, kn };
  };
  const legL = leg(-1), legR = leg(1);
  // neck + head
  add(body, new THREE.CylinderGeometry(0.055, 0.06, 0.1, 10), M.skin, 0, 0.6, 0);
  const head = new THREE.Group(); head.position.set(0, 0.795, 0); head.scale.setScalar(1.13); body.add(head);
  add(head, new THREE.SphereGeometry(0.17, 32, 24), faceMat, 0, 0, 0, [1, 1.06, 1.02]);
  for (const s of [-1, 1]) add(head, new THREE.SphereGeometry(0.035, 10, 8), M.skin, s * 0.178, -0.01, 0.012, [0.5, 1, 0.8]);

  // hair
  const hairCap = (r, theta, y, z) => add(head, new THREE.SphereGeometry(r, 24, 16, 0, Math.PI * 2, 0, theta), M.hair, 0, y, z, [1, 1.06, 1.02]);
  const hs = cfg.hs;
  hairCap(0.179, hs === 3 ? 1.85 : 1.55, 0.012, 0.028);   // back + top
  hairCap(0.174, 0.98, 0.014, -0.002);                    // fringe line
  if (hs === 1) { add(head, new THREE.SphereGeometry(0.1, 14, 10), M.hair, 0.025, 0.185, -0.07, [1.1, 0.62, 1.05]); }
  if (hs === 2) {
    for (let i = 0; i < 22; i++) { // fibonacci spray of curls over the crown
      const y = 1 - (i / 21) * 0.95, rr = Math.sqrt(1 - y * y), a = i * 2.39996;
      const px = Math.cos(a) * rr, pz = Math.sin(a) * rr; if (pz < -0.55 && y < 0.55) continue;
      add(head, new THREE.SphereGeometry(0.06, 8, 7), M.hair, px * 0.17, y * 0.17 + 0.012, pz * 0.17 + 0.012);
    }
  }
  if (hs === 3) {
    add(head, new THREE.SphereGeometry(0.19, 16, 12), M.hair, 0, -0.16, 0.095, [0.95, 1.55, 0.55]);
    for (const s of [-1, 1]) add(head, new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), M.hair, s * 0.155, -0.1, -0.02);
  }
  if (hs === 4) {
    add(head, new THREE.CapsuleGeometry(0.04, 0.24, 4, 8), M.hair, 0, 0.0, 0.215).rotation.x = -0.5;
    add(head, new THREE.TorusGeometry(0.045, 0.012, 6, 14), M.dark, 0, 0.075, 0.18).rotation.x = 1.0;
  }
  if (hs === 5) add(head, new THREE.SphereGeometry(0.075, 12, 10), M.hair, 0, 0.205, 0.07);

  // accessories
  const acc = cfg.acc;
  if (acc[0]) { // sunglasses
    const glass = mat(0x0b0b10, 0.12, { metalness: 0.5 });
    for (const s of [-1, 1]) add(head, new THREE.BoxGeometry(0.07, 0.046, 0.012), glass, s * 0.056, -0.006, -0.172);
    add(head, new THREE.BoxGeometry(0.03, 0.01, 0.012), glass, 0, 0.004, -0.17);
    for (const s of [-1, 1]) add(head, new THREE.BoxGeometry(0.01, 0.01, 0.12), glass, s * 0.098, 0.004, -0.11);
  }
  if (acc[1]) { // cap
    const capM = mat(0x8b6b4a, 0.8);
    add(head, new THREE.SphereGeometry(0.186, 24, 12, 0, Math.PI * 2, 0, 1.34), capM, 0, 0.018, 0.006, [1, 1.0, 1.03]);
    add(head, new THREE.SphereGeometry(0.12, 16, 8), capM, 0, 0.065, -0.17, [1, 0.12, 0.95]);
  }
  if (acc[2]) { // headphones
    const hp = mat(0xe9e9f0, 0.4);
    add(head, new THREE.TorusGeometry(0.19, 0.013, 8, 28, Math.PI), hp, 0, 0.0, 0.0);
    for (const s of [-1, 1]) { const c = add(head, new THREE.CylinderGeometry(0.062, 0.062, 0.04, 18), hp, s * 0.19, -0.005, 0.0); c.rotation.z = Math.PI / 2; }
  }
  if (acc[4]) { // crown
    const gold = mat(0xf2b81c, 0.3, { metalness: 0.85, emissive: 0x3a2400 });
    add(head, new THREE.CylinderGeometry(0.115, 0.125, 0.05, 16, 1, true), gold, 0, 0.2 + (acc[1] ? 0.05 : 0), 0);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; add(head, new THREE.ConeGeometry(0.024, 0.075, 6), gold, Math.cos(a) * 0.12, 0.255 + (acc[1] ? 0.05 : 0), Math.sin(a) * 0.12); }
  }
  if (acc[3]) { // backpack
    const pk = mat(0x2d3436, 0.8);
    add(torso, new THREE.BoxGeometry(0.27, 0.35, 0.13), pk, 0, 0.3, 0.17);
    add(torso, new THREE.BoxGeometry(0.2, 0.12, 0.05), mat(0x3d4648, 0.8), 0, 0.2, 0.245);
    for (const s of [-1, 1]) add(torso, new THREE.BoxGeometry(0.035, 0.38, 0.03), pk, s * 0.1, 0.34, -0.065);
  }

  setExpression('neutral');
  const av = {
    group: root, cfg, phase: 0, expr: 'neutral', setExpression,
    j: { body, torso, head, shL: armL.sh, elL: armL.el, shR: armR.sh, elR: armR.el, hipL: legL.hp, knL: legL.kn, hipR: legR.hp, knR: legR.kn },
    dispose() {
      root.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); } });
      Object.values(M).forEach((m) => m.dispose());
      Object.values(faceTex).forEach((t) => t.dispose());
      faceMat.dispose();
    },
  };
  return av;
}

// ---------- animation ----------
// state: { moved (m this frame), dt, emote (0-9), t (seconds), air, swim, sitKind: 'bench' | 'ground' }
export function animateAvatar(av, s) {
  const { moved = 0, dt = 0.016, emote = 0, t = 0, air = false, swim = false, sitKind = 'ground' } = s;
  const J = av.j, k = 1 - Math.exp(-22 * Math.max(dt, 0.001)), sp = moved / Math.max(dt, 1e-3);
  av.phase += moved * 3.6;
  const a = Math.min(1.25, sp / 3.2), s1 = Math.sin(av.phase), c1 = Math.cos(av.phase);
  const P = { y: HIP, rx: 0, ry: 0, rz: 0, shLx: 0, shLz: -0.08, elLx: 0.12, elLz: 0, shRx: 0, shRz: 0.08, elRx: 0.12, elRz: 0, hLx: 0, hRx: 0, kLx: 0, kRx: 0, headX: 0, headY: 0, headZ: 0 };
  if (!swim && !air) {
    P.hLx = s1 * 0.62 * a; P.hRx = -s1 * 0.62 * a;
    P.kLx = -Math.max(0, c1) * 0.9 * a; P.kRx = -Math.max(0, -c1) * 0.9 * a;
    P.shLx = -s1 * 0.55 * a; P.shRx = s1 * 0.55 * a;
    P.elLx = P.elRx = 0.15 + 0.45 * a;
    P.rx = -Math.min(0.18, Math.max(0, (sp - 3.5) / 20)); P.ry = s1 * 0.08 * a;
    P.y = HIP + Math.abs(s1) * 0.035 * a;
  }
  if (air && !swim) { P.shLz = -0.9; P.shRz = 0.9; P.shLx = P.shRx = -0.3; P.hLx = 0.5; P.hRx = -0.2; P.kLx = -0.7; P.kRx = -0.3; }
  if (swim) {
    const ph = t * 3.5;
    P.rx = -1.25; P.y = 1.2 + Math.sin(t * 2) * 0.03;
    P.shLx = 2.6 + Math.sin(ph) * 1.0; P.shRx = 2.6 + Math.sin(ph + Math.PI) * 1.0; P.elLx = P.elRx = 0.15;
    P.hLx = Math.sin(ph * 2) * 0.35; P.hRx = -Math.sin(ph * 2) * 0.35; P.headX = 0.9;
  } else if (emote && !air) {
    const w = Math.sin(t * 6.5);
    switch (emote) {
      case 1: P.shRx = 0; P.shRz = 2.7; P.elRz = Math.sin(t * 10) * 0.55; P.elRx = 0.1; break;
      case 2: P.y += Math.abs(w) * 0.05; P.rz = Math.sin(t * 3.25) * 0.12; P.shLz = -(1.5 + w * 0.7); P.shRz = 1.5 - w * 0.7; P.shLx = P.shRx = 0; P.elLx = P.elRx = 0.4;
        P.hLx = w * 0.5; P.hRx = -w * 0.5; P.kLx = -Math.max(0, w) * 0.6; P.kRx = -Math.max(0, -w) * 0.6; P.headZ = Math.sin(t * 3.25) * 0.1; break;
      case 3: if (sitKind === 'bench') { P.y = 0.5; P.hLx = P.hRx = 1.5; P.kLx = P.kRx = -1.5; } else { P.y = 0.13; P.hLx = P.hRx = 1.55; P.kLx = P.kRx = -0.12; P.rx = -0.1; }
        P.shLx = P.shRx = 0.5; P.elLx = P.elRx = 1.0; break;
      case 4: { const c = Math.sin(t * 14) * 0.5 + 0.5; P.shLx = P.shRx = 1.1; P.shLz = 0.3 + c * 0.35; P.shRz = -(0.3 + c * 0.35); P.elLx = P.elRx = 1.45; break; }
      case 5: { const b = Math.abs(Math.sin(t * 8)); P.y += b * 0.12; P.shLz = -(2.6 + w * 0.12); P.shRz = 2.6 - w * 0.12; P.shLx = P.shRx = -0.2; P.elLx = P.elRx = 0.2; P.kLx = P.kRx = -b * 0.5; P.hLx = P.hRx = -b * 0.15; break; }
      case 6: P.shRx = 1.55; P.shRz = 0.1; P.elRx = 0.05; P.shLx = 0; P.shLz = -0.25; P.elLx = 1.4; P.headY = -0.2; break;
      case 7: P.rz = Math.sin(t * 24) * 0.035; P.rx = 0.15; P.headX = 0.3; P.shLx = P.shRx = 0.5; P.elLx = P.elRx = 1.5; P.y += Math.abs(Math.sin(t * 12)) * 0.02; break;
      case 8: P.shRx = 0.9; P.shRz = -0.35; P.elRx = 2.2; P.shLx = 0.5; P.shLz = 0.35; P.elLx = 1.7; P.headZ = 0.12; P.headY = 0.25; P.rz = Math.sin(t) * 0.015; break;
      case 9: P.rx = Math.PI / 2; P.y = 0.2 + Math.sin(t * 1.6) * 0.006; P.shLz = -0.18; P.shRz = 0.18; P.elLx = P.elRx = 0.1; break;
      default: break;
    }
  }
  const L = (o, key, v) => { o[key] += (v - o[key]) * k; };
  L(J.body.position, 'y', P.y); L(J.body.rotation, 'x', P.rx); L(J.body.rotation, 'y', P.ry); L(J.body.rotation, 'z', P.rz);
  L(J.shL.rotation, 'x', P.shLx); L(J.shL.rotation, 'z', P.shLz); L(J.elL.rotation, 'x', P.elLx); L(J.elL.rotation, 'z', P.elLz);
  L(J.shR.rotation, 'x', P.shRx); L(J.shR.rotation, 'z', P.shRz); L(J.elR.rotation, 'x', P.elRx); L(J.elR.rotation, 'z', P.elRz);
  L(J.hipL.rotation, 'x', P.hLx); L(J.hipR.rotation, 'x', P.hRx); L(J.knL.rotation, 'x', P.kLx); L(J.knR.rotation, 'x', P.kRx);
  L(J.head.rotation, 'x', P.headX); L(J.head.rotation, 'y', P.headY); L(J.head.rotation, 'z', P.headZ);
  J.torso.scale.y = 1 + Math.sin(t * 2.2) * 0.012;
  const ex = swim ? 'neutral' : EXPR[emote] || 'neutral';
  if (ex !== av.expr) { av.expr = ex; av.setExpression(ex); }
}