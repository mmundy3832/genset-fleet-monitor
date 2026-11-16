// Yard equipment props for the 3D twin: switchgear e-house, step-up transformer, gas skid,
// cable tray and pipe runs, chain-link fence, light pole, bollard, DEF tote, control trailer, pads.
// Also exports the small modelling kit (textures, materials, geometry helpers, bake) used by bess.js.
// Everything is procedural. Units are meters, Y up, origin at footprint center on the ground.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
const _geo = new Map(), _tex = new Map(), _mat = new Map(), _props = new Map();
function memo(map, key, make) { let v = map.get(key); if (v === undefined) { v = make(); map.set(key, v); } return v; }
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const f3 = (n) => n.toFixed(3);

// ---------------------------------------------------------------- noise + textures
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Tileable value noise, fBm. px/py are the base lattice periods in x and y.
function noise(size, px, py, octaves, seed) {
  const out = new Float32Array(size * size), r = rng(seed);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const nx = Math.max(1, px << o), ny = Math.max(1, py << o);
    const g = new Float32Array(nx * ny);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * ny, iy = fy | 0, ty = fy - iy, wy = ty * ty * (3 - 2 * ty), iy1 = (iy + 1) % ny;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * nx, ix = fx | 0, tx = fx - ix, wx = tx * tx * (3 - 2 * tx), ix1 = (ix + 1) % nx;
        const a = g[iy * nx + ix], b = g[iy * nx + ix1], c = g[iy1 * nx + ix], d = g[iy1 * nx + ix1];
        out[y * size + x] += amp * (a + (b - a) * wx + (c - a) * wy + (a - b - c + d) * wx * wy);
      }
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}
function fieldTex(size, fn, srgb) {
  const d = new Uint8Array(size * size * 4);
  const px = [0, 0, 0];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x; fn(i, x, y, px);
    d[i * 4] = 255 * clamp01(px[0]); d[i * 4 + 1] = 255 * clamp01(px[1]); d[i * 4 + 2] = 255 * clamp01(px[2]); d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}
export function canvasTex(key, w, h, draw, repeat) {
  return memo(_tex, 'c:' + key, () => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}
const TEX = {
  // white multiplier map for painted panels: blotches, rain streaks from the top edge, splash dirt at the bottom
  grime() {
    const S = 256, a = noise(S, 3, 3, 4, 11), st = noise(S, 40, 1, 2, 12), f = noise(S, 48, 48, 2, 13);
    return fieldTex(S, (i, x, y, p) => {
      const v = y / (S - 1);
      let k = 1 - 0.11 * a[i] - 0.03 * f[i];
      k -= Math.max(0, st[i] - 0.58) * 2.4 * 0.17 * (0.25 + 0.75 * v);
      k -= Math.max(0, (v - 0.965) / 0.035) * 0.05;
      const dirt = Math.max(0, 1 - v / 0.13), dd = dirt * dirt * (0.12 + 0.18 * a[i]);
      p[0] = k - dd * 0.85; p[1] = k - dd; p[2] = k - dd * 1.3;
    }, true);
  },
  rough() {
    const S = 256, a = noise(S, 4, 4, 5, 14), f = noise(S, 64, 64, 2, 15);
    return fieldTex(S, (i, x, y, p) => { const k = 0.72 + 0.2 * a[i] + 0.08 * f[i]; p[0] = p[1] = p[2] = k; });
  },
  concrete() {
    const S = 512, a = noise(S, 4, 4, 5, 21), f = noise(S, 128, 128, 2, 22), b = noise(S, 2, 2, 3, 23);
    return fieldTex(S, (i, x, y, p) => {
      const k = 0.6 + 0.2 * (a[i] - 0.5) + 0.1 * (f[i] - 0.5) - 0.1 * Math.max(0, b[i] - 0.58) * 2.4;
      p[0] = k; p[1] = k * 0.98; p[2] = k * 0.94;
    }, true);
  },
  concreteBump() {
    const S = 512, a = noise(S, 8, 8, 4, 24), f = noise(S, 128, 128, 2, 22);
    return fieldTex(S, (i, x, y, p) => { p[0] = p[1] = p[2] = 0.5 * a[i] + 0.5 * f[i]; });
  },
  gravel() {
    const S = 512, f = noise(S, 90, 90, 3, 31), a = noise(S, 3, 3, 4, 32);
    return fieldTex(S, (i, x, y, p) => {
      const s = clamp01((f[i] - 0.3) * 2.4), m = 0.82 + 0.3 * a[i];
      p[0] = (0.5 + 0.34 * s) * m; p[1] = (0.46 + 0.33 * s) * m; p[2] = (0.39 + 0.31 * s) * m;
    }, true);
  },
  gravelBump() { const S = 512, f = noise(S, 90, 90, 3, 31); return fieldTex(S, (i, x, y, p) => { p[0] = p[1] = p[2] = f[i]; }); },
  stone() {
    const S = 256, f = noise(S, 40, 40, 3, 33);
    return fieldTex(S, (i, x, y, p) => { const s = clamp01((f[i] - 0.25) * 2.2); p[0] = 0.47 + 0.2 * s; p[1] = 0.46 + 0.2 * s; p[2] = 0.44 + 0.19 * s; }, true);
  },
  galv() {
    const S = 256, a = noise(S, 22, 22, 2, 41), b = noise(S, 3, 3, 3, 42);
    return fieldTex(S, (i, x, y, p) => { const k = 0.78 + 0.2 * a[i] - 0.1 * b[i]; p[0] = k * 0.97; p[1] = k * 0.99; p[2] = k; }, true);
  },
  chainlink() {
    return canvasTex('chainlink', 256, 256, (c, w) => {
      c.clearRect(0, 0, w, w); c.lineWidth = 7; c.lineCap = 'round';
      const n = 4, s = w / n;
      for (const col of ['rgba(60,64,68,1)', 'rgba(176,182,186,1)']) {
        c.strokeStyle = col; c.lineWidth = col[5] === '6' ? 8 : 5;
        for (let i = -n; i < 2 * n; i++) {
          c.beginPath(); c.moveTo(i * s, 0); c.lineTo(i * s + w, w); c.stroke();
          c.beginPath(); c.moveTo(i * s + w, 0); c.lineTo(i * s, w); c.stroke();
        }
      }
    }, true);
  },
  barbed() {
    return canvasTex('barbed', 256, 128, (c, w, h) => {
      c.clearRect(0, 0, w, h); c.strokeStyle = 'rgba(150,156,160,1)';
      for (const y of [18, 64, 110]) {
        c.lineWidth = 4; c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke();
        c.lineWidth = 3;
        for (let x = 16; x < w; x += 64) { c.beginPath(); c.moveTo(x - 8, y - 9); c.lineTo(x + 8, y + 9); c.moveTo(x + 8, y - 9); c.lineTo(x - 8, y + 9); c.stroke(); }
      }
    }, true);
  },
  grating() {
    return canvasTex('grating', 64, 64, (c, w) => {
      c.fillStyle = '#17191b'; c.fillRect(0, 0, w, w);
      c.fillStyle = '#a7adb1'; for (let y = 0; y < w; y += 8) c.fillRect(0, y, w, 3);
      c.fillStyle = '#8b9195'; c.fillRect(0, 0, 3, w); c.fillRect(32, 0, 3, w);
    }, true);
  },
  grille() {
    return canvasTex('grille', 256, 256, (c, w) => {
      c.clearRect(0, 0, w, w); c.strokeStyle = 'rgba(46,49,52,1)'; const m = w / 2;
      c.lineWidth = 3; for (let r = 10; r < m - 2; r += 11) { c.beginPath(); c.arc(m, m, r, 0, 6.2832); c.stroke(); }
      c.lineWidth = 6; for (let i = 0; i < 4; i++) { const a = i * Math.PI / 4 + 0.39; c.beginPath(); c.moveTo(m - Math.cos(a) * m, m - Math.sin(a) * m); c.lineTo(m + Math.cos(a) * m, m + Math.sin(a) * m); c.stroke(); }
      c.lineWidth = 7; c.beginPath(); c.arc(m, m, m - 4, 0, 6.2832); c.stroke();
    });
  },
  coil() {
    return canvasTex('coil', 64, 64, (c, w) => {
      c.fillStyle = '#2a2d2f'; c.fillRect(0, 0, w, w); c.fillStyle = '#9aa0a3';
      for (let x = 0; x < w; x += 4) c.fillRect(x, 0, 2, w);
      c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(0, 30, w, 3);
    }, true);
  },
  gauge() {
    return canvasTex('gauge', 128, 128, (c, w) => {
      const m = w / 2; c.fillStyle = '#1c1e20'; c.fillRect(0, 0, w, w);
      c.fillStyle = '#f2f2ee'; c.beginPath(); c.arc(m, m, m - 8, 0, 6.2832); c.fill();
      c.strokeStyle = '#111'; c.lineWidth = 3;
      for (let i = 0; i <= 10; i++) { const a = 2.36 + i * 0.471; c.beginPath(); c.moveTo(m + Math.cos(a) * (m - 14), m + Math.sin(a) * (m - 14)); c.lineTo(m + Math.cos(a) * (m - 26), m + Math.sin(a) * (m - 26)); c.stroke(); }
      c.lineWidth = 4; c.beginPath(); c.moveTo(m, m); c.lineTo(m + 30, m - 22); c.stroke();
      c.fillStyle = '#111'; c.beginPath(); c.arc(m, m, 6, 0, 6.2832); c.fill();
    });
  },
  stain() {
    return canvasTex('stain', 256, 256, (c, w) => {
      c.clearRect(0, 0, w, w); const r = rng(77);
      for (let i = 0; i < 60; i++) {
        const x = 60 + r() * 136, y = 60 + r() * 136, rad = 8 + r() * 46;
        const g = c.createRadialGradient(x, y, 0, x, y, rad);
        g.addColorStop(0, 'rgba(30,27,24,' + (0.02 + r() * 0.05).toFixed(2) + ')'); g.addColorStop(1, 'rgba(22,20,18,0)');
        c.fillStyle = g; c.fillRect(0, 0, w, w);
      }
    });
  },
  tracks() {
    return canvasTex('tracks', 64, 256, (c, w, h) => {
      c.clearRect(0, 0, w, h);
      for (const x of [8, 40]) { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, 'rgba(25,24,22,0)'); g.addColorStop(0.3, 'rgba(25,24,22,0.1)'); g.addColorStop(0.8, 'rgba(25,24,22,0.07)'); g.addColorStop(1, 'rgba(25,24,22,0)'); c.fillStyle = g; c.fillRect(x, 0, 16, h); }
    });
  },
};
export function T(name) { return memo(_tex, name, () => TEX[name]()); }

// ---------------------------------------------------------------- materials
function paint(hex, rough = 0.5, metal = 0, extra) {
  return new THREE.MeshStandardMaterial(Object.assign({ color: hex, map: T('grime'), roughness: rough, roughnessMap: T('rough'), metalness: metal }, extra));
}
function tiled(o, tile) { const m = new THREE.MeshStandardMaterial(o); m.userData.worldUV = tile; return m; }
const MAT = {
  white: () => paint(0xe4e6e3, 0.48),
  whiteDS: () => paint(0xe4e6e3, 0.48, 0, { side: THREE.DoubleSide }),
  grey61: () => paint(0x8e9894, 0.5),
  grey61DS: () => paint(0x8e9894, 0.5, 0, { side: THREE.DoubleSide }),
  grey70: () => paint(0xa9aeab, 0.5),
  grey70DS: () => paint(0xa9aeab, 0.5, 0, { side: THREE.DoubleSide }),
  beige: () => paint(0xd6d0bd, 0.55),
  beigeDS: () => paint(0xd6d0bd, 0.55, 0, { side: THREE.DoubleSide }),
  dark: () => paint(0x2c3034, 0.6, 0.2),
  rack: () => paint(0x565c62, 0.5, 0.3),
  module: () => paint(0x3b4148, 0.42, 0.45),
  black: () => new THREE.MeshStandardMaterial({ color: 0x0c0d0e, roughness: 0.9 }),
  rubber: () => new THREE.MeshStandardMaterial({ color: 0x131414, roughness: 0.92 }),
  tire: () => new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.95, bumpMap: T('rough'), bumpScale: 0.6 }),
  yellow: () => paint(0xe2ac12, 0.5),
  blue: () => paint(0x2c62ad, 0.45),
  red: () => paint(0xa5382c, 0.45),
  orange: () => new THREE.MeshStandardMaterial({ color: 0xd9600c, roughness: 0.55 }),
  green: () => new THREE.MeshStandardMaterial({ color: 0x2e8b4a, roughness: 0.6 }),
  cable: () => new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.7 }),
  pvc: () => new THREE.MeshStandardMaterial({ color: 0x8b8f92, roughness: 0.6 }),
  galv: () => new THREE.MeshStandardMaterial({ color: 0xc4c9cd, map: T('galv'), roughness: 0.5, roughnessMap: T('rough'), metalness: 0.85 }),
  galvT: () => tiled({ color: 0xc4c9cd, map: T('galv'), roughness: 0.5, metalness: 0.85 }, 0.6),
  steel: () => new THREE.MeshStandardMaterial({ color: 0xd0d4d8, roughness: 0.28, metalness: 1 }),
  alu: () => new THREE.MeshStandardMaterial({ color: 0xd4d7da, roughness: 0.4, roughnessMap: T('rough'), metalness: 0.9 }),
  copper: () => new THREE.MeshStandardMaterial({ color: 0xc87a44, roughness: 0.36, metalness: 1 }),
  brass: () => new THREE.MeshStandardMaterial({ color: 0xc9a352, roughness: 0.35, metalness: 1 }),
  porcelain: () => new THREE.MeshStandardMaterial({ color: 0x6a4434, roughness: 0.18 }),
  polymer: () => new THREE.MeshStandardMaterial({ color: 0x8c9296, roughness: 0.5 }),
  glass: () => new THREE.MeshStandardMaterial({ color: 0x4a5a66, roughness: 0.05, metalness: 0.85 }),
  amberGlass: () => new THREE.MeshStandardMaterial({ color: 0xc8742a, roughness: 0.15, metalness: 0.2 }),
  hdpe: () => new THREE.MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.38 }),
  lens: () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 3, roughness: 0.3 }),
  wallpack: () => new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.2, roughness: 0.3 }),
  concrete: () => tiled({ color: 0xffffff, map: T('concrete'), bumpMap: T('concreteBump'), bumpScale: 1.2, roughness: 0.92 }, 4),
  joint: () => new THREE.MeshStandardMaterial({ color: 0x1d1c1a, roughness: 1 }),
  gravel: () => tiled({ color: 0xffffff, map: T('gravel'), bumpMap: T('gravelBump'), bumpScale: 2.5, roughness: 1 }, 3),
  stone: () => tiled({ color: 0xffffff, map: T('stone'), bumpMap: T('gravelBump'), bumpScale: 3, roughness: 1 }, 1.6),
  grating: () => tiled({ color: 0xffffff, map: T('grating'), roughness: 0.5, metalness: 0.6 }, 0.24),
  chainlink: () => new THREE.MeshStandardMaterial({ map: T('chainlink'), transparent: true, alphaTest: 0.04, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 }),
  barbed: () => new THREE.MeshStandardMaterial({ map: T('barbed'), transparent: true, alphaTest: 0.04, depthWrite: false, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 }),
  grille: () => new THREE.MeshStandardMaterial({ map: T('grille'), transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.5 }),
  coil: () => tiled({ color: 0xffffff, map: T('coil'), roughness: 0.5, metalness: 0.6 }, 0.12),
  gauge: () => new THREE.MeshStandardMaterial({ map: T('gauge'), roughness: 0.2 }),
  stain: () => new THREE.MeshStandardMaterial({ map: T('stain'), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
  tracks: () => new THREE.MeshStandardMaterial({ map: T('tracks'), transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
};
export function M(name) { return memo(_mat, name, () => MAT[name]()); }
function asMat(m) { return typeof m === 'string' ? M(m) : m; }
function paintColor(hex) { return memo(_mat, 'p' + hex, () => paint(hex, 0.5)); }

// label/sign materials drawn on canvas
export function labelMat(key, w, h, draw, alpha) {
  return memo(_mat, 'L:' + key, () => new THREE.MeshStandardMaterial({
    map: canvasTex('L' + key, w, h, draw), roughness: 0.55, transparent: !!alpha, alphaTest: alpha ? 0.4 : 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
}
const FONT = '"Arial Narrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif';
export function signMat(key, header, hdrColor, lines) {
  return labelMat('sign:' + key, 512, 384, (c, w, h) => {
    c.fillStyle = '#f3f2ec'; c.fillRect(0, 0, w, h);
    c.strokeStyle = '#151515'; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = hdrColor; c.fillRect(22, 22, w - 44, 112);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 92px ' + FONT; c.fillText(header, w / 2, 82);
    c.fillStyle = '#151515';
    const lh = (h - 160) / lines.length;
    lines.forEach((s, i) => { let fs = Math.min(lh * 0.8, 76); c.font = 'bold ' + fs + 'px ' + FONT; const tw = c.measureText(s).width; if (tw > w - 60) { fs *= (w - 60) / tw; c.font = 'bold ' + fs + 'px ' + FONT; } c.fillText(s, w / 2, 150 + lh * (i + 0.5)); });
    c.fillStyle = 'rgba(90,70,40,0.07)'; c.fillRect(0, h * 0.75, w, h * 0.25);
  });
}
export const SIGN = {
  hv138: () => signMat('hv138', 'DANGER', '#b3261e', ['HIGH VOLTAGE', '13.8 kV']),
  hv: () => signMat('hv', 'DANGER', '#b3261e', ['HIGH VOLTAGE', 'KEEP OUT']),
  gas: () => signMat('gas', 'DANGER', '#b3261e', ['NATURAL GAS', 'HIGH PRESSURE', 'NO SMOKING']),
  auth: () => signMat('auth', 'NOTICE', '#1f4f9e', ['AUTHORIZED', 'PERSONNEL ONLY']),
  def: () => signMat('def', 'DEF', '#1f4f9e', ['UREA SOLUTION 32.5%', 'ISO 22241']),
  ctl: () => signMat('ctl', 'NOTICE', '#1f4f9e', ['SITE CONTROL', 'CHECK IN HERE']),
  plate: () => labelMat('nameplate', 256, 192, (c, w, h) => {
    c.fillStyle = '#b9bcbd'; c.fillRect(0, 0, w, h); c.strokeStyle = '#333'; c.lineWidth = 3; c.strokeRect(6, 6, w - 12, h - 12);
    c.fillStyle = '#222'; c.font = 'bold 20px ' + FONT; c.fillText('TRANSFORMER  SIM-DATA', 16, 32);
    for (let i = 0; i < 9; i++) { c.fillRect(16, 46 + i * 15, 70 + ((i * 37) % 50), 5); c.fillRect(140, 46 + i * 15, 50 + ((i * 53) % 50), 5); }
  }),
};

// ---------------------------------------------------------------- geometry helpers
// Beveled box. r = 0 gives a plain 12 triangle box for hidden or tiny parts.
export function B(w, h, d, r, seg = 1) {
  const rr = r === undefined ? 0.008 : r, lim = Math.min(w, h, d) * 0.45;
  const rad = Math.min(rr, lim);
  return memo(_geo, `b${f3(w)}_${f3(h)}_${f3(d)}_${f3(rad)}_${seg}`, () => (rad < 0.0015 ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, seg, rad)));
}
export function C(r, h, seg = 12, rTop, open = false) {
  const rt = rTop === undefined ? r : rTop;
  return memo(_geo, `c${f3(r)}_${f3(rt)}_${f3(h)}_${seg}_${open}`, () => new THREE.CylinderGeometry(rt, r, h, seg, 1, open));
}
export function sphereGeo(r, ws = 12, hs = 8, thetaLen = Math.PI) {
  return memo(_geo, `s${f3(r)}_${ws}_${hs}_${f3(thetaLen)}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen));
}
export function planeGeo(w, h) { return memo(_geo, `p${f3(w)}_${f3(h)}`, () => new THREE.PlaneGeometry(w, h)); }
export function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, asMat(m)); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o;
}
export function add(p, g, m, x, y, z, rx, ry, rz) {
  const o = mesh(g, m, x, y, z); if (rx || ry || rz) o.rotation.set(rx || 0, ry || 0, rz || 0); p.add(o); return o;
}
export function decal(p, m, w, h, x, y, z, ry = 0, rx = 0) {
  const o = mesh(planeGeo(w, h), m, x, y, z); o.rotation.set(rx, ry, 0, 'YXZ'); o.castShadow = false; p.add(o); return o;
}
export function tube(p, a, b, r, m, seg = 8) {
  const d = new V3().subVectors(b, a), L = d.length();
  const o = mesh(C(r, 1, seg, r, true), m); o.scale.set(1, L, 1);
  o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(UP, d.normalize()); p.add(o); return o;
}
export function boxBetween(p, a, b, w, d, m) {
  const dir = new V3().subVectors(b, a), L = dir.length();
  const o = mesh(B(1, 1, 1, 0), m); o.scale.set(w, L, d);
  o.position.copy(a).addScaledVector(dir, 0.5); o.quaternion.setFromUnitVectors(UP, dir.normalize()); p.add(o); return o;
}
const v = (x, y, z) => new V3(x, y, z);
// Pipe through a polyline with swept elbows at the corners.
export function pipePath(p, pts, r, m, bend, seg = 10) {
  bend = bend === undefined ? r * 2.2 : bend;
  let start = pts[0].clone();
  for (let i = 1; i < pts.length; i++) {
    const P = pts[i];
    if (i === pts.length - 1) { tube(p, start, P, r, m, seg); break; }
    const d1 = new V3().subVectors(P, pts[i - 1]).normalize(), d2 = new V3().subVectors(pts[i + 1], P).normalize();
    const th = Math.acos(THREE.MathUtils.clamp(d1.dot(d2), -1, 1));
    if (th < 0.03) continue;
    const t = bend * Math.tan(th / 2), A = P.clone().addScaledVector(d1, -t);
    tube(p, start, A, r, m, seg);
    const n = new V3().crossVectors(d1, d2).normalize(), mm = new V3().crossVectors(n, d1);
    const e = mesh(memo(_geo, `t${f3(bend)}_${f3(r)}_${f3(th)}_${seg}`, () => new THREE.TorusGeometry(bend, r, seg, Math.max(3, Math.ceil(th / 0.35)), th)), m);
    e.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(mm.clone().negate(), d1, n));
    e.position.copy(A).addScaledVector(mm, bend); p.add(e);
    start = P.clone().addScaledVector(d2, t);
  }
}
// Corrugated or ribbed sheet in the XY plane, facing +Z, y from 0 to h, centered in x.
export function corrugGeo(len, h, pitch, depth, shape = 'trap') {
  return memo(_geo, `cg${f3(len)}_${f3(h)}_${f3(pitch)}_${f3(depth)}_${shape}`, () => {
    const n = Math.max(1, Math.round(len / pitch)), p = len / n, prof = [];
    for (let i = 0; i < n; i++) {
      const x0 = -len / 2 + i * p;
      if (shape === 'trap') prof.push([x0, 0], [x0 + p * 0.26, 0], [x0 + p * 0.5, depth], [x0 + p * 0.76, depth]);
      else prof.push([x0, 0], [x0 + p * 0.78, 0], [x0 + p * 0.84, depth], [x0 + p * 0.94, depth]);
    }
    prof.push([len / 2, 0]);
    const pos = [], nor = [], uv = [], idx = [];
    for (let i = 0; i < prof.length - 1; i++) {
      const a = prof[i], b = prof[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), nx = -dz / l, nz = dx / l, k = pos.length / 3;
      pos.push(a[0], 0, a[1], b[0], 0, b[1], b[0], h, b[1], a[0], h, a[1]);
      for (let j = 0; j < 4; j++) nor.push(nx, 0, nz);
      const u0 = a[0] / len + 0.5, u1 = b[0] / len + 0.5; uv.push(u0, 0, u1, 0, u1, 1, u0, 1);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g;
  });
}
function quadGeo(a, b, c, d, u, vv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, u, 0, u, vv, 0, vv], 2)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals(); return g;
}
function worldUV(g, s) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
    else if (ax >= az) uv.setXY(i, p.getZ(i) / s, p.getY(i) / s);
    else uv.setXY(i, p.getX(i) / s, p.getY(i) / s);
  }
}
// Merge every static mesh under root into one geometry per material. Returns [{ geometry, material, cast }].
export function bake(root) {
  root.updateMatrixWorld(true);
  const groups = new Map();
  const push = (geo, matrix, mat, cast) => {
    const g = geo.clone();
    if (!g.index) g.setIndex(Array.from({ length: g.attributes.position.count }, (_, i) => i));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(matrix);
    if (mat.userData.worldUV) worldUV(g, mat.userData.worldUV);
    const key = mat.uuid + (cast ? 'c' : 'n');
    let e = groups.get(key); if (!e) groups.set(key, e = { material: mat, cast, list: [] });
    e.list.push(g);
  };
  const im = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isInstancedMesh) for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, im); push(o.geometry, im.clone().premultiply(o.matrixWorld), o.material, o.castShadow); }
    else push(o.geometry, o.matrixWorld, o.material, o.castShadow);
  });
  return [...groups.values()].map((e) => {
    const geometry = mergeGeometries(e.list, false); e.list.forEach((g) => g.dispose());
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    return { geometry, material: e.material, cast: e.cast };
  });
}
// Build meshes from baked parts. matMap (optional Map) swaps shared materials for per-instance clones.
export function instantiate(parts, matMap) {
  const g = new THREE.Group();
  for (const p of parts) {
    let m = p.material;
    if (matMap) { let c = matMap.get(m); if (!c) { c = m.clone(); c.userData = Object.assign({}, m.userData); matMap.set(m, c); } m = c; }
    const o = new THREE.Mesh(p.geometry, m); o.castShadow = p.cast; o.receiveShadow = true; g.add(o);
  }
  return g;
}
function prop(key, build) {
  const p = memo(_props, key, () => {
    const g = build(), parts = bake(g), box = new THREE.Box3();
    parts.forEach((q) => box.union(q.geometry.boundingBox));
    return { parts, size: box.getSize(new V3()), extra: g.userData.extra };
  });
  const out = instantiate(p.parts);
  out.userData = Object.assign({ kind: 'prop', size: { x: p.size.x, y: p.size.y, z: p.size.z }, update() {}, dispose() {} }, p.extra ? p.extra() : null);
  return out;
}
function toV3(p) {
  if (Array.isArray(p)) return p.length === 2 ? v(p[0], 0, p[1]) : v(p[0], p[1] || 0, p[2]);
  return v(p.x, p.y || 0, p.z);
}

// ---------------------------------------------------------------- shared parts
export function louver(p, w, h, m, x, y, z, ry = 0) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry;
  add(g, B(w - 0.01, h - 0.01, 0.01, 0), 'black', 0, 0, -0.012);
  const fw = 0.03;
  add(g, B(w, fw, 0.035, 0.004), m, 0, h / 2 - fw / 2, 0.004); add(g, B(w, fw, 0.035, 0.004), m, 0, -h / 2 + fw / 2, 0.004);
  add(g, B(fw, h, 0.035, 0.004), m, w / 2 - fw / 2, 0, 0.004); add(g, B(fw, h, 0.035, 0.004), m, -w / 2 + fw / 2, 0, 0.004);
  const n = Math.max(1, Math.floor((h - 2 * fw) / 0.05)), pitch = (h - 2 * fw) / n;
  for (let i = 0; i < n; i++) add(g, B(w - 2 * fw, 0.055, 0.004, 0), m, 0, -h / 2 + fw + (i + 0.5) * pitch, 0, -0.65);
  p.add(g); return g;
}
export function bolts(p, pts, r, len, m, dir) {
  const q = dir ? new THREE.Quaternion().setFromUnitVectors(UP, dir) : null;
  for (const a of pts) { const o = mesh(C(r, len, 6), m); o.position.copy(a); if (q) o.quaternion.copy(q); p.add(o); }
}
function orient(g, pos, dir) { g.position.copy(pos); g.quaternion.setFromUnitVectors(UP, dir.clone().normalize()); return g; }
function flange(p, pos, dir, r, m) {
  const g = new THREE.Group();
  add(g, C(r * 1.8, 0.03, 16), m, 0, 0.018, 0); add(g, C(r * 1.8, 0.03, 16), m, 0, -0.018, 0);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + 0.39; add(g, C(0.011, 0.11, 6), 'galv', Math.cos(a) * r * 1.45, 0, Math.sin(a) * r * 1.45); }
  p.add(orient(g, pos, dir)); return g;
}
// Valve on a horizontal line. Local X is the pipe axis.
function valve(p, pos, yaw, r, m, kind) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = yaw;
  const body = add(g, sphereGeo(r * 1.55, 12, 8), m, 0, 0, 0); body.scale.set(1.25, 1, 1);
  for (const s of [-1, 1]) flange(g, v(s * r * 2.6, 0, 0), v(1, 0, 0), r, m);
  add(g, C(r * 0.7, r * 1.6, 10), m, 0, r * 1.8, 0);
  add(g, C(r * 1.0, 0.03, 10), m, 0, r * 2.6, 0);
  const top = r * 2.6;
  if (kind === 'lever') {
    add(g, C(0.016, 0.1, 8), 'steel', 0, top + 0.05, 0);
    add(g, B(r * 5.5, 0.014, 0.04, 0.004), 'yellow', r * 2.2, top + 0.1, 0);
    add(g, B(0.16, 0.03, 0.045, 0.01), 'black', r * 4.6, top + 0.1, 0);
  } else {
    add(g, B(r * 2.2, r * 1.8, r * 1.9, 0.01), kind === 'slam' ? 'red' : m, 0, top + r * 0.9, 0);
    add(g, C(0.014, r * 2.6, 6), 'steel', 0, top + r * 0.9, r * 1.6, Math.PI / 2);
    const wh = mesh(memo(_geo, 'hw' + f3(r), () => new THREE.TorusGeometry(r * 1.9, 0.013, 6, 18)), kind === 'slam' ? 'dark' : 'red', 0, top + r * 0.9, r * 2.8); g.add(wh);
    for (let i = 0; i < 3; i++) add(g, C(0.009, r * 3.8, 5), 'dark', 0, top + r * 0.9, r * 2.8, 0, 0, i * Math.PI / 3);
  }
  p.add(g); return g;
}
function gauge(p, pos, ry = 0, stem = 0.12) {
  const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = ry;
  add(g, C(0.007, stem, 6), 'steel', 0, stem / 2, 0);
  add(g, C(0.012, 0.03, 6), 'brass', 0, stem * 0.3, 0);
  add(g, C(0.052, 0.032, 16), 'steel', 0, stem + 0.05, 0, Math.PI / 2);
  const f = decal(g, 'gauge', 0.092, 0.092, 0, stem + 0.05, 0.0165);
  f.material = M('gauge'); p.add(g); return g;
}
function bollardParts(g, x, z) {
  add(g, C(0.22, 0.06, 14), 'concrete', x, 0.03, z);
  add(g, C(0.084, 1.05, 14), 'yellow', x, 0.56, z);
  const cap = add(g, sphereGeo(0.084, 14, 5, Math.PI / 2), 'yellow', x, 1.085, z); cap.scale.y = 0.55;
  add(g, C(0.0855, 0.09, 14, 0.0855, true), 'black', x, 0.88, z);
  add(g, C(0.0855, 0.09, 14, 0.0855, true), 'black', x, 0.68, z);
}
// Person door on a wall. Local +Z is outward, y0 is the sill.
function manDoor(p, x, y0, z, ry, o = {}) {
  const w = o.w || 0.95, h = o.h || 2.1, m = o.mat || 'grey61';
  const g = new THREE.Group(); g.position.set(x, y0, z); g.rotation.y = ry;
  add(g, B(w + 0.14, h + 0.07, 0.05, 0.008), 'dark', 0, h / 2 + 0.035, 0.0);
  add(g, B(w, h, 0.045, 0.01), m, 0, h / 2, 0.022);
  add(g, B(w - 0.2, 0.22, 0.004, 0), 'alu', 0, 0.13, 0.046);
  for (const yy of [0.25, h / 2, h - 0.25]) add(g, C(0.012, 0.11, 8), 'steel', -w / 2 - 0.004, yy, 0.05);
  add(g, B(0.05, 0.16, 0.012, 0.004), 'steel', w / 2 - 0.09, 1.02, 0.05);
  add(g, B(0.13, 0.022, 0.022, 0.008), 'steel', w / 2 - 0.14, 1.04, 0.085);
  add(g, C(0.011, 0.05, 8), 'steel', w / 2 - 0.09, 1.04, 0.07, Math.PI / 2);
  add(g, B(0.26, 0.05, 0.06, 0.008), 'alu', -w / 2 + 0.2, h - 0.06, 0.07);
  if (o.window) { add(g, B(0.5, 0.62, 0.02, 0.006), 'dark', 0, h - 0.6, 0.04); add(g, B(0.42, 0.54, 0.012, 0), 'glass', 0, h - 0.6, 0.048); }
  add(g, B(w + 0.3, 0.03, 0.16, 0.006), m, 0, h + 0.1, 0.08, 0.2);
  add(g, B(0.24, 0.1, 0.09, 0.012), 'dark', 0, h + 0.28, 0.06);
  add(g, B(0.2, 0.012, 0.07, 0), 'wallpack', 0, h + 0.228, 0.065);
  if (o.sign) decal(g, o.sign, 0.32, 0.24, 0, h - 0.5, 0.047);
  p.add(g); return g;
}
function hvacUnit(p, x, y0, z, ry, s = 1) {
  const g = new THREE.Group(); g.position.set(x, y0, z); g.rotation.y = ry; g.scale.setScalar(s);
  const w = 1.05, h = 2.15, d = 0.52;
  add(g, B(w, h, d, 0.02), 'beige', 0, h / 2, d / 2);
  louver(g, w - 0.16, 0.8, 'beige', 0, h - 0.55, d + 0.004);
  louver(g, w - 0.16, 0.42, 'beige', 0, 0.75, d + 0.004);
  add(g, B(w - 0.16, 0.28, 0.01, 0.004), 'beige', 0, 0.32, d + 0.004);
  add(g, B(0.1, 0.03, 0.02, 0.006), 'black', 0.3, 0.32, d + 0.016);
  louver(g, 0.4, 0.7, 'beige', w / 2 + 0.004, h - 0.6, d / 2, Math.PI / 2);
  add(g, B(w + 0.06, 0.03, d + 0.05, 0.008), 'beige', 0, h + 0.012, d / 2);
  add(g, B(0.2, 0.3, 0.1, 0.01), 'grey70', -w / 2 - 0.2, 1.3, 0.06);
  tube(g, v(-w / 2 - 0.2, 1.15, 0.05), v(-w / 2 - 0.2, 0.2, 0.05), 0.013, 'galv', 6);
  p.add(g); return g;
}
// Landing with stairs that run parallel to the wall. dir = +1 or -1 along X.
function landing(g, xd, z0, top, dir) {
  const pw = 1.5, pd = 1.15, zc = z0 + pd / 2, zo = z0 + pd;
  add(g, B(pw, 0.035, pd, 0), 'grating', xd, top - 0.018, zc);
  for (const zz of [z0 + 0.03, zo - 0.03]) add(g, B(pw, 0.12, 0.05, 0.006), 'galv', xd, top - 0.07, zz);
  for (const xx of [-1, 1]) add(g, B(0.05, 0.12, pd, 0.006), 'galv', xd + xx * (pw / 2 - 0.025), top - 0.07, zc);
  for (const xx of [-1, 1]) for (const zz of [z0 + 0.06, zo - 0.06]) { add(g, B(0.06, top - 0.1, 0.06, 0.006), 'galv', xd + xx * (pw / 2 - 0.05), (top - 0.1) / 2, zz); add(g, B(0.16, 0.012, 0.16, 0), 'galv', xd + xx * (pw / 2 - 0.05), 0.006, zz); }
  const rise = 0.19, run = 0.27, n = Math.round(top / rise), sx = xd + dir * pw / 2;
  for (let i = 1; i < n; i++) add(g, B(run, 0.03, pd - 0.12, 0), 'grating', sx + dir * (i - 0.5) * run, top - i * rise, zc);
  const bx = sx + dir * (n - 0.6) * run;
  for (const zz of [z0 + 0.04, zo - 0.04]) boxBetween(g, v(sx, top - 0.09, zz), v(bx, 0.04, zz), 0.2, 0.012, 'galv');
  const R = 0.021, hr = 1.07, far = xd - dir * (pw / 2 - 0.03);
  const P = (x, y, z) => v(x, y, z);
  // platform rail on the outer edge and the far end
  for (const x of [far, sx]) tube(g, P(x, top, zo - 0.03), P(x, top + hr, zo - 0.03), R, 'yellow');
  tube(g, P(far, top, z0 + 0.05), P(far, top + hr, z0 + 0.05), R, 'yellow');
  for (const hh of [hr, hr * 0.5]) { tube(g, P(far, top + hh, zo - 0.03), P(sx, top + hh, zo - 0.03), R, 'yellow'); tube(g, P(far, top + hh, z0 + 0.05), P(far, top + hh, zo - 0.03), R, 'yellow'); }
  add(g, B(pw, 0.1, 0.006, 0), 'yellow', xd, top + 0.05, zo - 0.005);
  // stair rails both sides
  for (const zz of [zo - 0.03, z0 + 0.05]) {
    tube(g, P(bx, 0.04, zz), P(bx, 0.04 + hr, zz), R, 'yellow');
    if (zz < zc) tube(g, P(sx, top, zz), P(sx, top + hr, zz), R, 'yellow');
    for (const hh of [hr, hr * 0.5]) tube(g, P(sx, top + hh, zz), P(bx, 0.04 + hh, zz), R, 'yellow');
  }
}

// ---------------------------------------------------------------- switchgear e-house
export function buildSwitchgear({ sections = 8 } = {}) {
  return prop('swgr' + sections, () => {
    const g = new THREE.Group();
    const L = Math.max(6, sections * 0.92 + 3.2), D = 4.3, H = 3.2, F = 0.95, hx = L / 2, hz = D / 2;
    const nP = Math.ceil(L / 2.6) + 1;
    for (let i = 0; i < nP; i++) {
      const x = -hx + 0.35 + i * (L - 0.7) / (nP - 1);
      for (const z of [-hz + 0.35, hz - 0.35]) add(g, B(0.6, F - 0.3, 0.6, 0.03), 'concrete', x, (F - 0.3) / 2, z);
      add(g, B(0.14, 0.24, D - 0.3, 0), 'dark', x, F - 0.14, 0);
    }
    for (const z of [-hz + 0.08, hz - 0.08]) { add(g, B(L, 0.3, 0.16, 0.01), 'dark', 0, F - 0.15, z); add(g, B(L, 0.02, 0.2, 0), 'dark', 0, F - 0.29, z); }
    for (const x of [-hx + 0.08, hx - 0.08]) add(g, B(0.16, 0.3, D, 0.01), 'dark', x, F - 0.15, 0);
    add(g, B(L - 0.2, 0.04, D - 0.2, 0), 'dark', 0, F - 0.02, 0);
    // walls
    const wl = corrugGeo(L - 0.1, H, 0.4, 0.022, 'rib'), we = corrugGeo(D - 0.1, H, 0.4, 0.022, 'rib');
    add(g, wl, 'grey61DS', 0, F, hz - 0.03); add(g, wl, 'grey61DS', 0, F, -hz + 0.03, 0, Math.PI);
    add(g, we, 'grey61DS', hx - 0.03, F, 0, 0, Math.PI / 2); add(g, we, 'grey61DS', -hx + 0.03, F, 0, 0, -Math.PI / 2);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(g, B(0.1, H, 0.1, 0.012), 'grey61', x * (hx - 0.03), F + H / 2, z * (hz - 0.03));
    add(g, B(L + 0.04, 0.1, D + 0.04, 0.01), 'grey61', 0, F + 0.05, 0);
    // roof: low gable with standing seams, fascia, gutters
    add(g, B(L + 0.24, 0.2, D + 0.24, 0.012), 'grey61', 0, F + H + 0.02, 0);
    for (const s of [-1, 1]) {
      const r = add(g, B(L + 0.4, 0.04, D / 2 + 0.26, 0.006), 'grey70', 0, F + H + 0.2, s * (D / 4 + 0.1), s * 0.06);
      r.receiveShadow = true;
      const ns = Math.floor(L / 0.6);
      for (let i = 0; i <= ns; i++) add(g, B(0.02, 0.035, D / 2 + 0.24, 0), 'grey70', -L / 2 + i * (L / ns), F + H + 0.235, s * (D / 4 + 0.1), s * 0.06);
      add(g, B(L + 0.4, 0.09, 0.1, 0.01), 'grey61', 0, F + H + 0.1, s * (hz + 0.2));
      tube(g, v(hx + 0.1, F + H + 0.06, s * (hz + 0.2)), v(hx + 0.1, 0.25, s * (hz + 0.2)), 0.04, 'grey61');
    }
    add(g, B(L + 0.4, 0.05, 0.16, 0.01), 'grey70', 0, F + H + 0.275, 0);
    // arc vent plenum along the rear roof
    add(g, B(sections * 0.92, 0.26, 0.8, 0.012), 'grey61', 0, F + H + 0.33, -hz + 0.75);
    for (let i = 0; i < sections; i++) add(g, B(0.8, 0.012, 0.6, 0.004), 'grey70', (i + 0.5 - sections / 2) * 0.92, F + H + 0.465, -hz + 0.75);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(g, B(0.03, 0.14, 0.12, 0.004), 'dark', x * (hx - 0.4), F + H + 0.24, z * (hz + 0.02));
    // rear section doors
    for (let i = 0; i < sections; i++) {
      const x = (i + 0.5 - sections / 2) * 0.92, z = -hz - 0.012;
      add(g, B(0.86, 2.35, 0.03, 0.008), 'grey61', x, F + 0.25 + 1.175, z);
      add(g, B(0.03, 0.2, 0.03, 0.006), 'black', x - 0.33, F + 1.4, z - 0.025);
      for (const yy of [0.6, 2.2]) add(g, C(0.011, 0.1, 6), 'steel', x + 0.435, F + yy, z - 0.02);
      louver(g, 0.5, 0.25, 'grey61', x, F + 0.55, z - 0.016, Math.PI);
      if (i % 2 === 0) decal(g, SIGN.hv138(), 0.3, 0.225, x, F + 2.0, z - 0.017, Math.PI);
    }
    // front doors with landings and stairs
    const dx = hx - 1.25;
    for (const s of [-1, 1]) {
      manDoor(g, s * dx, F + 0.02, hz - 0.01, 0, { sign: SIGN.hv138() });
      landing(g, s * dx, hz + 0.03, F, -s);
    }
    // equipment double door mid front
    for (const s of [-1, 1]) { add(g, B(0.9, 2.4, 0.04, 0.01), 'grey61', s * 0.455, F + 1.3, hz + 0.0); for (const yy of [0.4, 1.3, 2.2]) add(g, C(0.012, 0.12, 6), 'steel', s * 0.915, F + yy, hz + 0.022); }
    add(g, B(1.96, 2.52, 0.03, 0.006), 'dark', 0, F + 1.3, hz - 0.012);
    add(g, B(0.03, 0.22, 0.03, 0.006), 'black', 0.08, F + 1.25, hz + 0.03);
    add(g, B(2.1, 0.03, 0.18, 0.006), 'grey61', 0, F + 2.62, hz + 0.08, 0.2);
    decal(g, SIGN.hv138(), 0.44, 0.33, -0.455, F + 1.75, hz + 0.022);
    // HVAC on both ends, disconnects, signs
    hvacUnit(g, hx - 0.02, F + 0.25, 0.6, Math.PI / 2); hvacUnit(g, -hx + 0.02, F + 0.25, -0.6, -Math.PI / 2);
    decal(g, SIGN.hv138(), 0.6, 0.45, hx + 0.0, F + 1.9, -1.0, Math.PI / 2);
    decal(g, SIGN.hv138(), 0.6, 0.45, -hx - 0.0, F + 1.9, 1.0, -Math.PI / 2);
    // cable entry below: conduit bank and tray drop
    for (let i = 0; i < Math.min(sections, 10); i++) for (const z of [-hz + 0.75, -hz + 1.0]) {
      const x = (i + 0.5 - Math.min(sections, 10) / 2) * 0.5;
      tube(g, v(x, F - 0.05, z), v(x, 0, z), 0.065, 'pvc', 8);
      add(g, C(0.08, 0.07, 8), 'pvc', x, 0.035, z);
    }
    add(g, B(Math.min(sections, 10) * 0.5 + 0.4, 0.1, 0.9, 0.02), 'concrete', 0, 0.05, -hz + 0.875);
    // ground straps
    for (const s of [-1, 1]) pipePath(g, [v(s * (hx - 0.3), F - 0.2, hz + 0.01), v(s * (hx - 0.3), 0.06, hz + 0.01), v(s * (hx - 0.3), 0.02, hz + 0.3)], 0.008, 'copper', 0.04, 5);
    return g;
  });
}

// ---------------------------------------------------------------- transformer
function bushingGeo(h, r, sheds) {
  return memo(_geo, `bush${f3(h)}_${f3(r)}_${sheds}`, () => {
    const pts = [new THREE.Vector2(r * 0.75, 0)], p = h / sheds;
    for (let i = 0; i < sheds; i++) { const y = i * p, k = 1 - 0.25 * (i / sheds); pts.push(new THREE.Vector2(r * 0.5, y + p * 0.1), new THREE.Vector2(r * k, y + p * 0.42), new THREE.Vector2(r * k, y + p * 0.52), new THREE.Vector2(r * 0.5, y + p * 0.7)); }
    pts.push(new THREE.Vector2(r * 0.45, h), new THREE.Vector2(0, h));
    return new THREE.LatheGeometry(pts, 12);
  });
}
function bushing(p, x, y, z, h, r, sheds, tiltX, m) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.x = tiltX;
  add(g, C(r * 1.25, 0.14, 12), 'grey70', 0, 0.07, 0);
  add(g, bushingGeo(h, r, sheds), m, 0, 0.14, 0);
  add(g, C(r * 0.4, 0.1, 10), 'alu', 0, 0.14 + h + 0.05, 0);
  add(g, B(0.05, 0.1, 0.012, 0.003), 'alu', 0, 0.14 + h + 0.14, 0);
  p.add(g); return g;
}
function radiatorBank(g, x0, x1, zSide, y0, RH, zTank) {
  const RD = 0.52, zc = zSide * (zTank + 0.14 + RD / 2), n = Math.floor((x1 - x0) / 0.05), grp = 14;
  const fin = B(0.012, RH, RD, 0);
  for (let i = 0; i <= n; i++) { if (i % grp === grp - 1) continue; add(g, fin, 'grey70', x0 + i * 0.05, y0 + RH / 2, zc); }
  for (const yy of [y0 + 0.1, y0 + RH - 0.1]) {
    tube(g, v(x0 - 0.03, yy, zc), v(x1 + 0.03, yy, zc), 0.055, 'grey70', 10);
    for (let k = 0; k * grp * 0.05 < x1 - x0 - 0.3; k++) {
      const x = x0 + (k * grp + grp / 2 - 0.5) * 0.05;
      tube(g, v(x, yy, zc), v(x, yy, zSide * zTank), 0.045, 'grey70', 8);
      flange(g, v(x, yy, zSide * (zTank + 0.07)), v(0, 0, 1), 0.045, 'grey70');
    }
  }
  // braces and cooling fans on the outer face
  const zo = zSide * (zTank + 0.14 + RD + 0.02);
  for (const yy of [y0 + 0.35, y0 + RH - 0.35]) add(g, B(x1 - x0 + 0.1, 0.05, 0.03, 0.004), 'grey70', (x0 + x1) / 2, yy, zo);
  const nf = Math.max(1, Math.round((x1 - x0) / 1.1));
  for (let i = 0; i < nf; i++) {
    const x = x0 + (i + 0.5) * (x1 - x0) / nf, y = y0 + RH * 0.5, f = new THREE.Group();
    f.position.set(x, y, zo + zSide * 0.09); if (zSide < 0) f.rotation.y = Math.PI;
    add(f, C(0.34, 0.14, 20, 0.34, true), 'grey70DS', 0, 0, 0, Math.PI / 2);
    add(f, C(0.09, 0.16, 10), 'dark', 0, 0, -0.02, Math.PI / 2);
    for (let b = 0; b < 5; b++) { const bl = add(f, B(0.24, 0.1, 0.006, 0), 'dark', 0, 0, 0); bl.rotation.set(0, 0, b * Math.PI * 0.4); bl.translateX(0.2); bl.rotateX(0.5); }
    const gr = decal(f, 'grille', 0.69, 0.69, 0, 0, 0.072); gr.material = M('grille');
    add(f, B(0.72, 0.03, 0.02, 0), 'grey70', 0, 0, -0.07); add(f, B(0.03, 0.72, 0.02, 0), 'grey70', 0, 0, -0.07);
    g.add(f);
  }
}
export function buildTransformer({ mva = 30 } = {}) {
  return prop('xfmr' + mva, () => {
    const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
    const s = THREE.MathUtils.clamp(Math.cbrt(mva / 30), 0.6, 1.5);
    const TL = 3.4, TW = 1.7, TH = 2.5, y0 = 0.6, hz = TW / 2, hx = TL / 2, yt = y0 + TH;
    // containment curb with stone fill, pedestal
    const CW = 7.4, CD = 6.0;
    for (const z of [-1, 1]) add(root, B(CW * s, 0.38, 0.2, 0.02), 'concrete', 0, 0.19, z * (CD * s / 2 - 0.1));
    for (const x of [-1, 1]) add(root, B(0.2, 0.38, CD * s - 0.38, 0.02), 'concrete', x * (CW * s / 2 - 0.1), 0.19, 0);
    add(root, B(CW * s - 0.3, 0.2, CD * s - 0.3, 0), 'stone', 0, 0.12, 0);
    add(root, B((TL + 0.7) * s, 0.42, (TW + 0.7) * s, 0.03), 'concrete', 0, 0.21, 0);
    g.scale.setScalar(s); g.position.y = 0.42 - y0 * s + 0.18 * s;
    const yb = y0 - 0.18;
    for (const z of [-1, 1]) add(g, B(TL + 0.3, 0.18, 0.22, 0.012), 'dark', 0, yb + 0.09, z * (hz - 0.25));
    // tank
    add(g, B(TL, TH, TW, 0.05, 2), 'grey70', 0, y0 + TH / 2, 0);
    add(g, B(TL + 0.14, 0.05, TW + 0.14, 0.01), 'grey70', 0, yt + 0.0, 0);
    add(g, B(TL + 0.08, 0.04, TW + 0.08, 0.01), 'grey70', 0, y0 + 0.02, 0);
    const bp = [];
    for (let x = -hx; x <= hx + 0.01; x += 0.17) bp.push(v(x, yt + 0.03, hz + 0.035), v(x, yt + 0.03, -hz - 0.035));
    for (let z = -hz + 0.15; z <= hz - 0.1; z += 0.17) bp.push(v(hx + 0.035, yt + 0.03, z), v(-hx - 0.035, yt + 0.03, z));
    bolts(g, bp, 0.013, 0.035, 'galv');
    for (const x of [-1, 1]) for (const z of [-0.5, 0, 0.5]) add(g, B(0.05, TH - 0.2, 0.07, 0.006), 'grey70', x * (hx + 0.02), y0 + TH / 2, z);
    for (const x of [0.55, 1.55]) add(g, B(0.07, TH - 0.2, 0.05, 0.006), 'grey70', x, y0 + TH / 2, hz + 0.02);
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      add(g, B(0.04, 0.2, 0.14, 0.006), 'grey70', x * (hx - 0.25), yt - 0.22, z * (hz + 0.02), 0, Math.PI / 2);
      add(g, B(0.22, 0.05, 0.22, 0.008), 'grey70', x * (hx - 0.1), y0 + 0.06, z * (hz + 0.05));
    }
    // bushings: HV toward +Z, LV toward -Z, arresters on a bracket
    for (const x of [-0.95, 0, 0.95]) {
      bushing(g, x, yt + 0.02, 0.38, 0.95, 0.12, 8, 0.2, 'porcelain');
      add(g, B(0.08, 0.06, 0.5, 0.006), 'grey70', x, yt - 0.1, hz + 0.3);
      bushing(g, x, yt - 0.07, hz + 0.48, 0.62, 0.075, 6, 0, 'polymer');
      tube(g, v(x, yt + 0.02 + 1.2, 0.6), v(x, yt + 0.72, hz + 0.48), 0.008, 'copper', 5);
    }
    add(g, B(2.3, 0.06, 0.06, 0.006), 'grey70', 0, yt - 0.1, hz + 0.5);
    for (const x of [-0.78, -0.26, 0.26, 0.78]) bushing(g, x, yt + 0.02, -0.5, 0.42, 0.085, 4, -0.15, 'porcelain');
    // pressure relief, lid hand hole, tap changer
    add(g, C(0.1, 0.13, 12), 'grey70', 1.2, yt + 0.09, -0.05); add(g, C(0.13, 0.03, 12), 'yellow', 1.2, yt + 0.17, -0.05);
    add(g, C(0.22, 0.03, 16), 'grey70', -1.25, yt + 0.04, 0.3);
    // conservator across the -X end
    const cy = yt + 1.05, cx = -hx - 0.05, cr = 0.36, cl = 1.9;
    add(g, C(cr, cl, 20), 'grey70', cx, cy, 0, Math.PI / 2);
    for (const z of [-1, 1]) { const cap = add(g, sphereGeo(cr, 20, 5, Math.PI / 2), 'grey70', cx, cy, z * cl / 2, z * Math.PI / 2); cap.scale.y = 0.35; }
    for (const z of [-0.6, 0.6]) {
      boxBetween(g, v(cx, cy - cr, z), v(cx + 0.35, yt + 0.03, z), 0.07, 0.07, 'grey70');
      boxBetween(g, v(cx, cy - cr, z), v(cx - 0.05, yt - 0.5, z), 0.07, 0.07, 'grey70');
      add(g, B(0.1, 0.04, cr * 1.7, 0.006), 'grey70', cx, cy - cr + 0.01, z, 0, Math.PI / 2);
    }
    pipePath(g, [v(cx + 0.1, cy - cr + 0.03, 0.15), v(cx + 0.75, cy - cr + 0.03, 0.15), v(cx + 0.75, yt, 0.15)], 0.03, 'grey70', 0.09, 8);
    add(g, B(0.2, 0.15, 0.14, 0.01), 'grey70', cx + 0.45, cy - cr + 0.03, 0.15);
    add(g, C(0.1, 0.03, 16), 'steel', cx, cy, cl / 2 + cr * 0.35 + 0.005, Math.PI / 2);
    decal(g, 'gauge', 0.17, 0.17, cx, cy, cl / 2 + cr * 0.35 + 0.022).material = M('gauge');
    pipePath(g, [v(cx - 0.2, cy - cr + 0.05, -0.3), v(cx - 0.45, cy - cr + 0.05, -0.3), v(cx - 0.45, y0 + 1.5, -0.3)], 0.014, 'steel', 0.05, 6);
    add(g, C(0.065, 0.28, 12), 'amberGlass', cx - 0.45, y0 + 1.36, -0.3); add(g, C(0.07, 0.03, 12), 'steel', cx - 0.45, y0 + 1.2, -0.3); add(g, C(0.07, 0.03, 12), 'steel', cx - 0.45, y0 + 1.51, -0.3);
    add(g, C(0.05, 0.05, 10), 'steel', cx, cy + cr + 0.02, 0.4);
    // radiators
    radiatorBank(g, -hx + 0.2, hx - 0.2, -1, y0 + 0.28, 1.95, hz);
    radiatorBank(g, -hx + 0.2, 0.35, 1, y0 + 0.28, 1.95, hz);
    // control cabinet, gauges, nameplate, valve, conduits (+Z, right)
    const kx = 1.08, kz = hz + 0.02;
    add(g, B(0.86, 1.15, 0.36, 0.014), 'grey70', kx, y0 + 1.05, kz + 0.2);
    add(g, B(0.8, 1.08, 0.02, 0.008), 'grey70', kx, y0 + 1.05, kz + 0.385);
    add(g, B(0.03, 0.16, 0.03, 0.006), 'black', kx + 0.33, y0 + 1.05, kz + 0.405);
    for (const yy of [0.7, 1.4]) add(g, C(0.011, 0.09, 6), 'steel', kx - 0.41, y0 + yy, kz + 0.39);
    add(g, B(0.92, 0.03, 0.42, 0.006), 'grey70', kx, y0 + 1.65, kz + 0.2, 0.12);
    add(g, B(0.3, 0.2, 0.012, 0), 'glass', kx - 0.1, y0 + 1.3, kz + 0.392);
    for (const dxx of [-0.22, 0.22]) { add(g, C(0.09, 0.05, 16), 'dark', kx + dxx, y0 + 2.0, kz + 0.02, Math.PI / 2); decal(g, 'gauge', 0.15, 0.15, kx + dxx, y0 + 2.0, kz + 0.047).material = M('gauge'); }
    decal(g, SIGN.plate(), 0.4, 0.3, 0.2 + 0.55 + 0.28, y0 + 0.28, kz + 0.002);
    decal(g, SIGN.hv(), 0.5, 0.375, hx + 0.027, y0 + 1.5, 0, Math.PI / 2);
    for (const dxx of [-0.25, 0, 0.25]) tube(g, v(kx + dxx, y0 + 0.48, kz + 0.2), v(kx + dxx, yb - 0.1, kz + 0.2), 0.02, 'galv', 6);
    pipePath(g, [v(kx - 0.45, y0 + 0.8, kz + 0.2), v(kx - 0.62, y0 + 0.8, kz + 0.2), v(kx - 0.62, y0 + 0.8, kz + 0.75)], 0.014, 'galv', 0.05, 6);
    add(g, C(0.04, 0.16, 10), 'grey70', 1.5, y0 + 0.2, hz + 0.07, Math.PI / 2);
    add(g, C(0.06, 0.02, 10), 'red', 1.5, y0 + 0.2, hz + 0.16, Math.PI / 2);
    add(g, B(0.3, 0.36, 0.2, 0.012), 'grey70', hx + 0.1, y0 + 1.2, 0.45); add(g, C(0.11, 0.02, 14), 'dark', hx + 0.21, y0 + 1.2, 0.45, 0, 0, Math.PI / 2);
    for (const x of [-1, 1]) pipePath(g, [v(x * (hx - 0.1), y0 + 0.1, hz + 0.16), v(x * (hx - 0.1), yb - 0.1, hz + 0.16), v(x * (hx - 0.1), yb - 0.14, hz + 0.6)], 0.009, 'copper', 0.04, 5);
    return root;
  });
}

// ---------------------------------------------------------------- gas skid
function regulator(g, x, y, z, r) {
  const b = add(g, sphereGeo(r * 1.6, 12, 8), 'yellow', x, y, z); b.scale.set(1.2, 1, 1);
  for (const s of [-1, 1]) flange(g, v(x + s * r * 2.5, y, z), v(1, 0, 0), r, 'yellow');
  add(g, C(r * 0.8, 0.14, 10), 'yellow', x, y + r * 1.7, z);
  add(g, C(0.27, 0.03, 20), 'yellow', x, y + r * 1.7 + 0.085, z);
  const dome = add(g, sphereGeo(0.25, 20, 5, Math.PI / 2), 'yellow', x, y + r * 1.7 + 0.1, z); dome.scale.y = 0.4;
  const lo = add(g, sphereGeo(0.25, 20, 5, Math.PI / 2), 'yellow', x, y + r * 1.7 + 0.07, z, Math.PI); lo.scale.y = 0.3;
  const bp = []; for (let i = 0; i < 12; i++) bp.push(v(x + Math.cos(i * 0.5236) * 0.245, y + r * 1.7 + 0.085, z + Math.sin(i * 0.5236) * 0.245));
  bolts(g, bp, 0.009, 0.06, 'galv');
  add(g, C(0.05, 0.26, 10), 'yellow', x, y + r * 1.7 + 0.3, z); add(g, C(0.03, 0.04, 8), 'steel', x, y + r * 1.7 + 0.45, z);
  add(g, B(0.09, 0.12, 0.09, 0.01), 'grey70', x + 0.3, y + 0.32, z + 0.12);
  pipePath(g, [v(x + 0.3, y + 0.38, z + 0.12), v(x + 0.3, y + 0.55, z + 0.12), v(x + 0.06, y + 0.55, z + 0.12)], 0.006, 'steel', 0.03, 5);
  pipePath(g, [v(x + 0.3, y + 0.26, z + 0.12), v(x + 0.3, y + 0.12, z + 0.12), v(x + 0.5, y + 0.12, z + 0.02)], 0.006, 'steel', 0.03, 5);
}
export function buildGasSkid() {
  return prop('gasskid', () => {
    const g = new THREE.Group(), L = 6.2, W = 2.3, Y = 1.0, r = 0.084, DK = 0.22;
    for (const z of [-1, 1]) add(g, B(L, 0.2, 0.12, 0.01), 'dark', 0, 0.11, z * (W / 2 - 0.06));
    for (const x of [-1, 1]) add(g, B(0.12, 0.2, W, 0.01), 'dark', x * (L / 2 - 0.06), 0.11, 0);
    for (const x of [-1.8, -0.6, 0.6, 1.8]) add(g, B(0.1, 0.18, W - 0.2, 0), 'dark', x, 0.11, 0);
    add(g, B(L - 0.2, 0.03, W - 0.2, 0), 'grating', 0, DK - 0.015, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(g, B(0.04, 0.12, 0.14, 0.006), 'dark', x * (L / 2 - 0.5), 0.27, z * (W / 2 - 0.01), 0, 0);
    // inlet riser, valve
    pipePath(g, [v(-3.6, -0.1, 0), v(-3.6, Y, 0), v(-2.25, Y, 0)], r, 'yellow', 0.25);
    flange(g, v(-3.6, 0.42, 0), UP, r, 'yellow');
    valve(g, v(-2.85, Y, 0), 0, r, 'yellow', 'gear');
    gauge(g, v(-2.45, Y + r, 0));
    // filter separator
    const fx = -1.85, fr = 0.33;
    add(g, C(fr, 1.3, 20), 'yellow', fx, 1.15, 0);
    const hb = add(g, sphereGeo(fr, 20, 6, Math.PI / 2), 'yellow', fx, 0.5, 0, Math.PI); hb.scale.y = 0.55;
    add(g, C(fr * 1.16, 0.05, 20), 'yellow', fx, 1.8, 0); add(g, C(fr * 1.16, 0.05, 20), 'yellow', fx, 1.86, 0);
    const ht = add(g, sphereGeo(fr, 20, 6, Math.PI / 2), 'yellow', fx, 1.885, 0); ht.scale.y = 0.4;
    const bp = []; for (let i = 0; i < 16; i++) bp.push(v(fx + Math.cos(i * 0.3927) * fr * 1.08, 1.83, Math.sin(i * 0.3927) * fr * 1.08));
    bolts(g, bp, 0.012, 0.15, 'galv');
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5; boxBetween(g, v(fx + Math.cos(a) * fr * 0.9, 0.5, Math.sin(a) * fr * 0.9), v(fx + Math.cos(a) * fr * 1.15, DK, Math.sin(a) * fr * 1.15), 0.06, 0.06, 'yellow'); }
    tube(g, v(-2.3, Y, 0), v(-1.4, Y, 0), r, 'yellow', 10);
    gauge(g, v(fx, 2.0, 0), 0, 0.1);
    pipePath(g, [v(fx, 0.33, 0), v(fx, 0.3, 0), v(fx, 0.3, 0.55)], 0.025, 'yellow', 0.06, 6);
    add(g, B(0.09, 0.07, 0.07, 0.01), 'yellow', fx, 0.3, 0.45); add(g, B(0.02, 0.012, 0.16, 0.004), 'red', fx, 0.35, 0.45);
    decal(g, SIGN.plate(), 0.2, 0.15, fx, 1.3, fr + 0.004);
    pipePath(g, [v(fx - 0.15, 1.5, fr * 0.9), v(fx - 0.15, 1.5, fr + 0.12), v(fx + 0.15, 1.5, fr + 0.12), v(fx + 0.15, 1.5, fr * 0.9)], 0.006, 'steel', 0.03, 5);
    add(g, C(0.05, 0.03, 14), 'steel', fx, 1.5, fr + 0.13, Math.PI / 2); decal(g, 'gauge', 0.09, 0.09, fx, 1.5, fr + 0.147).material = M('gauge');
    // slam shut, then two regulator runs
    valve(g, v(-1.18, Y, 0), 0, r, 'yellow', 'slam');
    tube(g, v(-1.45, Y, 0), v(-0.75, Y, 0), r, 'yellow', 10);
    const rr = 0.057;
    for (const zs of [-1, 1]) {
      const z = zs * 0.55;
      pipePath(g, [v(-0.75, Y, 0), v(-0.75, Y, z), v(0.95, Y, z), v(0.95, Y, 0)], rr, 'yellow', 0.16);
      valve(g, v(-0.3, Y, z), 0, rr, 'yellow', 'lever');
      regulator(g, 0.2, Y, z, rr);
      valve(g, v(0.65, Y, z), Math.PI, rr, 'yellow', 'lever');
      gauge(g, v(0.42, Y + rr, z));
    }
    add(g, sphereGeo(r, 10, 6), 'yellow', -0.75, Y, 0); add(g, sphereGeo(r, 10, 6), 'yellow', 0.95, Y, 0);
    // meter run and outlet
    pipePath(g, [v(0.95, Y, 0), v(3.6, Y, 0), v(3.6, -0.1, 0)], r, 'yellow', 0.25);
    flange(g, v(3.6, 0.42, 0), UP, r, 'yellow'); flange(g, v(1.3, Y, 0), v(1, 0, 0), r, 'yellow');
    add(g, B(0.34, 0.3, 0.3, 0.03), 'grey70', 1.85, Y, 0);
    for (const s of [-1, 1]) flange(g, v(1.85 + s * 0.2, Y, 0), v(1, 0, 0), r, 'grey70');
    add(g, C(0.035, 0.16, 8), 'grey70', 1.85, Y + 0.22, 0); add(g, B(0.2, 0.16, 0.14, 0.015), 'grey70', 1.85, Y + 0.37, 0);
    add(g, B(0.12, 0.07, 0.004, 0), 'glass', 1.85, Y + 0.38, 0.072);
    for (const x of [2.2, 2.38]) { add(g, C(0.012, 0.14, 6), 'steel', x, Y + r + 0.06, 0); add(g, B(0.09, 0.11, 0.09, 0.012), 'blue', x, Y + r + 0.17, 0); add(g, C(0.045, 0.05, 10), 'blue', x, Y + r + 0.17, 0.06, Math.PI / 2); }
    valve(g, v(2.85, Y, 0), 0, r, 'yellow', 'gear');
    gauge(g, v(3.2, Y + r, 0));
    // relief valve and vent stack
    pipePath(g, [v(1.05, Y, 0), v(1.05, Y + 0.45, 0), v(1.05, Y + 0.45, -0.75), v(1.05, 3.3, -0.75)], 0.03, 'yellow', 0.08, 8);
    add(g, B(0.12, 0.2, 0.12, 0.012), 'red', 1.05, Y + 0.3, 0); add(g, C(0.04, 0.16, 8), 'red', 1.05, Y + 0.48, 0);
    add(g, C(0.09, 0.06, 10, 0.012), 'galv', 1.05, 3.36, -0.75);
    boxBetween(g, v(1.05, DK, -0.92), v(1.05, 2.3, -0.92), 0.06, 0.06, 'galv');
    for (const yy of [1.2, 2.2]) add(g, B(0.1, 0.03, 0.2, 0.004), 'galv', 1.05, yy, -0.84);
    // supports
    for (const [x, z, rad] of [[-2.45, 0, r], [-1.45, 0, r], [1.45, 0, r], [2.5, 0, r], [-0.3, 0.55, rr], [0.65, 0.55, rr], [-0.3, -0.55, rr], [0.65, -0.55, rr]]) {
      add(g, B(0.08, Y - rad - DK - 0.02, 0.08, 0.006), 'galv', x - 0.14, DK + (Y - rad - DK - 0.02) / 2, z);
      add(g, B(0.1, 0.02, 0.26, 0.004), 'galv', x - 0.14, Y - rad - 0.01, z); add(g, B(0.18, 0.012, 0.18, 0), 'galv', x - 0.14, DK + 0.006, z);
      const ub = mesh(memo(_geo, 'ub' + f3(rad), () => new THREE.TorusGeometry(rad + 0.008, 0.007, 5, 10, Math.PI)), 'galv', x - 0.14, Y - 0.005, z); ub.rotation.y = Math.PI / 2; g.add(ub);
    }
    // RTU cabinet on a stand with solar panel and antenna
    const cx = 2.3, cz = -0.88;
    for (const s of [-1, 1]) add(g, B(0.05, 1.9, 0.05, 0.005), 'galv', cx + s * 0.28, DK + 0.95, cz);
    add(g, B(0.62, 0.8, 0.24, 0.012), 'grey70', cx, 1.45, cz + 0.14); add(g, B(0.56, 0.74, 0.015, 0.006), 'grey70', cx, 1.45, cz + 0.265);
    add(g, B(0.03, 0.14, 0.025, 0.006), 'black', cx + 0.22, 1.45, cz + 0.28);
    add(g, B(0.68, 0.025, 0.3, 0.006), 'grey70', cx, 1.87, cz + 0.14, 0.1);
    add(g, B(0.9, 0.03, 0.6, 0.006), 'alu', cx, 2.3, cz - 0.05, -0.6); add(g, B(0.84, 0.012, 0.54, 0), 'glass', cx, 2.318, cz - 0.04, -0.6);
    tube(g, v(cx + 0.28, 2.1, cz), v(cx + 0.28, 3.0, cz), 0.012, 'galv', 6); tube(g, v(cx + 0.28, 3.0, cz), v(cx + 0.28, 3.5, cz), 0.006, 'hdpe', 5);
    pipePath(g, [v(cx, 1.05, cz + 0.14), v(cx, DK + 0.04, cz + 0.14), v(cx, DK + 0.04, 0.0), v(cx, Y - r - 0.02, 0.0)], 0.012, 'galv', 0.05, 6);
    // sign and bollards
    for (const s of [-1, 1]) add(g, B(0.04, 1.6, 0.04, 0.004), 'galv', -0.2 + s * 0.3, DK + 0.8, W / 2 - 0.1);
    add(g, B(0.72, 0.54, 0.008, 0), 'alu', -0.2, 1.72, W / 2 - 0.075);
    decal(g, SIGN.gas(), 0.7, 0.525, -0.2, 1.72, W / 2 - 0.07); decal(g, SIGN.gas(), 0.7, 0.525, -0.2, 1.72, W / 2 - 0.08, Math.PI);
    for (const x of [-4.1, 0, 4.1]) for (const z of [-1, 1]) bollardParts(g, x, z * (W / 2 + 0.55));
    for (const x of [-1, 1]) pipePath(g, [v(x * 2.6, 0.12, W / 2 + 0.005), v(x * 2.6, 0.03, W / 2 + 0.005), v(x * 2.6, 0.015, W / 2 + 0.3)], 0.008, 'copper', 0.03, 5);
    return g;
  });
}

// ---------------------------------------------------------------- runs
function offsetPolyline(pts, off) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d1 = i > 0 ? new V3().subVectors(pts[i], a).setY(0).normalize() : null, d2 = i < pts.length - 1 ? new V3().subVectors(b, pts[i]).setY(0).normalize() : null;
    const n1 = d1 ? v(d1.z, 0, -d1.x) : null, n2 = d2 ? v(d2.z, 0, -d2.x) : null;
    const n = n1 && n2 ? n1.clone().add(n2).normalize() : (n1 || n2).clone();
    const k = n1 && n2 ? 1 / Math.max(0.3, n.dot(n1)) : 1;
    out.push(pts[i].clone().addScaledVector(n, off * k));
  }
  return out;
}
export function buildCableTray({ points, height = 0.6, width = 0.45, cables = 5 } = {}) {
  return prop('tray' + JSON.stringify([points, height, width, cables]), () => {
    const g = new THREE.Group(), pts = points.map(toV3).map((p) => (p.y > 0 ? p : p.setY(height)));
    const L = offsetPolyline(pts, -width / 2), R = offsetPolyline(pts, width / 2);
    for (let i = 0; i < pts.length - 1; i++) {
      for (const S of [L, R]) boxBetween(g, S[i].clone().setY(S[i].y + 0.05), S[i + 1].clone().setY(S[i + 1].y + 0.05), 0.1, 0.012, 'galv');
      const a = pts[i], b = pts[i + 1], d = new V3().subVectors(b, a), len = d.length(); d.normalize();
      const side = v(d.z, 0, -d.x).normalize(), n = Math.max(1, Math.round(len / 0.3));
      for (let k = 0; k <= n; k++) { const c = a.clone().addScaledVector(d, len * k / n); tube(g, c.clone().addScaledVector(side, -width / 2), c.clone().addScaledVector(side, width / 2), 0.011, 'galv', 4); }
      const ns = Math.max(1, Math.round(len / 2.6));
      for (let k = 0; k <= ns; k++) {
        if (k === 0 && i > 0) continue;
        const c = a.clone().addScaledVector(d, len * k / ns), hw = width / 2 + 0.06;
        for (const s of [-1, 1]) { const q = c.clone().addScaledVector(side, s * hw); boxBetween(g, v(q.x, 0.08, q.z), v(q.x, c.y + 0.1, q.z), 0.045, 0.045, 'galv'); const ft = add(g, B(0.3, 0.1, 0.3, 0.015), 'concrete', q.x, 0.05, q.z); ft.rotation.y = Math.atan2(-d.z, d.x); }
        boxBetween(g, c.clone().addScaledVector(side, -hw - 0.03).setY(c.y - 0.025), c.clone().addScaledVector(side, hw + 0.03).setY(c.y - 0.025), 0.045, 0.045, 'galv');
      }
    }
    const cr = Math.min(0.032, (width - 0.08) / cables / 2);
    for (let c = 0; c < cables; c++) {
      const off = -width / 2 + 0.05 + cr + c * ((width - 0.1 - 2 * cr) / Math.max(1, cables - 1));
      pipePath(g, offsetPolyline(pts, off).map((p) => p.setY(p.y + 0.012 + cr)), cr, c === 1 ? 'orange' : 'cable', 0.25, 6);
    }
    return g;
  });
}
export function buildPipeRun({ points, radius = 0.084, color = 0xe2ac12, height = 0.45, ends = 'down' } = {}) {
  return prop('pipe' + JSON.stringify([points, radius, color, height, ends]), () => {
    const g = new THREE.Group(), m = paintColor(color), pts = points.map(toV3).map((p) => (p.y > 0 ? p : p.setY(height)));
    const path = pts.map((p) => p.clone()), n = pts.length;
    if (ends === 'down') { path.unshift(v(pts[0].x, -0.1, pts[0].z)); path.push(v(pts[n - 1].x, -0.1, pts[n - 1].z)); }
    pipePath(g, path, radius, m, Math.min(radius * 3, pts[0].y * 0.6), 10);
    if (ends === 'down') for (const p of [pts[0], pts[n - 1]]) { flange(g, v(p.x, p.y * 0.42, p.z), UP, radius, m); add(g, C(radius * 2.4, 0.05, 12), 'concrete', p.x, 0.025, p.z); }
    for (let i = 0; i < n - 1; i++) {
      const a = pts[i], b = pts[i + 1], d = new V3().subVectors(b, a), len = d.length(); d.normalize();
      const ns = Math.max(1, Math.round(len / 3.2)), yaw = Math.atan2(-d.z, d.x);
      for (let k = 0; k < ns; k++) {
        const c = a.clone().addScaledVector(d, len * (k + 0.5) / ns), top = c.y - radius;
        const s = new THREE.Group(); s.position.set(c.x, 0, c.z); s.rotation.y = yaw;
        add(s, B(0.3, 0.08, 0.3, 0.015), 'concrete', 0, 0.04, 0);
        if (top > 0.12) add(s, B(0.07, top - 0.1, 0.07, 0.005), 'galv', 0, 0.08 + (top - 0.1) / 2, 0);
        add(s, B(0.08, 0.02, radius * 2 + 0.1, 0.004), 'galv', 0, top - 0.01, 0);
        const ub = mesh(memo(_geo, 'ub' + f3(radius), () => new THREE.TorusGeometry(radius + 0.008, 0.007, 5, 10, Math.PI)), 'galv', 0, c.y - 0.005, 0); ub.rotation.y = Math.PI / 2; s.add(ub);
        g.add(s);
      }
      if (len > 9) flange(g, a.clone().addScaledVector(d, len * 0.5 + 0.4), d, radius, m);
    }
    return g;
  });
}

// ---------------------------------------------------------------- fence
function gateLeaf(g, hinge, dir, gw, h) {
  const leaf = new THREE.Group(); leaf.position.copy(hinge); leaf.rotation.y = Math.atan2(-dir.z, dir.x);
  const R = 0.024, x0 = 0.07, x1 = gw, y0 = 0.1, y1 = h - 0.04;
  tube(leaf, v(x0, y0, 0), v(x1, y0, 0), R, 'galv'); tube(leaf, v(x0, y1, 0), v(x1, y1, 0), R, 'galv');
  tube(leaf, v(x0, y0, 0), v(x0, y1 + 0.32, 0), R, 'galv'); tube(leaf, v(x1, y0, 0), v(x1, y1 + 0.32, 0), R, 'galv');
  tube(leaf, v((x0 + x1) / 2, y0, 0), v((x0 + x1) / 2, y1, 0), 0.019, 'galv');
  tube(leaf, v(x0, y0, 0), v(x1, y1, 0), 0.012, 'galv', 6);
  const q = mesh(quadGeo(v(x0, y0, 0), v(x1, y0, 0), v(x1, y1, 0), v(x0, y1, 0), (x1 - x0) / 0.4, (y1 - y0) / 0.4), 'chainlink'); q.castShadow = false; leaf.add(q);
  const bq = mesh(quadGeo(v(x0, y1, 0), v(x1, y1, 0), v(x1, y1 + 0.3, 0), v(x0, y1 + 0.3, 0), (x1 - x0) / 0.5, 1), 'barbed'); bq.castShadow = false; leaf.add(bq);
  for (const yy of [0.5, h - 0.5]) add(leaf, B(0.09, 0.07, 0.05, 0.008), 'galv', 0.03, yy, 0);
  add(leaf, B(0.05, 0.1, 0.08, 0.008), 'galv', x1 + 0.01, 1.05, 0);
  add(leaf, C(0.06, 0.04, 10), 'rubber', x1 - 0.1, 0.045, 0, Math.PI / 2);
  g.add(leaf);
}
export function buildFence({ points, height = 2.4, gates = [] } = {}) {
  return prop('fence' + JSON.stringify([points, height, gates]), () => {
    const g = new THREE.Group(), pts = points.map(toV3).map((p) => p.setY(0)), cen = new V3();
    pts.forEach((p) => cen.add(p)); cen.multiplyScalar(1 / pts.length);
    const placed = new Set();
    const post = (p, r, n, extra = 0) => {
      const key = Math.round(p.x * 20) + '_' + Math.round(p.z * 20);
      if (!placed.has(key)) {
        placed.add(key);
        tube(g, v(p.x, 0, p.z), v(p.x, height + 0.04 + extra, p.z), r, 'galv', 8);
        add(g, C(r * 1.15, 0.03, 8, r * 0.3), 'galv', p.x, height + 0.055 + extra, p.z);
        add(g, C(r * 2.6, 0.05, 10), 'concrete', p.x, 0.025, p.z);
      }
      tube(g, v(p.x, height, p.z), v(p.x + n.x * 0.26, height + 0.26, p.z + n.z * 0.26), 0.014, 'galv', 5);
    };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], d = new V3().subVectors(b, a), len = d.length(); d.normalize();
      const n = v(d.z, 0, -d.x), mid = a.clone().add(b).multiplyScalar(0.5);
      if (n.dot(mid.clone().sub(cen)) < 0) n.negate();
      const gaps = gates.filter((q) => (q.segment || 0) === i).map((q) => { const c = (q.t === undefined ? 0.5 : q.t) * len, hw = (q.width || 6) / 2; return { s0: c - hw, s1: c + hw, open: q.open || 0 }; }).sort((p, q) => p.s0 - q.s0);
      const spans = []; let s = 0;
      for (const q of gaps) { if (q.s0 > s + 0.1) spans.push([s, q.s0]); s = q.s1; }
      if (len > s + 0.1) spans.push([s, len]);
      const at = (t, y = 0) => a.clone().addScaledVector(d, t).setY(y);
      for (const [s0, s1] of spans) {
        const np = Math.max(1, Math.ceil((s1 - s0) / 3.05));
        for (let k = 0; k <= np; k++) post(at(s0 + k * (s1 - s0) / np), k === 0 || k === np ? 0.045 : 0.03, n);
        tube(g, at(s0, height - 0.03), at(s1, height - 0.03), 0.021, 'galv', 6);
        tube(g, at(s0, 0.07), at(s1, 0.07), 0.006, 'galv', 4);
        const q = mesh(quadGeo(at(s0, 0.04), at(s1, 0.04), at(s1, height - 0.02), at(s0, height - 0.02), (s1 - s0) / 0.4, (height - 0.06) / 0.4), 'chainlink'); q.castShadow = false; g.add(q);
        const o = n.clone().multiplyScalar(0.25);
        const bq = mesh(quadGeo(at(s0, height), at(s1, height), at(s1, height + 0.25).add(o), at(s0, height + 0.25).add(o), (s1 - s0) / 0.5, 1), 'barbed'); bq.castShadow = false; g.add(bq);
      }
      for (const q of gaps) {
        const gw = (q.s1 - q.s0) / 2 - 0.04, phi = q.open * 1.75, inw = n.clone().negate();
        for (const t of [q.s0, q.s1]) { const p = at(t); tube(g, p, v(p.x, height + 0.4, p.z), 0.06, 'galv', 10); add(g, C(0.07, 0.03, 10, 0.02), 'galv', p.x, height + 0.415, p.z); add(g, C(0.2, 0.06, 12), 'concrete', p.x, 0.03, p.z); }
        gateLeaf(g, at(q.s0), d.clone().multiplyScalar(Math.cos(phi)).addScaledVector(inw, Math.sin(phi)), gw, height);
        gateLeaf(g, at(q.s1), d.clone().multiplyScalar(-Math.cos(phi)).addScaledVector(inw, Math.sin(phi)), gw, height);
        const sp = at(q.s0 - 1.2, 1.5).addScaledVector(n, 0.03), sg = decal(g, SIGN.auth(), 0.6, 0.45, sp.x, sp.y, sp.z, Math.atan2(n.x, n.z));
        const sp2 = at(q.s1 + 1.2, 1.5).addScaledVector(n, 0.03); decal(g, SIGN.hv(), 0.6, 0.45, sp2.x, sp2.y, sp2.z, sg.rotation.y);
      }
    }
    return g;
  });
}

// ---------------------------------------------------------------- small props
export function buildBollard() { return prop('bollard', () => { const g = new THREE.Group(); bollardParts(g, 0, 0); return g; }); }

export function buildLightPole({ height = 9 } = {}) {
  return prop('pole' + height, () => {
    const g = new THREE.Group(), H = height;
    add(g, C(0.3, 0.7, 16), 'concrete', 0, 0.35, 0);
    add(g, B(0.34, 0.025, 0.34, 0.006), 'galv', 0, 0.715, 0);
    for (const x of [-1, 1]) for (const z of [-1, 1]) { add(g, C(0.016, 0.09, 6), 'galv', x * 0.13, 0.75, z * 0.13); add(g, C(0.026, 0.02, 6), 'galv', x * 0.13, 0.74, z * 0.13); }
    add(g, C(0.1, H - 0.73, 12, 0.058), 'galv', 0, 0.73 + (H - 0.73) / 2, 0);
    add(g, B(0.09, 0.16, 0.012, 0.004), 'galv', 0, 1.3, 0.094);
    add(g, C(0.07, 0.12, 12), 'galv', 0, H - 0.06, 0);
    tube(g, v(0, H - 0.08, -0.55), v(0, H - 0.08, 0.55), 0.03, 'galv');
    for (const z of [-0.4, 0.4]) {
      const h = new THREE.Group(); h.position.set(0.06, H - 0.1, z); h.rotation.z = -0.6;
      add(h, B(0.05, 0.14, 0.06, 0.006), 'galv', 0, 0.0, 0);
      add(h, B(0.44, 0.07, 0.34, 0.014), 'dark', 0.24, -0.06, 0);
      for (let i = 0; i < 9; i++) add(h, B(0.4, 0.035, 0.006, 0), 'dark', 0.24, -0.01, -0.14 + i * 0.035);
      add(h, B(0.38, 0.012, 0.28, 0), 'lens', 0.24, -0.098, 0);
      g.add(h);
    }
    g.userData.extra = () => ({
      light: v(0.25, H - 0.3, 0), lightDir: v(0.56, -0.83, 0).normalize(),
      lights: [v(0.25, H - 0.3, -0.4), v(0.25, H - 0.3, 0.4)], lensMaterial: M('lens'),
    });
    return g;
  });
}

export function buildUreaTank() {
  return prop('urea', () => {
    const g = new THREE.Group(), BW = 1.7, BD = 1.5, BH = 0.42;
    for (const z of [-1, 1]) add(g, B(BW, BH, 0.06, 0.015), 'yellow', 0, BH / 2, z * (BD / 2 - 0.03));
    for (const x of [-1, 1]) add(g, B(0.06, BH, BD, 0.015), 'yellow', x * (BW / 2 - 0.03), BH / 2, 0);
    for (const x of [-0.45, 0.45]) add(g, B(0.3, 0.1, 0.01, 0), 'black', x, 0.07, BD / 2 + 0.001);
    add(g, B(BW - 0.1, 0.03, BD - 0.1, 0), 'grating', 0, BH - 0.03, 0);
    const y0 = BH - 0.01, ox = -0.2, TWd = 1.2, TDp = 1.0, TH = 1.0;
    for (const x of [-0.5, 0, 0.5]) add(g, B(0.12, 0.1, TDp, 0.006), 'galv', ox + x, y0 + 0.05, 0);
    add(g, B(TWd, 0.03, TDp, 0.006), 'galv', ox, y0 + 0.115, 0);
    const by = y0 + 0.13;
    add(g, B(TWd - 0.06, TH - 0.04, TDp - 0.06, 0.07, 2), 'hdpe', ox, by + TH / 2, 0);
    add(g, B(TWd - 0.055, (TH - 0.04) * 0.62, TDp - 0.055, 0.07, 2), memo(_mat, 'defLiquid', () => new THREE.MeshStandardMaterial({ color: 0xc3d3de, roughness: 0.3 })), ox, by + 0.02 + (TH - 0.04) * 0.31, 0);
    const hxx = TWd / 2, hzz = TDp / 2, R = 0.011;
    for (let i = 0; i < 6; i++) {
      const y = by + 0.04 + i * (TH - 0.06) / 5;
      tube(g, v(ox - hxx, y, hzz), v(ox + hxx, y, hzz), R, 'galv', 5); tube(g, v(ox - hxx, y, -hzz), v(ox + hxx, y, -hzz), R, 'galv', 5);
      tube(g, v(ox - hxx, y, -hzz), v(ox - hxx, y, hzz), R, 'galv', 5); tube(g, v(ox + hxx, y, -hzz), v(ox + hxx, y, hzz), R, 'galv', 5);
    }
    for (let i = 0; i <= 8; i++) { const x = ox - hxx + i * TWd / 8; for (const z of [-1, 1]) tube(g, v(x, by, z * (hzz + 0.012)), v(x, by + TH, z * (hzz + 0.012)), R, 'galv', 5); }
    for (let i = 1; i < 7; i++) { const z = -hzz + i * TDp / 7; for (const x of [-1, 1]) tube(g, v(ox + x * (hxx + 0.012), by, z), v(ox + x * (hxx + 0.012), by + TH, z), R, 'galv', 5); }
    for (const z of [-0.2, 0.2]) add(g, B(TWd + 0.02, 0.02, 0.05, 0.004), 'galv', ox, by + TH + 0.0, z);
    add(g, C(0.115, 0.05, 16), 'blue', ox, by + TH + 0.01, 0);
    add(g, B(0.4, 0.3, 0.004, 0), 'alu', ox - 0.2, by + 0.6, hzz + 0.026); decal(g, SIGN.def(), 0.38, 0.285, ox - 0.2, by + 0.6, hzz + 0.03);
    add(g, C(0.03, 0.1, 8), 'hdpe', ox + 0.3, by + 0.08, hzz + 0.04, Math.PI / 2); add(g, B(0.1, 0.02, 0.03, 0.004), 'blue', ox + 0.3, by + 0.13, hzz + 0.08);
    // dosing pump cabinet and hose
    const px = BW / 2 - 0.3;
    add(g, B(0.05, 1.0, 0.05, 0.004), 'galv', px, y0 + 0.5, -0.3);
    add(g, B(0.36, 0.5, 0.28, 0.012), 'grey70', px, y0 + 0.95, -0.3); add(g, B(0.3, 0.44, 0.012, 0.006), 'grey70', px, y0 + 0.95, -0.155);
    add(g, B(0.025, 0.1, 0.02, 0.004), 'black', px + 0.1, y0 + 0.95, -0.145);
    pipePath(g, [v(ox + 0.3, by + 0.08, hzz + 0.09), v(ox + 0.3, by + 0.08, hzz + 0.16), v(px, by + 0.08, hzz + 0.16), v(px, by + 0.08, -0.1), v(px, y0 + 0.7, -0.1)], 0.014, 'rubber', 0.07, 6);
    pipePath(g, [v(px, y0 + 1.2, -0.3), v(px, y0 + 1.4, -0.3), v(BW / 2 + 0.25, y0 + 1.4, -0.3), v(BW / 2 + 0.25, -0.05, -0.3)], 0.013, 'steel', 0.06, 6);
    return g;
  });
}

export function buildControlTrailer() {
  return prop('ctl', () => {
    const g = new THREE.Group(), L = 6.1, W = 2.5, H = 2.55, F = 0.72, hx = L / 2, hz = W / 2;
    // chassis, tongue, jack, axles
    for (const z of [-0.75, 0.75]) add(g, B(L, 0.18, 0.08, 0.008), 'dark', 0, F - 0.11, z);
    for (let i = 0; i < 6; i++) add(g, B(0.06, 0.12, W - 0.1, 0), 'dark', -hx + 0.3 + i * (L - 0.6) / 5, F - 0.08, 0);
    for (const s of [-1, 1]) boxBetween(g, v(-hx + 0.3, F - 0.12, s * 0.75), v(-hx - 1.25, F - 0.12, 0), 0.1, 0.08, 'dark');
    add(g, B(0.22, 0.1, 0.12, 0.02), 'dark', -hx - 1.32, F - 0.1, 0); add(g, sphereGeo(0.05, 8, 6), 'steel', -hx - 1.4, F - 0.17, 0);
    tube(g, v(-hx - 0.95, F + 0.25, 0), v(-hx - 0.95, 0.06, 0), 0.03, 'galv'); add(g, B(0.18, 0.02, 0.18, 0.004), 'galv', -hx - 0.95, 0.05, 0);
    add(g, B(0.16, 0.03, 0.03, 0.01), 'dark', -hx - 0.95, F + 0.25, 0.06);
    add(g, B(0.16, 0.1, 0.16, 0.01), 'concrete', -hx - 0.95, 0.02, 0);
    for (const x of [0.55, 1.4]) {
      tube(g, v(x, 0.37, -hz + 0.12), v(x, 0.37, hz - 0.12), 0.04, 'dark');
      for (const s of [-1, 1]) {
        add(g, C(0.37, 0.22, 20), 'tire', x, 0.37, s * (hz - 0.14), Math.PI / 2);
        add(g, C(0.2, 0.225, 14), 'white', x, 0.37, s * (hz - 0.14), Math.PI / 2);
        add(g, C(0.07, 0.25, 8), 'galv', x, 0.37, s * (hz - 0.14), Math.PI / 2);
      }
    }
    for (const s of [-1, 1]) add(g, B(1.9, 0.03, 0.3, 0.01), 'dark', 0.975, 0.8 - 0.03, s * (hz - 0.14));
    for (const x of [-1, 1]) for (const z of [-1, 1]) { tube(g, v(x * (hx - 0.25), F - 0.15, z * 0.9), v(x * (hx - 0.25), 0.1, z * 0.9), 0.025, 'galv'); add(g, B(0.25, 0.1, 0.25, 0.012), 'concrete', x * (hx - 0.25), 0.05, z * 0.9); }
    // body
    const wl = corrugGeo(L - 0.06, H, 0.2, 0.012, 'rib'), we = corrugGeo(W - 0.06, H, 0.2, 0.012, 'rib');
    add(g, wl, 'beigeDS', 0, F, hz - 0.02); add(g, wl, 'beigeDS', 0, F, -hz + 0.02, 0, Math.PI);
    add(g, we, 'beigeDS', hx - 0.02, F, 0, 0, Math.PI / 2); add(g, we, 'beigeDS', -hx + 0.02, F, 0, 0, -Math.PI / 2);
    for (const x of [-1, 1]) for (const z of [-1, 1]) add(g, B(0.07, H, 0.07, 0.01), 'white', x * (hx - 0.015), F + H / 2, z * (hz - 0.015));
    add(g, B(L + 0.02, 0.12, W + 0.02, 0.01), 'dark', 0, F + 0.02, 0);
    add(g, B(L + 0.12, 0.1, W + 0.12, 0.02), 'white', 0, F + H + 0.03, 0);
    add(g, B(L - 0.3, 0.05, W - 0.3, 0.02), 'white', 0, F + H + 0.09, 0);
    // door, steps
    const dx = -1.7;
    manDoor(g, dx, F + 0.1, hz - 0.01, 0, { w: 0.9, h: 2.0, mat: 'white', window: true });
    decal(g, SIGN.ctl(), 0.5, 0.375, dx + 0.95, F + 1.6, hz + 0.0);
    const sw = 1.1, top = F + 0.08;
    add(g, B(sw, 0.035, 0.8, 0), 'grating', dx, top - 0.018, hz + 0.42);
    for (let i = 1; i < 4; i++) add(g, B(sw - 0.06, 0.03, 0.26, 0), 'grating', dx, top - i * 0.2, hz + 0.8 + (i - 0.5) * 0.27);
    for (const s of [-1, 1]) {
      const x = dx + s * sw / 2;
      boxBetween(g, v(x, top - 0.08, hz + 0.8), v(x, 0.04, hz + 0.8 + 3.5 * 0.27), 0.18, 0.012, 'alu');
      add(g, B(0.012, 0.1, 0.8, 0), 'alu', x, top - 0.06, hz + 0.42);
      for (const zz of [hz + 0.06, hz + 0.78]) tube(g, v(x, 0.02, zz), v(x, top + 1.0, zz), 0.019, 'alu', 6);
      tube(g, v(x, 0.04, hz + 0.8 + 3.3 * 0.27), v(x, 1.0, hz + 0.8 + 3.3 * 0.27), 0.019, 'alu', 6);
      for (const hh of [1.0, 0.5]) { tube(g, v(x, top + hh, hz + 0.06), v(x, top + hh, hz + 0.78), 0.019, 'alu', 6); tube(g, v(x, top + hh, hz + 0.78), v(x, hh, hz + 0.8 + 3.3 * 0.27), 0.019, 'alu', 6); }
    }
    // windows
    const win = (x, z, ry, w = 1.2, h = 0.9) => {
      const q = new THREE.Group(); q.position.set(x, F + 1.5, z); q.rotation.y = ry;
      add(q, B(w + 0.1, h + 0.1, 0.05, 0.01), 'alu', 0, 0, 0); add(q, B(w, h, 0.02, 0), 'glass', 0, 0, 0.02);
      add(q, B(0.035, h, 0.03, 0.004), 'alu', 0, 0, 0.022); add(q, B(w + 0.16, 0.025, 0.08, 0.004), 'alu', 0, -h / 2 - 0.05, 0.03);
      g.add(q);
    };
    win(0.9, hz + 0.0, 0); win(-0.3, -hz - 0.0, Math.PI); win(1.8, -hz - 0.0, Math.PI, 0.9, 0.9);
    // AC on the +X end, electrical service
    hvacUnit(g, hx - 0.0, F + 0.3, 0.0, Math.PI / 2, 0.8);
    add(g, B(0.3, 0.45, 0.14, 0.012), 'grey70', 2.3, F + 1.35, hz + 0.06); add(g, B(0.03, 0.1, 0.03, 0.006), 'black', 2.4, F + 1.35, hz + 0.14);
    add(g, B(0.22, 0.3, 0.12, 0.012), 'grey70', 2.65, F + 1.4, hz + 0.05); add(g, C(0.07, 0.03, 14), 'glass', 2.65, F + 1.45, hz + 0.115, Math.PI / 2);
    tube(g, v(2.3, F + 1.12, hz + 0.06), v(2.3, 0, hz + 0.06), 0.02, 'galv', 6); tube(g, v(2.65, F + 1.25, hz + 0.05), v(2.65, 0, hz + 0.05), 0.02, 'galv', 6);
    // telemetry mast at the -X/-Z corner
    const mx = -hx - 0.07, mz = -hz + 0.35, mt = F + H + 4.4;
    tube(g, v(mx, 0.1, mz), v(mx, F + H + 1.6, mz), 0.03, 'galv'); tube(g, v(mx, F + H + 1.4, mz), v(mx, mt, mz), 0.022, 'galv');
    add(g, B(0.2, 0.1, 0.2, 0.012), 'concrete', mx, 0.05, mz);
    for (const yy of [F + 0.6, F + H - 0.3]) add(g, B(0.12, 0.05, 0.1, 0.006), 'galv', mx + 0.03, yy, mz);
    tube(g, v(mx, mt - 0.1, mz), v(mx, mt + 1.3, mz), 0.011, 'hdpe', 6);
    tube(g, v(mx, mt - 0.6, mz - 0.1), v(mx, mt - 0.6, mz + 0.9), 0.012, 'alu', 6);
    for (let i = 0; i < 6; i++) tube(g, v(mx - 0.28 + i * 0.012, mt - 0.6, mz + 0.05 + i * 0.16), v(mx + 0.28 - i * 0.012, mt - 0.6, mz + 0.05 + i * 0.16), 0.005, 'alu', 4);
    add(g, B(0.12, 0.45, 0.06, 0.012), 'hdpe', mx - 0.06, mt - 1.3, mz);
    tube(g, v(mx + 0.035, mt - 1.2, mz), v(mx + 0.035, F + H + 0.1, mz), 0.006, 'cable', 4);
    const dish = mesh(memo(_geo, 'dish', () => new THREE.SphereGeometry(0.6, 16, 4, 0, Math.PI * 2, 0, 0.5)), memo(_mat, 'dish', () => new THREE.MeshStandardMaterial({ color: 0xe6e8e8, roughness: 0.5, side: THREE.DoubleSide })), 2.2, F + H + 1.05, -0.5);
    dish.rotation.set(Math.PI - 1.15, 0.5, 0, 'YXZ'); g.add(dish);
    tube(g, v(2.2, F + H + 0.1, -0.5), v(2.2, F + H + 0.55, -0.5), 0.02, 'galv', 6); add(g, B(0.3, 0.03, 0.3, 0.006), 'galv', 2.2, F + H + 0.125, -0.5);
    return g;
  });
}

// ---------------------------------------------------------------- pads
export function buildPad({ w = 10, d = 6, kind = 'concrete' } = {}) {
  const p = prop(`pad_${kind}_${w}_${d}`, () => {
    const g = new THREE.Group(), r = rng(Math.round(w * 131 + d * 17) + (kind === 'gravel' ? 5 : 0));
    if (kind === 'gravel') {
      const T0 = 0.08, geo = new THREE.BoxGeometry(w, T0, d, Math.max(1, Math.round(w / 3)), 1, Math.max(1, Math.round(d / 3))), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (pos.getY(i) < 0) { pos.setX(i, pos.getX(i) + Math.sign(pos.getX(i)) * 0.3 * (Math.abs(pos.getX(i)) > w / 2 - 0.01 ? 1 : 0)); pos.setZ(i, pos.getZ(i) + Math.sign(pos.getZ(i)) * 0.3 * (Math.abs(pos.getZ(i)) > d / 2 - 0.01 ? 1 : 0)); }
        else pos.setY(i, pos.getY(i) + (r() - 0.5) * 0.012);
      }
      geo.computeVertexNormals();
      const m = mesh(geo, 'gravel', 0, T0 / 2, 0); m.castShadow = false; g.add(m);
      // graded windrow along the edges
      for (const z of [-1, 1]) { const e = add(g, C(0.22, w - 0.2, 7), 'gravel', 0, T0 - 0.01, z * (d / 2 - 0.2), 0, 0, Math.PI / 2); e.scale.set(0.25, 1, 1); e.castShadow = false; }
      for (const x of [-1, 1]) { const e = add(g, C(0.22, d - 0.2, 7), 'gravel', x * (w / 2 - 0.2), T0 - 0.01, 0, Math.PI / 2); e.scale.set(1, 1, 0.25); e.castShadow = false; }
      for (let i = 0; i < Math.round(w * d / 90); i++) { const s = decal(g, 'tracks', 2.2, Math.min(d, w) * (0.5 + r() * 0.4), (r() - 0.5) * (w - 3), T0 + 0.012, (r() - 0.5) * (d - 3), r() < 0.5 ? 0 : Math.PI / 2, -Math.PI / 2); s.material = M('tracks'); }
      g.userData.extra = () => ({ topY: T0, padKind: kind });
    } else {
      const T0 = 0.14, nx = THREE.MathUtils.clamp(Math.round(w / 3.6), 1, 16), nz = THREE.MathUtils.clamp(Math.round(d / 3.6), 1, 16), pw = w / nx, pd = d / nz;
      const base = add(g, B(w - 0.02, T0 - 0.02, d - 0.02, 0), 'joint', 0, (T0 - 0.02) / 2, 0); base.castShadow = false;
      const geo = B(pw - 0.02, T0, pd - 0.02, 0.014);
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) { const s = add(g, geo, 'concrete', -w / 2 + (i + 0.5) * pw, T0 / 2 + (r() - 0.5) * 0.003, -d / 2 + (k + 0.5) * pd); s.castShadow = false; }
      for (let i = 0; i < Math.max(2, Math.round(w * d / 22)); i++) { const sz = 0.8 + r() * 2.2, s = decal(g, 'stain', sz, sz * (0.6 + r() * 0.6), (r() - 0.5) * (w - 2), T0 + 0.004, (r() - 0.5) * (d - 2), r() * 6.28, -Math.PI / 2); s.material = M('stain'); }
      g.userData.extra = () => ({ topY: T0, padKind: kind });
    }
    return g;
  });
  return p;
}
