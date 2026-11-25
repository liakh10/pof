/* Direction M · WebGL. The Privacy Rings as pure form: satin and ceramic tori, hairline light lines and tick rings in a soft
   studio light, on the paper of the site. One accent: the certificate ring. It locks into alignment and glows (certified),
   and it breaks apart into dust from the point where money leaves it (revoked).

   One Stage per canvas. A Stage renders any number of views into its canvas with scissor rects that follow DOM elements,
   so a whole row of "moments" costs one WebGL context. Every scene is a pure function of time (seeded randomness, no
   state except the pointer lag), so the still images on disk are frames of the same scenes, and the swap from still to
   live canvas is invisible. */
import * as THREE from 'https://cdnjs.cloudflare.com/ajax/libs/three.js/0.170.0/three.module.min.js';

const TAU = Math.PI * 2;
const COL = { ink: '#1b1916', graphite: '#2b2925', bone: '#e9e2d5', signal: '#f2611d' };
const k01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);
const seg = (t, a, b) => k01((t - a) / (b - a));
const smooth = x => x * x * (3 - 2 * x);
const out3 = x => 1 - (1 - x) ** 3;
const inOut = x => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const back = x => { const s = 1.5; return x <= 0 ? 0 : 1 + (s + 1) * (x - 1) ** 3 + s * (x - 1) ** 2; };
const mod = (a, n) => ((a % n) + n) % n;
function prng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function supported() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

/* ------------------------------------------------------------------ the studio: soft boxes baked into an environment map */
function studio(renderer) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(20, 24, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color('#c9c2b5').multiplyScalar(0.62), side: THREE.BackSide })));
  const panel = (w, h, pos, k, col = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m);
  };
  panel(14, 5, [-4, 9, 6], 2.4);              // key softbox, high left
  panel(3, 12, [11, 1, 3], 1.5);              // strip, right
  panel(3, 12, [-11, -1, 1], 0.7);            // fill strip, left
  panel(16, 2, [0, -1, -12], 1.1);            // rim, behind
  panel(12, 4, [0, -9, 5], 0.55, '#f6e9d9');  // warm bounce from the paper
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.035).texture;
  pm.dispose();
  s.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  return tex;
}

/* ------------------------------------------------------------------ materials with a ring clip: dashes, a cut that spreads
   from a break point, and a draw-on sweep, all in the fragment shader of one torus */
function clip(mat, { seg: n = 0, gap = 0 } = {}) {
  const u = { uSeg: { value: n }, uGap: { value: gap }, uCut: { value: 0 }, uA0: { value: 0 }, uDraw: { value: 1 }, uOff: { value: 0 } };
  mat.userData.u = u;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = 'varying vec3 vRing;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRing = position;');
    sh.fragmentShader = 'varying vec3 vRing;\nuniform float uSeg, uGap, uCut, uA0, uDraw, uOff;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  float ang = atan(vRing.y, vRing.x);
  float rel = ang - uA0;
  if (abs(atan(sin(rel), cos(rel))) / 3.14159265 < uCut) discard;
  if (fract(rel / 6.2831853 + 1.0) > uDraw) discard;
  if (uSeg > 0.5 && fract(ang / 6.2831853 * uSeg + uOff) < uGap) discard;`);
  };
  mat.customProgramCacheKey = () => 'pof-ring-clip';
  return mat;
}
const M = {
  graphite: o => clip(new THREE.MeshPhysicalMaterial({ color: COL.graphite, metalness: 0.55, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.28, side: THREE.DoubleSide }), o),
  bone: o => clip(new THREE.MeshPhysicalMaterial({ color: COL.bone, metalness: 0, roughness: 0.5, sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color('#ffffff'), side: THREE.DoubleSide }), o),
  signal: o => clip(new THREE.MeshPhysicalMaterial({ color: COL.signal, metalness: 0.08, roughness: 0.34, clearcoat: 0.8, clearcoatRoughness: 0.2, emissive: COL.signal, emissiveIntensity: 0, side: THREE.DoubleSide }), o),
};
const torus = (r, tube, mat) => new THREE.Mesh(new THREE.TorusGeometry(r, tube, 14, Math.round(72 + r * 96)), mat);

function hair(r, { color = COL.ink, opacity = 0.3, n = 320, open = false } = {}) {
  const m = open ? n + 1 : n, a = new Float32Array(m * 3);
  for (let i = 0; i < m; i++) { const t = (i / n) * TAU; a[i * 3] = Math.cos(t) * r; a[i * 3 + 1] = Math.sin(t) * r; }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const l = new (open ? THREE.Line : THREE.LineLoop)(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  l.userData.n = m;
  return l;
}
function ticks(r, n, len, { major = 10, majorLen = 2, color = COL.ink, opacity = 0.45 } = {}) {
  const a = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU, L = i % major === 0 ? len * majorLen : len, c = Math.cos(t), s = Math.sin(t);
    a.set([c * r, s * r, 0, c * (r + L), s * (r + L), 0], i * 6);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  l.userData.n = n;
  return l;
}

/* dust: points on the torus surface that leave in order of their distance from the break point */
function dust(R, tube, n, { size = 40, spread = 1, seed = 7 } = {}) {
  const rnd = prng(seed);
  const pos = new Float32Array(n * 3), th = new Float32Array(n), rr = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = rnd() * TAU, b = rnd() * TAU, q = tube * Math.sqrt(rnd());
    pos[i * 3] = (R + q * Math.cos(b)) * Math.cos(a); pos[i * 3 + 1] = (R + q * Math.cos(b)) * Math.sin(a); pos[i * 3 + 2] = q * Math.sin(b);
    th[i] = a; rr.set([rnd(), rnd(), rnd(), rnd()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aTheta', new THREE.BufferAttribute(th, 1));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rr, 4));
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 }, uA0: { value: 0 }, uSize: { value: size }, uPx: { value: 1 }, uSpread: { value: spread }, uColor: { value: new THREE.Color(COL.signal) }, uInk: { value: new THREE.Color(COL.ink) } },
    vertexShader: `attribute float aTheta; attribute vec4 aRnd;
uniform float uT, uA0, uSize, uPx, uSpread;
varying float vA; varying float vInk;
void main() {
  float rel = aTheta - uA0;
  float d = abs(atan(sin(rel), cos(rel))) / 3.14159265;
  float rls = d * 0.45;
  float lt = clamp((uT - rls) / 0.55, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - lt, 2.4);
  vec3 radial = normalize(vec3(position.xy, 0.0));
  vec3 tang = vec3(-radial.y, radial.x, 0.0);
  float side = sign(sin(rel));
  vec3 p = position + uSpread * e * (radial * (0.2 + 0.75 * aRnd.x) + tang * side * (0.1 + 0.55 * aRnd.y) + vec3(0.0, 0.0, (aRnd.z - 0.3) * 1.1));
  p += uSpread * 0.07 * e * vec3(sin(aRnd.w * 50.0 + uT * 4.0), cos(aRnd.w * 37.0 + uT * 3.3), sin(aRnd.w * 23.0 + uT * 2.9));
  vA = step(0.0001, uT - rls) * (1.0 - smoothstep(0.3, 1.0, lt));
  vInk = step(aRnd.w, 0.16);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPx * (0.5 + 0.9 * aRnd.y) * (1.0 - 0.4 * lt) / -mv.z;
}`,
    fragmentShader: `uniform vec3 uColor, uInk; varying float vA; varying float vInk;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.3, r) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(uColor, uInk, vInk), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  return p;
}

/* a glow on paper: an orange haze in the ring's plane (additive light would vanish on a light page) */
function halo(r, w) {
  const m = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uR: { value: r }, uW: { value: w }, uGlow: { value: 0 }, uColor: { value: new THREE.Color(COL.signal) } },
    vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float uR, uW, uGlow; uniform vec3 uColor; varying vec2 vP;
void main() {
  float d = length(vP);
  float a = uGlow * (0.34 * exp(-pow((d - uR) / uW, 2.0)) + 0.12 * exp(-pow((d - uR) / (uW * 3.2), 2.0)));
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
  });
  const s = (r + w * 5) * 2;
  return new THREE.Mesh(new THREE.PlaneGeometry(s, s), m);
}

/* the certificate ring with everything it does: lock, glow, ripple, break, redraw */
function certRing(R, tube, { dustN = 2400, dustSize = 40, spread = 1, seed = 11 } = {}) {
  const pivot = new THREE.Group();
  const mat = M.signal();
  const ring = torus(R, tube, mat);
  const hl = halo(R, tube * 2.4);
  const line = hair(R + tube * 2.6, { color: COL.signal, opacity: 0 });
  const ripple = hair(R, { color: COL.signal, opacity: 0 });
  const light = new THREE.PointLight(COL.signal, 0, R * 3.2, 1.4);
  const d = dust(R, tube, dustN, { size: dustSize, spread, seed });
  hl.renderOrder = -1;
  pivot.add(hl, ring, line, ripple, light, d);
  return {
    pivot,
    /** s: { glow, cut, draw, brk, a0, ripple } */
    set({ glow = 0, brk = -1, draw = 1, a0 = 0, rip = -1, px = 1 }) {
      const u = mat.userData.u;
      u.uA0.value = a0; u.uDraw.value = draw;
      u.uCut.value = brk >= 0 ? brk / 0.45 : 0;
      ring.visible = draw > 0.001 && !(brk >= 0.45);
      mat.emissiveIntensity = 0.85 * glow;
      hl.material.uniforms.uGlow.value = glow;
      hl.visible = glow > 0.002;
      line.material.opacity = 0.55 * glow;
      light.intensity = 2.2 * glow;
      d.visible = brk >= 0 && brk < 1;
      d.material.uniforms.uT.value = Math.max(0, brk);
      d.material.uniforms.uA0.value = a0;
      d.material.uniforms.uPx.value = px;
      ripple.visible = rip >= 0 && rip < 1;
      if (ripple.visible) { ripple.scale.setScalar(1 + 0.42 * out3(rip)); ripple.material.opacity = 0.75 * (1 - rip); }
    },
  };
}

function keyLight(scene) {
  const k = new THREE.DirectionalLight('#fffaf0', 1.5); k.position.set(-5, 8, 9); scene.add(k);
  const f = new THREE.DirectionalLight('#ffffff', 0.35); f.position.set(6, -3, 6); scene.add(f);
}
function camera(half, fov) {
  const c = new THREE.PerspectiveCamera(fov, 1, 0.5, 80);
  c.position.set(0, 0, half / Math.tan(THREE.MathUtils.degToRad(fov / 2)));
  return c;
}

/* ================================================================== the hero field */
export function hero() {
  const rnd = prng(2026);
  const scene = new THREE.Scene();
  const cam = camera(4.45, 22);
  keyLight(scene);
  const field = new THREE.Group(); field.rotation.x = -0.5; scene.add(field);
  const rings = [];
  const add = (r, obj, { amp = 0.06, spin = 0 } = {}) => {
    const p = new THREE.Group(); p.add(obj); field.add(p);
    const g = { r, p, obj, amp, spin, z: -0.09 * r, ph: rnd(), w: 0.05 + rnd() * 0.09, lx: 0, ly: 0 };
    rings.push(g); return g;
  };
  add(0.64, torus(0.64, 0.05, M.graphite()), { amp: 0.03 });
  const dash = add(0.82, torus(0.82, 0.03, M.graphite({ seg: 28, gap: 0.32 })), { amp: 0.04 });
  add(1.0, hair(1.0, { opacity: 0.34 }), { amp: 0.05 });
  add(1.46, torus(1.46, 0.05, M.bone()), { amp: 0.06 });
  add(1.6, torus(1.6, 0.016, M.graphite()), { amp: 0.07 });
  add(1.72, ticks(1.72, 180, 0.05, { major: 15, majorLen: 2.2, opacity: 0.5 }), { amp: 0.05, spin: -0.03 });
  add(1.94, torus(1.94, 0.032, M.bone()), { amp: 0.08 });
  add(2.08, torus(2.08, 0.011, M.graphite()), { amp: 0.09 });
  add(2.22, hair(2.22, { opacity: 0.3 }), { amp: 0.07 });
  add(2.4, torus(2.4, 0.048, M.bone()), { amp: 0.1 });
  add(2.58, torus(2.58, 0.009, M.graphite()), { amp: 0.1 });
  add(2.74, hair(2.74, { opacity: 0.24 }), { amp: 0.08 });
  add(2.9, torus(2.9, 0.022, M.bone()), { amp: 0.11 });
  const arcs = add(3.08, torus(3.08, 0.013, M.graphite({ seg: 3, gap: 0.46 })), { amp: 0.12 });
  add(3.24, hair(3.24, { opacity: 0.2 }), { amp: 0.1 });
  add(3.36, ticks(3.36, 360, 0.03, { major: 30, majorLen: 3, opacity: 0.34 }), { amp: 0.09, spin: 0.012 });

  const cert = certRing(1.18, 0.072, { dustN: 3600, dustSize: 64, spread: 1.25 });
  field.add(cert.pivot);
  const A0 = -0.75; // the break point: lower right, the side nearest the viewer

  const P = 14;
  return {
    scene, camera: cam, key: 0,
    update(t, dt, input, px) {
      const τ = mod(t, P);
      let A = 0, lift = 1, glow = 1, brk = -1, draw = 1, rip = -1;
      if (τ < 4.2) { /* certified, holding */ }
      else if (τ < 7.0) { brk = (τ - 4.2) / 2.6; glow = 1 - smooth(seg(τ, 4.2, 4.8)); }
      else if (τ < 7.8) { draw = 0; glow = 0; lift = 0; A = 0.34; }
      else if (τ < 12) { draw = inOut(seg(τ, 7.8, 9.6)); glow = 0; lift = 0; A = 0.34; }
      else { const k = seg(τ, 12, 13.3); A = 0.34 * (1 - back(k)); lift = out3(k); glow = out3(seg(τ, 13.05, 13.6)); rip = τ >= 13.1 ? seg(τ, 13.1, 14.2) : -1; }
      const breathe = glow * (0.94 + 0.06 * Math.sin(t * 1.7));
      const φ = 0.7 + t * 0.45;
      cert.pivot.rotation.set(Math.cos(φ) * A, Math.sin(φ) * A, 0);
      cert.pivot.position.z = 0.1 * lift - 0.06;
      cert.set({ glow: breathe, brk, draw, a0: A0, rip, px });

      const calm = 1 - 0.65 * glow;
      for (const g of rings) {
        const ang = g.amp * calm * (0.6 + 0.4 * Math.sin(t * g.w * 2 + g.ph * TAU));
        const ph = g.ph * TAU + t * g.w;
        const rate = 1 - Math.exp(-dt * (7 - g.r * 1.4));
        g.lx += (input.x - g.lx) * rate; g.ly += (input.y - g.ly) * rate;
        g.p.rotation.set(Math.cos(ph) * ang - g.ly * 0.05 * g.r, Math.sin(ph) * ang + g.lx * 0.07 * g.r, g.spin * t);
        g.p.position.z = g.z;
      }
      dash.obj.material.userData.u.uOff.value = t * 0.05;
      arcs.p.rotation.z = t * 0.02;
      field.rotation.x = -0.5 + input.y * 0.08;
      field.rotation.y = input.x * 0.1;
    },
  };
}

/* ================================================================== the five moments */
function moment() {
  const scene = new THREE.Scene();
  const cam = camera(1.5, 24);
  keyLight(scene);
  const field = new THREE.Group(); field.rotation.x = -0.62; scene.add(field);
  field.add(hair(1.16, { opacity: 0.2 }));
  return { scene, cam, field };
}
const P8 = 8;

function shield() {
  const { scene, cam, field } = moment();
  const mat = M.graphite({ seg: 4, gap: 0 });
  const wall = torus(1.0, 0.042, mat);
  const wallP = new THREE.Group(); wallP.add(wall); field.add(wallP);
  field.add(hair(0.86, { opacity: 0.22 }));
  const spec = [[0.15, 0.3, 0.48], [0.11, 1.55, 0.52], [0.13, 2.65, 0.44], [0.1, 3.75, 0.55], [0.14, 4.9, 0.46], [0.09, 0, 0]];
  const notes = spec.map(([r, a, rad], i) => {
    const m = torus(r, 0.034, M.bone()); m.rotation.x = 0.35; field.add(m);
    return { m, a, rad, r, s: i * 0.12 };
  });
  return {
    scene, camera: cam, key: 0,
    update(t) {
      const τ = mod(t, P8);
      mat.userData.u.uGap.value = 0.24 * (smooth(seg(τ, 2.4, 3.2)) - smooth(seg(τ, 5.8, 7.0)));
      wallP.rotation.z = (Math.floor(t / P8) + smooth(seg(τ, 5.8, 7.0))) * (TAU / 4);
      for (const n of notes) {
        let x, y, z = 0, sc;
        if (τ < 3.2) { sc = 1 - smooth(seg(τ, 2.4, 3.0)); x = Math.cos(n.a) * n.rad; y = Math.sin(n.a) * n.rad; }
        else {
          const k = inOut(seg(τ, 3.8 + n.s, 6.0 + n.s));
          const a = n.a + 0.9 * (1 - k), rad = 1.42 + (n.rad - 1.42) * k;
          x = Math.cos(a) * rad; y = Math.sin(a) * rad; z = Math.sin(k * Math.PI) * 0.28;
          sc = smooth(seg(τ, 3.2, 3.7));
        }
        n.m.position.set(x, y, z); n.m.scale.setScalar(Math.max(0.0001, sc));
      }
    },
  };
}

function disclose() {
  const { scene, cam, field } = moment();
  field.add(torus(1.0, 0.042, M.graphite()));
  const spec = [[0.15, 0.4, 0.5], [0.1, 1.3, 0.62], [0.13, 2.2, 0.46], [0.09, 3.0, 0.6], [0.11, 3.9, 0.5], [0.14, 4.8, 0.55], [0.08, 5.6, 0.28]];
  const pick = [0, 2, 5];
  const bone = new THREE.Color(COL.bone), graph = new THREE.Color(COL.graphite);
  const notes = spec.map(([r, a, rad], i) => {
    const mat = M.bone(); const m = torus(r, 0.032, mat); m.rotation.x = 0.35; field.add(m);
    const j = pick.indexOf(i);
    const home = new THREE.Vector3(Math.cos(a) * rad, Math.sin(a) * rad, 0);
    const up = j < 0 ? null : new THREE.Vector3(Math.cos(j * TAU / 3 + 0.6) * 0.27, Math.sin(j * TAU / 3 + 0.6) * 0.27 - 0.3, 0.5);
    return { m, mat, home, up, j };
  });
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pick.length * 6), 3));
  const leaders = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: COL.ink, transparent: true, opacity: 0.38, depthWrite: false }));
  field.add(leaders);
  const tier = hair(0.5, { opacity: 0.55, open: true }); tier.position.set(0, -0.3, 0.5); field.add(tier);
  return {
    scene, camera: cam, key: 0,
    update(t) {
      const τ = mod(t, P8);
      const arr = lg.attributes.position.array;
      for (const n of notes) {
        if (!n.up) { n.m.position.copy(n.home); continue; }
        const lift = τ < 4 ? 1 - smooth(seg(τ, 2.2 + n.j * 0.15, 3.0 + n.j * 0.15)) : smooth(seg(τ, 4.6 + n.j * 0.35, 5.6 + n.j * 0.35));
        const k = inOut(lift);
        n.m.position.lerpVectors(n.home, n.up, k);
        n.mat.color.lerpColors(bone, graph, k); n.mat.metalness = 0.55 * k; n.mat.roughness = 0.5 - 0.16 * k; n.mat.sheen = 0.6 * (1 - k);
        arr.set([n.home.x, n.home.y, 0, n.m.position.x, n.m.position.y, n.m.position.z - 0.03], n.j * 6);
      }
      lg.attributes.position.needsUpdate = true;
      const d = τ < 4 ? 1 - smooth(seg(τ, 2.0, 2.6)) : smooth(seg(τ, 6.2, 7.4));
      tier.geometry.setDrawRange(0, Math.round(tier.userData.n * d));
      tier.visible = d > 0.002;
    },
  };
}

function attest() {
  const { scene, cam, field } = moment();
  const xs = [-0.42, 0, 0.42], rs = [0.15, 0.13, 0.14];
  const notes = xs.map((x, i) => { const m = torus(rs[i], 0.034, M.graphite()); m.rotation.x = 0.35; m.position.set(x, 0, 0.2); field.add(m); return m; });
  const checks = xs.map((x, i) => { const h = hair(rs[i] + 0.09, { opacity: 0 }); h.position.set(x, 0, 0.2); field.add(h); return h; });
  const sig = ticks(0.9, 240, 0.045, { major: 24, majorLen: 2.2, opacity: 0.6 });
  field.add(sig);
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const scan = new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: COL.ink, transparent: true, opacity: 0, depthWrite: false }));
  const band = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, uniforms: { uA: { value: 0 }, uColor: { value: new THREE.Color(COL.ink) } },
    vertexShader: 'varying vec2 vU; void main(){ vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA; uniform vec3 uColor; varying vec2 vU; void main(){ float a = uA * 0.12 * exp(-pow((vU.x - 0.85) / 0.22, 2.0)) * smoothstep(0.0, 0.12, vU.y) * smoothstep(1.0, 0.88, vU.y); gl_FragColor = vec4(uColor, a); #include <colorspace_fragment> }',
  }));
  field.add(scan, band);
  const pass = xs.map(x => 3.0 + 2.0 * invInOut((x + 1.0) / 2.0));
  return {
    scene, camera: cam, key: 0,
    update(t) {
      const τ = mod(t, P8);
      if (τ < 3.0) { sig.material.opacity = 0.6 * (1 - smooth(seg(τ, 2.4, 3.0))); sig.geometry.setDrawRange(0, 480); }
      else { sig.material.opacity = 0.6; sig.geometry.setDrawRange(0, 2 * Math.round(240 * inOut(seg(τ, 5.0, 7.2)))); }
      const sk = seg(τ, 3.0, 5.0), on = sk > 0 && sk < 1;
      const x = -1.0 + 2.0 * inOut(sk), hy = Math.sqrt(Math.max(0, 1.0 - x * x));
      sg.attributes.position.array.set([x, -hy, 0.2, x, hy, 0.2]); sg.attributes.position.needsUpdate = true;
      const vis = on ? Math.sin(Math.PI * sk) ** 0.4 : 0;
      scan.material.opacity = 0.7 * vis;
      band.material.uniforms.uA.value = vis; band.position.set(x - 0.12, 0, 0.2); band.scale.y = Math.max(0.001, hy);
      xs.forEach((_, i) => {
        checks[i].material.opacity = 0.5 * (τ < 3.0 ? 1 - smooth(seg(τ, 2.4, 3.0)) : smooth(seg(τ, pass[i], pass[i] + 0.3)));
        notes[i].position.z = 0.2 + (τ >= 3.0 ? 0.12 * Math.exp(-(((τ - pass[i]) / 0.18) ** 2)) : 0);
      });
    },
  };
}
function invInOut(y) { // inverse of inOut on [0,1]
  return y < 0.5 ? Math.cbrt(y / 4) : 1 - Math.cbrt(2 * (1 - y)) / 2;
}

function certify() {
  const { scene, cam, field } = moment();
  const sig = ticks(0.98, 240, 0.04, { major: 24, majorLen: 2.2, opacity: 0.4 }); field.add(sig);
  const cert = certRing(0.74, 0.06, { dustN: 10, dustSize: 14 });
  field.add(cert.pivot);
  return {
    scene, camera: cam, key: 0,
    update(t, dt, input, px) {
      const τ = mod(t, P8);
      const k = smooth(seg(τ, 2.4, 3.6)), lock = back(seg(τ, 5.6, 7.0));
      const A = τ < 4.6 ? 0.55 * k : 0.55 * (1 - lock);
      const φ = 1.2 + τ * 0.9;
      cert.pivot.rotation.set(Math.cos(φ) * A, Math.sin(φ) * A, 0);
      cert.pivot.position.z = 0.15 * (τ < 4.6 ? 1 - k : Math.min(1, lock));
      const glow = (τ < 4.6 ? 1 - smooth(seg(τ, 2.4, 3.0)) : smooth(seg(τ, 6.75, 7.3))) * (0.93 + 0.07 * Math.sin(t * 2));
      cert.set({ glow, rip: τ >= 6.8 ? seg(τ, 6.8, 7.9) : -1, px });
      sig.rotation.z = t * 0.03;
    },
  };
}

function revoke() {
  const { scene, cam, field } = moment();
  const sig = ticks(0.98, 240, 0.04, { major: 24, majorLen: 2.2, opacity: 0.4 }); field.add(sig);
  const cert = certRing(0.74, 0.06, { dustN: 1500, dustSize: 15, spread: 0.6, seed: 5 });
  field.add(cert.pivot);
  const A0 = -0.85;
  const note = torus(0.1, 0.03, M.graphite()); note.rotation.x = 0.35; field.add(note);
  const B0 = 6.65, BD = 4.2;
  return {
    scene, camera: cam, key: 0,
    update(t, dt, input, px) {
      const τ = mod(t, P8);
      const s = mod(τ - B0, P8);
      let brk = -1, draw = 1, glow = 1;
      if (s < BD) { brk = s / BD; glow = 1 - smooth(seg(s, 0, 0.6)); }
      else if (τ < 3.2) { draw = 0; glow = 0; }
      else if (τ < 4.6) { draw = inOut(seg(τ, 3.2, 4.6)); glow = smooth(seg(τ, 4.4, 5.0)); }
      else glow = smooth(seg(τ, 4.4, 5.0));
      cert.set({ glow: glow * (0.93 + 0.07 * Math.sin(t * 2)), brk, draw, a0: A0, px });
      let r = 0.45, sc = 0;
      if (τ >= 4.0 && τ < 6.2) sc = smooth(seg(τ, 4.0, 4.6));
      else if (τ >= 6.2) { sc = 1; r = 0.45 + 0.9 * inOut(seg(τ, 6.2, 7.2)); }
      else if (τ < 1.0) { sc = 1 - smooth(seg(τ, 0.3, 1.0)); r = 1.35; }
      note.position.set(Math.cos(A0) * r, Math.sin(A0) * r, 0.1 + 0.18 * Math.sin(Math.PI * seg(r, 0.45, 1.35)));
      note.scale.setScalar(Math.max(0.0001, sc));
      sig.rotation.z = t * 0.03;
    },
  };
}

const STEPS = { shield, disclose, attest, certify, revoke };
export const step = name => STEPS[name]();

/* ================================================================== the stage: one canvas, many views */
export class Stage {
  constructor(canvas, { dprMax = 2 } = {}) {
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.dpr = Math.min(window.devicePixelRatio || 1, dprMax);
    r.setPixelRatio(this.dpr);
    this.r = r; this.canvas = canvas; this.env = studio(r);
    this.views = []; this.offset = 0; this.t0 = null; this.last = 0; this.w = 0; this.h = 0; this.frames = 0;
  }
  add(el, s, mode = 'rect') { s.scene.environment = this.env; this.views.push({ el, s, mode }); return this; }
  size() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w !== this.w || h !== this.h) { this.w = w; this.h = h; this.r.setSize(w, h, false); }
  }
  /** draw one frame; `now` in ms; returns false when nothing was drawn */
  render(now, input = { x: 0, y: 0 }) {
    this.size();
    if (!this.w || !this.h) return false;
    if (this.t0 === null) { this.t0 = now; this.last = now; }
    const t = this.freeze ? this.offset : (now - this.t0) / 1000 + this.offset, dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const r = this.r, cr = this.canvas.getBoundingClientRect();
    r.setScissorTest(false); r.clear(); r.setScissorTest(true);
    for (const v of this.views) {
      const b = v.el.getBoundingClientRect(), x = b.left - cr.left, y = b.top - cr.top, cam = v.s.camera;
      if (v.mode === 'virtual') {
        const V = b.width * 1.25;
        cam.setViewOffset(V, V, V / 2 - (x + b.width / 2), V / 2 - (y + b.height / 2), this.w, this.h);
        r.setViewport(0, 0, this.w, this.h); r.setScissor(0, 0, this.w, this.h);
      } else {
        if (b.bottom < -50 || b.top > innerHeight + 50 || !b.width) continue;
        cam.aspect = b.width / b.height; cam.updateProjectionMatrix();
        const yb = this.h - y - b.height;
        r.setViewport(x, yb, b.width, b.height); r.setScissor(x, yb, b.width, b.height);
      }
      v.s.update(t + v.s.key, dt, input, this.dpr);
      r.render(v.s.scene, cam);
    }
    this.frames++;
    return true;
  }
  /** a still of view i at its key frame, px square, transparent (used to make the files in still/) */
  still(i, px, pxScale = 2) {
    const v = this.views[i], r = this.r, cam = v.s.camera;
    r.setPixelRatio(1); r.setSize(px, px, false); r.setScissorTest(false); r.setViewport(0, 0, px, px);
    cam.clearViewOffset(); cam.aspect = 1; cam.updateProjectionMatrix();
    v.s.update(v.s.key, 0, { x: 0, y: 0 }, pxScale);
    r.clear(); r.render(v.s.scene, cam);
    const url = this.canvas.toDataURL('image/png');
    r.setPixelRatio(this.dpr); this.w = 0; this.h = 0;
    return url;
  }
}
