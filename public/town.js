// Beach town layout. Pure data (no rendering) so it can be tested and shared.
// Town-local axes: +z points out to sea, +x is to the right when facing the sea. y is absolute (world).
import { hash3 } from './island.js';

export const FLATTEN = { r0: 38, r1: 74 };
const FRONT = 14;                 // z of building fronts
const PROM = { z0: 14, z1: 25 };  // promenade deck spans z0..z1

export function planTown(terrain, site) {
  const { x: cx, z: cz, theta } = site;
  const sinT = Math.sin(theta), cosT = Math.cos(theta);
  const toW = (lx, lz) => ({ x: cx + lx * cosT + lz * sinT, z: cz - lx * sinT + lz * cosT });
  const gh = (lx, lz) => { const p = toW(lx, lz); return terrain.height(p.x, p.z); };

  let shoreZ = 20;
  while (shoreZ < 140 && gh(0, shoreZ) > 0.15) shoreZ++;
  const deckY = site.h0 + 0.12;
  const endZ = Math.max(shoreZ + 34, 62);

  const plan = {
    site, theta, toW, gh, shoreZ, deckY, endZ,
    buildings: [], decks: [], boxes: [], circles: [], interactables: [], palms: [],
    benches: [], lamps: [], umbrellas: [], crates: [], boats: [], landmarks: [], exclusions: [],
    ludo: null, lighthouse: null,
  };
  const addBox = (lx, lz, hw, hd, y0 = -1e9, y1 = 1e9) => { const p = toW(lx, lz); plan.boxes.push({ x: p.x, z: p.z, hw, hd, theta, y0, y1 }); };
  const addCircle = (lx, lz, r, y0 = -1e9, y1 = 1e9) => { const p = toW(lx, lz); plan.circles.push({ x: p.x, z: p.z, r, y0, y1 }); };
  const addDeck = (lx, lz, hw, hd, y) => { const p = toW(lx, lz); plan.decks.push({ x: p.x, z: p.z, hw, hd, theta, y }); };

  // ---- buildings along the promenade ----
  const defs = [
    { id: 'rentals', sign: 'RENTALS', x: -30, w: 8, d: 7, h: 4.2, wall: 0xe8836b, roof: 0x4a5560, label: 'Rent a board', },
    { id: 'cafe', sign: 'CAFE', x: -18, w: 9, d: 8, h: 4.6, wall: 0xf2e6cf, roof: 0xb5532f, awning: [0xd63031, 0xffffff], label: 'Order a drink', chimney: true },
    { id: 'games', sign: 'PLAY', x: -3, w: 12, d: 9, h: 5.4, wall: 0x2fb5a8, roof: 0x2d3a4a, neon: true, label: 'Games hall' },
    { id: 'shop', sign: 'SHOP', x: 12, w: 9, d: 8, h: 4.6, wall: 0xf0c24f, roof: 0xb5532f, awning: [0x0984e3, 0xffffff], label: 'Open shop' },
    { id: 'hotel', sign: 'HOTEL', x: 26, w: 11, d: 9, h: 7.6, wall: 0x9fc9e8, roof: 0xb5532f, floors: 2, label: 'Check in' },
  ];
  for (const b of defs) {
    const z = FRONT - b.d / 2;
    plan.buildings.push({ ...b, z, y: deckY });
    addBox(b.x, z, b.w / 2 + 0.1, b.d / 2 + 0.1, deckY - 2.5, deckY + b.h + 0.28 * b.d + 0.4);
    const door = toW(b.x, FRONT + 1.4);
    plan.interactables.push({ id: 'door_' + b.id, type: 'shop', soon: true, x: door.x, z: door.z, y: deckY, radius: 2.4, label: b.label });
  }

  // ---- decks (also used as walkable surfaces) ----
  addDeck(0, (PROM.z0 + PROM.z1) / 2, 37, (PROM.z1 - PROM.z0) / 2, deckY);               // promenade
  addDeck(0, (PROM.z1 + endZ) / 2, 2, (endZ - PROM.z1) / 2 + 0.2, deckY);                  // pier
  addDeck(0, endZ - 4, 5, 4, deckY);                                                       // pier end platform
  plan.pier = { z0: PROM.z1, z1: endZ, hw: 2 };
  plan.promenade = { z0: PROM.z0, z1: PROM.z1, hw: 37 };

  // ---- benches (sit spots) facing the sea ----
  for (const bx of [-24, -10, 10, 24]) {
    const p = toW(bx, 24), b = { x: bx, z: 24, y: deckY };
    plan.benches.push(b);
    addBox(bx, 24, 0.9, 0.35, deckY, deckY + 0.95);
    plan.interactables.push({ id: 'bench_' + bx, type: 'sit', x: p.x, z: p.z, y: deckY, yaw: theta + Math.PI, radius: 1.9, label: 'Sit' });
  }

  // ---- lamp posts ----
  for (const lx of [-33, -22, -11, 11, 22, 33]) { plan.lamps.push({ x: lx, z: 24.7, y: deckY }); addCircle(lx, 24.7, 0.2, deckY, deckY + 3.6); }
  for (let lz = PROM.z1 + 6; lz < endZ - 6; lz += 12) for (const sx of [-1.85, 1.85]) { plan.lamps.push({ x: sx, z: lz, y: deckY }); addCircle(sx, lz, 0.2, deckY, deckY + 3.6); }
  for (const sx of [-4, 4]) { plan.lamps.push({ x: sx, z: endZ - 1, y: deckY }); addCircle(sx, endZ - 1, 0.2, deckY, deckY + 3.6); }

  // ---- Ludo table ----
  plan.ludo = { x: -3, z: 19.5, y: deckY };
  addCircle(-3, 19.5, 1.7, deckY, deckY + 0.95);
  const stoolSpots = [[-3, 19.5 - 1.95], [-3 + 1.95, 19.5], [-3, 19.5 + 1.95], [-3 - 1.95, 19.5]];
  stoolSpots.forEach(([sx, sz]) => addCircle(sx, sz, 0.35, deckY, deckY + 0.5));
  const lp = toW(-3, 19.5);
  plan.interactables.push({ id: 'ludo_table', type: 'ludo', soon: true, x: lp.x, z: lp.z, y: deckY, radius: 3.4, label: 'Play Ludo' });

  // ---- pier railings and support posts are solid (rails are too tall to hop over) ----
  {
    const pz0 = PROM.z1, railTop = deckY + 1.3, sideLen = endZ - 8 - pz0;
    for (const sx of [-1.95, 1.95]) addBox(sx, pz0 + sideLen / 2, 0.1, sideLen / 2, deckY, railTop);
    for (const sx of [-4.95, 4.95]) addBox(sx, endZ - 4, 0.1, 4, deckY, railTop);
    addBox(0, endZ, 5, 0.1, deckY, railTop);
    for (let lz = pz0 + 2; lz <= endZ; lz += 4) for (const sx of [-1.85, 1.85]) addCircle(sx, lz, 0.2, -60, deckY - 0.2);
    for (const sx of [-4.9, 4.9]) for (const lz of [endZ - 7.5, endZ - 0.5]) addCircle(sx, lz, 0.2, -60, deckY - 0.2);
  }

  // ---- fishing spot at the end of the pier ----
  const fp = toW(0, endZ - 3);
  plan.interactables.push({ id: 'fish_pier', type: 'fish', soon: true, x: fp.x, z: fp.z, y: deckY, radius: 3.6, label: 'Fish' });
  [[-3.2, endZ - 1.5], [3.4, endZ - 5.5], [-3.6, endZ - 6.2]].forEach(([x, z], i) => { plan.crates.push({ x, z, y: deckY, s: i === 2 ? 0.55 : 0.75 }); addBox(x, z, i === 2 ? 0.3 : 0.4, i === 2 ? 0.3 : 0.4, deckY, deckY + (i === 2 ? 0.55 : 0.75)); });

  // ---- beach umbrellas + loungers on the sand ----
  const colors = [0xe63946, 0x1d8fe1, 0xf4c20d, 0x2a9d4a, 0xe84393, 0xff8c42];
  [-27, -17, -8, 8, 17, 27].forEach((ux, i) => {
    const uz = PROM.z1 + 5 + (i % 2) * 2.5, g = gh(ux, uz);
    if (g > 0.25) { plan.umbrellas.push({ x: ux, z: uz, y: g, color: colors[i % colors.length] }); addCircle(ux, uz, 0.15, g, g + 2.7); }
  });

  // ---- boats moored beside the pier ----
  plan.boats.push({ kind: 'sail', x: -6.5, z: shoreZ + 14, rot: 0.05, phase: 0.4 });
  plan.boats.push({ kind: 'row', x: 6, z: shoreZ + 22, rot: -0.12, phase: 2.1 });

  // ---- lighthouse on the western point ----
  const lhx = -52, lhz = Math.min(shoreZ - 2, 40), lhg = gh(lhx, lhz);
  plan.lighthouse = { x: lhx, z: lhz, ground: lhg, baseTop: Math.max(lhg + 0.4, 1.1) };
  addCircle(lhx, lhz, 2.8, -40, plan.lighthouse.baseTop + 17);

  // ---- palms framing the town ----
  const palmSpots = [[-39, 27], [-35, 30], [37, 27], [40, 31], [-41, 10], [-38, -2], [39, 5], [41, -6], [-26, -3], [-10, -4.5], [6, -4.5], [20, -4], [34, -5], [-14, 31], [14, 34], [22, 30], [-21, 34], [-44, 22], [45, 20]];
  palmSpots.forEach(([px, pz], i) => {
    const p = toW(px, pz), y = terrain.height(p.x, p.z);
    if (y < 0.4) return;
    plan.palms.push({ x: p.x, z: p.z, y, s: 0.9 + hash3(i, 7, 3) * 0.5, a: hash3(i, 9, 4) * 6.28, k: hash3(i, 3, 5) });
  });

  // ---- minimap landmarks + tree exclusion zones ----
  const town = toW(0, 12), pier = toW(0, endZ - 4), lh = toW(lhx, lhz);
  plan.landmarks.push(
    { id: 'town', kind: 'town', name: 'Beach Town', x: town.x, z: town.z },
    { id: 'pier', kind: 'pier', name: 'Pier', x: pier.x, z: pier.z },
    { id: 'lighthouse', kind: 'lighthouse', name: 'Lighthouse', x: lh.x, z: lh.z },
    { id: 'games', kind: 'games', name: 'Games', x: lp.x, z: lp.z },
  );
  plan.exclusions.push({ x: cx, z: cz, r: 60 }, { x: lh.x, z: lh.z, r: 12 });
  return plan;
}

// Is the point on one of the town's walkable decks? Returns the deck height or -Infinity.
export function deckHeightAt(plan, x, z) {
  let y = -Infinity;
  for (const d of plan.decks) {
    const dx = x - d.x, dz = z - d.z, c = Math.cos(d.theta), s = Math.sin(d.theta);
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) <= d.hw && Math.abs(lz) <= d.hd && d.y > y) y = d.y;
  }
  return y;
}