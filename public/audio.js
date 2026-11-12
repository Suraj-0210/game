// Procedural ambience with the Web Audio API (no sound files): wind, rain, waves, birds and thunder.
export function createAudio() {
  let ctx = null, master = null, n = {}, enabled = true, birdAt = 0;
  try { enabled = localStorage.getItem('vw_sound') !== '0'; } catch (e) { /* ignore */ }
  const noise = (c, secs) => { const b = c.createBuffer(1, c.sampleRate * secs, c.sampleRate), d = b.getChannelData(0); let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = i % 2 ? w * 0.5 : last * 6; } return b; };
  const loop = (buf) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
  function start() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = enabled ? 0.7 : 0; master.connect(ctx.destination);
    const buf = noise(ctx, 4);
    const chain = (filters, gainVal) => { const s = loop(buf); let node = s; for (const f of filters) { node.connect(f); node = f; } const g = ctx.createGain(); g.gain.value = gainVal; node.connect(g); g.connect(master); return g; };
    const bp = (f, q) => { const x = ctx.createBiquadFilter(); x.type = 'bandpass'; x.frequency.value = f; x.Q.value = q; return x; };
    const lp = (f) => { const x = ctx.createBiquadFilter(); x.type = 'lowpass'; x.frequency.value = f; return x; };
    const hp = (f) => { const x = ctx.createBiquadFilter(); x.type = 'highpass'; x.frequency.value = f; return x; };
    n.windFilter = bp(420, 0.5); n.wind = chain([n.windFilter, lp(1600)], 0);
    n.rain = chain([hp(1400), lp(9000)], 0);
    n.waveFilter = lp(520); n.waves = chain([n.waveFilter], 0);
    const lfo = ctx.createOscillator(), lfoG = ctx.createGain(); lfo.frequency.value = 0.11; lfoG.gain.value = 0.06; lfo.connect(lfoG); lfoG.connect(n.waves.gain); lfo.start();
    n.thunderBuf = noise(ctx, 3);
  }
  const set = (g, v, tc = 0.4) => g.gain.setTargetAtTime(v, ctx.currentTime, tc);
  return {
    start,
    getContext: () => ctx,   // shared with the voice chat (one AudioContext for the whole game)
    isOn: () => enabled,
    setEnabled(v) { enabled = v; try { localStorage.setItem('vw_sound', v ? '1' : '0'); } catch (e) { /* ignore */ } if (ctx) { master.gain.setTargetAtTime(v ? 0.7 : 0, ctx.currentTime, 0.2); if (v && ctx.state === 'suspended') ctx.resume(); } },
    // p: { wind 0..1.6, gust 0..1, rain 0..1, storm 0..1, water 0..1 (near the sea), forest 0..1, cover 0..1, underwater }
    update(p) {
      if (!ctx || !enabled) return;
      const under = p.underwater ? 0.25 : p.indoors ? 0.3 : 1;
      set(n.wind, (0.03 + 0.2 * Math.min(1.3, p.wind) + 0.06 * p.gust) * under); n.windFilter.frequency.setTargetAtTime(300 + 520 * p.wind + 200 * p.gust, ctx.currentTime, 0.5);
      set(n.rain, 0.34 * p.rain * (p.underwater ? 0.1 : p.indoors ? 0.18 : 1)); set(n.waves, (0.025 + 0.2 * p.water * (0.5 + 0.5 * Math.min(1, p.wind + 0.3))) * (p.underwater ? 0.3 : p.indoors ? 0.25 : 1));
      n.waveFilter.frequency.setTargetAtTime(380 + 400 * Math.min(1, p.wind), ctx.currentTime, 0.6);
      const now = ctx.currentTime;
      if (p.cover < 0.55 && p.rain < 0.05 && p.forest > 0.25 && !p.underwater && now > birdAt) { chirp(); birdAt = now + 2.5 + Math.random() * 6 * (1.3 - p.forest); }
    },
    thunder(delay = 1.2) {
      if (!ctx || !enabled) return;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = ctx.currentTime + delay;
      s.buffer = n.thunderBuf; f.type = 'lowpass'; f.frequency.value = 220;
      g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(0.9, t0 + 0.15); g.gain.exponentialRampToValueAtTime(0.001, t0 + 3.2);
      s.connect(f); f.connect(g); g.connect(master); s.start(t0); s.stop(t0 + 3.4);
    },
  };
  function chirp() {
    const o = ctx.createOscillator(), g = ctx.createGain(), t0 = ctx.currentTime + Math.random() * 0.2, base = 2200 + Math.random() * 1600, k = 2 + Math.floor(Math.random() * 3);
    o.type = 'sine'; g.gain.value = 0; o.connect(g); g.connect(master);
    for (let i = 0; i < k; i++) {
      const s = t0 + i * 0.13; o.frequency.setValueAtTime(base, s); o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.4), s + 0.07);
      g.gain.setValueAtTime(0, s); g.gain.linearRampToValueAtTime(0.05, s + 0.02); g.gain.linearRampToValueAtTime(0, s + 0.09);
    }
    o.start(t0); o.stop(t0 + k * 0.13 + 0.2);
  }
}