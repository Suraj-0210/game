// HUD: minimap, emote bar, interaction prompt, toasts and the tabbed chat panel.
import { SIZE, HALF } from './island.js';

import { EMOTE_DEFS } from './avatar.js';
export const EMOTES = EMOTE_DEFS;

export function createHUD({ isTouch, onEmote, onInteract, onChatSubmit }) {
  const $ = (id) => document.getElementById(id);
  const state = { tab: 'all', msgs: [], chatOpen: false, bigMap: false, activeEmote: 0 };

  // ---------- chat ----------
  const logEl = $('chatlog'), form = $('chatForm'), input = $('msg'), hint = $('chatHint');
  const renderChat = () => {
    logEl.innerHTML = '';
    const list = state.msgs.filter((m) => state.tab === 'all' || m.scope === 'nearby').slice(-(isTouch && !state.chatOpen ? 4 : 8));
    for (const m of list) {
      const d = document.createElement('div');
      if (m.name) {
        const n = document.createElement('b'); n.textContent = m.name + ': '; n.className = m.scope === 'nearby' ? 'near' : '';
        d.appendChild(n); d.appendChild(document.createTextNode(m.text));
      } else { d.textContent = m.text; d.className = 'sys'; }
      logEl.appendChild(d);
    }
    logEl.scrollTop = logEl.scrollHeight;
  };
  const setTab = (t) => {
    state.tab = t;
    document.querySelectorAll('#chatTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
    input.placeholder = t === 'nearby' ? 'Say something to people nearby...' : 'Say something to everyone...';
    renderChat();
  };
  document.querySelectorAll('#chatTabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
  input.addEventListener('keydown', (e) => { if (e.code === 'Tab') { e.preventDefault(); setTab(state.tab === 'all' ? 'nearby' : 'all'); } });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    if (text) onChatSubmit(text, state.tab === 'nearby' ? 'nearby' : 'all');
  });
  const chatHandlers = {
    open() { state.chatOpen = true; form.style.display = 'flex'; hint.style.display = 'none'; $('chat').classList.add('open'); renderChat(); input.focus(); },
    close() { state.chatOpen = false; input.blur(); form.style.display = 'none'; hint.style.display = ''; $('chat').classList.remove('open'); renderChat(); },
  };
  hint.addEventListener('click', () => onInteract && window.dispatchEvent(new CustomEvent('hud-open-chat')));
  setTab('all');

  // ---------- emote bar ----------
  const bar = $('emotes');
  EMOTES.forEach((e) => {
    const b = document.createElement('button');
    b.className = 'emote'; b.dataset.id = e.id; b.title = e.name;
    b.innerHTML = `<span class="ic">${e.icon}</span><span class="k">${e.id}</span>`;
    const fire = (ev) => { ev.preventDefault(); ev.stopPropagation(); onEmote(e.id); if (isTouch) bar.classList.remove('show'); };
    b.addEventListener('touchstart', fire, { passive: false });
    b.addEventListener('mousedown', fire);
    bar.appendChild(b);
  });
  const emoteToggle = $('btnEmote');
  if (emoteToggle) emoteToggle.addEventListener('touchstart', (e) => { e.preventDefault(); bar.classList.toggle('show'); }, { passive: false });

  // ---------- interaction prompt + toast ----------
  const promptEl = $('interact'), labelEl = $('ilabel');
  let promptLabel = null;
  const fireInteract = (e) => { e.preventDefault(); e.stopPropagation(); onInteract(); };
  promptEl.addEventListener('touchstart', fireInteract, { passive: false });
  promptEl.addEventListener('mousedown', fireInteract);
  let toastTimer = 0;
  const toastEl = $('toast');

  // ---------- minimap ----------
  const cv = $('minimap'), ctx = cv.getContext('2d');
  let WS = SIZE, WH = HALF, VIEW = 520;   // world size, half-size and small-map view width in metres (the island by default)
  let base = null, landmarks = [], dpr = Math.min(window.devicePixelRatio || 1, 2);
  const sizeMap = () => {
    const css = state.bigMap ? Math.round(Math.min(innerWidth, innerHeight) * 0.82) : isTouch ? 112 : 172;
    cv.style.width = cv.style.height = css + 'px';
    cv.width = cv.height = Math.round(css * dpr);
  };
  addEventListener('resize', sizeMap);
  sizeMap();

  const RAMP = [[-30, [20, 70, 112]], [-12, [30, 104, 150]], [-4, [46, 148, 178]], [-0.6, [88, 190, 196]], [0.05, [118, 206, 202]], [0.35, [236, 220, 172]], [1.6, [226, 208, 156]], [3.2, [130, 168, 88]], [14, [88, 134, 62]], [30, [64, 104, 48]], [40, [118, 110, 98]], [56, [170, 164, 154]]];
  const colorAt = (h) => {
    if (h <= RAMP[0][0]) return RAMP[0][1];
    for (let i = 1; i < RAMP.length; i++) if (h <= RAMP[i][0]) {
      const [h0, c0] = RAMP[i - 1], [h1, c1] = RAMP[i], t = (h - h0) / (h1 - h0);
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
    }
    return RAMP[RAMP.length - 1][1];
  };
  // A world that draws its own map (the city): a square canvas covering [-size/2, size/2] on both axes
  const initMinimapImage = (canvas, size, lms) => { base = canvas; WS = size; WH = size / 2; VIEW = 360; landmarks = lms; };
  const initMinimap = (terrain, lms) => {
    landmarks = lms; WS = SIZE; WH = HALF; VIEW = 520;
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d'), img = g.createImageData(N, N), n = terrain.n, step = terrain.step;
    const L = [-0.45, 0.78, -0.43], ll = Math.hypot(...L);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const wx = -HALF + ((i + 0.5) * SIZE) / N, wz = -HALF + ((j + 0.5) * SIZE) / N;
      const gi = Math.min(n - 1, Math.max(0, Math.round((wx + HALF) / step))), gj = Math.min(n - 1, Math.max(0, Math.round((wz + HALF) / step)));
      const k = gj * n + gi, h = terrain.h[k];
      let col = colorAt(h), shade = 1;
      if (h > 0.2) shade = 0.72 + 0.5 * Math.max(0, (terrain.nrm[k * 3] * L[0] + terrain.nrm[k * 3 + 1] * L[1] + terrain.nrm[k * 3 + 2] * L[2]) / ll);
      const o = (j * N + i) * 4;
      img.data[o] = Math.min(255, col[0] * shade); img.data[o + 1] = Math.min(255, col[1] * shade); img.data[o + 2] = Math.min(255, col[2] * shade); img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    base = c;
  };

  const drawIcon = (kind, x, y, r) => {
    ctx.save(); ctx.translate(x, y); ctx.lineWidth = r * 0.28; ctx.strokeStyle = 'rgba(0,0,0,.65)';
    if (kind === 'town') { ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(r * 0.7, r * 0.9); ctx.lineTo(-r * 0.7, r * 0.9); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    else if (kind === 'lighthouse') { ctx.fillStyle = '#ff5e57'; ctx.beginPath(); ctx.moveTo(-r * 0.5, r); ctx.lineTo(-r * 0.25, -r); ctx.lineTo(r * 0.25, -r); ctx.lineTo(r * 0.5, r); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    else if (kind === 'games') { ctx.fillStyle = '#a29bfe'; ctx.beginPath(); ctx.roundRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6, r * 0.3); ctx.stroke(); ctx.fill(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(0, 0, r * 0.22, 0, 7); ctx.fill(); }
    else if (kind === 'temple') { ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.moveTo(0, -r * 1.15); ctx.quadraticCurveTo(r * 0.55, -r * 0.2, r * 0.6, r * 0.9); ctx.lineTo(-r * 0.6, r * 0.9); ctx.quadraticCurveTo(-r * 0.55, -r * 0.2, 0, -r * 1.15); ctx.closePath(); ctx.stroke(); ctx.fill(); }
    else if (kind === 'lake') { ctx.fillStyle = '#7fe3ff'; ctx.beginPath(); ctx.arc(0, -r * 0.1, r * 0.8, 0, 7); ctx.stroke(); ctx.fill(); ctx.strokeStyle = '#0b5a7a'; ctx.lineWidth = r * 0.2; ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.1); ctx.quadraticCurveTo(0, -r * 0.45, r * 0.45, -r * 0.1); ctx.stroke(); }
    else { ctx.fillStyle = '#48dbfb'; ctx.beginPath(); ctx.rect(-r * 0.25, -r, r * 0.5, r * 2); ctx.stroke(); ctx.fill(); }
    ctx.restore();
  };
  const drawMinimap = (player, others) => {
    if (!base) return;
    const px = cv.width, big = state.bigMap, span = big ? WS : VIEW, scale = px / span;
    const ox = big ? -WH : player.x - span / 2, oz = big ? -WH : player.z - span / 2;
    ctx.clearRect(0, 0, px, px);
    ctx.save();
    ctx.beginPath(); ctx.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#1d4e75'; ctx.fillRect(0, 0, px, px);
    const k = base.width / WS;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(base, (ox + WH) * k, (oz + WH) * k, span * k, span * k, 0, 0, px, px);
    const ir = (big ? 9 : 7) * dpr * (isTouch ? 0.8 : 1);
    for (const lm of landmarks) {
      const x = (lm.x - ox) * scale, y = (lm.z - oz) * scale;
      if (x < -ir || y < -ir || x > px + ir || y > px + ir) continue;
      drawIcon(lm.kind, x, y, ir);
      if (big) { ctx.font = `bold ${12 * dpr}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.lineWidth = 3 * dpr; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.fillStyle = '#fff'; ctx.strokeText(lm.name, x, y - ir - 4 * dpr); ctx.fillText(lm.name, x, y - ir - 4 * dpr); }
    }
    for (const o of others) {
      const x = (o.x - ox) * scale, y = (o.z - oz) * scale;
      ctx.fillStyle = '#2ee66b'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(x, y, 3.6 * dpr, 0, 7); ctx.stroke(); ctx.fill();
    }
    // you: arrow pointing the way you face (north is up)
    const mx = (player.x - ox) * scale, my = (player.z - oz) * scale, ar = 7 * dpr;
    ctx.translate(mx, my); ctx.rotate(-player.yaw);
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#0b2a40'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -ar * 1.2); ctx.lineTo(ar * 0.85, ar); ctx.lineTo(0, ar * 0.45); ctx.lineTo(-ar * 0.85, ar); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
  };
  const toggleMap = () => { state.bigMap = !state.bigMap; $('minimapWrap').classList.toggle('big', state.bigMap); sizeMap(); };
  cv.addEventListener('click', toggleMap);
  cv.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); toggleMap(); }, { passive: false });

  return {
    chat: chatHandlers,
    isChatOpen: () => state.chatOpen,
    addChat(name, text, scope = 'all') { state.msgs.push({ name, text, scope }); if (state.msgs.length > 80) state.msgs.shift(); renderChat(); },
    setOnline(n) { $('online').textContent = 'Online: ' + n; },
    setPrompt(label, soon) {
      if (label === promptLabel) return;
      promptLabel = label;
      promptEl.style.display = label ? 'flex' : 'none';
      if (label) labelEl.textContent = label + (soon ? '  (soon)' : '');
    },
    toast(msg, ms = 2400) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms); },
    setActiveEmote(id) {
      if (id === state.activeEmote) return;
      state.activeEmote = id;
      bar.querySelectorAll('.emote').forEach((b) => b.classList.toggle('on', +b.dataset.id === id));
    },
    setMic(on) { const b = $('btnMic'); b.classList.toggle('on', on); b.querySelector('.t').textContent = on ? 'Mic on · G' : 'Mic · G'; },
    setSpeakers(list, selfSpeaking, onMute) {
      const box = $('speakers');
      box.innerHTML = '';
      if (selfSpeaking) { const c = document.createElement('div'); c.className = 'chip me'; c.textContent = '🎤 You'; box.appendChild(c); }
      for (const s of list) {
        const c = document.createElement('div'); c.className = 'chip' + (s.muted ? ' muted' : ''); c.title = 'Click to mute / unmute';
        c.textContent = (s.muted ? '🔇 ' : '🔊 ') + s.name;
        c.addEventListener('click', () => onMute(s.id)); c.addEventListener('touchstart', (e) => { e.preventDefault(); onMute(s.id); }, { passive: false });
        box.appendChild(c);
      }
    },
    initMinimap, initMinimapImage, drawMinimap, toggleMap,
    isBigMap: () => state.bigMap,
  };
}
