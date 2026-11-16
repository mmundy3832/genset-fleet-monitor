// Buildings and site context for the 3D twin. Procedural geometry and textures only.
// Builders: buildHospital, buildDataCenter, buildWellPad, buildTestCell, buildGround.
// Conventions: meters, Y up, origin at footprint center on grade, long axis X, front/service side +Z.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V3 = THREE.Vector3;
const PI = Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- noise

function noiseField(size, cells, seed) {
  const r = rng(seed);
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, y0 = Math.floor(fy), y1 = (y0 + 1) % cells;
    let ty = fy - y0; ty = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, x0 = Math.floor(fx), x1 = (x0 + 1) % cells;
      let tx = fx - x0; tx = tx * tx * (3 - 2 * tx);
      const a = g[y0 * cells + x0], b = g[y0 * cells + x1], c = g[y1 * cells + x0], d = g[y1 * cells + x1];
      out[y * size + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

// Tileable fbm in 0..1.
function fbm(size, cells, octaves, seed) {
  const out = new Float32Array(size * size);
  let amp = 1, tot = 0, c = cells;
  for (let o = 0; o < octaves && c <= size / 2; o++) {
    const f = noiseField(size, c, seed + o * 17);
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
    tot += amp; amp *= 0.5; c *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  let tx = x - x0, tz = z - z0; tx = tx * tx * (3 - 2 * tx); tz = tz * tz * (3 - 2 * tz);
  return lerp(lerp(hash2(x0, z0), hash2(x0 + 1, z0), tx), lerp(hash2(x0, z0 + 1), hash2(x0 + 1, z0 + 1), tx), tz);
}

// ---------------------------------------------------------------- canvas helpers

function mk(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}
function fill(x, w, h, col) { x.fillStyle = col; x.fillRect(0, 0, w, h); }

// Multiply the canvas by 1 + (field - 0.5) * 2 * amt, plus per-pixel grain.
function grain(x, size, seed, amt, cells = 6, oct = 5, fine = 0.04) {
  const f = fbm(size, cells, oct, seed);
  const id = x.getImageData(0, 0, size, size), d = id.data, r = rng(seed + 99);
  for (let i = 0; i < f.length; i++) {
    const kk = 1 + (f[i] - 0.5) * 2 * amt + (r() - 0.5) * 2 * fine;
    d[i * 4] *= kk; d[i * 4 + 1] *= kk; d[i * 4 + 2] *= kk;
  }
  x.putImageData(id, 0, 0);
}
function speckle(x, size, seed, n, cols, r0, r1, alpha = 1) {
  const r = rng(seed);
  x.globalAlpha = alpha;
  for (let i = 0; i < n; i++) {
    x.fillStyle = cols[(r() * cols.length) | 0];
    const s = r0 + r() * (r1 - r0);
    x.fillRect(r() * size, r() * size, s, s);
  }
  x.globalAlpha = 1;
}
function streaks(x, size, seed, n, col, maxLen, wMax = 6) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const px = r() * size, len = (0.2 + r() * 0.8) * maxLen, w = 1 + r() * wMax, y0 = r() < 0.7 ? 0 : r() * size * 0.5;
    const g = x.createLinearGradient(0, y0, 0, y0 + len);
    g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(px, y0, w, len);
  }
}
function wrapTex(c, tx, ty, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tx, 1 / ty);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function normalFrom(c, strength, tx, ty) {
  const w = c.width, h = c.height, src = c.getContext('2d').getImageData(0, 0, w, h).data;
  const [o, ox] = mk(w, h);
  const out = ox.createImageData(w, h), d = out.data;
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = ((H(x + 1, y) - H(x - 1, y)) / 255) * strength, dy = ((H(x, y + 1) - H(x, y - 1)) / 255) * strength;
    const inv = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    d[i] = (-dx * inv * 0.5 + 0.5) * 255; d[i + 1] = (dy * inv * 0.5 + 0.5) * 255; d[i + 2] = (inv * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  ox.putImageData(out, 0, 0);
  return wrapTex(o, tx, ty, false);
}
// Greyscale height canvas of pure noise, used for subtle surface normals.
function noiseHeight(size, seed, cells = 32, oct = 3) {
  const [c, x] = mk(size);
  const f = fbm(size, cells, oct, seed), id = x.createImageData(size, size), d = id.data;
  for (let i = 0; i < f.length; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = f[i] * 255; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  return c;
}

// ---------------------------------------------------------------- textures (lazy, module cache)

const TEX = {};
const T = (name) => TEX[name] || (TEX[name] = TEXDEF[name]());

const TEXDEF = {
  precast() {
    const S = 512, [c, x] = mk(S);
    fill(x, S, S, '#bfb5a0');
    speckle(x, S, 3, 9000, ['#bdb5a4', '#e2dccf', '#a9a294', '#c9c0ae'], 1, 2.5, 0.5);
    streaks(x, S, 4, 26, 'rgba(92,84,70,0.16)', S * 0.7, 9);
    grain(x, S, 5, 0.1, 4, 5, 0.03);
    return { map: wrapTex(c, 6, 6), normalMap: normalFrom(noiseHeight(256, 6, 48, 2), 1.2, 1.5, 1.5) };
  },
  brick() {
    const S = 512, [c, x] = mk(S), [hc, hx] = mk(S), r = rng(8);
    fill(x, S, S, '#c9bfae'); fill(hx, S, S, '#000');
    const bw = S / 10, bh = S / 20;
    const cols = ['#b39270', '#a98764', '#bc9c7a', '#9f7d5d', '#c2a585', '#8f6f55', '#b08d6a'];
    for (let j = 0; j < 20; j++) for (let i = -1; i < 10; i++) {
      const px = i * bw + (j % 2) * bw * 0.5, py = j * bh;
      x.fillStyle = cols[(r() * cols.length) | 0];
      x.fillRect(px + 1.5, py + 1.5, bw - 3, bh - 3);
      const v = 150 + r() * 100;
      hx.fillStyle = `rgb(${v},${v},${v})`;
      hx.fillRect(px + 2, py + 2, bw - 4, bh - 4);
    }
    grain(x, S, 9, 0.12, 5, 5, 0.06);
    return { map: wrapTex(c, 2.1, 1.5), normalMap: normalFrom(hc, 2.2, 2.1, 1.5) };
  },
  // Tilt-up concrete panel: one tile = one 7.5 m panel, full wall height (12.2 m).
  tilt() {
    const S = 512, [c, x] = mk(S), [hc, hx] = mk(S);
    fill(x, S, S, '#c6c3bb'); fill(hx, S, S, '#aaa');
    grain(x, S, 12, 0.07, 3, 5, 0.03);
    streaks(x, S, 13, 34, 'rgba(70,66,58,0.20)', S * 0.75, 7);
    streaks(x, S, 14, 10, 'rgba(120,96,70,0.14)', S * 0.5, 14);
    // painted accent band at the top
    x.fillStyle = 'rgba(74,84,94,0.92)'; x.fillRect(0, 0, S, S * 0.115);
    streaks(x, S, 15, 18, 'rgba(60,66,72,0.25)', S * 0.3, 5);
    // splash zone at grade
    const g = x.createLinearGradient(0, S * 0.9, 0, S);
    g.addColorStop(0, 'rgba(110,96,76,0)'); g.addColorStop(1, 'rgba(110,96,76,0.35)');
    x.fillStyle = g; x.fillRect(0, S * 0.9, S, S * 0.1);
    // reveals and the panel joint
    const lines = [0.115, 0.4, 0.68];
    for (const l of lines) {
      x.fillStyle = 'rgba(40,40,40,0.55)'; x.fillRect(0, S * l, S, 2);
      x.fillStyle = 'rgba(255,255,255,0.25)'; x.fillRect(0, S * l + 2, S, 1);
      hx.fillStyle = '#000'; hx.fillRect(0, S * l, S, 3);
    }
    x.fillStyle = 'rgba(30,30,30,0.7)'; x.fillRect(0, 0, 3, S);
    x.fillStyle = 'rgba(255,255,255,0.22)'; x.fillRect(3, 0, 2, S);
    hx.fillStyle = '#000'; hx.fillRect(0, 0, 4, S);
    return { map: wrapTex(c, 7.5, 12.2), normalMap: normalFrom(hc, 2.5, 7.5, 12.2) };
  },
  rib() {
    const S = 256, [c, x] = mk(S), [hc, hx] = mk(S);
    fill(x, S, S, '#f2f2f0'); fill(hx, S, S, '#000');
    const n = 4, w = S / n;
    for (let i = 0; i < n; i++) {
      const g = hx.createLinearGradient(i * w, 0, (i + 1) * w, 0);
      g.addColorStop(0, '#000'); g.addColorStop(0.1, '#fff'); g.addColorStop(0.3, '#fff'); g.addColorStop(0.4, '#000'); g.addColorStop(1, '#000');
      hx.fillStyle = g; hx.fillRect(i * w, 0, w, S);
      x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(i * w + w * 0.3, 0, w * 0.1, S);
      x.fillStyle = 'rgba(255,255,255,0.5)'; x.fillRect(i * w + w * 0.02, 0, w * 0.08, S);
    }
    streaks(x, S, 21, 14, 'rgba(60,50,40,0.12)', S, 5);
    grain(x, S, 22, 0.05, 4, 4, 0.02);
    return { map: wrapTex(c, 1.2, 4), normalMap: normalFrom(hc, 1.6, 1.2, 4) };
  },
  ribH() { // same profile, ribs horizontal (roll-up doors)
    const r = T('rib'), m = r.map.clone(), n = r.normalMap.clone();
    for (const t of [m, n]) { t.rotation = PI / 2; t.repeat.set(1 / 0.5, 1 / 4); t.needsUpdate = true; }
    return { map: m, normalMap: n };
  },
  louver() {
    const S = 128, [c, x] = mk(S), [hc, hx] = mk(S);
    const n = 8, h = S / n;
    for (let i = 0; i < n; i++) {
      const g = x.createLinearGradient(0, i * h, 0, (i + 1) * h);
      g.addColorStop(0, '#8d9296'); g.addColorStop(0.55, '#5b6064'); g.addColorStop(0.6, '#15171a'); g.addColorStop(1, '#0c0d0f');
      x.fillStyle = g; x.fillRect(0, i * h, S, h);
      const g2 = hx.createLinearGradient(0, i * h, 0, (i + 1) * h);
      g2.addColorStop(0, '#fff'); g2.addColorStop(0.6, '#555'); g2.addColorStop(0.62, '#000'); g2.addColorStop(1, '#000');
      hx.fillStyle = g2; hx.fillRect(0, i * h, S, h);
    }
    x.fillStyle = '#3a3e42'; x.fillRect(0, 0, 3, S);
    return { map: wrapTex(c, 1.5, 1.0), normalMap: normalFrom(hc, 2, 1.5, 1.0) };
  },
  asphalt() {
    const S = 512, [c, x] = mk(S), r = rng(31);
    fill(x, S, S, '#555553');
    speckle(x, S, 32, 16000, ['#626260', '#4a4a48', '#6c6c69', '#403f3e'], 1, 2, 0.6);
    for (let i = 0; i < 7; i++) { // oil stains and patches
      const px = r() * S, py = r() * S, rad = 5 + r() * 14;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(18,18,20,0.28)'); g.addColorStop(1, 'rgba(18,18,20,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    x.strokeStyle = 'rgba(20,20,21,0.45)'; x.lineWidth = 1;
    for (let i = 0; i < 7; i++) { // cracks
      let px = r() * S, py = r() * S;
      x.beginPath(); x.moveTo(px, py);
      for (let s = 0; s < 9; s++) { px += (r() - 0.5) * 36; py += (r() - 0.3) * 26; x.lineTo(px, py); }
      x.stroke();
    }
    grain(x, S, 33, 0.16, 3, 5, 0.05);
    return { map: wrapTex(c, 22, 22), normalMap: normalFrom(noiseHeight(256, 34, 64, 2), 1.5, 1.2, 1.2) };
  },
  paving() {
    const S = 256, [c, x] = mk(S), [hc, hx] = mk(S);
    fill(x, S, S, '#a8a398'); fill(hx, S, S, '#fff');
    speckle(x, S, 41, 2500, ['#a9a498', '#c8c3b8', '#9e998e'], 1, 2, 0.5);
    grain(x, S, 42, 0.08, 4, 4, 0.04);
    x.fillStyle = 'rgba(70,66,58,0.7)'; hx.fillStyle = '#000';
    for (const p of [0, S / 2]) { x.fillRect(p, 0, 2, S); x.fillRect(0, p, S, 2); hx.fillRect(p, 0, 2, S); hx.fillRect(0, p, S, 2); }
    return { map: wrapTex(c, 3, 3), normalMap: normalFrom(hc, 1.5, 3, 3) };
  },
  slab() {
    const S = 512, [c, x] = mk(S), r = rng(44);
    fill(x, S, S, '#a29e94');
    grain(x, S, 45, 0.14, 4, 5, 0.04);
    for (let i = 0; i < 10; i++) {
      const px = r() * S, py = r() * S, rad = 10 + r() * 40;
      const g = x.createRadialGradient(px, py, 0, px, py, rad);
      g.addColorStop(0, 'rgba(60,55,48,0.22)'); g.addColorStop(1, 'rgba(60,55,48,0)');
      x.fillStyle = g; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    x.fillStyle = 'rgba(60,56,50,0.75)';
    for (const p of [0, S / 2]) { x.fillRect(p, 0, 2, S); x.fillRect(0, p, S, 2); }
    return { map: wrapTex(c, 9, 9) };
  },
  roof() {
    const S = 512, [c, x] = mk(S), r = rng(51);
    fill(x, S, S, '#b7b7b0');
    const f = fbm(S, 5, 4, 52), id = x.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < f.length; i++) { // ponding dirt
      const t = sstep(0.52, 0.72, f[i]) * 0.3;
      d[i * 4] = lerp(d[i * 4], 136, t); d[i * 4 + 1] = lerp(d[i * 4 + 1], 126, t); d[i * 4 + 2] = lerp(d[i * 4 + 2], 108, t);
    }
    x.putImageData(id, 0, 0);
    for (let i = 0; i < 8; i++) { x.fillStyle = 'rgba(90,90,88,0.35)'; x.fillRect(0, (i * S) / 8, S, 1.5); x.fillStyle = 'rgba(255,255,255,0.3)'; x.fillRect(0, (i * S) / 8 + 2, S, 1); }
    for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(225,225,222,0.6)'; x.fillRect(r() * S, r() * S, 10 + r() * 24, 8 + r() * 14); } // patches
    grain(x, S, 53, 0.05, 6, 4, 0.02);
    return { map: wrapTex(c, 24, 24) };
  },
  roofGravel() {
    const S = 512, [c, x] = mk(S);
    fill(x, S, S, '#9b958a');
    speckle(x, S, 56, 22000, ['#b3ada1', '#857f74', '#a59f92', '#6f6a60', '#c0baae'], 1, 2.5, 0.7);
    grain(x, S, 57, 0.14, 4, 5, 0.05);
    return { map: wrapTex(c, 10, 10) };
  },
  caliche() {
    const S = 512, [c, x] = mk(S), r = rng(61);
    fill(x, S, S, '#bdb096');
    speckle(x, S, 62, 14000, ['#ab9f85', '#cbbfa6', '#a09379', '#b7aa90'], 1, 3, 0.5);
    x.lineWidth = 3;
    for (let i = 0; i < 16; i++) { // tire tracks
      const y0 = r() * S, a = (r() - 0.5) * 120, col = r() < 0.5 ? 'rgba(130,118,94,0.3)' : 'rgba(214,204,184,0.3)';
      for (const off of [0, 9]) {
        x.strokeStyle = col; x.beginPath(); x.moveTo(-10, y0 + off);
        x.bezierCurveTo(S * 0.3, y0 + a + off, S * 0.6, y0 - a + off, S + 10, y0 + off); x.stroke();
      }
    }
    grain(x, S, 63, 0.2, 3, 5, 0.05);
    return { map: wrapTex(c, 40, 40), normalMap: normalFrom(noiseHeight(256, 64, 40, 3), 1.2, 3, 3) };
  },
  gravel() {
    const S = 256, [c, x] = mk(S);
    fill(x, S, S, '#8f887b');
    speckle(x, S, 66, 9000, ['#7b7569', '#a59e91', '#6a655b', '#b3ada0', '#857c6c'], 1, 3, 0.8);
    grain(x, S, 67, 0.16, 3, 5, 0.05);
    return { map: wrapTex(c, 5, 5), normalMap: normalFrom(noiseHeight(256, 68, 64, 2), 2, 1, 1) };
  },
  dg() {
    const S = 256, [c, x] = mk(S);
    fill(x, S, S, '#b08f6c');
    speckle(x, S, 71, 8000, ['#9c7c5c', '#c2a280', '#8b6d50', '#cdb190'], 1, 2.5, 0.7);
    grain(x, S, 72, 0.12, 4, 4, 0.05);
    return { map: wrapTex(c, 5, 5) };
  },
  turf() {
    const S = 512, [c, x] = mk(S);
    fill(x, S, S, '#7d8a52');
    const f = fbm(S, 4, 5, 75), id = x.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < f.length; i++) {
      const t = sstep(0.4, 0.75, f[i]) * 0.55;
      d[i * 4] = lerp(d[i * 4], 158, t); d[i * 4 + 1] = lerp(d[i * 4 + 1], 146, t); d[i * 4 + 2] = lerp(d[i * 4 + 2], 92, t);
    }
    x.putImageData(id, 0, 0);
    for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? 'rgba(255,255,220,0.012)' : 'rgba(0,20,0,0.012)'; x.fillRect((i * S) / 16, 0, S / 16, S); }
    grain(x, S, 76, 0.1, 24, 3, 0.07);
    return { map: wrapTex(c, 36, 36) };
  },
  galv() {
    const S = 256, [c, x] = mk(S);
    fill(x, S, S, '#b4b9bc');
    speckle(x, S, 81, 1500, ['#a3a8ab', '#c6cacc', '#989da0'], 4, 14, 0.25);
    streaks(x, S, 82, 16, 'rgba(90,80,66,0.14)', S, 6);
    grain(x, S, 83, 0.06, 5, 4, 0.02);
    return { map: wrapTex(c, 4, 4) };
  },
  fence() {
    const S = 64, [c, x] = mk(S);
    x.clearRect(0, 0, S, S);
    x.strokeStyle = 'rgba(150,156,160,0.95)'; x.lineWidth = 2.2;
    for (let i = -1; i < 5; i++) {
      x.beginPath(); x.moveTo(i * 16, 0); x.lineTo(i * 16 + S, S); x.stroke();
      x.beginPath(); x.moveTo(i * 16 + S, 0); x.lineTo(i * 16, S); x.stroke();
    }
    return { map: wrapTex(c, 0.4, 0.4) };
  },
  glass() {
    const W = 1024, H = 512, [c, x] = mk(W, H), [e, ex] = mk(W, H), r = rng(91);
    ex.fillStyle = '#000'; ex.fillRect(0, 0, W, H);
    for (let row = 0; row < 8; row++) for (let col = 0; col < 16; col++) {
      const X = col * 64, Y = row * 64;
      x.fillStyle = `rgb(${(14 + r() * 12) | 0},${(22 + r() * 14) | 0},${(30 + r() * 16) | 0})`;
      x.fillRect(X, Y, 64, 64);
      const g = x.createLinearGradient(0, Y, 0, Y + 64); // ceiling darker, floor reflection lighter
      g.addColorStop(0, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(70,78,84,0.25)');
      x.fillStyle = g; x.fillRect(X, Y, 64, 64);
      const lit = r() < 0.16;
      if (lit) {
        const w = `rgb(255,${(200 + r() * 40) | 0},${(140 + r() * 70) | 0})`;
        ex.fillStyle = w; ex.fillRect(X, Y, 64, 64);
        ex.fillStyle = 'rgba(0,0,0,0.5)'; ex.fillRect(X, Y + 40, 64, 24); // furniture line
        x.fillStyle = 'rgba(120,104,76,0.45)'; x.fillRect(X, Y, 64, 64);
      }
      if (r() < 0.7) {
        const drop = r() < 0.22 ? 1 : 0.12 + r() * 0.75, hgt = 64 * drop;
        const v = 150 + r() * 50;
        x.fillStyle = `rgba(${v},${v - 4},${v - 14},0.82)`; x.fillRect(X, Y, 64, hgt);
        x.fillStyle = 'rgba(0,0,0,0.16)';
        for (let s = 0; s < hgt; s += 4) x.fillRect(X, Y + s, 64, 1);
        if (lit) { ex.fillStyle = 'rgba(0,0,0,0.5)'; ex.fillRect(X, Y, 64, hgt); }
      }
    }
    const map = new THREE.CanvasTexture(c), em = new THREE.CanvasTexture(e);
    for (const t of [map, em]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; }
    return { map, emissiveMap: em };
  },
  helideck() {
    const S = 512, [c, x] = mk(S);
    fill(x, S, S, '#59615c');
    grain(x, S, 95, 0.08, 6, 4, 0.04);
    x.strokeStyle = '#d9b62e'; x.lineWidth = 9; x.beginPath(); x.arc(S / 2, S / 2, S * 0.445, 0, PI * 2); x.stroke();
    x.strokeStyle = '#e9e9e4'; x.lineWidth = 12; x.beginPath(); x.arc(S / 2, S / 2, S * 0.3, 0, PI * 2); x.stroke();
    x.fillStyle = '#e9e9e4';
    x.fillRect(S * 0.39, S * 0.34, S * 0.05, S * 0.32); x.fillRect(S * 0.56, S * 0.34, S * 0.05, S * 0.32); x.fillRect(S * 0.39, S * 0.475, S * 0.22, S * 0.05);
    streaks(x, S, 96, 10, 'rgba(30,30,30,0.18)', S * 0.6, 8);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return { map: t };
  },
  road() { // two-lane road, tile 20 m along U, full width in V
    const S = 256, [c, x] = mk(S);
    fill(x, S, S, '#4a4a4a');
    speckle(x, S, 97, 5000, ['#555', '#404040', '#5e5e5c'], 1, 2, 0.6);
    grain(x, S, 98, 0.12, 4, 4, 0.05);
    x.fillStyle = 'rgba(30,30,30,0.25)'; x.fillRect(0, S * 0.2, S, S * 0.1); x.fillRect(0, S * 0.7, S, S * 0.1);
    x.fillStyle = '#c9a531'; x.fillRect(0, S * 0.485, S, 3); x.fillRect(0, S * 0.515, S, 3);
    x.fillStyle = '#d8d6cc'; x.fillRect(0, S * 0.06, S, 3); x.fillRect(0, S * 0.93, S, 3);
    x.fillStyle = '#8f8674'; x.fillRect(0, 0, S, S * 0.035); x.fillRect(0, S * 0.965, S, S * 0.035);
    return { map: wrapTex(c, 20, 9) };
  },
  leaf() { // foliage atlas: alpha cluster on the left, opaque leaf patch and a white patch on the right
    const S = 256, [c, x] = mk(S), [ac, ax] = mk(S), r = rng(77);
    fill(x, S, S, '#8c9a78'); fill(ax, S, S, '#000');
    const leafDot = (ctx, px, py, col, k = 1) => { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(px, py, (2.5 + r() * 5.5) * k, (2 + r() * 4) * k, r() * 3.14, 0, 6.28); ctx.fill(); };
    for (let i = 0; i < 520; i++) {
      const a = r() * 6.28, d = Math.pow(r(), 0.62) * S * 0.36, px = S * 0.375 + Math.cos(a) * d, py = S * 0.5 + Math.sin(a) * d * 1.25, v = 120 + r() * 135;
      leafDot(x, px, py, `rgb(${(v * 0.93) | 0},${v | 0},${(v * 0.8) | 0})`); leafDot(ax, px, py, '#fff', 0.95);
    }
    for (let i = 0; i < 260; i++) { const v = 110 + r() * 130; leafDot(x, S * 0.78 + r() * S * 0.22, r() * S * 0.7, `rgb(${(v * 0.93) | 0},${v | 0},${(v * 0.8) | 0})`); }
    ax.fillStyle = '#fff'; ax.fillRect(S * 0.77, 0, S * 0.23, S);
    x.fillStyle = '#fff'; x.fillRect(S * 0.79, S * 0.79, S * 0.21, S * 0.21);
    const map = new THREE.CanvasTexture(c), alphaMap = new THREE.CanvasTexture(ac);
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    return { map, alphaMap };
  },
  flame() {
    const S = 64, [c, x] = mk(S);
    const g = x.createRadialGradient(S / 2, S * 0.68, 1, S / 2, S * 0.55, S * 0.48);
    g.addColorStop(0, 'rgba(255,244,200,1)'); g.addColorStop(0.3, 'rgba(255,190,70,0.85)'); g.addColorStop(0.7, 'rgba(240,110,20,0.3)'); g.addColorStop(1, 'rgba(200,60,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return { map: t };
  },
};

// ---------------------------------------------------------------- materials (lazy, module cache)

const MATS = {};
const M = (name) => MATS[name] || (MATS[name] = MATDEF[name]());
const std = (o) => new THREE.MeshStandardMaterial(o);
const decal = (layer) => ({ polygonOffset: true, polygonOffsetFactor: -layer, polygonOffsetUnits: -layer * 4 });
const noCast = (m) => { m.userData.noCast = true; return m; };
const NIGHT = { on: false };

const MATDEF = {
  precast: () => std({ ...T('precast'), roughness: 0.88, normalScale: new THREE.Vector2(0.5, 0.5) }),
  panelDark: () => std({ ...T('precast'), color: 0x5d6368, roughness: 0.7, normalScale: new THREE.Vector2(0.4, 0.4) }),
  brick: () => std({ ...T('brick'), roughness: 0.9 }),
  tilt: () => std({ ...T('tilt'), roughness: 0.86 }),
  ribLight: () => std({ ...T('rib'), color: 0xb9bdbd, roughness: 0.5, metalness: 0.35 }),
  ribTan: () => std({ ...T('rib'), color: 0xc9bb9d, roughness: 0.55, metalness: 0.3 }),
  ribDark: () => std({ ...T('rib'), color: 0x4c5560, roughness: 0.5, metalness: 0.35 }),
  ribGreen: () => std({ ...T('rib'), color: 0x3f5a50, roughness: 0.55, metalness: 0.3 }),
  ribRoof: () => std({ ...T('rib'), color: 0xbfc4c6, roughness: 0.38, metalness: 0.75 }),
  rollup: () => std({ ...T('ribH'), color: 0xc4c6c4, roughness: 0.5, metalness: 0.4 }),
  louver: () => std({ ...T('louver'), roughness: 0.5, metalness: 0.5 }),
  asphalt: () => noCast(std({ ...T('asphalt'), roughness: 0.93, ...decal(2) })),
  paving: () => std({ ...T('paving'), roughness: 0.9 }),
  slab: () => std({ ...T('slab'), roughness: 0.88 }),
  slabFlat: () => noCast(std({ ...T('slab'), roughness: 0.88, ...decal(2.5) })),
  roof: () => std({ ...T('roof'), roughness: 0.8 }),
  roofGravel: () => std({ ...T('roofGravel'), roughness: 0.95 }),
  pad: () => noCast(std({ color: 0x74777a, roughness: 0.9, ...decal(2) })),
  caliche: () => std({ ...T('caliche'), color: 0xf0e2c8, roughness: 0.95 }),
  calicheFlat: () => noCast(std({ ...T('caliche'), color: 0xf0e2c8, roughness: 0.95, ...decal(2) })),
  gravel: () => noCast(std({ ...T('gravel'), roughness: 0.95, ...decal(1.5) })),
  dg: () => noCast(std({ ...T('dg'), roughness: 0.95, ...decal(2.5) })),
  turf: () => noCast(std({ ...T('turf'), roughness: 0.95, ...decal(1) })),
  galv: () => std({ ...T('galv'), roughness: 0.42, metalness: 0.8 }),
  steel: () => std({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.85 }),
  steelDark: () => std({ color: 0x2c3034, roughness: 0.55, metalness: 0.6 }),
  shroud: () => std({ color: 0x8d9296, roughness: 0.5, metalness: 0.7, side: THREE.DoubleSide }),
  white: () => std({ color: 0xcfcfc8, roughness: 0.45, metalness: 0.1 }),
  alu: () => std({ color: 0x3b4046, roughness: 0.35, metalness: 0.85 }),
  panelGrey: () => std({ color: 0x7f868c, roughness: 0.42, metalness: 0.6 }),
  aluLight: () => std({ color: 0xb9bdc0, roughness: 0.3, metalness: 0.9 }),
  coping: () => std({ color: 0x565b60, roughness: 0.4, metalness: 0.8 }),
  rubber: () => std({ color: 0x141414, roughness: 0.9 }),
  core: () => std({ color: 0x1b1d20, roughness: 0.9 }),
  dark: () => std({ color: 0x08090a, roughness: 1 }),
  glass: () => new THREE.MeshPhysicalMaterial({ ...T('glass'), emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.03, metalness: 0, ior: 2.33, specularIntensity: 1, envMapIntensity: 1.7 }),
  spandrel: () => new THREE.MeshPhysicalMaterial({ color: 0x27323b, roughness: 0.12, metalness: 0.3, ior: 1.8, envMapIntensity: 1.1 }),
  paintW: () => noCast(std({ color: 0xdedcd2, roughness: 0.8, ...decal(4) })),
  paintY: () => noCast(std({ color: 0xcfa126, roughness: 0.8, ...decal(4) })),
  lamp: () => std({ color: 0xf2efe6, emissive: 0xfff0cf, emissiveIntensity: 0.15, roughness: 0.4 }),
  lampGreen: () => std({ color: 0x3ddc84, emissive: 0x3ddc84, emissiveIntensity: 1.6, roughness: 0.4 }),
  lampAmber: () => std({ color: 0xf5a623, emissive: 0xf5a623, emissiveIntensity: 1.4, roughness: 0.4 }),
  frp: () => std({ ...T('galv'), color: 0xcfc8b6, roughness: 0.7, metalness: 0.05 }),
  utilGreen: () => std({ color: 0x45584a, roughness: 0.55, metalness: 0.3 }),
  utilGrey: () => std({ color: 0x8f979c, roughness: 0.5, metalness: 0.4 }),
  safety: () => std({ color: 0xd8a416, roughness: 0.55, metalness: 0.2 }),
  orange: () => std({ color: 0xd9641a, roughness: 0.7 }),
  tankTan: () => std({ ...T('galv'), color: 0xc8b48e, roughness: 0.6, metalness: 0.2 }),
  tankWhite: () => std({ ...T('galv'), color: 0xe9e9e4, roughness: 0.5, metalness: 0.15 }),
  tankBlack: () => std({ color: 0x1d1f21, roughness: 0.6, metalness: 0.1 }),
  pipeBlue: () => std({ color: 0x3f6d94, roughness: 0.5, metalness: 0.4 }),
  pipeGrey: () => std({ color: 0xaeb2b4, roughness: 0.45, metalness: 0.7 }),
  wellGrey: () => std({ color: 0x4d555b, roughness: 0.55, metalness: 0.6 }),
  rust: () => std({ color: 0x6f4a35, roughness: 0.85, metalness: 0.4 }),
  door: () => std({ color: 0x56646f, roughness: 0.5, metalness: 0.4 }),
  ceramic: () => std({ color: 0x6b4634, roughness: 0.25 }),
  crimson: () => std({ color: 0x8e2222, roughness: 0.6 }),
  water: () => noCast(new THREE.MeshPhysicalMaterial({ color: 0x2b332a, roughness: 0.16, metalness: 0, envMapIntensity: 0.45, ...decal(3) })),
  fence: () => noCast(std({ ...T('fence'), transparent: true, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7, depthWrite: false })),
  helideck: () => std({ ...T('helideck'), roughness: 0.8 }),
  road: () => noCast(std({ ...T('road'), roughness: 0.9, ...decal(2) })),
  veg: () => std({ ...T('leaf'), alphaTest: 0.38, vertexColors: true, roughness: 0.9 }),
  vegDepth: () => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: T('leaf').alphaMap, alphaTest: 0.38 }),
  carBody: () => std({ roughness: 0.32, metalness: 0.55 }),
  carDark: () => new THREE.MeshPhysicalMaterial({ color: 0x0d1013, roughness: 0.12, metalness: 0.3 }),
};

// Plain lettering signs. Returns a material; the caller sizes the quad using mat.userData.aspect.
const SIGNS = {};
function signMat(text, o = {}) {
  const key = text + JSON.stringify(o);
  if (SIGNS[key]) return SIGNS[key];
  const lines = text.split('\n'), fs = 96, pad = o.bg ? 36 : 8;
  const [mc, mx] = mk(8);
  const font = `${o.weight || 700} ${fs}px Arial, Helvetica, sans-serif`;
  mx.font = font;
  const tw = Math.max(...lines.map((l) => mx.measureText(l).width));
  const W = Math.ceil(tw + pad * 2), H = Math.ceil(lines.length * fs * 1.12 + pad * 2);
  const [c, x] = mk(W, H);
  if (o.bg) fill(x, W, H, o.bg);
  x.font = font; x.textBaseline = 'middle'; x.textAlign = 'center'; x.fillStyle = o.color || '#ffffff';
  lines.forEach((l, i) => x.fillText(l, W / 2, pad + fs * 1.12 * (i + 0.5) + 4));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = std({ map: t, roughness: 0.6, transparent: !o.bg, alphaTest: o.bg ? 0 : 0.35, emissive: 0xffffff, emissiveMap: t, emissiveIntensity: o.glow ? 0.25 : 0, ...decal(3) });
  m.userData = { aspect: W / H, noCast: true, glow: !!o.glow, sign: true };
  SIGNS[key] = m;
  return m;
}

// ---------------------------------------------------------------- geometry kit

function mbox(w, h, d, ou = 0, ov = 0) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const j = f * 4 + i;
    uv.setXY(j, uv.getX(j) * dims[f][0] + ou, uv.getY(j) * dims[f][1] + ov);
  }
  return g;
}

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new V3(), _s = new V3(), _c = new THREE.Color();
const UP = new V3(0, 1, 0);

// Collects geometry per material and instances per key, then emits one mesh per material.
class Kit {
  constructor(seed = 1) {
    this.b = new Map(); this.i = new Map(); this.fans = []; this.anim = []; this.extra = [];
    this.stack = [new THREE.Matrix4()];
    this.rand = rng(seed); this.aligned = false;
  }
  get M() { return this.stack[this.stack.length - 1]; }
  at(x, y, z, ry = 0) { this.stack.push(this.M.clone().multiply(new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z))); return this; }
  pop() { this.stack.pop(); return this; }
  addM(mat, geo, local) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n);
    g.applyMatrix4(local ? _m.multiplyMatrices(this.M, local) : this.M);
    const key = typeof mat === 'string' ? M(mat) : mat;
    if (!this.b.has(key)) this.b.set(key, []);
    this.b.get(key).push(g);
  }
  // Box by center x/z and base y.
  box(mat, w, h, d, x, y, z, ry = 0) {
    const ou = this.aligned ? 0 : this.rand() * 7, ov = this.aligned ? 0 : this.rand() * 7;
    this.addM(mat, mbox(w, h, d, ou, ov), new THREE.Matrix4().makeRotationY(ry).setPosition(x, y + h / 2, z));
  }
  // Box with arbitrary rotation (Euler XYZ), by center.
  boxR(mat, w, h, d, x, y, z, rx, ry, rz) {
    this.addM(mat, mbox(w, h, d, this.rand() * 7, this.rand() * 7), new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)).setPosition(x, y, z));
  }
  cyl(mat, r, h, x, y, z, seg = 16, rTop = r, open = false) {
    this.addM(mat, new THREE.CylinderGeometry(rTop, r, h, seg, 1, open), new THREE.Matrix4().setPosition(x, y + h / 2, z));
  }
  // Cylinder between two points.
  pipe(mat, a, b, r, seg = 8) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, _v.normalize());
    this.addM(mat, new THREE.CylinderGeometry(r, r, len, seg, 1, true), new THREE.Matrix4().compose(new V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new V3(1, 1, 1)));
  }
  // Box section between two points.
  beam(mat, a, b, w, h = w) {
    _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = _v.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UP, _v.normalize());
    this.addM(mat, mbox(w, len, h), new THREE.Matrix4().compose(new V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new V3(1, 1, 1)));
  }
  // Horizontal quad facing up, by center.
  flat(mat, w, d, x, y, z, ry = 0) {
    const g = new THREE.PlaneGeometry(w, d), uv = g.attributes.uv;
    const ou = this.rand() * 9, ov = this.rand() * 9;
    for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) * w + ou, uv.getY(i) * d + ov);
    g.rotateX(-PI / 2);
    this.addM(mat, g, new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z));
  }
  // Vertical quad facing local +Z, by center x and base y. uv: optional [u0, v0, u1, v1].
  quad(mat, w, h, x, y, z, uvr) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    if (uvr) for (let i = 0; i < 4; i++) uv.setXY(i, lerp(uvr[0], uvr[2], uv.getX(i)), lerp(uvr[1], uvr[3], uv.getY(i)));
    else for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
    this.addM(mat, g, new THREE.Matrix4().setPosition(x, y + h / 2, z));
  }
  // Glass strip mapped onto one random row of the window atlas, `cells` atlas cells wide.
  glass(w, h, x, y, z, cells) {
    const u0 = ((this.rand() * 16) | 0) / 16, row = (this.rand() * 8) | 0;
    this.quad('glass', w, h, x, y, z, [u0, row / 8, u0 + cells / 16, (row + 1) / 8]);
  }
  sign(text, o, h, x, y, z, ry = 0) {
    const m = signMat(text, o), w = h * m.userData.aspect;
    this.at(x, y, z, ry); this.quad(m, w, h, 0, 0, 0, [0, 0, 1, 1]); this.pop();
    return w;
  }
  inst(key, x, y, z, ry = 0, s = 1, color = null, sy = s) {
    if (!this.i.has(key)) this.i.set(key, []);
    const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new V3(s, sy, s));
    this.i.get(key).push({ m: m.premultiply(this.M), color });
  }
  fan(key, r, x, y, z, speed = 9) {
    const m = new THREE.Matrix4().compose(new V3(x, y, z), new THREE.Quaternion(), new V3(r, r, r)).premultiply(this.M);
    this.fans.push({ key, m, speed: speed * (0.85 + this.rand() * 0.3), phase: this.rand() * 6.28 });
  }
  build(group) {
    for (const [mat, geos] of this.b) {
      const mesh = new THREE.Mesh(mergeGeometries(geos, false), mat);
      mesh.castShadow = !mat.userData.noCast; mesh.receiveShadow = true;
      if (mat.transparent) mesh.renderOrder = 2;
      group.add(mesh);
      for (const g of geos) g.dispose();
    }
    for (const [key, list] of this.i) {
      const def = INST[key.split(':')[0]](key.split(':')[1]);
      const im = new THREE.InstancedMesh(def.geo, def.mat, list.length);
      list.forEach((e, n) => { im.setMatrixAt(n, e.m); if (e.color != null) im.setColorAt(n, _c.set(e.color)); });
      im.castShadow = true; im.receiveShadow = true; im.userData.shared = true;
      if (def.mat === MATS.veg) im.customDepthMaterial = M('vegDepth');
      group.add(im);
    }
    for (const o of this.extra) group.add(o);
    const byKey = new Map();
    for (const f of this.fans) { if (!byKey.has(f.key)) byKey.set(f.key, []); byKey.get(f.key).push(f); }
    const fanSets = [];
    for (const [key, list] of byKey) {
      const im = new THREE.InstancedMesh(fanGeo(key), M('steelDark'), list.length);
      list.forEach((f, n) => im.setMatrixAt(n, f.m));
      im.userData.shared = true; im.castShadow = false;
      group.add(im); fanSets.push({ im, list });
    }
    const anim = this.anim;
    let acc = 0;
    return (dt, t) => {
      acc += dt;
      for (const { im, list } of fanSets) {
        for (let n = 0; n < list.length; n++) {
          const f = list[n];
          _m2.makeRotationY(f.phase + t * f.speed);
          im.setMatrixAt(n, _m.multiplyMatrices(f.m, _m2));
        }
        im.instanceMatrix.needsUpdate = true;
      }
      for (const a of anim) a(dt, t);
    };
  }
}

function finish(group, k, ud) {
  const upd = k.build(group);
  group.userData = {
    kind: 'building', id: ud.id,
    setEnclosureOpacity() {}, setStatus() {},
    update(dt, t) { upd(dt || 0, t || 0); },
    setNight,
    dispose() {
      group.traverse((o) => {
        if (o.isMesh && !o.userData.shared) o.geometry.dispose();
        if (o.isInstancedMesh) o.dispose();
      });
    },
    ...ud,
  };
  return group;
}

// Night mode acts on the shared module materials, so it applies to every building at once.
export function setNight(on) {
  NIGHT.on = !!on;
  M('glass').emissiveIntensity = on ? 2.2 : 0.3;
  M('lamp').emissiveIntensity = on ? 3.0 : 0.15;
  for (const m of Object.values(SIGNS)) if (m.userData.glow) m.emissiveIntensity = on ? 1.4 : 0.25;
}

// ---------------------------------------------------------------- instanced library

const GEO = {};
function fanGeo(key) {
  if (GEO[key]) return GEO[key];
  const n = key === 'big' ? 6 : 4, parts = [];
  parts.push(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 10).toNonIndexed());
  for (let i = 0; i < n; i++) {
    const b = new THREE.BoxGeometry(0.82, 0.015, 0.3).toNonIndexed();
    b.rotateX(0.42); b.translate(0.55, 0, 0); b.rotateY((i / n) * PI * 2);
    parts.push(b);
  }
  return (GEO[key] = mergeGeometries(parts));
}

function colorize(g, col, u = 0.9, v = 0.1) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; uv[i * 2] = u; uv[i * 2 + 1] = v; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
// Lumpy clump with soft normals, darker underside. UVs land on the opaque leaf patch of the foliage atlas.
function blob(r, detail, seed, col, sx = 1, sy = 1, sz = 1, leafy = true) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  const cols = new Float32Array(p.count * 3), c = new THREE.Color(col);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const h = Math.sin(Math.round(_v.x * 50) * 12.9 + Math.round(_v.y * 50) * 78.2 + Math.round(_v.z * 50) * 37.7 + seed) * 43758.5;
    const f = h - Math.floor(h);
    _v.multiplyScalar(0.84 + f * 0.32);
    p.setXYZ(i, _v.x * sx, _v.y * sy, _v.z * sz);
    _v.normalize(); _v.y = _v.y * 0.6 + 0.5; _v.normalize(); nrm.setXYZ(i, _v.x, _v.y, _v.z);
    const sh = 0.45 + 0.55 * sstep(-0.8, 0.9, p.getY(i) / (r * sy));
    cols[i * 3] = c.r * sh; cols[i * 3 + 1] = c.g * sh; cols[i * 3 + 2] = c.b * sh;
    if (leafy) uv.setXY(i, 0.8 + 0.17 * f, 0.34 + 0.6 * ((f * 7.3) % 1)); else uv.setXY(i, 0.9, 0.1);
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}
function trunk(a, b, r0, r1, col) {
  _v.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = _v.length(); _q.setFromUnitVectors(UP, _v.normalize());
  const g = new THREE.CylinderGeometry(r1, r0, len, 5, 1, true).toNonIndexed();
  g.applyMatrix4(new THREE.Matrix4().compose(new V3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new V3(1, 1, 1)));
  return colorize(g, new THREE.Color(col));
}
// Alpha-tested leaf cards around canopy ellipsoids. Both windings are emitted with outward normals so the
// cards shade like one soft volume from either side.
function leafCards(r, ells, n, size, cols, lowY) {
  const pos = [], nor = [], uv = [], col = [], f = new V3(), u = new V3(), w = new V3(), c = new THREE.Color(), q = new V3();
  for (const e of ells) for (let i = 0; i < n; i++) {
    f.set(r() - 0.5, r() * 0.9 - 0.25, r() - 0.5).normalize();
    const cx = e[0] + f.x * e[3] * 0.72, cy = e[1] + f.y * e[4] * 0.72, cz = e[2] + f.z * e[3] * 0.72;
    f.x += (r() - 0.5) * 0.9; f.y += (r() - 0.5) * 0.9; f.z += (r() - 0.5) * 0.9; f.normalize();
    u.crossVectors(UP, f); if (u.lengthSq() < 0.01) u.set(1, 0, 0); u.normalize(); w.crossVectors(f, u);
    const s = size * (0.75 + r() * 0.5) * 0.5, uo = r() < 0.5 ? 0 : 1;
    c.set(cols[(r() * cols.length) | 0]); const tint = 0.85 + r() * 0.3;
    const P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [cx + u.x * a * s + w.x * b * s, cy + u.y * a * s + w.y * b * s, cz + u.z * a * s + w.z * b * s, uo ? 0.75 - (a + 1) * 0.375 : (a + 1) * 0.375, (b + 1) * 0.5]);
    for (const idx of [0, 1, 2, 0, 2, 3, 2, 1, 0, 3, 2, 0]) {
      const v = P[idx]; pos.push(v[0], v[1], v[2]); uv.push(v[3], v[4]);
      q.set(v[0] - e[0], (v[1] - e[1]) * 0.8 + e[4] * 0.5, v[2] - e[2]).normalize(); nor.push(q.x, q.y, q.z);
      const sh = (0.5 + 0.5 * sstep(lowY, lowY + (e[1] + e[4] - lowY), v[1])) * tint;
      col.push(c.r * sh, c.g * sh, c.b * sh);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
const TREES = {
  // trunks [a, b, r0, r1], canopy ellipsoids [x, y, z, rxz, ry], cards per ellipsoid, card size, leaf colors, core color
  mesquite: { bark: '#4a3a2c', tr: [[[0, 0, 0], [0.8, 2.5, 0.3], 0.2, 0.11], [[0, 0, 0], [-0.9, 2.7, -0.2], 0.18, 0.1], [[0, 0, 0], [0.1, 2.9, -1.0], 0.16, 0.1]], el: [[1.5, 3.6, 0.5, 2.3, 1.2], [-1.6, 3.8, -0.4, 2.2, 1.2], [0.2, 4.1, -1.7, 2.0, 1.1]], n: 9, s: 2.9, cols: ['#5d6641', '#6a7149', '#535c3a'], core: '#414a2f', cs: 0.55 },
  oak: { bark: '#3d3229', tr: [[[0, 0, 0], [0, 3.4, 0], 0.34, 0.24], [[0, 2.4, 0], [2.0, 4.6, 0.6], 0.17, 0.1], [[0, 2.4, 0], [-1.7, 4.8, -0.9], 0.17, 0.1]], el: [[0, 6.4, 0, 2.8, 2.0], [2.6, 5.3, 0.9, 2.4, 1.7], [-2.3, 5.5, -1.2, 2.4, 1.7], [0.3, 5.2, 2.4, 2.2, 1.6]], n: 9, s: 3.3, cols: ['#36452b', '#404e30', '#2f3d27'], core: '#27331f', cs: 0.68 },
  decid: { bark: '#3a3028', tr: [[[0, 0, 0], [0, 5.5, 0], 0.32, 0.2]], el: [[0, 8.2, 0, 3.6, 3.6], [1.4, 5.8, 0.8, 2.8, 2.2]], n: 7, s: 4.8, cols: ['#3d5229', '#48602f', '#354a26'], core: '#2a3b1e', cs: 0.72 },
  oakLo: { bark: '#3d3229', tr: [[[0, 0, 0], [0, 3, 0], 0.3, 0.2]], el: [[0, 5.0, 0, 3.6, 2.2], [2.0, 4.2, 1.0, 2.4, 1.6]], n: 6, s: 4.4, cols: ['#36452b', '#404e30', '#2f3d27'], core: '#27331f', cs: 0.7 },
  mesqLo: { bark: '#4a3a2c', tr: [[[0, 0, 0], [0.5, 2.2, 0.2], 0.18, 0.1]], el: [[0.3, 3.0, 0, 2.5, 1.2]], n: 8, s: 3.0, cols: ['#5d6641', '#6a7149'], core: '#414a2f', cs: 0.5 },
  shrub: { el: [[0, 0.5, 0, 0.8, 0.5]], n: 3, s: 1.9, noCore: true, cols: ['#636a4a', '#575f42', '#6e7352'], core: '#4a5138', cs: 0.6 },
  sage: { el: [[0, 0.45, 0, 0.55, 0.45]], n: 5, s: 1.05, cols: ['#7d8773', '#8a927c', '#717b68'], core: '#646d5b', cs: 0.8 },
};
function treeGeo(kind) {
  const r = rng(kind.length * 7 + kind.charCodeAt(0)), parts = [], D = TREES[kind];
  if (D) {
    for (const t of D.tr || []) parts.push(trunk(t[0], t[1], t[2], t[3], D.bark));
    if (!D.noCore) D.el.forEach((e, i) => { const b = blob(1, 0, i * 3.7 + 1, D.core, e[3] * D.cs, e[4] * D.cs, e[3] * D.cs); b.translate(e[0], e[1], e[2]); parts.push(b); });
    parts.push(leafCards(r, D.el, D.n, D.s, D.cols, D.tr ? D.el[0][1] - D.el[0][4] * 1.4 : 0));
  } else if (kind === 'yucca') {
    for (let i = 0; i < 9; i++) {
      const g = new THREE.ConeGeometry(0.07, 0.95, 4).toNonIndexed();
      g.translate(0, 0.47, 0); g.rotateZ(i === 0 ? 0 : 0.5 + r() * 0.6); g.rotateY((i / 8) * 6.28);
      parts.push(colorize(g, new THREE.Color(i % 2 ? '#66806a' : '#58725c')));
    }
  } else { // rock
    const g = blob(0.5, 0, 9.9, '#9d9484', 1.2, 0.6, 0.9, false); g.translate(0, 0.15, 0); g.computeVertexNormals(); parts.push(g);
  }
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

const CARS = {
  sedan: { L: 4.7, W: 1.82, H: 1.44, belt: 0.9, cab: [-1.5, 1.05], roof: [-0.95, 0.45], wr: 0.33 },
  suv: { L: 4.9, W: 1.95, H: 1.76, belt: 1.05, cab: [-2.35, 1.0], roof: [-2.2, 0.4], wr: 0.38 },
  pickup: { L: 5.8, W: 2.02, H: 1.9, belt: 1.18, cab: [-0.7, 1.3], roof: [-0.55, 0.75], wr: 0.42 },
};
function carGeo(type, part) {
  const key = 'car' + type + part;
  if (GEO[key]) return GEO[key];
  const p = CARS[type], L2 = p.L / 2, parts = [];
  const ext = (pts, w) => {
    const s = new THREE.Shape(); pts.forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
    const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
    return g;
  };
  if (part === 'body') {
    parts.push(ext([[-L2, 0.32], [L2 - 0.1, 0.32], [L2, 0.5], [L2 - 0.05, p.belt - 0.18], [p.cab[1] + 0.35, p.belt], [-L2 + 0.05, p.belt], [-L2, p.belt - 0.12]], p.W));
    const rf = new THREE.BoxGeometry(p.roof[1] - p.roof[0] + 0.12, 0.06, p.W - 0.3).toNonIndexed(); rf.translate((p.roof[0] + p.roof[1]) / 2, p.H - 0.03, 0); parts.push(rf);
  } else {
    parts.push(ext([[p.cab[0], p.belt - 0.02], [p.cab[1], p.belt - 0.02], [p.roof[1], p.H - 0.05], [p.roof[0], p.H - 0.05]], p.W - 0.14));
    for (const sx of [-1, 1]) {
      const w = new THREE.CylinderGeometry(p.wr, p.wr, p.W + 0.02, 9).toNonIndexed(); w.rotateX(PI / 2); w.translate(sx * p.L * 0.31, p.wr, 0); parts.push(w);
    }
  }
  return (GEO[key] = mergeGeometries(parts.map((g) => { const n = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(n.attributes)) if (a !== 'position' && a !== 'normal') n.deleteAttribute(a); return n; })));
}

const INST = {
  tree: (kind) => ({ geo: GEO['t' + kind] || (GEO['t' + kind] = treeGeo(kind)), mat: M('veg') }),
  carBody: (type) => ({ geo: carGeo(type, 'body'), mat: M('carBody') }),
  carDark: (type) => ({ geo: carGeo(type, 'dark'), mat: M('carDark') }),
};
const CAR_COLORS = [0xe8e8e6, 0xe8e8e6, 0xe8e8e6, 0xb9bcc0, 0xb9bcc0, 0x6f7377, 0x1a1c1f, 0x1a1c1f, 0x263a57, 0x5c1f22, 0x8a7d68, 0x3a4a3c];

function car(k, x, z, ry, type) {
  const r = k.rand, t = type || (r() < 0.4 ? 'pickup' : r() < 0.55 ? 'suv' : 'sedan');
  k.inst('carBody:' + t, x, 0.03, z, ry, 1, CAR_COLORS[(r() * CAR_COLORS.length) | 0]);
  k.inst('carDark:' + t, x, 0.03, z, ry, 1);
}
function tree(k, kind, x, z, s = 1) {
  const r = k.rand, v = 0.85 + r() * 0.3;
  k.inst('tree:' + kind, x, 0, z, r() * 6.28, s * (0.8 + r() * 0.4), new THREE.Color(v, v * (0.95 + r() * 0.1), v * 0.95).getHex(), s * (0.8 + r() * 0.35));
}

// ---------------------------------------------------------------- architecture helpers

// Wall frames for a rectangular footprint. Local x runs to the viewer's right, z points outward.
function faces(x0, z0, x1, z1, t = 0.3) {
  return {
    S: { x: x0, z: z1, ry: 0, len: x1 - x0 },
    N: { x: x1, z: z0, ry: PI, len: x1 - x0 },
    E: { x: x1, z: z1 - t, ry: PI / 2, len: z1 - z0 - 2 * t },
    W: { x: x0, z: z0 + t, ry: -PI / 2, len: z1 - z0 - 2 * t },
  };
}

// One facade: punched or ribbon windows in a solid wall, a curtain wall, or a solid wall.
function facade(k, f, y0, o) {
  const { floors = 1, floorH = 4.2, bay = 3.6, style = 'punched', wall = 'precast', winH = 2.1, sill = 0.95, t = 0.3,
    blank = [], shade = false, ledge = null, frame = 'alu', mull = [0.5], transom = 0, plinth = null, fins = false } = o;
  const pier = o.pier || wall;
  const winW = style === 'ribbon' ? bay : (o.winW ?? bay * 0.64);
  const L = f.len, H = floors * floorH;
  k.at(f.x, y0, f.z, f.ry);
  if (style === 'solid') {
    k.box(wall, L, H, t, L / 2, 0, -t / 2);
  } else if (style === 'curtain') {
    const sp = o.spH ?? 1.0, ms = o.mullSp ?? 1.5, nm = Math.max(1, Math.round(L / ms));
    for (let fl = 0; fl < floors; fl++) {
      const yb = fl * floorH;
      k.glass(L, floorH, L / 2, yb, -0.18, L / bay);
      k.box('spandrel', L, sp, 0.05, L / 2, yb + floorH - sp, -0.13);
      k.box(frame, L, 0.07, 0.16, L / 2, yb + floorH - sp - 0.035, -0.08);
      k.box(frame, L, 0.07, 0.16, L / 2, yb + floorH - 0.035, -0.08);
    }
    for (let i = 0; i <= nm; i++) k.box(frame, 0.07, H, i % 2 === 0 ? 0.2 : 0.14, (i * L) / nm, 0, -0.08);
    k.box(frame, 0.3, H, 0.3, 0.15, 0, -0.15); k.box(frame, 0.3, H, 0.3, L - 0.15, 0, -0.15);
    k.box(frame, L, 0.25, 0.2, L / 2, 0, -0.1);
  } else {
    const n = Math.max(1, Math.floor((L - 0.8) / bay)), m0 = (L - n * bay) / 2;
    for (let fl = 0; fl < floors; fl++) {
      const yb = fl * floorH, bl = typeof blank === 'function' ? blank(fl) : blank;
      const open = [];
      for (let i = 0; i < n; i++) { const cx = m0 + (i + 0.5) * bay; open[i] = !bl.some(([a, b]) => cx > a && cx < b); }
      k.box(wall, L, sill, t, L / 2, yb, -t / 2);
      k.box(wall, L, floorH - sill - winH, t, L / 2, yb + sill + winH, -t / 2);
      let px = 0;
      for (let i = 0; i <= n; i++) {
        if (i < n && !open[i]) continue;
        const end = i < n ? m0 + i * bay + (bay - winW) / 2 : L, w = end - px;
        if (w > 0.01) k.box(o.pier && px > 0.01 && i < n ? pier : wall, w, winH, o.pier && px > 0.01 && i < n ? t - 0.08 : t, px + w / 2, yb + sill, -t / 2 - (o.pier && px > 0.01 && i < n ? 0.04 : 0));
        px = end + winW;
      }
      k.glass(L - 2 * m0, winH, L / 2, yb + sill, -t + 0.04, n);
      const zf = -t + 0.07, fw = 0.07;
      for (let i = 0; i < n; i++) {
        if (!open[i]) continue;
        const x0 = m0 + i * bay + (bay - winW) / 2, cx = x0 + winW / 2;
        k.quad(frame, fw, winH, x0 + fw / 2, yb + sill, zf); k.quad(frame, fw, winH, x0 + winW - fw / 2, yb + sill, zf);
        k.quad(frame, winW, fw, cx, yb + sill, zf); k.quad(frame, winW, fw, cx, yb + sill + winH - fw, zf);
        for (const mfr of mull) k.quad(frame, fw * 0.8, winH, x0 + winW * mfr, yb + sill, zf);
        if (transom) k.quad(frame, winW, fw * 0.8, cx, yb + sill + winH * transom, zf);
        if (shade) { k.box('aluLight', winW + 0.5, 0.05, 0.8, cx, yb + sill + winH + 0.08, 0.4); k.box('aluLight', winW + 0.5, 0.18, 0.04, cx, yb + sill + winH - 0.03, 0.8); }
        if (fins) { k.box(wall, 0.18, floorH, 0.45, x0 - (bay - winW) / 2, yb, 0.2); }
      }
      if (ledge) k.box(ledge, L, 0.14, 0.1, L / 2, yb + sill - 0.14, 0.05);
      if (ledge && fl > 0) k.box(ledge, L, 0.3, 0.06, L / 2, yb - 0.15, 0.03);
    }
    if (fins) k.box(wall, 0.18, H, 0.45, L - m0, 0, 0.2);
  }
  if (plinth) k.box(plinth, L, 0.9, 0.08, L / 2, 0, 0.04);
  k.pop();
}

function roofCap(k, x0, z0, x1, z1, y, ph, wall, roof = 'roof', coping = 'coping') {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, t = 0.3;
  k.flat(roof, x1 - x0 - 0.5, z1 - z0 - 0.5, cx, y + 0.03, cz);
  if (ph <= 0) return;
  k.box(wall, x1 - x0, ph, t, cx, y, z1 - t / 2); k.box(wall, x1 - x0, ph, t, cx, y, z0 + t / 2);
  k.box(wall, t, ph, z1 - z0 - 2 * t, x1 - t / 2, y, cz); k.box(wall, t, ph, z1 - z0 - 2 * t, x0 + t / 2, y, cz);
  k.box(coping, x1 - x0 + 0.16, 0.08, t + 0.16, cx, y + ph, z1 - t / 2); k.box(coping, x1 - x0 + 0.16, 0.08, t + 0.16, cx, y + ph, z0 + t / 2);
  k.box(coping, t + 0.16, 0.08, z1 - z0 - 2 * t, x1 - t / 2, y + ph, cz); k.box(coping, t + 0.16, 0.08, z1 - z0 - 2 * t, x0 + t / 2, y + ph, cz);
}

// A full building volume: dark core, four facades, parapet and roof. Returns the roof level.
function block(k, x0, z0, x1, z1, y0, o) {
  const H = o.floors * o.floorH, t = o.t ?? 0.3, F = faces(x0, z0, x1, z1, t);
  k.box('core', x1 - x0 - 2 * t + 0.04, H, z1 - z0 - 2 * t + 0.04, (x0 + x1) / 2, y0, (z0 + z1) / 2);
  for (const s of 'SENW') {
    const so = { ...o, ...(o.sides?.[s] || {}) };
    if (so.style !== 'none') facade(k, F[s], y0, so);
  }
  roofCap(k, x0, z0, x1, z1, y0 + H, o.parapet ?? 1.0, o.capWall || (o.wall ?? 'precast'), o.roof, o.coping);
  return y0 + H;
}

// ---------------------------------------------------------------- props

function ahu(k, x, y, z, w, d, h, ry = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', w + 0.3, 0.35, d + 0.3, 0, 0, 0);
  k.box('galv', w, h, d, 0, 0.35, 0);
  k.box('louver', w * 0.28, h * 0.6, 0.08, -w * 0.3, 0.35 + h * 0.25, d / 2 + 0.02);
  k.box('louver', w * 0.28, h * 0.6, 0.08, w * 0.3, 0.35 + h * 0.25, -d / 2 - 0.02);
  k.box('galv', w * 0.16, h * 0.5, d * 0.9, -w / 2 - w * 0.08, 0.35 + h * 0.4, 0);
  k.box('galv', 1.2, 0.8, 1.2, w * 0.3, 0.35 + h, 0);
  k.box('galv', 1.6, 1.0, d * 0.5, w / 2 + 0.8, 0.1, 0);
  for (let i = 1; i < 4; i++) k.box('steelDark', 0.05, h, d + 0.04, -w / 2 + (i * w) / 4, 0.35, 0);
  k.pop();
}
function rtu(k, x, y, z, ry = 0, s = 1) {
  k.at(x, y, z, ry);
  k.box('steelDark', 3.2 * s, 0.3, 2.2 * s, 0, 0, 0);
  k.box('galv', 3 * s, 1.5 * s, 2 * s, 0, 0.3, 0);
  k.box('louver', 1.2 * s, 1.0 * s, 0.06, -0.7 * s, 0.5, s + 0.02);
  k.cyl('shroud', 0.52 * s, 0.12, 0.7 * s, 0.3 + 1.5 * s, 0, 12, 0.52 * s, true);
  k.fan('small', 0.46 * s, 0.7 * s, 0.3 + 1.5 * s + 0.06, 0, 14);
  k.box('galv', 0.9 * s, 0.6 * s, 0.7 * s, -1.9 * s, 0.4, 0);
  k.pop();
}
function exFan(k, x, y, z, s = 1) {
  k.cyl('galv', 0.35 * s, 0.4 * s, x, y, z, 10);
  k.cyl('galv', 0.62 * s, 0.3 * s, x, y + 0.4 * s, z, 12, 0.4 * s);
}
function coolingTower(k, x, y, z, s = 7, h = 4.2) {
  k.at(x, y, z);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('steelDark', 0.3, 1, 0.3, sx * (s / 2 - 0.3), 0, sz * (s / 2 - 0.3));
  k.box('galv', s, 0.7, s, 0, 1, 0);
  k.box('frp', s, h, s, 0, 1.7, 0);
  k.box('louver', s * 0.92, h * 0.62, 0.1, 0, 1.9, s / 2 + 0.03); k.box('louver', s * 0.92, h * 0.62, 0.1, 0, 1.9, -s / 2 - 0.03);
  k.cyl('shroud', s * 0.36, 1.5, 0, 1.7 + h, 0, 20, s * 0.33, true);
  k.cyl('dark', s * 0.35, 0.05, 0, 1.7 + h + 0.03, 0, 16);
  k.fan('big', s * 0.31, 0, 1.7 + h + 1.0, 0, 5);
  k.box('steelDark', 0.5, h + 2.6, 0.08, s / 2 + 0.06, 0.2, s * 0.3);
  k.pop();
}
function pole(k, x, z, h = 9, heads = 2, ry = 0) {
  k.at(x, 0, z, ry);
  k.cyl('paving', 0.28, 0.8, 0, 0, 0, 10);
  k.cyl('steelDark', 0.1, h - 0.8, 0, 0.8, 0, 8, 0.065);
  for (let i = 0; i < heads; i++) {
    const s = i ? -1 : 1;
    k.box('steelDark', 1.3, 0.07, 0.07, s * 0.65, h - 0.1, 0);
    k.box('steelDark', 0.7, 0.12, 0.34, s * 1.4, h - 0.14, 0);
    k.box('lamp', 0.5, 0.03, 0.26, s * 1.4, h - 0.17, 0);
  }
  k.pop();
}
function bollards(k, pts, mat = 'safety', h = 1.1) { for (const [x, z] of pts) k.cyl(mat, 0.11, h, x, 0, z, 8); }

// Chain-link fence along a polyline. gap: optional [index, from, to] opening on one segment.
function fenceRun(k, pts, h = 2.4, closed = false, gaps = []) {
  const n = pts.length, segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n], dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), ry = Math.atan2(-dz, dx);
    const parts = [[0, len]];
    for (const [gi, g0, g1] of gaps) if (gi === i) { const p = parts.pop(); parts.push([p[0], g0], [g1, p[1]]); }
    k.at(a[0], 0, a[1], ry);
    for (const [s0, s1] of parts) {
      const l = s1 - s0; if (l < 0.2) continue;
      k.quad('fence', l, h, s0 + l / 2, 0, 0);
      k.box('steel', l, 0.05, 0.05, s0 + l / 2, h, 0);
      const np = Math.max(1, Math.round(l / 3));
      for (let j = 0; j <= np; j++) k.box('steel', 0.07, h + 0.1, 0.07, s0 + (j * l) / np, 0, 0);
    }
    k.pop();
  }
}

function parking(k, W, D, o = {}) {
  const r = k.rand, fillP = o.fill ?? 0.55, sw = 2.75, sd = 5.5, mod = sd * 2 + 7.3;
  const nm = Math.max(1, Math.floor((D + 0.01) / mod)), z00 = (D - nm * mod) / 2, ns = Math.floor((W - 6) / sw), x00 = (W - ns * sw) / 2;
  if (!o.noSurface) k.flat(o.surface || 'asphalt', W, D, W / 2, 0.03, D / 2);
  for (let m = 0; m < nm; m++) {
    const zc = z00 + m * mod;
    for (const zr of [zc + sd / 2, zc + mod - sd / 2]) {
      for (let s = 0; s <= ns; s++) k.flat('paintW', 0.12, sd, x00 + s * sw, 0.05, zr);
      for (let s = 0; s < ns; s++) if (r() < fillP) car(k, x00 + (s + 0.5) * sw + (r() - 0.5) * 0.3, zr + (r() - 0.5) * 0.5, (r() < 0.5 ? 1 : -1) * PI / 2 + (r() - 0.5) * 0.06);
      if (!o.noIslands) for (const ix of [x00 / 2, W - x00 / 2]) {
        k.box('paving', x00 - 0.5, 0.16, sd - 0.4, ix, 0, zr);
        k.flat('dg', x00 - 0.9, sd - 0.8, ix, 0.18, zr);
        if (o.trees && r() < 0.7) tree(k, o.trees, ix, zr, 0.8);
        else k.inst('tree:sage', ix, 0.16, zr, r() * 6, 1.3);
      }
    }
    if (m > 0) k.flat('paintW', ns * sw, 0.12, W / 2, 0.05, zc);
    if (o.poles !== false) for (let px = x00 + 12; px < W - x00 - 6; px += 30) pole(k, px, m > 0 ? zc : zc + 0.3, 9, m > 0 ? 2 : 1, PI / 2);
  }
}

function bed(k, x0, z0, x1, z1, o = {}) {
  const r = k.rand, w = x1 - x0, d = z1 - z0;
  k.flat('dg', w, d, (x0 + x1) / 2, 0.045, (z0 + z1) / 2);
  const n = Math.round(w * d * (o.density ?? 0.06));
  for (let i = 0; i < n; i++) {
    const x = x0 + 0.6 + r() * (w - 1.2), z = z0 + 0.6 + r() * (d - 1.2), p = r();
    if (p < 0.4) k.inst('tree:sage', x, 0, z, r() * 6, 0.8 + r() * 0.9);
    else if (p < 0.7) k.inst('tree:yucca', x, 0, z, r() * 6, 0.8 + r() * 0.8);
    else if (p < 0.9) k.inst('tree:rock', x, 0, z, r() * 6, 0.6 + r() * 1.2, 0xffffff);
    else k.inst('tree:shrub', x, 0, z, r() * 6, 0.7 + r() * 0.5);
  }
}

function manDoor(k, x, y, z, ry = 0, stairs = 0) {
  k.at(x, y, z, ry);
  k.box('door', 1.0, 2.15, 0.08, 0, stairs, 0.02);
  k.box('steelDark', 1.2, 0.08, 0.1, 0, stairs + 2.15, 0.03);
  k.box('steelDark', 1.6, 0.08, 1.0, 0, stairs + 2.45, 0.5);
  k.box('lamp', 0.3, 0.12, 0.1, 0, stairs + 2.7, 0.06);
  if (stairs > 0) {
    k.box('slab', 1.6, stairs, 1.3, 0, 0, 0.65);
    const ns = Math.ceil(stairs / 0.18);
    for (let i = 0; i < ns; i++) k.box('slab', 1.0, stairs - (i + 1) * (stairs / ns), 0.28, 1.3, 0, 0.14 + i * 0.0 + 0.5);
    k.box('steel', 0.04, 1.0, 1.3, -0.8, stairs, 0.65);
  }
  k.pop();
}
function rollDoor(k, w, h, x, y, z, ry = 0, openFrac = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', w + 0.3, h + 0.3, 0.06, 0, 0, 0.0);
  if (openFrac > 0) k.box('dark', w, h * openFrac, 0.05, 0, 0, 0.04);
  k.box('rollup', w, h * (1 - openFrac), 0.06, 0, h * openFrac, 0.05);
  k.box('steelDark', w + 0.2, 0.35, 0.3, 0, h, 0.15);
  k.pop();
}
function boxTruck(k, x, z, ry, len = 8) {
  k.at(x, 0.03, z, ry);
  k.box('white', len - 2.2, 2.6, 2.5, -1.1, 1.0, 0);
  k.box('white', 2.0, 1.9, 2.3, len / 2 - 1.0, 0.6, 0);
  k.box('carDark', 0.05, 0.8, 2.0, len / 2 + 0.01, 1.5, 0); k.box('carDark', 1.0, 0.7, 2.34, len / 2 - 0.9, 1.6, 0);
  k.box('steelDark', len - 0.6, 0.3, 1.0, 0, 0.6, 0);
  for (const wx of [len / 2 - 1.2, -len / 2 + 1.6, -len / 2 + 2.7]) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.48, 0.48, 0.3, 12); g.rotateX(PI / 2);
    k.addM('rubber', g, new THREE.Matrix4().setPosition(wx, 0.48, s * 1.05));
  }
  k.pop();
}
function ambulance(k, x, z, ry) {
  k.at(x, 0.03, z, ry);
  k.box('white', 4.3, 2.3, 2.4, -1.0, 0.75, 0);
  k.box('white', 2.0, 1.5, 2.1, 2.1, 0.55, 0);
  k.box('safety', 4.32, 0.35, 2.42, -1.0, 1.35, 0); k.box('pipeBlue', 4.33, 0.12, 2.43, -1.0, 1.75, 0);
  k.box('carDark', 0.05, 0.6, 1.8, 3.11, 1.35, 0); k.box('carDark', 0.9, 0.55, 2.14, 2.2, 1.4, 0);
  k.box('lampAmber', 1.2, 0.12, 0.3, -1.0, 3.05, 0.9); k.box('lampAmber', 1.2, 0.12, 0.3, -1.0, 3.05, -0.9);
  for (const wx of [2.2, -1.9]) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(0.4, 0.4, 0.28, 12); g.rotateX(PI / 2);
    k.addM('rubber', g, new THREE.Matrix4().setPosition(wx, 0.4, s * 1.0));
  }
  k.pop();
}
// Vertical tank with shallow cone roof, weld bands and a caged ladder.
function tank(k, x, y, z, rad, h, mat, o = {}) {
  k.cyl(mat, rad, h, x, y, z, o.seg || 28);
  k.cyl(mat, rad, o.cone ?? rad * 0.18, x, y + h, z, o.seg || 28, 0.3);
  const nb = Math.max(1, Math.round(h / 2.4));
  for (let i = 1; i < nb; i++) k.cyl(mat, rad + 0.02, 0.05, x, y + (i * h) / nb, z, o.seg || 28, rad + 0.02, true);
  const a = o.ladderA ?? 0.8, lx = x + Math.cos(a) * (rad + 0.25), lz = z + Math.sin(a) * (rad + 0.25);
  k.box('steel', 0.5, h + 1.0, 0.06, lx, y, lz, -a + PI / 2);
  if (o.rail) k.cyl('steel', rad - 0.05, 1.0, x, y + h, z, 20, rad - 0.05, true);
}
function padTransformer(k, x, z, ry = 0, s = 1) {
  k.at(x, 0, z, ry);
  k.box('slab', 2.6 * s, 0.2, 2.4 * s, 0, 0, 0);
  k.box('utilGreen', 2.0 * s, 1.8 * s, 1.7 * s, 0, 0.2, 0);
  k.box('utilGreen', 1.6 * s, 1.5 * s, 0.5 * s, 0, 0.2, 1.05 * s);
  for (let i = -3; i <= 3; i++) k.box('utilGreen', 0.05, 1.2 * s, 0.4 * s, i * 0.22 * s, 0.5, -1.0 * s);
  k.pop();
}
// Substation class step-up transformer.
function bigTransformer(k, x, z, ry = 0) {
  k.at(x, 0, z, ry);
  k.box('slab', 7, 0.35, 5.5, 0, 0, 0);
  k.box('utilGrey', 3.6, 3.0, 2.4, 0, 0.5, 0);
  k.box('utilGrey', 3.9, 0.2, 2.7, 0, 3.5, 0);
  for (const s of [-1, 1]) { k.box('louver', 3.0, 2.2, 0.7, 0, 1.0, s * 1.7); k.box('utilGrey', 3.1, 0.15, 0.8, 0, 3.2, s * 1.7); }
  { const g = new THREE.CylinderGeometry(0.4, 0.4, 2.8, 12); g.rotateZ(PI / 2); k.addM('utilGrey', g, new THREE.Matrix4().setPosition(0, 4.6, -0.6)); }
  k.box('utilGrey', 0.15, 0.9, 0.15, -1.0, 3.7, -0.6); k.box('utilGrey', 0.15, 0.9, 0.15, 1.0, 3.7, -0.6);
  for (let i = -1; i <= 1; i++) { k.cyl('ceramic', 0.12, 1.5, i * 1.1, 3.7, 0.5, 8, 0.07); k.cyl('steel', 0.03, 0.3, i * 1.1, 5.2, 0.5, 6); k.cyl('ceramic', 0.09, 0.6, i * 0.6 - 0, 3.7, 1.0, 8, 0.06); }
  k.box('utilGrey', 0.8, 1.6, 0.4, 2.0, 0.6, 0.6);
  k.pop();
}
// Air cooled chiller: compressor base, V coils, deck of small fans.
function chiller(k, x, y, z, ry = 0, len = 11.5, cols = 6) {
  k.at(x, y, z, ry);
  k.box('steelDark', len, 0.25, 2.2, 0, 0, 0);
  k.box('utilGrey', len * 0.96, 0.9, 1.5, 0, 0.25, 0);
  k.box('louver', len, 1.35, 2.3, 0, 1.15, 0);
  k.box('galv', len + 0.04, 0.12, 2.34, 0, 2.5, 0);
  k.box('galv', 0.9, 1.6, 2.36, len / 2 - 0.45, 0.9, 0);
  for (let i = 0; i < cols; i++) for (const s of [-1, 1]) {
    const fx = -len / 2 + (i + 0.5) * (len / cols), fz = s * 0.58;
    k.cyl('shroud', 0.5, 0.14, fx, 2.62, fz, 10, 0.5, true);
    k.fan('small', 0.44, fx, 2.7, fz, 16);
  }
  k.pop();
}
// Rooftop fan-wall cooling unit with two large fans.
function fanUnit(k, x, y, z, ry = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', 7.3, 0.4, 3.3, 0, 0, 0);
  k.box('galv', 7, 2.3, 3, 0, 0.4, 0);
  k.box('louver', 6.4, 1.5, 0.08, 0, 0.8, 1.52); k.box('louver', 6.4, 1.5, 0.08, 0, 0.8, -1.52);
  for (const s of [-1, 1]) {
    k.cyl('shroud', 1.28, 0.4, s * 1.75, 2.7, 0, 16, 1.28, true);
    k.cyl('dark', 1.24, 0.04, s * 1.75, 2.71, 0, 12);
    k.fan('big', 1.18, s * 1.75, 2.95, 0, 7);
  }
  k.pop();
}

// ---------------------------------------------------------------- hospital

export function buildHospital(opts = {}) {
  const variant = opts.variant || 'regional', seed = opts.seed ?? 11;
  const k = new Kit(seed), r = k.rand, group = new THREE.Group(), sr = rng(seed * 31 + 7);
  const P = variant === 'community'
    ? { tf: 5, pf: 2, tmat: 'brick', pmat: 'precast', tx0: -40, tx1: 34, lantern: false, ed: 'ribbon' }
    : { tf: 7, pf: 3, tmat: 'precast', pmat: 'brick', tx0: -52, tx1: 44, lantern: true, ed: 'punched' };
  if (seed !== 11) { // seed drives massing so a second site is not a clone
    P.tf = clamp(P.tf - 1 + ((sr() * 3) | 0), 4, 8);
    const dx = Math.round((sr() - 0.5) * 16); P.tx0 += dx; P.tx1 += dx;
    if (sr() < 0.5) [P.tmat, P.pmat] = [P.pmat, P.tmat];
    P.lantern = sr() < 0.6; P.pf = sr() < 0.5 ? 2 : 3;
  }
  const name = (opts.name || 'Caprock Regional Medical Center').toUpperCase();
  const FH = 4.8, PH = P.pf * FH, TFH = 4.2, TY = PH + P.tf * TFH, tcx = (P.tx0 + P.tx1) / 2;
  const tBrick = P.tmat === 'brick', pBrick = P.pmat === 'brick';

  // podium (diagnostic and treatment block)
  const lob0 = -5, lob1 = 25;
  block(k, -70, -30, 60, 30, 0, {
    floors: P.pf, floorH: FH, style: 'punched', wall: P.pmat, bay: 4.2, winW: 2.7, winH: 2.4, sill: 1.0, ledge: pBrick ? 'precast' : null, plinth: 'precast',
    mull: [0.5], transom: 0.72, parapet: 1.1, roof: 'roofGravel',
    sides: {
      S: { blank: (fl) => (fl < 2 ? [[lob0 + 70 - 1, lob1 + 70 + 1]] : []) },
      E: { blank: (fl) => (fl < 2 ? [[33, 60]] : []) },
      W: { blank: (fl) => (fl < 1 ? [[21, 60]] : []) },
    },
  });

  // patient tower
  const tz0 = -16, tz1 = 8;
  block(k, P.tx0, tz0, P.tx1, tz1, PH, {
    floors: P.tf, floorH: TFH, style: 'punched', wall: P.tmat, bay: 3.84, winW: 2.7, winH: 2.2, sill: 0.9, mull: [0.34], parapet: 1.5, roof: 'roof',
    ledge: tBrick ? 'precast' : null, fins: !tBrick, pier: tBrick ? null : 'panelGrey',
    sides: {
      S: { shade: true, blank: P.lantern ? [[tcx - 7.5 - P.tx0, tcx + 7.5 - P.tx0]] : [] },
      N: { blank: [[P.tx1 - (tcx + 10.5), P.tx1 - (tcx - 10.5)]] },
      E: { blank: [[0, 7.5], [16, 24]], fins: false }, W: { blank: [[0, 7.5], [16, 24]], fins: false },
    },
  });
  if (P.lantern) block(k, tcx - 7, tz1 - 0.2, tcx + 7, tz1 + 2.6, PH, { floors: P.tf, floorH: TFH, style: 'curtain', bay: 3.5, parapet: 2.0, wall: 'alu', coping: 'alu', sides: { N: { style: 'none' } } });
  // elevator and stair core on the north side, rising above the roof
  const coreTop = TY + 5.4;
  block(k, tcx - 10, tz0 - 6, tcx + 10, tz0 + 0.2, PH, { floors: 1, floorH: coreTop - PH, style: 'solid', wall: P.tmat, parapet: 0.6, roof: 'roof' });
  for (const sx of [-6, 6]) k.box('spandrel', 1.8, coreTop - PH - 5, 0.12, tcx + sx, PH + 2, tz0 - 6.05);
  for (let i = 1; i < 4; i++) k.box('coping', 20.1, 0.12, 0.08, tcx, PH + (i * (coreTop - PH)) / 4, tz0 - 6.03);
  // tower end walls: vertical reveals
  for (const ex of [P.tx0 - 0.03, P.tx1 + 0.03]) for (const ez of [tz0 + 4, tz1 - 4]) k.box('coping', 0.08, P.tf * TFH, 0.12, ex, PH, ez);

  // tower roof: mechanical penthouse, helipad
  const ph0 = tcx + 12, ph1 = P.tx1 - 4;
  block(k, ph0, tz0 + 3, ph1, tz1 - 4, TY, { floors: 1, floorH: 5.2, style: 'solid', wall: 'ribLight', parapet: 0.3, roof: 'roof' });
  for (let x = ph0 + 4; x < ph1 - 3; x += 7) { k.box('louver', 4.5, 2.6, 0.1, x, TY + 1.6, tz1 - 3.96); k.box('louver', 4.5, 2.6, 0.1, x, TY + 1.6, tz0 + 2.96); }
  exFan(k, ph0 + 5, TY + 5.5, -6, 1.6); exFan(k, ph0 + 12, TY + 5.5, -3, 1.6); rtu(k, ph0 + 20, TY + 5.25, -6);
  // windsock
  k.cyl('steel', 0.05, 4, ph1 - 1, TY + 5.5, tz0 + 4, 6);
  { const g = new THREE.ConeGeometry(0.3, 1.6, 8); g.rotateZ(PI / 2 + 0.25); k.addM('orange', g, new THREE.Matrix4().setPosition(ph1 - 1.9, TY + 9.2, tz0 + 4)); }
  const hx = P.tx0 + 15, hz = -4, hy = TY + 3.4;
  { const g = new THREE.CylinderGeometry(11.5, 11.5, 0.35, 8); g.rotateY(PI / 8); k.addM('helideck', g, new THREE.Matrix4().setPosition(hx, hy - 0.175, hz)); }
  { const g = new THREE.CylinderGeometry(11.3, 11.3, 0.7, 8, 1, true); g.rotateY(PI / 8); k.addM('steelDark', g, new THREE.Matrix4().setPosition(hx, hy - 0.7, hz)); }
  { const g = new THREE.CylinderGeometry(13.2, 11.5, 0.5, 8, 1, true); g.rotateY(PI / 8); k.addM('fence', g, new THREE.Matrix4().setPosition(hx, hy - 0.1, hz)); }
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2, cx = hx + Math.cos(a) * 9.6, cz = hz + Math.sin(a) * 9.6;
    k.box('steelDark', 0.35, 3.1, 0.35, cx, TY, cz);
    k.beam('steelDark', [cx, TY + 0.3, cz], [hx + Math.cos(a + PI / 4) * 9.6, hy - 0.8, hz + Math.sin(a + PI / 4) * 9.6], 0.14);
  }
  for (let i = 0; i < 16; i++) { const a = (i / 16) * PI * 2 + 0.2; k.box('lampGreen', 0.22, 0.14, 0.22, hx + Math.cos(a) * 10.4, hy, hz + Math.sin(a) * 10.4); }
  // walkway from deck to core
  k.beam('galv', [hx + 10, hy - 0.1, hz - 5], [tcx - 9, hy - 0.1, tz0 - 1], 2.0, 0.15);
  k.box('galv', 2.6, 2.6, 2.6, hx + 9, TY, tz1 - 3);
  for (let i = 0; i < 5; i++) exFan(k, P.tx0 + 6 + r() * 4, TY, tz0 + 2 + i * 0.1 + r() * 2 + i * 0.2, 1.2);

  // podium roof equipment
  for (const ax of [-60, -44, -28, 22, 36, 50]) if (ax < tcx - 16 || ax > tcx + 16) ahu(k, ax, PH, -23.5, 10, 4, 3.2);
  if (P.tx0 > -66) rtu(k, -66, PH, 0, PI / 2, 1.4);
  for (const [rx, rz] of [[-58, 18], [-50, 22], [-38, 16], [36, 16], [44, 22], [52, 14]]) rtu(k, rx, PH, rz, r() < 0.5 ? 0 : PI / 2, 1.2);
  for (let i = 0; i < 16; i++) exFan(k, -66 + r() * 122, PH, r() < 0.5 ? 11 + r() * 16 : -28 + r() * 3, 0.8 + r() * 0.6);
  // skylight over the lobby atrium
  k.box('alu', 20.4, 0.5, 9.4, 10, PH, 20);
  for (const [rx, sz] of [[-PI / 2 + 0.38, 22.3], [-PI / 2 - 0.38, 17.7]]) {
    const g = new THREE.PlaneGeometry(20, 5), uv = g.attributes.uv;
    for (let i = 0; i < 4; i++) uv.setXY(i, uv.getX(i) * 0.5, 0.01 + uv.getY(i) * 0.015);
    k.addM('glass', g, new THREE.Matrix4().makeRotationX(rx).setPosition(10, PH + 1.4, sz));
  }
  for (let i = 0; i <= 8; i++) { k.beam('alu', [i * 2.5, PH + 0.5, 24.6], [i * 2.5, PH + 2.35, 20], 0.08); k.beam('alu', [i * 2.5, PH + 0.5, 15.4], [i * 2.5, PH + 2.35, 20], 0.08); }
  k.pipe('safety', [-66, PH + 0.3, 28], [56, PH + 0.3, 28], 0.05, 6);
  k.flat('pad', 120, 1.0, -5, PH + 0.06, 12.5); k.flat('pad', 1.0, 14, -20, PH + 0.06, 20);

  // emergency department wing and ambulance canopy
  block(k, -100, -8, -70, 30, 0, {
    floors: 1, floorH: 5.4, style: P.ed, wall: P.pmat, bay: 3.75, winW: 2.4, winH: 2.0, sill: 1.1, parapet: 0.9, roof: 'roofGravel', plinth: 'precast', ledge: pBrick ? 'precast' : null,
    sides: { E: { style: 'none' }, S: { style: 'curtain', bay: 3, spH: 1.6 } },
  });
  rtu(k, -92, 5.4, 4, 0, 1.3); rtu(k, -80, 5.4, 16, PI / 2, 1.3); exFan(k, -86, 5.4, 22); exFan(k, -78, 5.4, -2);
  k.box('white', 23, 1.2, 12, -87.5, 4.5, 36.2);
  k.box('aluLight', 23.2, 0.12, 12.2, -87.5, 5.7, 36.2);
  for (const cx of [-97.5, -87.5, -77.5]) { k.box(P.pmat, 0.7, 4.5, 0.7, cx, 0, 41); k.box('precast', 0.9, 0.9, 0.9, cx, 0, 41); }
  for (let i = 0; i < 6; i++) k.box('lamp', 1.2, 0.04, 0.3, -96 + i * 3.4, 4.46, 36);
  const em = { bg: '#9c1f1f', color: '#ffffff', glow: true };
  k.sign('EMERGENCY', em, 1.0, -87.5, 4.6, 42.23);
  k.sign('EMERGENCY', em, 1.0, -99.03, 4.6, 36.2, -PI / 2);
  k.flat('slabFlat', 30, 12, -85, 0.04, 36);
  ambulance(k, -90, 34.5, PI); ambulance(k, -104, 47, PI / 2 + 0.1);

  // main entrance: glazed lobby, vestibule, porte-cochere
  block(k, lob0, 29.8, lob1, 35, 0, { floors: 2, floorH: 5.0, style: 'curtain', bay: 3, spH: 0.8, parapet: 0.6, wall: 'alu', coping: 'alu', sides: { N: { style: 'none' } } });
  block(k, 6, 34.8, 14, 37.6, 0, { floors: 1, floorH: 3.3, style: 'curtain', bay: 2, spH: 0.5, parapet: 0.2, wall: 'alu', coping: 'alu', sides: { N: { style: 'none' } } });
  k.box('white', 30, 0.9, 13, 10, 5.0, 43.5);
  k.box('aluLight', 30.3, 0.14, 13.3, 10, 5.9, 43.5);
  for (const cx of [-2.5, 10, 22.5]) for (const cz of [39, 48.5]) { k.cyl('precast', 0.38, 5.0, cx, 0, cz, 14); k.cyl('steelDark', 0.5, 0.5, cx, 0, cz, 14); }
  for (let i = 0; i < 8; i++) for (const lz of [41, 46]) k.box('lamp', 0.7, 0.04, 0.7, -2 + i * 3.5, 4.96, lz);
  k.sign(name, { color: '#f4f4ef', bg: '#2a3138', glow: true }, 0.8, 10, 5.05, 50.03);
  // building identity signs
  const nm2 = name.replace(' MEDICAL CENTER', '');
  k.sign(nm2, { color: tBrick ? '#f1efe8' : '#1f3d5c', glow: true }, 2.1, P.tx1 - 18, TY - 0.75, tz1 + 0.06);
  k.sign(nm2, { color: tBrick ? '#f1efe8' : '#1f3d5c', glow: true }, 1.7, P.tx1 + 0.08, TY - 0.6, tz0 + 12, PI / 2);

  // central plant wing, cooling towers, stacks, loading dock
  block(k, 60, -30, 94, -4, 0, { floors: 1, floorH: 10, style: 'solid', wall: 'precast', parapet: 1.0, roof: 'roof', plinth: 'panelDark' });
  for (const lx of [66, 75, 84]) k.box('louver', 6, 3.2, 0.12, lx, 5.2, -30.05);
  k.at(94, 0, -4.3, PI / 2);
  k.box('louver', 5, 3, 0.12, 5, 5.5, 0.05); k.box('louver', 5, 3, 0.12, 19, 5.5, 0.05);
  rollDoor(k, 4, 4.5, 12, 0, 0.02); manDoor(k, 22.5, 0, 0.02); manDoor(k, 2, 0, 0.02);
  k.pop();
  for (let i = 0; i < 3; i++) k.box('coping', 34.1, 0.1, 0.06, 77, 2.5 + i * 2.5, -3.97), k.box('coping', 0.06, 0.1, 26.1, 94.03, 2.5 + i * 2.5, -17);
  for (const cx of [67.5, 76, 84.5]) coolingTower(k, cx, 10, -21, 7.4, 4.4);
  k.box('steelDark', 26, 0.3, 0.3, 76, 10.4, -25.2); k.box('steelDark', 26, 0.3, 0.3, 76, 10.4, -16.8);
  k.pipe('pipeBlue', [64, 10.6, -14.5], [88, 10.6, -14.5], 0.3, 10); k.pipe('pipeBlue', [64, 10.6, -13.4], [88, 10.6, -13.4], 0.3, 10);
  for (const sz of [-8, -11]) { k.cyl('steel', 0.5, 13, 90.5, 10, sz, 14); k.cyl('steelDark', 0.56, 0.3, 90.5, 22.7, sz, 14); k.cyl('steel', 0.7, 1.2, 90.5, 10, sz, 14); }
  rtu(k, 64, 10, -8, 0, 1.3); exFan(k, 70, 10, -8, 1.4); exFan(k, 74, 10, -8, 1.4);
  // dock on the south face of the plant
  k.box('slab', 22, 1.2, 4, 73, 0, -2);
  for (const dx of [66, 72, 78]) { rollDoor(k, 2.7, 3, dx, 1.2, -3.98); k.box('rubber', 0.3, 0.5, 0.15, dx - 1.2, 0.6, 0.06); k.box('rubber', 0.3, 0.5, 0.15, dx + 1.2, 0.6, 0.06); }
  manDoor(k, 82.5, 1.2, -3.98);
  k.box('aluLight', 22, 0.2, 4.5, 73, 5.0, -1.75);
  for (let i = 0; i < 5; i++) k.box('slab', 1.4, 1.2 - i * 0.24, 0.3, 84.7, 0, -3.7 + 0.0 + i * 0.3 + 1.5);
  k.box('utilGreen', 2.4, 2.4, 5.5, 89, 0, 0.5);
  boxTruck(k, 72, 5.2, PI / 2);
  k.flat('slabFlat', 52, 34, 86, 0.04, 13);
  // bulk oxygen
  k.box('slab', 9, 0.2, 11, 104, 0, 17);
  for (const tz of [14, 18]) { k.cyl('white', 1.25, 8.5, 102.5, 0.8, tz, 18); k.cyl('white', 1.25, 0.6, 102.5, 9.3, tz, 18, 0.5); for (const a of [0, 2.1, 4.2]) k.box('steel', 0.12, 0.8, 0.12, 102.5 + Math.cos(a) * 1.0, 0.2, tz + Math.sin(a) * 1.0); }
  k.box('louver', 2.2, 3.2, 3.5, 106, 0.2, 19.5); k.box('galv', 1.2, 1.4, 1.0, 106, 0.2, 14);
  fenceRun(k, [[99.6, 11.7], [108.4, 11.7], [108.4, 22.3], [99.6, 22.3]], 2.4, true);
  bollards(k, [[99, 11], [102, 11], [105, 11], [108, 11], [109, 14], [109, 18], [109, 22]]);
  // utility tie-in on the east wall of the plant: pad transformers and a trench toward the yard
  padTransformer(k, 96.8, -1.4, PI / 2); padTransformer(k, 96.8, 2.4, PI / 2);
  bollards(k, [[98.8, -3], [98.8, -0.5], [98.8, 1.5], [98.8, 4]]);
  k.flat('slabFlat', 4, 1.6, 96, 0.07, -21);
  k.box('galv', 0.5, 6, 0.3, 94.2, 0, -21); k.box('galv', 1.2, 1.8, 0.4, 94.25, 0.6, -19.4);
  k.flat('gravel', 52, 40, 123, 0.03, -21);

  // ---- site: drives, lots, walks, landscape
  const A = 'asphalt';
  k.flat(A, 8, 196, -114, 0.03, 48);          // west leg
  k.flat(A, 8, 196, 156, 0.03, 48);           // east leg
  k.flat(A, 262, 8, 21, 0.03, -46);           // north drive
  k.flat(A, 262, 8, 21, 0.03, 64);            // front drive
  k.flat(A, 12, 82, 10, 0.03, 109);           // entry boulevard
  k.flat(A, 68, 25, 10, 0.03, 47.5);          // drop-off court
  k.flat(A, 40, 30, -90, 0.03, 45);           // ambulance apron
  k.flat(A, 32, 8, 136, 0.03, 13);            // service court link
  for (const [x, z, w, d] of [[-114, 48, 0.12, 190], [156, 48, 0.12, 190], [21, -46, 256, 0.12], [21, 64, 256, 0.12]]) {
    const n = Math.floor(Math.max(w, d) / 9);
    for (let i = 0; i < n; i++) k.flat('paintY', w > d ? 3 : 0.12, w > d ? 0.12 : 3, x + (w > d ? -w / 2 + i * 9 + 3 : 0), 0.05, z + (w > d ? 0 : -d / 2 + i * 9 + 3));
  }
  k.box('paving', 5, 0.16, 62, 10, 0, 109); k.flat('dg', 4.2, 61, 10, 0.18, 109); // boulevard median
  for (let z = 84; z < 138; z += 9) tree(k, z % 2 ? 'oak' : 'mesquite', 10, z, 0.9);
  // drop-off island
  { const g = new THREE.CylinderGeometry(1, 1, 0.16, 28); g.scale(20, 1, 3.6); k.addM('paving', g, new THREE.Matrix4().setPosition(10, 0.08, 54.8)); }
  { const g = new THREE.CircleGeometry(1, 28); g.rotateX(-PI / 2); g.scale(19.5, 1, 3.2); k.addM('dg', g, new THREE.Matrix4().setPosition(10, 0.18, 54.8)); }
  for (const fx of [7, 10, 13]) { k.cyl('aluLight', 0.07, 11, fx, 0.16, 54.8, 8, 0.04); k.cyl('aluLight', 0.1, 0.1, fx, 11.16, 54.8, 8); }
  for (let i = 0; i < 26; i++) { const x = -7 + r() * 34, z = 53 + r() * 3.6; if (Math.abs(x - 10) < 4) continue; k.inst(r() < 0.5 ? 'tree:yucca' : 'tree:sage', x, 0.16, z, r() * 6, 0.8 + r()); }
  tree(k, 'mesquite', -4, 54.8, 0.7); tree(k, 'mesquite', 24, 54.8, 0.7);
  // walks
  k.box('paving', 65, 0.16, 5, -37.5, 0, 32.5); k.box('paving', 35, 0.16, 5, 42.5, 0, 32.5);
  k.box('paving', 34, 0.16, 3.4, 10, 0, 36.7);
  k.box('paving', 200, 0.16, 3.6, 0, 0, 69.9);
  k.box('paving', 3, 0.16, 190, -108.5, 0, 48); k.box('paving', 130, 0.16, 3, -5, 0, -31.5);
  for (const cx of [-14, 34]) for (let i = 0; i < 8; i++) k.flat('paintW', 0.5, 3.2, cx - 3 + i * 0.9, 0.05, 64);
  // beds along the front
  bed(k, -68, 35.2, -24, 38.4, { density: 0.12 }); bed(k, 44, 35.2, 59, 38.4, { density: 0.12 });
  bed(k, -68, -41, 58, -33.2, { density: 0.02 });
  for (const tx of [-60, -46, -32, 48, 56]) tree(k, 'oak', tx, 37, 0.75);
  for (let x = -60; x < 60; x += 17) tree(k, r() < 0.5 ? 'mesquite' : 'oak', x + r() * 4, -37.5, 0.9);
  for (let x = -96; x < 100; x += 14) if (Math.abs(x - 10) > 12) tree(k, 'oak', x, 70, 0.75);
  bed(k, -68, 40.5, -27, 58.5, { density: 0.03 }); bed(k, 47, 40.5, 110, 58.5, { density: 0.03 });
  for (const [tx, tz, tk] of [[-60, 50, 'mesquite'], [-44, 46, 'oak'], [-34, 54, 'mesquite'], [56, 50, 'oak'], [72, 46, 'mesquite'], [90, 52, 'mesquite'], [104, 46, 'oak'], [-104, 20, 'mesquite'], [-104, -20, 'mesquite'], [130, 40, 'mesquite'], [140, 100, 'mesquite'], [118, 80, 'mesquite']]) tree(k, tk, tx, tz, 0.85);
  for (let i = 0; i < 60; i++) { const x = 112 + r() * 36, z = 20 + r() * 120; if (z < 68 || x > 108) k.inst('tree:shrub', x, 0, z, r() * 6, 0.6 + r() * 0.8); }
  // lots
  k.at(-104, 0, 72); parking(k, 104, 58, { fill: 0.62, trees: 'oak' }); k.pop();
  k.at(20, 0, 72); parking(k, 128, 58, { fill: 0.5, trees: 'oak' }); k.pop();
  k.at(-104, 0, -72); parking(k, 250, 20, { fill: 0.7, trees: 'mesquite' }); k.pop();
  k.at(-150, 0, 60, PI / 2); parking(k, 62, 30, { fill: 0.45, trees: 'mesquite' }); k.pop();
  for (let z = -40; z < 140; z += 30) { pole(k, -109.5, z, 9, 1, 0); pole(k, 151.5, z, 9, 1, PI); }
  for (const px of [-60, -30, 40, 70]) pole(k, px, 59.5, 9, 1, -PI / 2);
  // monument sign at the entry
  k.at(22, 0, 143);
  k.box(pBrick ? 'brick' : 'precast', 8, 0.7, 1.4, 0, 0, 0); k.box('precast', 6.6, 1.9, 0.7, 0, 0.7, 0); k.box('coping', 6.9, 0.1, 0.9, 0, 2.6, 0);
  for (const s of [1, -1]) {
    k.sign(name.replace(' MEDICAL', '\nMEDICAL'), { color: '#1f3d5c' }, 1.15, 0, 1.25, s * 0.36, s > 0 ? 0 : PI);
    k.sign('EMERGENCY', { bg: '#9c1f1f', color: '#ffffff', glow: true }, 0.38, 0, 0.8, s * 0.37, s > 0 ? 0 : PI);
  }
  k.pop();
  bed(k, 16, 140.5, 28, 146, { density: 0.25 });

  return finish(group, k, {
    id: opts.id, variant, seed,
    size: { x: 314, y: coreTop + 0.6, z: 224 },
    hudAnchor: new V3(tcx, coreTop + 8, -6),
    focus: { center: new V3(0, TY * 0.45, 5), radius: 110 },
    yardAnchor: { position: new V3(98, 0, -21), heading: PI / 2, dir: new V3(1, 0, 0), clear: { w: 38, d: 50 } },
    entry: { x: 10, z: 150 },
    bounds: { x0: -152, x1: 162, z0: -74, z1: 150 },
  });
}

// ---------------------------------------------------------------- data centers

function dcHyperscale(k, o) {
  const r = k.rand, n = clamp(o.halls ?? 2, 1, 6), HL = 150, HW = 45, HH = 11, pitch = HW + 34;
  const hz = (i) => (i - (n - 1) / 2) * pitch + 7;
  const zN = hz(0) - 38.5, zS = hz(n - 1) + 22.5, cz = (hz(0) + hz(n - 1)) / 2;
  const X0 = -178, X1 = 124, Z0 = zN - 40, Z1 = zS + 48;
  k.flat('turf', X1 - X0, Z1 - Z0, (X0 + X1) / 2, 0.02, (Z0 + Z1) / 2);

  for (let i = 0; i < n; i++) {
    const zc = hz(i);
    k.aligned = true;
    k.box('tilt', HL, 12.2, 0.3, 0, 0, zc + HW / 2 - 0.15); k.box('tilt', HL, 12.2, 0.3, 0, 0, zc - HW / 2 + 0.15);
    k.box('tilt', 0.3, 12.2, HW - 0.6, HL / 2 - 0.15, 0, zc); k.box('tilt', 0.3, 12.2, HW - 0.6, -HL / 2 + 0.15, 0, zc);
    k.aligned = false;
    k.box('core', HL - 0.6, HH, HW - 0.6, 0, 0, zc);
    k.flat('roof', HL - 0.6, HW - 0.6, 0, HH + 0.03, zc);
    k.box('coping', HL + 0.16, 0.08, 0.46, 0, 12.2, zc + HW / 2 - 0.15); k.box('coping', HL + 0.16, 0.08, 0.46, 0, 12.2, zc - HW / 2 + 0.15);
    k.box('coping', 0.46, 0.08, HW - 0.6, HL / 2 - 0.15, 12.2, zc); k.box('coping', 0.46, 0.08, HW - 0.6, -HL / 2 + 0.15, 12.2, zc);
    // south wall: doors, louvers, downspouts, dock
    k.at(-75, 0, zc + HW / 2, 0);
    for (let x = 7.5; x < 150; x += 15) { k.box('steelDark', 0.14, 10.4, 0.12, x, 0.3, 0.06); k.box('steelDark', 0.4, 0.3, 0.2, x, 10.6, 0.1); k.box('lamp', 0.4, 0.14, 0.12, x + 3.75, 5.2, 0.06); }
    for (const x of [22, 60, 97]) manDoor(k, x, 0, 0.02, 0, 0.5);
    for (const x of [33.75, 71.25, 108.75]) k.box('louver', 5.5, 2.6, 0.12, x, 6.3, 0.05);
    k.box('slab', 16, 1.2, 0.5, 136, 0, 0.25);
    for (const x of [131, 136, 141]) { rollDoor(k, 2.7, 3, x, 1.2, 0.02); k.box('rubber', 3.3, 3.4, 0.4, x, 1.1, 0.2); k.box('dark', 2.7, 3, 0.42, x, 1.2, 0.2); }
    rollDoor(k, 4, 4.6, 123, 0, 0.02);
    k.pop();
    k.flat('asphalt', 162, 18, 4, 0.03, zc + HW / 2 + 9);
    if (i % 2 === 0) boxTruck(k, 61, zc + HW / 2 + 7.3, PI / 2, 13);
    // north wall and the chiller yard
    const zp = zc - HW / 2 - 9.5;
    k.at(75, 0, zc - HW / 2, PI);
    for (let x = 7.5; x < 150; x += 15) k.box('steelDark', 0.14, 10.4, 0.12, x, 0.3, 0.06);
    for (const x of [30, 75, 120]) manDoor(k, x, 0, 0.02, 0, 0.5);
    k.pop();
    k.flat('slabFlat', 146, 13, 0, 0.05, zp);
    for (let c = 0; c < 10; c++) {
      const cx = -63 + c * 14;
      chiller(k, cx, 0.05, zp, 0);
      k.pipe('pipeBlue', [cx + 5, 3.4, zc - HW / 2 - 0.7], [cx + 5, 3.4, zp + 0.6], 0.13, 6);
      k.pipe('pipeBlue', [cx + 5, 3.4, zp + 0.6], [cx + 5, 1.6, zp + 0.6], 0.13, 6);
      k.box('steel', 0.14, 3.9, 0.14, cx + 7, 0, zc - HW / 2 - 1.0);
    }
    k.pipe('pipeBlue', [-68, 3.4, zc - HW / 2 - 0.7], [70, 3.4, zc - HW / 2 - 0.7], 0.26, 10);
    k.pipe('pipeGrey', [-68, 4.0, zc - HW / 2 - 0.7], [70, 4.0, zc - HW / 2 - 0.7], 0.26, 10);
    // east wall: louvers, electrical rooms, bus duct toward the substation
    k.at(75, 0, zc + HW / 2 - 0.3, PI / 2);
    for (const x of [8, 22.2, 36.4]) k.box('louver', 8, 3.4, 0.12, x, 5.6, 0.05);
    manDoor(k, 15, 0, 0.02); manDoor(k, 29.5, 0, 0.02);
    k.pop();
    k.box('galv', 13, 0.6, 1.0, 81.5, 4.4, zc); k.box('galv', 1.0, 0.6, Math.abs(zc - cz) + 1, 88, 4.4, (zc + cz) / 2);
    for (let s = 0; s <= Math.abs(zc - cz); s += 7) k.box('steel', 0.16, 4.4, 0.16, 88, 0, zc + Math.sign(cz - zc) * s);
    k.box('steel', 0.16, 4.4, 0.16, 81, 0, zc);
    // roof: walkway pads, drains, fan-wall cooling units in two rows, headers, cable tray
    k.flat('pad', 146, 1.2, 0, HH + 0.06, zc + 5.5); k.flat('pad', 146, 1.2, 0, HH + 0.06, zc - 5.5);
    for (let x = -60; x <= 60; x += 30) { k.flat('pad', 1.2, 42, x, HH + 0.06, zc); for (const dz of [-19, 19]) k.flat('pad', 0.7, 0.7, x + 9, HH + 0.07, zc + dz); }
    for (let u = 0; u < 16; u++) for (const s of [-1, 1]) fanUnit(k, -64.5 + u * 8.6, HH, zc + s * 13.5);
    for (const s of [-1, 1]) { k.pipe('pipeBlue', [-70, HH + 0.55, zc + s * 10.6], [70, HH + 0.55, zc + s * 10.6], 0.22, 8); k.pipe('pipeGrey', [-70, HH + 0.55, zc + s * 9.9], [70, HH + 0.55, zc + s * 9.9], 0.22, 8); }
    k.box('galv', 140, 0.25, 0.9, 0, HH + 0.3, zc);
    for (let x = -66; x <= 66; x += 12) k.box('steelDark', 0.2, 0.3, 22, x, HH, zc);
    for (let j = 0; j < 5; j++) exFan(k, -70 + r() * 140, HH, zc + (r() - 0.5) * 6 + 2.5, 1.1);
  }

  // head house spine and the office block
  const sA = hz(0) - HW / 2, sB = zS;
  block(k, -85, sA, -74.9, sB, 0, { floors: 1, floorH: 7.4, style: 'solid', wall: 'panelDark', parapet: 0.8, roof: 'roof', sides: { E: { style: 'none' } } });
  const aL = Math.min(60, sB - sA), a0 = cz - aL / 2, a1 = cz + aL / 2;
  block(k, -103, a0, -84.9, a1, 0, {
    floors: 2, floorH: 4.6, style: 'ribbon', wall: 'panelDark', bay: 3, winH: 1.9, sill: 1.0, mull: [0.5], parapet: 1.3, roof: 'roof',
    sides: { W: { style: 'curtain', bay: 3, spH: 1.1 }, E: { style: 'none' } },
  });
  k.box('aluLight', 7, 0.35, 10, -106.5, 3.5, cz); k.box('steelDark', 0.3, 3.5, 0.3, -109.4, 0, cz - 4.4); k.box('steelDark', 0.3, 3.5, 0.3, -109.4, 0, cz + 4.4);
  rtu(k, -94, 9.2, cz - 12, 0, 1.3); rtu(k, -94, 9.2, cz, 0, 1.3); rtu(k, -94, 9.2, cz + 12, 0, 1.3);
  k.box('paving', 6, 0.16, aL, -106, 0, cz);
  bollards(k, Array.from({ length: 9 }, (_, i) => [-109.6, cz - 8 + i * 2]), 'steel', 1.0);

  // substation stub and tie to the power yard
  fenceRun(k, [[86, cz - 21], [121, cz - 21], [121, cz + 21], [86, cz + 21]], 2.6, true, [[1, 18, 24]]);
  k.flat('gravel', 35, 42, 103.5, 0.035, cz);
  bigTransformer(k, 96, cz - 10, 0); bigTransformer(k, 96, cz + 10, 0);
  k.box('precast', 8, 6.5, 0.4, 96, 0, cz);
  k.box('white', 5, 3.6, 24, 110, 1.0, cz); for (let z = -10; z <= 10; z += 5) k.box('slab', 5, 1.0, 0.5, 110, 0, cz + z);
  k.box('galv', 1.4, 1.5, 0.9, 112.9, 1.6, cz - 8); k.box('galv', 1.4, 1.5, 0.9, 112.9, 1.6, cz + 8);
  manDoor(k, 107.48, 1.0, cz + 4, -PI / 2);
  for (const s of [-1, 1]) { k.cyl('steel', 0.22, 13, 117, 0, cz + s * 6, 8, 0.14); }
  k.box('steel', 0.3, 0.3, 13, 117, 11.5, cz);
  for (const dz of [-4, 0, 4]) { k.cyl('ceramic', 0.1, 1.3, 117, 10.2, cz + dz, 8); k.pipe('steel', [117, 10.2, cz + dz], [110, 4.7, cz + dz], 0.025, 4); }
  k.cyl('steel', 0.12, 17, 119.5, 0, cz - 14, 6, 0.04);
  k.flat('slabFlat', 12, 1.6, 120, 0.07, cz);

  // perimeter road, drives, fence, gate
  const A = 'asphalt';
  k.flat(A, X1 - X0 - 12, 8, (X0 + X1) / 2, 0.03, Z0 + 12); k.flat(A, X1 - X0 - 12, 8, (X0 + X1) / 2, 0.03, Z1 - 12);
  k.flat(A, 8, Z1 - Z0 - 24, X0 + 10, 0.03, (Z0 + Z1) / 2); k.flat(A, 8, Z1 - Z0 - 32, 81, 0.03, (Z0 + Z1) / 2);
  k.flat(A, 56, 8, -140, 0.03, cz);
  k.at(-150, 0, cz + 31, PI / 2); parking(k, 62, 38, { fill: 0.28, trees: null }); k.pop();
  fenceRun(k, [[X1, Z0], [X0, Z0], [X0, Z1], [X1, Z1]], 2.6, false, [[2, 31, 45]]);
  fenceRun(k, [[X1, Z0], [X1, Math.min(Z0, cz - 70) + Math.max(0, cz - 70 - Z0)]], 2.6); fenceRun(k, [[X1, Z1], [X1, Math.max(cz + 70, Z1) - Math.max(0, Z1 - cz - 70)]], 2.6);
  for (let x = X0 + 30; x < X1 - 20; x += 44) { pole(k, x, Z0 + 6.5, 10, 1, -PI / 2); pole(k, x, Z1 - 6.5, 10, 1, PI / 2); }
  // gatehouse with boom gates
  const gx = -140, gz = Z1;
  k.flat(A, 14, 42, gx, 0.03, gz + 5);
  k.box('paving', 3.2, 0.2, 9, gx, 0, gz - 3);
  block(k, gx - 1.4, gz - 6, gx + 1.4, gz - 1.5, 0.2, { floors: 1, floorH: 3.0, style: 'ribbon', wall: 'panelDark', bay: 1.3, winH: 1.3, sill: 1.0, mull: [], parapet: 0.2, roof: 'roof' });
  k.box('aluLight', 16, 0.4, 8, gx, 4.6, gz - 3.5);
  for (const sx of [-7.4, 7.4]) for (const sz of [-6.5, -0.5]) k.box('steelDark', 0.3, 4.6, 0.3, gx + sx, 0, gz + sz);
  for (const s of [-1, 1]) { k.box('safety', 0.5, 1.1, 0.5, gx + s * 1.9, 0, gz + 0.5); k.box('white', 4.6, 0.12, 0.1, gx + s * 4.2, 1.05, gz + 0.5); k.box('lampAmber', 0.14, 0.1, 0.12, gx + s * 6.3, 1.06, gz + 0.5); }
  bollards(k, [[gx - 7.6, gz + 2], [gx - 7.6, gz + 4], [gx + 7.6, gz + 2], [gx + 7.6, gz + 4], [gx, gz + 2.4], [gx - 0.8, gz + 2.4], [gx + 0.8, gz + 2.4]]);
  k.sign('VISITOR CHECK-IN', { bg: '#2a3138', color: '#f1f1ec' }, 0.5, gx, 3.3, gz - 1.45);
  car(k, gx + 4, gz + 9, PI / 2, 'suv');
  // fire water tanks and pump house
  tank(k, -138, 0, zN - 14, 8, 10, 'tankWhite', { rail: true }); tank(k, -118, 0, zN - 14, 8, 10, 'tankWhite', { rail: true, ladderA: 2.2 });
  block(k, -104, zN - 19, -94, zN - 11, 0, { floors: 1, floorH: 4.5, style: 'solid', wall: 'precast', parapet: 0.5, roof: 'roof' });
  rollDoor(k, 3, 3.2, -99, 0, zN - 10.98);
  k.pipe('pipeGrey', [-130, 0.6, zN - 14], [-104, 0.6, zN - 14], 0.2, 8);
  // detention pond
  { const g = new THREE.CircleGeometry(1, 28); g.rotateX(-PI / 2); g.scale(29, 1, 10.5); k.addM('gravel', g, new THREE.Matrix4().setPosition(20, 0.05, Z1 - 28)); }
  { const g = new THREE.CircleGeometry(1, 28); g.rotateX(-PI / 2); g.scale(26, 1, 8); k.addM('water', g, new THREE.Matrix4().setPosition(20, 0.07, Z1 - 28)); }
  for (let i = 0; i < 14; i++) tree(k, 'decid', X0 + 6 + r() * 3, Z0 + 20 + i * ((Z1 - Z0 - 40) / 14), 0.7);

  return {
    size: { x: X1 - X0, y: 15, z: Z1 - Z0 + 30 },
    hudAnchor: new V3(0, 22, cz), focus: { center: new V3(-10, 6, cz), radius: 90 + n * 34 },
    yardAnchor: { position: new V3(126, 0, cz), heading: PI / 2, dir: new V3(1, 0, 0), clear: { w: 140, d: 72 } },
    entry: { x: gx, z: Z1 + 26 }, bounds: { x0: X0, x1: X1, z0: Z0, z1: Z1 + 26 },
  };
}

// Small West Texas edge site: prefabricated data modules on a gravel lot inside a chain-link fence.
function dcEdge(k, o) {
  const r = k.rand, nm = clamp(o.modules ?? 4, 2, 6), px = 8.4, x0 = -((nm - 1) * px) / 2;
  k.flat('gravel', 96, 72, -2, 0.03, 0);
  // central spine corridor
  const sl = nm * px + 2;
  k.box('slab', sl + 1, 0.5, 4, 0, 0, 0);
  k.box('ribLight', sl, 3.4, 3.2, 0, 0.5, 0); k.box('coping', sl + 0.2, 0.1, 3.4, 0, 3.9, 0);
  k.box('galv', sl - 2, 0.3, 0.8, 0, 4.0, 0);
  for (let i = 0; i < nm; i++) for (const s of [-1, 1]) {
    const mx = x0 + i * px, mz = s * 8.6;
    for (const dz of [-5.5, 0, 5.5]) k.box('slab', 4.0, 0.5, 0.6, mx, 0, mz + dz);
    k.box('white', 3.7, 3.5, 13.6, mx, 0.5, mz);
    k.box('steelDark', 3.74, 0.18, 13.64, mx, 0.5, mz); k.box('coping', 3.8, 0.08, 13.7, mx, 4.0, mz);
    for (const dz of [-4.5, 0, 4.5]) k.box('steelDark', 3.72, 3.4, 0.08, mx, 0.55, mz + dz);
    k.box('louver', 2.6, 1.6, 0.1, mx, 1.6, mz + s * 6.83, 0);
    k.box('door', 0.08, 2.1, 1.0, mx + 1.86, 0.6, mz + s * 4);
    rtu(k, mx, 4.05, mz - 2.5, PI / 2, 0.9); rtu(k, mx, 4.05, mz + 3, PI / 2, 0.9);
    k.box('galv', 0.5, 0.25, 9, mx - 1.2, 4.05, mz - s * 2);
    k.sign('MOD ' + (i * 2 + (s > 0 ? 1 : 2)), { color: '#3b4046' }, 0.45, mx, 2.9, mz + s * 6.84, s > 0 ? 0 : PI);
  }
  // support building: network room and office
  const bx = x0 - 16;
  block(k, bx - 7, -5.5, bx + 7, 5.5, 0, { floors: 1, floorH: 4.2, style: 'punched', wall: 'precast', bay: 3.4, winW: 1.6, winH: 1.4, sill: 1.3, mull: [], parapet: 0.6, roof: 'roof', plinth: 'panelDark', sides: { E: { style: 'solid' }, N: { style: 'solid' } } });
  manDoor(k, bx + 3.4, 0, 5.52); rtu(k, bx, 4.2, 0, 0, 1.2);
  k.box('ribLight', 6, 3.0, 3.2, x0 - 6, 0.5, 0);
  // cooling plant and power
  const cxp = -x0 + 10;
  k.box('slab', 15, 0.2, 9, cxp + 1, 0, -19);
  chiller(k, cxp + 1, 0.2, -21, 0, 9, 5); chiller(k, cxp + 1, 0.2, -17, 0, 9, 5);
  k.pipe('pipeBlue', [cxp - 4, 1.2, -19], [cxp - 4, 1.2, -1], 0.14, 6); k.pipe('pipeBlue', [cxp - 4, 1.2, -1], [sl / 2, 1.2, -1], 0.14, 6);
  tank(k, cxp + 4, 0, -29, 2.6, 4.6, 'tankBlack', { cone: 0.5, seg: 18 });
  padTransformer(k, cxp - 3, 6, 0, 1.2); padTransformer(k, cxp + 1, 6, 0, 1.2);
  k.box('utilGrey', 7, 2.4, 1.6, cxp - 1, 0.2, 10.5); k.box('slab', 8, 0.2, 2.4, cxp - 1, 0, 10.5);
  bollards(k, [[cxp - 6, 3.6], [cxp - 3, 3.6], [cxp, 3.6], [cxp + 3, 3.6]]);
  k.flat('slabFlat', 1.4, 12, cxp + 5.5, 0.06, 8);
  // lattice telecom mast
  const tx = bx - 6, tz = -24, th = 28;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2, b = ((i + 1) / 3) * PI * 2;
    k.beam('galv', [tx + Math.cos(a) * 1.4, 0, tz + Math.sin(a) * 1.4], [tx + Math.cos(a) * 0.35, th, tz + Math.sin(a) * 0.35], 0.1);
    for (let j = 0; j < 12; j++) {
      const y0 = (j * th) / 12, y1 = ((j + 1) * th) / 12, r0 = lerp(1.4, 0.35, j / 12), r1 = lerp(1.4, 0.35, (j + 1) / 12);
      k.beam('galv', [tx + Math.cos(a) * r0, y0, tz + Math.sin(a) * r0], [tx + Math.cos(b) * r1, y1, tz + Math.sin(b) * r1], 0.04);
      k.beam('galv', [tx + Math.cos(a) * r1, y1, tz + Math.sin(a) * r1], [tx + Math.cos(b) * r1, y1, tz + Math.sin(b) * r1], 0.04);
    }
  }
  for (const [dy, a] of [[24, 0.5], [21, 2.8], [26, 4.4]]) { const g = new THREE.CylinderGeometry(0.6, 0.6, 0.25, 14); g.rotateZ(PI / 2); g.rotateY(a); k.addM('white', g, new THREE.Matrix4().setPosition(tx + Math.cos(a) * 0.8, dy, tz - Math.sin(a) * 0.8)); }
  k.box('lampAmber', 0.2, 0.2, 0.2, tx, th, tz);
  k.box('ribLight', 3, 2.6, 2.4, tx + 4, 0.2, tz);
  // storage container, vehicles, lights
  k.box('ribGreen', 6.06, 2.6, 2.44, bx - 2, 0, 22, 0.1);
  car(k, bx - 4, 10.5, PI / 2, 'pickup'); car(k, bx - 0.8, 10.3, PI / 2, 'pickup'); car(k, bx + 2.6, 10.6, -PI / 2, 'suv');
  for (const [lx, lz] of [[-46, -32], [40, -32], [-46, 32], [40, 32]]) pole(k, lx, lz, 9, 1, lx < 0 ? 0 : PI);
  // fence with sliding gate, caliche drive to the road
  const F = [[-50, -36], [46, -36], [46, 36], [-50, 36]];
  fenceRun(k, F, 2.4, true, [[2, 62, 70]]);
  k.box('steel', 8.4, 0.06, 0.06, -29, 2.3, 36.4); k.at(-33, 0, 36.4); k.quad('fence', 8.4, 2.3, 4, 0, 0); k.pop();
  k.flat('calicheFlat', 8, 34, -20, 0.04, 53); k.flat('calicheFlat', 30, 7, -20, 0.045, 24);
  k.sign('PERMIAN EDGE\nDATA CENTER', { bg: '#e9e7e0', color: '#2a3138' }, 1.1, -11, 0.9, 36.5);
  k.box('steel', 0.08, 2.0, 0.08, -12.6, 0, 36.45); k.box('steel', 0.08, 2.0, 0.08, -9.4, 0, 36.45);
  for (let i = 0; i < 26; i++) { const a = r() * 6.28, d = 60 + r() * 30; k.inst('tree:shrub', Math.cos(a) * d * 1.1, 0, Math.sin(a) * d * 0.8, r() * 6, 0.8 + r()); }
  return {
    size: { x: 100, y: th, z: 76 }, hudAnchor: new V3(0, 9, 0), focus: { center: new V3(0, 3, 0), radius: 48 },
    yardAnchor: { position: new V3(48, 0, 0), heading: PI / 2, dir: new V3(1, 0, 0), clear: { w: 44, d: 34 } },
    entry: { x: -20, z: 70 }, bounds: { x0: -52, x1: 48, z0: -38, z1: 70 },
  };
}

// Mid-size two story colocation building with an office frontage on a suburban lot.
function dcColo(k, o) {
  const r = k.rand, name = (o.name || 'HCC San Antonio\nData Center').toUpperCase();
  k.flat('turf', 190, 150, 6, 0.02, 22);
  // data hall block
  const hy = block(k, -48, -30, 48, 18, 0, { floors: 1, floorH: 12.4, style: 'solid', wall: 'precast', parapet: 1.2, roof: 'roof', plinth: 'panelDark', sides: { S: { style: 'none' } } });
  for (const [f, len] of [['N', 96], ['E', 47.4], ['W', 47.4]]) {
    const F = faces(-48, -30, 48, 18)[f];
    k.at(F.x, 0, F.z, F.ry);
    for (let x = (len % 8) / 2; x <= len + 0.01; x += 8) k.box('precast', 0.9, 13.4, 0.35, x, 0, 0.17);
    k.box('panelDark', len, 1.1, 0.07, len / 2, 9.2, 0.035); k.box('panelDark', len, 0.35, 0.07, len / 2, 4.6, 0.035);
    k.pop();
  }
  // rooftop mechanical well behind a screen wall
  const sx0 = -40, sx1 = 40, sz0 = -24, sz1 = 10;
  for (const [x, z, w, d] of [[0, sz0, sx1 - sx0, 0.15], [0, sz1, sx1 - sx0, 0.15], [sx0, (sz0 + sz1) / 2, 0.15, sz1 - sz0], [sx1, (sz0 + sz1) / 2, 0.15, sz1 - sz0]]) { k.box('ribDark', w, 3.0, d, x, hy + 0.5, z); }
  for (let x = sx0; x <= sx1; x += 8) for (const z of [sz0, sz1]) k.box('steelDark', 0.2, 3.5, 0.2, x, hy, z);
  for (let i = 0; i < 6; i++) { chiller(k, -32.5 + i * 13, hy + 0.3, -18, 0, 11, 6); chiller(k, -32.5 + i * 13, hy + 0.3, 4, 0, 11, 6); }
  for (let i = 0; i < 9; i++) rtu(k, -34 + i * 8.5, hy, -7, 0, 1.5);
  k.pipe('pipeBlue', [-38, hy + 0.6, -12.5], [38, hy + 0.6, -12.5], 0.25, 8); k.pipe('pipeGrey', [-38, hy + 0.6, -1.5], [38, hy + 0.6, -1.5], 0.25, 8);
  k.flat('pad', 92, 1.1, 0, hy + 0.06, 14);
  // office frontage with a taller glazed entry
  const oy = block(k, -48, 17.8, 48, 30, 0, {
    floors: 2, floorH: 4.8, style: 'punched', wall: 'brick', bay: 4, winW: 3.0, winH: 2.6, sill: 0.9, mull: [0.33, 0.66], transom: 0.7, ledge: 'precast', plinth: 'precast', parapet: 1.2, roof: 'roof', shade: true,
    sides: { N: { style: 'none' }, S: { blank: [[37, 59]] }, E: { shade: false }, W: { shade: false } },
  });
  block(k, -10, 27, 10, 33, 0, { floors: 3, floorH: 4.5, style: 'curtain', bay: 2.5, spH: 0.9, parapet: 0.8, wall: 'alu', coping: 'alu', sides: { N: { style: 'none' } } });
  k.box('aluLight', 14, 0.35, 6, 0, 3.6, 36); k.box('steelDark', 0.28, 3.6, 0.28, -6.4, 0, 38.4); k.box('steelDark', 0.28, 3.6, 0.28, 6.4, 0, 38.4);
  k.sign(name.replace('\n', ' '), { color: '#2a3138' }, 0.9, 27, oy + 0.1, 30.06);
  rtu(k, -36, oy, 24, 0, 1.3); rtu(k, -22, oy, 24, 0, 1.3); rtu(k, 24, oy, 24, 0, 1.3); rtu(k, 38, oy, 24, 0, 1.3);
  // loading dock on the west side
  k.at(-48, 0, -29.7, -PI / 2);
  k.box('slab', 14, 1.2, 3, 12, 0, 1.5);
  for (const x of [8, 13]) { rollDoor(k, 2.7, 3, x, 1.2, 0.02); }
  rollDoor(k, 3.6, 4.2, 22, 0, 0.02); manDoor(k, 17.5, 1.2, 0.02); manDoor(k, 40, 0, 0.02);
  k.box('aluLight', 14, 0.2, 3.6, 12, 4.9, 1.8);
  k.pop();
  k.flat('asphalt', 30, 44, -66, 0.03, -10);
  boxTruck(k, -56, -17, 0, 9);
  // east side: utility tie and the yard apron
  k.at(48, 0, 17.7, PI / 2);
  manDoor(k, 6, 0, 0.02); for (const x of [16, 30]) k.box('louver', 6, 3, 0.12, x, 5, 0.05);
  k.pop();
  padTransformer(k, 51.5, 10, PI / 2, 1.3); padTransformer(k, 51.5, 5, PI / 2, 1.3);
  k.box('galv', 0.5, 5, 0.3, 48.2, 0, -6);
  k.flat('gravel', 38, 46, 73, 0.03, -7);
  k.flat('slabFlat', 6, 1.6, 51, 0.07, -6);
  // front parking, drives, walks, landscape
  k.flat('asphalt', 150, 8, 4, 0.03, 44); k.flat('asphalt', 8, 96, -80, 0.03, 0); k.flat('asphalt', 110, 8, -30, 0.03, -42);
  k.flat('asphalt', 10, 30, 0, 0.03, 100);
  k.at(-58, 0, 48); parking(k, 116, 38, { fill: 0.5, trees: 'oak' }); k.pop();
  k.box('paving', 100, 0.16, 3, 0, 0, 38.5); k.box('paving', 8, 0.16, 6, 0, 0, 35);
  k.box('paving', 3, 0.16, 20, -52, 0, 26);
  for (let i = 0; i < 26; i++) { const x = -46 + i * 3.6; if (Math.abs(x) < 11) continue; k.inst('tree:sage', x, 0, 32.2, r() * 6, 1.5 + r() * 0.4, 0x8fae7a); }
  for (const x of [-40, -24, 24, 40]) tree(k, 'oak', x, 35.5, 0.7);
  for (let i = 0; i < 12; i++) tree(k, 'oak', -84 + i * 16 + r() * 3, 92 + r() * 4, 0.9 + r() * 0.3);
  for (let i = 0; i < 8; i++) tree(k, 'oak', -90 - r() * 3, -44 + i * 17, 1.0);
  for (const [fx] of [[-4], [4]]) { k.cyl('aluLight', 0.07, 10, fx * 4, 0, 41.5, 8, 0.04); }
  // perimeter fence around the back of house
  fenceRun(k, [[-48, 14], [-86, 14], [-86, -48], [94, -48], [94, 16], [48, 16]], 2.4, false, [[0, 26, 34]]);
  for (const [lx, lz] of [[-70, -30], [-20, -37], [40, -37], [-52, 44], [0, 39.6], [52, 44]]) pole(k, lx, lz, 8, 1, PI / 2);
  // monument sign
  k.at(-12, 0, 108);
  k.box('brick', 7, 1.9, 0.9, 0, 0, 0); k.box('precast', 7.3, 0.2, 1.1, 0, 1.9, 0);
  k.sign(name, { color: '#f1efe8', bg: '#2a3138' }, 1.3, 0, 0.4, 0.47); k.sign(name, { color: '#f1efe8', bg: '#2a3138' }, 1.3, 0, 0.4, -0.47, PI);
  k.pop();
  return {
    size: { x: 190, y: 17, z: 160 }, hudAnchor: new V3(0, 24, -4), focus: { center: new V3(0, 6, 6), radius: 78 },
    yardAnchor: { position: new V3(54, 0, -7), heading: PI / 2, dir: new V3(1, 0, 0), clear: { w: 44, d: 36 } },
    entry: { x: 0, z: 115 }, bounds: { x0: -92, x1: 102, z0: -50, z1: 115 },
  };
}

const DC_VARIANTS = { hyperscale: dcHyperscale, edge: dcEdge, colo: dcColo };
export function buildDataCenter(opts = {}) {
  const variant = DC_VARIANTS[opts.variant] ? opts.variant : 'hyperscale', seed = opts.seed ?? 23;
  const k = new Kit(seed + variant.length * 101), group = new THREE.Group();
  const ud = DC_VARIANTS[variant](k, opts);
  return finish(group, k, { id: opts.id, variant, seed, ...ud });
}

// ---------------------------------------------------------------- oilfield pads

function berm(k, a, b, w = 3, h = 0.9, y = 0, mat = 'caliche') {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
  const s = new THREE.Shape(); s.moveTo(-w / 2, 0); s.lineTo(w / 2, 0); s.lineTo(w * 0.16, h); s.lineTo(-w * 0.16, h);
  k.addM(mat, new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }), new THREE.Matrix4().makeRotationY(Math.atan2(dx, dz)).setPosition(a[0], y, a[1]));
}
function wheelSet(k, xs, zHalf, rad = 0.52, w = 0.55) {
  for (const x of xs) for (const s of [-1, 1]) {
    const g = new THREE.CylinderGeometry(rad, rad, w, 12); g.rotateX(PI / 2);
    k.addM('rubber', g, new THREE.Matrix4().setPosition(x, rad, s * zHalf));
  }
}
function handwheel(k, x, y, z, axis = 'z', rad = 0.2) {
  const g = new THREE.CylinderGeometry(rad, rad, 0.035, 12);
  if (axis === 'z') g.rotateX(PI / 2); else g.rotateZ(PI / 2);
  k.addM('safety', g, new THREE.Matrix4().setPosition(x, y, z));
}
// Christmas tree: casing and tubing heads, master valves, flow cross with wing valves, cap.
function wellhead(k, x, y, z, frac = false) {
  k.at(x, y, z);
  k.cyl('steelDark', 1.3, 0.06, 0, 0, 0, 14);
  let h = 0.06;
  const sp = (rad, hh) => { k.cyl('wellGrey', rad, hh, 0, h, 0, 12); h += hh; };
  const fl = (rad = 0.4) => sp(rad, 0.07);
  const valve = () => { fl(0.3); k.box('wellGrey', 0.46, 0.46, 0.46, 0, h, 0); k.pipe('steel', [0, h + 0.23, 0.2], [0, h + 0.23, 0.5], 0.03, 5); handwheel(k, 0, h + 0.23, 0.5); h += 0.46; fl(0.3); };
  sp(0.3, 0.45); fl(); sp(0.26, 0.4); fl(); sp(0.22, 0.3);
  valve(); valve();
  k.box('wellGrey', 0.5, 0.5, 0.5, 0, h, 0);
  for (const s of [-1, 1]) {
    k.pipe('wellGrey', [s * 0.25, h + 0.25, 0], [s * 1.25, h + 0.25, 0], 0.11, 8);
    k.box('wellGrey', 0.4, 0.4, 0.4, s * 0.75, h + 0.05, 0); handwheel(k, s * 0.75, h + 0.25, 0.42);
    k.cyl('wellGrey', 0.26, 0.07, s * 1.25, h + 0.215, 0, 10);
  }
  if (!frac) { k.pipe('pipeGrey', [1.25, h + 0.25, 0], [1.6, h + 0.25, 0], 0.08, 6); k.pipe('pipeGrey', [1.6, h + 0.25, 0], [1.6, 0.25, 0], 0.08, 6); k.pipe('pipeGrey', [1.6, 0.25, 0], [1.6, 0.25, -6], 0.08, 6); }
  h += 0.5; valve();
  if (frac) {
    sp(0.24, 0.5); k.box('wellGrey', 0.9, 0.7, 0.9, 0, h, 0);
    for (const a of [0.6, 2.2, 3.8, 5.4]) k.pipe('steel', [Math.cos(a) * 0.4, h + 0.4, Math.sin(a) * 0.4], [Math.cos(a) * 1.1, h + 1.0, Math.sin(a) * 1.1], 0.07, 6);
    h += 0.7;
  }
  sp(0.14, 0.25); k.cyl('white', 0.09, 0.05, 0, h + 0.1, 0, 10);
  k.pop();
  return h;
}
function pipeRack(k, x0, x1, zc, len, layers, mat = 'rust') {
  for (const dz of [-len * 0.3, len * 0.3]) { k.box('steelDark', x1 - x0 + 0.4, 0.2, 0.2, (x0 + x1) / 2, 0.8, zc + dz); for (const px of [x0, (x0 + x1) / 2, x1]) k.box('steelDark', 0.16, 0.8, 0.16, px, 0, zc + dz); }
  for (let l = 0; l < layers; l++) {
    const n = Math.floor((x1 - x0 - l * 0.6) / 0.17);
    for (let i = 0; i < n; i++) k.pipe(mat, [x0 + l * 0.3 + i * 0.17 + 0.08, 1.08 + l * 0.15, zc - len / 2], [x0 + l * 0.3 + i * 0.17 + 0.08, 1.08 + l * 0.15, zc + len / 2], 0.07, 5);
  }
}
function flare(k, x, y, z, h = 12) {
  k.box('slab', 1.6, 0.2, 1.6, x, y, z);
  k.cyl('wellGrey', 0.14, h, x, y + 0.2, z, 8); k.cyl('steelDark', 0.24, 0.9, x, y + h - 0.6, z, 10, 0.2);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * PI * 2 + 0.4; k.pipe('steel', [x, y + h * 0.75, z], [x + Math.cos(a) * h * 0.5, y, z + Math.sin(a) * h * 0.5], 0.015, 4); }
  const mat = MATS.flame || (MATS.flame = new THREE.MeshBasicMaterial({ map: T('flame').map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  const g = new THREE.PlaneGeometry(1.3, 2.4); g.translate(0, 0.95, 0);
  const g2 = g.clone(); g2.rotateY(PI / 2);
  const fl = new THREE.Mesh(mergeGeometries([g, g2]), mat);
  fl.position.set(x, y + h + 0.2, z).applyMatrix4(k.M); fl.renderOrder = 3;
  k.extra.push(fl);
  k.anim.push((dt, t) => { fl.scale.set(1 + 0.12 * Math.sin(t * 13.1), 1 + 0.16 * Math.sin(t * 17.3 + 1) + 0.08 * Math.sin(t * 7.1), 1 + 0.12 * Math.sin(t * 11.7)); fl.rotation.y = t * 0.9; fl.rotation.z = 0.1 * Math.sin(t * 2.3); });
}
function tankBattery(k, x, y, z, n = 4) {
  k.at(x, y, z);
  const pitch = 5.6, len = n * pitch + 3;
  // steel containment ring
  for (const [a, b] of [[[-2, -5], [len, -5]], [[len, -5], [len, 5]], [[len, 5], [-2, 5]], [[-2, 5], [-2, -5]]]) k.beam('galv', [a[0], 0.45, a[1]], [b[0], 0.45, b[1]], 0.08, 0.9);
  k.flat('gravel', len + 2, 10, len / 2 - 1, 0.03, 0);
  for (let i = 0; i < n; i++) {
    const black = i >= n - 1;
    tank(k, i * pitch + 2, 0, -0.8, 2.35, black ? 6.6 : 6.1, black ? 'tankBlack' : 'tankTan', { seg: 20, ladderA: -1.2 });
    k.pipe('pipeGrey', [i * pitch + 2, 0.5, 1.5], [i * pitch + 2, 0.5, 3.4], 0.09, 6);
    k.cyl('steel', 0.12, 0.5, i * pitch + 2, 6.5, -0.8, 6);
  }
  k.pipe('pipeGrey', [1, 0.5, 3.4], [len - 2, 0.5, 3.4], 0.09, 6);
  // catwalk with handrails and a stair
  const cy = 5.7, cl = n * pitch;
  k.box('steelDark', cl, 0.08, 1.0, cl / 2 - 0.6, cy, 2.2);
  for (let px = 0; px <= cl; px += pitch / 2) { k.box('steel', 0.1, cy, 0.1, px - 0.6, 0, 2.8); k.box('safety', 0.05, 1.05, 0.05, px - 0.6, cy, 2.7); k.box('safety', 0.05, 1.05, 0.05, px - 0.6, cy, 1.72); }
  k.box('safety', cl, 0.05, 0.05, cl / 2 - 0.6, cy + 1.05, 2.7); k.box('safety', cl, 0.05, 0.05, cl / 2 - 0.6, cy + 0.55, 2.7);
  k.beam('steelDark', [cl - 0.6, cy, 2.2], [cl + 5.2, 0, 2.2], 0.9, 0.12);
  k.beam('safety', [cl - 0.6, cy + 1.05, 2.65], [cl + 5.2, 1.05, 2.65], 0.05); k.beam('safety', [cl - 0.6, cy + 1.05, 1.75], [cl + 5.2, 1.05, 1.75], 0.05);
  k.pop();
}
function separator(k, x, y, z, ry = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', 7, 0.25, 2.6, 0, 0, 0);
  { const g = new THREE.CapsuleGeometry(0.75, 4.2, 4, 14); g.rotateZ(PI / 2); k.addM('tankTan', g, new THREE.Matrix4().setPosition(-0.5, 1.5, 0)); }
  for (const sx of [-2, 1]) k.box('steelDark', 0.3, 0.9, 1.3, sx, 0.25, 0);
  k.cyl('tankTan', 0.45, 3.4, 2.7, 0.25, 0.6, 12); k.cyl('steelDark', 0.12, 1.6, 2.7, 3.65, 0.6, 6);
  k.pipe('pipeGrey', [-0.5, 2.25, 0], [-0.5, 2.9, 0], 0.08, 6); k.pipe('pipeGrey', [-0.5, 2.9, 0], [2.7, 2.9, 0], 0.08, 6); k.pipe('pipeGrey', [2.7, 2.9, 0], [2.7, 2.9, 0.6], 0.08, 6);
  for (const [px, pz] of [[-2.6, -0.9], [-1.4, -1.0], [0.4, -1.0]]) { k.pipe('pipeGrey', [px, 0.5, pz], [px, 1.4, pz], 0.06, 6); handwheel(k, px, 1.0, pz - 0.12, 'z', 0.13); }
  k.box('utilGrey', 0.7, 1.2, 0.35, -3.0, 0.4, 1.0);
  k.pop();
}
function lightTower(k, x, y, z, ry = 0) {
  k.at(x, y, z, ry);
  k.box('safety', 2.2, 1.0, 1.3, 0, 0.5, 0); wheelSet(k, [0], 0.75, 0.33, 0.2);
  k.cyl('steel', 0.07, 7.5, 0.6, 1.5, 0, 6);
  for (const s of [-1, 1]) k.box('lamp', 0.5, 0.35, 0.12, 0.6 + s * 0.3, 8.8, 0.1);
  k.pop();
}
function crewTrailer(k, x, y, z, ry = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', 13.5, 0.5, 3.4, 0, 0.1, 0);
  k.box('white', 14, 2.8, 3.6, 0, 0.6, 0); k.box('coping', 14.2, 0.1, 3.8, 0, 3.4, 0);
  for (const wx of [-4.8, -1.5, 3.2]) k.box('spandrel', 1.2, 0.9, 0.05, wx, 1.7, 1.81);
  k.box('door', 0.95, 2.05, 0.06, 5.3, 0.65, 1.81); k.box('galv', 1.6, 0.65, 1.2, 5.3, 0, 2.5);
  k.box('galv', 1.0, 0.7, 0.8, -7.4, 1.6, 0);
  k.pop();
}
function fracTank(k, x, y, z, ry = 0, mat = 'pipeBlue') {
  k.at(x, y, z, ry);
  k.box(mat, 12.6, 2.9, 2.5, 0, 0.35, 0);
  for (let i = -5; i <= 5; i++) k.box(mat, 0.1, 2.9, 2.6, i * 1.15, 0.35, 0);
  k.box('steelDark', 0.5, 2.6, 0.06, 6.34, 0.5, 0.6); k.box('steelDark', 2.0, 0.08, 2.0, 5.2, 3.25, 0);
  k.pipe('pipeGrey', [6.4, 0.6, -0.6], [6.9, 0.6, -0.6], 0.1, 6);
  wheelSet(k, [-5.2], 1.05, 0.5, 0.3);
  k.pop();
}
// Electric frac pump trailer.
function pumpTrailer(k, x, y, z, ry = 0) {
  k.at(x, y, z, ry);
  k.box('steelDark', 13.5, 0.3, 2.5, 0, 1.1, 0);
  k.box('white', 6.4, 2.6, 2.5, 1.0, 1.4, 0); k.box('pipeBlue', 6.44, 0.35, 2.54, 1.0, 2.5, 0);
  k.box('louver', 2.2, 2.8, 2.5, 5.5, 1.4, 0);
  k.box('wellGrey', 3.0, 1.5, 2.2, -4.6, 1.4, 0); k.box('steel', 0.9, 1.0, 2.4, -5.6, 1.5, 0);
  for (const dz of [-0.6, 0, 0.6]) k.cyl('steel', 0.14, 0.5, -4.4, 2.9, dz, 6);
  wheelSet(k, [-3.4, -4.7, -6.0], 1.0); k.box('steelDark', 0.2, 1.1, 1.8, 4.4, 0, 0);
  k.pop();
}
function sandSilo(k, x, y, z) {
  k.cyl('tankWhite', 1.8, 10.5, x, y + 4, z, 16); k.cyl('tankWhite', 0.4, 2.2, x, y + 1.8, z, 16, 1.8); k.cyl('tankWhite', 1.8, 0.5, x, y + 14.5, z, 16, 0.5);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('steelDark', 0.22, 4.4, 0.22, x + sx * 1.5, y, z + sz * 1.5);
  k.box('steelDark', 3.5, 0.25, 3.5, x, y, z);
  k.cyl('safety', 1.7, 1.0, x, y + 14.5, z, 12, 1.7, true);
}

function padBase(k, hw, hd, gapX0, gapX1, h = 0.3) {
  k.box('caliche', hw * 2, h + 0.3, hd * 2, 0, -0.3, 0);
  const B = (a, b) => berm(k, a, b, 3.4, 0.85, 0);
  B([-hw - 1, -hd - 1], [hw + 1, -hd - 1]); B([hw + 1, -hd - 1], [hw + 1, hd + 1]); B([-hw - 1, hd + 1], [-hw - 1, -hd - 1]);
  B([hw + 1, hd + 1], [gapX1, hd + 1]); B([gapX0, hd + 1], [-hw - 1, hd + 1]);
}

function padFrac(k, o) {
  const r = k.rand, hw = 75, hd = 50, Y = 0.3;
  padBase(k, hw, hd, -46, -34);
  k.flat('calicheFlat', 8, 62, -40, 0.05, hd + 30);
  // wellheads with frac trees and zipper manifold
  const wx = [-12, -4, 4, 12];
  for (const x of wx) {
    wellhead(k, x, Y, -22, true);
    for (const dx of [-0.25, 0.25]) k.pipe('steel', [x + dx, Y + 0.4, -20.8], [x + dx, Y + 0.4, -12.6], 0.07, 6);
    k.box('wellGrey', 1.6, 1.2, 1.4, x, Y, -12);
    handwheel(k, x, Y + 1.5, -12, 'x', 0.22);
  }
  k.box('steelDark', 30, 0.25, 2.0, 0, Y, -12);
  for (const dz of [-0.4, 0.4]) k.pipe('steel', [-14, Y + 0.7, -11 + dz * 0.5], [14, Y + 0.7, -11 + dz * 0.5], 0.09, 6);
  // missile manifold running north to south, pump trailers backed up on both sides
  k.box('steelDark', 2.2, 0.4, 19, 0, Y, 3);
  for (const dx of [-0.6, 0.6]) { k.pipe('steel', [dx, Y + 1.3, -6], [dx, Y + 1.3, 12], 0.12, 8); k.pipe('pipeBlue', [dx * 0.4, Y + 0.75, -6], [dx * 0.4, Y + 0.75, 12], 0.16, 8); }
  for (const dx of [-0.6, 0.6]) k.pipe('steel', [dx, Y + 1.3, -6], [dx * 8, Y + 0.7, -10.6], 0.09, 6);
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
    const pz = -3 + i * 4.4;
    pumpTrailer(k, s * 9.6, Y, pz, s > 0 ? PI : 0);
    k.pipe('steel', [s * 2.8, Y + 1.7, pz], [s * 0.7, Y + 1.3, pz], 0.06, 5);
    k.pipe('rubber', [s * 3.2, Y + 0.3, pz + 0.8], [s * 0.5, Y + 0.75, pz + 0.8], 0.09, 5);
  }
  // blender, hydration, sand, data van, chemical totes
  k.at(-6, Y, 21); k.box('steelDark', 12, 0.3, 2.5, 0, 1.0, 0); k.box('utilGrey', 4, 2.2, 2.4, -3, 1.3, 0); k.box('pipeBlue', 3.5, 1.4, 2.2, 2.5, 1.3, 0); k.cyl('utilGrey', 0.9, 1.6, 1.0, 1.3, 0, 12); wheelSet(k, [-3.6, -4.9], 1.0); k.pop();
  k.at(8, Y, 21.5); k.box('steelDark', 11, 0.3, 2.5, 0, 1.0, 0); k.box('white', 8, 2.4, 2.4, 0.5, 1.3, 0); wheelSet(k, [-3.2, -4.5], 1.0); k.pop();
  for (let i = 0; i < 4; i++) sandSilo(k, -27 + (i % 2) * 4.2, Y, 19 + ((i / 2) | 0) * 4.2);
  k.beam('galv', [-23, Y + 1.6, 21], [-11, Y + 3.2, 21], 0.8, 0.5);
  k.at(24, Y, 20, 0.15); k.box('white', 9, 2.7, 2.5, 0, 1.0, 0); k.box('steelDark', 9, 0.3, 2.4, 0, 0.7, 0); k.box('spandrel', 2.5, 0.8, 0.05, 1, 2.2, 1.26); wheelSet(k, [-3, 3.2], 1.0, 0.45, 0.3); k.cyl('steel', 0.04, 5, -4, 3.7, 0.8, 5); k.pop();
  for (let i = 0; i < 9; i++) { k.box('white', 1.1, 1.15, 1.1, 19 + (i % 3) * 1.4, Y, 8 + ((i / 3) | 0) * 1.4); k.box('galv', 1.2, 0.14, 1.2, 19 + (i % 3) * 1.4, Y, 8 + ((i / 3) | 0) * 1.4); }
  // staged frac tanks along the west side, water manifold
  for (let i = 0; i < 12; i++) fracTank(k, -68 + i * 3.0, Y, -34, PI / 2, i % 4 === 3 ? 'ribDark' : 'pipeBlue');
  k.pipe('pipeGrey', [-70, Y + 0.6, -26.6], [-34, Y + 0.6, -26.6], 0.13, 6); k.pipe('pipeGrey', [-34, Y + 0.6, -26.6], [-8, Y + 0.6, 17], 0.13, 6);
  // production side: tank battery, separator, flare, pipe racks
  tankBattery(k, 42, Y, -38, 4);
  separator(k, 30, Y, -36, 0); separator(k, 30, Y, -30, 0);
  for (const x of wx) k.pipe('pipeGrey', [x + 1.6, Y + 0.25, -28], [x + 1.6, Y + 0.25, -33], 0.08, 6);
  k.pipe('pipeGrey', [-10.4, Y + 0.25, -33], [27, Y + 0.25, -33], 0.08, 6);
  flare(k, 66, Y, -46.5, 12);
  k.pipe('pipeGrey', [33, Y + 0.25, -38], [33, Y + 0.25, -46.5], 0.06, 6); k.pipe('pipeGrey', [33, Y + 0.25, -46.5], [66, Y + 0.25, -46.5], 0.06, 6);
  pipeRack(k, 54, 68, 4, 9.6, 3); pipeRack(k, 54, 68, 16, 9.6, 2, 'wellGrey');
  // site services
  crewTrailer(k, -58, Y, 38, 0); crewTrailer(k, -58, Y, 44, 0);
  for (const [lx, lz, a] of [[-30, -6, 0.5], [34, -4, 2.6], [-22, 34, -0.6], [44, 38, 3.4]]) lightTower(k, lx, Y, lz, a);
  for (let i = 0; i < 5; i++) car(k, -20 + i * 3.4, 43 + r() * 0.6, PI / 2 + (r() - 0.5) * 0.2, 'pickup');
  k.box('ribGreen', 6.06, 2.6, 2.44, -66, Y, 12, PI / 2); k.box('utilGreen', 2.2, 1.7, 5.5, -66, Y, 22);
  k.sign('SP 14 PAD\nH2S MAY BE PRESENT', { bg: '#e9e7e0', color: '#2a3138' }, 0.9, -31.5, 0.9, hd + 6); k.box('steel', 0.08, 1.9, 0.08, -32.8, 0, hd + 5.95); k.box('steel', 0.08, 1.9, 0.08, -30.2, 0, hd + 5.95);
  return {
    size: { x: 158, y: 15, z: 108 }, hudAnchor: new V3(0, 10, -10), focus: { center: new V3(0, 3, 0), radius: 70 },
    yardAnchor: { position: new V3(40, Y, 26), heading: 0, dir: new V3(0, 0, 1), clear: { w: 44, d: 18 } },
    entry: { x: -40, z: hd + 60 }, bounds: { x0: -80, x1: 80, z0: -55, z1: hd + 60 }, padHeight: Y,
  };
}

function padDrill(k, o) {
  const r = k.rand, hw = 58, hd = 44, Y = 0.3, FY = 8.2, RX = -8, RZ = -8;
  padBase(k, hw, hd, 26, 38);
  k.flat('calicheFlat', 8, 58, 32, 0.05, hd + 28);
  // rig: substructure, drill floor, mast
  k.at(RX, Y, RZ);
  for (const s of [-1, 1]) {
    k.box('pipeBlue', 13, 0.5, 0.7, 0, 0, s * 4.2); k.box('pipeBlue', 13, 0.5, 0.7, 0, FY - 0.8, s * 4.2);
    for (const cx of [-6, -2, 2, 6]) k.box('pipeBlue', 0.45, FY - 1.3, 0.45, cx, 0.5, s * 4.2);
    for (const [a, b] of [[-6, -2], [2, 6]]) { k.beam('pipeBlue', [a, 0.5, s * 4.2], [b, FY - 0.8, s * 4.2], 0.22); k.beam('pipeBlue', [b, 0.5, s * 4.2], [a, FY - 0.8, s * 4.2], 0.22); }
  }
  for (const cx of [-6, 6]) k.box('pipeBlue', 0.4, 0.4, 8.4, cx, FY - 0.8, 0);
  k.box('steelDark', 13, 0.3, 9.6, 0, FY - 0.3, 0);
  k.box('white', 13, 3.2, 0.1, 0, FY, -4.75); k.box('white', 0.1, 3.2, 9.5, -6.45, FY, 0); k.box('white', 0.1, 3.2, 4, 6.45, FY, -2.75);
  k.box('white', 3.2, 2.8, 5.5, 8.2, FY, 1.5); k.box('spandrel', 0.05, 1.0, 3.6, 6.57, FY + 1.3, 1.5); k.box('steelDark', 3.4, 0.3, 5.7, 8.2, FY - 0.3, 1.5);
  k.box('utilGrey', 4.2, 2.3, 2.6, -1.5, FY, -3.2);
  { const g = new THREE.CylinderGeometry(0.7, 0.7, 2.2, 12); g.rotateZ(PI / 2); k.addM('steelDark', g, new THREE.Matrix4().setPosition(-1.5, FY + 2.0, -2.2)); }
  // BOP stack under the floor
  k.cyl('steelDark', 1.4, 0.08, 0, 0, 0, 14);
  k.cyl('wellGrey', 0.4, 1.0, 0, 0.1, 0, 12); k.box('wellGrey', 2.2, 0.8, 0.9, 0, 1.1, 0); k.box('wellGrey', 2.2, 0.8, 0.9, 0, 2.0, 0); k.cyl('safety', 0.75, 1.3, 0, 2.9, 0, 14); k.cyl('wellGrey', 0.3, FY - 4.5, 0, 4.2, 0, 10);
  k.pipe('pipeGrey', [0.4, 5.6, 0], [9, 4.2, 5], 0.15, 6);
  // mast
  const MH = 41, legs = [[-1, -1], [1, -1], [1, 1], [-1, 1]], hwAt = (t) => lerp(3.0, 1.15, t), NP = 11;
  const P = (i, t) => [legs[i][0] * hwAt(t), FY + t * MH, legs[i][1] * hwAt(t) * 0.85];
  for (let i = 0; i < 4; i++) {
    k.beam('white', P(i, 0), P(i, 1), 0.3);
    const j = (i + 1) % 4;
    for (let p = 0; p < NP; p++) {
      const t0 = p / NP, t1 = (p + 1) / NP;
      k.beam('white', P(i, t1), P(j, t1), 0.1);
      if (i !== 2) { if (p % 2) k.beam('white', P(i, t0), P(j, t1), 0.09); else k.beam('white', P(j, t0), P(i, t1), 0.09); }
    }
  }
  k.box('safety', 3.2, 1.3, 2.8, 0, FY + MH, 0); k.box('lampAmber', 0.25, 0.25, 0.25, 0, FY + MH + 1.3, 0);
  k.box('steelDark', 5.5, 0.2, 3.2, 0, FY + 25, 3.4); k.box('safety', 5.5, 1.0, 0.06, 0, FY + 25.2, 5.0);
  for (let i = 0; i < 34; i++) { const sx = (i % 2 ? 1 : -1) * (0.9 + ((i / 2) | 0) % 6 * 0.28), sz = 2.4 + (((i / 12) | 0) * 0.3); k.pipe('rust', [sx, FY, sz], [sx * 1.02, FY + 27.5, sz + 0.5], 0.07, 5); }
  k.box('safety', 1.3, 3.6, 1.3, 0, FY + 12, 0); k.box('utilGrey', 1.1, 1.8, 0.9, 0, FY + 16.6, 0);
  for (const dx of [-0.25, 0.25]) k.pipe('steelDark', [dx, FY + 18.4, 0], [dx, FY + MH, 0], 0.035, 4);
  k.cyl('wellGrey', 0.09, 12, 0, FY, 0, 6);
  for (const t of [0.3, 0.6, 0.9]) for (const s of [-1, 1]) k.box('lamp', 0.9, 0.16, 0.2, s * (hwAt(t) + 0.2), FY + t * MH, 0);
  // stairs, V-door ramp, catwalk and pipe racks
  k.beam('galv', [-6.6, FY - 0.1, 6.2], [-6.6, 0, 15], 1.1, 0.14); k.beam('galv', [8.6, FY - 0.1, -6.5], [16, 0, -6.5], 1.1, 0.14);
  k.beam('steelDark', [0, FY - 0.1, 4.8], [0, 1.15, 15], 1.8, 0.2);
  k.box('steelDark', 2.0, 1.15, 17, 0, 0, 23.5);
  k.pop();
  pipeRack(k, RX + 2, RX + 12, RZ + 24, 9.6, 3); pipeRack(k, RX - 12, RX - 2, RZ + 24, 9.6, 2);
  // mud system: shaker, tanks with walkways, pumps
  const mx = 16;
  for (let i = 0; i < 3; i++) {
    const mz = -6 + i * 13.2;
    k.box('utilGrey', 3.2, 2.7, 12.4, mx, Y, mz); k.box('steelDark', 3.3, 0.08, 12.5, mx, Y + 2.7, mz);
    for (let j = -2; j <= 2; j++) k.box('utilGrey', 3.3, 2.7, 0.12, mx, Y, mz + j * 2.9);
    for (const s of [-1, 1]) { k.box('safety', 0.05, 0.05, 12.4, mx + s * 1.6, Y + 3.8, mz); for (let j = -2; j <= 2; j++) k.box('safety', 0.05, 1.05, 0.05, mx + s * 1.6, Y + 2.78, mz + j * 3); }
    k.cyl('pipeBlue', 0.3, 0.9, mx, Y + 2.78, mz - 3, 8); k.cyl('pipeBlue', 0.3, 0.9, mx, Y + 2.78, mz + 3, 8);
  }
  k.box('white', 3.4, 2.4, 5, mx, Y + 2.78, -9.5); k.box('louver', 0.06, 1.2, 3, mx - 1.73, Y + 3.4, -9.5);
  k.beam('galv', [mx + 1.7, Y + 2.7, 26], [mx + 6.5, Y, 26], 1.0, 0.12);
  for (const pz of [-24, -18]) { k.box('steelDark', 7, 0.3, 2.6, mx + 1, Y, pz); k.box('pipeBlue', 3.2, 1.9, 2.2, mx - 0.6, Y + 0.3, pz); k.box('utilGrey', 2.6, 1.5, 1.8, mx + 2.8, Y + 0.3, pz); }
  k.pipe('pipeGrey', [mx, Y + 1.2, -16.6], [mx, Y + 1.2, -12.2], 0.12, 6);
  for (let i = 0; i < 2; i++) { k.box('pipeBlue', 2.2, 2.2, 2.2, mx + 6 + i * 3, Y, 6); k.cyl('pipeBlue', 0.5, 1.6, mx + 6 + i * 3, Y + 2.2, 6, 8, 1.1); }
  // power side: VFD house and cable tray toward the yard
  k.box('white', 12.2, 2.9, 3.0, 34, Y + 0.6, 2); for (const dx of [-5, 0, 5]) k.box('steelDark', 0.4, 0.6, 3.0, 34 + dx, Y, 2);
  k.box('galv', 1.2, 0.9, 0.8, 40.6, Y + 1.5, 2); manDoor(k, 30, Y + 0.6, 3.52);
  k.box('galv', 0.5, 0.12, 16, 31, Y + 0.3, 12); k.box('galv', 22, 0.12, 0.5, 20.2, Y + 0.3, 3.8);
  // fuel, water, reserve pit, flare
  { const g = new THREE.CapsuleGeometry(1.2, 6, 4, 14); g.rotateZ(PI / 2); k.addM('tankWhite', g, new THREE.Matrix4().setPosition(42, Y + 1.9, -14)); }
  for (const dx of [-2.2, 2.2]) k.box('steelDark', 0.4, 0.8, 2.2, 42 + dx, Y, -14);
  tank(k, 44, Y, -26, 2.4, 5, 'tankBlack', { seg: 18, cone: 0.4 }); tank(k, 44, Y, -32.5, 2.4, 5, 'tankBlack', { seg: 18, cone: 0.4 });
  const B = (a, b) => berm(k, a, b, 2.4, 0.7, Y);
  B([-54, -40], [-22, -40]); B([-22, -40], [-22, -18]); B([-22, -18], [-54, -18]); B([-54, -18], [-54, -40]);
  k.flat('water', 28, 18, -38, Y + 0.25, -29); k.box('dark', 30.5, 0.2, 20.5, -38, Y, -29);
  flare(k, -50, Y, -14, 7);
  k.pipe('pipeGrey', [RX - 1, Y + 0.3, RZ - 1], [-50, Y + 0.3, -14], 0.08, 6);
  // camp, vehicles, lights, staging
  crewTrailer(k, -44, Y, 36, 0); crewTrailer(k, -28, Y, 36, 0); crewTrailer(k, -50, Y, 22, PI / 2);
  for (let i = 0; i < 6; i++) car(k, -36 + i * 3.3, 28 + r() * 0.5, PI / 2 + (r() - 0.5) * 0.2, r() < 0.8 ? 'pickup' : 'suv');
  for (const [lx, lz, a] of [[-20, 10, 0.4], [28, -34, 2.5], [48, 36, 3.6], [-52, 4, -0.5]]) lightTower(k, lx, Y, lz, a);
  k.box('ribDark', 6.06, 2.6, 2.44, 48, Y, 14, PI / 2); k.box('ribGreen', 12.2, 2.6, 2.44, 50, Y, -2, PI / 2);
  k.box('utilGreen', 2.2, 1.7, 5.5, -10, Y, 38, PI / 2);
  k.sign('WC 7 PAD\nRIG 214', { bg: '#e9e7e0', color: '#2a3138' }, 0.9, 40, 0.9, hd + 6); k.box('steel', 0.08, 1.9, 0.08, 38.9, 0, hd + 5.95); k.box('steel', 0.08, 1.9, 0.08, 41.1, 0, hd + 5.95);
  return {
    size: { x: 124, y: FY + MH + 2, z: 96 }, hudAnchor: new V3(RX, FY + MH + 6, RZ), focus: { center: new V3(0, 12, 0), radius: 66 },
    yardAnchor: { position: new V3(34, Y, 12), heading: 0, dir: new V3(0, 0, 1), clear: { w: 30, d: 16 } },
    entry: { x: 32, z: hd + 56 }, bounds: { x0: -63, x1: 63, z0: -49, z1: hd + 56 }, padHeight: Y,
  };
}

const PAD_VARIANTS = { frac: padFrac, drill: padDrill };
export function buildWellPad(opts = {}) {
  const variant = PAD_VARIANTS[opts.variant] ? opts.variant : 'frac', seed = opts.seed ?? 37;
  const k = new Kit(seed + variant.length * 53), group = new THREE.Group();
  const ud = PAD_VARIANTS[variant](k, opts);
  return finish(group, k, { id: opts.id, variant, seed, ...ud });
}

// ---------------------------------------------------------------- test cell

export function buildTestCell(opts = {}) {
  const variant = 'shop', seed = opts.seed ?? 41, k = new Kit(seed), r = k.rand, group = new THREE.Group(), sr = rng(seed * 13 + 5);
  const bays = seed === 41 ? 3 : 2 + ((sr() * 3) | 0), wall = seed === 41 ? 'ribTan' : ['ribTan', 'ribLight', 'ribGreen'][(sr() * 3) | 0];
  const W = bays * 8 + 12, D = 22, EH = 8, RISE = 1.5, x0 = -W / 2, x1 = W / 2, z0 = -24, z1 = -2, zc = (z0 + z1) / 2;
  k.flat('gravel', 92, 78, 4, 0.03, 4);
  // shell
  k.box(wall, W, EH, 0.2, 0, 0, z1 - 0.1); k.box(wall, W, EH, 0.2, 0, 0, z0 + 0.1);
  for (const gx of [x0 + 0.1, x1 - 0.1]) {
    k.box(wall, 0.2, EH, D - 0.4, gx, 0, zc);
    const s = new THREE.Shape(); s.moveTo(-D / 2, 0); s.lineTo(D / 2, 0); s.lineTo(0, RISE);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false }); g.translate(0, 0, -0.1); g.rotateY(PI / 2);
    k.addM(wall, g, new THREE.Matrix4().setPosition(gx, EH, zc));
    k.box('louver', 0.24, 1.2, 2.4, gx, EH - 0.9, zc);
  }
  k.box('core', W - 0.5, EH, D - 0.5, 0, 0, zc);
  const a = Math.atan(RISE / (D / 2)), sl = Math.hypot(D / 2, RISE) + 0.7;
  k.boxR('ribRoof', W + 1.0, 0.12, sl, 0, EH + RISE / 2 + 0.02, zc + D / 4 + 0.25, a, 0, 0);
  k.boxR('ribRoof', W + 1.0, 0.12, sl, 0, EH + RISE / 2 + 0.02, zc - D / 4 - 0.25, -a, 0, 0);
  k.box('galv', W + 1.0, 0.12, 0.7, 0, EH + RISE + 0.02, zc);
  for (const gz of [z1 + 0.42, z0 - 0.42]) { k.box('white', W + 1.0, 0.18, 0.2, 0, EH - 0.16, gz); for (const dx of [x0 + 0.5, x1 - 0.5]) k.box('white', 0.12, EH - 0.2, 0.1, dx, 0, gz - Math.sign(gz - zc) * 0.25); }
  for (const cx of [x0, x1]) for (const cz of [z0, z1]) k.box('white', 0.3, EH, 0.3, cx, 0, cz);
  k.box('ribDark', W + 0.06, 1.2, D + 0.06, 0, 0, zc);
  // doors on the service side
  for (let i = 0; i < bays; i++) rollDoor(k, 5, 5.6, x0 + 9 + i * 8, 0, z1 + 0.04, 0, i === 1 ? 0.6 : 0);
  manDoor(k, x0 + 3, 0, z1 + 0.04); manDoor(k, x1 - 3, 0, z1 + 0.04);
  for (let i = 0; i <= bays; i++) k.box('lamp', 0.4, 0.16, 0.14, x0 + 5 + i * 8, 6.4, z1 + 0.08);
  k.sign('TEST CELL ' + (1 + (seed % 3)), { color: '#2a3138' }, 0.8, 0, 6.6, z1 + 0.06);
  bollards(k, Array.from({ length: bays + 1 }, (_, i) => [x0 + 5 + i * 8, z1 + 1.0]));
  // roof: ridge vents, cell ventilation fans, exhaust silencers on the north side
  for (let i = 0; i < 3; i++) k.cyl('galv', 0.5, 0.8, x0 + W * (0.25 + i * 0.25), EH + RISE, zc, 10, 0.7);
  for (const fx of [-6, 6]) { k.cyl('shroud', 1.1, 0.7, fx, EH + 0.9, zc - 5, 14, 1.1, true); k.box('galv', 2.6, 0.5, 2.6, fx, EH + 0.5, zc - 5); k.fan('big', 1.0, fx, EH + 1.4, zc - 5, 8); }
  for (const sx of [-3, 3]) {
    k.box('steelDark', 0.2, EH + 2, 0.2, sx - 1.6, 0, z0 - 1.4); k.box('steelDark', 0.2, EH + 2, 0.2, sx + 1.6, 0, z0 - 1.4);
    { const g = new THREE.CylinderGeometry(0.7, 0.7, 4.2, 14); g.rotateZ(PI / 2); k.addM('galv', g, new THREE.Matrix4().setPosition(sx, EH + 2.4, z0 - 1.4)); }
    k.cyl('galv', 0.3, 3.2, sx + 1.3, EH + 3.0, z0 - 1.4, 10); k.pipe('galv', [sx - 1.3, EH + 2.4, z0 - 1.4], [sx - 1.3, EH + 2.4, z0 + 0.2], 0.28, 8);
    k.box('steelDark', 3.4, 0.2, 0.2, sx, EH + 1.6, z0 - 1.4);
  }
  // office lean-to
  block(k, x1 - 0.1, -17, x1 + 10, -5, 0, { floors: 1, floorH: 3.6, style: 'punched', wall: 'precast', bay: 3, winW: 1.8, winH: 1.5, sill: 1.0, mull: [0.5], parapet: 0.4, roof: 'roof', plinth: 'panelDark', sides: { W: { style: 'none' } } });
  manDoor(k, x1 + 5, 0, -4.98); rtu(k, x1 + 5, 3.6, -11, 0, 1.0);
  // apron, test pad, load banks, gas skid, remote radiator
  k.flat('slabFlat', W + 18, 15, 5, 0.05, 5.5);
  k.box('slab', 20, 0.25, 12, 0, 0, 22);
  for (const dz of [-2.2, 2.2]) k.box('steelDark', 18, 0.03, 0.25, 0, 0.25, 22 + dz);
  bollards(k, [[-10.8, 15.4], [10.8, 15.4], [-10.8, 28.6], [10.8, 28.6], [-10.8, 22], [10.8, 22]]);
  k.flat('pad', 1.2, 14, -6, 0.07, 8); k.flat('pad', 16, 1.2, -18, 0.07, 22);
  for (const lz of [18.5, 25.5]) {
    k.at(-27, 0, lz);
    k.box('slab', 6, 0.2, 3.2, 0, 0, 0); k.box('steelDark', 5, 0.3, 2.4, 0, 0.2, 0); k.box('galv', 4.8, 2.3, 2.3, 0, 0.5, 0);
    k.box('louver', 0.08, 1.8, 2.0, 2.42, 0.7, 0); k.box('louver', 0.08, 1.8, 2.0, -2.42, 0.7, 0); k.box('louver', 3.6, 1.2, 0.08, 0, 0.8, 1.17);
    for (const fx of [-1.2, 1.2]) { k.cyl('shroud', 0.95, 0.5, fx, 2.8, 0, 14, 0.95, true); k.cyl('dark', 0.92, 0.04, fx, 2.81, 0, 12); k.fan('big', 0.86, fx, 3.1, 0, 10); }
    k.box('utilGrey', 0.9, 1.5, 0.4, 1.4, 0.6, -1.3);
    k.pop();
    k.pipe('rubber', [-24.5, 0.12, lz], [-10, 0.3, 22 + (lz - 22) * 0.4], 0.08, 5);
  }
  k.at(x1 - 2, 0, 20);
  k.box('slab', 6, 0.2, 3, 0, 0, 0);
  k.pipe('safety', [-2.4, 0.9, 0], [2.4, 0.9, 0], 0.11, 8); k.pipe('safety', [-2.4, 0.9, 0], [-2.4, 0.2, 0], 0.11, 8); k.pipe('safety', [2.4, 0.9, 0], [2.4, 0.25, 0], 0.11, 8);
  k.box('utilGrey', 0.7, 0.7, 0.7, -0.8, 0.55, 0); k.box('utilGrey', 0.9, 0.9, 0.6, 0.9, 0.5, 0); handwheel(k, -1.7, 0.9, 0.18, 'z', 0.14);
  k.pop();
  k.pipe('safety', [x1 - 4.4, 0.25, 20], [12, 0.25, 22], 0.06, 6);
  bollards(k, [[x1 - 5.4, 22], [x1 - 2, 22], [x1 + 1.4, 22]]);
  k.box('slab', 9, 0.2, 5, x1 + 8, 0, 8); for (const sx of [-3, 3]) for (const sz of [-1.3, 1.3]) k.box('steelDark', 0.2, 1.4, 0.2, x1 + 8 + sx, 0.2, 8 + sz);
  fanUnit(k, x1 + 8, 1.6, 8);
  k.pipe('pipeBlue', [x1 + 4.2, 2.2, 8], [x1 + 0.2, 2.2, 8], 0.14, 6); k.pipe('pipeBlue', [x1 + 0.2, 2.2, 8], [x1 + 0.2, 2.2, -1.9], 0.14, 6);
  // yard: containers, parking, fence, drive
  k.box('ribGreen', 12.2, 2.6, 2.44, x0 - 12, 0, -14, PI / 2); k.box('ribDark', 6.06, 2.6, 2.44, x0 - 8, 0, -17, PI / 2); k.box('utilGreen', 2.2, 1.7, 5.5, x0 - 6, 0, -6);
  k.flat('asphalt', 30, 16, 26, 0.04, 34);
  for (let i = 0; i <= 6; i++) k.flat('paintW', 0.12, 5.5, 17 + i * 2.75, 0.06, 37);
  for (const i of [0, 2, 3, 5]) car(k, 18.4 + i * 2.75, 37, PI / 2, i === 3 ? 'sedan' : 'pickup');
  fenceRun(k, [[-42, -35], [50, -35], [50, 43], [-42, 43]], 2.4, true, [[2, 38, 48]]);
  k.flat('asphalt', 9, 40, 7, 0.04, 54); k.flat('asphalt', 9, 12, 7, 0.04, 36);
  for (const [lx, lz, ry] of [[-40, -33, 0], [48, -33, PI], [-40, 41, 0], [48, 41, PI]]) pole(k, lx, lz, 9, 1, ry);
  return finish(group, k, {
    id: opts.id, variant, seed,
    size: { x: 96, y: EH + RISE + 6, z: 80 }, hudAnchor: new V3(0, EH + 8, zc), focus: { center: new V3(0, 4, 2), radius: 46 },
    yardAnchor: { position: new V3(0, 0.25, 22), heading: 0, dir: new V3(0, 0, 1), clear: { w: 18, d: 10 } },
    entry: { x: 7, z: 74 }, bounds: { x0: -44, x1: 52, z0: -37, z1: 74 },
  });
}

// ---------------------------------------------------------------- ground

const HORIZON = { westTexas: '#cdc5b6', midwest: '#c3cdd0', southTexas: '#c5cdc6' };
const GROUND_TEX = {};

function groundTexture(kind, seed, size, clear) {
  const key = kind + ':' + seed + ':' + size;
  if (GROUND_TEX[key]) return GROUND_TEX[key];
  const S = 2048, B = 512, [c, x] = mk(S), [bc, bx] = mk(B), r = rng(seed * 7 + 1);
  const px = (m) => (m / size + 0.5) * S, mpp = size / S;
  const pal = {
    westTexas: [[178, 152, 114], [160, 120, 86], [200, 184, 152]],
    midwest: [[116, 138, 74], [140, 150, 88], [98, 122, 62]],
    southTexas: [[128, 140, 86], [158, 154, 104], [100, 122, 70]],
  }[kind];
  const fa = fbm(B, 5, 5, seed + 1), fb = fbm(B, 9, 4, seed + 2), id = bx.createImageData(B, B), d = id.data;
  for (let i = 0; i < fa.length; i++) {
    const t1 = sstep(0.35, 0.7, fa[i]), t2 = sstep(0.45, 0.75, fb[i]) * 0.7;
    for (let ch = 0; ch < 3; ch++) d[i * 4 + ch] = lerp(lerp(pal[0][ch], pal[1][ch], t1), pal[2][ch], t2);
    d[i * 4 + 3] = 255;
  }
  bx.putImageData(id, 0, 0);
  x.imageSmoothingEnabled = true; x.drawImage(bc, 0, 0, S, S);
  const dens = (X, Y) => fa[(((Y / S) * B) | 0) * B + (((X / S) * B) | 0)] || 0;
  const feats = { treeLines: [], mottes: [], farms: [] };
  const wobble = (ax, ay, bx2, by2, w, col, amp = 30) => {
    x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.moveTo(ax, ay);
    const n = 8;
    for (let i = 1; i <= n; i++) { const t = i / n; x.lineTo(lerp(ax, bx2, t) + (i < n ? (r() - 0.5) * amp : 0), lerp(ay, by2, t) + (i < n ? (r() - 0.5) * amp : 0)); }
    x.stroke();
  };

  if (kind === 'westTexas') {
    // dry wash
    const wy = px(-620 - r() * 200);
    x.strokeStyle = 'rgba(120,104,78,0.5)'; x.lineWidth = 16; x.beginPath(); x.moveTo(0, wy);
    x.bezierCurveTo(S * 0.3, wy - 160, S * 0.6, wy + 200, S, wy - 40); x.stroke();
    // scrub: creosote and mesquite dots
    const cols = ['rgba(88,92,58,0.6)', 'rgba(104,104,66,0.55)', 'rgba(74,80,52,0.6)', 'rgba(120,112,78,0.5)'];
    for (let i = 0; i < 150000; i++) {
      const X = r() * S, Y = r() * S;
      if (r() > 0.2 + dens(X, Y) * 1.1) continue;
      x.fillStyle = cols[(r() * 4) | 0];
      const s = 1 + r() * 1.6; x.fillRect(X, Y, s, s);
    }
    // lease roads and caliche pads
    const trunkX = px(520 + r() * 150), trunkY = px(-760 - r() * 100);
    wobble(trunkX, 0, trunkX + 30, S, 4.5, 'rgba(218,208,184,0.95)', 26); wobble(0, trunkY, S, trunkY + 40, 4, 'rgba(218,208,184,0.9)', 26);
    for (let i = 0; i < 9; i++) {
      let X, Y;
      do { X = S * (0.08 + r() * 0.84); Y = S * (0.08 + r() * 0.84); } while (Math.hypot(X - S / 2, Y - S / 2) < 430 / mpp);
      const w = (90 + r() * 50) / mpp, h = (70 + r() * 30) / mpp;
      x.fillStyle = 'rgba(220,211,188,0.95)'; x.fillRect(X - w / 2, Y - h / 2, w, h);
      x.fillStyle = 'rgba(120,110,96,0.8)'; for (let t = 0; t < 4; t++) x.fillRect(X - w * 0.3 + t * 5, Y - h * 0.3, 3, 3);
      if (Math.abs(X - trunkX) < Math.abs(Y - trunkY)) wobble(X, Y, trunkX, Y + (r() - 0.5) * 60, 3, 'rgba(218,208,184,0.9)', 14);
      else wobble(X, Y, X + (r() - 0.5) * 60, trunkY, 3, 'rgba(218,208,184,0.9)', 14);
    }
    x.strokeStyle = 'rgba(205,190,160,0.35)'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, S * 0.22); x.lineTo(S, S * 0.71); x.stroke();
    for (let i = 0; i < 5; i++) wobble(r() * S, r() * S, r() * S, r() * S, 1.5, 'rgba(210,198,170,0.5)', 80);
  } else if (kind === 'midwest') {
    const crops = ['#607c3a', '#6c8a42', '#58763a', '#8c9c56', '#b5a56e', '#c2b47c', '#6a5a44', '#7c8f50', '#52703a'];
    const leaves = [];
    const split = (x0, y0, x1, y1, depth) => {
      const w = x1 - x0, h = y1 - y0, minS = 230 / mpp;
      if (depth > 5 || (w < minS * 2 && h < minS * 2) || (depth > 2 && r() < 0.18)) { leaves.push([x0, y0, x1, y1]); return; }
      if (w > h) { const m = x0 + w * (0.35 + r() * 0.3); split(x0, y0, m, y1, depth + 1); split(m, y0, x1, y1, depth + 1); }
      else { const m = y0 + h * (0.35 + r() * 0.3); split(x0, y0, x1, m, depth + 1); split(x0, m, x1, y1, depth + 1); }
    };
    // section grid offsets so a gravel road passes near, not through, the site
    const gx = px(-700), gy = px(-640);
    for (const [a, b] of [[0, gx], [gx, S]]) for (const [c2, d2] of [[0, gy], [gy, S]]) split(a, c2, b, d2, 0);
    for (const [a, b, c2, d2] of leaves) {
      x.fillStyle = crops[(r() * crops.length) | 0]; x.globalAlpha = 0.92; x.fillRect(a, b, c2 - a, d2 - b); x.globalAlpha = 1;
      x.fillStyle = r() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,220,0.05)';
      if (r() < 0.5) for (let yy = b; yy < d2; yy += 4) x.fillRect(a, yy, c2 - a, 1.5); else for (let xx = a; xx < c2; xx += 4) x.fillRect(xx, b, 1.5, d2 - b);
      x.strokeStyle = 'rgba(70,84,44,0.55)'; x.lineWidth = 1.5; x.strokeRect(a, b, c2 - a, d2 - b);
      if (r() < 0.3) { // tree line on one edge
        const horiz = r() < 0.5, e = horiz ? [a, b, c2, b] : [a, b, a, d2];
        feats.treeLines.push(e.map((v) => (v / S - 0.5) * size));
        x.fillStyle = 'rgba(52,78,38,0.9)';
        for (let t = 0; t < 1; t += 5 / Math.hypot(e[2] - e[0], e[3] - e[1])) x.fillRect(lerp(e[0], e[2], t) - 3 + r() * 2, lerp(e[1], e[3], t) - 3 + r() * 2, 5 + r() * 3, 5 + r() * 3);
      }
    }
    // creek with riparian trees
    const cy0 = px(-900 - r() * 200);
    x.strokeStyle = 'rgba(58,84,42,0.9)'; x.lineWidth = 20; x.beginPath(); x.moveTo(0, cy0); x.bezierCurveTo(S * 0.25, cy0 + 220, S * 0.5, cy0 - 240, S, cy0 + 120); x.stroke();
    x.strokeStyle = 'rgba(60,74,70,0.9)'; x.lineWidth = 3; x.stroke();
    // gravel section roads
    x.fillStyle = '#c9bea2'; x.fillRect(gx - 2.5, 0, 5, S); x.fillRect(0, gy - 2.5, S, 5); x.fillRect(px(910) - 2.5, 0, 5, S);
    // farmsteads
    for (let i = 0; i < 6; i++) {
      let X, Y;
      do { X = S * (0.1 + r() * 0.8); Y = S * (0.1 + r() * 0.8); } while (Math.hypot(X - S / 2, Y - S / 2) < 480 / mpp);
      feats.farms.push([(X / S - 0.5) * size, (Y / S - 0.5) * size]);
      x.fillStyle = '#7f9552'; x.fillRect(X - 34, Y - 30, 68, 60);
      x.fillStyle = 'rgba(48,74,36,0.95)'; for (let t = 0; t < 46; t++) x.fillRect(X - 34 + r() * 64, Y - 30 + (r() < 0.6 ? r() * 14 : r() * 56), 5, 5);
      for (let t = 0; t < 5; t++) { x.fillStyle = ['#d9d9d4', '#b9bcbc', '#8a6a52', '#e4e2dc'][(r() * 4) | 0]; x.fillRect(X - 16 + r() * 30, Y - 8 + r() * 26, 5 + r() * 9, 4 + r() * 5); }
      x.fillStyle = '#c9bea2'; x.fillRect(X - 1, Y, 2.5, 40);
    }
    // the site parcel reads as one mowed lot
    const g = x.createRadialGradient(S / 2, px((clear.z0 + clear.z1) / 2), 100 / mpp, S / 2, px((clear.z0 + clear.z1) / 2), 330 / mpp);
    g.addColorStop(0, 'rgba(134,148,88,0.95)'); g.addColorStop(0.8, 'rgba(134,148,88,0.9)'); g.addColorStop(1, 'rgba(134,148,88,0)');
    x.fillStyle = g; x.fillRect(S / 2 - 340 / mpp, px((clear.z0 + clear.z1) / 2) - 340 / mpp, 680 / mpp, 680 / mpp);
  } else { // southTexas: brushy ranchland with live oak mottes
    const leaves = [];
    const split = (x0, y0, x1, y1, depth) => {
      const w = x1 - x0, h = y1 - y0;
      if (depth > 3 || r() < 0.15) { leaves.push([x0, y0, x1, y1]); return; }
      if (w > h) { const m = x0 + w * (0.3 + r() * 0.4); split(x0, y0, m, y1, depth + 1); split(m, y0, x1, y1, depth + 1); }
      else { const m = y0 + h * (0.3 + r() * 0.4); split(x0, y0, x1, m, depth + 1); split(x0, m, x1, y1, depth + 1); }
    };
    split(0, 0, S, S, 0);
    for (const [a, b, c2, d2] of leaves) {
      const p = r();
      x.fillStyle = p < 0.3 ? 'rgba(176,170,112,0.45)' : p < 0.5 ? 'rgba(104,128,70,0.4)' : 'rgba(0,0,0,0)';
      x.fillRect(a, b, c2 - a, d2 - b);
      x.strokeStyle = 'rgba(92,104,62,0.5)'; x.lineWidth = 1.2; x.strokeRect(a, b, c2 - a, d2 - b);
    }
    for (let i = 0; i < 520; i++) { // oak mottes
      const X = r() * S, Y = r() * S;
      if (r() > dens(X, Y) * 1.5) continue;
      const n = 6 + r() * 30, rad = 8 + r() * 26;
      feats.mottes.push([(X / S - 0.5) * size, (Y / S - 0.5) * size, rad * mpp]);
      for (let t = 0; t < n; t++) { const a = r() * 6.28, dd = Math.sqrt(r()) * rad; x.fillStyle = r() < 0.5 ? 'rgba(52,76,40,0.9)' : 'rgba(66,90,46,0.85)'; const s = 4 + r() * 5; x.beginPath(); x.arc(X + Math.cos(a) * dd, Y + Math.sin(a) * dd, s / 2 + 1, 0, 6.28); x.fill(); }
    }
    for (let i = 0; i < 60000; i++) { const X = r() * S, Y = r() * S; if (r() > dens(X, Y)) continue; x.fillStyle = 'rgba(78,98,54,0.5)'; x.fillRect(X, Y, 1.5 + r(), 1.5 + r()); }
    for (let i = 0; i < 4; i++) wobble(r() * S, 0, r() * S, S, 3, 'rgba(222,214,192,0.9)', 50);
    wobble(0, px(-700), S, px(-760), 3.5, 'rgba(222,214,192,0.9)', 30);
    for (let i = 0; i < 8; i++) { let X, Y; do { X = r() * S; Y = r() * S; } while (Math.hypot(X - S / 2, Y - S / 2) < 420 / mpp); x.fillStyle = 'rgba(52,70,66,0.95)'; x.beginPath(); x.ellipse(X, Y, 10 + r() * 12, 7 + r() * 8, r() * 3, 0, 6.28); x.fill(); }
    const g = x.createRadialGradient(S / 2, S / 2, 120 / mpp, S / 2, S / 2, 320 / mpp);
    g.addColorStop(0, 'rgba(140,150,96,0.9)'); g.addColorStop(1, 'rgba(140,150,96,0)');
    x.fillStyle = g; x.fillRect(S / 2 - 330 / mpp, S / 2 - 330 / mpp, 660 / mpp, 660 / mpp);
  }
  // haze toward the horizon
  const hz = new THREE.Color(HORIZON[kind]), hc = `${(hz.r * 255) | 0},${(hz.g * 255) | 0},${(hz.b * 255) | 0}`;
  const hg = x.createRadialGradient(S / 2, S / 2, S * 0.3, S / 2, S / 2, S * 0.5);
  hg.addColorStop(0, `rgba(${hc},0)`); hg.addColorStop(0.6, `rgba(${hc},0.55)`); hg.addColorStop(1, `rgba(${hc},1)`);
  x.fillStyle = hg; x.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return (GROUND_TEX[key] = { map: t, feats });
}

function groundDetail() {
  if (TEX.gdetail) return TEX.gdetail;
  const S = 512, [c, x] = mk(S), a = fbm(S, 32, 4, 301), b = fbm(S, 5, 5, 302), rr = rng(303), id = x.createImageData(S, S), d = id.data;
  for (let i = 0; i < a.length; i++) { d[i * 4] = clamp(a[i] * 255 + (rr() - 0.5) * 60, 0, 255); d[i * 4 + 1] = b[i] * 255; d[i * 4 + 2] = 0; d[i * 4 + 3] = 255; }
  x.putImageData(id, 0, 0);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 520; i++) { // scrub clumps in the blue channel
    const px = rr() * S, py = rr() * S, rad = 2 + rr() * rr() * 9;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const g = x.createRadialGradient(px + ox, py + oy, 0, px + ox, py + oy, rad);
      g.addColorStop(0, 'rgba(0,0,255,1)'); g.addColorStop(0.6, 'rgba(0,0,255,0.8)'); g.addColorStop(1, 'rgba(0,0,255,0)');
      x.fillStyle = g; x.fillRect(px + ox - rad, py + oy - rad, rad * 2, rad * 2);
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return (TEX.gdetail = t);
}

export function buildGround(opts = {}) {
  const kind = HORIZON[opts.variant] ? opts.variant : HORIZON[opts.kind] ? opts.kind : 'westTexas';
  const size = opts.size ?? 3200, seed = opts.seed ?? 5, flatR = opts.flatRadius ?? 260, roadZ = opts.roadZ ?? 160;
  const clear = opts.clear ?? { x0: -200, x1: 200, z0: -160, z1: roadZ - 8 };
  const amp = opts.relief ?? (kind === 'westTexas' ? 4 : kind === 'midwest' ? 7 : 6);
  const group = new THREE.Group(), k = new Kit(seed + 900), r = k.rand;
  const heightAt = (x, z) => {
    const m = sstep(flatR, flatR + 320, Math.hypot(x, z)) * sstep(14, 90, Math.abs(z - roadZ));
    if (m <= 0) return 0;
    return ((vnoise(x / 420 + seed, z / 420) - 0.5) * 2 + (vnoise(x / 130, z / 130 + seed) - 0.5) * 0.5) * amp * m;
  };
  const { map, feats } = groundTexture(kind, seed, size, clear);
  const seg = 96, geo = new THREE.PlaneGeometry(size, size, seg, seg); geo.rotateX(-PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, heightAt(p.getX(i), p.getZ(i)) - 0.02);
  geo.computeVertexNormals();
  const detail = groundDetail();
  const mat = std({ map, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 4 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.gDetail = { value: detail };
    sh.fragmentShader = 'uniform sampler2D gDetail;\n' + sh.fragmentShader.replace('#include <map_fragment>',
      `#include <map_fragment>
      vec3 gdA = texture2D(gDetail, vMapUv * ${(size / 57).toFixed(1)}).rgb;
      vec3 gdB = texture2D(gDetail, vMapUv * ${(size / 211).toFixed(1)}).rgb;
      vec3 gdC = texture2D(gDetail, vMapUv * ${(size / 9).toFixed(1)}).rgb;
      float gLum = dot(diffuseColor.rgb, vec3(0.3, 0.5, 0.2));
      diffuseColor.rgb *= 0.56 + 0.3 * gdC.r + 0.26 * gdA.g + 0.3 * gdB.g;
      float gClump = max(gdA.b, gdB.b * 0.4) * ${({ westTexas: 0.8, southTexas: 0.55, midwest: 0.0 }[kind]).toFixed(2)} * (1.0 - smoothstep(0.42, 0.56, gLum));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.4, 0.45, 0.32), gClump);`);
  };
  const ground = new THREE.Mesh(geo, mat); ground.receiveShadow = true; ground.name = 'ground';
  group.add(ground);

  // public road with a pole line
  k.flat('road', size * 0.96, 9, 0, 0.05, roadZ);
  for (let x = -size * 0.3; x <= size * 0.3; x += 62) {
    k.cyl('rust', 0.16, 10.5, x, 0, roadZ + 11, 6, 0.1); k.box('rust', 0.12, 0.12, 2.4, x, 9.6, roadZ + 11);
    for (const dz of [-1.05, 0, 1.05]) { k.cyl('ceramic', 0.05, 0.2, x, 9.72, roadZ + 11 + dz, 5); if (x + 62 <= size * 0.3) k.pipe('steelDark', [x, 9.9, roadZ + 11 + dz], [x + 62, 9.9, roadZ + 11 + dz], 0.02, 3); }
  }
  // vegetation near the site, outside the cleared rectangle
  const ok = (x, z) => !(x > clear.x0 && x < clear.x1 && z > clear.z0 && z < clear.z1) && Math.abs(z - roadZ) > 9;
  const put = (kindT, x, z, s) => { if (ok(x, z)) { const v = 0.85 + r() * 0.3; k.inst('tree:' + kindT, x, heightAt(x, z) - 0.05, z, r() * 6.28, s, new THREE.Color(v, v, v * 0.95).getHex(), s * (0.85 + r() * 0.3)); } };
  if (kind === 'westTexas') {
    for (let i = 0; i < 1500; i++) { const a = r() * 6.28, d = 90 + Math.sqrt(r()) * 640; put('shrub', Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 1.3); }
    for (let i = 0; i < 170; i++) { const a = r() * 6.28, d = 90 + Math.sqrt(r()) * 700; put('mesqLo', Math.cos(a) * d, Math.sin(a) * d, 0.8 + r() * 0.6); }
  } else if (kind === 'midwest') {
    for (const [ax, az, bx2, bz] of feats.treeLines) {
      if (Math.min(Math.hypot(ax, az), Math.hypot(bx2, bz)) > 1300) continue;
      const len = Math.hypot(bx2 - ax, bz - az);
      for (let t = 0; t < len; t += 9 + r() * 8) put('decid', lerp(ax, bx2, t / len) + (r() - 0.5) * 6, lerp(az, bz, t / len) + (r() - 0.5) * 6, 0.8 + r() * 0.6);
    }
    for (const [fx, fz] of feats.farms) {
      for (let t = 0; t < 16; t++) put('decid', fx - 45 + r() * 90, fz - 42 + r() * 24, 0.8 + r() * 0.5);
      k.box('ribLight', 14, 5, 9, fx + 6, heightAt(fx, fz), fz + 12, r() * 3); k.box('white', 10, 4, 8, fx - 14, heightAt(fx, fz), fz + 10, r()); k.cyl('galv', 2.4, 9, fx + 22, heightAt(fx, fz), fz + 4, 12);
    }
    for (let x = -size * 0.3; x < size * 0.3; x += 40 + r() * 90) if (r() < 0.5) put('decid', x, roadZ + 22 + r() * 6, 0.8 + r() * 0.5);
  } else {
    for (const [mx, mz, rad] of feats.mottes) {
      if (Math.hypot(mx, mz) > 800) continue;
      const n = Math.min(7, 2 + (rad / 9) | 0);
      for (let t = 0; t < n; t++) { const a = r() * 6.28, d = Math.sqrt(r()) * rad; put('oakLo', mx + Math.cos(a) * d, mz + Math.sin(a) * d, 0.8 + r() * 0.6); }
    }
    for (let i = 0; i < 500; i++) { const a = r() * 6.28, d = 100 + Math.sqrt(r()) * 600; put('shrub', Math.cos(a) * d, Math.sin(a) * d, 1 + r() * 1.5); }
  }
  k.build(group);
  group.userData = {
    kind: 'prop', variant: kind, seed, size: { x: size, y: amp * 2, z: size },
    hudAnchor: new V3(0, 0, 0), focus: { center: new V3(0, 0, 0), radius: size / 2 },
    horizonColor: new THREE.Color(HORIZON[kind]), roadZ, heightAt,
    setEnclosureOpacity() {}, setStatus() {}, update() {}, setNight,
    dispose() { geo.dispose(); mat.dispose(); group.traverse((o) => { if (o.isMesh && o !== ground && !o.userData.shared) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); }); },
  };
  return group;
}

export const BUILDING_VARIANTS = {
  hospital: ['regional', 'community'],
  dataCenter: ['hyperscale', 'edge', 'colo'],
  wellPad: ['frac', 'drill'],
  testCell: ['shop'],
  ground: ['westTexas', 'midwest', 'southTexas'],
};
