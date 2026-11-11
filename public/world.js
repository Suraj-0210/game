// Shared voxel world logic: terrain generation, chunk storage, meshing, raycast, collision.
// No rendering library in here, so it is easy to test and reuse.

export const CS = 16;      // chunk size (x and z)
export const H = 64;       // world height
export const SEA = 20;     // sea level
export const SEED = 1337;
export const TILES = 7;    // tiles in the texture atlas

export const BLOCK = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, SAND: 4, PLANKS: 5, SNOW: 6 };

// ---------- terrain noise ----------
function hash2(x, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ SEED;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  const u = smooth(xf), v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function heightAt(x, z) {
  let n = 0, amp = 1, freq = 1 / 70, norm = 0;
  for (let o = 0; o < 4; o++) {
    n += vnoise(x * freq, z * freq) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  n /= norm; // 0..1
  return Math.min(H - 8, Math.floor(10 + Math.pow(n, 1.6) * 46));
}
function baseBlock(y, h) {
  if (y > h) return BLOCK.AIR;
  const beach = h <= SEA + 1;
  if (y === h) return beach ? BLOCK.SAND : h > 44 ? BLOCK.SNOW : BLOCK.GRASS;
  if (y > h - 4) return beach ? BLOCK.SAND : BLOCK.DIRT;
  return BLOCK.STONE;
}

// ---------- mesh helpers ----------
const FACES = [
  { n: [1, 0, 0],  u: [0, 1, 0], v: [0, 0, 1], swap: true  }, // +x
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], swap: false }, // -x
  { n: [0, 1, 0],  u: [0, 0, 1], v: [1, 0, 0], swap: false }, // +y (top)
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], swap: false }, // -y (bottom)
  { n: [0, 0, 1],  u: [1, 0, 0], v: [0, 1, 0], swap: false }, // +z
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0], swap: true  }, // -z
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO = [0.5, 0.68, 0.84, 1.0];
const INSET = 0.02;

function tileFor(id, face) {
  switch (id) {
    case BLOCK.GRASS: return face === 2 ? 0 : face === 3 ? 2 : 1;
    case BLOCK.DIRT: return 2;
    case BLOCK.STONE: return 3;
    case BLOCK.SAND: return 4;
    case BLOCK.PLANKS: return 5;
    case BLOCK.SNOW: return 6;
    default: return 3;
  }
}

export class World {
  constructor() {
    this.chunks = new Map(); // chunk key -> Uint8Array block data
    this.edits = new Map();  // chunk key -> Map(localIndex -> block id)
  }

  static key(cx, cz) { return (cx + 50000) * 100000 + (cz + 50000); }
  static unkey(k) { return [Math.floor(k / 100000) - 50000, (k % 100000) - 50000]; }

  reset() { this.chunks.clear(); this.edits.clear(); }

  chunk(cx, cz) {
    const k = World.key(cx, cz);
    let d = this.chunks.get(k);
    if (!d) { d = this.generate(cx, cz); this.chunks.set(k, d); }
    return d;
  }

  generate(cx, cz) {
    const d = new Uint8Array(CS * CS * H);
    for (let z = 0; z < CS; z++) {
      for (let x = 0; x < CS; x++) {
        const h = heightAt(cx * CS + x, cz * CS + z);
        for (let y = 0; y <= h; y++) d[x + CS * (z + CS * y)] = baseBlock(y, h);
      }
    }
    const e = this.edits.get(World.key(cx, cz));
    if (e) for (const [i, id] of e) d[i] = id;
    return d;
  }

  pruneData(pcx, pcz, radius) {
    for (const k of this.chunks.keys()) {
      const [cx, cz] = World.unkey(k);
      if (Math.hypot(cx - pcx, cz - pcz) > radius) this.chunks.delete(k);
    }
  }

  getBlock(x, y, z) {
    if (y < 0) return BLOCK.STONE; // solid floor
    if (y >= H) return BLOCK.AIR;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const d = this.chunk(cx, cz);
    return d[(x - cx * CS) + CS * ((z - cz * CS) + CS * y)];
  }

  setBlock(x, y, z, id) {
    if (y < 0 || y >= H) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
    const i = (x - cx * CS) + CS * ((z - cz * CS) + CS * y);
    const k = World.key(cx, cz);
    const d = this.chunks.get(k);
    if (d) d[i] = id;
    let e = this.edits.get(k);
    if (!e) { e = new Map(); this.edits.set(k, e); }
    e.set(i, id);
    return true;
  }

  loadEdits(list) { for (const [x, y, z, id] of list) this.setBlock(x, y, z, id); }

  // Build mesh arrays for one chunk (face culling + ambient occlusion).
  meshChunk(cx, cz) {
    const data = this.chunk(cx, cz);
    const ox = cx * CS, oz = cz * CS;
    const pos = [], nor = [], uv = [], col = [], idx = [];

    const solidAt = (x, y, z) => {
      if (x >= 0 && x < CS && z >= 0 && z < CS) {
        if (y < 0) return true;
        if (y >= H) return false;
        return data[x + CS * (z + CS * y)] !== 0;
      }
      return this.getBlock(ox + x, y, oz + z) !== 0;
    };

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < CS; z++) {
        for (let x = 0; x < CS; x++) {
          const id = data[x + CS * (z + CS * y)];
          if (!id) continue;
          for (let f = 0; f < 6; f++) {
            const F = FACES[f], n = F.n, u = F.u, v = F.v;
            if (solidAt(x + n[0], y + n[1], z + n[2])) continue;
            const tile = tileFor(id, f);
            const base = pos.length / 3;
            const ao = [0, 0, 0, 0];
            for (let c = 0; c < 4; c++) {
              const su = CORNERS[c][0], sv = CORNERS[c][1];
              const bx = x + n[0], by = y + n[1], bz = z + n[2];
              const s1 = solidAt(bx + su * u[0], by + su * u[1], bz + su * u[2]) ? 1 : 0;
              const s2 = solidAt(bx + sv * v[0], by + sv * v[1], bz + sv * v[2]) ? 1 : 0;
              const cr = solidAt(bx + su * u[0] + sv * v[0], by + su * u[1] + sv * v[1], bz + su * u[2] + sv * v[2]) ? 1 : 0;
              const a = s1 && s2 ? 0 : 3 - (s1 + s2 + cr);
              ao[c] = a;
              pos.push(
                x + 0.5 + 0.5 * (n[0] + su * u[0] + sv * v[0]),
                y + 0.5 + 0.5 * (n[1] + su * u[1] + sv * v[1]),
                z + 0.5 + 0.5 * (n[2] + su * u[2] + sv * v[2])
              );
              nor.push(n[0], n[1], n[2]);
              let s = (su + 1) / 2, t = (sv + 1) / 2;
              if (F.swap) { const tmp = s; s = t; t = tmp; }
              uv.push((tile + INSET + s * (1 - 2 * INSET)) / TILES, INSET + t * (1 - 2 * INSET));
              const b = AO[a];
              col.push(b, b, b);
            }
            if (ao[0] + ao[2] > ao[1] + ao[3]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
            else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
    if (!idx.length) return null;
    return {
      positions: new Float32Array(pos),
      normals: new Float32Array(nor),
      uvs: new Float32Array(uv),
      colors: new Float32Array(col),
      indices: new Uint32Array(idx),
    };
  }

  // Voxel ray traversal. Returns {x,y,z,nx,ny,nz} of the first solid block, or null.
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tx = dx > 0 ? (x + 1 - ox) / dx : dx < 0 ? (ox - x) / -dx : Infinity;
    let ty = dy > 0 ? (y + 1 - oy) / dy : dy < 0 ? (oy - y) / -dy : Infinity;
    let tz = dz > 0 ? (z + 1 - oz) / dz : dz < 0 ? (oz - z) / -dz : Infinity;
    let t = 0, nx = 0, ny = 0, nz = 0;
    while (t <= maxDist) {
      if (this.getBlock(x, y, z) !== 0) return { x, y, z, nx, ny, nz };
      if (tx < ty && tx < tz) { x += sx; t = tx; tx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (ty < tz) { y += sy; t = ty; ty += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tz; tz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // Does a player-sized box (feet at px,py,pz) overlap any solid block?
  collides(px, py, pz, r = 0.3, h = 1.8) {
    const x0 = Math.floor(px - r), x1 = Math.floor(px + r);
    const y0 = Math.floor(py + 1e-4), y1 = Math.floor(py + h - 1e-4);
    const z0 = Math.floor(pz - r), z1 = Math.floor(pz + r);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++)
          if (this.getBlock(x, y, z) !== 0) return true;
    return false;
  }
}
