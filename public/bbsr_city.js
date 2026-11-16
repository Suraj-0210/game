// One connected Bhubaneswar: the Old Town sits at the origin and the other areas around it at (roughly) their real compass
// directions, joined by connector roads. Each area keeps its own local plan; this file places them in the shared world.
import { Batch } from './bbsr_mesh.js';
import { buildRoads } from './bbsr_roads.js';

export const TILE = 1000;                 // every area is a 1 km square
export const HALF_TILE = 500;
export const GAP = 300;                   // road between two neighbouring areas
export const PITCH = TILE + GAP;

// [x, z] of each area centre (x east, z south). North is -z.
// Laid out in the REAL order and directions (from OpenStreetMap). The Old Town is at the south. About 6 km north, along the NH-16
// flyover road, come Jaydev Vihar, Vani Vihar (Utkal University) and Rasulgarh from west to east, Baramunda and Khandagiri further
// west, and Patia / KIIT far to the north. Real straight-line distances from the Old Town: Baramunda 5.5 km, Khandagiri 5.8 km,
// Jaydev Vihar 6.2 km, Vani Vihar 6.5 km, Rasulgarh 7 km, Patia 10.8 km. Here they are squeezed to about 1.3 km per step.
export const LAYOUT = {
  oldtown: [0, 0],
  vanivihar: [0, -PITCH],           // Janpath and Sachivalaya Marg run north from the Old Town to Vani Vihar
  jaydev: [-PITCH, -PITCH],         // west of Vani Vihar along the NH-16 flyovers
  rasulgarh: [PITCH, -PITCH],       // east of Vani Vihar, where NH-16 crosses at the Rasulgarh flyover
  baramunda: [-2 * PITCH, -PITCH],  // the big bus stand, further west
  khandagiri: [-2 * PITCH, 0],      // south of Baramunda, at the foot of the Khandagiri and Udayagiri hills
  patia: [-PITCH, -2 * PITCH],      // north of Jaydev Vihar: Patia, Infocity and KIIT
};
export const LINKS = [
  ['oldtown', 'vanivihar'], ['vanivihar', 'jaydev'], ['vanivihar', 'rasulgarh'], ['jaydev', 'baramunda'], ['baramunda', 'khandagiri'], ['jaydev', 'patia'],
];
const MARGIN = 160;
export const BOUNDS = (() => {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of Object.values(LAYOUT)) { x0 = Math.min(x0, x - HALF_TILE); x1 = Math.max(x1, x + HALF_TILE); z0 = Math.min(z0, z - HALF_TILE); z1 = Math.max(z1, z + HALF_TILE); }
  return { x0: x0 - MARGIN, x1: x1 + MARGIN, z0: z0 - MARGIN, z1: z1 + MARGIN };
})();
export const inBounds = (x, z) => x > BOUNDS.x0 && x < BOUNDS.x1 && z > BOUNDS.z0 && z < BOUNDS.z1;

// Which area is this point in (or null on the roads between them)?
export function areaAt(x, z) {
  for (const id in LAYOUT) { const [ox, oz] = LAYOUT[id]; if (Math.abs(x - ox) <= HALF_TILE && Math.abs(z - oz) <= HALF_TILE) return id; }
  return null;
}
// Distance from a point to the nearest edge of an area (0 if inside)
export function distToArea(id, x, z) {
  const [ox, oz] = LAYOUT[id], dx = Math.max(Math.abs(x - ox) - HALF_TILE, 0), dz = Math.max(Math.abs(z - oz) - HALF_TILE, 0);
  return Math.hypot(dx, dz);
}

// Move everything an area owns that matters for gameplay from its local coordinates into the shared world.
// (Meshes are NOT touched: their group is positioned instead, so call this after the meshes are built.)
export function offsetPlan(plan, ox, oz) {
  if (!ox && !oz) return plan;
  const mv = (o) => { if (o && o.x !== undefined) { o.x += ox; o.z += oz; } };
  for (const k of ['boxes', 'circles', 'interactables', 'npcs', 'lamps', 'stalls', 'temples', 'landmarks', 'spots', 'walls', 'signals']) (plan[k] || []).forEach(mv);
  for (const k of ['palms', 'broad', 'pines', 'rocks']) ((plan.trees && plan.trees[k]) || []).forEach(mv);
  mv(plan.spawn); mv(plan.travel); mv(plan.chai);
  for (const f of plan.flyovers || []) { f.x0 += ox; f.x1 += ox; f.z0 += oz; f.z1 += oz; f.piers.forEach(mv); }
  return plan;
}

// Where the main roads of an area leave it (local coordinates, before the area is moved into the city): {n,s,w,e: [{x,z,w}]}
export function edgeExits(plan) {
  const ex = { n: [], s: [], w: [], e: [] }, E = 455;
  const add = (side, p, w) => { const lat = side === 'n' || side === 's' ? p[0] : p[1]; if (!ex[side].some((q) => Math.abs((side === 'n' || side === 's' ? q.x : q.z) - lat) < 18)) ex[side].push({ x: p[0], z: p[1], w }); };
  for (const r of plan.roads) {
    if (!r.main || r.w < 9 || r.name === 'Connector') continue;
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) {
      if (p[1] <= -E) add('n', p, r.w); else if (p[1] >= E) add('s', p, r.w); else if (p[0] <= -E) add('w', p, r.w); else if (p[0] >= E) add('e', p, r.w);
    }
  }
  return ex;
}

// The roads between neighbouring areas. Main roads that leave one area are joined to the main road that enters the next one
// (matched by position along the edge); if there are none, a plain road joins the middles of the two edges.
// parts: [{ id, ox, oz, exits }]
export function computeLinks(parts) {
  const by = Object.fromEntries(parts.map((p) => [p.id, p])), out = [];
  for (const [a, b] of LINKS) {
    const A = by[a], B = by[b];
    if (!A || !B) continue;
    const h = A.oz === B.oz, sa = h ? (B.ox > A.ox ? 'e' : 'w') : (B.oz > A.oz ? 's' : 'n'), sb = { e: 'w', w: 'e', s: 'n', n: 's' }[sa];
    const lat = (P, e) => (h ? e.z + P.oz : e.x + P.ox);
    const pairs = [];
    for (const ea of A.exits[sa]) for (const eb of B.exits[sb]) pairs.push({ ea, eb, d: Math.abs(lat(A, ea) - lat(B, eb)) });
    pairs.sort((p, q) => p.d - q.d);
    const usedA = new Set(), usedB = new Set(), picked = [];
    for (const p of pairs) { if (p.d > 380 || usedA.has(p.ea) || usedB.has(p.eb)) continue; usedA.add(p.ea); usedB.add(p.eb); picked.push(p); if (picked.length >= 4) break; }
    const dir = h ? [B.ox > A.ox ? 1 : -1, 0] : [0, B.oz > A.oz ? 1 : -1];
    if (!picked.length) {
      const mid = (P, s) => (h ? [P.ox + (s === 'e' ? HALF_TILE : -HALF_TILE), P.oz] : [P.ox, P.oz + (s === 's' ? HALF_TILE : -HALF_TILE)]);
      const m0 = mid(A, sa), m1 = mid(B, sb);
      out.push({ from: a, to: b, w: 15, pts: [[m0[0] - dir[0] * 14, m0[1] - dir[1] * 14], [m1[0] + dir[0] * 14, m1[1] + dir[1] * 14]] });
      continue;
    }
    for (const { ea, eb } of picked) {
      const p0 = [ea.x + A.ox, ea.z + A.oz], p1 = [eb.x + B.ox, eb.z + B.oz], lead = 40;
      const pts = [[p0[0] - dir[0] * 12, p0[1] - dir[1] * 12], p0, [p0[0] + dir[0] * lead, p0[1] + dir[1] * lead], [p1[0] - dir[0] * lead, p1[1] - dir[1] * lead], p1, [p1[0] + dir[0] * 12, p1[1] + dir[1] * 12]];
      out.push({ from: a, to: b, w: Math.max(ea.w, eb.w, 11), pts });
    }
  }
  return out;
}

// The roads between neighbouring areas: the same lanes, medians, kerbs and markings as every other road.
export function buildConnectors(THREE, M, links) {
  const roads = links.map((l) => ({ name: 'Connector', w: l.w, main: true, pts: l.pts.map((p) => [p[0], p[1]]) }));
  const group = new THREE.Group(), RD = buildRoads({ THREE, Batch }, roads, M, null);
  for (const m of RD.meshes) group.add(m.mesh);
  return { group, links, roads, chunks: RD.meshes };
}
