// The rest of Bhubaneswar: every street and building of the OpenStreetMap extract outside the seven hand-built areas, streamed in as 500 m tiles
// (public/data/city/, made by tools/make_city_tiles.py) around the player and thrown away again when you drive off. Tiles are built in TRUE
// world coordinates, so streets cross tile borders and area borders with no seam and no made-up connector roads.
import { Batch } from './bbsr_mesh.js';
import { finishRoad, pairDual, buildRoads } from './bbsr_roads.js';
import { LAYOUT, HALF_TILE } from './bbsr_city.js';

const PAL = [0xf4f0e6, 0xf4f0e6, 0xf2dfa0, 0xe8c27e, 0xf0b8b0, 0xb8dcc0, 0xa8c8e0, 0xd89070, 0xe9e2d2, 0xf7d3a0];
const FLOORS = [1, 2, 2, 2, 3, 3, 3, 4], FILLER = [1, 2, 2, 2, 3, 3, 4];

// Place a building tile-side: skip anything that would sit on a street
function streetIndex(roads) {
  const G = 32, grid = new Map(), segs = [];
  for (const r of roads) for (let i = 0; i + 1 < r.pts.length; i++) {
    const a = r.pts[i], b = r.pts[i + 1], hw = (r.cw || r.w) / 2 + (r.foot || 0) + (r.medHalf || 0), s = { ax: a[0], az: a[1], bx: b[0], bz: b[1], hw };
    segs.push(s);
    for (let cx = Math.floor((Math.min(a[0], b[0]) - hw) / G); cx <= Math.floor((Math.max(a[0], b[0]) + hw) / G); cx++)
      for (let cz = Math.floor((Math.min(a[1], b[1]) - hw) / G); cz <= Math.floor((Math.max(a[1], b[1]) + hw) / G); cz++) { const k = cx + ',' + cz; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(s); }
  }
  return (x, z) => {                                // distance from the nearest street edge
    let best = 1e9; const l = grid.get(Math.floor(x / G) + ',' + Math.floor(z / G)); if (!l) return best;
    for (const s of l) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      best = Math.min(best, Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) - s.hw);
    }
    return best;
  };
}

export function createTiles({ THREE, mergeGeometries, M, scene, addBoxCollider, shadows = true, lite = false, base = '/data/city/' }) {
  let index = null, T = 500;
  const tiles = new Map(), ready = [];             // key -> { state, group, chunks, cols, data }
  const mapRoads = [];                                // every street of the built tiles, for the minimap
  const remap = () => { mapRoads.length = 0; for (const t of tiles.values()) if (t.state === 'built') for (const r of t.mr) mapRoads.push(r); };

  async function init() {
    try { const r = await fetch(base + 'index.json'); if (r.ok) { index = await r.json(); T = index.tile; } } catch (e) { /* no tiles: only the seven areas */ }
    return !!index;
  }

  function build(t, data) {
    const group = new THREE.Group(), chunks = [], cols = [];
    const addC = (batch, mat, sh) => { for (const c of batch.chunks(mat, sh)) { group.add(c.mesh); chunks.push(c); } };
    // ---- streets (real lane counts, medians, kerbs, footpaths, markings) ----
    const roads = data.roads.map((r) => ({ name: r.name || '', w: r.w, main: !!r.main, pts: r.pts, kind: r.kind, oneway: r.oneway, lanes: r.lanes, round: r.round, ref: r.ref, grp: r.g }));
    roads.forEach(finishRoad);
    pairDual(roads);
    const stub = { lamps: [], rounds: [], noSignals: true, worldCoords: true };
    if (roads.length) {
      const RD = buildRoads({ THREE, Batch }, roads, M, stub);
      for (const m of RD.meshes) { group.add(m.mesh); chunks.push(m); }
    }
    // ---- buildings ----
    const dist = streetIndex(roads), fa = new Batch(THREE), roofs = new Batch(THREE), fur = new Batch(THREE), heads = new Batch(THREE), treeGeos = [];
    let seed = (t.ix * 73856093) ^ (t.iz * 19349663);
    const rand = () => { seed = (seed + 0x6d2b79f5) | 0; let a = Math.imul(seed ^ (seed >>> 15), 1 | seed); a = (a + Math.imul(a ^ (a >>> 7), 61 | a)) ^ a; return ((a ^ (a >>> 14)) >>> 0) / 4294967296; };
    for (const [x, z, bw, bd, yaw, fl] of data.b) {
      const w = Math.min(bw, 60), d = Math.min(bd, 60), r = Math.hypot(w, d) / 2;
      if (dist(x, z) < r * 0.35) continue;                                        // not on a street
      const floors = fl > 0 ? Math.min(fl, 40) : FLOORS[Math.floor(rand() * FLOORS.length)];
      const h = floors >= 8 ? floors * 3.4 : floors * 3.2 + 0.5, color = floors >= 8 ? 0xb9c9d4 : PAL[Math.floor(rand() * PAL.length)];
      fa.box(x, z, 0, w, h, d, yaw, color, { us: 6, vs: 3.2, top: false });
      roofs.box(x, z, h, w + 0.3, 0.4, d + 0.3, yaw, 0xcfc8b8, { sides: true });
      cols.push(addBoxCollider({ x, z, hw: w / 2, hd: d / 2, theta: yaw, y0: 0, y1: h + 1 }));
    }
    // ---- the houses the map does not have: Bhubaneswar is built up along its streets (see the satellite view), but OpenStreetMap only has some buildings ----
    {
      const G = 16, occ = new Map(), near = (x, z, r) => { const cx = Math.floor(x / G), cz = Math.floor(z / G); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const l = occ.get((cx + i) + ',' + (cz + j)); if (l) for (const o of l) if (Math.hypot(o[0] - x, o[1] - z) < o[2] + r) return true; } return false; };
      const put = (x, z, r) => { const k = Math.floor(x / G) + ',' + Math.floor(z / G); let l = occ.get(k); if (!l) occ.set(k, (l = [])); l.push([x, z, r]); };
      for (const [x, z, bw, bd] of data.b) put(x, z, Math.hypot(Math.min(bw, 60), Math.min(bd, 60)) * 0.45);
      const x0 = t.ix * T, z0 = t.iz * T, KIND = { residential: 0.85, living_street: 0.8, unclassified: 0.7, tertiary: 0.6, secondary: 0.3 }, keep = lite ? 0.55 : 1;
      const inArea = (x, z) => { for (const id in LAYOUT) if (Math.abs(x - LAYOUT[id][0]) < HALF_TILE + 12 && Math.abs(z - LAYOUT[id][1]) < HALF_TILE + 12) return true; return false; };
      let made = 0;
      for (const r of roads) {
        const pr = (KIND[r.kind] || 0) * keep; if (!pr || r.round) continue;
        const off0 = (r.cw || r.w) / 2 + (r.foot || 0) + (r.medHalf || 0) + 2.2;
        let carry = rand() * 10;
        for (let i = 0; i + 1 < r.pts.length && made < 900; i++) {
          const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
          const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, yaw = Math.atan2(-tz, tx);
          for (let s = carry; s < L; s += 14 + rand() * 9) {
            for (const side of [-1, 1]) {
              if (rand() > pr) continue;
              const w = 7 + rand() * 7, d = 7 + rand() * 6, off = off0 + d / 2, x = a[0] + tx * s - tz * side * off, z = a[1] + tz * s + tx * side * off, rr = Math.hypot(w, d) / 2;
              if (x < x0 || x >= x0 + T || z < z0 || z >= z0 + T || inArea(x, z)) continue;
              if (dist(x, z) < rr * 0.7 || near(x, z, rr * 0.8)) continue;
              put(x, z, rr * 0.8); made++;
              const floors = FILLER[Math.floor(rand() * FILLER.length)], h = floors * 3.2 + 0.5;
              fa.box(x, z, 0, w, h, d, yaw, PAL[Math.floor(rand() * PAL.length)], { us: 6, vs: 3.2, top: false });
              roofs.box(x, z, h, w + 0.3, 0.4, d + 0.3, yaw, 0xcfc8b8, { sides: true });
              cols.push(addBoxCollider({ x, z, hw: w / 2, hd: d / 2, theta: yaw, y0: 0, y1: h + 1 }));
            }
            carry = 0;
          }
          carry = Math.max(0, carry - L) ;
        }
      }
      // ---- street trees: big shady canopies along the roadside, as in the street-view of Nandankanan Road and Service Road ----
      const TREE = { trunk: 0.9, primary: 0.85, secondary: 0.8, tertiary: 0.6, residential: 0.45, unclassified: 0.35, living_street: 0.4 }, GREEN = [0x3f7a35, 0x4b8a3c, 0x5a9a44, 0x356b2e, 0x66a04a];
      let planted = 0;
      const CANOPY = new THREE.IcosahedronGeometry(1, 1).toNonIndexed(), TRUNK = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).toNonIndexed(), TRUNK_COL = new THREE.Color(0x5b4630);
      for (const r of roads) {
        const pt = (TREE[r.kind] || 0) * (lite ? 0.55 : 1); if (!pt || r.round) continue;
        const off0 = (r.cw || r.w) / 2 + (r.foot || 0) + (r.medHalf || 0) + 1.3;
        let carry = rand() * 8;
        for (let i = 0; i + 1 < r.pts.length && planted < 700; i++) {
          const a = r.pts[i], b = r.pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1) continue;
          const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
          for (let s = carry; s < L; s += 12 + rand() * 8) {
            for (const side of [-1, 1]) {
              if (rand() > pt) continue;
              const x = a[0] + tx * s - tz * side * off0, z = a[1] + tz * s + tx * side * off0;
              if (x < x0 || x >= x0 + T || z < z0 || z >= z0 + T || inArea(x, z) || dist(x, z) < 0.6 || near(x, z, 2.2)) continue;
              put(x, z, 2.2); planted++;
              const th = 2.6 + rand() * 1.4, cw = 2.4 + rand() * 1.6, ch = 2.0 + rand() * 1.2, col = new THREE.Color(GREEN[Math.floor(rand() * GREEN.length)]);
              const paint = (g, c) => { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let q = 0; q < n; q++) { a[q * 3] = c.r; a[q * 3 + 1] = c.g; a[q * 3 + 2] = c.b; } g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
              const tk = TRUNK.clone().scale(1, th, 1).translate(x, th / 2, z);
              treeGeos.push(paint(tk, TRUNK_COL));
              for (const [dx, dy, dz, k] of [[0, th + ch * 0.35, 0, 1], [cw * 0.45, th + ch * 0.1, cw * 0.2, 0.72], [-cw * 0.4, th + ch * 0.15, -cw * 0.25, 0.68]])
                treeGeos.push(paint(CANOPY.clone().scale(cw * k, ch * k, cw * k).rotateY(rand() * 6).translate(x + dx, dy, z + dz), col));
            }
            carry = 0;
          }
          carry = Math.max(0, carry - L);
        }
      }
    }
    for (const l of stub.lamps) { fur.box(l.x, l.z, 0, 0.16, 4.8, 0.16, 0, 0x3a3f44, { us: 2, vs: 2 }); heads.box(l.x, l.z, 4.8, 0.55, 0.22, 0.55, 0, 0xffffff, { us: 2, vs: 2 }); }
    if (treeGeos.length) {
      const g = mergeGeometries(treeGeos, false), m = new THREE.Mesh(g, M.plain); m.castShadow = false; group.add(m);
      for (const q of treeGeos) q.dispose();
      chunks.push({ mesh: m, x: (t.ix + 0.5) * T, z: (t.iz + 0.5) * T, always: true });
    }
    addC(fa, M.facade, shadows); addC(roofs, M.plain, shadows); addC(fur, M.plain, false); addC(heads, M.lamp, false);
    scene.add(group);
    const mr = roads.map((r) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return { w: r.cw || r.w, pts: r.pts, main: r.main, b: [x0, z0, x1, z1] }; });
    return { group, chunks, cols, mr };
  }

  function drop(t) {
    if (t.group) {
      scene.remove(t.group);
      t.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    for (const e of t.cols || []) e.off = true;      // colliders stay in their grid, switched off
    t.group = null; t.chunks = []; t.cols = []; t.mr = []; t.state = 'gone'; remap();
  }

  // px,pz: the player; reach: how far (m) streets and buildings are drawn
  let frame = 0;
  function update(px, pz, reach, now = performance.now()) {
    if (!index) return;
    const R = reach + T * 0.5 + 60, ix0 = Math.floor((px - R) / T), ix1 = Math.floor((px + R) / T), iz0 = Math.floor((pz - R) / T), iz1 = Math.floor((pz + R) / T);
    const want = new Set();
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const key = ix + ',' + iz;
      if (!index.tiles[key]) continue;
      const cx = (ix + 0.5) * T, cz = (iz + 0.5) * T, dx = Math.max(Math.abs(px - cx) - T / 2, 0), dz = Math.max(Math.abs(pz - cz) - T / 2, 0);
      if (Math.hypot(dx, dz) > reach + 80) continue;
      want.add(key);
      let t = tiles.get(key);
      if (!t) { t = { key, ix, iz, state: 'new', group: null, chunks: [], cols: [], mr: [], data: null }; tiles.set(key, t); }
      if (t.state === 'new' || t.state === 'gone') {
        if (t.data) { t.state = 'ready'; ready.push(t); }
        else { t.state = 'loading'; fetch(`${base}t_${ix}_${iz}.json`).then((r) => r.json()).then((d) => { t.data = d; t.state = 'ready'; ready.push(t); }).catch(() => { t.state = 'failed'; }); }
      }
    }
    // build at most one tile per call, nearest first (a tile takes a moment to mesh)
    if (ready.length && performance.now() - now < 6) {
      ready.sort((a, b) => Math.hypot((a.ix + 0.5) * T - px, (a.iz + 0.5) * T - pz) - Math.hypot((b.ix + 0.5) * T - px, (b.iz + 0.5) * T - pz));
      const t = ready.shift();
      if (t.state === 'ready' && want.has(t.key)) {
        const b = build(t, t.data); t.group = b.group; t.chunks = b.chunks; t.cols = b.cols; t.mr = b.mr; t.state = 'built'; remap();
        for (const e of t.cols) e.off = false;
      }
    }
    for (const t of tiles.values()) {
      if (t.state === 'built') {
        const cx = (t.ix + 0.5) * T, cz = (t.iz + 0.5) * T, dx = Math.max(Math.abs(px - cx) - T / 2, 0), dz = Math.max(Math.abs(pz - cz) - T / 2, 0), d = Math.hypot(dx, dz);
        if (d > reach + 500) { drop(t); continue; }
        for (const c of t.chunks) if (!c.always) c.mesh.visible = Math.hypot(c.x - px, c.z - pz) < reach + 100;
      } else if (t.state === 'ready' && !want.has(t.key)) t.state = 'new';
    }
    frame++;
  }
  const stats = () => { let built = 0, tris = 0; for (const t of tiles.values()) if (t.state === 'built') built++; return { built, known: tiles.size }; };
  return { init, update, stats, tiles, mapRoads, get index() { return index; } };
}
