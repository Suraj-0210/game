// One connected Bhubaneswar: the Old Town sits at the origin and the other areas around it at (roughly) their real compass
// directions, joined by connector roads. Each area keeps its own local plan; this file places them in the shared world.
import { Batch } from './bbsr_mesh.js';

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
  for (const k of ['boxes', 'circles', 'interactables', 'npcs', 'lamps', 'stalls', 'temples', 'landmarks', 'spots', 'walls']) (plan[k] || []).forEach(mv);
  for (const k of ['palms', 'broad', 'pines', 'rocks']) ((plan.trees && plan.trees[k]) || []).forEach(mv);
  mv(plan.spawn); mv(plan.travel); mv(plan.chai);
  for (const f of plan.flyovers || []) { f.x0 += ox; f.x1 += ox; f.z0 += oz; f.z1 += oz; f.piers.forEach(mv); }
  return plan;
}

// The connector roads (and a short marked centre line) between neighbouring areas.
export function buildConnectors(THREE, M, { width = 15 } = {}) {
  const road = new Batch(THREE), marks = new Batch(THREE), links = [];
  const group = new THREE.Group();
  for (const [a, b] of LINKS) {
    const [ax, az] = LAYOUT[a], [bx, bz] = LAYOUT[b], horizontal = az === bz;
    const sx = horizontal ? Math.min(ax, bx) + HALF_TILE : ax, ex = horizontal ? Math.max(ax, bx) - HALF_TILE : bx;
    const sz = horizontal ? az : Math.min(az, bz) + HALF_TILE, ez = horizontal ? bz : Math.max(az, bz) - HALF_TILE;
    // run a little into both areas so the road meets their edge cleanly
    const x0 = horizontal ? sx - 14 : sx, x1 = horizontal ? ex + 14 : ex, z0 = horizontal ? sz : sz - 14, z1 = horizontal ? ez : ez + 14;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, L = Math.hypot(x1 - x0, z1 - z0), yaw = horizontal ? 0 : Math.PI / 2;
    road.flat(cx, cz, 0.03, L, width, yaw, 0xffffff, 8);
    for (let s = 3; s < L - 3; s += 9) marks.flat(horizontal ? x0 + s : cx, horizontal ? cz : z0 + s, 0.035, horizontal ? 3.2 : 0.2, horizontal ? 0.2 : 3.2, 0, 0xeeeeee);
    links.push({ x0, z0, x1, z1, w: width });
  }
  group.add(road.mesh(M.asphalt, false)); group.add(marks.mesh(M.marks, false));
  return { group, links };
}
