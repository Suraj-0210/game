// Island terrain + vegetation placement. Pure logic (no rendering), deterministic for every player.

export const SIZE = 1024;      // terrain extent in metres
export const HALF = SIZE / 2;
export const SEA = 0;          // sea level (y = 0)

// ---------- noise ----------
function hash2(x, z, s = 0) {
  let h = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(s + 1337, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const hash3 = hash2;
const smooth = (t) => t * t * (3 - 2 * t);
export function vnoise(x, z, s = 0) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const a = hash2(xi, zi, s), b = hash2(xi + 1, zi, s), c = hash2(xi, zi + 1, s), d = hash2(xi + 1, zi + 1, s);
  const u = smooth(xf), v = smooth(zf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, z, oct = 4, s = 0) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += vnoise(x * f, z * f, s + i) * a; norm += a; a *= 0.5; f *= 2.03; }
  return sum / norm;
}
function ridged(x, z, oct = 4, s = 0) {
  let a = 1, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) {
    const r = 1 - Math.abs(2 * vnoise(x * f, z * f, s + i) - 1);
    sum += r * r * a; norm += a; a *= 0.5; f *= 2.1;
  }
  return sum / norm;
}
export const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (v) => Math.min(1, Math.max(0, v));
export { clamp01 };

// ---------- the island ----------
const R = 330; // average island radius
export function heightAt(x, z) {
  const warp = fbm(x / 170 + 11.3, z / 170 - 7.1, 3, 11); // irregular coastline
  const t = 1 - (Math.hypot(x, z) / R + (warp - 0.5) * 0.62); // > 0 inland
  if (t <= 0) return -42 * ss(0, 0.45, -t);               // gentle shelf, then deep ocean
  const land = ss(0, 0.9, t) * 26;                         // wide beach rising to the interior
  const mt = ss(0.18, 0.72, t);
  const ridge = ridged(x / 120 + 3.7, z / 120 + 9.2, 4, 31);
  const hills = fbm(x / 45, z / 45, 3, 51);
  return land + mt * ridge * 34 + (hills - 0.5) * 5 * ss(0.03, 0.2, t);
}

export class Terrain {
  constructor(step, flatten = null) {
    this.step = step;
    const n = (this.n = Math.round(SIZE / step) + 1);
    const h = (this.h = new Float32Array(n * n));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) h[j * n + i] = heightAt(-HALF + i * step, -HALF + j * step);
    if (flatten) { // level a plateau (for the beach town) and blend it into the natural terrain
      const { x: fx, z: fz, h: fh, r0, r1 } = flatten;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const d = Math.hypot(-HALF + i * step - fx, -HALF + j * step - fz);
        if (d < r1) { const w = 1 - ss(r0, r1, d); h[j * n + i] += (fh - h[j * n + i]) * w; }
      }
    }
    const nrm = (this.nrm = new Float32Array(n * n * 3));
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const il = Math.max(i - 1, 0), ir = Math.min(i + 1, n - 1), jl = Math.max(j - 1, 0), jr = Math.min(j + 1, n - 1);
        const dx = (h[j * n + ir] - h[j * n + il]) / ((ir - il) * step);
        const dz = (h[jr * n + i] - h[jl * n + i]) / ((jr - jl) * step);
        const l = Math.hypot(dx, 1, dz), k = (j * n + i) * 3;
        nrm[k] = -dx / l; nrm[k + 1] = 1 / l; nrm[k + 2] = -dz / l;
      }
    }
  }
  // Height at any point, using the same triangles as the rendered mesh.
  height(x, z) {
    const n = this.n, s = this.step;
    let u = (x + HALF) / s, v = (z + HALF) / s;
    u = Math.min(Math.max(u, 0), n - 1.0001); v = Math.min(Math.max(v, 0), n - 1.0001);
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fz = v - j;
    const h00 = this.h[j * n + i], h10 = this.h[j * n + i + 1], h01 = this.h[(j + 1) * n + i], h11 = this.h[(j + 1) * n + i + 1];
    return fx + fz <= 1 ? h00 + fx * (h10 - h00) + fz * (h01 - h00) : h11 + (1 - fx) * (h01 - h11) + (1 - fz) * (h10 - h11);
  }
  normalY(x, z) {
    const n = this.n, s = this.step;
    const i = Math.min(n - 1, Math.max(0, Math.round((x + HALF) / s)));
    const j = Math.min(n - 1, Math.max(0, Math.round((z + HALF) / s)));
    return this.nrm[(j * n + i) * 3 + 1];
  }
}

// Texture weights (sand, grass, rock, dirt) for one terrain vertex.
export function splatAt(x, z, h, ny) {
  const n1 = fbm(x / 14 + 40, z / 14 + 3, 2, 71);
  const n2 = fbm(x / 60 - 12, z / 60 + 30, 2, 73);
  const ws = 1 - ss(0.9, 2.8, h + (n1 - 0.5) * 1.6);
  const rock = Math.max(clamp01((0.86 - ny) / 0.2), ss(38, 50, h + (n2 - 0.5) * 8));
  const wr = (1 - ws) * rock;
  const wd = (1 - ws) * (1 - rock) * ss(0.62, 0.8, n1) * 0.7;
  const wg = Math.max(0, 1 - ws - wr - wd);
  return [ws, wg, wr, wd];
}

// Deterministic vegetation + rocks.
export function scatter(terrain, exclusions = []) {
  const out = { palms: [], broad: [], pines: [], rocks: [] };
  const CELL = 5;
  for (let gz = -HALF + 2; gz < HALF - 2; gz += CELL) {
    for (let gx = -HALF + 2; gx < HALF - 2; gx += CELL) {
      const x = gx + (hash2(gx, gz, 1) - 0.5) * 4.4, z = gz + (hash2(gx, gz, 2) - 0.5) * 4.4;
      const h = terrain.height(x, z);
      if (h < 0.3) continue;
      if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
      const ny = terrain.normalY(x, z);
      const forest = fbm(x / 70 + 5, z / 70 + 9, 3, 91);
      const r1 = hash2(gx, gz, 3), r2 = hash2(gx, gz, 4), r3 = hash2(gx, gz, 5);
      const t = { x, y: h, z, s: 0.8 + r3 * 0.6, a: r2 * Math.PI * 2, k: r1 };
      if (h > 0.9 && h < 5.5 && ny > 0.9 && r1 < 0.2) out.palms.push(t);
      else if (h >= 4 && h < 26 && ny > 0.8 && forest > 0.42 && r1 < 0.55) out.broad.push(t);
      else if (h >= 24 && h < 44 && ny > 0.75 && forest > 0.38 && r1 < 0.4) out.pines.push(t);
      else if ((ny < 0.78 && r2 < 0.12) || r2 < 0.01) out.rocks.push({ ...t, s: 0.6 + r3 * 1.8 });
    }
  }
  return out;
}

// A spot on the beach, a few metres inland from the waterline, for a given compass angle.
export function findSpawn(terrain, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let r = 480; r >= 0; r -= 2) {
    const x = c * r, z = s * r;
    if (terrain.height(x, z) >= 1.2) return { x: x - c * 6, z: z - s * 6 };
  }
  return { x: 0, z: 0 };
}

// Pick a flat, straight stretch of coast for the beach town. Purely analytic so every client agrees.
// Local town axes: +z points out to sea, +x is to the right when facing the sea.
function coastDist(x, z, c, s) { let d = 0; while (d < 120 && heightAt(x + c * d, z + s * d) > 0.15) d += 1; return d; }
export function findTownSite() {
  let best = null;
  for (let deg = 0; deg < 360; deg += 4) {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    let r = 470;
    while (r > 60 && heightAt(c * r, s * r) < 1.2) r -= 2;   // walk inland until the ground is ~1.2 m above sea
    if (r <= 60) continue;
    const x = c * r, z = s * r, h0 = heightAt(x, z);
    const hs = [];
    for (let k = 0; k < 24; k++) { const ka = (k / 24) * Math.PI * 2, kr = k % 2 ? 24 : 40; hs.push(heightAt(x + Math.cos(ka) * kr, z + Math.sin(ka) * kr)); }
    const mean = hs.reduce((p, q) => p + q, 0) / hs.length;
    const std = Math.sqrt(hs.reduce((p, q) => p + (q - mean) * (q - mean), 0) / hs.length);
    const tx = -s, tz = c; // tangent along the coast
    const base = coastDist(x, z, c, s);
    if (base < 18 || base > 60) continue;
    let lat = 0;
    for (const o of [-45, -25, 25, 45]) lat = Math.max(lat, Math.abs(coastDist(x + tx * o, z + tz * o, c, s) - base));
    const score = std + 0.18 * lat;
    if (!best || score < best.score) best = { score, x, z, h0, theta: Math.atan2(c, s), dirX: c, dirZ: s };
  }
  return best;
}

// Ground cover: shrubs and ferns under the trees, grass tufts on the meadows. Deterministic.
export function scatterGround(terrain, exclusions = [], density = 1) {
  const out = { shrubs: [], ferns: [], grass: [] };
  const pass = (CELL, salt, fn) => {
    for (let gz = -HALF + 2; gz < HALF - 2; gz += CELL) {
      for (let gx = -HALF + 2; gx < HALF - 2; gx += CELL) {
        const ix = Math.round(gx * 10), iz = Math.round(gz * 10);
        const x = gx + (hash2(ix, iz, salt) - 0.5) * CELL * 0.95, z = gz + (hash2(ix, iz, salt + 1) - 0.5) * CELL * 0.95;
        const h = terrain.height(x, z);
        if (h < 1.5 || h > 42) continue;
        if (exclusions.some((e) => Math.hypot(x - e.x, z - e.z) < e.r)) continue;
        const ny = terrain.normalY(x, z);
        fn(x, z, h, ny, hash2(ix, iz, salt + 2), hash2(ix, iz, salt + 3), hash2(ix, iz, salt + 4));
      }
    }
  };
  const forestAt = (x, z) => fbm(x / 70 + 5, z / 70 + 9, 3, 91);
  pass(4, 301, (x, z, h, ny, r1, r2, r3) => {
    if (ny < 0.72) return;
    const f = forestAt(x, z), p = (f > 0.4 ? 0.14 + f * 0.5 : 0.025) * density;
    if (r1 < p) out.shrubs.push({ x, z, y: h, s: 0.7 + r2 * 0.8, a: r3 * 6.283, k: r2 });
  });
  pass(3.4, 401, (x, z, h, ny, r1, r2, r3) => {
    if (ny < 0.75 || h < 2.5) return;
    const f = forestAt(x, z);
    if (f > 0.42 && r1 < 0.34 * density) out.ferns.push({ x, z, y: h, s: 0.8 + r2 * 0.7, a: r3 * 6.283, k: r2 });
  });
  pass(2.3, 501, (x, z, h, ny, r1, r2, r3) => {
    if (ny < 0.84) return;
    const f = forestAt(x, z);
    if (r1 > (0.62 - f * 0.25) * density) return;
    if (splatAt(x, z, h, ny)[1] < 0.55) return;
    out.grass.push({ x, z, y: h, s: 0.75 + r2 * 0.7, a: r3 * 6.283, k: r2 });
  });
  return out;
}