// Hotel interior layout (pure data, no rendering). Hotel-local axes: x to the right, z toward the sea, y absolute.
// 3 levels: lobby with reception, then two guest floors. Straight stair flights in the back bay (ground->1 on the left,
// 1->2 on the right), a central corridor, 4 rooms per floor, each with its own bathroom behind a door.
export const HOTEL = { CX: 26, CZ: 6, W: 14, D: 16, FH: 3.4 };

export function planHotel(ctx) {
  const { toW, theta, deckY } = ctx;
  const { CX, CZ, W, D, FH } = HOTEL, HX = W / 2, HZ = D / 2, IX = HX - 0.125, IZ = HZ - 0.125; // IX/IZ: inner wall faces
  const LV = [deckY, deckY + FH, deckY + 2 * FH], TOP = deckY + 3 * FH;
  const out = { LV, TOP, parts: [], doors: [], decks: [], boxes: [], circles: [], interactables: [], lamps: [], signs: [], rooms: [], npc: null };

  const part = (mat, x0, x1, z0, z1, y0, y1, color = 0xffffff) => {
    if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return;
    out.parts.push({ mat, lx: CX + (x0 + x1) / 2, lz: CZ + (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: (y0 + y1) / 2, h: y1 - y0, color });
  };
  const W2 = (hx, hz) => toW(CX + hx, CZ + hz);
  const solid = (x0, x1, z0, z1, y0, y1, extra = {}) => {
    const p = W2((x0 + x1) / 2, (z0 + z1) / 2), b = { x: p.x, z: p.z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, theta, y0, y1, ...extra };
    out.boxes.push(b); return b;
  };
  const deck = (x0, x1, z0, z1, y, ramp = null) => { const p = W2((x0 + x1) / 2, (z0 + z1) / 2); out.decks.push({ x: p.x, z: p.z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, theta, y, ramp }); };
  const circle = (hx, hz, r, y0, y1) => { const p = W2(hx, hz); out.circles.push({ x: p.x, z: p.z, r, y0, y1 }); };
  // a piece of furniture: visible box + solid collider
  const item = (mat, x0, x1, z0, z1, y0, y1, color, collide = true) => { part(mat, x0, x1, z0, z1, y0, y1, color); if (collide) solid(x0, x1, z0, z1, y0, y1); };

  // ---------- walls ----------
  function wall(axis, c, a0, a1, yLo, yHi, gaps, o = {}) {
    const t = o.t || 0.15;
    const rect = (s0, s1, y0, y1, mat, color, o0, o1) => (axis === 'x' ? part(mat, s0, s1, c + o0, c + o1, y0, y1, color) : part(mat, c + o0, c + o1, s0, s1, y0, y1, color));
    const sol = (s0, s1, y0, y1) => (axis === 'x' ? solid(s0, s1, c - t / 2, c + t / 2, y0, y1) : solid(c - t / 2, c + t / 2, s0, s1, y0, y1));
    const emit = (s0, s1, y0, y1) => {
      if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
      if (o.ext) {
        const es = o.ext;
        rect(s0, s1, y0, y1, 'wall', o.outer, es > 0 ? t / 2 - 0.12 : -t / 2, es > 0 ? t / 2 : -t / 2 + 0.12);
        rect(s0, s1, y0, y1, 'plain', o.inner, es > 0 ? -t / 2 : -t / 2 + 0.12, es > 0 ? t / 2 - 0.12 : t / 2);
      } else rect(s0, s1, y0, y1, 'plain', o.color, -t / 2, t / 2);
      sol(s0, s1, y0, y1);
    };
    let cur = a0;
    for (const g of gaps.slice().sort((p, q) => p.a - q.a)) {
      emit(cur, g.a, yLo, yHi);
      if (!g.door) emit(g.a, g.b, yLo, g.y0);   // sill under a window (no sill under a doorway)
      emit(g.a, g.b, g.y1, yHi);
      if (g.window) {
        rect(g.a, g.b, g.y0 + 0.05, g.y1 - 0.05, 'clear', 0xffffff, -0.02, 0.02);
        const f = 0.07, m = (g.a + g.b) / 2, th = t / 2 + 0.02;
        rect(g.a, g.b, g.y0, g.y0 + f, 'plain', 0xf5f1e8, -th, th); rect(g.a, g.b, g.y1 - f, g.y1, 'plain', 0xf5f1e8, -th, th);
        rect(g.a, g.a + f, g.y0, g.y1, 'plain', 0xf5f1e8, -th, th); rect(g.b - f, g.b, g.y0, g.y1, 'plain', 0xf5f1e8, -th, th);
        rect(m - 0.03, m + 0.03, g.y0, g.y1, 'plain', 0xf5f1e8, -0.03, 0.03);
        sol(g.a, g.b, g.y0, g.y1);
      }
      cur = g.b;
    }
    emit(cur, a1, yLo, yHi);
  }

  // ---------- doors ----------
  // leaf hinged at (hx,hz), closed along unit dir (dx,dz), length len; opens by rotating `open` radians about y
  function door(group, hx, hz, dx, dz, len, y, open, o = {}) {
    const id = group + (o.leaf ? '_' + o.leaf : '');
    out.doors.push({ id, group, lx: CX + hx, lz: CZ + hz, y, dx, dz, len, h: o.h || 2.12, open, glass: !!o.glass, color: o.color || 0x7a5230 });
  }
  const doorBox = (id, label, name, cx, cz, hw, hd, y0, y1) => {
    const b = solid(cx - hw, cx + hw, cz - hd, cz + hd, y0, y1, { door: id });
    const p = W2(cx, cz);
    out.interactables.push({ id: 'door_' + id, type: 'door', door: id, x: p.x, z: p.z, y: y0, radius: 1.75, dy: 1.7, labels: ['Open ' + label, 'Close ' + label], name });
    return b;
  };
  const frame = (axis, c, a, b, y, hgt) => { // door frame around a gap
    const f = 0.07;
    if (axis === 'x') { part('plain', a - f, a, c - 0.1, c + 0.1, y, y + hgt, 0xf5f1e8); part('plain', b, b + f, c - 0.1, c + 0.1, y, y + hgt, 0xf5f1e8); part('plain', a - f, b + f, c - 0.1, c + 0.1, y + hgt, y + hgt + f, 0xf5f1e8); }
    else { part('plain', c - 0.1, c + 0.1, a - f, a, y, y + hgt, 0xf5f1e8); part('plain', c - 0.1, c + 0.1, b, b + f, y, y + hgt, 0xf5f1e8); part('plain', c - 0.1, c + 0.1, a - f, b + f, y + hgt, y + hgt + f, 0xf5f1e8); }
  };

  const cream = 0xf4eadb, tile = 0xe6f1f5;
  const wallTints = [0xf4e9d8, 0xe6eef7, 0xf6e4e0, 0xe5f0e2];
  const accents = [0xc0392b, 0x2980b9, 0x27ae60, 0xd68910, 0x8e44ad, 0x16a085, 0xe67e22, 0x2c3e50];

  // ---------- levels ----------
  const holes = [null, { x0: -5.9, x1: -1.4, z0: -7.8, z1: -6.3 }, { x0: 1.4, x1: 5.9, z0: -7.8, z1: -6.3 }];
  for (let k = 0; k < 3; k++) {
    const y = LV[k], yLo = k === 0 ? y - 0.1 : y - 0.3, yHi = k < 2 ? LV[k + 1] - 0.3 : TOP;
    const win = (a, b, y0 = y + 0.9, y1 = y + 2.5) => ({ a, b, y0, y1, window: true });
    // exterior walls
    const front = k === 0
      ? [{ a: -1.4, b: 1.4, y0: y, y1: y + 2.7, door: true }, win(-6.2, -2.6, y + 0.6), win(2.6, 6.2, y + 0.6)]
      : [win(-5.5, -2.7), win(2.7, 5.5), win(-0.8, 0.8)];
    const back = [win(-5.5, -3.5), win(3.5, 5.5), win(-0.8, 0.8)];
    const side = k === 0 ? [win(-1, 2, y + 0.6), win(4, 7, y + 0.6)] : [win(3.6, 6.4), win(-2.4, 0.4)];
    const ext = { outer: 0x9fc9e8, inner: cream, t: 0.25 };
    wall('x', HZ, -HX, HX, yLo, yHi, front, { ...ext, ext: 1 });
    wall('x', -HZ, -HX, HX, yLo, yHi, back, { ...ext, ext: -1 });
    wall('z', -HX, -HZ, HZ, yLo, yHi, side, { ...ext, ext: -1 });
    wall('z', HX, -HZ, HZ, yLo, yHi, side, { ...ext, ext: 1 });
    if (k === 0) frame('x', HZ, -1.4, 1.4, y, 2.7);

    // floor slab (with the stair hole), ceiling underside, finishes
    const h = holes[k], X = HX + 0.12, Z = HZ + 0.12, FIN = k === 0 ? 0xe8e1d4 : 0xd9d4c8;
    const rects = h ? [[-X, X, h.z1, Z], [-X, X, -Z, h.z0], [-X, h.x0, h.z0, h.z1], [h.x1, X, h.z0, h.z1]] : [[-X, X, -Z, Z]];
    for (const [x0, x1, z0, z1] of rects) {
      part('plain', x0, x1, z0, z1, y - 0.3, y, 0xf0ebe0);
      solid(x0, x1, z0, z1, y - 0.3, y, { fly: true });
      const dx0 = Math.max(x0, -IX), dx1 = Math.min(x1, IX), dz0 = Math.max(z0, -IZ), dz1 = Math.min(z1, IZ);
      if (dx1 > dx0 && dz1 > dz0) deck(dx0, dx1, dz0, dz1, y + 0.02);
    }
    if (k === 0) part('stone', -IX, IX, -IZ, IZ, y, y + 0.02, FIN);
    else if (k === 1 || k === 2) {
      // bay finish (everything behind the rooms) around the hole
      const bay = [[-IX, IX, -IZ, -4]];
      for (const [x0, x1, z0, z1] of bay) {
        if (h) { part('stone', x0, h.x0, z0, z1, y, y + 0.02, FIN); part('stone', h.x1, x1, z0, z1, y, y + 0.02, FIN); part('stone', h.x0, h.x1, h.z1, z1, y, y + 0.02, FIN); part('stone', h.x0, h.x1, z0, h.z0, y, y + 0.02, FIN); }
      }
      part('plain', -1.2, 1.2, -4, IZ, y, y + 0.02, 0x7a1f2b); // corridor carpet
    }
    if (k === 2) { part('plain', -IX, IX, -IZ, IZ, TOP - 0.3, TOP, 0xf0ebe0); solid(-X, X, -Z, Z, TOP - 0.3, TOP, { fly: true }); }

    if (k === 0) {
      // ----- lobby -----
      part('plain', -3, 3, 2, 7, y + 0.02, y + 0.04, 0x8c2f39); // entrance rug
      // reception counter + booth wall with sign and key rack
      item('wood', 1.2, 6.2, 0.4, 1.3, y, y + 1.05, 0x4a2f1c);
      part('plain', 1.1, 6.3, 0.35, 1.35, y + 1.05, y + 1.12, 0xf1ece4);
      wall('x', -1.5, 0.9, IX, yLo, yHi, [], { color: 0x3b2a20, t: 0.15 });
      part('plain', 1.4, 6.3, -1.42, -1.35, y + 1.0, y + 1.9, 0x241913);
      for (let i = 0; i < 10; i++) part('plain', 1.6 + i * 0.45, 1.68 + i * 0.45, -1.43, -1.34, y + 1.4 + (i % 2) * 0.28, y + 1.54 + (i % 2) * 0.28, 0xd9b44a); // key hooks
      out.signs.push({ name: 'reception', lx: CX + 3.8, lz: CZ - 1.4, y: y + 2.35, w: 3.0, h: 0.95 });
      out.npc = { lx: CX + 3.7, lz: CZ - 0.25, y, faceZ: 1 };
      out.interactables.push({ id: 'talk_reception', type: 'npc', npc: 'maya', x: W2(3.7, 0.8).x, z: W2(3.7, 0.8).z, y, radius: 3.1, dy: 1.7, label: 'Talk to the receptionist' });
      // seating area
      const sofa = (x0, x1, z0, z1, dirZ, col) => { item('plain', x0, x1, z0, z1, y, y + 0.45, col); const bz = dirZ > 0 ? [z1 - 0.22, z1] : [z0, z0 + 0.22]; part('plain', x0, x1, bz[0], bz[1], y + 0.45, y + 0.95, col); part('plain', x0, x0 + 0.2, z0, z1, y + 0.45, y + 0.7, col); part('plain', x1 - 0.2, x1, z0, z1, y + 0.45, y + 0.7, col); };
      sofa(-6.3, -3.7, 4.6, 5.6, 1, 0x2c6e8f); sofa(-6.3, -3.7, 1.2, 2.2, -1, 0x2c6e8f);
      item('wood', -5.5, -4.5, 3.0, 3.8, y, y + 0.42, 0x6b4a32);
      part('plain', -6.5, -3.5, 0.8, 6.0, y + 0.02, y + 0.04, 0xd8c7a8);
      for (const [px, pz] of [[-6.2, 7.0], [6.2, 7.0], [-6.2, -1.2]]) { part('plain', px - 0.25, px + 0.25, pz - 0.25, pz + 0.25, y, y + 0.5, 0xb5532f); part('plain', px - 0.4, px + 0.4, pz - 0.4, pz + 0.4, y + 0.5, y + 1.35, 0x2f7d3a); circle(px, pz, 0.38, y, y + 1.4); }
      // luggage trolley + welcome mat decor
      item('plain', 4.2, 5.4, 4.2, 4.7, y + 0.15, y + 0.2, 0xd9b44a); for (const [cx, cz] of [[4.3, 4.3], [5.3, 4.3], [4.3, 4.6], [5.3, 4.6]]) part('plain', cx - 0.04, cx + 0.04, cz - 0.04, cz + 0.04, y, y + 0.15, 0x333333);
      item('plain', 4.4, 5.2, 4.25, 4.65, y + 0.2, y + 0.65, 0x7b3f2a);
      for (const [lx, lz] of [[-3, 3], [3, 3], [0, -2], [-3, -6], [4, -6]]) out.lamps.push({ lx: CX + lx, lz: CZ + lz, y: yHi - 0.05 });
      // entrance doors (double, glass): hinge at the sides, swing inward
      door('hotel_front', -1.4, HZ, 1, 0, 1.4, y, Math.PI / 2, { leaf: 'L', glass: true, h: 2.6 });
      door('hotel_front', 1.4, HZ, -1, 0, 1.4, y, -Math.PI / 2, { leaf: 'R', glass: true, h: 2.6 });
      doorBox('hotel_front', 'the entrance', 'Hotel entrance', 0, HZ, 1.4, 0.07, y, y + 2.6);
    } else {
      // ----- guest floor -----
      for (const [lx, lz] of [[0, 6], [0, 1], [0, -3], [-4, -6], [4, -6]]) out.lamps.push({ lx: CX + lx, lz: CZ + lz, y: yHi - 0.05 });
      // partitions
      for (const s of [-1, 1]) {
        const a = s < 0 ? -IX : 1.2, b = s < 0 ? -1.2 : IX;
        wall('x', -4, a, b, yLo, yHi, [], { color: cream, t: 0.15 });
        wall('x', 2, a, b, yLo, yHi, [], { color: cream, t: 0.15 });
      }
      // rooms: side -1 (left) / +1 (right), z0 = southern edge (smaller z)
      [[-1, 2], [-1, -4], [1, 2], [1, -4]].forEach(([s, z0], idx) => {
        const num = k * 100 + idx + 1, tint = wallTints[(idx + k) % 4], acc = accents[(idx * 2 + k) % accents.length];
        const hxr = (u) => s * (1.2 + u), r = (u0, u1) => (s < 0 ? [hxr(u1), hxr(u0)] : [hxr(u0), hxr(u1)]); // x range from u range
        const rect2 = (u0, u1, v0, v1) => { const [x0, x1] = r(u0, u1); return [x0, x1, z0 + v0, z0 + v1]; };
        const rid = `r${num}`, bid = `r${num}b`;
        // corridor wall with the entry door (gap v 0.9..1.9) — the bathroom block (v>2.4) is solid
        wall('z', s * 1.2, z0, z0 + 6, yLo, yHi, [{ a: z0 + 0.9, b: z0 + 1.9, y0: y, y1: y + 2.12, door: true }], { color: tint, t: 0.15 });
        frame('z', s * 1.2, z0 + 0.9, z0 + 1.9, y, 2.12);
        door(rid, s * 1.2, z0 + 0.9, 0, 1, 1.0, y, s * Math.PI / 2);
        doorBox(rid, `room ${num}`, `Room ${num}`, s * 1.2, z0 + 1.4, 0.08, 0.5, y, y + 2.12);
        // bathroom: u 0..2.4, v 2.4..6.0 (walls: v=2.4 with a door gap u 0.7..1.7, and u=2.4)
        const [bx0, bx1] = r(0.7, 1.7);
        const [wx0, wx1] = r(0, 2.4);
        wall('x', z0 + 2.4, wx0, wx1, yLo, yHi, [{ a: bx0, b: bx1, y0: y, y1: y + 2.12, door: true }], { color: tile, t: 0.15 });
        wall('z', hxr(2.4), z0 + 2.4, z0 + 6, yLo, yHi, [], { color: tile, t: 0.15 });
        frame('x', z0 + 2.4, bx0, bx1, y, 2.12);
        // the bath door hinges on the corridor side and swings out into the room's hall
        const hinge = s < 0 ? bx1 : bx0;
        door(bid, hinge, z0 + 2.4, s, 0, 1.0, y, s * Math.PI / 2);
        doorBox(bid, 'bathroom door', `Room ${num} bathroom`, (bx0 + bx1) / 2, z0 + 2.4, 0.5, 0.08, y, y + 2.12);
        // floors
        let [fx0, fx1, fz0, fz1] = rect2(0, 5.675, 0, 6); part('wood', fx0, fx1, fz0, fz1, y, y + 0.02, 0xcfa77a);
        [fx0, fx1, fz0, fz1] = rect2(0, 2.4, 2.4, 6); part('stone', fx0, fx1, fz0, fz1, y + 0.01, y + 0.03, 0xf4f8fa);
        // ----- bedroom furniture -----
        const R = (u0, u1, v0, v1, y0, y1, mat, col, collide = true) => { const [x0, x1, z0b, z1b] = rect2(u0, u1, v0, v1); item(mat, x0, x1, z0b, z1b, y + y0, y + y1, col, collide); };
        const P = (u0, u1, v0, v1, y0, y1, mat, col) => { const [x0, x1, z0b, z1b] = rect2(u0, u1, v0, v1); part(mat, x0, x1, z0b, z1b, y + y0, y + y1, col); };
        R(3.3, 4.9, 3.9, 5.95, 0, 0.35, 'wood', 0x6b4a32);                 // bed frame
        P(3.3, 4.9, 3.9, 5.95, 0.35, 0.6, 'plain', 0xf7f4ee);              // mattress
        P(3.3, 4.9, 3.9, 5.0, 0.6, 0.66, 'plain', acc);                    // blanket
        P(3.45, 4.05, 5.4, 5.9, 0.6, 0.72, 'plain', 0xffffff); P(4.15, 4.75, 5.4, 5.9, 0.6, 0.72, 'plain', 0xffffff); // pillows
        P(3.2, 5.0, 5.9, 5.98, 0, 1.15, 'wood', 0x4a2f1c);                 // headboard
        P(3.5, 4.7, 5.96, 6.0, 1.4, 2.1, 'plain', acc);                    // picture above the bed
        for (const u of [2.65, 5.0]) { R(u, u + 0.5, 5.45, 5.9, 0, 0.5, 'wood', 0x5a3a24); P(u + 0.12, u + 0.38, 5.57, 5.8, 0.5, 0.75, 'glow', 0xffe7a3); } // nightstands + lamps
        R(2.45, 3.05, 2.9, 4.3, 0, 2.1, 'wood', 0x7a5230);                 // wardrobe
        P(2.42, 2.45, 3.58, 3.62, 0.1, 2.0, 'plain', 0x2d1e12);
        R(5.0, 5.65, 0.8, 2.4, 0.72, 0.78, 'wood', 0x8a6540);              // desk top
        for (const [du, dv] of [[5.05, 0.85], [5.55, 0.85], [5.05, 2.3], [5.55, 2.3]]) P(du, du + 0.06, dv, dv + 0.06, 0, 0.72, 'plain', 0x2d3436);
        P(5.35, 5.6, 1.25, 1.7, 0.78, 1.18, 'glass', 0x222a35);            // laptop screen
        R(4.15, 4.65, 1.25, 1.75, 0, 0.46, 'plain', 0x3a3f47); P(4.55, 4.65, 1.25, 1.75, 0.46, 0.95, 'plain', 0x3a3f47); // chair
        R(3.3, 4.9, 0.12, 0.55, 0, 0.5, 'wood', 0x5a3a24);                 // TV console
        P(3.55, 4.65, 0.16, 0.22, 0.55, 1.2, 'glass', 0x0d0f14);           // TV
        R(5.0, 5.65, 3.0, 3.75, 0, 0.45, 'plain', 0x1f8a8f); P(5.45, 5.65, 3.0, 3.75, 0.45, 0.95, 'plain', 0x1f8a8f); // armchair
        P(2.9, 5.3, 3.5, 5.7, 0.02, 0.04, 'plain', acc);                   // rug
        for (const [u, v] of [[3, 3]]) { const [x0, x1, z0b, z1b] = rect2(u - 0.25, u + 0.25, v - 0.25, v + 0.25); part('glow', x0, x1, z0b, z1b, yHi - 0.07, yHi - 0.02, 0xfff3c4); }
        // curtains by the outer-wall window
        for (const dv of [2.65, 4.35]) P(5.6, 5.68, dv, dv + 0.35, 0.3, 2.6, 'plain', acc);
        // ----- bathroom fixtures (u 0..2.4, v 2.4..6) -----
        R(0.5, 1.1, 5.7, 5.95, 0.35, 0.9, 'plain', 0xffffff, false);       // cistern
        { const [x0, x1, z0b, z1b] = rect2(0.45, 1.15, 5.1, 5.75); part('plain', x0, x1, z0b, z1b, y, y + 0.42, 0xffffff); circle((x0 + x1) / 2, (z0b + z1b) / 2, 0.36, y, y + 0.9); }
        P(0.5, 1.1, 5.1, 5.7, 0.42, 0.46, 'plain', 0xf0f0f0);              // seat
        R(1.85, 2.3, 3.0, 4.0, 0, 0.85, 'wood', 0xcdb18a);                 // vanity
        P(1.9, 2.25, 3.2, 3.8, 0.85, 0.9, 'plain', 0xffffff); P(2.0, 2.15, 3.45, 3.55, 0.9, 1.05, 'plain', 0xb8c2c8); // basin + tap
        P(2.33, 2.36, 3.1, 3.9, 1.1, 1.95, 'glass', 0xbfd6e6);             // mirror
        P(1.2, 2.3, 4.4, 5.9, 0, 0.08, 'plain', 0xffffff);                 // shower tray
        P(1.2, 1.24, 4.4, 5.9, 0, 2.0, 'clear', 0xffffff); P(1.2, 2.3, 4.4, 4.44, 0, 2.0, 'clear', 0xffffff); // shower glass
        P(2.25, 2.36, 5.1, 5.3, 1.95, 2.0, 'plain', 0xb8c2c8); P(2.0, 2.3, 5.12, 5.28, 1.9, 1.95, 'plain', 0xb8c2c8); // shower head
        P(0.14, 0.2, 3.1, 3.9, 1.3, 1.36, 'plain', 0xb8c2c8); P(0.14, 0.22, 3.2, 3.5, 0.9, 1.3, 'plain', 0xf2f2f2); P(0.14, 0.22, 3.55, 3.85, 0.9, 1.3, 'plain', acc); // towel rail + towels
        P(0.5, 1.4, 3.0, 3.6, 0.04, 0.06, 'plain', acc);                   // bath mat
        { const [x0, x1, z0b, z1b] = rect2(1.1, 1.5, 2.55, 2.95); part('glow', ...[(x0 + x1) / 2 - 0.2, (x0 + x1) / 2 + 0.2, (z0b + z1b) / 2 - 0.2, (z0b + z1b) / 2 + 0.2, yHi - 0.07, yHi - 0.02, 0xffffff]); }
        out.rooms.push({ id: rid, bath: bid, floor: k, side: s, z0, num });
      });
    }
  }

  // ---------- stairs: ramps for walking + steps for looks ----------
  // Flight 1 (lobby -> floor 1) has its bottom by the corridor mouth and climbs toward the west wall;
  // flight 2 (floor 1 -> 2) starts at the corridor mouth on floor 1 and climbs east. Both are 1.5 m wide in the back bay.
  const flights = [{ base: LV[0], up: LV[1], bottom: -1.4, top: -5.9 }, { base: LV[1], up: LV[2], bottom: 1.4, top: 5.9 }];
  const N = 20, rise = FH / N, zA = -7.8, zB = -6.3;
  flights.forEach(({ base, up, bottom, top }) => {
    const dir = Math.sign(top - bottom), run = Math.abs(top - bottom) / N, lo = Math.min(bottom, top), hi = Math.max(bottom, top);
    for (let i = 0; i < N; i++) {
      const xa = bottom + dir * i * run, xb = bottom + dir * (i + 1) * run, x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), topY = base + (i + 1) * rise;
      part('wood', x0, x1, zA, zB, base, topY, i % 2 ? 0xc9a67a : 0xd2b185);
      part('plain', x0, x1, zB - 0.15, zB, topY, topY + 1.0, 0xf5f1e8);               // stepped balustrade on the open side
    }
    part('wood', lo, hi, zB - 0.17, zB, up + 0.93, up + 1.03, 0x6b4a32);                // handrail cap along the upper floor
    part('plain', bottom - 0.05, bottom + 0.05, zB - 0.17, zB, base, base + 1.1, 0xf5f1e8); // newel post at the bottom
    solid(lo, hi, zB - 0.15, zB, base, up + 1.0);                                       // balustrade = stair side + hole-edge guard
    const o = 0.5 * rise + 0.02, yWest = dir < 0 ? up + o : base + o, yEast = dir < 0 ? base + o : up + o;
    deck(lo, hi, zA, zB - 0.15, 0, { y0: yWest, y1: yEast });                           // walkable ramp (west end -> east end)
  });
  return out;
}
