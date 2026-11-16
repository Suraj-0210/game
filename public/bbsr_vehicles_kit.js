// Detailed procedural vehicles: hatchback, sedan, SUV, auto-rickshaw, city bus, truck.
// Axes: the vehicle faces -z (like the avatars), +x is its right, +y is up, the origin is on the ground in the middle.
// Each model is split into a few parts so that many of them can be drawn as instanced meshes (parked cars, traffic):
//   body (painted, takes a per-instance colour) · glass · detail (tyres, rims, grille, trim: vertex colours) · head (headlamps) · tail (tail lamps)
export const PAINTS = [0xf2f2f0, 0xc9ccd1, 0x1c1d20, 0xb3202a, 0x1f4f9c, 0x6d7076, 0x7a1f2b, 0xe3b21f, 0x2c6e49, 0xd9702a, 0x8aa4c4, 0x4a3b2e];

export function createKit(THREE, mergeGeometries) {
  const { Shape, ExtrudeGeometry, ShapeGeometry, BoxGeometry, CylinderGeometry, BufferGeometry, Float32BufferAttribute, Color } = THREE;
  const col = new Color();

  // ---- geometry helpers ----
  const prep = (g) => { let q = g.index ? g.toNonIndexed() : g; if (q.attributes.uv) q.deleteAttribute('uv'); for (const k of Object.keys(q.attributes)) if (k !== 'position' && k !== 'normal') q.deleteAttribute(k); return q; };
  const paint = (g, hex) => { col.setHex(hex); const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; } g.setAttribute('color', new Float32BufferAttribute(a, 3)); return g; };
  const box = (w, h, d, x, y, z, hex) => { const g = prep(new BoxGeometry(w, h, d)); g.translate(x, y, z); return hex === undefined ? g : paint(g, hex); };
  const cyl = (rt, rb, h, seg, x, y, z, rx, rz, hex) => { const g = prep(new CylinderGeometry(rt, rb, h, seg)); if (rz) g.rotateZ(rz); if (rx) g.rotateX(rx); g.translate(x, y, z); return hex === undefined ? g : paint(g, hex); };
  // a profile (x along the car: NEGATIVE = front, y up) with rounded corners [x, y, radius], extruded to a width centred on the car
  const profile = (pts) => {
    const s = new Shape(), n = pts.length;
    const at = (i) => pts[(i + n) % n];
    const mid = (a, b, r) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, k = Math.min(r, l / 2) / l; return [a[0] + dx * k, a[1] + dy * k]; };
    for (let i = 0; i < n; i++) {
      const p = at(i), r = p[2] || 0, a = mid(p, at(i - 1), r), b = mid(p, at(i + 1), r);
      if (i === 0) s.moveTo(a[0], a[1]); else s.lineTo(a[0], a[1]);
      if (r > 0) s.quadraticCurveTo(p[0], p[1], b[0], b[1]); else s.lineTo(p[0], p[1]);
    }
    s.closePath();
    return s;
  };
  const extrude = (pts, width, bevel = 0.07) => {
    const g = prep(new ExtrudeGeometry(profile(pts), { depth: Math.max(0.01, width - bevel * 2), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4 }));
    g.translate(0, 0, -(width - bevel * 2) / 2);       // centre on the width axis
    g.rotateY(-Math.PI / 2);                            // profile x -> car z, extrusion -> car x
    return g;
  };
  // a flat panel in the plane of the car's side at x = side * halfW; poly = [[sx, y], ...] with sx along the car (negative = front)
  const sidePanel = (poly, halfW, hex) => {
    const out = [];
    for (const sd of [-1, 1]) {
      const g = prep(new ShapeGeometry(profile(poly.map((p) => [p[0], p[1], p[2] || 0])), 6));
      g.rotateY(-Math.PI / 2); g.translate(-halfW, 0, 0);          // faces -x
      if (sd === 1) { g.scale(-1, 1, 1); const ix = g.attributes.position; /* mirrored: flip winding */ const a = ix.array; for (let i = 0; i < a.length; i += 9) { for (let k = 0; k < 3; k++) { const t = a[i + k]; a[i + k] = a[i + 6 + k]; a[i + 6 + k] = t; } } const nn = g.attributes.normal.array; for (let i = 0; i < nn.length; i += 3) nn[i] = -nn[i]; }
      out.push(hex === undefined ? g : paint(g, hex));
    }
    return out;
  };
  // a quad from 4 corner points (a-b-c-d), double sided by the material
  const quad = (a, b, c, d) => {
    const g = new BufferGeometry(), v = [...a, ...b, ...c, ...a, ...c, ...d];
    g.setAttribute('position', new Float32BufferAttribute(v, 3)); g.computeVertexNormals(); return g;
  };
  // glass on a slope; pushed out along its normal so it sits on top of the bevelled body
  const windscreen = (halfW, z0, y0, z1, y1, out = 0.105) => {
    let nz = -(y1 - y0), ny = z1 - z0; if (ny < 0) { nz = -nz; ny = -ny; } const l = Math.hypot(nz, ny) || 1; nz = (nz / l) * out; ny = (ny / l) * out;
    return quad([-halfW, y0 + ny, z0 + nz], [halfW, y0 + ny, z0 + nz], [halfW, y1 + ny, z1 + nz], [-halfW, y1 + ny, z1 + nz]);
  };
  const wheelGeo = (r, w, tyre = 0x151515, rim = 0xc9ced3, hub = 0x8b9096) => {
    const parts = [cyl(r, r, w, 14, 0, 0, 0, 0, Math.PI / 2, tyre)];
    parts.push(cyl(r * 0.7, r * 0.7, w + 0.012, 12, 0, 0, 0, 0, Math.PI / 2, rim));
    parts.push(cyl(r * 0.22, r * 0.22, w + 0.03, 6, 0, 0, 0, 0, Math.PI / 2, hub));
    for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI; const b = box(w + 0.02, r * 0.12, r * 1.2, 0, 0, 0, 0x6e7378); b.rotateX(a); parts.push(b); }
    return mergeGeometries(parts.map((p) => (p.attributes.color ? p : paint(p, 0x888888))));
  };
  const merge = (list) => (list.length ? mergeGeometries(list.map((g) => (g.attributes.color ? g : paint(g, 0x111111)))) : null);
  const mergePlain = (list) => (list.length ? mergeGeometries(list) : null);

  // ---------------- cars (hatchback, sedan, SUV) ----------------
  // spec: L length, W width, wb wheelbase, r wheel radius, belt (height of the shoulder line), roofY, front/rear: shape of the lower body, cab: greenhouse points
  const CAR = {
    hatch: { L: 3.85, W: 1.68, wb: 2.45, r: 0.31, belt: 0.95, name: 'Hatchback', accel: 6.8, vmax: 26, camDist: 6.2,
      body: [[-1.92, 0.24, 0.1], [-1.92, 0.64, 0.14], [-1.58, 0.88, 0.3], [-0.72, 0.96, 0.2], [1.2, 0.98, 0.2], [1.92, 0.9, 0.16], [1.92, 0.24, 0.1]],
      cab: [[-0.8, 0.95, 0.04], [-0.22, 1.5, 0.2], [0.95, 1.52, 0.22], [1.74, 1.0, 0.12]], pillar: 0.18, tailY: 0.84, headY: 0.74 },
    sedan: { L: 4.45, W: 1.76, wb: 2.65, r: 0.32, belt: 0.97, name: 'Sedan', accel: 6.4, vmax: 29, camDist: 6.8,
      body: [[-2.22, 0.24, 0.1], [-2.22, 0.66, 0.14], [-1.8, 0.9, 0.3], [-0.85, 0.98, 0.2], [1.3, 1.0, 0.2], [2.0, 1.02, 0.15], [2.22, 0.9, 0.16], [2.22, 0.24, 0.1]],
      cab: [[-0.92, 0.97, 0.04], [-0.3, 1.46, 0.2], [0.85, 1.47, 0.22], [1.45, 1.0, 0.1]], pillar: 0.2, tailY: 0.9, headY: 0.76 },
    suv: { L: 4.35, W: 1.86, wb: 2.6, r: 0.37, belt: 1.12, name: 'SUV', accel: 5.6, vmax: 27, camDist: 7.2,
      body: [[-2.17, 0.3, 0.12], [-2.17, 0.82, 0.16], [-1.78, 1.08, 0.28], [-0.85, 1.14, 0.2], [2.1, 1.16, 0.18], [2.17, 1.1, 0.18], [2.17, 0.3, 0.12]],
      cab: [[-0.86, 1.12, 0.05], [-0.4, 1.76, 0.2], [1.85, 1.78, 0.2], [2.05, 1.14, 0.1]], pillar: 0.2, tailY: 1.05, headY: 0.92 },
  };
  function buildCar(key) {
    const s = CAR[key], halfW = s.W / 2, hg = (s.W - 0.2) / 2;
    const body = [extrude(s.body, s.W, 0.09), extrude(s.cab, s.W - 0.2, 0.06)];
    const glass = [], detail = [], head = [], tail = [];
    const cab = s.cab, belt = cab[0][1], roof = cab[1][1], fz = cab[0][0], rz = cab[3][0], zf = cab[1][0], zr = cab[2][0];
    // windscreen and rear window on the slopes
    glass.push(windscreen(hg - 0.06, fz + 0.03, belt + 0.03, zf + 0.02, roof - 0.04));
    glass.push(windscreen(hg - 0.06, rz - 0.03, belt + 0.03, zr - 0.02, roof - 0.04));
    // side windows: front and rear panes with a B pillar between
    const bz = (zf + zr) / 2 + 0.1, top = roof - 0.06, base = belt + 0.05;
    const slopeF = (y) => fz + ((zf - fz) * (y - belt)) / (roof - belt), slopeR = (y) => rz + ((zr - rz) * (y - belt)) / (roof - belt);
    glass.push(...sidePanel([[slopeF(base) + 0.06, base, 0], [slopeF(top) + 0.05, top, 0.03], [bz - s.pillar / 2, top, 0], [bz - s.pillar / 2, base, 0]], hg + 0.012));
    glass.push(...sidePanel([[bz + s.pillar / 2, base, 0], [bz + s.pillar / 2, top, 0], [slopeR(top) - 0.05, top, 0.03], [slopeR(base) - 0.05, base, 0]], hg + 0.012));
    // door shut lines, handles, side skirts
    for (const sd of [-1, 1]) {
      for (const z of [fz + 0.05, bz, rz - 0.45]) detail.push(box(0.012, belt - 0.4, 0.014, sd * (halfW - 0.005), 0.4 + (belt - 0.4) / 2 + 0.06, z, 0x1b1b1b));
      for (const z of [bz - 0.22, bz + 0.78]) detail.push(box(0.03, 0.035, 0.16, sd * (halfW + 0.002), belt - 0.1, z, 0xcfd3d8));
      detail.push(box(0.04, 0.09, s.wb - 0.3, sd * (halfW - 0.02), 0.31, 0, 0x151515));                       // side skirt
      // door mirrors
      body.push(box(0.1, 0.1, 0.17, sd * (halfW + 0.04), belt + 0.08, fz + 0.1));
      detail.push(box(0.012, 0.075, 0.14, sd * (halfW + 0.095), belt + 0.08, fz + 0.1, 0x0c0c0c));
    }
    // front: grille, intake, bumper, plate, lamps, badge
    const fx = -s.L / 2 - 0.08, rx = s.L / 2 + 0.08;
    detail.push(box(s.W * 0.46, 0.15, 0.06, 0, s.headY - 0.08, fx - 0.005, 0x0d0d0d));
    for (let k = 0; k < 3; k++) detail.push(box(s.W * 0.44, 0.012, 0.012, 0, s.headY - 0.12 + k * 0.045, fx - 0.04, 0x9aa0a6));
    detail.push(box(s.W * 0.7, 0.12, 0.07, 0, 0.36, fx + 0.01, 0x0e0e0e));
    detail.push(box(s.W - 0.02, 0.07, 0.08, 0, 0.27, fx + 0.02, 0x15161a));
    detail.push(box(0.4, 0.11, 0.015, 0, 0.45, fx - 0.04, 0xf3f3f1));
    detail.push(box(0.12, 0.05, 0.012, 0, s.headY + 0.1, fx - 0.045, 0xc9ced3));
    for (const sd of [-1, 1]) {
      head.push(box(0.32, 0.12, 0.08, sd * (halfW - 0.3), s.headY, fx + 0.02));
      detail.push(box(0.36, 0.15, 0.04, sd * (halfW - 0.3), s.headY, fx + 0.04, 0x1d2227));                // lamp housing
      head.push(box(0.2, 0.05, 0.05, sd * (halfW - 0.18), s.headY - 0.17, fx + 0.03));                      // fog / indicator
      tail.push(box(0.36, 0.14, 0.07, sd * (halfW - 0.28), s.tailY, rx - 0.02));
      detail.push(box(0.4, 0.17, 0.04, sd * (halfW - 0.28), s.tailY, rx - 0.04, 0x1a0d0e));
    }
    detail.push(box(s.W * 0.55, 0.06, 0.012, 0, s.tailY - 0.02, rx + 0.0, 0x1a1a1a));
    detail.push(box(0.42, 0.12, 0.015, 0, s.tailY - 0.22, rx + 0.01, 0xf3f3f1));
    detail.push(box(s.W * 0.78, 0.12, 0.08, 0, 0.34, rx - 0.01, 0x0e0e0e));
    detail.push(box(s.W - 0.02, 0.07, 0.08, 0, 0.27, rx - 0.02, 0x15161a));
    if (key === 'suv') for (const sd of [-1, 1]) detail.push(box(0.05, 0.05, 1.7, sd * (hg - 0.12), roof + 0.05, 0.5, 0x15161a));   // roof rails
    // wheels (arches are dark discs behind the tyre)
    const wheels = [];
    const ax = [-s.wb / 2, s.wb / 2], tx = halfW - 0.03;
    for (const z of ax) for (const sd of [-1, 1]) {
      wheels.push({ x: sd * tx, y: s.r, z, r: s.r, w: 0.22, front: z < 0, side: sd });
      detail.push(cyl(s.r * 1.2, s.r * 1.2, 0.012, 20, sd * (halfW + 0.006), s.r + 0.02, z, 0, Math.PI / 2, 0x070707));
    }
    return { key, spec: s, body: mergePlain(body), glass: mergePlain(glass), detail: merge(detail), head: merge(head), tail: merge(tail), wheels, wheelGeo: wheelGeo(s.r, 0.22), L: s.L, W: s.W, H: roof, wb: s.wb };
  }

  // ---------------- auto-rickshaw (three-wheeler) ----------------
  const AUTO = { L: 2.75, W: 1.32, wb: 1.7, r: 0.23, name: 'Auto-rickshaw', accel: 4.2, vmax: 15, camDist: 5.2 };
  function buildAuto() {
    const halfW = AUTO.W / 2;
    const body = [extrude([[-1.37, 0.26, 0.1], [-1.37, 0.78, 0.4], [-0.86, 1.02, 0.25], [-0.45, 1.04, 0.1], [1.3, 0.98, 0.1], [1.37, 0.26, 0.1]], AUTO.W, 0.07)];
    const detail = [], glass = [], head = [], tail = [];
    // canopy: black hood on four posts, rear seat, driver seat
    detail.push(extrude([[-0.86, 1.04, 0.04], [-0.76, 1.66, 0.14], [1.32, 1.66, 0.14], [1.36, 1.02, 0.06]], AUTO.W - 0.1, 0.05).applyMatrix4(new THREE.Matrix4()));
    paint(detail[0], 0x1a1c1e);
    for (const sd of [-1, 1]) for (const z of [-0.8, 0.22, 1.28]) detail.push(box(0.04, 0.62, 0.04, sd * (halfW - 0.06), 1.34, z, 0x242628));
    detail.push(box(AUTO.W - 0.3, 0.12, 0.62, 0, 0.74, 0.7, 0x3a2f28));            // rear seat
    detail.push(box(AUTO.W - 0.3, 0.42, 0.1, 0, 1.0, 1.06, 0x3a2f28));              // seat back
    detail.push(box(0.5, 0.1, 0.4, 0, 0.7, -0.25, 0x2d2823));                       // driver seat
    detail.push(box(0.3, 0.03, 0.03, 0, 1.17, -0.88, 0x9aa0a6));                    // handlebar
    detail.push(box(0.035, 0.15, 0.035, -0.15, 1.1, -0.88, 0x222222)); detail.push(box(0.035, 0.15, 0.035, 0.15, 1.1, -0.88, 0x222222));
    detail.push(box(0.9, 0.06, 0.12, 0, 0.22, -1.34, 0x15161a));                    // bumper
    detail.push(box(0.3, 0.08, 0.015, 0, 0.22, 1.37, 0xf3f3f1));                    // number plate
    detail.push(box(0.5, 0.05, 0.5, 0, 1.69, 0.2, 0xd8d3c4));                       // roof sign
    detail.push(box(AUTO.W - 0.06, 0.05, 0.08, 0, 1.64, -0.82, 0x2a2d30));
    glass.push(windscreen(halfW - 0.16, -0.84, 1.07, -0.74, 1.6));
    glass.push(windscreen(halfW - 0.3, 1.34, 1.12, 1.31, 1.52));
    head.push(cyl(0.11, 0.11, 0.06, 14, 0, 0.78, -1.39, Math.PI / 2, 0));
    for (const sd of [-1, 1]) { tail.push(box(0.12, 0.07, 0.04, sd * (halfW - 0.1), 0.62, 1.38)); head.push(box(0.05, 0.05, 0.04, sd * (halfW - 0.14), 0.74, -1.3)); }
    const wheels = [{ x: 0, y: AUTO.r - 0.01, z: -0.95, r: AUTO.r - 0.02, w: 0.14, front: true, side: 0 }, { x: -0.72, y: AUTO.r, z: 0.75, r: AUTO.r, w: 0.16, front: false, side: -1 }, { x: 0.72, y: AUTO.r, z: 0.75, r: AUTO.r, w: 0.16, front: false, side: 1 }];
    detail.push(box(0.04, 0.4, 0.6, 0, 0.36, -0.95, 0x1d1d1d));                     // front fork
    for (const sd of [-1, 1]) detail.push(box(0.5, 0.26, 0.5, sd * 0.43, 0.38, 0.75, 0x161616));   // engine / mudguards
    return { key: 'auto', spec: AUTO, body: mergePlain(body), glass: mergePlain(glass), detail: merge(detail), head: merge(head), tail: merge(tail), wheels, wheelGeo: wheelGeo(AUTO.r, 0.15), L: AUTO.L, W: AUTO.W, H: 1.7, wb: AUTO.wb };
  }

  // ---------------- scooter with a rider (the commonest vehicle on the road) ----------------
  const SCOOT = { L: 1.85, W: 0.68, wb: 1.24, r: 0.2, name: 'Scooter', accel: 3.2, vmax: 16, camDist: 4 };
  function buildScooter() {
    const body = [box(0.42, 0.36, 0.72, 0, 0.56, 0.42), box(0.38, 0.07, 0.56, 0, 0.3, -0.08), box(0.36, 0.52, 0.1, 0, 0.6, -0.6), box(0.3, 0.3, 0.1, 0, 0.82, -0.66)];
    const detail = [], head = [], tail = [], glass = [box(0.3, 0.17, 0.02, 0, 1.12, -0.74)];     // a small wind deflector
    detail.push(box(0.3, 0.09, 0.6, 0, 0.78, 0.4, 0x1b1b1d));
    detail.push(box(0.04, 0.42, 0.04, 0, 0.86, -0.66, 0x303236)); detail.push(box(0.66, 0.045, 0.045, 0, 1.06, -0.68, 0x303236));
    detail.push(box(0.2, 0.14, 0.12, 0, 0.98, -0.72, 0x1b1b1d));
    detail.push(box(0.1, 0.09, 0.42, 0.19, 0.27, 0.5, 0x6b6e73));
    detail.push(box(0.08, 0.04, 0.16, 0, 0.5, 0.86, 0xf3f3f1));
    detail.push(box(0.3, 0.2, 0.46, 0, 0.92, 0.16, 0x2d3748)); detail.push(box(0.28, 0.48, 0.2, 0, 1.28, 0.16, 0x3f6db0));
    for (const sd of [-1, 1]) detail.push(box(0.08, 0.09, 0.55, sd * 0.2, 1.22, -0.18, 0x3f6db0)); detail.push(box(0.22, 0.24, 0.24, 0, 1.68, 0.12, 0x202225));
    head.push(cyl(0.07, 0.07, 0.04, 12, 0, 0.98, -0.79, Math.PI / 2, 0));
    tail.push(box(0.12, 0.05, 0.03, 0, 0.62, 0.86));
    const wheels = [{ x: 0, y: SCOOT.r, z: -0.62, r: SCOOT.r, w: 0.1, front: true, side: 0 }, { x: 0, y: SCOOT.r, z: 0.62, r: SCOOT.r, w: 0.1, front: false, side: 0 }];
    return { key: 'scooter', spec: SCOOT, body: mergePlain(body), glass: mergePlain(glass), detail: merge(detail), head: merge(head), tail: merge(tail), wheels, wheelGeo: wheelGeo(SCOOT.r, 0.1), L: SCOOT.L, W: SCOOT.W, H: 1.8, wb: SCOOT.wb };
  }

  // ---------------- city bus ----------------
  const BUS = { L: 10.6, W: 2.5, wb: 5.4, r: 0.52, name: 'City bus', accel: 3.0, vmax: 20, camDist: 12.5 };
  function buildBus() {
    const halfW = BUS.W / 2, L2 = BUS.L / 2;
    const body = [extrude([[-L2, 0.5, 0.12], [-L2, 2.75, 0.3], [-L2 + 0.35, 3.2, 0.2], [L2 - 0.1, 3.2, 0.12], [L2, 3.05, 0.1], [L2, 0.5, 0.1]], BUS.W, 0.09)];
    const glass = [], detail = [], head = [], tail = [];
    glass.push(windscreen(halfW - 0.12, -L2 + 0.03, 1.55, -L2 + 0.3, 3.0));
    glass.push(windscreen(halfW - 0.3, L2 + 0.01, 1.7, L2 + 0.01, 2.9));
    for (const sd of [-1, 1]) {
      for (let k = 0; k < 7; k++) { const z0 = -4.3 + k * 1.17; glass.push(...sidePanel([[z0, 1.5, 0.05], [z0, 2.85, 0.06], [z0 + 1.0, 2.85, 0.06], [z0 + 1.0, 1.5, 0.05]], halfW + 0.012).filter((_, i) => i === (sd < 0 ? 0 : 1))); }
      detail.push(box(0.03, 0.12, BUS.L - 0.4, sd * (halfW + 0.002), 1.2, 0, 0xf0f0ee));        // white stripe
      detail.push(box(0.03, 0.09, BUS.L - 0.6, sd * (halfW + 0.003), 0.85, 0, 0x1f2933));
    }
    // front door (the doors are on the left side: traffic keeps left)
    detail.push(box(0.04, 1.95, 1.05, -(halfW + 0.01), 1.55, -3.9, 0x1a2630));
    detail.push(box(0.06, 0.1, 0.1, -(halfW + 0.03), 1.5, -3.5, 0xcfd3d8));
    // destination board, roof AC unit, bumpers, grille, wipers
    detail.push(box(1.7, 0.32, 0.05, 0, 3.12, -L2 - 0.02, 0x0f5132));
    detail.push(box(1.5, 0.14, 0.04, 0, 3.12, -L2 - 0.045, 0xffc84a));
    detail.push(box(1.7, 0.4, 3.2, 0, 3.4, 1.2, 0xdadada));
    detail.push(box(BUS.W - 0.02, 0.2, 0.16, 0, 0.58, -L2 - 0.01, 0x15161a));
    detail.push(box(BUS.W - 0.02, 0.2, 0.16, 0, 0.58, L2 + 0.01, 0x15161a));
    detail.push(box(1.2, 0.5, 0.05, 0, 1.0, -L2 - 0.01, 0x0d0d0d));
    detail.push(box(0.5, 0.14, 0.02, 0, 0.62, -L2 - 0.1, 0xf3f3f1)); detail.push(box(0.5, 0.14, 0.02, 0, 0.62, L2 + 0.1, 0xf3f3f1));
    detail.push(box(1.0, 0.08, 0.04, 0, 0.86, L2 + 0.02, 0x15161a));
    for (const sd of [-1, 1]) {
      head.push(box(0.36, 0.2, 0.08, sd * (halfW - 0.3), 0.92, -L2 - 0.01));
      tail.push(box(0.2, 0.5, 0.06, sd * (halfW - 0.18), 1.3, L2 + 0.01));
      detail.push(box(0.04, 0.2, 0.3, sd * (halfW + 0.15), 2.4, -L2 + 0.55, 0x15161a));   // mirror arms
      detail.push(box(0.1, 0.5, 0.2, sd * (halfW + 0.22), 2.3, -L2 + 0.58, 0x1a1a1a));
    }
    const wheels = [];
    for (const z of [-BUS.wb / 2 - 0.6, BUS.wb / 2 - 0.2]) for (const sd of [-1, 1]) {
      wheels.push({ x: sd * (halfW - 0.13), y: BUS.r, z, r: BUS.r, w: 0.3, front: z < 0, side: sd });
      detail.push(box(0.04, BUS.r * 1.8, BUS.r * 2.3, sd * (halfW - 0.1), BUS.r + 0.06, z, 0x0a0a0a));
    }
    return { key: 'bus', spec: BUS, body: mergePlain(body), glass: mergePlain(glass), detail: merge(detail), head: merge(head), tail: merge(tail), wheels, wheelGeo: wheelGeo(BUS.r, 0.3), L: BUS.L, W: BUS.W, H: 3.6, wb: BUS.wb };
  }

  // ---------------- truck ----------------
  const TRUCK = { L: 8.0, W: 2.4, wb: 4.4, r: 0.5, name: 'Truck', accel: 2.8, vmax: 18, camDist: 11.5 };
  function buildTruck() {
    const halfW = TRUCK.W / 2, L2 = TRUCK.L / 2;
    const body = [extrude([[-L2, 0.55, 0.12], [-L2, 2.2, 0.35], [-L2 + 0.75, 2.78, 0.3], [-L2 + 2.0, 2.78, 0.1], [-L2 + 2.05, 0.55, 0.05]], TRUCK.W - 0.1, 0.08)];   // cab
    const glass = [], detail = [], head = [], tail = [];
    glass.push(windscreen(halfW - 0.2, -L2 + 0.03, 1.55, -L2 + 0.55, 2.62));
    for (const sd of [-1, 1]) glass.push(...sidePanel([[-L2 + 0.55, 1.6, 0.05], [-L2 + 0.8, 2.6, 0.08], [-L2 + 1.75, 2.6, 0.04], [-L2 + 1.75, 1.6, 0.04]], halfW - 0.04).filter((_, i) => i === (sd < 0 ? 0 : 1)));
    // cargo box (a tarpaulin-covered load), chassis, tank, bumper, grille, lamps
    detail.push(box(TRUCK.W, 2.3, 5.2, 0, 1.95, 1.2, 0x8a6a3c));
    detail.push(box(TRUCK.W + 0.04, 0.12, 5.3, 0, 0.9, 1.2, 0x2b2d30));
    for (let k = 0; k < 6; k++) detail.push(box(TRUCK.W + 0.03, 2.32, 0.05, 0, 1.95, -1.3 + k * 0.96, 0x6e522d));
    detail.push(box(1.0, 0.1, TRUCK.L - 0.2, 0, 0.62, 0, 0x1b1c1e));
    for (const sd of [-1, 1]) { detail.push(box(0.42, 0.42, 0.9, sd * (halfW - 0.1), 0.88, 0.9 - 0.4, 0x6b6e72)); detail.push(box(0.25, 0.3, 0.12, sd * (halfW + 0.15), 2.15, -L2 + 0.85, 0x15161a)); }
    detail.push(box(TRUCK.W, 0.22, 0.22, 0, 0.52, -L2 - 0.04, 0xd7d2c5));
    detail.push(box(1.3, 0.8, 0.06, 0, 1.15, -L2 - 0.02, 0x101010));
    for (let k = 0; k < 5; k++) detail.push(box(1.26, 0.02, 0.02, 0, 0.88 + k * 0.14, -L2 - 0.06, 0xaeb3b8));
    detail.push(box(0.5, 0.12, 0.02, 0, 0.56, -L2 - 0.17, 0xf3f3f1)); detail.push(box(0.5, 0.12, 0.02, 0, 0.8, L2 + 0.01, 0xf3f3f1));
    detail.push(box(TRUCK.W * 0.9, 0.35, 0.05, 0, 3.12, 1.2 - 2.62, 0x0f5132));
    for (const sd of [-1, 1]) { head.push(box(0.36, 0.2, 0.08, sd * (halfW - 0.4), 1.0, -L2 - 0.01)); tail.push(box(0.22, 0.2, 0.06, sd * (halfW - 0.25), 1.0, L2 + 0.01)); }
    const wheels = [];
    for (const z of [-TRUCK.wb / 2 - 0.2, TRUCK.wb / 2 - 0.2, TRUCK.wb / 2 + 0.95]) for (const sd of [-1, 1]) {
      wheels.push({ x: sd * (halfW - 0.14), y: TRUCK.r, z, r: TRUCK.r, w: 0.3, front: z < 0, side: sd });
      detail.push(box(0.04, TRUCK.r * 1.8, TRUCK.r * 2.3, sd * (halfW - 0.1), TRUCK.r + 0.06, z, 0x0a0a0a));
    }
    return { key: 'truck', spec: TRUCK, body: mergePlain(body), glass: mergePlain(glass), detail: merge(detail), head: merge(head), tail: merge(tail), wheels, wheelGeo: wheelGeo(TRUCK.r, 0.3), L: TRUCK.L, W: TRUCK.W, H: 3.2, wb: TRUCK.wb };
  }

  const BUILDERS = { hatch: () => buildCar('hatch'), sedan: () => buildCar('sedan'), suv: () => buildCar('suv'), auto: buildAuto, bus: buildBus, truck: buildTruck, scooter: buildScooter };
  const TYPE_KEYS = Object.keys(BUILDERS);
  const models = {};
  const model = (k) => models[k] || (models[k] = BUILDERS[k]());

  // ---- materials (shared) ----
  const mats = {
    body: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0f1a22, metalness: 0.9, roughness: 0.06, transparent: true, opacity: 0.8, side: THREE.DoubleSide, envMapIntensity: 1.4 }),
    detail: new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.25, roughness: 0.55, envMapIntensity: 0.6 }),
    head: new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xfff0c8, emissiveIntensity: 0.35, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0xc01820, emissive: 0xff1c24, emissiveIntensity: 0.3, roughness: 0.25 }),
  };

  // a complete vehicle (for the car you drive and the cars of other players): own meshes, spinning wheels, steering
  function buildGroup(key, hex = 0xffffff) {
    const m = model(key), g = new THREE.Group();
    const bodyMat = mats.body.clone(); bodyMat.color.setHex(hex);
    const add = (geo, mat, shadow) => { if (!geo) return null; const me = new THREE.Mesh(geo, mat); me.castShadow = !!shadow; g.add(me); return me; };
    const tailMat = mats.tail.clone(); add(m.body, bodyMat, true); add(m.glass, mats.glass); add(m.detail, mats.detail, true); add(m.head, mats.head); add(m.tail, tailMat);
    const wheels = m.wheels.map((w) => {
      const pivot = new THREE.Group(); pivot.position.set(w.x, w.y, w.z);
      const wm = new THREE.Mesh(m.wheelGeo, mats.detail); wm.castShadow = true; wm.scale.set(w.side < 0 ? -1 : 1, 1, 1); if (w.r !== m.spec.r && key !== 'auto') wm.scale.multiplyScalar(w.r / m.spec.r);
      pivot.add(wm); g.add(pivot); return { pivot, mesh: wm, front: w.front, r: w.r, side: w.side };
    });
    g.userData = { key, model: m, wheels, bodyMat, tailMat };
    return g;
  }
  // roll the wheels by `dist` metres and steer the front ones by `steer` radians (positive = right)
  function animateWheels(g, dist, steer) {
    for (const w of g.userData.wheels) { w.mesh.rotation.x -= dist / w.r; if (w.front) w.pivot.rotation.y = -steer; }
  }
  function disposeGroup(g) { g.traverse((o) => { if (o.material && o.material.userData && o.material.userData.own) o.material.dispose(); }); g.userData.bodyMat.dispose(); g.userData.tailMat.dispose(); }

  // ---- instanced fleets: many cars of one type in a handful of draw calls ----
  function createFleet(key, capacity, scene) {
    const m = model(key);
    // wheels merged into the detail part (no spinning for the distant ones)
    const parts = [m.detail];
    for (const w of m.wheels) { const wg = m.wheelGeo.clone(); if (w.side < 0) wg.scale(-1, 1, 1); if (w.r !== m.spec.r && key !== 'auto') wg.scale(w.r / m.spec.r, w.r / m.spec.r, w.r / m.spec.r); wg.translate(w.x, w.y, w.z); parts.push(wg); }
    const detail = mergeGeometries(parts.map((p) => p.clone()));
    const mk = (geo, mat, shadow) => { if (!geo) return null; const im = new THREE.InstancedMesh(geo, mat, capacity); im.frustumCulled = false; im.castShadow = !!shadow; im.count = 0; scene.add(im); return im; };
    const meshes = { body: mk(m.body, mats.body, true), glass: mk(m.glass, mats.glass), detail: mk(detail, mats.detail, true), head: mk(m.head, mats.head), tail: mk(m.tail, mats.tail) };
    const list = Object.values(meshes).filter(Boolean);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(0, 0, 0, 'YXZ'), P = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
    const free = []; for (let i = capacity - 1; i >= 0; i--) { free.push(i); for (const im of list) im.setMatrixAt(i, zero); }
    meshes.body.setColorAt(0, col.setHex(0xffffff)); for (let i = 0; i < capacity; i++) meshes.body.setColorAt(i, col.setHex(0xffffff));
    return {
      key, model: m, meshes, capacity,
      alloc(hex) { const i = free.pop(); if (i === undefined) return -1; for (const im of list) if (im.count < i + 1) im.count = i + 1; meshes.body.setColorAt(i, col.setHex(hex)); meshes.body.instanceColor.needsUpdate = true; return i; },
      release(i) { if (i < 0) return; for (const im of list) im.setMatrixAt(i, zero); free.push(i); this.dirty = true; },
      set(i, x, y, z, yaw, pitch = 0, roll = 0) { if (i < 0) return; E.set(pitch, yaw, roll); Q.setFromEuler(E); P.set(x, y, z); M.compose(P, Q, S); for (const im of list) im.setMatrixAt(i, M); this.dirty = true; },
      get free() { return free.length; },
      // limit this fleet to a patch of the city so the camera and the distance check can skip it
      bounds(cx, cz, r) { this.cx = cx; this.cz = cz; for (const im of list) { im.frustumCulled = true; im.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 0, cz), r); } },
      show(v) { for (const im of list) im.visible = v; },
      flush() { if (!this.dirty) return; for (const im of list) im.instanceMatrix.needsUpdate = true; this.dirty = false; },
    };
  }

  return { model, TYPE_KEYS, buildGroup, animateWheels, disposeGroup, createFleet, mats, CAR, PAINTS };
}
