const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// the real-map file is optional (tools/fetch_osm.mjs creates it): answer "none" instead of a 404 when it is absent
app.get("/data/oldtown_osm.json", (req, res, next) => (fs.existsSync(path.join(__dirname, "public/data/oldtown_osm.json")) ? next() : res.json(null)));
app.use(express.static(path.join(__dirname, "public")));
app.use("/three", express.static(path.join(__dirname, "node_modules/three")));

// Diagnostics: open /health on your site to see which version is live and whether any game file is missing.
const BUILD = "2026-11-13 island + Bhubaneswar Old Town (alpha)";
const REQUIRED = ["bhubaneswar.html", "bbsr.js", "bbsr_plan.js", "bbsr_mesh.js", "bbsr_tex.js", "index.html", "main.js", "island.js", "textures.js", "town.js", "townmesh.js", "hotel.js", "interiors.js", "hud.js", "avatar.js", "customize.js", "weather.js", "atmosphere.js", "audio.js", "foliage.js", "vegetation.js", "voice.js"];
app.get(["/bhubaneswar", "/bbsr"], (req, res) => res.sendFile(path.join(__dirname, "public", "bhubaneswar.html")));
app.get("/health", (req, res) => {
  const files = {};
  for (const f of REQUIRED) { const fp = path.join(__dirname, "public", f); files[f] = fs.existsSync(fp) ? fs.statSync(fp).size : "MISSING"; }
  const threeOk = fs.existsSync(path.join(__dirname, "node_modules/three/build/three.module.js"));
  res.json({ build: BUILD, node: process.version, threeInstalled: threeOk, playersOnline: Object.keys(players).length, perWorld: Object.fromEntries(WORLDS.map((w) => [w, Object.values(players).filter((p) => p.world === w).length])), files });
});

const LIMIT = 2000;
const NEARBY = 45; // metres for nearby chat
const COLORS = [0xd63031, 0x0984e3, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xe84393, 0xe17055, 0x00cec9];
const players = {};
const WORLDS = ["island", "bbsr"];   // bbsr = Bhubaneswar Old Town
// hotel doors that are currently open (id -> true). Open doors close by themselves after a while.
const doors = {}, doorTimers = {};
const DOOR_OPEN_MS = 45000;
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Avatar appearance is a small set of palette indices. Never trust the client: clamp everything.
const ci = (v, lo, hi, d) => (Number.isInteger(v) ? Math.min(hi, Math.max(lo, v)) : d);
function sanitizeAvatar(a) {
  a = a && typeof a === "object" ? a : {};
  const acc = Array.isArray(a.acc) ? a.acc : [];
  return {
    g: ci(a.g, 0, 1, 0), skin: ci(a.skin, 0, 5, 1), hs: ci(a.hs, 0, 5, 1), hc: ci(a.hc, 0, 7, 0), face: ci(a.face, 0, 3, 0),
    top: ci(a.top, 0, 2, 0), tc: ci(a.tc, 0, 11, 0), bot: ci(a.bot, 0, 1, 0), bc: ci(a.bc, 0, 7, 0), shoe: ci(a.shoe, 0, 5, 0),
    acc: [0, 1, 2, 3, 4].map((i) => (acc[i] ? 1 : 0)),
  };
}

io.on("connection", (socket) => {
  let player = null, world = "island";

  socket.on("join", (data) => {
    if (player) return;
    const name =
      String((data && data.name) || "Player")
        .replace(/[^\p{L}\p{N} _.\-]/gu, "")
        .trim()
        .slice(0, 16) || "Player";
    world = data && WORLDS.includes(data.world) ? data.world : "island";
    socket.join(world);
    player = {
      id: socket.id,
      world,
      name,
      avatar: sanitizeAvatar(data && data.avatar),
      x: 0, y: 0, z: 0, ry: 0, em: 0,
      hasPos: false,
    };
    players[socket.id] = player;
    const here = {};
    for (const p of Object.values(players)) if (p.world === world) here[p.id] = p;
    socket.emit("init", { selfId: socket.id, players: here, serverTime: Date.now(), doors: world === "island" ? doors : {} }); // the shared clock drives the weather
    socket.to(world).emit("playerJoined", player);
  });

  socket.on("move", (m) => {
    if (!player || !m || !isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.ry)) return;
    if (Math.abs(m.x) > LIMIT || Math.abs(m.z) > LIMIT || m.y < -100 || m.y > 1000) return;
    const em = Number.isInteger(m.em) && m.em >= 0 && m.em <= 10 ? m.em : 0; // 1-9 emotes, 10 = seated on a bench
    player.x = m.x; player.y = m.y; player.z = m.z; player.ry = m.ry; player.em = em;
    player.hasPos = true;
    socket.to(world).emit("playerMoved", { id: player.id, x: m.x, y: m.y, z: m.z, ry: m.ry, em });
  });

  // voice chat handshakes (WebRTC offers/answers/ICE) are only relayed; the audio itself never touches the server
  let rtcCount = 0, rtcWindow = Date.now();
  socket.on("rtc", (m) => {
    if (!player || !m || typeof m.to !== "string" || !players[m.to] || players[m.to].world !== world || !["offer", "answer", "candidate"].includes(m.kind)) return;
    if (Date.now() - rtcWindow > 1000) { rtcWindow = Date.now(); rtcCount = 0; }
    if (++rtcCount > 80) return; // basic flood protection
    io.to(m.to).emit("rtc", { from: socket.id, kind: m.kind, data: m.data });
  });

  socket.on("door", (d) => {
    if (!player || world !== "island" || !d || typeof d.id !== "string" || !/^[a-z0-9_]{1,24}$/.test(d.id) || typeof d.open !== "boolean") return;
    clearTimeout(doorTimers[d.id]);
    if (d.open) {
      doors[d.id] = true;
      doorTimers[d.id] = setTimeout(() => { delete doors[d.id]; io.emit("door", { id: d.id, open: false }); }, DOOR_OPEN_MS);
    } else delete doors[d.id];
    socket.broadcast.emit("door", { id: d.id, open: d.open });
  });

  socket.on("avatar", (a) => {
    if (!player) return;
    player.avatar = sanitizeAvatar(a);
    socket.to(world).emit("playerAvatar", { id: player.id, avatar: player.avatar });
  });

  socket.on("chat", (data) => {
    if (!player) return;
    const raw = typeof data === "string" ? data : data && data.text;
    if (typeof raw !== "string") return;
    const text = raw.trim().slice(0, 200);
    if (!text) return;
    if (data && data.scope === "nearby") {
      // only people within NEARBY metres (and the sender) get it
      const msg = { id: player.id, name: player.name, text, scope: "nearby" };
      socket.emit("chat", msg);
      for (const p of Object.values(players)) {
        if (p.world !== world || p.id === player.id || !p.hasPos || !player.hasPos) continue;
        if (Math.hypot(p.x - player.x, p.z - player.z) <= NEARBY) io.to(p.id).emit("chat", msg);
      }
    } else {
      io.to(world).emit("chat", { id: player.id, name: player.name, text, scope: "all" });
    }
  });

  socket.on("disconnect", () => {
    if (!player) return;
    delete players[socket.id];
    io.to(player.world).emit("playerLeft", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Island world running on http://localhost:${PORT}`));
