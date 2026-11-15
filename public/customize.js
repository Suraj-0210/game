// Avatar customizer: tabs on the right, live 3D preview on the left.
import {
  SKIN, HAIR, TOPS, BOTTOMS, SHOES, HAIR_NAMES, TOP_NAMES, ACC, PRESETS, EMOTE_DEFS, FACE_W,
  createAvatar, animateAvatar, sanitizeAvatar, randomAvatar, makeFaceCanvas,
} from './avatar.js';

const hexc = (n) => '#' + n.toString(16).padStart(6, '0');

export function createCustomizer({ THREE, getCfg, onSave, onOpen, onClose }) {
  let root = null, stage = null, renderer = null, scene = null, camera = null, avatar = null;
  let open = false, draft = null, tab = 'body', rot = Math.PI + 0.35, emote = 0, raf = 0, last = 0;
  const TABS = [['body', 'Body'], ['hair', 'Hair'], ['outfit', 'Outfit'], ['acc', 'Accessories'], ['emotes', 'Emotes']];

  function build() {
    root = document.createElement('div');
    root.id = 'custom';
    root.innerHTML = `
      <div class="cz-panel">
        <div class="cz-head"><span>👕 Customize Your Avatar</span><button class="cz-x" aria-label="Close">✕</button></div>
        <div class="cz-body">
          <div class="cz-left"><div class="cz-stage"><button class="cz-rot l">⟲</button><button class="cz-rot r">⟳</button></div><div class="cz-hint">Drag the preview to turn around</div></div>
          <div class="cz-right"><div class="cz-tabs"></div><div class="cz-content"></div></div>
        </div>
        <div class="cz-foot"><button class="cz-rand">🎲 Randomize</button><span class="sp"></span><button class="cz-cancel">Cancel</button><button class="cz-save">Save</button></div>
      </div>`;
    document.body.appendChild(root);
    stage = root.querySelector('.cz-stage');

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    stage.insertBefore(renderer.domElement, stage.firstChild);
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 3 / 4, 0.1, 50);
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x46506a, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(2, 3.5, 3.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 1.6); rim.position.set(-3, 2, -2.5); scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.62, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x7ea2ff, transparent: true, opacity: 0.22 }));
    disc.position.y = 0.002; scene.add(disc);

    // drag to rotate
    let drag = null;
    renderer.domElement.addEventListener('pointerdown', (e) => { drag = e.clientX; renderer.domElement.setPointerCapture(e.pointerId); });
    renderer.domElement.addEventListener('pointermove', (e) => { if (drag !== null) { rot += (e.clientX - drag) * 0.012; drag = e.clientX; } });
    const endDrag = () => { drag = null; };
    renderer.domElement.addEventListener('pointerup', endDrag); renderer.domElement.addEventListener('pointercancel', endDrag);
    root.querySelector('.cz-rot.l').addEventListener('click', () => { rot += 0.7; });
    root.querySelector('.cz-rot.r').addEventListener('click', () => { rot -= 0.7; });

    root.querySelector('.cz-x').addEventListener('click', () => close(false));
    root.querySelector('.cz-cancel').addEventListener('click', () => close(false));
    root.querySelector('.cz-save').addEventListener('click', () => close(true));
    root.querySelector('.cz-rand').addEventListener('click', () => { draft = randomAvatar(); rebuildAvatar(); render(); });
    root.addEventListener('keydown', (e) => e.stopPropagation());
    window.addEventListener('keydown', (e) => { if (open && e.code === 'Escape') close(false); });
    window.addEventListener('resize', () => { if (open) fit(); });
  }

  function fit() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    camera.position.set(0, 1.1, 4.3); camera.lookAt(0, 0.92, 0);
  }
  function rebuildAvatar() {
    if (avatar) { scene.remove(avatar.group); avatar.dispose(); }
    avatar = createAvatar(THREE, draft, { shadows: false });
    scene.add(avatar.group);
  }
  function loop(now) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    animateAvatar(avatar, { moved: 0, dt, emote, t: now / 1000, sitKind: 'ground' });
    avatar.group.rotation.y = rot;
    camera.position.y = emote === 9 ? 0.9 : 1.1;
    camera.lookAt(0, emote === 9 ? 0.25 : 0.92, 0);
    renderer.render(scene, camera);
  }

  // ----- tab content -----
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
  const section = (title, node) => { const s = el('div', 'cz-sec'); s.appendChild(el('h4', '', title)); s.appendChild(node); return s; };
  const set = (patch) => { draft = sanitizeAvatar({ ...draft, ...patch }); rebuildAvatar(); render(); };
  const swatches = (colors, idx, key) => {
    const row = el('div', 'cz-row');
    colors.forEach((c, i) => { const b = el('button', 'cz-sw' + (i === idx ? ' on' : '')); b.style.background = hexc(c); b.title = hexc(c); b.addEventListener('click', () => set({ [key]: i })); row.appendChild(b); });
    return row;
  };
  const seg = (labels, idx, key) => {
    const row = el('div', 'cz-row');
    labels.forEach((l, i) => { const b = el('button', 'cz-seg' + (i === idx ? ' on' : ''), l); b.addEventListener('click', () => set({ [key]: i })); row.appendChild(b); });
    return row;
  };
  function render() {
    root.querySelectorAll('.cz-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const c = root.querySelector('.cz-content');
    c.innerHTML = '';
    if (tab === 'body') {
      c.appendChild(section('Gender', seg(['♂ Male', '♀ Female'], draft.g, 'g')));
      c.appendChild(section('Skin Tone', swatches(SKIN, draft.skin, 'skin')));
      const faces = el('div', 'cz-row');
      for (let i = 0; i < 4; i++) {
        const b = el('button', 'cz-face' + (i === draft.face ? ' on' : ''));
        const src = makeFaceCanvas({ ...draft, face: i }, 'happy'), cv = document.createElement('canvas');
        cv.width = 96; cv.height = 80;
        cv.getContext('2d').drawImage(src, FACE_W * 0.75 - 62, 256 * 0.515 - 52, 124, 104, 0, 0, 96, 80);
        b.appendChild(cv); b.addEventListener('click', () => set({ face: i })); faces.appendChild(b);
      }
      c.appendChild(section('Face Style', faces));
    } else if (tab === 'hair') {
      c.appendChild(section('Hairstyle', seg(HAIR_NAMES, draft.hs, 'hs')));
      c.appendChild(section('Hair Colour', swatches(HAIR, draft.hc, 'hc')));
    } else if (tab === 'outfit') {
      const pr = el('div', 'cz-row');
      PRESETS.forEach((p) => {
        const b = el('button', 'cz-card'); b.innerHTML = `<span class="dots"><i style="background:${hexc(TOPS[p.tc])}"></i><i style="background:${hexc(BOTTOMS[p.bc])}"></i></span><span>${p.name}</span>`;
        b.addEventListener('click', () => set({ top: p.top, tc: p.tc, bot: p.bot, bc: p.bc, shoe: p.shoe })); pr.appendChild(b);
      });
      c.appendChild(section('Outfits', pr));
      c.appendChild(section('Top', seg(TOP_NAMES, draft.top, 'top')));
      c.appendChild(section('Top Colour', swatches(TOPS, draft.tc, 'tc')));
      c.appendChild(section('Bottoms', seg(['Long', 'Shorts'], draft.bot, 'bot')));
      c.appendChild(section('Bottom Colour', swatches(BOTTOMS, draft.bc, 'bc')));
      c.appendChild(section('Shoes', swatches(SHOES, draft.shoe, 'shoe')));
    } else if (tab === 'acc') {
      const row = el('div', 'cz-row');
      ACC.forEach((a, i) => {
        const b = el('button', 'cz-card' + (draft.acc[i] ? ' on' : ''), `<span class="ic">${a.icon}</span><span>${a.name}</span>`);
        b.addEventListener('click', () => { const acc = draft.acc.slice(); acc[i] = acc[i] ? 0 : 1; set({ acc }); }); row.appendChild(b);
      });
      c.appendChild(section('Accessories (tap to wear or remove)', row));
    } else if (tab === 'emotes') {
      const row = el('div', 'cz-row');
      EMOTE_DEFS.forEach((e) => {
        const b = el('button', 'cz-card' + (emote === e.id ? ' on' : ''), `<span class="ic">${e.icon}</span><span>${e.name}</span>`);
        b.addEventListener('click', () => { emote = emote === e.id ? 0 : e.id; render(); }); row.appendChild(b);
      });
      c.appendChild(section('Preview an emote (in the game press 1-9)', row));
    }
  }

  function openPanel() {
    if (!root) build();
    const tabsEl = root.querySelector('.cz-tabs');
    if (!tabsEl.children.length) TABS.forEach(([id, name]) => { const b = el('button', '', name); b.dataset.tab = id; b.addEventListener('click', () => { tab = id; if (id !== 'emotes') emote = 0; render(); }); tabsEl.appendChild(b); });
    draft = sanitizeAvatar(getCfg()); tab = 'body'; emote = 0; rot = Math.PI + 0.35;
    root.classList.add('open'); open = true;
    fit(); rebuildAvatar(); render();
    last = performance.now(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop);
    onOpen && onOpen();
  }
  function close(save) {
    if (!open) return;
    open = false; root.classList.remove('open'); cancelAnimationFrame(raf);
    if (save) onSave(sanitizeAvatar(draft));
    onClose && onClose(save);
  }
  return { open: openPanel, close, isOpen: () => open };
}
