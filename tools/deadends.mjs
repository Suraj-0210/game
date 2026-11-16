// lists road ends that stop in open ground (no other road within reach) for an area
import fs from 'fs';
const area = process.argv[2] || 'vanivihar';
const d = JSON.parse(fs.readFileSync(`public/data/real_${area}.json`, 'utf8'));
const rs = d.roads || [];
console.log(area, 'roads', rs.length, 'keys', Object.keys(d).join(','));
const near = (x, z, self) => rs.some((r) => r !== self && r.pts.some((p, i) => { const q = r.pts[i + 1]; if (!q) return Math.hypot(p[0] - x, p[1] - z) < 10; const dx = q[0] - p[0], dz = q[1] - p[1], l2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (z - p[1]) * dz) / l2)); return Math.hypot(x - p[0] - dx * t, z - p[1] - dz * t) < 12; }));
let n = 0;
for (const r of rs) for (const [i, p] of [[0, r.pts[0]], [1, r.pts[r.pts.length - 1]]]) {
  if (!near(p[0], p[1], r)) { n++; if (n < 40) console.log('dead end', r.name || r.kind, r.kind, 'x', p[0].toFixed(0), 'z', p[1].toFixed(0), r.oneway ? 'oneway' : ''); }
}
console.log('dead ends', n);
