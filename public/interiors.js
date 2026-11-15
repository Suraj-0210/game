// Interiors for the café, shop, rentals and games hall (pure data, no rendering).
// Each building gets hollow walls, a front door that opens with E, windows, furniture and a staff member to talk to.
// Building-local axes: x to the right, z toward the sea (the front), y absolute.
export const INTERIOR_IDS = ['rentals', 'cafe', 'games', 'shop'];

export function planInteriors(ctx) {
  const { toW, theta, deckY, buildings } = ctx;
  const out = { parts: [], doors: [], lamps: [], signs: [], tops: [], npcs: [], boxes: [], circles: [], decks: [], interactables: [] };

  function make(b) {
    const y = deckY, hw = b.w / 2, hd = b.d / 2, yHi = y + b.h - 0.3, T = 0.25;
    const IX = hw - 0.125, IZ = hd - 0.125;
    const L = (x, z) => [b.x + x, b.z + z];
    const W = (x, z) => { const [lx, lz] = L(x, z); return toW(lx, lz); };
    const H = { b, y, hw, hd, yHi, IX, IZ };
    H.part = (mat, x0, x1, z0, z1, y0, y1, color = 0xffffff) => {
      if (x1 - x0 < 1e-4 || z1 - z0 < 1e-4 || y1 - y0 < 1e-4) return;
      out.parts.push({ mat, lx: b.x + (x0 + x1) / 2, lz: b.z + (z0 + z1) / 2, w: x1 - x0, d: z1 - z0, y: (y0 + y1) / 2, h: y1 - y0, color });
    };
    H.solid = (x0, x1, z0, z1, y0, y1, extra = {}) => {
      const p = W((x0 + x1) / 2, (z0 + z1) / 2), bx = { x: p.x, z: p.z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, theta, y0, y1, ...extra };
      out.boxes.push(bx); return bx;
    };
    H.item = (mat, x0, x1, z0, z1, y0, y1, color, collide = true) => { H.part(mat, x0, x1, z0, z1, y0, y1, color); if (collide) H.solid(x0, x1, z0, z1, y0, y1); };
    H.circle = (x, z, r, y0, y1) => { const p = W(x, z); out.circles.push({ x: p.x, z: p.z, r, y0, y1 }); };
    H.deck = (x0, x1, z0, z1, yy) => { const p = W((x0 + x1) / 2, (z0 + z1) / 2); out.decks.push({ x: p.x, z: p.z, hw: (x1 - x0) / 2, hd: (z1 - z0) / 2, theta, y: yy }); };
    H.lamp = (x, z, yy) => { const [lx, lz] = L(x, z); out.lamps.push({ lx, lz, y: yy }); };
    H.sign = (name, x, z, yy, w, h) => { const [lx, lz] = L(x, z); out.signs.push({ name, lx, lz, y: yy, w, h }); };
    H.top = (kind, x, z, yy, size) => { const [lx, lz] = L(x, z); out.tops.push({ kind, lx, lz, y: yy, size }); };
    H.npc = (def) => {
      const [lx, lz] = L(def.x, def.z), p = W(def.x, def.z), q = W(def.x, def.z + def.talkDz);
      out.npcs.push({ id: def.id, name: def.name, cfg: def.cfg, lx, lz, y, faceZ: def.faceZ ?? 1, lines: def.lines });
      H.circle(def.x, def.z, 0.32, y, y + 1.9);
      out.interactables.push({ id: 'talk_' + def.id, type: 'npc', npc: def.id, x: q.x, z: q.z, y, radius: def.radius || 3.0, dy: 1.7, label: def.label });
    };
    // wall with openings (windows are see-through but solid; door gaps are open)
    H.wall = (axis, c, a0, a1, yLo, yHi2, gaps, o = {}) => {
      const t = o.t || 0.15;
      const rect = (s0, s1, y0, y1, mat, color, o0, o1) => (axis === 'x' ? H.part(mat, s0, s1, c + o0, c + o1, y0, y1, color) : H.part(mat, c + o0, c + o1, s0, s1, y0, y1, color));
      const sol = (s0, s1, y0, y1) => (axis === 'x' ? H.solid(s0, s1, c - t / 2, c + t / 2, y0, y1) : H.solid(c - t / 2, c + t / 2, s0, s1, y0, y1));
      const emit = (s0, s1, y0, y1) => {
        if (s1 - s0 < 1e-3 || y1 - y0 < 1e-3) return;
        const es = o.ext;
        rect(s0, s1, y0, y1, 'wall', o.outer, es > 0 ? t / 2 - 0.12 : -t / 2, es > 0 ? t / 2 : -t / 2 + 0.12);
        rect(s0, s1, y0, y1, 'plain', o.inner, es > 0 ? -t / 2 : -t / 2 + 0.12, es > 0 ? t / 2 - 0.12 : t / 2);
        sol(s0, s1, y0, y1);
      };
      let cur = a0;
      for (const g of gaps.slice().sort((p, q) => p.a - q.a)) {
        emit(cur, g.a, yLo, yHi2);
        if (!g.door) emit(g.a, g.b, yLo, g.y0);
        emit(g.a, g.b, g.y1, yHi2);
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
      emit(cur, a1, yLo, yHi2);
    };
    // shell: walls, front door, floor, ceiling
    H.shell = ({ doorW = 1.7, front, side, back, inner = 0xf4eadb, floorMat = 'wood', floorColor = 0xb98a5a }) => {
      const win = (a, bb, y0 = y + 0.9, y1 = y + 2.5) => ({ a, b: bb, y0, y1, window: true });
      const ext = { outer: b.wall, inner, t: T };
      H.wall('x', hd, -hw, hw, y - 0.1, yHi, [{ a: -doorW / 2, b: doorW / 2, y0: y, y1: y + 2.3, door: true }, ...front.map((f) => win(...f))], { ...ext, ext: 1 });
      H.wall('x', -hd, -hw, hw, y - 0.1, yHi, back.map((f) => win(...f)), { ...ext, ext: -1 });
      H.wall('z', -hw, -hd, hd, y - 0.1, yHi, side.map((f) => win(...f)), { ...ext, ext: -1 });
      H.wall('z', hw, -hd, hd, y - 0.1, yHi, side.map((f) => win(...f)), { ...ext, ext: 1 });
      H.part('plain', -hw, hw, -hd, hd, yHi, yHi + 0.3, 0xf0ebe0); H.solid(-hw, hw, -hd, hd, yHi, yHi + 0.3, { fly: true });
      H.part(floorMat, -IX, IX, -IZ, IZ, y, y + 0.02, floorColor);
      H.deck(-IX, IX, -IZ, IZ, y + 0.02);
      // the front door: one leaf hinged on the left, swings inward
      const id = b.id + '_front';
      out.doors.push({ id, group: id, lx: b.x - doorW / 2, lz: b.z + hd, y, dx: 1, dz: 0, len: doorW, h: 2.2, open: Math.PI / 2, glass: false, color: 0x5a3a24 });
      H.solid(-doorW / 2, doorW / 2, hd - 0.07, hd + 0.07, y, y + 2.3, { door: id });
      const p = W(0, hd);
      out.interactables.push({ id: 'door_' + id, type: 'door', door: id, x: p.x, z: p.z, y, radius: 1.9, dy: 1.7, labels: [`Open the ${b.id === 'games' ? 'games hall' : b.id} door`, `Close the ${b.id === 'games' ? 'games hall' : b.id} door`], name: b.sign });
    };
    return H;
  }

  const SKINCFG = (o) => ({ g: 0, skin: 1, hs: 0, hc: 0, face: 0, top: 0, tc: 0, bot: 0, bc: 0, shoe: 1, acc: [0, 0, 0, 0, 0], ...o });
  const rnd = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const PAL = [0xe63946, 0xf4a261, 0xf4c20d, 0x2a9d4a, 0x1d8fe1, 0x8e44ad, 0xe84393, 0x1abc9c];

  // ---------------- café ----------------
  function cafe(H) {
    const { y, yHi, IX, IZ } = H, P = H.part, I = H.item;
    H.shell({ front: [[-3.7, -1.5], [1.5, 3.7]], side: [[-1.5, 1.5]], back: [[2.6, 4.0]], inner: 0xf6e9d3, floorMat: 'wood', floorColor: 0xb98a5a });
    // counter with a pastry case and espresso machine, shelves and a menu board behind
    I('wood', -3.8, 1.0, -2.2, -1.3, y, y + 1.05, 0x5a3a24); P('plain', -3.9, 1.1, -2.3, -1.2, y + 1.05, y + 1.1, 0xf1ece4);
    P('clear', -3.4, -1.6, -2.15, -1.45, y + 1.1, y + 1.65, 0xffffff);
    const r = rnd(5); for (let i = 0; i < 5; i++) P('plain', -3.3 + i * 0.34, -3.3 + i * 0.34 + 0.26, -2.05, -1.65, y + 1.12, y + 1.3, PAL[Math.floor(r() * PAL.length)]);
    P('plain', -0.2, 0.5, -2.1, -1.6, y + 1.1, y + 1.55, 0xb8c2c8); P('plain', -0.05, 0.35, -1.65, -1.55, y + 1.1, y + 1.3, 0x222222);
    for (const yy of [1.3, 1.8, 2.3]) { P('wood', -3.8, 0.9, -3.8, -3.45, y + yy, y + yy + 0.05, 0x6b4a32); for (let i = 0; i < 9; i++) P('plain', -3.7 + i * 0.5, -3.7 + i * 0.5 + 0.2, -3.7, -3.5, y + yy + 0.05, y + yy + 0.28, PAL[(i + Math.floor(yy * 3)) % PAL.length]); }
    P('plain', 1.3, 3.9, -3.86, -3.8, y + 1.15, y + 2.55, 0x232a2e); H.sign('cafe_menu', 2.6, -3.78, y + 1.85, 2.4, 0.75);
    for (const x of [-3.2, -2.2, -1.2]) I('plain', x - 0.22, x + 0.22, -1.05, -0.65, y, y + 0.72, 0xb5532f);   // bar stools
    // tables and chairs
    const chair = (cx, cz, dir) => { I('plain', cx - 0.2, cx + 0.2, cz - 0.2, cz + 0.2, y, y + 0.46, 0x3a3f47); P('plain', dir > 0 ? cx - 0.2 : cx + 0.14, dir > 0 ? cx - 0.14 : cx + 0.2, cz - 0.2, cz + 0.2, y + 0.46, y + 0.95, 0x3a3f47); };
    const tableSet = (cx, cz) => { I('wood', cx - 0.45, cx + 0.45, cz - 0.45, cz + 0.45, y, y + 0.77, 0x8a6540); P('plain', cx - 0.06, cx + 0.06, cz - 0.06, cz + 0.06, y, y + 0.72, 0x2d3436); P('glow', cx - 0.07, cx + 0.07, cz - 0.07, cz + 0.07, y + 0.77, y + 0.9, 0xffe7a3); chair(cx - 0.8, cz, 1); chair(cx + 0.8, cz, -1); H.lamp(cx, cz, yHi - 0.5); };
    tableSet(-3.0, 1.9); tableSet(-0.6, 2.3); tableSet(2.5, 0.6); tableSet(2.9, 2.9 - 0.4);
    for (const [px, pz] of [[-4.0, 3.5], [4.0, -3.4], [-4.0, -3.4]]) { H.part('plain', px - 0.25, px + 0.25, pz - 0.25, pz + 0.25, y, y + 0.5, 0xb5532f); H.part('plain', px - 0.4, px + 0.4, pz - 0.4, pz + 0.4, y + 0.5, y + 1.4, 0x2f7d3a); H.circle(px, pz, 0.38, y, y + 1.4); }
    H.lamp(-2, -1, yHi - 0.05); H.lamp(2, -2, yHi - 0.05);
    H.npc({ id: 'rosa', name: 'Rosa · Café', x: -1.5, z: -2.95, talkDz: 1.9, faceZ: 1, label: 'Order a drink', cfg: SKINCFG({ g: 1, skin: 3, hs: 4, hc: 1, face: 1, top: 2, tc: 11, bc: 7, acc: [0, 0, 0, 0, 0] }),
      lines: ["Welcome to the café! Fresh coconut water, mango lassi, filter coffee and cold brew today.", 'The mango lassi is my favourite. Ordering from the menu is coming soon!', 'Grab a table by the window. The view of the beach is the best in town.'] });
  }

  // ---------------- shop ----------------
  function shop(H) {
    const { y, yHi } = H, P = H.part, I = H.item, r = rnd(11);
    H.shell({ front: [[-3.7, -1.5], [1.5, 3.7]], side: [[-1.5, 1.5]], back: [[1.5, 3.5]], inner: 0xfaf3df, floorMat: 'stone', floorColor: 0xe6dfd0 });
    const products = (axis, c, a0, a1, face) => { // a shelving unit with products
      const d = 0.45, x0 = axis === 'z' ? c - d / 2 : a0, x1 = axis === 'z' ? c + d / 2 : a1, z0 = axis === 'x' ? c - d / 2 : a0, z1 = axis === 'x' ? c + d / 2 : a1;
      I('wood', x0, x1, z0, z1, y, y + 0.1, 0x6b4a32);
      P('wood', x0, x1, z0, z1, y + 0.1, y + 2.1, 0x8a6540, false); H.solid(x0, x1, z0, z1, y, y + 2.1);
      for (const yy of [0.5, 1.0, 1.5, 2.0]) {
        P('wood', x0 - (axis === 'z' && face < 0 ? 0 : 0), x1, z0, z1, y + yy, y + yy + 0.04, 0xa07848);
        for (let t = a0 + 0.15; t < a1 - 0.2; t += 0.32) {
          const col = PAL[Math.floor(r() * PAL.length)], hgt = 0.18 + r() * 0.16;
          if (axis === 'z') P('plain', face > 0 ? c + 0.02 : c - 0.02 - 0.18, face > 0 ? c + 0.02 + 0.18 : c - 0.02, t, t + 0.22, y + yy + 0.04, y + yy + 0.04 + hgt, col);
          else P('plain', t, t + 0.22, face > 0 ? c + 0.02 : c - 0.02 - 0.18, face > 0 ? c + 0.02 + 0.18 : c - 0.02, y + yy + 0.04, y + yy + 0.04 + hgt, col);
        }
      }
    };
    products('z', -4.05, -3.5, 1.0, 1);      // left wall (products face the room: +x)
    products('z', 4.05, -3.5, 3.0, -1);      // right wall (face -x)
    products('x', -3.8, -3.4, 0.5, 1);       // back wall, left part
    // clothing rack
    P('plain', -2.2, -2.14, 0.6, 0.66, y, y + 1.6, 0x888888); P('plain', -0.86, -0.8, 0.6, 0.66, y, y + 1.6, 0x888888); P('plain', -2.2, -0.8, 0.6, 0.66, y + 1.55, y + 1.6, 0x888888);
    H.solid(-2.2, -0.8, 0.55, 0.7, y, y + 1.7);
    for (let i = 0; i < 8; i++) P('plain', -2.1 + i * 0.16, -2.1 + i * 0.16 + 0.05, 0.58, 0.68, y + 0.8, y + 1.5, PAL[i % PAL.length]);
    // display tables with goods
    for (const [tx, tz] of [[1.0, 0.0], [1.0, 2.1]]) {
      I('wood', tx - 0.8, tx + 0.8, tz - 0.45, tz + 0.45, y, y + 0.85, 0x8a6540);
      for (let i = 0; i < 5; i++) P('plain', tx - 0.65 + i * 0.3, tx - 0.65 + i * 0.3 + 0.22, tz - 0.2, tz + 0.2, y + 0.85, y + 1.05 + (i % 2) * 0.1, PAL[(i + 2) % PAL.length]);
    }
    // counter + till
    I('wood', 1.0, 3.6, -2.6, -1.8, y, y + 1.05, 0x4a2f1c); P('plain', 0.9, 3.7, -2.7, -1.7, y + 1.05, y + 1.1, 0xf1ece4); P('plain', 1.4, 2.0, -2.5, -2.1, y + 1.1, y + 1.4, 0x2d3436);
    H.lamp(-2, -1, yHi - 0.05); H.lamp(2, 1, yHi - 0.05); H.lamp(-2, 2.2, yHi - 0.05);
    H.npc({ id: 'ravi', name: 'Ravi · Shop', x: 2.3, z: -3.25, talkDz: 1.9, faceZ: 1, label: 'Browse the shop', radius: 3.2, cfg: SKINCFG({ g: 0, skin: 3, hs: 0, hc: 0, face: 3, top: 2, tc: 8, bc: 4, acc: [0, 0, 0, 0, 0] }),
      lines: ['Namaste! Welcome to the island shop. Hats, towels, snacks and souvenirs.', 'Everything here will be buyable with island coins once the economy is ready.', 'Try the coconut candy. It is the best seller!'] });
  }

  // ---------------- rentals ----------------
  function rentals(H) {
    const { y, yHi } = H, P = H.part, I = H.item;
    H.shell({ front: [[-3.2, -1.4], [1.4, 3.2]], side: [[-1, 1.8]], back: [[1.6, 3.2]], inner: 0xf3efe6, floorMat: 'stone', floorColor: 0xd9c9a3 });
    P('wood', -3.3, 1.3, -3.3, -2.95, y, y + 0.12, 0x6b4a32); P('wood', -3.3, 1.3, -3.3, -2.95, y + 2.35, y + 2.45, 0x6b4a32); H.solid(-3.3, 1.3, -3.3, -2.9, y, y + 2.5);
    [0xe63946, 0x1d8fe1, 0xf4c20d, 0x2a9d4a, 0xe84393, 0xf4a261, 0x1abc9c].forEach((c, i) => P('plain', -3.1 + i * 0.6, -3.1 + i * 0.6 + 0.5, -3.2, -3.1, y + 0.12, y + (i > 4 ? 2.4 : 2.1), c));   // surfboards
    I('plain', -3.5, -1.0, 0.3, 0.75, y, y + 0.4, 0xf4c20d); I('plain', -3.5, -1.0, 1.1, 1.55, y, y + 0.4, 0xe63946);                // kayaks
    P('plain', 3.75, 3.8, -1.2, 2.2, y + 1.7, y + 1.78, 0x888888); for (let i = 0; i < 6; i++) P('plain', 3.5, 3.72, -1.1 + i * 0.55, -1.1 + i * 0.55 + 0.42, y + 1.0, y + 1.7, 0xf5822a);   // life vests
    H.solid(3.5, 3.8, -1.2, 2.2, y, y + 1.8);
    I('wood', -3.85, -3.45, 0.0, 2.8, y, y + 1.6, 0x8a6540);
    for (let i = 0; i < 6; i++) P('plain', -3.4, -3.15, 0.1 + i * 0.45, 0.45 + i * 0.45, y + 0.8 + (i % 3) * 0.3, y + 1.0 + (i % 3) * 0.3, PAL[i % PAL.length]); // snorkels + flippers on the shelf
    I('wood', 1.4, 3.6, -2.0, -1.2, y, y + 1.05, 0x4a2f1c); P('plain', 1.3, 3.7, -2.1, -1.1, y + 1.05, y + 1.1, 0xf1ece4);
    H.sign('rentals_prices', 0, -3.3, y + 2.9, 3.0, 0.9);
    H.lamp(-1, 0, yHi - 0.05); H.lamp(2, 1, yHi - 0.05);
    H.npc({ id: 'kai', name: 'Kai · Rentals', x: 2.5, z: -2.7, talkDz: 1.8, faceZ: 1, label: 'Rent a board', cfg: SKINCFG({ g: 0, skin: 2, hs: 2, hc: 3, face: 2, top: 2, tc: 5, bot: 1, bc: 4, acc: [1, 0, 0, 0, 0] }),
      lines: ['Hey! Surfboards, paddleboards, kayaks and snorkels. Whatever you like.', 'Renting gear is coming soon. For now, take a look around the racks!', 'The best waves are off the west point, near the lighthouse.'] });
  }

  // ---------------- games hall ----------------
  function games(H) {
    const { y, yHi, hw } = H, P = H.part, I = H.item;
    H.shell({ doorW: 2.2, front: [[-5.5, -2.2], [2.2, 5.5]], side: [[-1.5, 1.5]], back: [[-5.0, -3.5], [3.5, 5.0]], inner: 0xcdbfe8, floorMat: 'plain', floorColor: 0x3a2a5a });
    P('plain', -2.0, 2.0, 1.5, 3.9, y + 0.02, y + 0.04, 0x7a2f6a);   // welcome rug
    // three Ludo tables
    [-3.7, 0, 3.7].forEach((tx, i) => {
      const tz = 0.4;
      P('plain', tx - 0.2, tx + 0.2, tz - 0.2, tz + 0.2, y, y + 0.74, 0x5a3a24); P('plain', tx - 0.7, tx + 0.7, tz - 0.7, tz + 0.7, y, y + 0.08, 0x5a3a24);
      H.top('ludo', tx, tz, y + 0.78, 1.95);
      H.circle(tx, tz, 1.15, y, y + 0.9);
      [[0, -1.5], [1.5, 0], [0, 1.5], [-1.5, 0]].forEach(([dx, dz], k) => { I('plain', tx + dx - 0.28, tx + dx + 0.28, tz + dz - 0.28, tz + dz + 0.28, y, y + 0.45, [0xe63946, 0x2a9d4a, 0xf4c20d, 0x1d6fd8][k]); });
      const q = toW(H.b.x + tx, H.b.z + tz + 1.9);
      out.interactables.push({ id: 'ludo_hall_' + (i + 1), type: 'ludo', soon: true, x: q.x, z: q.z, y, radius: 3.0, dy: 1.7, label: 'Play Ludo' });
    });
    // two chess tables
    [[-4.6, -2.0], [-2.2, -2.5]].forEach(([tx, tz], i) => {
      P('plain', tx - 0.12, tx + 0.12, tz - 0.12, tz + 0.12, y, y + 0.72, 0x2d3436); H.top('chess', tx, tz, y + 0.76, 0.95);
      H.circle(tx, tz, 0.75, y, y + 0.85);
      for (const dz of [-0.85, 0.85]) I('plain', tx - 0.22, tx + 0.22, tz + dz - 0.22, tz + dz + 0.22, y, y + 0.46, 0x3a3f47);
      const q = toW(H.b.x + tx + 1.4, H.b.z + tz + 0.4);
      out.interactables.push({ id: 'chess_hall_' + (i + 1), type: 'chess', soon: true, x: q.x, z: q.z, y, radius: 2.4, dy: 1.7, label: 'Play chess' });
    });
    // bar counter with the host + neon sign
    I('wood', 2.0, 5.5, -2.7, -1.9, y, y + 1.05, 0x2d1f3d); P('plain', 1.9, 5.6, -2.8, -1.8, y + 1.05, y + 1.1, 0xf1ece4);
    H.sign('games', 0, -3.82, y + 2.7, 4.6, 1.44);
    P('plain', -5.8, -5.74, -0.8, 2.0, y + 1.1, y + 2.3, 0x1a1428); H.sign('scoreboard', -5.72, 0.6, y + 1.7, 2.6, 0.9);
    for (const [bx, bz, c] of [[5.0, 1.4, 0xe84393], [5.2, 2.7, 0x1abc9c], [4.3, 3.2, 0xf4c20d]]) I('plain', bx - 0.45, bx + 0.45, bz - 0.4, bz + 0.4, y, y + 0.5, c);   // bean bags
    for (const [x0, x1, c] of [[-5.4, -0.2, 0xff4fd8], [0.2, 5.4, 0x4fd8ff]]) P('glow', x0, x1, -0.15, 0.15, yHi - 0.07, yHi - 0.02, c);
    H.lamp(-3.7, 2.5, yHi - 0.05); H.lamp(3.7, 2.5, yHi - 0.05); H.lamp(0, -2, yHi - 0.05);
    H.npc({ id: 'leo', name: 'Leo · Games', x: 3.7, z: -3.25, talkDz: 2.2, faceZ: 1, label: 'Ask about the games', radius: 3.4, cfg: SKINCFG({ g: 0, skin: 4, hs: 1, hc: 2, face: 0, top: 1, tc: 5, bc: 0, acc: [0, 1, 0, 0, 0] }),
      lines: ['Welcome to the games hall! Ludo for up to four players, and chess for two.', 'Sit at a table and press E. Real multiplayer Ludo is coming very soon!', 'Friends can join the same table from anywhere on the island.'] });
  }

  const BUILD = { cafe, shop, rentals, games };
  for (const b of buildings) { if (BUILD[b.id]) BUILD[b.id](make(b)); }
  return out;
}
