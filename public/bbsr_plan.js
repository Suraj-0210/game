// Bhubaneswar Old Town: the layout (pure data, no graphics, so it can also be tested in Node).
//
// Real anchors: Lingaraja Temple 20.23833 N 85.83361 E and Bindusagar 20.2421 N 85.8352 E (Wikipedia), Mahakala-Mahakali Temple 20 deg 14' 26" N 85 deg 50' 05" E (ASI).
// Everything else (street lines, house blocks, the tank's exact outline, the other shrines) is a hand-drawn APPROXIMATION in this alpha.
// tools/fetch_osm.mjs downloads the real streets and building outlines from OpenStreetMap and public/data/oldtown_osm.json then replaces the guesses.

import { finishRoad } from './bbsr_roads.js';
export const WORLD = 1000, HALF = WORLD / 2, EDGE = 488;
export const ORIGIN = { lat: 20.2400, lon: 85.8343 };   // (0, 0) of the game world
const M_LAT = 110574, M_LON = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180);
// x = east, z = south (so north is -z, as on the minimap)
export const project = (lat, lon) => ({ x: (lon - ORIGIN.lon) * M_LON, z: -(lat - ORIGIN.lat) * M_LAT });

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export const LINGARAJ = project(20.23833, 85.83361);           // the main tower
export const BINDUSAGAR = project(20.2421, 85.8352);           // centre of the tank
export const MAHAKALA = project(20.2406, 85.8347);

// ---- the sacred tank (a rounded rectangle, superellipse) ----
export const LAKE = { cx: BINDUSAGAR.x, cz: BINDUSAGAR.z, a: 200, b: 108, n: 3.2 };   // half-lengths in metres
export const lakeValue = (x, z, grow = 0) => Math.pow(Math.abs(x - LAKE.cx) / (LAKE.a + grow), LAKE.n) + Math.pow(Math.abs(z - LAKE.cz) / (LAKE.b + grow), LAKE.n);
export const inLake = (x, z, grow = 0) => lakeValue(x, z, grow) < 1;
// `count` points evenly spaced by arc length around the tank, `grow` metres outside the water's edge
export function lakeRing(grow, count) {
  const D = 6000, e = 2 / LAKE.n, dense = [], cum = [0];
  for (let i = 0; i <= D; i++) {
    const t = (i / D) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    dense.push([LAKE.cx + (LAKE.a + grow) * Math.sign(c) * Math.pow(Math.abs(c), e), LAKE.cz + (LAKE.b + grow) * Math.sign(s) * Math.pow(Math.abs(s), e)]);
    if (i) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  }
  const pts = [], total = cum[D];
  for (let k = 0, j = 0; k < count; k++) {
    const target = (k / count) * total;
    while (j < D - 1 && cum[j + 1] < target) j++;
    const f = (target - cum[j]) / ((cum[j + 1] - cum[j]) || 1);
    pts.push([dense[j][0] + (dense[j + 1][0] - dense[j][0]) * f, dense[j][1] + (dense[j + 1][1] - dense[j][1]) * f]);
  }
  return pts;
}

// ---- the Lingaraja compound (walled, entrance on the east) ----
export const COMPOUND = { cx: LINGARAJ.x + 28, cz: LINGARAJ.z, hw: 79, hd: 71 };
const WALL_T = 1.5, WALL_H = 5, GATE_W = 7;

const ROADS = [
  { name: 'Bindusagar Road', w: 13, main: true, pts: [[58, 500], [58, 262], [58, 185], [60, 60], [56, -60], [52, -106]] },
  { name: 'Old Town Main Road', w: 12, main: true, pts: [[-500, 300], [-250, 296], [0, 300], [250, 296], [500, 300]] },
  { name: 'Lingaraj Temple Road', w: 10, main: true, pts: [[35, 185], [58, 185]] },
  { name: 'South Lane', w: 8, pts: [[-300, 272], [-44, 272], [58, 272]] },
  { name: 'Temple North Lane', w: 8, pts: [[-200, 96], [-44, 96], [58, 96]] },
  { name: 'West Road', w: 10, main: true, pts: [[-170, 300], [-175, 100], [-165, -100], [-150, -232], [-130, -340]] },
  { name: 'West link', w: 8, pts: [[-150, -232], [-122, -232]] },
  { name: 'East Road', w: 10, main: true, pts: [[260, 300], [256, 100], [268, -60], [300, -150], [312, -232], [300, -330]] },
  { name: 'North Lane', w: 10, main: true, pts: [[-500, -380], [-250, -372], [0, -368], [250, -374], [500, -380]] },
  { name: 'Diagonal', w: 8, pts: [[258, 150], [170, 60], [110, -20], [60, -60]] },
];

export function buildPlan(osm = null) {
  const rand = rng(20261113);
  // real OpenStreetMap streets and buildings (from tools/fetch_osm.mjs) replace the hand-drawn ones when there are enough of them
  const OSM = osm && osm.roads && osm.roads.length >= 5 ? osm : null;
  // OpenStreetMap often maps the streets well but only a few buildings here: then the real streets are used and the houses are generated beside them
  const OSM_B = !!(OSM && OSM.buildings && OSM.buildings.length >= 50);
  const plan = {
    roads: [], lake: LAKE, compound: COMPOUND, temples: [], houses: [], awnings: [], lamps: [], benches: [], stalls: [], autos: [],
    pave: [],          // flat stone areas {x0,z0,x1,z1}
    walls: [],         // wall boxes {x,z,hw,hd,theta,h,kind}
    boxes: [], circles: [], interactables: [], npcs: [], landmarks: [], trees: { palms: [], broad: [], pines: [], rocks: [] },
    hoardings: [], approx: [], tables: [], spawn: null,
  };

  // ------------- roads -------------
  if (OSM) for (const r of OSM.roads) {
    // real streets, minus the stretches that would run across the tank or through the temple compound (those have their own paths)
    const keep = ([x, z]) => lakeValue(x, z, 1.5) >= 1 && !(Math.abs(x - COMPOUND.cx) < COMPOUND.hw + 3 && Math.abs(z - COMPOUND.cz) < COMPOUND.hd + 3);
    let run = [];
    const flush = () => { if (run.length >= 2) plan.roads.push({ name: r.name || 'road', w: r.w, main: !!r.main, pts: run }); run = []; };
    for (const pt of r.pts) { if (keep(pt)) run.push(pt); else flush(); }
    flush();
  }
  else for (const r of ROADS) plan.roads.push({ ...r });
  const ring = lakeRing(16, 96); ring.push(ring[0]);
  if (!OSM) plan.roads.push({ name: 'Tank Road', w: 8, main: true, pts: ring });
  plan.roads.forEach(finishRoad);
  const segs = [];
  for (const r of plan.roads) for (let i = 0; i + 1 < r.pts.length; i++) segs.push({ ax: r.pts[i][0], az: r.pts[i][1], bx: r.pts[i + 1][0], bz: r.pts[i + 1][1], hw: r.w / 2, main: !!r.main });
  function nearestRoad(x, z) {
    let best = { d: 1e9, hw: 0, main: false, tx: 1, tz: 0, px: x, pz: z };
    for (const s of segs) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      const t = clamp01(((x - s.ax) * dx + (z - s.az) * dz) / l2), px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz) - s.hw;
      if (d < best.d) { const l = Math.sqrt(l2); best = { d, hw: s.hw, main: s.main, tx: dx / l, tz: dz / l, px, pz }; }
    }
    return best;
  }
  plan.nearestRoad = nearestRoad;

  // ------------- the tank: embankment wall colliders along the water's edge -------------
  const edge = lakeRing(0.8, 2400);        // dense sampling, then one post every ~1.7 m of arc length (even spacing, no gaps)
  let acc = 0;
  for (let i = 0; i < edge.length; i++) {
    const p = edge[i], q = edge[(i + 1) % edge.length];
    acc += Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (acc >= 1.7) { plan.circles.push({ x: p[0], z: p[1], r: 1.35, y0: -50, y1: 50 }); acc = 0; }
  }
  plan.approx.push('Outline and size of Bindusagar (a rounded rectangle about 400 m x 215 m)');

  // ------------- Lingaraja compound -------------
  const C = COMPOUND, x0 = C.cx - C.hw, x1 = C.cx + C.hw, z0 = C.cz - C.hd, z1 = C.cz + C.hd;
  const wall = (x, z, hw, hd, h = WALL_H, kind = 'wall') => { plan.walls.push({ x, z, hw, hd, theta: 0, h, kind }); plan.boxes.push({ x, z, hw, hd, theta: 0, y0: 0, y1: h }); };
  // north and south walls (a gate gap in the middle), west wall solid, east wall with the main gate
  const gapW = GATE_W / 2;
  const hwall = (zc) => { const l = C.cx - gapW - x0; wall(x0 + l / 2, zc, l / 2, WALL_T / 2); const r = x1 - (C.cx + gapW); wall(C.cx + gapW + r / 2, zc, r / 2, WALL_T / 2); };
  hwall(z0); hwall(z1);
  wall(x0, C.cz, WALL_T / 2, C.hd + WALL_T / 2);
  const vwall = (xc) => { const l = C.cz - gapW - z0; wall(xc, z0 + l / 2, WALL_T / 2, l / 2); const r = z1 - (C.cz + gapW); wall(xc, C.cz + gapW + r / 2, WALL_T / 2, r / 2); };
  vwall(x1);
  // the east gatehouse (Simhadwara): two stone blocks, a bridge room above the passage, a stepped roof
  const gx = x1, gz = C.cz;
  plan.gate = { x: gx, z: gz, w: GATE_W };
  for (const s of [-1, 1]) plan.boxes.push({ x: gx, z: gz + s * (gapW + 2.5), hw: 3.2, hd: 2.5, theta: 0, y0: 0, y1: 10 });
  plan.pave.push({ x0: x0 + 2, z0: z0 + 2, x1: x1 - 2, z1: z1 - 2 }, { x0: x1, z0: gz - 12, x1: x1 + 62, z1: gz + 12 });
  plan.pave.push({ x0: 35, z0: 140, x1: 95, z1: 230 });              // plaza outside the gate

  // main temple buildings, west to east along the axis (z = tower centre): sanctum tower, porch, dance hall, offering hall
  const ax = LINGARAJ.x, az = LINGARAJ.z;
  plan.temples.push({ id: 'lingaraj', name: 'Lingaraja Temple', kind: 'major', x: ax, z: az, w: 24, h: 55, yaw: 0 });
  plan.boxes.push({ x: ax, z: az, hw: 12, hd: 12, theta: 0, y0: 0, y1: 60 });
  const hall = (id, dx, w, d, h, tiers) => { plan.temples.push({ id, kind: 'hall', x: ax + dx, z: az, w, d, h, tiers, yaw: 0 }); plan.boxes.push({ x: ax + dx, z: az, hw: w / 2, hd: d / 2, theta: 0, y0: 0, y1: h + 8 }); };
  hall('jagamohana', 20, 18, 17, 24, 6);
  hall('natamandira', 37, 14, 13, 14, 4);
  hall('bhogamandapa', 51, 12, 11, 11, 3);
  // ~26 small shrines along the inside of the walls and around the main tower
  const shrines = [];
  for (let x = x0 + 16; x < x1 - 14; x += 15) { if (Math.abs(x - C.cx) < 8) continue; shrines.push([x, z0 + 7, Math.PI]); shrines.push([x, z1 - 7, 0]); }
  for (let z = z0 + 22; z < z1 - 20; z += 17) { if (Math.abs(z - C.cz) < 12) continue; shrines.push([x0 + 7, z, -Math.PI / 2]); }
  shrines.push([ax - 22, az - 22, 0], [ax - 22, az + 22, Math.PI], [ax + 4, az - 24, 0], [ax + 4, az + 24, Math.PI]);
  shrines.forEach(([x, z, yaw], i) => {
    if (Math.hypot(x - ax, z - az) < 14) return;
    const h = 6 + rand() * 4.5, w = 3.2 + rand() * 1.4;
    plan.temples.push({ id: 'shrine' + i, kind: 'shrine', x, z, w, h, yaw });
    plan.boxes.push({ x, z, hw: w / 2 + 0.4, hd: w / 2 + 0.4, theta: 0, y0: 0, y1: h + 3 });
  });

  // other named temples (positions: Mahakala-Mahakali from the ASI listing, Ananta Vasudeva approximate)
  plan.temples.push({ id: 'mahakala', name: 'Mahakala-Mahakali Temple', kind: 'minor', x: MAHAKALA.x, z: MAHAKALA.z, w: 7, h: 15, yaw: -Math.PI / 2 });
  plan.boxes.push({ x: MAHAKALA.x, z: MAHAKALA.z, hw: 4.5, hd: 4.5, theta: 0, y0: 0, y1: 18 });
  const av = { x: LAKE.cx + LAKE.a + 42, z: LAKE.cz + 10 };
  plan.temples.push({ id: 'ananta', name: 'Ananta Vasudeva Temple', kind: 'minor', x: av.x, z: av.z, w: 9, h: 19, yaw: Math.PI / 2 });
  plan.boxes.push({ x: av.x, z: av.z, hw: 5.5, hd: 5.5, theta: 0, y0: 0, y1: 22 });
  plan.approx.push('Positions of every shrine except the Lingaraja main buildings and the Mahakala-Mahakali temple');
  plan.approx.push('Ananta Vasudeva Temple (it stands on the eastern bank of Bindusagar; exact spot not surveyed)');

  // ------------- Tala Bazaar market street (stalls on both sides of Bindusagar Road) -------------
  const STALLS = [
    ['Dahibara-Aloodum', '#d9644a', 'dahibara'], ['Chhena Poda', '#e0a440', 'chhena'], ['Chai', '#6e4527', 'chai'], ['Phula (flowers)', '#c8438a', 'flowers'],
    ['Pahala Rasagola', '#f2d9a0', 'rasa'], ['Pan Shop', '#2f8f5a', 'pan'], ['Sweets', '#d9644a', 'sweets'], ['Bangles', '#7a4fd0', 'bangles'],
  ];
  const stallZ = [-52, -22, 8, 38, 68, 98, 128, 158];
  stallZ.forEach((z, i) => {
    const side = i % 2 ? 1 : -1, x = 58 + side * 9.5, [label, color, key] = STALLS[i];
    plan.stalls.push({ x, z, yaw: side > 0 ? Math.PI / 2 : -Math.PI / 2, color, label, key });
    plan.boxes.push({ x, z, hw: 1.6, hd: 1.2, theta: 0, y0: 0, y1: 2.6 });
  });
  const stallText = {
    dahibara: 'Dahibara-aloodum: soft vada soaked in thin curd, with spiced potato curry. Hot, sour and loved at breakfast.',
    chhena: 'Chhena poda: a cake of fresh cottage cheese, baked slowly until the sugar caramelises. A speciality from Nayagarh.',
    chai: 'A cutting chai, very strong, very sweet. (Ludo at the chai adda by the tank is coming soon.)',
    flowers: 'Marigold garlands for the temple. Fresh every morning.',
    rasa: 'Pahala rasagola: the soft, caramel-brown rasagola from the villages near Bhubaneswar.',
    pan: 'Pan, made your way. Meetha or saada?',
    sweets: 'Trays of sweets: rasagola, chhena jhili, khaja. Take your time.',
    bangles: 'Glass bangles in every colour. They sound lovely in the rain.',
  };
  plan.stalls.forEach((s) => plan.interactables.push({ id: 'stall_' + s.key, type: 'stall', x: s.x, z: s.z, y: 0, radius: 3.0, dy: 2, label: s.label, text: stallText[s.key] }));

  // ------------- chai adda: a tea shed with Ludo tables on the tank-side promenade -------------
  const chai = { x: 150, z: -92 };
  plan.chai = chai;
  plan.pave.push({ x0: chai.x - 11, z0: chai.z - 6, x1: chai.x + 11, z1: chai.z + 7 });
  plan.boxes.push({ x: chai.x, z: chai.z - 5, hw: 8, hd: 0.6, theta: 0, y0: 0, y1: 3.2 });
  [[-6, 0.5], [6, 0.5]].forEach(([dx, dz]) => plan.tables.push({ x: chai.x + dx, z: chai.z + dz }));
  plan.tables.forEach((t, i) => {
    plan.boxes.push({ x: t.x, z: t.z, hw: 1.0, hd: 1.0, theta: 0, y0: 0, y1: 0.9 });
    plan.interactables.push({ id: 'ludo_chai_' + (i + 1), type: 'ludo', soon: true, x: t.x, z: t.z, y: 0, radius: 3.0, dy: 1.7, label: 'Play Ludo' });
  });

  // ------------- benches along the tank promenade, facing the water -------------
  const benchAt = (x, z, yaw) => { plan.benches.push({ x, z, yaw }); plan.interactables.push({ id: 'bench_' + plan.benches.length, type: 'sit', x, z, y: 0, yaw, radius: 1.9, label: 'Sit' }); };
  for (let x = LAKE.cx - 150; x <= LAKE.cx + 150; x += 50) { if (Math.abs(x - chai.x) < 22) continue; benchAt(x, LAKE.cz + LAKE.b + 4.6, 0); }          // south side, facing north
  for (let x = LAKE.cx - 150; x <= LAKE.cx + 150; x += 50) benchAt(x, LAKE.cz - LAKE.b - 4.6, Math.PI);                                              // north side, facing south
  for (const s of [-1, 1]) benchAt(LAKE.cx + s * (LAKE.a + 4.6), LAKE.cz, s > 0 ? Math.PI / 2 : -Math.PI / 2);                                         // ends
  plan.benches.forEach((b) => plan.boxes.push({ x: b.x, z: b.z, hw: 0.9, hd: 0.3, theta: 0, y0: 0, y1: 0.5, bench: true }));
  // (the bench box would block sitting; benches are walk-through for the sit action, so no collider is kept for them)
  plan.boxes = plan.boxes.filter((b) => !b.bench);

  // ------------- parked autos near the bazaar -------------
  [[40, 214, 0.3], [78, 214, -0.2], [40, 232, 0.1], [76, 244, 3.1], [74, -4, 1.6], [42, 28, -1.5], [120, -104, 0.05], [168, -104, 0.12]].forEach(([x, z, yaw]) => {
    plan.autos.push({ x, z, yaw });
    plan.boxes.push({ x, z, hw: 0.8, hd: 1.45, theta: yaw, y0: 0, y1: 1.7 });
  });

  // ------------- the town: houses on a lane grid, avoiding roads, tank, compound, plazas -------------
  const rot = 0.17, cr = Math.cos(rot), sr = Math.sin(rot);
  const noBuild = (x, z, r) => {
    if (Math.abs(x) > 462 || Math.abs(z) > 462) return true;
    const nr = nearestRoad(x, z); if (nr.d < r * 0.85 + 2.2) return true;
    if (lakeValue(x, z, 30 + r * 0.6) < 1) return true;
    if (x > x0 - 16 - r && x < x1 + 16 + r && z > z0 - 16 - r && z < z1 + 16 + r) return true;
    if ((Math.abs(z) < 30 + r && Math.abs(x) > 420) || (Math.abs(x) < 30 + r && Math.abs(z) > 420)) return true;   // corridors for the roads to the neighbouring areas
    if (x > 20 && x < 100 && z > 128 && z < 242) return true;                                        // plaza
    if (Math.abs(x - 58) < 16 + r && z > -112 && z < 168) return true;                                 // market street
    if (x > 128 - r && x < 172 + r && z > -112 - r && z < -74 + r) return true;                        // chai adda
    if (x > -335 && x < -205 && z > -115 && z < -15) return true;                                      // community ground
    for (const t of plan.temples) if (t.kind !== 'shrine' && t.kind !== 'hall' && t.id !== 'lingaraj' && Math.hypot(x - t.x, z - t.z) < 22 + r) return true;
    return false;
  };
  const PAL = [0xf4f0e6, 0xf4f0e6, 0xf2dfa0, 0xe8c27e, 0xf0b8b0, 0xb8dcc0, 0xa8c8e0, 0xd89070, 0xe9e2d2, 0xf7d3a0];
  const ROOF = [0x7d7b76, 0x6d6a66, 0x8b5a3c, 0x9a6845];
  const FLOORS = [1, 2, 2, 2, 3, 3, 3, 4];
  const cw = 15.5, ch = 13.5;
  if (!OSM_B) for (let gz = -40; gz <= 40; gz++) for (let gx = -40; gx <= 40; gx++) {
    const u = gx * cw + (rand() - 0.5) * 2.4, v = gz * ch + (rand() - 0.5) * 2.4;
    const x = u * cr - v * sr, z = u * sr + v * cr;
    const w = 8.5 + rand() * 4, d = 7.5 + rand() * 3;
    const dens = 0.9 - 0.32 * clamp01(Math.hypot(x, z) / 520);
    if (rand() > dens) continue;
    const r = Math.hypot(w, d) / 2;
    if (noBuild(x, z, r)) continue;
    const nr = nearestRoad(x, z), shop = nr.main && nr.d < 9;
    let yaw = rot + (rand() - 0.5) * 0.08, fx = 0, fz = 0;
    if (shop) { yaw = Math.atan2(-nr.tz, nr.tx); const dl = Math.hypot(nr.px - x, nr.pz - z) || 1; fx = (nr.px - x) / dl; fz = (nr.pz - z) / dl; }   // (fx, fz) points from the house to the street
    const floors = FLOORS[Math.floor(rand() * FLOORS.length)];
    const hh = floors * 3.2 + 0.5;
    const hs = { x, z, w, d, h: hh, floors, yaw, color: PAL[Math.floor(rand() * PAL.length)], roof: ROOF[Math.floor(rand() * ROOF.length)], pitched: !shop && rand() < 0.28, tank: rand() < 0.35 };
    plan.houses.push(hs);
    plan.boxes.push({ x, z, hw: w / 2, hd: d / 2, theta: yaw, y0: 0, y1: hh + 1 });
    if (shop) plan.awnings.push({ x, z, w, d, yaw, fx, fz, color: [0xd9644a, 0xe0a440, 0x2f8f5a, 0x4a72c8, 0xc8438a, 0x7a4fd0][Math.floor(rand() * 6)] });
  }

  // ------------- OpenStreetMap: real building footprints (as their smallest rectangles) and named temples -------------
  const osmLandmarks = [];
  if (OSM) {
    const named = plan.temples.filter((t) => t.kind !== 'shrine' && t.kind !== 'hall');
    for (const b of OSM.buildings) {
      if (Math.abs(b.x) > 480 || Math.abs(b.z) > 480) continue;
      const r = Math.hypot(b.w, b.d) / 2;
      if (b.x > x0 - 3 && b.x < x1 + 3 && b.z > z0 - 3 && b.z < z1 + 3) continue;                    // the compound has its own temples
      if (lakeValue(b.x, b.z, 2) < 1) continue;
      if (named.some((t) => Math.hypot(b.x - t.x, b.z - t.z) < 10 + r * 0.5)) continue;
      if (plan.boxes.some((q) => Math.hypot(b.x - q.x, b.z - q.z) < r * 0.85 + Math.hypot(q.hw, q.hd))) continue;   // stalls, autos, chai adda keep their spots
      const floors = b.floors > 0 ? Math.min(5, b.floors) : FLOORS[Math.floor(rand() * FLOORS.length)], hh = floors * 3.2 + 0.5, w = Math.min(b.w, 45), d = Math.min(b.d, 45);
      plan.houses.push({ x: b.x, z: b.z, w, d, h: hh, floors, yaw: b.yaw, color: PAL[Math.floor(rand() * PAL.length)], roof: ROOF[Math.floor(rand() * ROOF.length)], pitched: rand() < 0.28 && Math.min(w, d) < 14, tank: rand() < 0.35 });
      plan.boxes.push({ x: b.x, z: b.z, hw: w / 2, hd: d / 2, theta: b.yaw, y0: 0, y1: hh + 1 });
    }
    // named places of worship that are not already modelled become small shrines on the map
    let n = 0;
    for (const t of OSM.temples || []) {
      if (n >= 14 || Math.abs(t.x) > 470 || Math.abs(t.z) > 470 || lakeValue(t.x, t.z, 6) < 1) continue;
      if (x0 - 10 < t.x && t.x < x1 + 10 && z0 - 10 < t.z && t.z < z1 + 10) continue;
      if (named.some((q) => Math.hypot(t.x - q.x, t.z - q.z) < 40)) continue;
      n++;
      plan.temples.push({ id: 'osm' + n, name: t.name, kind: 'minor', x: t.x, z: t.z, w: 6, h: 12, yaw: 0 });
      plan.boxes.push({ x: t.x, z: t.z, hw: 4, hd: 4, theta: 0, y0: 0, y1: 15 });
      osmLandmarks.push({ name: t.name, kind: 'temple', x: t.x, z: t.z });
    }
  }
  plan.osm = !!OSM;

  // ------------- lamps along main roads and the tank promenade -------------
  for (const r of plan.roads) {
    if (!r.main) continue;
    let acc2 = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax2, az2] = r.pts[i], [bx2, bz2] = r.pts[i + 1], L = Math.hypot(bx2 - ax2, bz2 - az2), tx = (bx2 - ax2) / L, tz = (bz2 - az2) / L;
      for (let s = (30 - acc2) % 30; s < L; s += 30) {
        const side = (Math.round(s / 30) % 2) ? 1 : -1, off = r.w / 2 + 1.2;
        const x = ax2 + tx * s - tz * off * side, z = az2 + tz * s + tx * off * side;
        if (Math.abs(x) < 480 && Math.abs(z) < 480 && !inLake(x, z, 4) && !plan.boxes.some((b) => Math.abs(b.x - x) < b.hw + 1 && Math.abs(b.z - z) < b.hd + 1 && b.theta === 0)) plan.lamps.push({ x, z });
      }
      acc2 = (acc2 + L) % 30;
    }
  }
  plan.lamps.forEach((l) => plan.circles.push({ x: l.x, z: l.z, r: 0.25, y0: 0, y1: 5 }));

  // ------------- trees: along roads and the tank, a few in the courtyard, a grove on the community ground -------------
  const tree = (x, z, kind) => {
    if (Math.abs(x) > 480 || Math.abs(z) > 480 || inLake(x, z, 3) || nearestRoad(x, z).d < 1.5) return;
    if (plan.boxes.some((b) => Math.abs(x - b.x) < b.hw + 1.2 && Math.abs(z - b.z) < b.hd + 1.2 && Math.abs(b.theta) < 0.01)) return;
    if (plan.houses.some((h) => Math.hypot(x - h.x, z - h.z) < Math.max(h.w, h.d) * 0.75)) return;
    const t = { x, y: 0, z, s: 0.9 + rand() * 0.5, a: rand() * Math.PI * 2, k: rand() };
    if (kind === 'palm') plan.trees.palms.push(t); else plan.trees.broad.push(t);
  };
  for (const r of plan.roads) {
    let acc3 = 0;
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const [ax2, az2] = r.pts[i], [bx2, bz2] = r.pts[i + 1], L = Math.hypot(bx2 - ax2, bz2 - az2), tx = (bx2 - ax2) / L, tz = (bz2 - az2) / L;
      for (let s = (14 - acc3) % 14; s < L; s += 14 + rand() * 6) {
        const side = rand() < 0.5 ? 1 : -1, off = r.w / 2 + 3.2 + rand() * 1.5;
        tree(ax2 + tx * s - tz * off * side, az2 + tz * s + tx * off * side, rand() < 0.22 ? 'palm' : 'broad');
      }
      acc3 = (acc3 + L) % 14;
    }
  }
  for (let i = 0; i < 26; i++) { const t = (i / 26) * Math.PI * 2, p = lakeRing(10.5, 400)[Math.floor((i / 26) * 400)]; tree(p[0], p[1], i % 3 === 0 ? 'palm' : 'broad'); }
  for (let i = 0; i < 70; i++) tree(-335 + rand() * 130, -115 + rand() * 100, rand() < 0.2 ? 'palm' : 'broad');
  for (let i = 0; i < 14; i++) tree(C.cx - 60 + rand() * 90, C.cz + (rand() < 0.5 ? -1 : 1) * (14 + rand() * 36), 'broad');
  for (let i = 0; i < 40; i++) tree((rand() - 0.5) * 900, (rand() - 0.5) * 900, rand() < 0.3 ? 'palm' : 'broad');
  plan.trees.broad.forEach((t) => { if (t.k < 0.04) t.k = 0.3; });

  // ------------- people -------------
  const BISWA = { g: 0, skin: 3, hs: 2, hc: 0, face: 1, top: 1, tc: 4, bot: 0, bc: 3, shoe: 1, acc: [0, 0, 0, 0, 0] };
  const MAUSI = { g: 1, skin: 3, hs: 4, hc: 0, face: 1, top: 0, tc: 6, bot: 1, bc: 1, shoe: 2, acc: [0, 0, 0, 0, 0] };
  const SIBU = { g: 0, skin: 2, hs: 1, hc: 1, face: 3, top: 2, tc: 9, bot: 0, bc: 0, shoe: 0, acc: [0, 1, 0, 0, 0] };
  const people = [
    { id: 'biswa', name: 'Biswa · Local guide', cfg: BISWA, x: 66, z: 168, yaw: Math.PI / 2 + 0.6, label: 'Talk to Biswa', lines: [
      'Namaskar! Welcome to Ekamra Kshetra, the old heart of Bhubaneswar.',
      'That tower behind the wall belongs to the Lingaraja Temple. It was built in the 11th century and rises about 55 metres.',
      'Bhubaneswar is called the temple city. Once there were thousands of temples here, and many still stand around Bindusagar.',
      'Bindusagar, the big tank to the north, is said to hold a drop of water from every sacred river.',
      'Go and sit on a bench by the tank. In the evening it is the best seat in the city.',
    ] },
    { id: 'mausi', name: 'Mausi · Dahibara stall', cfg: MAUSI, x: 58 - 9.5, z: -52 + 3.4, yaw: -Math.PI / 2 + 0.2, label: 'Talk to Mausi', lines: [
      'Dahibara-aloodum, hot hot! Have you eaten yet?',
      'The vada has to soak in the curd water for just the right time. Too long and it falls apart.',
      'If it rains, come back. Dahibara tastes best on a wet evening.',
      'Try the chhena poda two stalls down. Tell them Mausi sent you.',
    ] },
    { id: 'sibu', name: 'Sibu · Chai adda', cfg: SIBU, x: chai.x, z: chai.z - 3.4, yaw: 0, label: 'Talk to Sibu (delivery jobs)', lines: [
      'Chai? Sit, sit. The tables are for Ludo. We are getting it ready.',
      'Four players, one board, and a lot of shouting. That is how Ludo should be.',
      'Watch out for rain: it comes at the same time every afternoon. Everybody runs under the shed.',
    ] },
  ];
  people.forEach((p) => {
    plan.npcs.push(p);
    plan.circles.push({ x: p.x, z: p.z, r: 0.32, y0: 0, y1: 1.9 });
    plan.interactables.push({ id: 'talk_' + p.id, type: 'npc', npc: p.id, x: p.x, z: p.z, y: 0, radius: 3.2, dy: 1.7, label: p.label });
  });

  // ------------- edges of the playable area -------------
  const HO = [['CHAPTER 1 · OLD TOWN', 'More of the city: take an auto from the plaza stand'], ['CHAPTER 1 · OLD TOWN', 'Khandagiri · Baramunda · Jaydev Vihar · Vani Vihar'], ['CHAPTER 1 · OLD TOWN', 'Rasulgarh · Patia · Infocity: all by auto'], ['CHAPTER 1 · OLD TOWN', 'The auto stand is on the plaza outside the Lingaraja gate']];
  [[0, -EDGE, 0], [0, EDGE, Math.PI], [-EDGE, 0, Math.PI / 2], [EDGE, 0, -Math.PI / 2]].forEach(([x, z, yaw], i) => {
    for (let k = -2; k <= 2; k++) {
      const px = x + (i < 2 ? k * 120 : 0), pz = z + (i < 2 ? 0 : k * 120);
      plan.hoardings.push({ x: px, z: pz, yaw, text: HO[i], long: true });
    }
  });

  // the auto stand on the plaza: the way to the other areas of the city
  plan.travel = { x: 60, z: 214, yaw: 0 };
  plan.circles.push({ x: 60, z: 211.8, r: 0.3, y0: 0, y1: 3 });
  plan.interactables.push({ id: 'travel_stand', type: 'travel', x: 60, z: 214, y: 0, radius: 4.2, dy: 3, label: 'Take an auto to another area' });
  plan.landmarks.push({ name: 'Auto stand (travel)', kind: 'games', x: 60, z: 214 });
  plan.spawn = { x: 86, z: 186, yaw: Math.PI / 2, r: 7 };   // on the plaza, looking west through the gate at the tower
  plan.landmarks = [
    { name: 'Lingaraja Temple', kind: 'temple', x: LINGARAJ.x, z: LINGARAJ.z },
    { name: 'Bindusagar', kind: 'lake', x: LAKE.cx, z: LAKE.cz },
    { name: 'Mahakala-Mahakali Temple', kind: 'temple', x: MAHAKALA.x, z: MAHAKALA.z },
    { name: 'Ananta Vasudeva Temple (approx.)', kind: 'temple', x: av.x, z: av.z },
    { name: 'Tala Bazaar', kind: 'town', x: 58, z: 50 },
    { name: 'Chai adda', kind: 'games', x: chai.x, z: chai.z },
    ...osmLandmarks,
  ];
  plan.groundAt = () => 0;
  return plan;
}
