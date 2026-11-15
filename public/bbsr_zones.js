// The wider city: six more areas of Bhubaneswar, each its own walkable zone (a 1 km square) joined to the Old Town by auto-rickshaw.
// Pure data and layout (no graphics), so it can be tested in Node. Street lines and building positions are hand-drawn APPROXIMATIONS:
// the real places and their rough character are right, the exact geometry is not surveyed.
import { WORLD, EDGE } from './bbsr_plan.js';

export const ZONES = [
  { id: 'oldtown', room: 'bbsr', name: 'Old Town · Ekamra Kshetra', short: 'Old Town', icon: '\u{1F6D5}', km: 0, blurb: 'Lingaraja Temple, Bindusagar tank, Tala Bazaar' },
  { id: 'khandagiri', room: 'khandagiri', name: 'Khandagiri', short: 'Khandagiri', icon: '⛰️', km: 6, blurb: 'Rock-cut caves and a Jain temple on the hill' },
  { id: 'baramunda', room: 'baramunda', name: 'Baramunda', short: 'Baramunda', icon: '\u{1F68C}', km: 8, blurb: 'The ISBT bus terminal, the flyover and the market lane' },
  { id: 'jaydev', room: 'jaydev', name: 'Jaydev Vihar', short: 'Jaydev Vihar', icon: '\u{1F3E8}', km: 7, blurb: 'The big square, the flyover, hotels and malls' },
  { id: 'vanivihar', room: 'vanivihar', name: 'Vani Vihar (Bani Vihar)', short: 'Vani Vihar', icon: '\u{1F393}', km: 6, blurb: 'Utkal University gate and campus, the square' },
  { id: 'rasulgarh', room: 'rasulgarh', name: 'Rasulgarh', short: 'Rasulgarh', icon: '\u{1F3ED}', km: 7, blurb: 'The square and flyover, the Industrial Estate, the bazaar' },
  { id: 'patia', room: 'patia', name: 'Patia · Infocity', short: 'Patia · Infocity', icon: '\u{1F3E2}', km: 12, blurb: 'IT towers, Patia Square, the KIIT gate' },
];
export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));
export const zoneId = (s) => (ZONE_BY_ID[s] ? s : 'oldtown');
export const zoneRoom = (id) => (ZONE_BY_ID[id] || ZONE_BY_ID.oldtown).room;
export const ROOMS = ZONES.map((z) => z.room);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

// ---------- Khandagiri hill (a smooth ridge with a flat top) ----------
export const HILL = { cx: 0, cz: -140, rx: 240, rz: 170, H: 64 };
export function hillHeight(x, z) {
  const u = ((x - HILL.cx) / HILL.rx) ** 2 + ((z - HILL.cz) / HILL.rz) ** 2;
  if (u >= 1) return 0;
  const s = 1 - u;
  let h = HILL.H * Math.pow(s, 1.25);
  h += 1.6 * Math.sin(x * 0.06 + 1) * Math.sin(z * 0.05) * Math.min(1, s * 3);
  if (h > 44) h = 44 + 7 * Math.tanh((h - 44) / 7);          // a nearly flat summit
  return Math.max(0, h);
}
export const hillU = (x, z) => ((x - HILL.cx) / HILL.rx) ** 2 + ((z - HILL.cz) / HILL.rz) ** 2;
const HILL_PATH = [[0, 36], [70, 0], [-40, -45], [75, -95], [-45, -128], [0, -140]];
export { HILL_PATH };
// where the rock-cut caves are on the hill face: [angle from south, how far up the slope (u)]
const CAVES = [[-0.95, 0.62], [-0.58, 0.7], [-0.22, 0.58], [0.14, 0.74], [0.5, 0.64], [0.88, 0.7]];

const STALL_DEF = {
  dahibara: ['Dahibara-Aloodum', '#d9644a'], chhena: ['Chhena Poda', '#e0a440'], chai: ['Chai', '#6e4527'], flowers: ['Phula (flowers)', '#c8438a'],
  rasa: ['Pahala Rasagola', '#f2d9a0'], pan: ['Pan Shop', '#2f8f5a'], sweets: ['Sweets', '#d9644a'], bangles: ['Bangles', '#7a4fd0'],
};
const STALL_TEXT = {
  dahibara: 'Dahibara-aloodum: soft vada soaked in thin curd, with spiced potato curry. A Bhubaneswar breakfast.',
  chhena: 'Chhena poda: a cake of fresh cottage cheese baked slowly until the sugar caramelises.',
  chai: 'A cutting chai, very strong, very sweet. Every junction has one.',
  flowers: 'Marigold garlands. Fresh every morning.',
  rasa: 'Pahala rasagola: the soft, caramel-brown rasagola from the villages near Bhubaneswar.',
  pan: 'Pan, made your way. Meetha or saada?',
  sweets: 'Trays of sweets: rasagola, chhena jhili, khaja. Take your time.',
  bangles: 'Glass bangles in every colour.',
};
const PAL = [0xf4f0e6, 0xf4f0e6, 0xf2dfa0, 0xe8c27e, 0xf0b8b0, 0xb8dcc0, 0xa8c8e0, 0xd89070, 0xe9e2d2, 0xf7d3a0];
const ROOF = [0x7d7b76, 0x6d6a66, 0x8b5a3c, 0x9a6845];
const FLOORS = [1, 2, 2, 2, 3, 3, 3, 4];
const NPC_CFG = {
  ranjan: { g: 0, skin: 3, hs: 1, hc: 0, face: 2, top: 1, tc: 2, bot: 0, bc: 2, shoe: 1, acc: [0, 0, 0, 0, 0] },
  gopal: { g: 0, skin: 2, hs: 2, hc: 1, face: 1, top: 2, tc: 5, bot: 0, bc: 1, shoe: 0, acc: [0, 1, 0, 0, 0] },
  mitu: { g: 0, skin: 3, hs: 1, hc: 0, face: 3, top: 1, tc: 7, bot: 0, bc: 0, shoe: 1, acc: [0, 0, 0, 0, 0] },
  tapan: { g: 0, skin: 2, hs: 3, hc: 0, face: 2, top: 0, tc: 3, bot: 0, bc: 3, shoe: 2, acc: [0, 1, 0, 0, 0] },
  sanjay: { g: 0, skin: 3, hs: 2, hc: 1, face: 1, top: 2, tc: 1, bot: 0, bc: 2, shoe: 0, acc: [0, 0, 0, 0, 0] },
  priya: { g: 1, skin: 2, hs: 3, hc: 0, face: 1, top: 0, tc: 8, bot: 1, bc: 2, shoe: 2, acc: [0, 0, 0, 0, 0] },
};

export function buildZonePlan(id) {
  const build = BUILD[id];
  if (!build) throw new Error('unknown zone ' + id);
  const info = ZONE_BY_ID[id], rand = rng(hashStr(id));
  const plan = {
    zone: id, name: info.name, roads: [], lake: null, compound: null, gate: null, chai: null, temples: [], houses: [], awnings: [], lamps: [], benches: [], stalls: [], autos: [],
    pave: [], walls: [], boxes: [], circles: [], interactables: [], npcs: [], landmarks: [], trees: { palms: [], broad: [], pines: [], rocks: [] },
    hoardings: [], approx: [], tables: [], spawn: null, towers: [], arches: [], sheds: [], buses: [], trucks: [], flyovers: [], rounds: [], props: [],
    height: null, hill: null, spots: [], spotInfo: {}, travel: null, osm: false, groundAt: () => 0,
  };
  const ex = [];     // keep-clear rectangles {x0,z0,x1,z1}
  // the connector roads of the connected city arrive at the middle of each edge: keep a corridor free there
  for (const [a, b, c, d] of [[-26, -EDGE - 12, 26, -EDGE + 80], [-26, EDGE - 80, 26, EDGE + 12], [-EDGE - 12, -26, -EDGE + 80, 26], [EDGE - 80, -26, EDGE + 12, 26]]) ex.push({ x0: a, z0: b, x1: c, z1: d });
  let segs = [];
  const reindex = () => {
    segs = [];
    for (const r of plan.roads) for (let i = 0; i + 1 < r.pts.length; i++) segs.push({ ax: r.pts[i][0], az: r.pts[i][1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1], hw: r.w / 2, main: !!r.main });
  };
  const nearestRoad = (x, z) => {
    let best = { d: 1e9, hw: 0, main: false, tx: 1, tz: 0, px: x, pz: z };
    for (const s of segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      const t = clamp01(((x - s.ax) * dx + (z - s.az) * dz) / l2), px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz) - s.hw;
      if (d < best.d) { const l = Math.sqrt(l2); best = { d, hw: s.hw, main: s.main, tx: dx / l, tz: dz / l, px, pz }; }
    }
    return best;
  };
  plan.nearestRoad = nearestRoad;
  const H = {
    rand,
    road(name, w, main, pts) { plan.roads.push({ name, w, main, pts }); },
    ring(cx, cz, R, n = 40) { const p = []; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; p.push([cx + Math.cos(a) * R, cz + Math.sin(a) * R]); } return p; },
    clear(x0, z0, x1, z1) { ex.push({ x0, z0, x1, z1 }); },
    roundabout(cx, cz, R, name = 'Square') {
      plan.rounds.push({ x: cx, z: cz, R, r: R - 6.5 });
      H.road(name + ' ring', 9, true, H.ring(cx, cz, R));
      plan.circles.push({ x: cx, z: cz, r: R - 6.5, y0: -2, y1: 60 });
      ex.push({ x0: cx - R - 4, z0: cz - R - 4, x1: cx + R + 4, z1: cz + R + 4 });
    },
    tower(x, z, w, d, floors, o = {}) {
      const h = floors * 3.7 + 2, yaw = o.yaw || 0;
      plan.towers.push({ x, z, w, d, h, floors, yaw, kind: o.kind || 'glass', color: o.color });
      plan.boxes.push({ x, z, hw: w / 2, hd: d / 2, theta: yaw, y0: 0, y1: h + 2 });
    },
    flyover(x0, z0, x1, z1, w = 9, h = 7.5, ramp = 65) {
      const L = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / L, dz = (z1 - z0) / L, yaw = Math.atan2(-dz, dx);
      const fo = { x0, z0, x1, z1, w, h, ramp, L, dx, dz, yaw, piers: [] };
      plan.flyovers.push(fo);
      const hAt = (s) => (s < ramp ? (h * s) / ramp : L - s < ramp ? (h * (L - s)) / ramp : h);
      for (let s = 2; s < L; s += 4) {
        const y = hAt(s);
        plan.boxes.push({ x: x0 + dx * s, z: z0 + dz * s, hw: 2.1, hd: w / 2 + 0.3, theta: yaw, y0: y - 1.0, y1: y + 1.4 });
      }
      for (let s = 14; s < L - 8; s += 18) {          // a pier every 18 m wherever the deck is high enough to need one
        const y = hAt(s); if (y < 2.6) continue;
        const p = { x: x0 + dx * s, z: z0 + dz * s, h: y };
        fo.piers.push(p); plan.circles.push({ x: p.x, z: p.z, r: 0.95, y0: 0, y1: y });
      }
    },
    stall(key, x, z, yaw) {
      const [label, color] = STALL_DEF[key];
      plan.stalls.push({ x, z, yaw, color, label, key });
      plan.boxes.push({ x, z, hw: 1.6, hd: 1.2, theta: 0, y0: 0, y1: 2.6 });
      plan.interactables.push({ id: 'stall_' + key, type: 'stall', x, z, y: 0, radius: 3.0, dy: 2, label, text: STALL_TEXT[key] });
    },
    npc(nid, name, cfgKey, x, z, yaw, label, lines) {
      plan.npcs.push({ id: nid, name, cfg: NPC_CFG[cfgKey], x, z, yaw, label, lines });
      plan.circles.push({ x, z, r: 0.32, y0: 0, y1: 1.9 });
      plan.interactables.push({ id: 'talk_' + nid, type: 'npc', npc: nid, x, z, y: 0, radius: 3.2, dy: 1.7, label });
    },
    spot(sid, label, x, z, r, text, kind = 'town', xp = 25) {
      plan.spots.push({ id: sid, label, x, z, r, xp });
      plan.spotInfo[sid] = { label, text, xp };
      plan.landmarks.push({ name: label, kind, x, z });
    },
    stand(x, z, yaw = 0) {   // the auto stand: two autos, a sign post and the "take an auto" prompt
      plan.travel = { x, z, yaw };
      for (const dx of [-6.5, 6.5]) { plan.autos.push({ x: x + dx, z: z + 3, yaw: yaw + (dx < 0 ? 0.15 : -0.1) }); plan.boxes.push({ x: x + dx, z: z + 3, hw: 0.8, hd: 1.45, theta: yaw, y0: 0, y1: 1.7 }); }
      plan.circles.push({ x, z: z - 2.2, r: 0.3, y0: 0, y1: 3 });   // the sign post
      plan.interactables.push({ id: 'travel_stand', type: 'travel', x, z, y: 0, radius: 4.2, dy: 3, label: 'Take an auto to another area' });
      plan.landmarks.push({ name: 'Auto stand (travel)', kind: 'games', x, z });
      plan.spawn = { x, z: z + 7, yaw: Math.PI, r: 2.5 };
      ex.push({ x0: x - 12, z0: z - 6, x1: x + 12, z1: z + 12 });
    },
    free(x, z, r) {
      if (Math.abs(x) > 470 || Math.abs(z) > 470) return false;
      if (nearestRoad(x, z).d < r + 1) return false;
      for (const e of ex) if (x > e.x0 - r && x < e.x1 + r && z > e.z0 - r && z < e.z1 + r) return false;
      for (const b of plan.boxes) if (Math.abs(x - b.x) < b.hw + r + 0.8 && Math.abs(z - b.z) < b.hd + r + 0.8) return false;
      for (const q of plan.rounds) if (Math.hypot(x - q.x, z - q.z) < q.R + r + 2) return false;
      for (const p of plan.pave) if (x > p.x0 - r && x < p.x1 + r && z > p.z0 - r && z < p.z1 + r) return false;
      if (plan.hill && hillU(x, z) < 1.3) return false;
      return true;
    },
    scatter(o = {}) {          // houses and shops on a loose grid, away from everything else
      const cw = o.cw || 15.5, ch = o.ch || 13.5, rot = o.rot === undefined ? 0.12 : o.rot, cr = Math.cos(rot), sr = Math.sin(rot);
      const floorsPool = o.floors || FLOORS;
      for (let gz = -40; gz <= 40; gz++) for (let gx = -40; gx <= 40; gx++) {
        const u = gx * cw + (rand() - 0.5) * 2.4, v = gz * ch + (rand() - 0.5) * 2.4, x = u * cr - v * sr, z = u * sr + v * cr;
        const w = 8.5 + rand() * 4, d = 7.5 + rand() * 3, r = Math.hypot(w, d) / 2;
        if (rand() > (o.density ? o.density(x, z) : 0.7)) continue;
        if (!H.free(x, z, r)) continue;
        const nr = nearestRoad(x, z), shop = nr.main && nr.d < 9;
        let yaw = rot + (rand() - 0.5) * 0.08, fx = 0, fz = 0;
        if (shop) { yaw = Math.atan2(-nr.tz, nr.tx); const dl = Math.hypot(nr.px - x, nr.pz - z) || 1; fx = (nr.px - x) / dl; fz = (nr.pz - z) / dl; }
        const floors = floorsPool[Math.floor(rand() * floorsPool.length)], hh = floors * 3.2 + 0.5;
        plan.houses.push({ x, z, w, d, h: hh, floors, yaw, color: PAL[Math.floor(rand() * PAL.length)], roof: ROOF[Math.floor(rand() * ROOF.length)], pitched: !shop && rand() < 0.28, tank: rand() < 0.35 });
        plan.boxes.push({ x, z, hw: w / 2, hd: d / 2, theta: yaw, y0: 0, y1: hh + 1 });
        if (shop) plan.awnings.push({ x, z, w, d, yaw, fx, fz, color: [0xd9644a, 0xe0a440, 0x2f8f5a, 0x4a72c8, 0xc8438a, 0x7a4fd0][Math.floor(rand() * 6)] });
      }
    },
    lamps(spacing = 30) {
      for (const r of plan.roads) {
        if (!r.main) continue;
        let acc = 0;
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
          for (let s = (spacing - acc) % spacing; s < L; s += spacing) {
            const side = Math.round(s / spacing) % 2 ? 1 : -1, off = r.w / 2 + 1.2, x = ax + tx * s - tz * off * side, z = az + tz * s + tx * off * side;
            if (Math.abs(x) > 478 || Math.abs(z) > 478 || /ring$/.test(r.name)) continue;
            if (plan.rounds.some((q) => Math.hypot(x - q.x, z - q.z) < q.R + 6)) continue;
            if (plan.boxes.some((b) => Math.abs(b.x - x) < b.hw + 1 && Math.abs(b.z - z) < b.hd + 1 && Math.abs(b.theta) < 0.01 && b.y1 > 3)) continue;
            plan.lamps.push({ x, z });
          }
          acc = (acc + L) % spacing;
        }
      }
      plan.lamps.forEach((l) => plan.circles.push({ x: l.x, z: l.z, r: 0.25, y0: 0, y1: 5 }));
    },
    trees(o = {}) {
      const put = (x, z, kind) => {
        if (!H.free(x, z, 1.6)) return;
        const t = { x, y: 0, z, s: 0.9 + rand() * 0.5, a: rand() * Math.PI * 2, k: rand() };
        if (t.k < 0.04) t.k = 0.3;
        (kind === 'palm' ? plan.trees.palms : plan.trees.broad).push(t);
      };
      for (const r of plan.roads) {
        if (/ring$/.test(r.name)) continue;
        let acc = 0;
        for (let i = 0; i + 1 < r.pts.length; i++) {
          const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1], L = Math.hypot(bx - ax, bz - az), tx = (bx - ax) / L, tz = (bz - az) / L;
          for (let s = (14 - acc) % 14; s < L; s += (o.avenue ? 12 : 14) + rand() * 6) {
            const side = rand() < 0.5 ? 1 : -1, off = r.w / 2 + 3.2 + rand() * 1.5;
            put(ax + tx * s - tz * off * side, az + tz * s + tx * off * side, rand() < 0.22 ? 'palm' : 'broad');
          }
          acc = (acc + L) % 14;
        }
      }
      for (let i = 0; i < (o.fill === undefined ? 70 : o.fill); i++) put((rand() - 0.5) * 920, (rand() - 0.5) * 920, rand() < 0.3 ? 'palm' : 'broad');
      for (const g of o.groves || []) for (let i = 0; i < g.n; i++) put(g.x + (rand() - 0.5) * g.w, g.z + (rand() - 0.5) * g.d, rand() < 0.25 ? 'palm' : 'broad');
    },
    hoardings(zoneName) {
      const t = [zoneName.toUpperCase(), 'Find the auto stand to visit another part of Bhubaneswar'];
      [[0, -EDGE, 0], [0, EDGE, Math.PI], [-EDGE, 0, Math.PI / 2], [EDGE, 0, -Math.PI / 2]].forEach(([x, z, yaw], i) => {
        for (let k = -2; k <= 2; k++) plan.hoardings.push({ x: x + (i < 2 ? k * 120 : 0), z: z + (i < 2 ? 0 : k * 120), yaw, text: t, long: true });
      });
    },
    wallRing(cx, cz, hw, hd, gapSide, gapAt, gapW = 16, h = 4.5) {   // a compound wall with one gap in the given side ('e','w','n','s')
      const T = 0.75, wall = (x, z, a, b) => { plan.walls.push({ x, z, hw: a, hd: b, theta: 0, h, kind: 'wall' }); plan.boxes.push({ x, z, hw: a, hd: b, theta: 0, y0: 0, y1: h }); };
      const side = (s, fixed, lo, hi, horizontal) => {
        const g = gapSide === s;
        const seg = (a, b) => { if (b - a < 0.5) return; const c = (a + b) / 2, half = (b - a) / 2; horizontal ? wall(c, fixed, half, T) : wall(fixed, c, T, half); };
        if (!g) seg(lo, hi); else { seg(lo, gapAt - gapW / 2); seg(gapAt + gapW / 2, hi); }
      };
      side('n', cz - hd, cx - hw, cx + hw, true); side('s', cz + hd, cx - hw, cx + hw, true);
      side('w', cx - hw, cz - hd, cz + hd, false); side('e', cx + hw, cz - hd, cz + hd, false);
      ex.push({ x0: cx - hw - 6, z0: cz - hd - 6, x1: cx + hw + 6, z1: cz + hd + 6 });
    },
    arch(x, z, yaw, span, h, text) {
      plan.arches.push({ x, z, yaw, span, h, text });
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      for (const s of [-1, 1]) plan.boxes.push({ x: x + (s * span / 2) * cy, z: z - (s * span / 2) * sy, hw: 1.5, hd: 1.5, theta: 0, y0: 0, y1: h + 3 });   // the span runs along the arch's local x axis
    },
    finish() {
      reindex();
    },
    reindex, plan, ex,
  };
  build(plan, H);
  reindex();
  for (const p of plan.props) if (p.type === 'fountain' && !plan.rounds.some((r) => Math.hypot(r.x - p.x, r.z - p.z) < 1)) plan.circles.push({ x: p.x, z: p.z, r: p.r + 0.9, y0: 0, y1: 4 });
  if (!plan.spawn) plan.spawn = { x: 0, z: 0, yaw: 0, r: 4 };
  return plan;
}

// ---------------------------------------------------------------------------------------------------
const BUILD = {
  // ------------------------------------------------------------------ Khandagiri
  khandagiri(plan, H) {
    plan.hill = HILL; plan.height = hillHeight; plan.groundAt = hillHeight;
    const S = { x: 0, z: 250 };
    H.road('Nandankanan Road', 14, true, [[-500, 250], [-26, 250]]); H.road('Nandankanan Road', 14, true, [[26, 250], [500, 250]]);
    H.road('Cave Road', 10, true, [[0, 224], [0, 40]]); H.road('NH-16 south', 16, true, [[0, 276], [0, 500]]);
    H.road('Lane', 8, false, [[-200, 250], [-200, 470]]); H.road('Lane', 8, false, [[200, 250], [200, 470]]); H.road('Lane', 8, false, [[-120, 250], [-120, 110]]); H.road('Lane', 8, false, [[130, 250], [130, 120]]);
    H.roundabout(S.x, S.z, 24, 'Khandagiri Square');
    plan.pave.push({ x0: -26, z0: 34, x1: 26, z1: 64 });                      // the parking area at the foot of the caves
    H.clear(-26, 30, 26, 66);
    plan.props.push({ type: 'fountain', x: S.x, z: S.z, r: 6 });
    H.reindex();
    // caves, summit temple
    const sy = hillHeight(0, HILL.cz);
    plan.props.push({ type: 'jain', x: 0, z: HILL.cz, y: sy });
    plan.boxes.push({ x: 0, z: HILL.cz, hw: 6, hd: 6, theta: 0, y0: sy - 2, y1: sy + 16 });
    plan.caves = CAVES.map(([a, u], i) => {
      const x = HILL.cx + HILL.rx * Math.sqrt(u) * Math.sin(a), z = HILL.cz + HILL.rz * Math.sqrt(u) * Math.cos(a), g = hillHeight(x, z);
      const nx = (2 * (x - HILL.cx)) / HILL.rx ** 2, nz = (2 * (z - HILL.cz)) / HILL.rz ** 2, l = Math.hypot(nx, nz), yaw = Math.atan2(nx / l, nz / l);
      plan.boxes.push({ x, z, hw: 4.4, hd: 2.4, theta: yaw, y0: g - 4, y1: g + 7 });
      return { x, z, y: g, yaw, n: i + 1 };
    });
    // boulders and scrub on the hill
    for (let i = 0; i < 90; i++) {
      const a = H.rand() * Math.PI * 2, f = Math.sqrt(0.1 + 0.9 * H.rand()) * 0.97, x = HILL.cx + HILL.rx * f * Math.cos(a), z = HILL.cz + HILL.rz * f * Math.sin(a);
      if (plan.caves.some((c) => Math.hypot(c.x - x, c.z - z) < 14) || Math.hypot(x, z - HILL.cz) < 14) continue;
      if (HILL_PATH.some(([px, pz]) => Math.hypot(px - x, pz - z) < 12)) continue;
      plan.trees.rocks.push({ x, y: hillHeight(x, z), z, s: 1.2 + H.rand() * 2.4, a: H.rand() * 6.28, k: H.rand() });
    }
    for (let i = 0; i < 70; i++) {
      const a = H.rand() * Math.PI * 2, f = Math.sqrt(0.25 + 0.7 * H.rand()), x = HILL.cx + HILL.rx * f * Math.cos(a), z = HILL.cz + HILL.rz * f * Math.sin(a);
      if (hillU(x, z) >= 0.98 || HILL_PATH.some(([px, pz]) => Math.hypot(px - x, pz - z) < 8) || plan.caves.some((c) => Math.hypot(c.x - x, c.z - z) < 10) || Math.hypot(x, z - HILL.cz) < 12) continue;
      const t = { x, y: hillHeight(x, z), z, s: 0.8 + H.rand() * 0.5, a: H.rand() * 6.28, k: 0.3 + H.rand() * 0.4 };
      (H.rand() < 0.3 ? plan.trees.palms : plan.trees.broad).push(t);
    }
    H.stall('chhena', -46, 233, 0); H.stall('chai', 46, 233, 0); H.stall('pan', -46, 267, Math.PI); H.stall('dahibara', 46, 267, Math.PI);
    H.stand(-82, 266, 0);
    H.npc('ranjan', 'Ranjan · Cave guide', 'ranjan', 14, 52, -0.4, 'Talk to Ranjan', [
      'Namaskar! Welcome to Khandagiri. These caves were cut into the living rock over two thousand years ago.',
      'Khandagiri and its twin hill Udayagiri across the road have dozens of caves. Jain monks lived and meditated in them.',
      'Udayagiri has the famous Hathigumpha inscription. King Kharavela of Kalinga had it carved.',
      'There is a Jain temple at the very top. Take the path up the hill and look over the whole city.',
    ]);
    H.spot('kg_square', 'Khandagiri Square', 38, 250, 22, 'Khandagiri Square, where Nandankanan Road meets NH-16. The zoo is further along this road.', 'town');
    H.spot('kg_gate', 'Foot of the Caves', 0, 52, 14, 'The parking area at the foot of the hill. The path to the caves climbs from here.', 'temple');
    const c3 = plan.caves[2], c3o = 8;
    H.spot('kg_caves', 'The Caves', c3.x + Math.sin(c3.yaw) * c3o, c3.z + Math.cos(c3.yaw) * c3o, 12, 'Rock-cut cave cells with carved verandahs. They were homes and prayer halls of Jain monks.', 'temple', 35);
    H.spot('kg_summit', 'Summit Jain Temple', 0, HILL.cz + 11, 12, 'A small Jain temple stands on the summit. You can see the whole of Bhubaneswar from up here.', 'temple', 60);
    H.scatter({ density: (x, z) => 0.7 });
    H.lamps(32); H.trees({ fill: 40 });
    H.hoardings('Khandagiri');
  },

  // ------------------------------------------------------------------ Baramunda
  baramunda(plan, H) {
    H.road('NH-16', 24, true, [[0, -500], [0, 500]]); H.road('Baramunda Road', 14, true, [[-500, 40], [-12, 40]]); H.road('Baramunda Road', 14, true, [[12, 40], [500, 40]]);
    H.road('ISBT Road', 10, true, [[-13, -70], [-80, -70]]); H.road('Market Lane', 9, false, [[13, 120], [260, 120]]);
    H.road('Lane', 8, false, [[-200, 40], [-200, 400]]); H.road('Lane', 8, false, [[200, 40], [200, -300]]); H.road('Lane', 8, false, [[-300, 150], [-13, 150]]);
    H.flyover(0, -130, 0, 210, 9, 7.5, 65);
    plan.pave.push({ x0: -300, z0: -130, x1: -80, z1: -20 }); H.clear(-304, -134, -78, -16);
    plan.sheds.push({ x: -190, z: -122, w: 150, d: 12, h: 6, yaw: 0, kind: 'platform' });
    plan.boxes.push({ x: -190, z: -122, hw: 75, hd: 6, theta: 0, y0: 0, y1: 8 });
    const colors = [0xc0392b, 0x2f6f9f, 0x2e8b57, 0xd4a017, 0x8e44ad, 0xc0392b, 0x2f6f9f, 0xe67e22];
    colors.forEach((c, i) => { const x = -272 + i * 24; plan.buses.push({ x, z: -102, yaw: 0, color: c }); plan.boxes.push({ x, z: -102, hw: 1.4, hd: 5.4, theta: 0, y0: 0, y1: 3.4 }); });
    [-262, -238, -214, -190, -166, -142].forEach((x, i) => { const z = -60; plan.buses.push({ x, z, yaw: Math.PI, color: colors[(i + 3) % colors.length] }); plan.boxes.push({ x, z, hw: 1.4, hd: 5.4, theta: Math.PI, y0: 0, y1: 3.4 }); });
    H.arch(-82, -70, Math.PI / 2, 16, 6, 'BARAMUNDA ISBT');
    H.stall('sweets', 90, 111, 0); H.stall('rasa', 140, 111, 0); H.stall('dahibara', 115, 129, Math.PI); H.stall('bangles', 170, 129, Math.PI);
    H.stand(62, 66, 0);
    H.npc('gopal', 'Gopal · Bus conductor', 'gopal', -160, -42, 0.3, 'Talk to Gopal', [
      'Baramunda ISBT is the main bus terminal of Bhubaneswar. Buses leave from here for towns all over Odisha.',
      'Cuttack, Puri, Sambalpur, Berhampur: shout the name and somebody will point you to a bus.',
      'The flyover carries the highway above the crowded junction, so buses and autos can keep moving.',
    ]);
    H.spot('br_isbt', 'Baramunda ISBT', -160, -40, 18, 'The Baramunda bus terminal. Long-distance buses leave from the bays here.', 'games');
    H.spot('br_chhak', 'Baramunda Square', 20, 58, 22, 'Baramunda Square, where Baramunda Road crosses NH-16.', 'town');
    H.spot('br_flyover', 'Under the Flyover', 17, -105, 14, 'The flyover rises on pillars above the highway. Standing under it you can hear the traffic overhead.', 'town');
    H.spot('br_market', 'Market Lane', 140, 120, 18, 'A lane of small stalls just off the highway. Sweets, snacks, bangles.', 'town');
    H.scatter({ density: (x, z) => 0.72 });
    H.lamps(30); H.trees({ fill: 50 });
    H.hoardings('Baramunda');
  },

  // ------------------------------------------------------------------ Jaydev Vihar
  jaydev(plan, H) {
    H.road('NH-16', 22, true, [[0, -500], [0, -46]]); H.road('NH-16', 22, true, [[0, 46], [0, 500]]);
    H.road('Jaydev Vihar Road', 14, true, [[-500, 0], [-46, 0]]); H.road('Jaydev Vihar Road', 14, true, [[46, 0], [500, 0]]);
    H.road('Lane', 8, false, [[-200, 0], [-200, 300]]); H.road('Lane', 8, false, [[200, 0], [200, -300]]); H.road('Service Road', 8, false, [[-232, 0], [-232, -250]]); H.road('Service Road', 8, false, [[110, 0], [110, 250]]);
    H.roundabout(0, 0, 40, 'Jaydev Vihar Square');
    plan.props.push({ type: 'fountain', x: 0, z: 0, r: 9 });
    H.flyover(0, -310, 0, 310, 9, 7.5, 80);
    H.tower(112, -46, 30, 26, 9, { kind: 'glass' }); H.tower(160, 48, 28, 24, 8, { kind: 'glass' }); H.tower(234, -46, 32, 26, 11, { kind: 'glass' }); H.tower(272, 50, 30, 26, 7, { kind: 'glass' });
    H.tower(-135, -56, 70, 34, 4, { kind: 'concrete', color: 0xe0d2b4 });
    H.tower(-112, 54, 36, 26, 8, { kind: 'glass' }); H.tower(-165, 50, 30, 24, 6, { kind: 'concrete', color: 0xd9a58a });
    H.stall('chai', 66, 18, Math.PI); H.stall('pan', -66, 18, Math.PI); H.stall('dahibara', 66, -18, 0); H.stall('chhena', -66, -18, 0);
    H.stand(-60, -88, 0);
    H.npc('mitu', 'Mitu · Auto driver', 'mitu', -50, -78, -0.5, 'Talk to Mitu', [
      'Jaydev Vihar Square! One of the busiest junctions in the city. The flyover goes right over the circle.',
      'In the evening the hotels and restaurants fill up. People come here to eat and shop.',
      'If you want the caves, go to Khandagiri. Baramunda is closer if you want a bus.',
    ]);
    H.spot('jv_square', 'Jaydev Vihar Square', 62, 6, 20, 'Jaydev Vihar Square, a big roundabout with the highway flyover passing above it.', 'town');
    H.spot('jv_hotels', 'Hotel Row', 190, 0, 28, 'Hotels and restaurants line this stretch of the road.', 'town');
    H.spot('jv_mall', 'Shopping Block', -135, -2, 28, 'A big shopping block with a food court. Busy on weekends.', 'town');
    H.spot('jv_flyover', 'Flyover Ramp', 16, -150, 14, 'The flyover climbs on a long ramp to clear the square and the roads under it.', 'town');
    H.scatter({ density: (x, z) => 0.55 });
    H.lamps(30); H.trees({ fill: 60, avenue: true });
    H.hoardings('Jaydev Vihar');
  },

  // ------------------------------------------------------------------ Vani Vihar (Bani Vihar)
  vanivihar(plan, H) {
    H.road('NH-16', 22, true, [[0, -500], [0, -12]]); H.road('NH-16', 22, true, [[0, 12], [0, 500]]);
    H.road('Vani Vihar Road', 14, true, [[-90, 0], [-12, 0]]); H.road('Vani Vihar Road', 14, true, [[12, 0], [500, 0]]);
    H.road('Campus Road', 10, true, [[-90, 0], [-300, 0]]); H.road('Campus Loop', 8, false, [[-300, 0], [-300, -110], [-170, -110]]); H.road('Campus Loop', 8, false, [[-300, 0], [-300, 110], [-170, 110]]);
    H.road('Lane', 8, false, [[200, 0], [200, 300]]); H.road('Lane', 8, false, [[110, 0], [110, -300]]); H.road('Lane', 8, false, [[-400, 280], [-12, 280]]);
    H.flyover(0, -260, 0, 260, 9, 7.5, 70);
    H.wallRing(-265, 0, 175, 170, 'e', 0, 16);
    H.arch(-90, 0, Math.PI / 2, 18, 7, 'UTKAL UNIVERSITY');
    plan.props.push({ type: 'admin', x: -352, z: 0, yaw: Math.PI / 2, w: 44, d: 22 });
    plan.boxes.push({ x: -352, z: 0, hw: 11, hd: 22, theta: 0, y0: 0, y1: 22 });
    for (const [x, z] of [[-230, -110 - 28], [-230, 110 + 28], [-170, -28 - 40], [-170, 28 + 40], [-400, -80], [-400, 80]]) H.tower(x, z, 40, 14, 4, { kind: 'concrete', color: 0xe8dcc0 });
    H.tower(-250, -60, 24, 18, 3, { kind: 'concrete', color: 0xdcc8a0 });
    H.clear(-440, -170, -90, 170);
    H.stall('chai', -70, -22, 0); H.stall('pan', -70, 22, Math.PI); H.stall('rasa', -40, 22, Math.PI); H.stall('sweets', -40, -22, 0);
    H.stand(62, -72, 0);
    H.npc('tapan', 'Tapan · Student', 'tapan', -78, 12, -2.2, 'Talk to Tapan', [
      'This is Utkal University. It started in Cuttack in 1943 and later moved to Vani Vihar in Bhubaneswar.',
      'People say Vani Vihar and Bani Vihar both. The flyover is the way to the airport and the city.',
      'Come inside the gate in the evening. The lawns and the old trees are lovely when the lamps come on.',
    ]);
    H.spot('vv_gate', 'Utkal University Gate', -70, 0, 14, 'The main gate of Utkal University, one of the oldest universities of Odisha.', 'temple');
    H.spot('vv_admin', 'Administrative Building', -325, 0, 22, 'The old administrative building, with columns and a dome at the end of the campus road.', 'temple', 35);
    H.spot('vv_square', 'Vani Vihar Square', 24, 24, 24, 'Vani Vihar Square: the flyover above, the university gate along the road.', 'town');
    H.spot('vv_lawn', 'Campus Lawns', -235, -52, 26, 'Wide lawns and big old trees between the hostels and lecture halls.', 'town');
    H.scatter({ density: (x, z) => (x < -80 ? 0 : 0.62) });
    H.lamps(28);
    H.trees({ fill: 20, groves: [{ x: -250, z: -60, w: 120, d: 60, n: 30 }, { x: -250, z: 60, w: 120, d: 60, n: 30 }, { x: -200, z: 0, w: 90, d: 24, n: 14 }] });
    H.hoardings('Vani Vihar');
  },

  // ------------------------------------------------------------------ Rasulgarh
  rasulgarh(plan, H) {
    H.road('NH-16', 22, true, [[0, -500], [0, -12]]); H.road('NH-16', 22, true, [[0, 12], [0, 500]]);
    H.road('Rasulgarh Road', 14, true, [[-500, 0], [-12, 0]]); H.road('Rasulgarh Road', 14, true, [[12, 0], [500, 0]]);
    H.road('Industrial Estate Road', 10, true, [[-13, -125], [-440, -125]]); H.road('Bazaar Lane', 9, false, [[13, 60], [270, 60]]);
    H.road('Lane', 8, false, [[200, 0], [200, 300]]); H.road('Lane', 8, false, [[-200, 0], [-200, 300]]); H.road('Lane', 8, false, [[150, 60], [150, -200]]);
    H.flyover(0, -270, 0, 270, 9, 7.5, 75);
    for (let i = 0; i < 4; i++) for (const z of [-172, -78]) {
      const x = -380 + i * 80; plan.sheds.push({ x, z, w: 56, d: 24, h: 9, yaw: 0, kind: 'factory' }); plan.boxes.push({ x, z, hw: 28, hd: 12, theta: 0, y0: 0, y1: 11 });
    }
    plan.props.push({ type: 'chimney', x: -430, z: -150, h: 48 }); plan.circles.push({ x: -430, z: -150, r: 2.2, y0: 0, y1: 48 });
    plan.props.push({ type: 'chimney', x: -90, z: -150, h: 38 }); plan.circles.push({ x: -90, z: -150, r: 2.0, y0: 0, y1: 38 });
    H.clear(-440, -200, -80, -50);
    [[-340, -146, 0.1], [-250, -143, -0.05], [-170, -146, 0.12], [-300, -104, 0], [-210, -104, 0.05]].forEach(([x, z, yaw], i) => { plan.trucks.push({ x, z, yaw: yaw + Math.PI / 2, color: [0xc0392b, 0x2f6f9f, 0xd4a017, 0x2e8b57, 0xe67e22][i] }); plan.boxes.push({ x, z, hw: 5.2, hd: 1.4, theta: yaw, y0: 0, y1: 3.6 }); });
    H.arch(-100, -125, Math.PI / 2, 16, 6.5, 'INDUSTRIAL ESTATE');
    H.stall('rasa', 90, 51, 0); H.stall('sweets', 128, 51, 0); H.stall('bangles', 110, 69, Math.PI); H.stall('flowers', 170, 69, Math.PI);
    H.stand(72, -70, 0);
    H.npc('sanjay', 'Sanjay · Supervisor', 'sanjay', -120, -108, 0.8, 'Talk to Sanjay', [
      'Rasulgarh is an old industrial area. The Industrial Estate behind me has workshops and small factories.',
      'The trucks come in at dawn. By nine the whole road is full.',
      'The flyover takes the highway across the square. Under it the junction never sleeps.',
    ]);
    H.spot('rg_square', 'Rasulgarh Square', 22, 22, 24, 'Rasulgarh Square: the highway on its flyover, the junction below.', 'town');
    H.spot('rg_estate', 'Industrial Estate', -140, -108, 20, 'The Industrial Estate: rows of sheds, loading yards and chimneys.', 'games', 35);
    H.spot('rg_bazaar', 'Rasulgarh Bazaar', 130, 60, 18, 'A small bazaar lane with sweets and daily needs.', 'town');
    H.spot('rg_flyover', 'Flyover Ramp', 16, -150, 14, 'The long flyover ramp. The highway rises over the square and drops back down on the far side.', 'town');
    H.scatter({ density: (x, z) => (x < -60 && z < 0 ? 0 : 0.68) });
    H.lamps(30); H.trees({ fill: 40 });
    H.hoardings('Rasulgarh');
  },

  // ------------------------------------------------------------------ Patia / Infocity
  patia(plan, H) {
    H.road('Infocity Road', 18, true, [[0, 170], [0, -480]]); H.road('NH south', 18, true, [[0, 232], [0, 500]]);
    H.road('Patia Road', 14, true, [[-500, 200], [-32, 200]]); H.road('Patia Road', 14, true, [[32, 200], [500, 200]]);
    H.road('Lane', 8, false, [[-200, 200], [-200, 470]]); H.road('Lane', 8, false, [[160, 200], [160, 470]]); H.road('Campus Road', 10, true, [[240, 200], [405, 200]]);
    H.roundabout(0, 200, 30, 'Patia Square');
    plan.props.push({ type: 'fountain', x: 0, z: 200, r: 7 });
    const L = [[110, 44, 36, 10], [50, 40, 34, 14], [-20, 46, 38, 17], [-100, 42, 36, 12], [-190, 44, 36, 15], [-280, 40, 34, 9]];
    const R = [[100, 40, 34, 12], [30, 44, 36, 16], [-50, 42, 36, 18], [-140, 46, 38, 11], [-230, 40, 34, 13], [-330, 44, 36, 10]];
    for (const [z, w, d, f] of L) H.tower(-72, z, w, d, f, { kind: 'glass' });
    for (const [z, w, d, f] of R) H.tower(72, z, w, d, f, { kind: 'glass' });
    plan.pave.push({ x0: -130, z0: -400, x1: -24, z1: 150 }, { x0: 24, z0: -400, x1: 130, z1: 150 });
    plan.props.push({ type: 'fountain', x: -72, z: 80, r: 6 }, { type: 'fountain', x: 72, z: 66, r: 6 }, { type: 'fountain', x: -72, z: -62, r: 6 });
    H.clear(-130, -420, 130, 150);
    H.wallRing(350, 200, 110, 140, 'w', 200, 24, 4);
    H.arch(228, 200, Math.PI / 2, 26, 8, 'KIIT UNIVERSITY');
    for (const [x, z] of [[320, 110], [320, 290], [390, 110], [390, 290]]) H.tower(x, z, 50, 16, 6, { kind: 'concrete', color: 0xe3d3b0 });
    plan.props.push({ type: 'admin', x: 432, z: 200, yaw: -Math.PI / 2, w: 44, d: 22 });
    plan.boxes.push({ x: 432, z: 200, hw: 11, hd: 22, theta: 0, y0: 0, y1: 22 });
    H.stall('chai', -72, 183, 0); H.stall('dahibara', 72, 183, 0); H.stall('pan', -72, 217, Math.PI); H.stall('sweets', 72, 217, Math.PI);
    H.stand(-42, 252, 0);
    H.npc('priya', 'Priya · IT employee', 'priya', -52, 244, -0.6, 'Talk to Priya', [
      'Infocity is where many of the IT companies of Bhubaneswar have their offices. The towers glow all night.',
      'KIIT, the big university campus, is right here in Patia. Thousands of students walk through that gate every day.',
      'Lunch at the stalls on Patia Square is a ritual. Chai, a snack, back to the desk.',
    ]);
    H.spot('pt_square', 'Patia Square', 50, 200, 16, 'Patia Square: the road from the city meets Infocity Road and the road to KIIT.', 'town');
    H.spot('pt_infocity', 'Infocity', 0, -100, 40, 'Infocity: glass IT towers on both sides of a wide road, lit all night.', 'town', 40);
    H.spot('pt_fountain', 'Plaza Fountain', -90, 80, 14, 'A quiet plaza between the towers, with a fountain where people eat lunch.', 'town');
    H.spot('pt_kiit', 'KIIT Gate', 212, 200, 16, 'The gate of KIIT University, one of the largest campuses in Odisha.', 'temple');
    H.scatter({ density: (x, z) => (z < 230 ? (Math.abs(x) < 140 || x > 220 ? 0 : 0.35) : 0.62) });
    H.lamps(30); H.trees({ fill: 30, avenue: true });
    H.hoardings('Patia · Infocity');
  },
};
