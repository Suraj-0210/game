const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use("/three", express.static(path.join(__dirname, "node_modules/three")));

const LIMIT = 2000;
const NEARBY = 45; // metres for nearby chat
const COLORS = [0xd63031, 0x0984e3, 0x00b894, 0xfdcb6e, 0x6c5ce7, 0xe84393, 0xe17055, 0x00cec9];
const players = {};
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
  let player = null;

  socket.on("join", (data) => {
    if (player) return;
    const name =
      String((data && data.name) || "Player")
        .replace(/[^\p{L}\p{N} _.\-]/gu, "")
        .trim()
        .slice(0, 16) || "Player";
    player = {
      id: socket.id,
      name,
      avatar: sanitizeAvatar(data && data.avatar),
      x: 0, y: 0, z: 0, ry: 0, em: 0,
      hasPos: false,
    };
    players[socket.id] = player;
    socket.emit("init", { selfId: socket.id, players });
    socket.broadcast.emit("playerJoined", player);
  });

  socket.on("move", (m) => {
    if (!player || !m || !isNum(m.x) || !isNum(m.y) || !isNum(m.z) || !isNum(m.ry)) return;
    if (Math.abs(m.x) > LIMIT || Math.abs(m.z) > LIMIT || m.y < -100 || m.y > 1000) return;
    const em = Number.isInteger(m.em) && m.em >= 0 && m.em <= 10 ? m.em : 0; // 1-9 emotes, 10 = seated on a bench
    player.x = m.x; player.y = m.y; player.z = m.z; player.ry = m.ry; player.em = em;
    player.hasPos = true;
    socket.broadcast.emit("playerMoved", { id: player.id, x: m.x, y: m.y, z: m.z, ry: m.ry, em });
  });

  socket.on("avatar", (a) => {
    if (!player) return;
    player.avatar = sanitizeAvatar(a);
    socket.broadcast.emit("playerAvatar", { id: player.id, avatar: player.avatar });
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
        if (p.id === player.id || !p.hasPos || !player.hasPos) continue;
        if (Math.hypot(p.x - player.x, p.z - player.z) <= NEARBY) io.to(p.id).emit("chat", msg);
      }
    } else {
      io.emit("chat", { id: player.id, name: player.name, text, scope: "all" });
    }
  });

  socket.on("disconnect", () => {
    if (!player) return;
    delete players[socket.id];
    io.emit("playerLeft", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Island world running on http://localhost:${PORT}`));