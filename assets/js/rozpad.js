/* Auto TriM – dodávka rozložená na díly.
   Při načtení se složí z dílů, při rolování se rozebere: karoserie, kola, brzdy, motor…
   Kreslí se jako technická ilustrace (ploché tóny + obrys), bez knihoven kromě three.js. */
import * as THREE from "./vendor/three.module.min.js";
import { RoundedBoxGeometry } from "./vendor/RoundedBoxGeometry.js";

THREE.ColorManagement.enabled = false;

const stage = document.querySelector("[data-stage]");
if (stage) {
  try { init(stage); } catch (e) { console.warn("rozpad:", e); }
  if (!stage.classList.contains("is-live")) stage.classList.add("no-3d");
}

function init(stage) {
  const pin = stage.querySelector("[data-pin]");
  const view = stage.querySelector("[data-view]");
  const canvas = stage.querySelector("[data-canvas]");
  const copy = stage.querySelector("[data-copy]");
  const tagBox = stage.querySelector("[data-tags]");
  const leads = stage.querySelector("[data-leads]");
  const legend = stage.querySelector("[data-legend]");
  const hint = stage.querySelector("[data-hint]");
  const endNote = stage.querySelector("[data-end]");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch (e) { return; }
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  /* ---------- barvy a materiály ---------- */
  const C = {
    body: 0xf7f6f1, glass: 0x343b42, dark: 0x2c2c2c, black: 0x1d1d1d, tyre: 0x2a2a2a, rim: 0xd2d2cc,
    steel: 0xa3a49e, engine: 0xbcbdb6, head: 0xd3d3cd, frame: 0x55565a, floor: 0xcfcec8, seat: 0x4a4c50,
    yellow: 0xefeb0e, red: 0xd61f13, lens: 0xe8eef0, kraft: 0xd2b98f, white: 0xffffff,
  };
  const LIGHT = new THREE.Vector3(0.16, 0.86, 0.5).normalize();
  const HI = new THREE.Color(0xefeb0e);
  const INK = new THREE.Color(0x161616);

  const TOON_VS = `
    varying vec3 vN;
    void main() {
      vN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`;
  const TOON_FS = `
    uniform vec3 uColor; uniform vec3 uHiColor; uniform vec3 uLight; uniform float uHi;
    varying vec3 vN;
    void main() {
      float d = dot(normalize(vN), uLight);
      float b = d > 0.7 ? 1.0 : (d > 0.3 ? 0.9 : (d > -0.2 ? 0.8 : 0.7));
      gl_FragColor = vec4(mix(uColor, uHiColor, uHi) * b, 1.0);
    }`;
  const OUT_VS = `
    uniform float uPx; uniform vec2 uRes;
    attribute vec3 onormal;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 vn = normalize(normalMatrix * onormal);
      vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy * uRes;
      float l = length(dir);
      if (l > 1e-6) dir /= l;
      clip.xy += dir * uPx * 2.0 / uRes * clip.w;
      gl_Position = clip;
    }`;
  const OUT_FS = `uniform vec3 uInk; void main() { gl_FragColor = vec4(uInk, 1.0); }`;

  const outlineMat = new THREE.ShaderMaterial({
    uniforms: { uPx: { value: 1.5 }, uRes: { value: new THREE.Vector2(1, 1) }, uInk: { value: INK } },
    vertexShader: OUT_VS, fragmentShader: OUT_FS, side: THREE.BackSide,
  });
  // spáry dveří, kapoty a světel: ve složeném voze tenké, při rozložení plný obrys
  const seamMat = outlineMat.clone();
  seamMat.uniforms.uRes = outlineMat.uniforms.uRes;
  seamMat.uniforms.uInk = outlineMat.uniforms.uInk;

  const mats = new Map();
  const catMats = new Map(); // kategorie -> [materiály] kvůli zvýraznění
  function toon(hex, cat) {
    const key = hex + "|" + (cat || "");
    let m = mats.get(key);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(hex) }, uHiColor: { value: HI }, uLight: { value: LIGHT }, uHi: { value: 0 } },
        vertexShader: TOON_VS, fragmentShader: TOON_FS,
      });
      mats.set(key, m);
      if (cat) (catMats.get(cat) || catMats.set(cat, []).get(cat)).push(m);
    }
    return m;
  }

  // obrysová geometrie: normály zprůměrované podle polohy, aby obrys neměl mezery v rozích
  const outlineCache = new WeakMap();
  function outlineGeo(g) {
    let og = outlineCache.get(g);
    if (og) return og;
    const pos = g.attributes.position, nor = g.attributes.normal;
    const acc = new Map(), keys = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.round(pos.getX(i) * 2e3) + "," + Math.round(pos.getY(i) * 2e3) + "," + Math.round(pos.getZ(i) * 2e3);
      keys[i] = k;
      const a = acc.get(k) || acc.set(k, [0, 0, 0]).get(k);
      a[0] += nor.getX(i); a[1] += nor.getY(i); a[2] += nor.getZ(i);
    }
    const on = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = acc.get(keys[i]), l = Math.hypot(a[0], a[1], a[2]) || 1;
      on[i * 3] = a[0] / l; on[i * 3 + 1] = a[1] / l; on[i * 3 + 2] = a[2] / l;
    }
    og = new THREE.BufferGeometry();
    og.setAttribute("position", pos);
    og.setAttribute("onormal", new THREE.BufferAttribute(on, 3));
    if (g.index) og.setIndex(g.index);
    outlineCache.set(g, og);
    return og;
  }

  let CUR = null; // právě stavěná kategorie dílů
  let SEAM = false; // stavíme panel přiložený na karoserii
  const pickables = [];
  function part(geo, hex, parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
    const m = new THREE.Mesh(geo, toon(hex, CUR));
    m.position.set(pos[0], pos[1], pos[2]);
    m.rotation.set(rot[0], rot[1], rot[2]);
    const o = new THREE.Mesh(outlineGeo(geo), SEAM ? seamMat : outlineMat);
    o.userData.isOutline = true;
    o.raycast = () => {};
    m.add(o);
    m.userData.cat = CUR;
    if (CUR) pickables.push(m);
    parent.add(m);
    return m;
  }
  function within(cat, fn) { const p = CUR; CUR = cat; fn(); CUR = p; }
  function seam(fn) { SEAM = true; fn(); SEAM = false; }

  const geoCache = new Map();
  const cached = (key, make) => geoCache.get(key) || geoCache.set(key, make()).get(key);
  const box = (w, h, d, r = 0.02) => cached(`b${w},${h},${d},${r}`, () =>
    new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) / 2 - 1e-4)));
  const cyl = (rt, rb, h, seg = 28) => cached(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
  const cylZ = (r, h, seg = 32) => cached(`cz${r},${h},${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg).rotateX(Math.PI / 2));
  const cylX = (r, h, seg = 24) => cached(`cx${r},${h},${seg}`, () => new THREE.CylinderGeometry(r, r, h, seg).rotateZ(Math.PI / 2));

  /* ---------- rozklad: posuny a natočení dílů v čase ---------- */
  const moves = [];
  // skupina s otočným bodem (pant dveří, kapoty…)
  function assembly(parent, pivot = [0, 0, 0]) {
    const outer = new THREE.Group();
    outer.position.set(pivot[0], pivot[1], pivot[2]);
    const inner = new THREE.Group();
    inner.position.set(-pivot[0], -pivot[1], -pivot[2]);
    outer.add(inner);
    parent.add(outer);
    return { outer, inner };
  }
  function explode(obj, { d = [0, 0, 0], r = [0, 0, 0], t = [0, 1] }) {
    moves.push({ obj, base: obj.position.clone(), rot: obj.rotation.clone(), d: new THREE.Vector3(...d), r, t0: t[0], t1: t[1] });
  }
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function applyProgress(p) {
    for (const m of moves) {
      const k = ease(clamp01((p - m.t0) / (m.t1 - m.t0)));
      m.obj.position.copy(m.base).addScaledVector(m.d, k);
      m.obj.rotation.set(m.rot.x + m.r[0] * k, m.rot.y + m.r[1] * k, m.rot.z + m.r[2] * k);
    }
  }

  /* ---------- karoserie dodávky (plocha táhnutá po délce vozu) ---------- */
  const AXLES = [1.55, -1.6], WHEEL_Y = 0.34, ARCH = 0.43, BELT = 1.2, HALF_L = 2.5, HALF_W = 0.98;
  function yTop(x) {
    if (x < -2.42) { const t = Math.min(1, (-2.42 - x) / 0.08); return 1.88 + 0.08 * Math.sqrt(1 - t * t); }
    if (x <= 0.95) return 1.96;
    if (x <= 1.78) { const t = (x - 0.95) / 0.83; return 1.96 - 0.76 * t + 0.035 * Math.sin(Math.PI * t); }
    if (x <= 2.36) { const t = (x - 1.78) / 0.58; return 1.2 - 0.18 * t + 0.025 * Math.sin(Math.PI * t); }
    const t = Math.min(1, (x - 2.36) / 0.14);
    return 0.62 + 0.4 * Math.sqrt(1 - t * t);
  }
  function yBot(x) {
    let y = 0.36;
    if (x > 2.25) y += (x - 2.25) * 0.3;
    if (x < -2.35) y += (-2.35 - x) * 0.4;
    for (const ax of AXLES) {
      const d = x - ax;
      if (Math.abs(d) < ARCH) y = Math.max(y, WHEEL_Y + Math.sqrt(ARCH * ARCH - d * d));
    }
    return y;
  }
  function halfW(x) {
    const rc = x > 0 ? 0.34 : 0.14;
    const e = Math.abs(x) - (HALF_L - rc);
    if (e <= 0) return HALF_W;
    return HALF_W - rc + Math.sqrt(Math.max(0, rc * rc - e * e));
  }
  function section(x) {
    const y0 = yBot(x), yt = yTop(x), W = halfW(x), h = yt - y0;
    const Wt = W - 0.11 * clamp01((yt - BELT) / 0.5);
    const rb = Math.min(0.07, h * 0.2);
    const rr = Math.min(0.15, h * 0.3, Wt * 0.45);
    const yb = Math.min(Math.max(BELT, y0 + rb + 0.002), yt - rr - 0.002);
    return { y0, yt, W, Wt, rb, rr, yb };
  }
  // sigma 0..6 = pravý bok odspodu po střechu, 6..12 = levý bok zpět dolů
  function ringPt(x, sigma, s, out) {
    let side = 1, q = sigma;
    if (q > 6) { side = -1; q = 12 - q; }
    const seg = Math.min(5, Math.floor(q)), t = q - seg;
    let z, y;
    switch (seg) {
      case 0: z = (s.W - s.rb) * t; y = s.y0; break;
      case 1: { const a = -Math.PI / 2 + t * Math.PI / 2; z = s.W - s.rb + s.rb * Math.cos(a); y = s.y0 + s.rb + s.rb * Math.sin(a); break; }
      case 2: z = s.W; y = s.y0 + s.rb + (s.yb - s.y0 - s.rb) * t; break;
      case 3: z = s.W + (s.Wt - s.W) * t; y = s.yb + (s.yt - s.rr - s.yb) * t; break;
      case 4: { const a = t * Math.PI / 2; z = s.Wt - s.rr + s.rr * Math.cos(a); y = s.yt - s.rr + s.rr * Math.sin(a); break; }
      default: z = (s.Wt - s.rr) * (1 - t); y = s.yt;
    }
    return out.set(x, y, z * side);
  }
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
  function surfNormal(x, sg, out) {
    const h = 1e-3;
    ringPt(x + h, sg, section(x + h), _a); ringPt(x - h, sg, section(x - h), _b);
    ringPt(x, sg + h, section(x), _c); ringPt(x, sg - h, section(x), _d);
    _a.sub(_b); _c.sub(_d);
    return out.crossVectors(_a, _c).normalize();
  }
  function stations() {
    const xs = new Set();
    const add = (a, b, n) => { for (let i = 0; i <= n; i++) xs.add(+(a + (b - a) * i / n).toFixed(4)); };
    add(-2.5, -2.3, 8); add(-2.3, -2.03, 3); add(-2.03, -1.17, 26); add(-1.17, 0.95, 10);
    add(0.95, 1.12, 4); add(1.12, 1.98, 26); add(1.98, 2.36, 8); add(2.36, 2.5, 12);
    return [...xs].sort((a, b) => a - b);
  }
  function ringSigmas() {
    const segN = [4, 4, 6, 6, 6, 6], A = [];
    for (let s = 0; s < 6; s++) for (let i = 0; i < segN[s]; i++) A.push(s + i / segN[s]);
    return [...A, 6, ...A.filter((a) => a > 0).map((a) => 12 - a).reverse()];
  }
  function bodyGeometry() {
    const xs = stations(), sig = ringSigmas(), nI = xs.length, nJ = sig.length;
    const pos = [], idx = [], p = new THREE.Vector3();
    for (const x of xs) { const s = section(x); for (const sg of sig) { ringPt(x, sg, s, p); pos.push(p.x, p.y, p.z); } }
    for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ; j++) {
      const j2 = (j + 1) % nJ, a = i * nJ + j, b = (i + 1) * nJ + j, c = (i + 1) * nJ + j2, d = i * nJ + j2;
      idx.push(a, b, c, a, c, d);
    }
    for (const [i, rear] of [[0, true], [nI - 1, false]]) {
      const start = pos.length / 3;
      let cx = 0, cy = 0, cz = 0;
      for (let j = 0; j < nJ; j++) { const k = (i * nJ + j) * 3; cx += pos[k]; cy += pos[k + 1]; cz += pos[k + 2]; }
      pos.push(cx / nJ, cy / nJ, cz / nJ);
      for (let j = 0; j < nJ; j++) { const k = (i * nJ + j) * 3; pos.push(pos[k], pos[k + 1], pos[k + 2]); }
      for (let j = 0; j < nJ; j++) {
        const a = start, b = start + 1 + j, c = start + 1 + ((j + 1) % nJ);
        if (rear) idx.push(a, b, c); else idx.push(a, c, b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  // panel přiložený na karoserii (dveře, kapota, okna) – uzavřená tenká deska kopírující plochu
  function slab(xa, xb, sa, sb, { nx = 18, ns = 10, off = 0.003, th = 0.016 } = {}) {
    const pos = [], idx = [], v = new THREE.Vector3(), n = new THREE.Vector3();
    const W = ns + 1;
    const grid = (o) => {
      const start = pos.length / 3;
      for (let i = 0; i <= nx; i++) {
        const x = xa + (xb - xa) * i / nx, s = section(x);
        for (let j = 0; j <= ns; j++) {
          const sg = sa + (sb - sa) * j / ns;
          ringPt(x, sg, s, v); surfNormal(x, sg, n); v.addScaledVector(n, o);
          pos.push(v.x, v.y, v.z);
        }
      }
      return start;
    };
    const outer = grid(off + th), inner = grid(off);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ns; j++) {
      const a = i * W + j, b = (i + 1) * W + j, c = (i + 1) * W + j + 1, d = i * W + j + 1;
      idx.push(outer + a, outer + b, outer + c, outer + a, outer + c, outer + d);
      idx.push(inner + a, inner + c, inner + b, inner + a, inner + d, inner + c);
    }
    const edge = [];
    for (let i = 0; i < nx; i++) edge.push([i, 0]);
    for (let j = 0; j < ns; j++) edge.push([nx, j]);
    for (let i = nx; i > 0; i--) edge.push([i, ns]);
    for (let j = ns; j > 0; j--) edge.push([0, j]);
    for (let k = 0; k < edge.length; k++) {
      const [i1, j1] = edge[k], [i2, j2] = edge[(k + 1) % edge.length];
      const s = pos.length / 3;
      for (const q of [outer + i1 * W + j1, outer + i2 * W + j2, inner + i2 * W + j2, inner + i1 * W + j1]) pos.push(pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]);
      idx.push(s, s + 3, s + 2, s, s + 2, s + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  const mirrorSigma = (a, b, side) => (side > 0 ? [a, b] : [12 - b, 12 - a]);
  // tenká plocha s texturou těsně nad karoserií (polep)
  function decal(xa, xb, sa, sb, off, nx = 24, ns = 8) {
    const pos = [], uv = [], idx = [], v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i <= nx; i++) {
      const x = xa + (xb - xa) * i / nx, s = section(x);
      for (let j = 0; j <= ns; j++) {
        const sg = sa + (sb - sa) * j / ns;
        ringPt(x, sg, s, v); surfNormal(x, sg, n); v.addScaledVector(n, off);
        pos.push(v.x, v.y, v.z); uv.push(i / nx, j / ns);
      }
    }
    for (let i = 0; i < nx; i++) for (let j = 0; j < ns; j++) {
      const a = i * (ns + 1) + j, b = a + ns + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  /* ---------- scéna ---------- */
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);
  const van = new THREE.Group();
  root.add(van);

  // stín pod vozem (plochý, bez rozmazání)
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0xdcdbd3 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(3.05, 1.3, 1);
  shadow.position.y = 0.001;
  root.add(shadow);

  const tags = {}; // kategorie -> kotevní díl popisku

  // podvozek a interiér – zůstávají na místě
  within(null, () => {
    for (const z of [0.5, -0.5]) part(box(4.5, 0.1, 0.09), C.frame, van, [-0.05, 0.3, z]);
    for (const x of [2.05, 0.6, -0.8, -2.15]) part(box(0.09, 0.08, 1.0), C.frame, van, [x, 0.3, 0]);
    part(cyl(0.035, 0.035, 1.5, 16), C.frame, van, [AXLES[0], WHEEL_Y, 0], [Math.PI / 2, 0, 0]);
    part(cyl(0.05, 0.05, 1.46, 16), C.frame, van, [AXLES[1], WHEEL_Y, 0], [Math.PI / 2, 0, 0]);
    part(box(4.6, 0.05, 1.8), C.floor, van, [-0.1, 0.41, 0]);
    part(box(0.34, 0.26, 1.8, 0.06), C.dark, van, [1.52, 1.0, 0]);
    // náklad: krabice s díly
    part(box(0.5, 0.36, 0.44, 0.015), C.kraft, van, [-1.95, 0.62, -0.42]);
    part(box(0.44, 0.3, 0.4, 0.015), C.kraft, van, [-1.95, 0.95, -0.4], [0, 0.12, 0]);
    part(box(0.56, 0.42, 0.5, 0.015), C.kraft, van, [-1.25, 0.65, -0.5], [0, -0.08, 0]);
  });

  /* karoserie se zvedne a za letu z ní odpadnou dveře, kapota, světla, stěrače */
  const body = new THREE.Group();
  van.add(body);
  within(null, () => {
    part(bodyGeometry(), C.body, body);
    part(slab(1.0, 1.745, 4.72, 7.28, { nx: 14, ns: 16, off: -0.007, th: 0.01 }), C.glass, body);
    part(slab(2.392, 2.49, 5.3, 6.7, { nx: 6, ns: 10, off: -0.009, th: 0.012 }), C.dark, body);
  });
  explode(body, { d: [0, 2.55, 0], t: [0.0, 0.22] });

  /* polep jako na firemní dodávce: logo a telefon na boku nákladového prostoru (za posuvnými dveřmi) */
  {
    const cv = document.createElement("canvas");
    cv.width = 1024; cv.height = 352;
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uLight: { value: LIGHT } },
      vertexShader: `
        varying vec3 vN; varying vec2 vUv;
        void main() {
          vUv = uv;
          vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uLight;
        varying vec3 vN; varying vec2 vUv;
        void main() {
          vec4 t = texture2D(uMap, vUv);
          float d = dot(normalize(vN), uLight);
          float b = d > 0.7 ? 1.0 : (d > 0.3 ? 0.9 : (d > -0.2 ? 0.8 : 0.7));
          gl_FragColor = vec4(t.rgb * b, smoothstep(0.15, 0.6, t.a));
        }`,
      transparent: true, depthWrite: false,
    });
    const m = new THREE.Mesh(decal(-2.32, -0.95, 3.05, 3.82, 0.004), mat);
    m.raycast = () => {};
    body.add(m);
    const img = new Image();
    img.onload = async () => {
      try { await document.fonts.load("500 56px Rubik"); } catch (e) {}
      const g = cv.getContext("2d");
      g.drawImage(img, 12, 14, 1000, 1000 * img.height / img.width);
      g.fillStyle = "#161616";
      g.font = "500 56px Rubik, Arial, sans-serif";
      g.fillText("Autodíly · 519 425 986", 272, 316);
      tex.needsUpdate = true;
      invalidate();
    };
    img.src = new URL("../img/logo-black.png", import.meta.url).href;
  }

  within(null, () => {
    // přední dveře s okny a zrcátky (pant vpředu)
    for (const side of [1, -1]) {
      const { outer, inner } = assembly(body, [1.66, 1.0, side * HALF_W]);
      part(slab(0.34, 1.66, ...mirrorSigma(2.1, 3.97, side), { nx: 24, ns: 14, off: -0.013, th: 0.016 }), C.body, inner);
      part(slab(0.44, 1.6, ...mirrorSigma(3.1, 3.9, side), { nx: 18, ns: 6, off: 0.002, th: 0.004 }), C.glass, inner);
      part(box(0.13, 0.035, 0.035, 0.012), C.dark, inner, [0.52, 1.08, side * (HALF_W + 0.016)]);
      part(box(0.07, 0.045, 0.16, 0.015), C.dark, inner, [1.6, 1.3, side * (HALF_W + 0.07)]);
      part(box(0.1, 0.2, 0.15, 0.035), C.dark, inner, [1.58, 1.36, side * (HALF_W + 0.17)]);
      explode(outer, { d: [0.15, 0.05, side * 0.75], r: [0, side * 0.75, 0], t: [0.16, 0.38] });
    }
    // posuvné dveře
    {
      const g = new THREE.Group();
      body.add(g);
      part(slab(-0.86, 0.27, 2.1, 3.97, { nx: 22, ns: 14, off: -0.013, th: 0.016 }), C.body, g);
      part(box(0.04, 0.04, 0.035, 0.012), C.dark, g, [0.2, 1.08, HALF_W + 0.016]);
      explode(g, { d: [-0.55, 0.0, 1.05], t: [0.18, 0.4] });
    }
    // kapota (pant u čelního skla)
    {
      const { outer, inner } = assembly(body, [1.8, 1.19, 0]);
      part(slab(1.8, 2.37, 4.05, 7.95, { nx: 14, ns: 24, off: -0.015, th: 0.018 }), C.body, inner);
      explode(outer, { d: [0.25, 0.55, 0], r: [0, 0, 0.75], t: [0.15, 0.36] });
    }
    // zadní dveře (panty na krajích)
    for (const side of [1, -1]) {
      const { outer, inner } = assembly(body, [-2.5, 1.17, side * 0.83]);
      part(box(0.035, 1.42, 0.79, 0.012), C.body, inner, [-2.493, 1.17, side * 0.415]);
      part(box(0.012, 0.42, 0.6, 0.008), C.glass, inner, [-2.509, 1.56, side * 0.425]);
      part(box(0.035, 0.035, 0.1, 0.01), C.dark, inner, [-2.54, 1.0, side * 0.06]);
      explode(outer, { d: [-0.55, 0, side * 0.3], r: [0, side * 1.15, 0], t: [0.17, 0.4] });
    }
  });

  within("Osvětlení a elektro", () => {
    for (const side of [1, -1]) {
      const g = new THREE.Group();
      body.add(g);
      const m = part(slab(2.372, 2.488, ...mirrorSigma(4.15, 5.05, side), { nx: 8, ns: 8, off: -0.016, th: 0.02 }), C.lens, g);
      explode(g, { d: [0.7, 0.12, side * 0.28], t: [0.2, 0.4] });
      if (side > 0) tags["Osvětlení a elektro"] = m;
      const t = new THREE.Group();
      body.add(t);
      part(box(0.06, 0.46, 0.12, 0.02), C.red, t, [-2.47, 0.86, side * 0.86]);
      explode(t, { d: [-0.45, 0.1, side * 0.2], t: [0.22, 0.42] });
    }
  });

  within("Stěrače", () => {
    const g = new THREE.Group();
    body.add(g);
    const a = part(box(0.035, 0.03, 0.66, 0.012), C.black, g, [1.735, 1.235, 0.36], [0, 0.08, -0.6]);
    part(box(0.035, 0.03, 0.66, 0.012), C.black, g, [1.735, 1.235, -0.38], [0, 0.08, -0.6]);
    explode(g, { d: [0.45, 0.42, 0.25], t: [0.18, 0.38] });
    tags["Stěrače"] = a;
  });

  /* nárazníky */
  within(null, () => {
    const f = new THREE.Group(); van.add(f);
    part(box(0.26, 0.27, 1.92, 0.1), C.dark, f, [2.46, 0.47, 0]);
    explode(f, { d: [0.95, -0.12, 0], t: [0.28, 0.46] });
    const r = new THREE.Group(); van.add(r);
    part(box(0.18, 0.2, 1.92, 0.08), C.dark, r, [-2.53, 0.44, 0]);
    explode(r, { d: [-0.75, -0.1, 0], t: [0.28, 0.46] });
  });

  /* interiér: sedadla, volant, výbava v nákladovém prostoru */
  within(null, () => {
    const seats = new THREE.Group(); van.add(seats);
    for (const z of [-0.55, 0.12, 0.58]) {
      const w = z < 0 ? 0.52 : 0.4;
      part(box(0.5, 0.14, w, 0.05), C.seat, seats, [0.9, 0.62, z]);
      part(box(0.13, 0.62, w, 0.05), C.seat, seats, [0.62, 0.98, z], [0, 0, 0.12]);
      part(box(0.09, 0.15, w * 0.6, 0.04), C.seat, seats, [0.58, 1.38, z], [0, 0, 0.12]);
    }
    explode(seats, { d: [0, 0.7, 0], t: [0.3, 0.5] });
    const wheel = new THREE.Group(); van.add(wheel);
    const sw = new THREE.TorusGeometry(0.19, 0.024, 10, 36);
    part(sw, C.black, wheel, [1.28, 1.25, -0.55], [0, Math.PI / 2, 0.55]);
    part(cyl(0.025, 0.025, 0.42, 10), C.dark, wheel, [1.42, 1.15, -0.55], [0, 0, 1.0]);
    explode(wheel, { d: [0.1, 0.95, 0], t: [0.32, 0.52] });
  });
  within("Výbava a autodoplňky", () => {
    const g = new THREE.Group(); van.add(g);
    const tri = new THREE.TorusGeometry(0.22, 0.045, 6, 3);
    const t = part(tri, C.red, g, [-0.95, 0.72, 0.42], [0, -0.35, Math.PI / 2]);
    part(box(0.05, 0.03, 0.34, 0.01), C.dark, g, [-0.95, 0.47, 0.42], [0, -0.35, 0]);
    part(box(0.36, 0.22, 0.26, 0.03), C.white, g, [-1.55, 0.55, 0.45]);
    part(box(0.05, 0.12, 0.012, 0.004), C.red, g, [-1.55, 0.56, 0.585]);
    part(box(0.12, 0.04, 0.012, 0.004), C.red, g, [-1.55, 0.56, 0.585]);
    explode(g, { d: [0, 0.75, 0.35], t: [0.32, 0.52] });
    tags["Výbava a autodoplňky"] = t;
  });

  /* kola, brzdy, tlumiče */
  for (const ax of AXLES) for (const side of [1, -1]) {
    const front = ax > 0;
    within(null, () => {
      const w = new THREE.Group();
      w.position.set(ax, WHEEL_Y, side * 0.845);
      van.add(w);
      const tyre = cached("tyre", () => new THREE.TorusGeometry(0.275, 0.068, 14, 48).scale(1, 1, 1.55));
      part(tyre, C.tyre, w);
      part(cylZ(0.212, 0.15, 40), C.rim, w);
      part(cylZ(0.07, 0.05, 20), C.steel, w, [0, 0, side * 0.085]);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        part(cylZ(0.016, 0.03, 8), C.dark, w, [Math.cos(a) * 0.115, Math.sin(a) * 0.115, side * 0.078]);
      }
      explode(w, { d: [0, 0, side * 1.05], r: [0, 0, -side * Math.PI * 1.5], t: [0.42, 0.64] });
    });
    within("Brzdy", () => {
      const disc = new THREE.Group();
      disc.position.set(ax, WHEEL_Y, side * 0.72);
      van.add(disc);
      part(cylZ(0.165, 0.024, 40), C.steel, disc);
      part(cylZ(0.085, 0.06, 24), C.head, disc, [0, 0, side * 0.025]);
      explode(disc, { d: [0, 0, side * 0.55], t: [0.46, 0.66] });
      const cal = new THREE.Group();
      const ang = front ? 2.3 : 0.85;
      cal.position.set(ax + Math.cos(ang) * 0.14, WHEEL_Y + Math.sin(ang) * 0.14, side * 0.72);
      cal.rotation.z = ang - Math.PI / 2;
      van.add(cal);
      const c = part(box(0.17, 0.09, 0.09, 0.03), C.yellow, cal);
      explode(cal, { d: [0, 0.14, side * 0.72], t: [0.48, 0.68] });
      if (front && side > 0) tags["Brzdy"] = c;
    });
    within("Podvozek a tlumiče", () => {
      const g = new THREE.Group();
      const top = front ? 1.05 : 0.78, bot = front ? 0.44 : 0.42;
      g.position.set(ax + (front ? 0.02 : 0.12), 0, side * (front ? 0.62 : 0.56));
      van.add(g);
      const hgt = top - bot - 0.12;
      const turns = front ? 5 : 4;
      const spring = cached("spring" + front, () => {
        const pts = [];
        for (let i = 0; i <= turns * 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a) * 0.075, (i / (turns * 24)) * hgt, Math.sin(a) * 0.075));
        }
        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), turns * 24, 0.014, 6, false);
      });
      const s = part(spring, C.red, g, [0, bot + 0.06, 0]);
      part(cyl(0.032, 0.032, top - bot, 12), C.dark, g, [0, (top + bot) / 2 - 0.04, 0]);
      part(cyl(0.1, 0.1, 0.02, 20), C.dark, g, [0, top - 0.04, 0]);
      part(cyl(0.1, 0.1, 0.02, 20), C.dark, g, [0, bot + 0.05, 0]);
      explode(g, { d: [0, front ? 1.0 : 0.85, side * 0.32], t: [0.44, 0.66] });
      if (front && side > 0) tags["Podvozek a tlumiče"] = s;
    });
  }

  /* motor s převodovkou, chladič, baterie */
  const engine = new THREE.Group();
  // celý motor (víko ventilů, svíčky, sání) musí zůstat pod kapotou: kapota je nad ním ve výšce ~1,07–1,15
  engine.position.set(2.02, 0.6, 0.0);
  van.add(engine);
  explode(engine, { d: [1.1, 0.42, 0.2], t: [0.56, 0.78] });
  within("Oleje a kapaliny", () => {
    part(box(0.42, 0.38, 0.62, 0.04), C.engine, engine);
    const pan = part(box(0.36, 0.13, 0.54, 0.04), C.dark, engine, [0, -0.25, 0]);
    tags["Oleje a kapaliny"] = pan;
  });
  within(null, () => {
    part(box(0.36, 0.13, 0.6, 0.03), C.head, engine, [0, 0.25, 0]);
  });
  {
    const cover = new THREE.Group(); engine.add(cover);
    within(null, () => part(box(0.31, 0.08, 0.56, 0.03), C.black, cover, [0, 0.355, 0]));
    within("Oleje a kapaliny", () => part(cyl(0.035, 0.035, 0.035, 12), C.yellow, cover, [0.06, 0.41, 0.17]));
    explode(cover, { d: [-0.32, 0.3, 0], t: [0.68, 0.82] });
  }
  within("Zapalování a žhavení", () => {
    [-0.21, -0.07, 0.07, 0.21].forEach((z, i) => {
      const g = new THREE.Group(); engine.add(g);
      g.position.set(0, 0.3, z);
      part(cyl(0.016, 0.016, 0.12, 10), C.white, g, [0, 0.03, 0]);
      part(cyl(0.022, 0.022, 0.03, 6), C.steel, g, [0, -0.04, 0]);
      part(cyl(0.012, 0.012, 0.05, 8), C.dark, g, [0, 0.11, 0]);
      explode(g, { d: [0, 0.62, 0], t: [0.74 + i * 0.025, 0.86 + i * 0.025] });
      if (i === 2) tags["Zapalování a žhavení"] = g.children[0];
    });
  });
  within("Filtry", () => {
    const f = new THREE.Group(); engine.add(f);
    f.position.set(0.24, -0.06, -0.12);
    const of = part(cylX(0.055, 0.13, 20), C.yellow, f, [0.06, 0, 0]);
    explode(f, { d: [0.42, 0, 0.05], t: [0.72, 0.86] });
    tags["Filtry"] = of;
    const air = new THREE.Group(); engine.add(air);
    air.position.set(-0.02, 0.36, 0.48);
    part(box(0.34, 0.12, 0.26, 0.04), C.black, air);
    part(cylX(0.05, 0.12, 16), C.dark, air, [0.2, 0, 0]);
    explode(air, { d: [0, 0.5, 0.3], t: [0.7, 0.84] });
  });
  within("Spojka a rozvody", () => {
    const belt = new THREE.Group(); engine.add(belt);
    belt.position.set(0, 0, 0.335);
    part(cylZ(0.085, 0.04, 28), C.steel, belt, [0.02, -0.12, 0]);
    part(cylZ(0.065, 0.04, 28), C.steel, belt, [-0.03, 0.22, 0]);
    const loop = cached("belt", () => {
      const hull = [];
      for (const [cx, cy, r] of [[0.02, -0.12, 0.09], [-0.03, 0.22, 0.07]]) {
        for (let i = 0; i < 32; i++) { const a = (i / 32) * Math.PI * 2; hull.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
      }
      // konvexní obal bodů (Andrew monotone chain)
      hull.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
      const lo = [], hi = [];
      for (const p of hull) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
      for (const p of hull.slice().reverse()) { while (hi.length > 1 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
      const pts = lo.slice(0, -1).concat(hi.slice(0, -1)).map(([x, y]) => new THREE.Vector3(x, y, 0));
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.011, 6, true);
    });
    part(loop, C.black, belt, [0, 0, 0.022]);
    explode(belt, { d: [0, 0, 0.32], t: [0.72, 0.86] });
    const clutch = new THREE.Group(); engine.add(clutch);
    clutch.position.set(-0.02, -0.04, -0.36);
    const cd = part(cylZ(0.15, 0.022, 36), C.head, clutch);
    part(cylZ(0.045, 0.05, 16), C.dark, clutch);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      part(cylZ(0.016, 0.03, 8), C.steel, clutch, [Math.cos(a) * 0.085, Math.sin(a) * 0.085, 0]);
    }
    explode(clutch, { d: [0, 0, -0.42], r: [0, 0, Math.PI], t: [0.72, 0.88] });
    tags["Spojka a rozvody"] = cd;
  });
  within(null, () => {
    const gb = new THREE.Group(); engine.add(gb);
    gb.position.set(-0.03, -0.04, -0.5);
    part(cyl(0.2, 0.14, 0.24, 28), C.engine, gb, [0, 0, -0.02], [Math.PI / 2, 0, 0]);
    part(box(0.3, 0.26, 0.28, 0.05), C.engine, gb, [-0.06, -0.04, -0.24]);
    explode(gb, { d: [0, -0.05, -0.85], t: [0.7, 0.86] });
  });
  within("Oleje a kapaliny", () => {
    const rad = new THREE.Group(); van.add(rad);
    part(box(0.05, 0.42, 1.2, 0.015), C.steel, rad, [2.37, 0.74, 0]);
    explode(rad, { d: [1.85, 0.62, 0], t: [0.54, 0.76] });
  });
  within("Osvětlení a elektro", () => {
    const bat = new THREE.Group(); van.add(bat);
    bat.position.set(1.98, 0.86, -0.66);
    part(box(0.26, 0.19, 0.17, 0.02), C.black, bat);
    part(cyl(0.018, 0.018, 0.035, 8), C.red, bat, [0.08, 0.11, 0.04]);
    part(cyl(0.018, 0.018, 0.035, 8), C.dark, bat, [-0.08, 0.11, 0.04]);
    explode(bat, { d: [0.5, 0.85, -0.45], t: [0.6, 0.8] });
  });

  /* ---------- kamera: izometrický pohled zepředu z boku ---------- */
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const DIR = new THREE.Vector3(1.0, 0.8, 1.45).normalize();
  const UP = new THREE.Vector3(0, 1, 0);
  const RIGHT = new THREE.Vector3().crossVectors(UP, DIR).normalize();
  const CUP = new THREE.Vector3().crossVectors(DIR, RIGHT).normalize();

  // obrys vozu v souřadnicích obrazovky (vpravo/nahoru) pro složený a rozložený stav
  function extents(p) {
    applyProgress(p);
    root.updateMatrixWorld(true);
    const box3 = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    const v = new THREE.Vector3();
    van.traverse((o) => {
      if (!o.isMesh || o.userData.isOutline) return;
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      for (let i = 0; i < 8; i++) {
        v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld);
        const x = v.dot(RIGHT), y = v.dot(CUP);
        box3.x0 = Math.min(box3.x0, x); box3.x1 = Math.max(box3.x1, x);
        box3.y0 = Math.min(box3.y0, y); box3.y1 = Math.max(box3.y1, y);
      }
    });
    return box3;
  }
  const EX0 = extents(0), EX1 = extents(1);
  applyProgress(0);

  /* ---------- popisky kategorií ---------- */
  const CATS = ["Brzdy", "Podvozek a tlumiče", "Filtry", "Oleje a kapaliny", "Zapalování a žhavení", "Spojka a rozvody", "Osvětlení a elektro", "Stěrače", "Výbava a autodoplňky"];
  const SHORT = { "Podvozek a tlumiče": "Podvozek, tlumiče", "Zapalování a žhavení": "Zapalování", "Spojka a rozvody": "Spojka, rozvody", "Osvětlení a elektro": "Světla, elektro", "Výbava a autodoplňky": "Výbava" };
  const tagEls = CATS.map((cat, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "tag";
    b.dataset.pick = cat;
    b.tabIndex = -1;
    b.innerHTML = `<span class="tag__n">${i + 1}</span><span class="tag__t">${SHORT[cat] || cat}</span>`;
    b.setAttribute("aria-label", `Poptat díl: ${cat}`);
    b.addEventListener("pointerenter", () => highlight(cat));
    b.addEventListener("pointerleave", () => highlight(null));
    b.addEventListener("focus", () => highlight(cat));
    b.addEventListener("blur", () => highlight(null));
    tagBox.appendChild(b);
    const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
    leads.appendChild(line);
    return { cat, el: b, line, w: 0 };
  });
  if (legend) {
    legend.innerHTML = CATS.map((cat, i) => `<li><button type="button" data-pick="${cat}"><span class="tag__n">${i + 1}</span>${SHORT[cat] || cat}</button></li>`).join("");
    legend.querySelectorAll("button").forEach((b) => {
      b.addEventListener("pointerenter", () => highlight(b.dataset.pick));
      b.addEventListener("pointerleave", () => highlight(null));
    });
  }

  let hiCat = null;
  function highlight(cat) {
    if (cat === hiCat) return;
    hiCat = cat;
    for (const [c, list] of catMats) for (const m of list) m.uniforms.uHi.value = c === cat ? 1 : 0;
    tagEls.forEach((t) => t.el.classList.toggle("is-hi", t.cat === cat));
    invalidate();
  }

  // kdy je díl dané kategorie „venku“ (podle jeho časování)
  const tagT = {};
  for (const cat of CATS) {
    let o = tags[cat], t = 0;
    while (o) { const m = moves.find((mv) => mv.obj === o); if (m) t = Math.max(t, m.t1); o = o.parent; }
    tagT[cat] = t;
  }

  /* ---------- rozvržení podle šířky ---------- */
  let W = 1, H = 1, compact = false, dpr = 1, basePx = 1.4;
  function resize() {
    const r = view.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
    compact = W < 760;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    outlineMat.uniforms.uRes.value.set(W * dpr, H * dpr);
    basePx = (compact ? 1.15 : 1.4) * dpr;
    outlineMat.uniforms.uPx.value = basePx;
    leads.setAttribute("viewBox", `0 0 ${W} ${H}`);
    tagEls.forEach((t) => (t.w = t.el.offsetWidth));
    invalidate();
  }

  // kam na obrazovce a jak velký má vůz být (zlomky šířky/výšky)
  function frameFor(ex, area) {
    const bw = ex.x1 - ex.x0, bh = ex.y1 - ex.y0;
    const V = Math.max(bh * H / area.h, bw * H / area.w);
    return { V, cx: (ex.x0 + ex.x1) / 2, cy: (ex.y0 + ex.y1) / 2, sx: area.sx, sy: area.sy };
  }
  function frames() {
    const copyR = copy.getBoundingClientRect(), pinR = view.getBoundingClientRect();
    if (staticMode) {
      return [null, frameFor(EX1, compact
        ? { w: W * 0.94, h: H * 0.78, sx: 0.5, sy: 0.44 }
        : { w: W - 400, h: H * 0.86, sx: 0.5, sy: 0.5 })];
    }
    if (compact) {
      const top = copyR.bottom - pinR.top + 12;
      const legendH = legend ? legend.offsetHeight + 24 : 0;
      return [
        frameFor(EX0, { w: W * 0.9, h: Math.max(140, H - top - 30), sx: 0.5, sy: (top + (H - 10)) / 2 / H }),
        frameFor(EX1, { w: W * 0.94, h: H - legendH - 30, sx: 0.5, sy: (H - legendH) / 2 / H }),
      ];
    }
    const left = Math.min(copyR.right - pinR.left + 30, W * 0.5);
    return [
      frameFor(EX0, { w: W - left - 40, h: H * 0.72, sx: (left + W - 30) / 2 / W, sy: 0.52 }),
      frameFor(EX1, { w: W - 420, h: H * 0.84, sx: 0.5, sy: 0.53 }),
    ];
  }

  function setCamera(f) {
    const aspect = W / H;
    cam.left = -f.V * aspect / 2; cam.right = f.V * aspect / 2;
    cam.top = f.V / 2; cam.bottom = -f.V / 2;
    cam.updateProjectionMatrix();
    // bod (cx, cy) ve směrech RIGHT/CUP má být na obrazovce v (sx, sy)
    const t = new THREE.Vector3()
      .addScaledVector(RIGHT, f.cx - (f.sx - 0.5) * f.V * aspect)
      .addScaledVector(CUP, f.cy - (0.5 - f.sy) * f.V);
    cam.position.copy(t).addScaledVector(DIR, 40);
    cam.up.copy(CUP);
    cam.lookAt(t);
  }

  /* ---------- popisky: sloupce s odkazovými čarami (desktop), čísla + legenda (mobil) ---------- */
  const proj = new THREE.Vector3();
  function placeTags(p) {
    const items = [];
    for (const t of tagEls) {
      const vis = !staticMode && introP > 0.02 ? false : p >= tagT[t.cat] - 0.02;
      t.el.classList.toggle("is-on", vis);
      t.el.tabIndex = vis ? 0 : -1;
      t.line.style.opacity = vis && !compact ? 1 : 0;
      if (!vis) continue;
      const o = tags[t.cat];
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      o.geometry.boundingBox.getCenter(proj).applyMatrix4(o.matrixWorld).project(cam);
      items.push({ t, ax: (proj.x + 1) / 2 * W, ay: (1 - proj.y) / 2 * H });
    }
    if (compact) {
      for (const it of items) {
        it.t.el.style.transform = `translate(${Math.round(it.ax - 11)}px, ${Math.round(it.ay - 12)}px)`;
      }
      return;
    }
    const mid = W / 2, gap = 40, margin = 28;
    for (const sideLeft of [true, false]) {
      const col = items.filter((it) => (it.ax < mid) === sideLeft).sort((a, b) => a.ay - b.ay);
      let y = 70;
      for (const it of col) { it.y = Math.max(it.ay, y); y = it.y + gap; }
      let limit = H - 60;
      for (let i = col.length - 1; i >= 0; i--) { if (col[i].y > limit) col[i].y = limit; limit = col[i].y - gap; }
      for (const it of col) {
        const w = it.t.w || it.t.el.offsetWidth;
        const x = sideLeft ? margin : W - margin - w;
        it.t.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(it.y - 17)}px)`;
        const ex = sideLeft ? x + w : x;
        const kx = sideLeft ? ex + 18 : ex - 18;
        it.t.line.setAttribute("d", `M${ex.toFixed(1)} ${it.y.toFixed(1)}H${kx.toFixed(1)}L${it.ax.toFixed(1)} ${it.ay.toFixed(1)}`);
      }
    }
  }

  /* ---------- průběh: úvodní skládání + rolování ---------- */
  const staticMode = reduce;
  let introP = staticMode ? 0 : 0.9, introStart = 0;
  let scrollP = staticMode ? 1 : 0, yaw = 0, yawTarget = 0;
  let need = true;
  function invalidate() { need = true; }

  function readScroll() {
    if (staticMode) return;
    const r = stage.getBoundingClientRect();
    const total = r.height - pin.offsetHeight;
    scrollP = total > 0 ? clamp01(-r.top / total) : 0;
    invalidate();
  }

  let F = null;
  function render(now) {
    if (introP > 0) {
      if (!introStart) introStart = now;
      const k = clamp01((now - introStart) / 2600);
      introP = 0.9 * (1 - (1 - Math.pow(1 - k, 3)));
      if (k >= 1) introP = 0;
      need = true;
    }
    if (Math.abs(yaw - yawTarget) > 1e-4) { yaw += (yawTarget - yaw) * 0.08; need = true; }
    if (!need) return;
    need = false;
    const ep = staticMode ? 1 : clamp01(scrollP / 0.9);
    const pp = Math.max(ep, introP);
    applyProgress(pp);
    seamMat.uniforms.uPx.value = basePx * (0.4 + 0.6 * clamp01((pp - 0.12) / 0.12));
    root.rotation.y = yaw;
    if (!F) F = frames();
    const k = staticMode ? 1 : ease(clamp01(ep / 0.55));
    const f0 = F[0] || F[1], f1 = F[1];
    setCamera({ V: f0.V + (f1.V - f0.V) * k, cx: f0.cx + (f1.cx - f0.cx) * k, cy: f0.cy + (f1.cy - f0.cy) * k, sx: f0.sx + (f1.sx - f0.sx) * k, sy: f0.sy + (f1.sy - f0.sy) * k });
    renderer.render(scene, cam);
    placeTags(staticMode ? 1 : ep);

    if (!staticMode) {
      const c = clamp01(scrollP / 0.1);
      copy.style.opacity = String(1 - c);
      copy.style.transform = `translateY(${(-36 * c).toFixed(1)}px)`;
      copy.style.visibility = c >= 1 ? "hidden" : "";
      if (hint) hint.classList.toggle("is-off", scrollP > 0.02 || introP > 0.05);
      if (endNote) endNote.classList.toggle("is-on", ep > 0.96);
      if (legend) legend.classList.toggle("is-on", ep > 0.9);
    }
  }
  function loop(now) { requestAnimationFrame(loop); if (visible) render(now); }

  let visible = true;
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) invalidate(); }).observe(stage);
  }

  /* ---------- najetí myší na díl ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  if (matchMedia("(hover: hover)").matches) {
    canvas.addEventListener("pointermove", (e) => {
      const r = canvas.getBoundingClientRect();
      yawTarget = staticMode ? 0 : ((e.clientX - r.left) / r.width - 0.5) * 0.14;
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(pickables, false)[0];
      const cat = hit && (staticMode || Math.max(clamp01(scrollP / 0.9), introP) >= tagT[hit.object.userData.cat] - 0.02) ? hit.object.userData.cat : null;
      highlight(cat);
      canvas.style.cursor = cat ? "pointer" : "";
      invalidate();
    });
    canvas.addEventListener("pointerleave", () => { yawTarget = 0; highlight(null); canvas.style.cursor = ""; });
    canvas.addEventListener("click", () => {
      if (!hiCat) return;
      tagEls.find((t) => t.cat === hiCat)?.el.click();
    });
  }

  stage.classList.add("is-live");
  if (staticMode) stage.classList.add("is-static");
  addEventListener("scroll", readScroll, { passive: true });
  const ro = new ResizeObserver(() => { resize(); F = null; readScroll(); });
  ro.observe(view);
  resize();
  readScroll();
  requestAnimationFrame(loop);
}
