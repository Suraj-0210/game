// Clouds (drifting billboard puffs + an overcast layer) and rain (GPU streaks that slant with the wind).
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rand = (seed) => { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

export function createClouds(THREE, { puff, noise, count = 46 }) {
  const PUFFS = 8, N = count * PUFFS, R = 1500;
  const geo = new THREE.PlaneGeometry(1, 1);
  const aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3), aAlpha = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  geo.setAttribute('aColor', aColor); geo.setAttribute('aAlpha', aAlpha);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, fog: false, uniforms: { map: { value: puff } },
    vertexShader: `
      attribute vec3 aColor; attribute float aAlpha; varying vec3 vC; varying float vA; varying vec2 vUv;
      void main() {
        vUv = uv; vC = aColor; vA = aAlpha;
        vec4 center = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        center.xy += position.xy * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz));
        gl_Position = projectionMatrix * center;
      }`,
    fragmentShader: `uniform sampler2D map; varying vec3 vC; varying float vA; varying vec2 vUv;
      void main() { vec4 t = texture2D(map, vUv); gl_FragColor = vec4(vC, t.a * vA); }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.frustumCulled = false; mesh.renderOrder = 1;
  const r = rand(97), clouds = [];
  for (let i = 0; i < count; i++) {
    const ang = r() * 6.283, dist = 250 + Math.sqrt(r()) * (R - 250), scale = 170 + r() * 240;
    const puffs = [];
    for (let k = 0; k < PUFFS; k++) puffs.push({ ox: (r() - 0.5) * scale * 1.25, oy: (r() - 0.35) * scale * 0.16, oz: (r() - 0.5) * scale * 0.9, size: scale * (0.55 + r() * 0.55) });
    clouds.push({ x: Math.cos(ang) * dist, z: Math.sin(ang) * dist, y: 260 + r() * 170, thr: (i + 0.5) / count, puffs, tone: 0.9 + r() * 0.1 });
  }
  const dm = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // overcast layer: a big gently-moving gray veil
  const veil = new THREE.Mesh(new THREE.CircleGeometry(3200, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9aa3ad, alphaMap: noise, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.repeat.set(5, 5);
  veil.renderOrder = 0; veil.frustumCulled = false;
  const group = new THREE.Group(); group.add(veil, mesh);

  return {
    group,
    update(dt, cam, w, sunTint) {
      const speed = 3 + 9 * w.wind, vx = Math.cos(w.dir) * speed, vz = Math.sin(w.dir) * speed;
      const dark = Math.min(1, w.rain * 0.85 + w.storm * 0.4);
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i];
        c.x += vx * dt; c.z += vz * dt;
        let dx = c.x - cam.x, dz = c.z - cam.z;
        if (dx > R) { c.x -= 2 * R; dx -= 2 * R; } else if (dx < -R) { c.x += 2 * R; dx += 2 * R; }
        if (dz > R) { c.z -= 2 * R; dz -= 2 * R; } else if (dz < -R) { c.z += 2 * R; dz += 2 * R; }
        const d = Math.hypot(dx, dz);
        const a = ss(c.thr - 0.1, c.thr + 0.1, w.cover) * (0.5 + 0.4 * w.cover) * (1 - ss(R * 0.72, R, d)) * ss(60, 260, d);
        for (let k = 0; k < PUFFS; k++) {
          const pf = c.puffs[k], idx = i * PUFFS + k;
          p.set(c.x + pf.ox, c.y + pf.oy, c.z + pf.oz); s.set(pf.size, pf.size * 0.62, 1);
          dm.compose(p, q, s); mesh.setMatrixAt(idx, dm);
          const shade = (0.7 + 0.3 * ss(-0.08, 0.1, pf.oy / 400 * 0)) * (0.84 + 0.16 * (pf.oy > 0 ? 1 : 0.35 + 0.65 * (pf.oy + 40) / 40)) * c.tone;
          const base = 1 - dark * 0.62, lum = Math.min(1, shade * base);
          aColor.setXYZ(idx, lum * sunTint[0], lum * sunTint[1], lum * sunTint[2]);
          aAlpha.setX(idx, a);
        }
      }
      mesh.instanceMatrix.needsUpdate = true; aColor.needsUpdate = true; aAlpha.needsUpdate = true;
      veil.position.set(cam.x, 560, cam.z);
      veil.material.opacity = ss(0.5, 1, w.cover) * 0.5;
      const g = 0.62 - 0.3 * dark; veil.material.color.setRGB(g, g * 1.02, g * 1.06);
      noise.offset.x += vx * dt * 0.0003; noise.offset.y += vz * dt * 0.0003;
    },
  };
}

export function createRain(THREE, { count = 7000 }) {
  const geo = new THREE.BufferGeometry(), seed = new Float32Array(count * 2 * 3), end = new Float32Array(count * 2), r = rand(5);
  for (let i = 0; i < count; i++) { const a = r(), b = r(), c = r(); for (let k = 0; k < 2; k++) { seed.set([a, b, c], (i * 2 + k) * 3); end[i * 2 + k] = k; } }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3)); geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const uniforms = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(38, 30, 38) }, uVel: { value: new THREE.Vector3(0, -16, 0) }, uLen: { value: 0.9 }, uOpacity: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, fog: false,
    vertexShader: `attribute vec3 aSeed; attribute float aEnd; uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec3 uVel; uniform float uLen; varying float vA;
      void main() {
        vec3 p = aSeed * uBox + uVel * uTime;
        p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        float d = length(p.xz);
        vec3 pos = uCam + p - normalize(uVel) * uLen * aEnd;
        vA = (1.0 - smoothstep(13.0, 19.0, d)) * (1.0 - 0.55 * aEnd);
        gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: `uniform float uOpacity; varying float vA; void main() { gl_FragColor = vec4(0.78, 0.85, 0.94, vA * uOpacity * 0.6); }`,
  });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.renderOrder = 5;
  return {
    object: lines,
    update(t, cam, w) {
      uniforms.uTime.value = t; uniforms.uCam.value.copy(cam);
      const slant = Math.min(1, w.wind) * 7;
      uniforms.uVel.value.set(Math.cos(w.dir) * slant, -15 - 5 * w.storm, Math.sin(w.dir) * slant);
      uniforms.uOpacity.value = Math.min(1, w.rain * 1.4);
      geo.setDrawRange(0, Math.floor(count * Math.min(1, w.rain * 1.15 + 0.02)) * 2);
      lines.visible = w.rain > 0.02;
    },
  };
}