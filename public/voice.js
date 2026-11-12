// Proximity voice chat. Voice goes directly between players (WebRTC); the game server only relays the connection handshakes.
// You only connect to players within RANGE_IN metres, and what you hear is placed in 3D (direction + distance falloff) with Web Audio.
const RANGE_IN = 34, RANGE_OUT = 46;     // connect inside 34 m, disconnect beyond 46 m
const REF_DIST = 3, MAX_DIST = 40;       // full volume within 3 m, silent at 40 m
const SPEAK_LEVEL = 0.02;

export function createVoice({ getSocket, getSelf, getOthers, isIndoors, onSpeakers, onMic, toast, getAudioContext }) {
  let ctx = null, master = null, selfId = null, micStream = null, micTrack = null, micOn = false, selfAnalyser = null, selfLevel = 0, lastKey = '';
  const peers = new Map(), muted = new Set();
  const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const level = (an) => {
    if (!an) return 0;
    const buf = new Uint8Array(an.fftSize); an.getByteTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
    return Math.sqrt(s / buf.length);
  };
  function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = (getAudioContext && getAudioContext()) || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }  // normally the game's shared context
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
  }
  const signal = (to, kind, data) => { const s = getSocket(); if (s && s.connected) s.emit('rtc', { to, kind, data }); };

  function attachRemote(peer, stream) {
    ensureCtx();
    if (!ctx) return;
    // Chrome only feeds remote WebRTC audio into Web Audio if the stream is also attached to a (muted) media element
    peer.el = new Audio(); peer.el.srcObject = stream; peer.el.muted = true; peer.el.play().catch(() => {});
    peer.src = ctx.createMediaStreamSource(stream);
    peer.inAn = ctx.createAnalyser(); peer.inAn.fftSize = 4096;
    peer.gain = ctx.createGain();
    peer.panner = ctx.createPanner();
    Object.assign(peer.panner, { panningModel: 'HRTF', distanceModel: 'linear', refDistance: REF_DIST, maxDistance: MAX_DIST, rolloffFactor: 1 });
    peer.outAn = ctx.createAnalyser(); peer.outAn.fftSize = 4096;
    peer.src.connect(peer.inAn); peer.src.connect(peer.gain); peer.gain.connect(peer.panner); peer.panner.connect(peer.outAn); peer.panner.connect(master);
  }

  function createPeer(id, initiator) {
    const pc = new RTCPeerConnection(cfg);
    const peer = { id, pc, initiator, queued: [], sender: null, dist: 99, hasRemote: false };
    if (initiator) {   // the caller creates the audio channel; the answerer adopts the one in the offer (see handleSignal)
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.sender = tr.sender; peer.tr = tr;
      if (micTrack) tr.sender.replaceTrack(micTrack).catch(() => {});
    }
    pc.onicecandidate = (e) => { if (e.candidate) signal(id, 'candidate', e.candidate.toJSON()); };
    pc.ontrack = (e) => attachRemote(peer, e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') removePeer(id); };
    peers.set(id, peer);
    if (initiator) pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => signal(id, 'offer', pc.localDescription)).catch(() => removePeer(id));
    return peer;
  }
  function removePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    peers.delete(id);
    try { p.pc.close(); } catch (e) { /* ignore */ }
    for (const n of [p.src, p.gain, p.panner, p.inAn, p.outAn]) { try { n && n.disconnect(); } catch (e) { /* ignore */ } }
    if (p.el) { p.el.srcObject = null; p.el = null; }
    lastKey = ''; // force the speaker list to refresh
  }
  async function handleSignal({ from, kind, data }) {
    if (!from || !data) return;
    try {
      let p = peers.get(from);
      if (kind === 'offer') {
        if (p && p.initiator) return;            // we are the one who offers to this player
        if (!p) p = createPeer(from, false);
        await p.pc.setRemoteDescription(data); p.hasRemote = true;
        const tr = p.pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
        if (tr) { tr.direction = 'sendrecv'; p.tr = tr; p.sender = tr.sender; if (micTrack) await tr.sender.replaceTrack(micTrack).catch(() => {}); }
        for (const c of p.queued.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        const a = await p.pc.createAnswer(); await p.pc.setLocalDescription(a);
        signal(from, 'answer', p.pc.localDescription);
      } else if (kind === 'answer') {
        if (p && p.pc.signalingState === 'have-local-offer') {
          await p.pc.setRemoteDescription(data); p.hasRemote = true;
          for (const c of p.queued.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (kind === 'candidate' && p) {
        if (p.hasRemote) await p.pc.addIceCandidate(data).catch(() => {}); else p.queued.push(data);
      }
    } catch (e) { removePeer(from); }
  }

  // decide who to be connected to (called a few times a second)
  function manage() {
    if (!selfId) return;
    const me = getSelf();
    for (const o of getOthers()) {
      if (!o.seen) continue;
      const d = Math.hypot(o.x - me.x, o.y - me.y, o.z - me.z), p = peers.get(o.id);
      if (p) p.dist = d;
      if (!p && d < RANGE_IN && selfId < o.id) createPeer(o.id, true);       // the player with the smaller id makes the offer
      else if (p && d > RANGE_OUT) removePeer(o.id);
    }
  }
  // keep every voice placed in 3D around your head, and report who is speaking
  function spatial() {
    if (!ctx) return;
    const me = getSelf(), L = ctx.listener, t = ctx.currentTime;
    const cp = Math.cos(me.pitch), fx = -Math.sin(me.yaw) * cp, fy = Math.sin(me.pitch), fz = -Math.cos(me.yaw) * cp;
    if (L.positionX) { L.positionX.setValueAtTime(me.x, t); L.positionY.setValueAtTime(me.y, t); L.positionZ.setValueAtTime(me.z, t); L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t); L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t); }
    else { L.setPosition(me.x, me.y, me.z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
    const others = new Map(getOthers().map((o) => [o.id, o])), speaking = [], meIn = isIndoors(me.x, me.z, me.y);
    for (const p of peers.values()) {
      const o = others.get(p.id);
      if (!o || !p.panner) continue;
      if (p.panner.positionX) { p.panner.positionX.setValueAtTime(o.x, t); p.panner.positionY.setValueAtTime(o.y, t); p.panner.positionZ.setValueAtTime(o.z, t); } else p.panner.setPosition(o.x, o.y, o.z);
      const wall = isIndoors(o.x, o.z, o.y) !== meIn ? 0.4 : 1;           // muffled through a wall
      p.gain.gain.setTargetAtTime(muted.has(p.id) ? 0 : wall, t, 0.05);
      p.inLevel = Math.max(level(p.inAn), (p.inLevel || 0) * 0.8); p.outLevel = Math.max(level(p.outAn), (p.outLevel || 0) * 0.8);
      if (p.inLevel > SPEAK_LEVEL && p.dist < MAX_DIST) speaking.push({ id: p.id, name: o.name, muted: muted.has(p.id), level: Math.min(1, p.outLevel * 8) });
    }
    selfLevel = micOn ? level(selfAnalyser) : 0;
    const key = speaking.map((s) => s.id + (s.muted ? 'm' : '')).join(',') + '|' + (selfLevel > SPEAK_LEVEL ? 1 : 0);
    if (key !== lastKey) { lastKey = key; onSpeakers(speaking, selfLevel > SPEAK_LEVEL); }
  }
  setInterval(manage, 400);
  setInterval(spatial, 90);

  let starting = false;
  async function toggleMic() {
    if (starting) return;                      // ignore extra presses while the mic is still being opened
    ensureCtx();
    if (micOn) { micOn = false; if (micTrack) micTrack.enabled = false; onMic(false); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Microphone needs a secure page (https:// or localhost)'); return; }
    starting = true;
    try {
      if (!micStream) {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        micTrack = micStream.getAudioTracks()[0];
        selfAnalyser = ctx.createAnalyser(); selfAnalyser.fftSize = 4096; ctx.createMediaStreamSource(micStream).connect(selfAnalyser);
        for (const p of peers.values()) if (p.sender) p.sender.replaceTrack(micTrack).catch(() => {});
      }
      micTrack.enabled = true; micOn = true; onMic(true);
      toast('Mic on: only players near you can hear you');
    } catch (e) {
      toast(e && e.name === 'NotFoundError' ? 'No microphone found' : 'Microphone permission was denied');
    } finally { starting = false; }
  }
  return {
    start: ensureCtx, toggleMic, handleSignal, removePeer,
    isMicOn: () => micOn,
    setSelf(id) { selfId = id; for (const id2 of [...peers.keys()]) removePeer(id2); },
    toggleMute(id) { if (muted.has(id)) muted.delete(id); else muted.add(id); lastKey = ''; return muted.has(id); },
    // connection statistics (for diagnosing: are audio packets actually arriving?)
    stats: async () => Promise.all([...peers.values()].map(async (p) => {
      const out = { id: p.id, state: p.pc.connectionState, packetsReceived: 0, audioLevel: 0, packetsSent: 0, dir: p.tr && p.tr.direction, cur: p.tr && p.tr.currentDirection, hasTrack: !!p.sender.track, trackOn: p.sender.track ? p.sender.track.enabled + '/' + p.sender.track.readyState : null };
      (await p.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { out.packetsReceived = r.packetsReceived; out.audioLevel = r.audioLevel || 0; } if (r.type === 'outbound-rtp' && r.kind === 'audio') out.packetsSent = r.packetsSent; });
      return out;
    })),
    debug: () => ({ micOn, ctx: ctx && ctx.state, peers: [...peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState, dist: +p.dist.toFixed(1), inLevel: +(p.inLevel || 0).toFixed(3), outLevel: +(p.outLevel || 0).toFixed(3) })) }),
  };
}