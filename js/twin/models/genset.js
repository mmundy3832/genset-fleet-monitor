// Procedural 2.6 MW / 2.0 MW natural gas generator set for the 3D twin.
// Exterior is built once per unit type and shared; the engine room is built
// lazily the first time an enclosure is opened. See buildGenset() at the end.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI, HP = Math.PI / 2, TAU = Math.PI * 2;
const DECK = 1.02; // trailer deck height for mobile units

const SPECS = {
  'PWR2.6-S': { L: 12.2, H: 3.3, hs: 0.32, cyl: 20, mobile: false, scr: true, fans: 4, paint: 'engY' },
  'PWR2.6-M': { L: 12.2, H: 3.2, hs: 0.2, cyl: 20, mobile: true, scr: false, fans: 4, paint: 'engY' },
  'PWR2.0': { L: 11.0, H: 3.2, hs: 0.2, cyl: 16, mobile: true, scr: false, fans: 3, paint: 'engG' },
};

function layout(sp) {
  const L = sp.L, xa = -L / 2, xb = L / 2, big = L > 12, hs = sp.hs;
  const o = { L, xa, xb, hw: 1.5, H: sp.H, hs };
  o.ctrl = [xa + 0.35, xa + 1.45];
  o.louv1 = [xa + 1.95, xa + 3.95];
  o.door1 = [xa + 4.3, xa + 5.3];
  o.panel = [xa + 5.6, xa + 5.6 + (big ? 2.0 : 1.5)];
  o.door2 = [o.panel[1] + 0.3, o.panel[1] + 1.3];
  o.louv2 = [xb - (big ? 2.6 : 2.3), xb - 0.5];
  o.xbh = o.louv2[0] - 0.2;            // vent bulkhead
  o.xg0 = xa + 2.05; o.xg1 = o.xg0 + 2.3; // alternator
  o.xr = o.xg1 + 0.72;                 // block rear face
  o.Lb = 0.26 * sp.cyl / 2 + 0.3; o.xf = o.xr + o.Lb;
  o.xt = o.xr - 0.35;                  // turbo plane, exhaust riser
  o.yc = hs + 1.22; o.yt = o.yc + 1.28; // crank centerline, turbo centerline
  o.pipeX = [o.xf + 0.5, o.xf + 0.7, o.xf + 0.9]; // coolant risers at z = -1.3
  o.Lc = sp.fans * 1.4 + 0.3; o.x1c = xb - 0.25; o.x0c = o.x1c - o.Lc; // roof cooler
  o.gasY = 0.78; o.gasZ = 0.9;
  return o;
}

// ---------------------------------------------------------------- geometry kit

const _E = new THREE.Euler(), _Yv = new THREE.Vector3(0, 1, 0), _Dv = new THREE.Vector3();
const _M1 = new THREE.Matrix4(), _M2 = new THREE.Matrix4(), _Q1 = new THREE.Quaternion();
const _P1 = new THREE.Vector3(), _S1 = new THREE.Vector3(1, 1, 1);

function axisQuat(axis, q) {
  if (!axis || axis === 'y') return q.identity();
  if (axis === 'x') return q.setFromEuler(_E.set(0, 0, -HP));
  if (axis === 'z') return q.setFromEuler(_E.set(HP, 0, 0));
  _Dv.set(axis[0], axis[1], axis[2]).normalize();
  return q.setFromUnitVectors(_Yv, _Dv);
}

function flipWinding(g) {
  for (const name of ['position', 'normal', 'uv']) {
    const at = g.attributes[name], a = at.array, n = at.itemSize;
    for (let i = 0; i < a.length; i += 3 * n) {
      for (let c = 0; c < n; c++) { const t = a[i + n + c]; a[i + n + c] = a[i + 2 * n + c]; a[i + 2 * n + c] = t; }
    }
  }
}

function chamferBox(w, h, d, r = 0.006) {
  const D = [w / 2, h / 2, d / 2];
  r = Math.max(0.0004, Math.min(r, D[0] * 0.6, D[1] * 0.6, D[2] * 0.6));
  const pos = [], nor = [], uv = [], idx = [];
  const id = (a, s, sg) => ((a * 2 + (s > 0 ? 1 : 0)) * 4) + (sg[(a + 1) % 3] > 0 ? 1 : 0) + (sg[(a + 2) % 3] > 0 ? 2 : 0);
  for (let a = 0; a < 3; a++) for (const s of [-1, 1]) {
    const u = (a + 1) % 3, v = (a + 2) % 3;
    for (let k = 0; k < 4; k++) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[a] = s * D[a]; p[u] = (k & 1 ? 1 : -1) * (D[u] - r); p[v] = (k & 2 ? 1 : -1) * (D[v] - r); n[a] = s;
      pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]);
      if (a === 0) uv.push(p[2], p[1]); else if (a === 1) uv.push(p[0], p[2]); else uv.push(p[0], p[1]);
    }
  }
  const tri = (i, j, k) => {
    const ax = pos[i * 3], ay = pos[i * 3 + 1], az = pos[i * 3 + 2];
    const bx = pos[j * 3] - ax, by = pos[j * 3 + 1] - ay, bz = pos[j * 3 + 2] - az;
    const cx = pos[k * 3] - ax, cy = pos[k * 3 + 1] - ay, cz = pos[k * 3 + 2] - az;
    const nx = by * cz - bz * cy, ny = bz * cx - bx * cz, nz = bx * cy - by * cx;
    const mx = ax * 3 + bx + cx, my = ay * 3 + by + cy, mz = az * 3 + bz + cz;
    if (nx * mx + ny * my + nz * mz >= 0) idx.push(i, j, k); else idx.push(i, k, j);
  };
  for (let f = 0; f < 6; f++) { const b = f * 4; tri(b, b + 1, b + 3); tri(b, b + 3, b + 2); }
  for (let e = 0; e < 3; e++) {
    const b = (e + 1) % 3, c = (e + 2) % 3;
    for (const sb of [-1, 1]) for (const sc of [-1, 1]) {
      const s0 = [0, 0, 0], s1 = [0, 0, 0]; s0[e] = -1; s1[e] = 1; s0[b] = s1[b] = sb; s0[c] = s1[c] = sc;
      const q = [id(b, sb, s0), id(b, sb, s1), id(c, sc, s1), id(c, sc, s0)];
      tri(q[0], q[1], q[2]); tri(q[0], q[2], q[3]);
    }
  }
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const sg = [sx, sy, sz]; tri(id(0, sx, sg), id(1, sy, sg), id(2, sz, sg));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function fillet(pts, bend, n = 5) {
  const P = pts.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  if (P.length < 3 || bend <= 0) return P;
  const out = [P[0]];
  for (let i = 1; i < P.length - 1; i++) {
    const b = P[i], u = P[i - 1].clone().sub(b), v = P[i + 1].clone().sub(b);
    const lu = u.length(), lv = v.length(); u.divideScalar(lu); v.divideScalar(lv);
    const ang = Math.acos(Math.max(-1, Math.min(1, u.dot(v))));
    if (ang > PI - 0.03) { out.push(b); continue; }
    const dd = Math.min(bend / Math.tan(ang / 2), lu * 0.49, lv * 0.49);
    const p0 = b.clone().addScaledVector(u, dd), p1 = b.clone().addScaledVector(v, dd);
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      out.push(new THREE.Vector3().copy(p0).multiplyScalar((1 - t) * (1 - t)).addScaledVector(b, 2 * t * (1 - t)).addScaledVector(p1, t * t));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}

function sweepGeom(P, r, radial = 8, caps = false) {
  const n = P.length, pos = [], nor = [], uv = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), B = new THREE.Vector3(), dir = new THREE.Vector3();
  const uc = Math.max(1, Math.round(TAU * r / 0.25)) * 0.25;
  let dist = 0;
  const tan = (i, out) => out.copy(P[Math.min(i + 1, n - 1)]).sub(P[Math.max(i - 1, 0)]).normalize();
  tan(0, T);
  N.set(0, 1, 0); if (Math.abs(T.y) > 0.9) N.set(1, 0, 0);
  N.addScaledVector(T, -N.dot(T)).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { dist += P[i].distanceTo(P[i - 1]); tan(i, T); N.addScaledVector(T, -N.dot(T)).normalize(); }
    B.crossVectors(T, N);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      dir.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      pos.push(P[i].x + dir.x * r, P[i].y + dir.y * r, P[i].z + dir.z * r);
      nor.push(dir.x, dir.y, dir.z); uv.push(j / radial * uc, dist);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  if (caps) {
    for (const end of [0, n - 1]) {
      tan(end, T); const s = end === 0 ? -1 : 1, c = pos.length / 3;
      pos.push(P[end].x, P[end].y, P[end].z); nor.push(T.x * s, T.y * s, T.z * s); uv.push(0, 0);
      const base = end * (radial + 1), ring = pos.length / 3;
      for (let j = 0; j <= radial; j++) {
        pos.push(pos[(base + j) * 3], pos[(base + j) * 3 + 1], pos[(base + j) * 3 + 2]);
        nor.push(T.x * s, T.y * s, T.z * s); uv.push(0, 0);
      }
      for (let j = 0; j < radial; j++) { if (s > 0) idx.push(c, ring + j, ring + j + 1); else idx.push(c, ring + j + 1, ring + j); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// profile: [[r, y, smooth?], ...]; interior points are hard edges unless smooth is set
function latheGeom(profile, seg = 20) {
  const pts = [];
  profile.forEach((p, i) => {
    pts.push(new THREE.Vector2(p[0], p[1]));
    if (i > 0 && i < profile.length - 1 && !p[2]) pts.push(new THREE.Vector2(p[0], p[1]));
  });
  return new THREE.LatheGeometry(pts, seg);
}

// container style trapezoid corrugation in the wall plane, outer flats at z = 0
function corrGeom(x0, x1, y0, y1, depth = 0.036, pitch = 0.28) {
  const bp = [[0, 0], [0.10, 0], [0.14, -depth], [0.24, -depth], [0.28, 0]];
  const zAt = (x) => {
    const u = ((x % pitch) + pitch) % pitch;
    for (let i = 0; i < 4; i++) if (u <= bp[i + 1][0] + 1e-9) {
      const t = (u - bp[i][0]) / (bp[i + 1][0] - bp[i][0]); return bp[i][1] + (bp[i + 1][1] - bp[i][1]) * t;
    }
    return 0;
  };
  const P = [[x0, zAt(x0)]];
  for (let k = Math.floor(x0 / pitch) - 1; k * pitch < x1; k++) for (let i = 0; i < 4; i++) {
    const x = k * pitch + bp[i][0]; if (x > x0 + 1e-4 && x < x1 - 1e-4) P.push([x, bp[i][1]]);
  }
  P.push([x1, zAt(x1)]);
  const pos = [], nor = [], uv = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [xa, za] = P[i], [xb, zb] = P[i + 1];
    let nx = -(zb - za), nz = xb - xa; const l = Math.hypot(nx, nz); nx /= l; nz /= l;
    const v = [[xa, y0, za], [xb, y0, zb], [xb, y1, zb], [xa, y0, za], [xb, y1, zb], [xa, y1, za]];
    for (const p of v) { pos.push(p[0], p[1], p[2]); nor.push(nx, 0, nz); uv.push(p[0] * 0.25, p[1] / 3.3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Small plain-colored parts are folded into three vertex-colored materials to keep draw calls down.
const VC = { vcPaint: 1, vcMetal: 1, glow: 1 };
const ALIAS = {
  paint: ['vcPaint', 0xd6d9d9], paintGrey: ['vcPaint', 0xa3a9ad], frame: ['vcPaint', 0x2f3337], chassis: ['vcPaint', 0x17191b],
  yellow: ['vcPaint', 0xd9a514], pipe: ['vcPaint', 0x4f575d], urea: ['vcPaint', 0x2a6db3], estop: ['vcPaint', 0xa32b1c],
  filterWhite: ['vcPaint', 0xe6e1d2], rim: ['vcPaint', 0xd0d2d3], black: ['vcPaint', 0x141516], rubber: ['vcPaint', 0x0d0d0e],
  cable: ['vcPaint', 0x1a1a1c], cableGY: ['vcPaint', 0x76a83a], louverDark: ['vcPaint', 0x0b0c0d], gaugeFace: ['vcPaint', 0xf1f1ec],
  lensRed: ['vcPaint', 0x7c1d16], glass: ['vcPaint', 0x0b1116], silicone: ['vcPaint', 0x14285c],
  bolt: ['vcMetal', 0x8b9094], steel: ['vcMetal', 0xc9cdd1], stainless: ['vcMetal', 0xd6d9db], copper: ['vcMetal', 0xc27a48], brass: ['vcMetal', 0xb9973c],
  led: ['glow', 0xfff1d6, 2.4], lampG: ['glow', 0x3ddc84, 1.8], lampA: ['glow', 0xf5a623, 1.0], lampW: ['glow', 0xe8f0ff, 1.1], lensAmber: ['glow', 0xf5a623, 0.45],
};
// Interior kits keep rubber, looms and each bare metal as their own material so they can differ in finish.
const IALIAS = { ...ALIAS };
for (const k of ['rubber', 'cable', 'bolt', 'steel', 'stainless', 'copper', 'brass', 'silicone']) delete IALIAS[k];
const _C1 = new THREE.Color();

function hexGeom() {
  // hex bolt head: 6 sides and a top cap, 16 triangles
  const pos = [], idx = [];
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; pos.push(Math.cos(a), -0.4, Math.sin(a), Math.cos(a), 0.4, Math.sin(a)); }
  for (let i = 0; i < 6; i++) { const a = i * 2, b = ((i + 1) % 6) * 2; idx.push(a, a + 1, b + 1, a, b + 1, b); }
  for (let i = 1; i < 5; i++) idx.push(1, (i + 1) * 2 + 1, i * 2 + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const n = g.toNonIndexed(); n.computeVertexNormals();
  n.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n.attributes.position.count * 2), 2));
  return n;
}

let _hex = null;
class Kit {
  constructor(alias) { this.alias = alias || ALIAS; this.bins = new Map(); this.stack = [new THREE.Matrix4()]; }
  get top() { return this.stack[this.stack.length - 1]; }
  push(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    this.stack.push(this.top.clone().multiply(m)); return this;
  }
  pop() { this.stack.pop(); return this; }
  addM(mat, geom, local) {
    const g = geom.index ? geom.toNonIndexed() : geom.clone();
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
    const m = _M2.multiplyMatrices(this.top, local);
    g.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(g);
    const al = this.alias[mat], key = al ? al[0] : mat;
    if (VC[key]) {
      _C1.setHex(al ? al[1] : 0xffffff); if (al && al[2]) _C1.multiplyScalar(al[2]);
      const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { col[i * 3] = _C1.r; col[i * 3 + 1] = _C1.g; col[i * 3 + 2] = _C1.b; }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    let bin = this.bins.get(key); if (!bin) this.bins.set(key, bin = []);
    bin.push(g);
  }
  geo(mat, geom, x = 0, y = 0, z = 0, axis) {
    _M1.compose(_P1.set(x, y, z), axisQuat(axis, _Q1), _S1); this.addM(mat, geom, _M1);
  }
  geoR(mat, geom, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _M1.compose(_P1.set(x, y, z), _Q1.setFromEuler(_E.set(rx, ry, rz)), _S1); this.addM(mat, geom, _M1);
  }
  box(mat, w, h, d, x, y, z, r = 0.006) { this.geo(mat, chamferBox(w, h, d, r), x, y, z); }
  pbox(mat, w, h, d, x, y, z) { this.geo(mat, new THREE.BoxGeometry(w, h, d), x, y, z); }
  rbox(mat, w, h, d, x, y, z, rad = 0.02, seg = 2) { this.geo(mat, new RoundedBoxGeometry(w, h, d, seg, rad), x, y, z); }
  cyl(mat, r, len, x, y, z, axis = 'y', seg = 12, rTop = r, open = false) {
    this.geo(mat, new THREE.CylinderGeometry(rTop, r, len, seg, 1, open), x, y, z, axis);
  }
  arc(mat, r, len, x, y, z, axis, th0, thl, seg = 10) {
    this.geo(mat, new THREE.CylinderGeometry(r, r, len, seg, 1, true, th0, thl), x, y, z, axis);
  }
  lathe(mat, profile, x, y, z, axis = 'y', seg = 20) { this.geo(mat, latheGeom(profile, seg), x, y, z, axis); }
  tube(mat, pts, r, o = {}) {
    const radial = o.radial || (r < 0.02 ? 6 : r < 0.07 ? 8 : 12);
    const P = fillet(pts, o.bend === undefined ? r * 2.2 : o.bend, o.n || 5);
    this.geo(mat, sweepGeom(P, r, radial, o.caps));
  }
  torus(mat, R, r, x, y, z, axis = 'y', ts = 16, rs = 6, arc = TAU) {
    const g = new THREE.TorusGeometry(R, r, rs, ts, arc); g.rotateX(HP); this.geo(mat, g, x, y, z, axis);
  }
  bolt(x, y, z, axis = 'y', s = 0.011, mat = 'bolt', len = 0) {
    if (!_hex) _hex = hexGeom();
    _M1.compose(_P1.set(x, y, z), axisQuat(axis, _Q1), new THREE.Vector3(s, len || s, s)); this.addM(mat, _hex, _M1);
  }
  quad(mat, w, h, x, y, z, ry = 0, rx = 0) {
    const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
    this.geoR(mat, g, x, y, z, rx, ry, 0);
  }
  // flange disc with optional bolt circle, axis is 'x' | 'y' | 'z'
  flange(mat, x, y, z, axis, r, t = 0.02, nb = 0, seg = 16) {
    this.cyl(mat, r, t, x, y, z, axis, seg);
    for (let i = 0; i < nb; i++) {
      const a = i / nb * TAU + 0.3, c = Math.cos(a) * r * 0.85, s = Math.sin(a) * r * 0.85;
      const ln = (t + 0.016) / 0.8;
      if (axis === 'x') this.bolt(x, y + c, z + s, 'x', 0.009, 'bolt', ln);
      else if (axis === 'y') this.bolt(x + c, y, z + s, 'y', 0.009, 'bolt', ln);
      else this.bolt(x + c, y + s, z, 'z', 0.009, 'bolt', ln);
    }
  }
  build() {
    const out = new Map(); let tris = 0;
    for (const [mat, list] of this.bins) {
      const g = mergeGeometries(list, false);
      for (const l of list) l.dispose();
      g.computeBoundingSphere(); g.computeBoundingBox();
      tris += g.attributes.position.count / 3; out.set(mat, g);
    }
    out.tris = tris; this.bins.clear();
    return out;
  }
}

// ---------------------------------------------------------------- textures

function rng(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

function fbm(size, base, octaves, seed) {
  const out = new Float32Array(size * size), R = rng(seed);
  let amp = 1, tot = 0;
  for (let o = 0; o < octaves; o++) {
    const per = base << o, lat = new Float32Array(per * per);
    for (let i = 0; i < lat.length; i++) lat[i] = R();
    const sc = per / size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const fx = x * sc, fy = y * sc, x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const x1 = (x0 + 1) % per, y1 = (y0 + 1) % per;
      const a = lat[y0 * per + x0], b = lat[y0 * per + x1], c = lat[y1 * per + x0], d = lat[y1 * per + x1];
      out[y * size + x] += amp * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
    }
    tot += amp; amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function fieldCanvas(size, fn) {
  const c = canvas(size, size), ctx = c.getContext('2d'), img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = fn(x, y), i = (y * size + x) * 4;
    d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function tex(c, srgb, rx = 1, ry = 1) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let _T = null;
function textures() {
  if (_T) return _T;
  const T = {}, C = {};
  const g3 = (v) => [v, v, v];
  { const f = fbm(256, 4, 5, 11); C.rough = fieldCanvas(256, (x, y) => g3(170 + 85 * f[y * 256 + x])); }
  { const f = fbm(256, 32, 3, 23); C.cast = fieldCanvas(256, (x, y) => g3(90 + 150 * f[y * 256 + x])); }
  { // painted wall: mottling, rain streaks, splash dirt at the bottom
    const S = 512, f = fbm(S, 4, 5, 5);
    const c = fieldCanvas(S, (x, y) => { const v = 232 + 20 * f[y * S + x]; return [v, v, v - 2]; });
    const ctx = c.getContext('2d'), R = rng(77);
    for (let i = 0; i < 150; i++) {
      const x = R() * S, y = R() * S * 0.12, len = S * (0.15 + R() * 0.7), w = 1 + R() * 2.5;
      const gr = ctx.createLinearGradient(0, y, 0, y + len);
      gr.addColorStop(0, `rgba(96,86,74,${0.07 + R() * 0.16})`); gr.addColorStop(1, 'rgba(96,86,74,0)');
      ctx.fillStyle = gr; ctx.fillRect(x, y, w, len);
    }
    let gr = ctx.createLinearGradient(0, S * 0.78, 0, S);
    gr.addColorStop(0, 'rgba(112,98,80,0)'); gr.addColorStop(1, 'rgba(112,98,80,0.30)');
    ctx.fillStyle = gr; ctx.fillRect(0, S * 0.78, S, S * 0.22);
    gr = ctx.createLinearGradient(0, 0, 0, S * 0.1);
    gr.addColorStop(0, 'rgba(80,76,70,0.16)'); gr.addColorStop(1, 'rgba(80,76,70,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, S, S * 0.1);
    C.wall = c;
  }
  { const f = fbm(256, 16, 3, 31), f2 = fbm(256, 4, 3, 32); C.galv = fieldCanvas(256, (x, y) => g3(175 + 55 * f[y * 256 + x] + 25 * f2[y * 256 + x])); }
  { // insulation blanket quilting
    const S = 256, f = fbm(S, 16, 3, 41);
    const pil = (x, y) => { const u = x / 64, v = y / 64, a = u + v, b = u - v; return Math.sqrt(Math.abs(Math.sin(PI * a) * Math.sin(PI * b))); };
    C.quiltB = fieldCanvas(S, (x, y) => g3(40 + 200 * pil(x, y) + 15 * f[y * S + x]));
    C.quiltC = fieldCanvas(S, (x, y) => { const p = pil(x, y), v = 170 + 50 * Math.min(1, p * 3) + 40 * (f[y * S + x] - 0.5); return [v, v, v * 0.98]; });
  }
  { // diamond tread plate
    const S = 256, cb = canvas(S, S), cc = canvas(S, S), b = cb.getContext('2d'), k = cc.getContext('2d'), f = fbm(S, 8, 4, 51);
    b.fillStyle = '#4a4a4a'; b.fillRect(0, 0, S, S);
    const img = k.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = 150 + 50 * f[i]; img.data[i * 4] = v; img.data[i * 4 + 1] = v + 2; img.data[i * 4 + 2] = v + 5; img.data[i * 4 + 3] = 255; }
    k.putImageData(img, 0, 0);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      for (const ctx of [b, k]) {
        ctx.save(); ctx.translate(i * 64 + 32, j * 64 + 32); ctx.rotate((i + j) % 2 ? PI / 4 : -PI / 4);
        ctx.fillStyle = ctx === b ? '#f0f0f0' : 'rgba(235,238,240,0.5)';
        ctx.beginPath(); ctx.ellipse(0, 0, 25, 6, 0, 0, TAU); ctx.fill(); ctx.restore();
      }
    }
    C.plateB = cb; C.plateC = cc;
  }
  { // perforated sheet
    const S = 128, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#e9eaea'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#26282a';
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(i * 32 + (j % 2 ? 24 : 8), j * 32 + 16, 8, 0, TAU); ctx.fill(); }
    C.perf = c;
  }
  { // radiator fins
    const S = 64, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#2c2f31'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#b9bdc0';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 8, 0, 3, S);
    ctx.fillStyle = 'rgba(200,204,208,0.6)'; ctx.fillRect(0, 28, S, 5);
    C.fins = c;
  }
  { // pleated filter media
    const S = 64, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#d8d2bf'; ctx.fillRect(0, 0, S, S); ctx.fillStyle = '#8f8975';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 8, 0, 3, S);
    C.pleat = c;
  }
  { // fan guard wire
    const S = 512, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.strokeStyle = '#d4d7d9'; ctx.lineWidth = 4;
    for (let i = 1; i <= 13; i++) { ctx.beginPath(); ctx.arc(S / 2, S / 2, i * 18.6, 0, TAU); ctx.stroke(); }
    ctx.lineWidth = 6;
    for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; ctx.beginPath(); ctx.moveTo(S / 2, S / 2); ctx.lineTo(S / 2 + Math.cos(a) * 250, S / 2 + Math.sin(a) * 250); ctx.stroke(); }
    ctx.lineWidth = 9; ctx.beginPath(); ctx.arc(S / 2, S / 2, 249, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#d4d7d9'; ctx.beginPath(); ctx.arc(S / 2, S / 2, 26, 0, TAU); ctx.fill();
    C.guard = c;
  }
  { // tire: v runs bead to bead, tread in the middle
    const W = 128, H = 512, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#909090'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#d8d8d8'; ctx.fillRect(0, H * 0.34, W, H * 0.32);
    ctx.fillStyle = '#202020';
    for (const v of [0.42, 0.474, 0.526, 0.58]) ctx.fillRect(0, H * v - 5, W, 10);
    for (let i = 0; i < 4; i++) { ctx.fillRect(i * 32, H * 0.34, 9, H * 0.07); ctx.fillRect(i * 32 + 16, H * 0.59, 9, H * 0.07); }
    for (let i = 0; i < 8; i++) { ctx.fillRect(i * 16 + 4, H * 0.435, 3, H * 0.03); ctx.fillRect(i * 16 + 10, H * 0.535, 3, H * 0.03); }
    ctx.fillStyle = '#b8b8b8'; ctx.fillRect(0, H * 0.2, W, 6); ctx.fillRect(0, H * 0.8, W, 6);
    C.tread = c;
  }
  { // HMI screen
    const W = 512, H = 320, c = canvas(W, H), ctx = c.getContext('2d');
    ctx.fillStyle = '#06131f'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#12314a'; ctx.fillRect(0, 0, W, 34);
    ctx.fillStyle = '#cfe6f5'; ctx.font = 'bold 18px Arial, sans-serif'; ctx.fillText('GENSET CONTROL', 12, 23);
    ctx.fillStyle = '#3ddc84'; ctx.fillRect(W - 120, 9, 108, 17); ctx.fillStyle = '#04200f'; ctx.font = 'bold 13px Arial, sans-serif'; ctx.fillText('RUNNING', W - 98, 22);
    const gauge = (x, y, r, f, lab) => {
      ctx.lineWidth = 9; ctx.strokeStyle = '#1d3e57'; ctx.beginPath(); ctx.arc(x, y, r, PI * 0.8, PI * 2.2); ctx.stroke();
      ctx.strokeStyle = '#3ddc84'; ctx.beginPath(); ctx.arc(x, y, r, PI * 0.8, PI * (0.8 + 1.4 * f)); ctx.stroke();
      ctx.fillStyle = '#e8f4fb'; ctx.font = 'bold 20px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(lab, x, y + 7); ctx.textAlign = 'left';
    };
    gauge(80, 110, 46, 0.9, 'kW'); gauge(200, 110, 46, 0.75, 'V'); gauge(320, 110, 46, 0.6, 'A'); gauge(440, 110, 46, 0.82, 'Hz');
    ctx.font = '13px Arial, sans-serif';
    const labs = ['COOLANT', 'OIL PRESS', 'EXH TEMP', 'GAS PRESS', 'MANIFOLD', 'KVAR'];
    for (let i = 0; i < 6; i++) {
      const y = 186 + i * 21; ctx.fillStyle = '#8fb3c9'; ctx.fillText(labs[i], 14, y + 11);
      ctx.fillStyle = '#12314a'; ctx.fillRect(110, y, 250, 13);
      ctx.fillStyle = i === 2 ? '#f5a623' : '#6fd0ff'; ctx.fillRect(110, y, 250 * (0.35 + 0.1 * ((i * 7) % 5)), 13);
    }
    ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 60; i++) { const x = 378 + i * 2, y = 245 - 30 * Math.sin(i * 0.21) * Math.exp(-i * 0.01) - i * 0.2; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.strokeStyle = '#1d3e57'; ctx.strokeRect(374, 186, 128, 118);
    C.hmi = c;
  }
  { // hazard placards, 4 x 2 atlas of 256 px cells
    const c = canvas(1024, 512), ctx = c.getContext('2d');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cell = (i) => [(i % 4) * 256, Math.floor(i / 4) * 256];
    const sign = (i, head, hc, lines) => {
      const [x, y] = cell(i);
      ctx.fillStyle = '#f4f4f0'; ctx.fillRect(x + 6, y + 30, 244, 196); ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 4; ctx.strokeRect(x + 8, y + 32, 240, 192);
      ctx.fillStyle = hc; ctx.fillRect(x + 12, y + 36, 232, 62);
      ctx.fillStyle = hc === '#f2c21a' ? '#111' : '#fff'; ctx.font = 'bold 44px Arial, sans-serif'; ctx.fillText(head, x + 128, y + 69);
      ctx.fillStyle = '#111'; ctx.font = 'bold 26px Arial, sans-serif';
      lines.forEach((l, k) => ctx.fillText(l, x + 128, y + 128 + k * 32));
    };
    const diamond = (i, fill) => { const [x, y] = cell(i); ctx.beginPath(); ctx.moveTo(x + 128, y + 6); ctx.lineTo(x + 250, y + 128); ctx.lineTo(x + 128, y + 250); ctx.lineTo(x + 6, y + 128); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 5; ctx.strokeStyle = '#111'; ctx.stroke(); return [x, y]; };
    { // 0: fire diamond
      const [x, y] = diamond(0, '#f4f4f0');
      const quad = (px, py, col, txt) => { ctx.save(); ctx.translate(x + 128 + px * 61, y + 128 + py * 61); ctx.rotate(PI / 4); ctx.fillStyle = col; ctx.fillRect(-42, -42, 84, 84); ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.strokeRect(-42, -42, 84, 84); ctx.restore(); ctx.fillStyle = '#111'; ctx.font = 'bold 54px Arial, sans-serif'; ctx.fillText(txt, x + 128 + px * 61, y + 130 + py * 61); };
      quad(0, -1, '#d8532a', '4'); quad(-1, 0, '#2f6fb3', '1'); quad(1, 0, '#f2c21a', '0'); quad(0, 1, '#f4f4f0', '');
    }
    sign(1, 'WARNING', '#e2761b', ['HIGH VOLTAGE', '13.8 kV']);
    { const [x, y] = diamond(2, '#d8532a'); ctx.fillStyle = '#fff'; ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText('FLAMMABLE', x + 128, y + 118); ctx.fillText('GAS', x + 128, y + 152); ctx.font = 'bold 40px Arial, sans-serif'; ctx.fillText('2', x + 128, y + 205);
      ctx.beginPath(); ctx.moveTo(x + 128, y + 36); ctx.quadraticCurveTo(x + 156, y + 70, x + 128, y + 92); ctx.quadraticCurveTo(x + 100, y + 70, x + 128, y + 36); ctx.fill(); }
    sign(3, 'CAUTION', '#f2c21a', ['HEARING', 'PROTECTION', 'REQUIRED']);
    sign(4, 'WARNING', '#e2761b', ['THIS EQUIPMENT', 'STARTS', 'AUTOMATICALLY']);
    sign(5, 'NOTICE', '#2f6fb3', ['NO SMOKING', 'NO OPEN FLAME']);
    { const [x, y] = cell(6); ctx.beginPath(); ctx.moveTo(x + 128, y + 20); ctx.lineTo(x + 244, y + 226); ctx.lineTo(x + 12, y + 226); ctx.closePath(); ctx.fillStyle = '#f2c21a'; ctx.fill(); ctx.lineWidth = 12; ctx.lineJoin = 'round'; ctx.strokeStyle = '#111'; ctx.stroke();
      ctx.fillStyle = '#111'; ctx.beginPath(); ctx.moveTo(x + 140, y + 80); ctx.lineTo(x + 100, y + 150); ctx.lineTo(x + 126, y + 150); ctx.lineTo(x + 112, y + 205); ctx.lineTo(x + 160, y + 128); ctx.lineTo(x + 133, y + 128); ctx.lineTo(x + 152, y + 80); ctx.closePath(); ctx.fill(); }
    { const [x, y] = cell(7); ctx.fillStyle = '#f2c21a'; ctx.fillRect(x + 4, y + 88, 248, 80); ctx.fillStyle = '#111'; ctx.font = 'bold 34px Arial, sans-serif'; ctx.fillText('NATURAL GAS', x + 128, y + 130); }
    C.placards = c;
  }
  { // braided stainless hose
    const S = 64, c = canvas(S, S), ctx = c.getContext('2d');
    ctx.fillStyle = '#8d9194'; ctx.fillRect(0, 0, S, S); ctx.lineWidth = 3;
    for (let i = -S; i < S * 2; i += 8) { ctx.strokeStyle = '#d9dcde'; ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + S, S); ctx.stroke(); ctx.strokeStyle = '#55595c'; ctx.beginPath(); ctx.moveTo(i + 4, 0); ctx.lineTo(i + 4 - S, S); ctx.stroke(); }
    C.braid = c;
  }
  { // aluminium jacketing: stucco emboss and lap seams
    const S = 256, f = fbm(S, 64, 2, 61);
    C.bands = fieldCanvas(S, (x, y) => { let v = 150 + 70 * f[y * S + x]; if (y % 128 < 4) v = 40; if (x < 3) v = 60; return g3(v); });
  }
  { // oily grime for engine paint: mottling plus darker runs
    const S = 256, f = fbm(S, 4, 5, 91), f2 = fbm(S, 32, 2, 92);
    C.grime = fieldCanvas(S, (x, y) => { const m = f[y * S + x], v = 255 * Math.min(1, 0.8 + 0.22 * m + 0.07 * (f2[y * S + x] - 0.5)); return [v, v * 0.985, v * 0.96]; });
  }
  T.grime = tex(C.grime, true, 2.1, 2.1);
  { const S = 256, f = fbm(S, 4, 5, 97); C.grimeLo = fieldCanvas(S, (x, y) => { const v = 255 * Math.min(1, 0.9 + 0.12 * f[y * S + x]); return [v, v * 0.995, v * 0.98]; }); }
  T.grimeLo = tex(C.grimeLo, true, 0.37, 0.37);
  T.rough = tex(C.rough, false, 1, 1);
  T.roughFine = tex(C.rough, false, 4, 4);
  T.cast = tex(C.cast, false, 3, 3);
  T.castM = tex(C.cast, false, 6, 6);
  T.wall = tex(C.wall, true); T.wall.wrapT = THREE.ClampToEdgeWrapping;
  T.galv = tex(C.galv, true, 3, 3);
  T.quiltB = tex(C.quiltB, false, 3, 6); T.quiltC = tex(C.quiltC, true, 3, 6);
  T.plateB = tex(C.plateB, false, 5, 5); T.plateC = tex(C.plateC, true, 5, 5);
  T.perf = tex(C.perf, true, 12, 12); T.perfCyl = tex(C.perf, true, 40, 4);
  T.fins = tex(C.fins, true, 10, 3);
  T.pleat = tex(C.pleat, true, 9, 1);
  T.guard = tex(C.guard, true); T.guard.wrapS = T.guard.wrapT = THREE.ClampToEdgeWrapping;
  T.tread = tex(C.tread, false, 40, 1);
  T.hmi = tex(C.hmi, true); T.hmi.wrapS = T.hmi.wrapT = THREE.ClampToEdgeWrapping;
  T.placards = tex(C.placards, true); T.placards.wrapS = T.placards.wrapT = THREE.ClampToEdgeWrapping;
  T.braidC = tex(C.braid, true, 4, 14); T.braidB = tex(C.braid, false, 4, 14);
  T.bands = tex(C.bands, false, 2, 2);
  return (_T = T);
}

// ---------------------------------------------------------------- materials

let _MAT = null;
function materials() {
  if (_MAT) return _MAT;
  const T = textures();
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const paint = (color, extra = {}) => S({ color, roughness: 0.55, metalness: 0.0, roughnessMap: T.roughFine, ...extra });
  const lamp = (color, i = 1.6) => S({ color: 0x111111, emissive: color, emissiveIntensity: i, roughness: 0.35 });
  const M = {
    paintWall: S({ color: 0xd9dcdc, map: T.wall, roughness: 0.52, roughnessMap: T.rough, metalness: 0.0 }),
    paint: paint(0xd6d9d9),
    paintGrey: paint(0xa3a9ad),
    pipe: paint(0x4f575d, { roughness: 0.5 }),
    frame: paint(0x2f3337, { roughness: 0.62 }),
    chassis: paint(0x17191b, { roughness: 0.6 }),
    yellow: paint(0xd9a514, { roughness: 0.5 }),
    galv: S({ color: 0xc2c7ca, map: T.galv, roughness: 0.48, metalness: 0.85 }),
    steel: S({ color: 0xc9cdd1, roughness: 0.27, metalness: 1.0, roughnessMap: T.roughFine }),
    bolt: S({ color: 0x8b9094, roughness: 0.4, metalness: 0.95 }),
    black: S({ color: 0x141516, roughness: 0.55, metalness: 0.0 }),
    rubber: S({ color: 0x0d0d0e, roughness: 0.92, metalness: 0.0 }),
    engY: S({ color: 0xbb8a12, map: T.grime, roughness: 0.46, metalness: 0.05, roughnessMap: T.roughFine, bumpMap: T.cast, bumpScale: 0.6 }),
    engG: S({ color: 0x566c7c, map: T.grime, roughness: 0.46, metalness: 0.05, roughnessMap: T.roughFine, bumpMap: T.cast, bumpScale: 0.6 }),
    alu: S({ color: 0xb4b8bc, roughness: 0.5, metalness: 0.9, bumpMap: T.castM, bumpScale: 0.5 }),
    castRaw: S({ color: 0x4c4542, roughness: 0.78, metalness: 0.65, bumpMap: T.castM, bumpScale: 0.9 }),
    blanket: S({ color: 0x9c9e9b, map: T.quiltC, bumpMap: T.quiltB, bumpScale: 0.7, roughness: 0.82, metalness: 0.25 }),
    clad: S({ color: 0xcdd1d4, roughness: 0.36, metalness: 0.95, bumpMap: T.bands, bumpScale: 0.5, roughnessMap: T.rough }),
    stainless: S({ color: 0xd6d9db, roughness: 0.3, metalness: 1.0, roughnessMap: T.rough }),
    braid: S({ color: 0xffffff, map: T.braidC, bumpMap: T.braidB, bumpScale: 1.0, roughness: 0.4, metalness: 0.9 }),
    silicone: S({ color: 0x14285c, roughness: 0.55, metalness: 0.0 }),
    copper: S({ color: 0xc27a48, roughness: 0.35, metalness: 1.0 }),
    brass: S({ color: 0xb9973c, roughness: 0.35, metalness: 1.0 }),
    filterWhite: paint(0xe6e1d2, { roughness: 0.4 }),
    floor: S({ color: 0xa3a8ac, map: T.plateC, bumpMap: T.plateB, bumpScale: 1.6, roughness: 0.5, metalness: 0.75 }),
    lining: S({ color: 0xc9cccd, map: T.perf, roughness: 0.6, metalness: 0.5, side: THREE.DoubleSide }),
    perfDark: S({ color: 0x8a8f93, map: T.perfCyl, roughness: 0.5, metalness: 0.6 }),
    perfYellow: S({ color: 0xe0ac18, map: T.perfCyl, roughness: 0.5, metalness: 0.1 }),
    fins: S({ color: 0xaab0b4, map: T.fins, roughness: 0.5, metalness: 0.7 }),
    pleat: S({ color: 0xffffff, map: T.pleat, roughness: 0.9, metalness: 0.0 }),
    guard: S({ color: 0xffffff, map: T.guard, alphaTest: 0.3, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide }),
    louverDark: S({ color: 0x0c0d0e, roughness: 0.95, metalness: 0.0 }),
    glass: S({ color: 0x0b1116, roughness: 0.06, metalness: 0.0 }),
    hmi: S({ color: 0x05080a, emissive: 0xffffff, emissiveMap: T.hmi, emissiveIntensity: 1.1, roughness: 0.2 }),
    led: S({ color: 0x222222, emissive: 0xfff1d6, emissiveIntensity: 2.2, roughness: 0.4 }),
    lampG: lamp(0x3ddc84), lampA: lamp(0xf5a623, 0.5), lampW: lamp(0xe8f0ff, 1.0),
    lensAmber: S({ color: 0x6b3c08, emissive: 0xf5a623, emissiveIntensity: 0.35, roughness: 0.25 }),
    lensRed: S({ color: 0x7c1d16, roughness: 0.2, metalness: 0.0 }),
    decal: S({ color: 0xffffff, map: T.placards, alphaTest: 0.5, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    tire: S({ color: 0x111112, roughness: 0.9, bumpMap: T.tread, bumpScale: 2.5 }),
    rim: paint(0xd5d7d8, { roughness: 0.4, metalness: 0.3 }),
    cable: S({ color: 0x1a1a1c, roughness: 0.7 }),
    cableGY: S({ color: 0x76a83a, roughness: 0.6 }),
    gaugeFace: S({ color: 0xf1f1ec, roughness: 0.4 }),
    urea: paint(0x2a6db3),
    estop: paint(0xb5301e, { roughness: 0.4 }),
    fan: S({ color: 0x2a2d30, roughness: 0.45, metalness: 0.3, side: THREE.DoubleSide }),
    vcPaint: S({ color: 0xffffff, map: T.grimeLo, vertexColors: true, roughness: 0.56, metalness: 0.0, roughnessMap: T.roughFine }),
    vcMetal: S({ color: 0xffffff, vertexColors: true, roughness: 0.34, metalness: 1.0, roughnessMap: T.roughFine }),
    glow: new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true }),
    beacon: S({ color: 0x1a1d20, emissive: 0xa9b8c8, emissiveIntensity: 0.3, roughness: 0.25 }),
  };
  for (const k of Object.keys(M)) M[k].name = k;
  M.guard.userData.alphaTest = 0.3; M.decal.userData.alphaTest = 0.5;
  M.glow.userData.noShadow = M.guard.userData.noShadow = true;
  return (_MAT = M);
}


// ---------------------------------------------------------------- interior paint finish shader

// Tileable noise for object-space finish detail: R large, G medium, B fine.
let _wearTex = null;
function wearTexture() {
  if (_wearTex) return _wearTex;
  const S = 256, d = new Uint8Array(S * S * 4);
  const put = (f, ch) => {
    let lo = 1e9, hi = -1e9; for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    for (let i = 0; i < f.length; i++) d[i * 4 + ch] = 255 * (f[i] - lo) / (hi - lo);
  };
  put(fbm(S, 4, 4, 201), 0); put(fbm(S, 16, 4, 202), 1); put(fbm(S, 64, 2, 203), 2);
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return (_wearTex = t);
}

const WEAR_FRAG_PARS = `
uniform sampler2D uWN; uniform vec4 uWF;
varying vec3 vWP; varying vec3 vWNr;
float wHt, wVar;
vec4 wTri(vec3 p, vec3 b) { return texture2D(uWN, p.zy) * b.x + texture2D(uWN, p.xz) * b.y + texture2D(uWN, p.xy) * b.z; }
vec3 wPerturb(vec3 sp, vec3 sn, vec2 dH, float fd) {
  vec3 sx = normalize(dFdx(sp)), sy = normalize(dFdy(sp));
  vec3 r1 = cross(sy, sn), r2 = cross(sn, sx);
  float det = dot(sx, r1) * fd;
  vec3 g = sign(det) * (dH.x * r1 + dH.y * r2);
  return normalize(abs(det) * sn - g);
}
`;
const WEAR_FRAG_COLOR = `
{
  vec3 wn = normalize(vWNr);
  vec3 wb = wn * wn; wb *= wb; wb /= (wb.x + wb.y + wb.z);
  vec3 wp = vWP * uWF.w;
  vec4 nL = wTri(wp * 0.83, wb);
  vec4 nF = wTri(wp * 5.3 + 0.37, wb);
  wHt = nF.b * 0.6 + nF.g * 0.4;
  wVar = nF.r * 0.5 + nL.g * 0.5 - 0.5;
  diffuseColor.rgb *= 1.0 + uWF.y * (nL.g - 0.5);
}
`;
const WEAR_FRAG_PBR = `
roughnessFactor = clamp(roughnessFactor + wVar * uWF.z, 0.08, 1.0);
`;
const WEAR_FRAG_NORMAL = `
{
  float wh = wHt * uWF.x;
  normal = wPerturb(-vViewPosition, normal, vec2(dFdx(wh), dFdy(wh)), faceDirection);
}
`;

// Object-space finish for a standard material: orange peel or cast texture and slight gloss variation. No dirt.
function weather(mat, w) {
  const o = { peel: 0.0002, mottle: 0.03, rvar: 0.12, scale: 1, ...w };
  const U = { uWN: { value: wearTexture() }, uWF: { value: new THREE.Vector4(o.peel, o.mottle, o.rvar, o.scale) } };
  mat.userData.wear = w;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWNr;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vWNr = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + WEAR_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + WEAR_FRAG_COLOR)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + WEAR_FRAG_PBR)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + WEAR_FRAG_NORMAL);
  };
  mat.customProgramCacheKey = () => 'finish1';
  return mat;
}

let _MI = null;
function interiorMaterials() {
  if (_MI) return _MI;
  const T = textures();
  const S = (o) => new THREE.MeshStandardMaterial(o);
  // Clean, recently commissioned finishes. Anything not listed here falls back to the shared exterior material.
  const enamel = { peel: 0.00022, mottle: 0.035, rvar: 0.14 };
  const I = {
    // fresh semi-gloss enamel
    engY: weather(S({ color: 0xb8880c, roughness: 0.36, metalness: 0.0 }), enamel),
    engG: weather(S({ color: 0x4f6878, roughness: 0.36, metalness: 0.0 }), enamel),
    vcPaint: weather(S({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.0 }), { peel: 0.00014, mottle: 0.02, rvar: 0.1 }),
    rubber: S({ color: 0x101011, roughness: 0.88, metalness: 0.0 }),
    cable: S({ color: 0x18181a, roughness: 0.7, metalness: 0.0 }),
    silicone: S({ color: 0x15285c, roughness: 0.58, metalness: 0.0 }),
    // bright zinc plated hardware
    bolt: S({ color: 0xb9bdbb, roughness: 0.34, metalness: 0.95 }),
    // machined steel
    steel: S({ color: 0xc4c8cb, roughness: 0.22, metalness: 1.0 }),
    stainless: S({ color: 0xcfd1d2, roughness: 0.3, metalness: 1.0 }),
    // sand cast aluminium
    alu: weather(S({ color: 0xa4a7a8, roughness: 0.56, metalness: 0.8 }), { peel: 0.0005, mottle: 0.05, rvar: 0.18 }),
    // clean grey cast iron
    castRaw: weather(S({ color: 0x4b4d50, roughness: 0.74, metalness: 0.6 }), { peel: 0.0009, mottle: 0.08, rvar: 0.15 }),
    copper: S({ color: 0xc27a48, roughness: 0.34, metalness: 1.0 }),
    brass: S({ color: 0xb9973c, roughness: 0.34, metalness: 1.0 }),
    perfDark: S({ color: 0x34373a, map: T.perfCyl, roughness: 0.6, metalness: 0.3 }),
  };
  const flat = (c, o) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return S({ map: t, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o }); };
  I.label = flat(labelAtlas(), { alphaTest: 0.5, roughness: 0.5 });
  for (const k of Object.keys(I)) I[k].name = k;
  return (_MI = I);
}


// generic labels and data plates, 4 x 4 atlas of 256 x 128 cells
function labelAtlas() {
  const c = canvas(1024, 512), ctx = c.getContext('2d'), R = rng(311);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const cell = (i) => [(i % 4) * 256, Math.floor(i / 4) * 128];
  const plate = (i, title, rows) => {
    const [x, y] = cell(i);
    ctx.fillStyle = '#b4b7b8'; ctx.fillRect(x + 3, y + 3, 250, 122);
    ctx.strokeStyle = '#1e1e1e'; ctx.lineWidth = 2; ctx.strokeRect(x + 9, y + 9, 238, 110);
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(x + 9, y + 9, 238, 22);
    ctx.fillStyle = '#d6d8d8'; ctx.font = 'bold 15px Arial, sans-serif'; ctx.fillText(title, x + 128, y + 21);
    ctx.fillStyle = '#1e1e1e'; ctx.textAlign = 'left'; ctx.lineWidth = 1;
    rows.forEach((r, k) => {
      const cx = x + 15 + (k % 2) * 118, cy = y + 43 + Math.floor(k / 2) * 17;
      ctx.font = '9px Arial, sans-serif'; ctx.fillText(r[0], cx, cy); ctx.strokeRect(cx + 40, cy - 7, 70, 14);
      ctx.font = 'bold 11px Arial, sans-serif'; ctx.fillText(r[1], cx + 44, cy + 1);
    });
    ctx.textAlign = 'center';
    for (const [dx, dy] of [[7, 7], [249, 7], [7, 121], [249, 121]]) { ctx.fillStyle = '#6d7072'; ctx.beginPath(); ctx.arc(x + dx, y + dy, 3, 0, TAU); ctx.fill(); }
  };
  const sign = (i, hc, head, lines, hfg = '#fff') => {
    const [x, y] = cell(i);
    ctx.fillStyle = '#eeeee8'; ctx.fillRect(x + 3, y + 3, 250, 122); ctx.strokeStyle = '#151515'; ctx.lineWidth = 3; ctx.strokeRect(x + 5, y + 5, 246, 118);
    ctx.fillStyle = hc; ctx.fillRect(x + 8, y + 8, 240, 42);
    ctx.fillStyle = hfg; ctx.font = 'bold 32px Arial, sans-serif'; ctx.fillText(head, x + 128, y + 31);
    ctx.fillStyle = '#151515'; ctx.font = `bold ${lines.length > 1 ? 21 : 26}px Arial, sans-serif`;
    lines.forEach((l, k) => ctx.fillText(l, x + 128, y + (lines.length > 1 ? 72 : 86) + k * 28, 232));
  };
  const band = (i, bg, fg, txt, arrow) => {
    const [x, y] = cell(i);
    ctx.fillStyle = bg; ctx.fillRect(x + 2, y + 14, 252, 100);
    ctx.fillStyle = fg; ctx.font = 'bold 30px Arial, sans-serif'; ctx.fillText(txt, x + (arrow ? 112 : 128), y + 66, arrow ? 190 : 236);
    if (arrow) { ctx.beginPath(); ctx.moveTo(x + 246, y + 64); ctx.lineTo(x + 214, y + 40); ctx.lineTo(x + 214, y + 88); ctx.closePath(); ctx.fill(); }
  };
  plate(0, 'GENERATOR SET', [['MODEL', 'PWR2.6'], ['SERIAL', 'SIM-04417'], ['kW', '2600'], ['kVA', '3250'], ['VOLTS', '13800'], ['Hz', '60'], ['RPM', '1800'], ['PF', '0.80'], ['INS CL', 'H'], ['MASS kg', '9850']]);
  plate(1, 'GENERATOR SET', [['MODEL', 'PWR2.0'], ['SERIAL', 'SIM-03162'], ['kW', '2000'], ['kVA', '2500'], ['VOLTS', '13800'], ['Hz', '60'], ['RPM', '1200'], ['PF', '0.80'], ['INS CL', 'H'], ['MASS kg', '9100']]);
  plate(2, 'GAS ENGINE', [['TYPE', 'V20 LEAN'], ['SERIAL', 'SIM-20877'], ['BORE mm', '170'], ['STROKE', '215'], ['RPM', '1800'], ['kWb', '2710'], ['FUEL', 'NAT GAS'], ['CR', '11.3'], ['ORDER', '1-2-11-12'], ['YEAR', '2023']]);
  plate(3, 'GAS ENGINE', [['TYPE', 'V16 RICH'], ['SERIAL', 'SIM-16340'], ['BORE mm', '238'], ['STROKE', '216'], ['RPM', '1200'], ['kWb', '2085'], ['FUEL', 'NAT GAS'], ['CR', '8.0'], ['ORDER', '1R-1L-4R'], ['YEAR', '2022']]);
  sign(4, '#f2c21a', 'CAUTION', ['HOT SURFACE', 'DO NOT TOUCH'], '#111');
  sign(5, '#e2761b', 'WARNING', ['ROTATING PARTS', 'KEEP GUARDS IN PLACE']);
  sign(6, '#d8532a', 'DANGER', ['HIGH VOLTAGE', '13.8 kV']);
  sign(7, '#2f6fb3', 'NOTICE', ['OIL FILL', 'GAS ENGINE OIL SAE 40']);
  { // filter canister wrap
    const [x, y] = cell(8);
    ctx.fillStyle = '#e9e6da'; ctx.fillRect(x, y, 256, 128); ctx.fillStyle = '#1f4f86'; ctx.fillRect(x, y + 8, 256, 34);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillText('OIL FILTER', x + 128, y + 26);
    ctx.fillStyle = '#1b1b1b'; ctx.font = 'bold 14px Arial, sans-serif'; ctx.fillText('FULL FLOW  10 MICRON', x + 128, y + 60);
    ctx.font = '11px Arial, sans-serif'; ctx.fillText('REPLACE EVERY 1000 H OR ON DP ALARM', x + 128, y + 80); ctx.fillText('OIL GASKET, HAND TIGHTEN 3/4 TURN', x + 128, y + 96);
    ctx.fillRect(x + 20, y + 108, 216, 3);
  }
  band(9, '#e8b417', '#111', 'NATURAL GAS', true);
  band(10, '#1f7a45', '#fff', 'COOLANT SUPPLY', true);
  { // service tag with marker pen entries
    const [x, y] = cell(11);
    ctx.fillStyle = '#f0efe6'; ctx.fillRect(x + 30, y + 4, 196, 120); ctx.fillStyle = '#2f6fb3'; ctx.fillRect(x + 30, y + 4, 196, 24);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Arial, sans-serif'; ctx.fillText('SERVICE RECORD', x + 128, y + 17);
    ctx.fillStyle = '#333'; ctx.font = '10px Arial, sans-serif'; ctx.textAlign = 'left';
    ['DATE', 'HOURS', 'OIL', 'BY'].forEach((t, k) => { ctx.fillText(t, x + 38, y + 44 + k * 21); ctx.fillRect(x + 78, y + 50 + k * 21, 140, 1); });
    ctx.fillStyle = '#1a2a6a'; ctx.font = 'italic bold 15px "Comic Sans MS", "Segoe Print", cursive, sans-serif';
    ['08/14', '250', 'FIRST SVC', 'R.T.'].forEach((t, k) => ctx.fillText(t, x + 88, y + 42 + k * 21));
    ctx.textAlign = 'center';
  }
  { // asset tag with barcode
    const [x, y] = cell(12);
    ctx.fillStyle = '#c9cccd'; ctx.fillRect(x + 8, y + 16, 240, 96); ctx.fillStyle = '#111';
    let bx = x + 24; while (bx < x + 232) { const w = 1 + Math.floor(R() * 4); ctx.fillRect(bx, y + 26, w, 44); bx += w + 1 + Math.floor(R() * 3); }
    ctx.font = 'bold 20px Arial, sans-serif'; ctx.fillText('ASSET SIM-00231', x + 128, y + 92);
  }
  { const [x, y] = cell(13); ctx.fillStyle = '#151515'; ctx.fillRect(x + 2, y + 14, 252, 100); ctx.fillStyle = '#e8b417'; ctx.font = 'bold 34px Arial, sans-serif'; ctx.fillText('LIFT POINT', x + 112, y + 66);
    ctx.beginPath(); ctx.moveTo(x + 226, y + 30); ctx.lineTo(x + 246, y + 60); ctx.lineTo(x + 233, y + 60); ctx.lineTo(x + 233, y + 100); ctx.lineTo(x + 219, y + 100); ctx.lineTo(x + 219, y + 60); ctx.lineTo(x + 206, y + 60); ctx.closePath(); ctx.fill(); }
  sign(14, '#2f6fb3', 'NOTICE', ['COOLANT', '50/50 GLYCOL ONLY']);
  { const [x, y] = cell(15); ctx.fillStyle = '#eeeee8'; ctx.fillRect(x + 20, y + 20, 216, 88); ctx.fillStyle = '#151515'; ctx.font = 'bold 26px Arial, sans-serif'; ctx.fillText('ROTATION', x + 104, y + 66);
    ctx.lineWidth = 7; ctx.strokeStyle = '#151515'; ctx.beginPath(); ctx.arc(x + 196, y + 64, 24, PI * 0.6, PI * 2.1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x + 226, y + 82); ctx.lineTo(x + 206, y + 70); ctx.lineTo(x + 228, y + 58); ctx.closePath(); ctx.fill(); }
  return c;
}

function atlasQuad(k, mat, cols, rows, cell, w, h, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, c = cell % cols, r = Math.floor(cell / cols);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (c + uv.getX(i)) / cols, 1 - (r + 1 - uv.getY(i)) / rows);
  k.geoR(mat, g, x, y, z, rx, ry, rz);
}
// label wrapped on a pipe or canister; along = text runs along the axis instead of around it
function atlasArc(k, mat, cols, rows, cell, r, len, x, y, z, axis, thc, thl, along) {
  const g = new THREE.CylinderGeometry(r, r, len, 8, 1, true, thc - thl / 2, thl), uv = g.attributes.uv, c = cell % cols, rr = Math.floor(cell / cols);
  for (let i = 0; i < uv.count; i++) {
    const u0 = uv.getX(i), v0 = uv.getY(i), u = along ? v0 : u0, v = along ? 1 - u0 : v0;
    uv.setXY(i, (c + u) / cols, 1 - (rr + 1 - v) / rows);
  }
  k.geo(mat, g, x, y, z, axis);
}
const lab = (k, cell, w, h, x, y, z, ry = 0) => atlasQuad(k, 'label', 4, 4, cell, w, h, x, y, z, 0, ry);

// ---------------------------------------------------------------- shared part builders

function rotorGeom(R, blades) {
  const k = new Kit();
  k.cyl('a', R * 0.2, R * 0.16, 0, 0, 0, 'y', 16);
  k.cyl('a', R * 0.09, R * 0.1, 0, R * 0.12, 0, 'y', 10);
  const st = 5, pos = [], uv = [], idx = [];
  for (let i = 0; i <= st; i++) {
    const t = i / st, r = R * (0.18 + 0.8 * t), c = R * (0.4 - 0.12 * t) * (i === st ? 0.8 : 1), p = (40 - 24 * t) * PI / 180, sw = t * t * R * 0.12;
    pos.push(r, Math.sin(p) * c / 2, Math.cos(p) * c / 2 - sw, r, -Math.sin(p) * c / 2, -Math.cos(p) * c / 2 - sw);
    uv.push(t, 0, t, 1);
    if (i < st) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  for (let b = 0; b < blades; b++) k.geoR('a', g, 0, 0, 0, 0, b / blades * TAU, 0);
  return k.build().get('a');
}

function opening(k, op) {
  const [x0, x1] = op.x, [y0, y1] = op.y, w = x1 - x0, h = y1 - y0, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  // trim frame
  k.box('paint', w + 0.12, 0.06, 0.07, cx, y1 + 0.03, -0.012, 0.008);
  k.box('paint', w + 0.12, 0.06, 0.07, cx, y0 - 0.03, -0.012, 0.008);
  k.box('paint', 0.06, h, 0.07, x0 - 0.03, cy, -0.012, 0.008);
  k.box('paint', 0.06, h, 0.07, x1 + 0.03, cy, -0.012, 0.008);
  if (op.t === 'door' || op.t === 'ctrl') {
    k.box('rubber', w, h, 0.03, cx, cy, -0.02, 0.002);
    k.box('paint', w - 0.024, h - 0.024, 0.05, cx, cy, 0.0, 0.012);
    if (op.t === 'door') {
      k.box('paint', w - 0.24, h * 0.36, 0.012, cx, cy + h * 0.235, 0.027, 0.006);
      k.box('paint', w - 0.24, h * 0.36, 0.012, cx, cy - h * 0.235, 0.027, 0.006);
    } else {
      // HMI window, pilot lights
      k.box('black', 0.46, 0.33, 0.016, cx, cy + 0.42, 0.028, 0.006);
      k.quad('hmi', 0.4, 0.25, cx, cy + 0.42, 0.0375);
      k.box('paintGrey', 0.5, 0.1, 0.014, cx, cy + 0.14, 0.027, 0.004);
      ['lampG', 'lampW', 'lampA', 'lampW'].forEach((m, i) => {
        k.cyl('bolt', 0.021, 0.012, cx - 0.165 + i * 0.11, cy + 0.14, 0.036, 'z', 12);
        k.cyl(m, 0.015, 0.014, cx - 0.165 + i * 0.11, cy + 0.14, 0.041, 'z', 10);
      });
      k.box('paint', w - 0.24, h * 0.34, 0.012, cx, cy - h * 0.26, 0.027, 0.006);
      // vent grille low
      for (let i = 0; i < 6; i++) k.box('galv', w - 0.4, 0.012, 0.02, cx, y0 + 0.18 + i * 0.035, 0.036, 0.002);
    }
    // hinges on the x0 side
    for (const f of [0.12, 0.5, 0.88]) {
      const y = y0 + h * f;
      k.cyl('bolt', 0.016, 0.14, x0 - 0.002, y, 0.034, 'y', 8);
      k.box('bolt', 0.07, 0.11, 0.006, x0 + 0.04, y, 0.028, 0.002);
      k.box('bolt', 0.05, 0.11, 0.006, x0 - 0.032, y, 0.026, 0.002);
    }
    // lock rod, keepers, handle
    const xr = x1 - 0.13;
    k.cyl('galv', 0.012, h + 0.07, xr, cy, 0.045, 'y', 8);
    for (const y of [y0 - 0.02, y1 + 0.02]) k.box('galv', 0.07, 0.05, 0.04, xr, y, 0.04, 0.004);
    for (const f of [0.2, 0.42, 0.62, 0.8]) k.box('galv', 0.05, 0.03, 0.03, xr, y0 + h * f, 0.04, 0.003);
    k.box('galv', 0.26, 0.032, 0.012, xr - 0.1, y0 + h * 0.5, 0.062, 0.004);
    k.box('galv', 0.05, 0.07, 0.02, xr - 0.2, y0 + h * 0.5, 0.05, 0.004);
    k.cyl('bolt', 0.02, 0.03, xr, y0 + h * 0.5, 0.055, 'z', 8);
    k.box('alu', 0.16, 0.1, 0.004, cx - 0.1, y0 + h * 0.56, 0.034, 0.001);
  } else if (op.t === 'louver') {
    k.quad('louverDark', w, h, cx, cy, -0.1);
    const nb = Math.floor(h / 0.075);
    const g = new THREE.BoxGeometry(w, 0.005, 0.11);
    for (let i = 0; i < nb; i++) k.geoR('paintGrey', g, cx, y0 + (i + 0.5) * h / nb, -0.045, 0.72, 0, 0);
    if (w > 1.3) k.box('paint', 0.05, h, 0.06, cx, cy, -0.008, 0.006);
    k.box('galv', w, 0.02, 0.1, cx, y0 + 0.01, -0.045, 0.003);
  } else if (op.t === 'panel') {
    k.box('paint', w, h, 0.03, cx, cy, -0.004, 0.008);
    k.box('paint', w - 0.2, h - 0.2, 0.01, cx, cy, 0.014, 0.006);
    const nx = Math.round(w / 0.45), ny = Math.round(h / 0.45);
    for (let i = 0; i <= nx; i++) for (const y of [y0 + 0.05, y1 - 0.05]) k.bolt(x0 + 0.05 + (w - 0.1) * i / nx, y, 0.014, 'z', 0.011);
    for (let j = 1; j < ny; j++) for (const x of [x0 + 0.05, x1 - 0.05]) k.bolt(x, y0 + 0.05 + (h - 0.1) * j / ny, 0.014, 'z', 0.011);
    for (const x of [x0 + 0.22, x1 - 0.22]) {
      k.tube('galv', [[x, cy - 0.5, 0.02], [x, cy - 0.5, 0.07], [x, cy - 0.3, 0.07], [x, cy - 0.3, 0.02]], 0.009, { bend: 0.02 });
    }
  }
}

function wall(k, sp, xs, xe, ops) {
  const y0 = sp.hs + 0.05, y1 = sp.H - 0.24;
  let cur = xs;
  const seg = (a, b, ya, yb) => {
    if (b - a < 0.02 || yb - ya < 0.02) return;
    k.geo('paintWall', corrGeom(a, b, ya, yb));
    k.quad('lining', b - a, yb - ya, (a + b) / 2, (ya + yb) / 2, -0.1, PI);
  };
  for (const op of ops) {
    seg(cur, op.x[0], y0, y1); seg(op.x[0], op.x[1], y0, op.y[0]); seg(op.x[0], op.x[1], op.y[1], y1);
    cur = op.x[1]; opening(k, op);
  }
  seg(cur, xe, y0, y1);
}

function placard(k, cellIdx, w, h, x, y, z, ry) {
  const g = new THREE.PlaneGeometry(w, h), uv = g.attributes.uv, col = cellIdx % 4, row = Math.floor(cellIdx / 4);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (col + uv.getX(i)) / 4, 1 - (row + 1 - uv.getY(i)) / 2);
  k.geoR('decal', g, x, y, z, 0, ry, 0);
}

function handrail(k, a, b, y, toe = true) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), n = Math.max(1, Math.round(len / 1.5));
  for (let i = 0; i <= n; i++) {
    const x = a[0] + dx * i / n, z = a[1] + dz * i / n;
    k.cyl('yellow', 0.021, 1.08, x, y + 0.54, z, 'y', 6, 0.021, true);
    k.box('yellow', 0.09, 0.012, 0.09, x, y + 0.006, z, 0.002);
  }
  k.tube('yellow', [[a[0], y + 1.08, a[1]], [b[0], y + 1.08, b[1]]], 0.021, { radial: 8, caps: true });
  k.tube('yellow', [[a[0], y + 0.56, a[1]], [b[0], y + 0.56, b[1]]], 0.017, { radial: 6 });
  if (toe) {
    k.push((a[0] + b[0]) / 2, y + 0.06, (a[1] + b[1]) / 2, 0, Math.atan2(-dz, dx), 0);
    k.box('yellow', len, 0.1, 0.006, 0, 0, 0, 0.002); k.pop();
  }
}

// ---------------------------------------------------------------- exterior

function buildExterior(sp) {
  const o = layout(sp), { L, xa, xb, hw, H, hs } = o;
  const enc = new Kit(), base = new Kit(), rad = new Kit(), exh = new Kit(), gas = new Kit(), trl = new Kit();
  const A = { fans: [], yB: sp.mobile ? DECK : 0 };

  // ---- skid / subframe
  for (const s of [1, -1]) {
    base.box('frame', L, hs, 0.16, 0, hs / 2, s * (hw - 0.08), 0.012);
    base.box('frame', L - 0.3, 0.025, 0.2, 0, 0.0125, s * (hw - 0.14), 0.004);
    if (!sp.mobile) {
      for (const px of [-1.03, 1.03]) {
        base.box('frame', 0.5, 0.2, 0.02, px, 0.15, s * (hw + 0.004), 0.004);
        base.box('louverDark', 0.38, 0.115, 0.022, px, 0.145, s * (hw + 0.006), 0.003);
      }
      // lifting lugs and tie-down rings
      for (const px of [xa + 1.4, xb - 1.4]) {
        base.box('frame', 0.2, 0.22, 0.03, px, 0.17, s * (hw + 0.013), 0.006);
        base.cyl('frame', 0.075, 0.035, px, 0.2, s * (hw + 0.045), 'z', 14);
        base.cyl('louverDark', 0.036, 0.037, px, 0.2, s * (hw + 0.046), 'z', 12);
      }
      for (const px of [xa + 3.2, -2.2, 2.2, xb - 3.2]) {
        base.box('bolt', 0.09, 0.05, 0.012, px, 0.24, s * (hw + 0.006), 0.002);
        base.torus('bolt', 0.04, 0.009, px, 0.2, s * (hw + 0.016), 'z', 12, 6);
      }
    } else {
      for (const px of [xa + 0.5, xa + 3.5, 0, xb - 3.5, xb - 0.5]) {
        base.box('bolt', 0.16, 0.1, 0.03, px, 0.05, s * (hw + 0.01), 0.004);
        base.cyl('bolt', 0.03, 0.05, px, 0.05, s * (hw + 0.03), 'z', 8);
      }
    }
  }
  for (const x of [xa + 0.08, xb - 0.08]) base.box('frame', 0.16, hs, 2 * hw - 0.3, x, hs / 2, 0, 0.012);
  for (let x = xa + 1.2; x < xb - 0.6; x += 1.2) base.pbox('frame', 0.1, hs - 0.06, 2 * hw - 0.3, x, hs / 2, 0);
  base.box('floor', L - 0.2, 0.012, 2 * hw - 0.2, 0, hs + 0.006, 0, 0.002);
  // grounding pads
  for (const [x, z] of [[xa + 0.3, hw], [xb - 0.3, -hw]]) {
    const s = Math.sign(z);
    base.box('copper', 0.12, 0.06, 0.012, x, hs * 0.5, z + s * 0.008, 0.002);
    base.bolt(x - 0.03, hs * 0.5, z + s * 0.018, 'z', 0.01); base.bolt(x + 0.03, hs * 0.5, z + s * 0.018, 'z', 0.01);
    base.tube('cableGY', [[x, hs * 0.5, z + s * 0.02], [x, hs * 0.5 - 0.06, z + s * 0.1], [x + 0.25, -A.yB + 0.03, z + s * 0.3], [x + 0.25, -A.yB - 0.02, z + s * 0.3]], 0.011, { bend: 0.08 });
    base.cyl('copper', 0.012, 0.16, x + 0.25, -A.yB + 0.06, z + s * 0.3, 'y', 6);
  }

  // ---- frame: corner posts, rails, corner castings
  for (const sx of [1, -1]) for (const sz of [1, -1]) {
    enc.box('paint', 0.16, H - hs, 0.16, sx * (L / 2 - 0.08), (H + hs) / 2, sz * (hw - 0.08), 0.014);
    for (const y of [H - 0.06, hs + 0.06]) {
      const k = y > 1 ? enc : base, m = y > 1 ? 'paint' : 'frame';
      k.box(m, 0.19, 0.125, 0.175, sx * (L / 2 - 0.085), y, sz * (hw - 0.08), 0.012);
      k.box('louverDark', 0.022, 0.07, 0.085, sx * (L / 2 + 0.002), y, sz * (hw - 0.08), 0.004);
      k.box('louverDark', 0.1, 0.06, 0.022, sx * (L / 2 - 0.085), y, sz * (hw + 0.001), 0.004);
    }
  }
  for (const s of [1, -1]) {
    enc.box('paint', L - 0.3, 0.14, 0.1, 0, H - 0.07, s * (hw - 0.05), 0.012);
    enc.box('yellow', L - 0.32, 0.1, 0.03, 0, H - 0.19, s * (hw - 0.012), 0.004);
    enc.box('paint', L - 0.32, 0.05, 0.05, 0, hs + 0.025, s * (hw - 0.025), 0.006);
    enc.box('paint', 0.1, 0.14, 2 * hw - 0.3, s * (L / 2 - 0.05), H - 0.07, 0, 0.012);
    enc.box('yellow', 0.03, 0.1, 2 * hw - 0.32, s * (L / 2 - 0.012), H - 0.19, 0, 0.004);
    enc.box('paint', 0.05, 0.05, 2 * hw - 0.32, s * (L / 2 - 0.025), hs + 0.025, 0, 0.006);
  }
  // roof
  enc.box('paint', L - 0.04, 0.05, 2 * hw - 0.04, 0, H - 0.027, 0, 0.012);
  for (let x = xa + 0.6; x < xb - 0.3; x += 1.16) enc.pbox('paint', 0.05, 0.016, 2 * hw - 0.3, x, H + 0.004, 0);
  enc.quad('lining', L - 0.3, 2 * hw - 0.22, 0, H - 0.2, 0, 0, HP);
  // interior light battens (part of the shell so they fade with it)
  for (const x of [xa + 0.9, o.xg0 + 1.2, o.xr + o.Lb * 0.3, o.xr + o.Lb * 0.9]) for (const z of [-0.5, 0.5]) {
    if (x < xa + 1.5 && z < 0) continue;
    enc.box('paintGrey', 1.2, 0.05, 0.12, x, H - 0.235, z, 0.008); enc.pbox('led', 1.14, 0.014, 0.09, x, H - 0.264, z);
  }
  // partitions
  enc.box('lining', 0.05, H - hs - 0.22, 2 * hw - 0.22, xa + 1.75, (H + hs) / 2 - 0.1, 0, 0.002);
  { // vent bulkhead with a round fan opening (four panels around a square hole)
    const yb = hs + 1.75, hh = H - hs - 0.22;
    enc.box('lining', 0.05, hh, 0.78, o.xbh, (H + hs) / 2 - 0.1, 1.0, 0.002);
    enc.box('lining', 0.05, hh, 0.78, o.xbh, (H + hs) / 2 - 0.1, -1.0, 0.002);
    enc.box('lining', 0.05, yb - 0.6 - hs, 1.22, o.xbh, (yb - 0.6 + hs) / 2, 0, 0.002);
    enc.box('lining', 0.05, H - 0.2 - (yb + 0.6), 1.22, o.xbh, (H - 0.2 + yb + 0.6) / 2, 0, 0.002);
  }

  // ---- side walls
  const opsFront = [
    { t: 'ctrl', x: o.ctrl, y: [hs + 0.12, hs + 2.17] },
    { t: 'louver', x: o.louv1, y: [hs + 0.35, hs + 2.3] },
    { t: 'door', x: o.door1, y: [hs + 0.06, hs + 2.2] },
    { t: 'panel', x: o.panel, y: [hs + 0.2, hs + 2.35] },
    { t: 'door', x: o.door2, y: [hs + 0.06, hs + 2.2] },
    { t: 'louver', x: o.louv2, y: [hs + 0.8, hs + 2.35] },
  ];
  const opsBack = [
    { t: 'louver', x: o.louv1, y: [hs + 0.35, hs + 2.3] },
    { t: 'panel', x: [o.door1[0] - 0.1, o.door1[1] + 0.2], y: [hs + 0.2, hs + 2.35] },
    { t: 'panel', x: o.panel, y: [hs + 0.2, hs + 2.35] },
    { t: 'panel', x: [o.door2[0] - 0.1, o.door2[1] + 0.1], y: [hs + 0.2, hs + 2.35] },
    { t: 'louver', x: o.louv2, y: [hs + 0.8, hs + 2.35] },
  ];
  opsBack[1].x[1] = Math.min(opsBack[1].x[1], o.panel[0] - 0.14);
  enc.push(0, 0, hw - 0.004); wall(enc, sp, xa + 0.16, xb - 0.16, opsFront);
  // door lights, e-stop
  for (const d of [o.ctrl, o.door1, o.door2]) {
    const cx = (d[0] + d[1]) / 2, y = hs + 2.42;
    enc.box('black', 0.34, 0.07, 0.11, cx, y, 0.05, 0.01);
    enc.box('led', 0.3, 0.012, 0.085, cx, y - 0.038, 0.052, 0.002);
    enc.tube('galv', [[cx + 0.17, y, 0.02], [cx + 0.3, y, 0.02], [cx + 0.3, H - 0.26, 0.02]], 0.009, { bend: 0.03 });
  }
  { const x = o.ctrl[1] + 0.22, y = hs + 1.35;
    enc.box('yellow', 0.11, 0.14, 0.07, x, y, 0.03, 0.008);
    enc.cyl('black', 0.025, 0.03, x, y, 0.075, 'z', 10);
    enc.lathe('estop', [[0, 0], [0.036, 0], [0.04, 0.008, 1], [0.034, 0.024, 1], [0, 0.03]], x, y, 0.088, 'z', 14);
    enc.tube('galv', [[x, y + 0.07, 0.02], [x, H - 0.26, 0.02]], 0.009);
  }
  enc.pop();
  enc.push(0, 0, 0, 0, 0, 0, 1, 1, -1); enc.push(0, 0, hw - 0.004); wall(enc, sp, xa + 0.16, xb - 0.16, opsBack);
  for (const cx of [xa + 1.0, (o.panel[0] + o.panel[1]) / 2]) {
    enc.box('black', 0.34, 0.07, 0.11, cx, hs + 2.52, 0.05, 0.01); enc.box('led', 0.3, 0.012, 0.085, cx, hs + 2.482, 0.052, 0.002);
  }
  enc.pop(); enc.pop();

  // ---- -X end: cable box, ladder
  enc.push(xa + 0.004, 0, 0, 0, -HP, 0);
  wall(enc, sp, -hw + 0.16, hw - 0.16, []);
  { const by = hs + 1.45, bz = 0.21;
    enc.box('paintGrey', 1.3, 1.1, 0.42, -0.25, by, bz, 0.015);
    enc.box('rubber', 1.2, 1.0, 0.01, -0.25, by, bz + 0.211, 0.002);
    for (const dx of [-0.3, 0.3]) {
      enc.box('paintGrey', 0.585, 0.98, 0.025, -0.25 + dx, by, bz + 0.225, 0.008);
      enc.box('steel', 0.03, 0.14, 0.03, -0.25 + dx * 0.12, by, bz + 0.25, 0.006);
      for (const f of [-0.35, 0.35]) enc.cyl('bolt', 0.014, 0.1, -0.25 + dx * 1.95, by + f, bz + 0.235, 'y', 8);
    }
    enc.box('paintGrey', 1.36, 0.03, 0.5, -0.25, by + 0.565, bz + 0.02, 0.006); // rain hood
    // cables to tray
    const ty = Math.max(0.2, hs - 0.02);
    for (let i = 0; i < 6; i++) {
      const x = -0.7 + i * 0.18;
      enc.cyl('bolt', 0.05, 0.05, x, by - 0.56, bz + 0.02, 'y', 10);
      enc.tube('cable', [[x, by - 0.55, bz + 0.02], [x, ty + 0.12, bz + 0.02], [x, ty + 0.06, bz + 0.35], [x, ty + 0.06, 0.95]], 0.036, { bend: 0.16, radial: 6, n: 4, caps: true });
    }
    // cable ladder tray
    for (const x of [-0.85, 0.35]) enc.box('galv', 0.012, 0.09, 0.9, x, ty + 0.045, 0.52, 0.002);
    for (let z = 0.12; z < 0.98; z += 0.2) enc.box('galv', 1.2, 0.015, 0.04, -0.25, ty + 0.012, z, 0.002);
    for (const x of [-0.85, 0.35]) enc.box('galv', 0.04, by - 0.55 - ty, 0.012, x, (by - 0.55 + ty) / 2, 0.012, 0.002);
  }
  { // ladder to the roof
    const lx = 1.12, y0 = hs + 0.15, y1 = H + 1.05;
    for (const s of [-1, 1]) {
      enc.box('galv', 0.05, y1 - y0, 0.012, lx + s * 0.22, (y0 + y1) / 2, 0.17, 0.003);
      for (let y = y0 + 0.4; y < H; y += 1.1) enc.box('galv', 0.03, 0.03, 0.17, lx + s * 0.22, y, 0.085, 0.003);
    }
    for (let y = y0 + 0.15; y < H + 0.1; y += 0.3) enc.cyl('galv', 0.012, 0.44, lx, y, 0.17, 'x', 6);
  }
  enc.pop();

  // ---- +X end: discharge louver
  enc.push(xb - 0.004, 0, 0, 0, HP, 0);
  wall(enc, sp, -hw + 0.16, hw - 0.16, [{ t: 'louver', x: [-1.15, 1.15], y: [hs + 1.15, hs + 2.45] }]);
  enc.cyl('galv', 0.1, 0.03, -o.gasZ, o.gasY, 0.01, 'z', 14);
  enc.pop();

  // ---- roof handrails around the exhaust deck
  { const hx1 = o.x0c - 0.2, z = hw - 0.07;
    handrail(enc, [xa + 0.08, -z], [hx1, -z], H);
    handrail(enc, [xa + 0.08, z], [hx1, z], H);
    handrail(enc, [xa + 0.08, -z], [xa + 0.08, 0.8], H);
  }

  // ---- signal tower: pole, base, tier separators and cap (the three lenses are per-instance meshes)
  // Deliberately oversized (0.22 m lenses) so it reads from the facility view. A.beacon is the bottom of the lens stack.
  A.beacon = new THREE.Vector3(xa + 0.3, H + 1.75, -1.2);
  {
    const bx = A.beacon.x, bz = A.beacon.z, y0 = A.beacon.y;
    base.box('galv', 0.2, 0.014, 0.2, bx, H + 0.007, bz, 0.003);
    for (const [dx, dz] of [[-0.075, -0.075], [0.075, -0.075], [-0.075, 0.075], [0.075, 0.075]]) base.bolt(bx + dx, H + 0.02, bz + dz, 'y', 0.011);
    base.cyl('galv', 0.045, 0.05, bx, H + 0.039, bz, 'y', 12);
    base.cyl('galv', 0.034, y0 - 0.1 - H, bx, (H + y0 - 0.1) / 2, bz, 'y', 10);
    base.lathe('black', [[0.035, -0.14], [0.06, -0.13, 1], [0.118, -0.06, 1], [0.118, 0], [0.1, 0]], bx, y0, bz, 'y', 20);
    base.cyl('gaugeFace', 0.062, TIER * 3, bx, y0 + TIER * 1.5, bz, 'y', 12, 0.062, true); // diffuser core seen through the lenses
    for (let i = 1; i < 3; i++) base.cyl('black', 0.116, 0.026, bx, y0 + TIER * i, bz, 'y', 20);
    base.lathe('black', [[0.1, -0.013], [0.116, -0.013], [0.116, 0.012], [0.1, 0.04, 1], [0.05, 0.062, 1], [0, 0.066]], bx, y0 + TIER * 3, bz, 'y', 20);
    base.cyl('rubber', 0.012, 0.1, bx + 0.04, y0 - 0.17, bz, [0.4, 1, 0], 6); // cable gland
  }

  // ---- roof cooler
  {
    const { x0c, x1c, Lc } = o, cx = (x0c + x1c) / 2, y0 = H + 0.42, cw = 2.44;
    for (const z of [-1.08, 1.08]) {
      rad.box('galv', Lc, 0.1, 0.1, cx, H + 0.05, z, 0.006);
      const n = sp.fans + 1;
      for (let i = 0; i < n; i++) {
        const x = x0c + 0.08 + (Lc - 0.16) * i / (n - 1);
        rad.box('galv', 0.09, 0.34, 0.09, x, H + 0.26, z, 0.006);
        rad.bolt(x, H + 0.105, z + 0.03, 'y'); rad.bolt(x, H + 0.105, z - 0.03, 'y');
      }
    }
    rad.box('fins', Lc - 0.36, 0.3, cw - 0.12, cx, y0 + 0.15, 0, 0.002);
    for (const z of [-cw / 2 + 0.03, cw / 2 - 0.03]) for (const y of [y0 + 0.02, y0 + 0.28]) rad.box('galv', Lc - 0.3, 0.05, 0.07, cx, y, z, 0.004);
    for (let i = 1; i < sp.fans; i++) for (const z of [-cw / 2 + 0.03, cw / 2 - 0.03]) rad.box('galv', 0.05, 0.3, 0.07, x0c + 0.15 + i * 1.4, y0 + 0.15, z, 0.004);
    for (const x of [x0c + 0.09, x1c - 0.09]) { // header tanks
      rad.rbox('paintGrey', 0.18, 0.36, cw, x, y0 + 0.16, 0, 0.03, 2);
      for (const z of [-0.6, 0.6]) rad.flange('bolt', x, y0 + 0.16, z, 'x', 0.11, 0.2, 0, 12);
    }
    const py = y0 + 0.3, ph = 0.44; // fan plenum
    rad.box('paintGrey', Lc, ph, cw, cx, py + ph / 2, 0, 0.012);
    rad.box('paintGrey', Lc + 0.03, 0.04, cw + 0.03, cx, py + ph - 0.01, 0, 0.008);
    for (let i = 0; i <= sp.fans; i++) for (const z of [-cw / 2, cw / 2]) {
      const x = Math.min(x1c - 0.03, Math.max(x0c + 0.03, x0c + 0.15 + i * 1.4));
      rad.box('paintGrey', 0.06, ph - 0.05, 0.016, x, py + ph / 2 - 0.02, z, 0.004);
      for (const y of [py + 0.06, py + 0.2, py + 0.34]) rad.bolt(x, y, z + Math.sign(z) * 0.01, 'z', 0.009);
    }
    const top = py + ph + 0.01;
    for (let i = 0; i < sp.fans; i++) {
      const fx = x0c + 0.15 + 0.7 + i * 1.4;
      rad.lathe('paintGrey', [[0.628, 0], [0.7, 0], [0.7, 0.13], [0.685, 0.15], [0.648, 0.15], [0.632, 0.12, 1], [0.626, 0]], fx, top, 0, 'y', 32);
      rad.cyl('louverDark', 0.63, 0.006, fx, top + 0.002, 0, 'y', 28);
      rad.cyl('paintGrey', 0.14, 0.1, fx, top + 0.05, 0, 'y', 14);
      for (let a = 0; a < 3; a++) {
        rad.push(fx, top + 0.03, 0, 0, a * TAU / 3 + 0.5, 0); rad.box('paintGrey', 0.52, 0.03, 0.04, 0.38, 0, 0, 0.004); rad.pop();
      }
      rad.geoR('guard', new THREE.CircleGeometry(0.7, 28), fx, top + 0.158, 0, -HP, 0, 0);
      A.fans.push(new THREE.Vector3(fx, top + 0.1, 0));
    }
    // side manifolds and risers from the engine room
    const mz = -1.31, myA = y0 + 0.1, myB = y0 + 0.36;
    rad.tube('paintGrey', [[x0c + 0.09, myA, -1.0], [x0c + 0.09, myA, mz], [o.pipeX[0], myA, mz], [o.pipeX[0], H - 0.02, mz]], 0.06, { bend: 0.12 });
    rad.tube('paintGrey', [[x1c - 0.09, myB, -1.0], [x1c - 0.09, myB, mz], [o.pipeX[2], myB, mz], [o.pipeX[2], H - 0.02, mz]], 0.06, { bend: 0.12 });
    rad.tube('paintGrey', [[x1c - 0.09, myA, -1.0], [x1c - 0.09, myA, mz], [o.pipeX[2] + 0.5, myA, mz]], 0.04, { bend: 0.1, caps: true });
    rad.tube('paintGrey', [[o.pipeX[1], H - 0.02, mz], [o.pipeX[1], myA, mz], [o.pipeX[1] + 0.25, myA, mz]], 0.04, { bend: 0.08 });
    for (const x of o.pipeX) { rad.lathe('galv', [[0.075, 0], [0.13, 0], [0.085, 0.07], [0.075, 0.07]], x, H, mz, 'y', 14); }
    for (const x of [x0c + 0.8, x0c + 2.2]) rad.flange('bolt', x, myA, mz, 'x', 0.095, 0.03, 6, 12);
    for (const x of [x1c - 0.8, x1c - 2.2]) rad.flange('bolt', x, myB, mz, 'x', 0.095, 0.03, 6, 12);
    for (const x of [x0c + 1.5, x1c - 1.5]) { rad.box('galv', 0.04, 0.5, 0.04, x, y0 + 0.2, mz + 0.1, 0.004); }
    // expansion tank
    const ex = x0c + 0.75, ey = top + 0.42, ez = 0.86;
    rad.lathe('paintGrey', [[0, -0.5], [0.16, -0.5, 1], [0.21, -0.45, 1], [0.21, 0.45, 1], [0.16, 0.5, 1], [0, 0.5]], ex, ey, ez, 'x', 18);
    for (const dx of [-0.3, 0.3]) { rad.box('galv', 0.05, 0.24, 0.3, ex + dx, top + 0.11, ez, 0.004); }
    rad.cyl('bolt', 0.045, 0.06, ex + 0.15, ey + 0.23, ez, 'y', 10); rad.cyl('black', 0.055, 0.025, ex + 0.15, ey + 0.27, ez, 'y', 12);
    rad.cyl('glass', 0.012, 0.26, ex - 0.505, ey, ez + 0.05, 'y', 6);
    rad.tube('rubber', [[ex - 0.2, ey - 0.2, ez], [ex - 0.2, top + 0.05, ez + 0.1], [ex - 0.2, top + 0.03, 1.24], [ex - 0.2, y0 + 0.15, 1.24]], 0.016, { bend: 0.06 });
    // fan motor junction box and conduit along the service side
    rad.box('paintGrey', 0.34, 0.3, 0.12, x0c + 0.5, py + 0.2, cw / 2 + 0.07, 0.008);
    rad.tube('galv', [[x0c + 0.67, py + 0.2, cw / 2 + 0.05], [x1c - 0.5, py + 0.2, cw / 2 + 0.05]], 0.012);
    for (let i = 0; i < sp.fans; i++) rad.box('galv', 0.08, 0.08, 0.05, x0c + 0.85 + i * 1.4, py + 0.2, cw / 2 + 0.03, 0.004);
    rad.tube('galv', [[x0c + 0.5, py + 0.05, cw / 2 + 0.07], [x0c + 0.5, H + 0.02, cw / 2 + 0.07]], 0.012);
  }

  // ---- exhaust: riser, catalyst / SCR, silencer, stack
  {
    const xR = o.xt, yE = H + 0.9, zc = -0.65, zs = 0.6, rp = 0.23;
    exh.lathe('galv', [[0.25, 0], [0.42, 0], [0.42, 0.015], [0.27, 0.1], [0.25, 0.1]], xR, H, 0, 'y', 20);
    for (let i = 0; i < 5; i++) exh.torus('stainless', 0.235, 0.022, xR, H + 0.16 + i * 0.045, 0, 'y', 18, 6);
    exh.tube('clad', [[xR, H + 0.38, 0], [xR, yE, 0], [xR - 0.6, yE, zc], [xR - 1.3, yE, zc]], rp, { bend: 0.42, radial: 16, n: 6 });
    exh.cyl('stainless', 0.2, 0.3, xR, H + 0.23, 0, 'y', 14);
    exh.flange('bolt', xR, H + 0.39, 0, 'y', 0.29, 0.025, 10, 18);
    let xS1 = xR - 1.3, xS0;
    exh.flange('bolt', xS1, yE, zc, 'x', 0.29, 0.03, 10, 18);
    if (sp.scr) {
      // urea injection lance and dosing cabinet
      exh.cyl('stainless', 0.02, 0.22, xR - 0.95, yE + 0.28, zc, 'y', 8);
      exh.box('bolt', 0.07, 0.03, 0.07, xR - 0.95, yE + 0.235, zc, 0.004);
      exh.box('paintGrey', 0.5, 0.8, 0.32, xR + 0.5, H + 0.52, -0.95, 0.012);
      exh.box('paintGrey', 0.46, 0.76, 0.02, xR + 0.5, H + 0.52, -0.78, 0.008);
      exh.box('steel', 0.03, 0.1, 0.025, xR + 0.68, H + 0.52, -0.765, 0.004);
      for (const dx of [-0.2, 0.2]) exh.box('galv', 0.04, 0.12, 0.3, xR + 0.5 + dx, H + 0.06, -0.95, 0.004);
      exh.tube('urea', [[xR + 0.3, H + 0.85, -0.95], [xR + 0.3, yE + 0.5, -0.95], [xR - 0.95, yE + 0.5, zc], [xR - 0.95, yE + 0.38, zc]], 0.011, { bend: 0.08 });
      exh.tube('galv', [[xR + 0.5, H + 0.12, -1.12], [xR + 0.5, H + 0.03, -1.3], [xR + 0.5, H + 0.03, -1.42]], 0.014, { bend: 0.05 });
      xS1 -= 0.42; xS0 = xS1 - 2.1;
      const bw = 1.24, bh = 1.3, bcx = (xS0 + xS1) / 2;
      exh.geoR('clad', new THREE.CylinderGeometry(0.33, 0.86, 0.42, 4, 1, true), xS1 + 0.21, yE, zc, PI / 4, 0, -HP);
      exh.geoR('clad', new THREE.CylinderGeometry(0.33, 0.86, 0.42, 4, 1, true), xS0 - 0.21, yE, zc, PI / 4, 0, HP);
      exh.rbox('clad', 2.1, bh, bw, bcx, yE, zc, 0.03, 2);
      for (let i = 0; i <= 4; i++) {
        const x = xS0 + 0.05 + i * 0.5;
        exh.box('clad', 0.05, bh + 0.05, 0.03, x, yE, zc + bw / 2 + 0.012, 0.004); exh.box('clad', 0.05, bh + 0.05, 0.03, x, yE, zc - bw / 2 - 0.012, 0.004);
        exh.box('clad', 0.05, 0.03, bw + 0.05, x, yE + bh / 2 + 0.012, zc, 0.004);
      }
      for (const dx of [-0.5, 0.5]) { // catalyst access hatches on top
        exh.box('paintGrey', 0.42, 0.03, 0.9, bcx + dx, yE + bh / 2 + 0.02, zc, 0.008);
        for (const a of [-0.17, 0.17]) for (const b of [-0.4, 0, 0.4]) exh.bolt(bcx + dx + a, yE + bh / 2 + 0.038, zc + b, 'y', 0.012);
        exh.tube('steel', [[bcx + dx - 0.08, yE + bh / 2 + 0.03, zc], [bcx + dx - 0.08, yE + bh / 2 + 0.09, zc], [bcx + dx + 0.08, yE + bh / 2 + 0.09, zc], [bcx + dx + 0.08, yE + bh / 2 + 0.03, zc]], 0.008, { bend: 0.02 });
      }
      for (const x of [xS0 + 0.3, xS1 - 0.3]) { // saddles and sensor ports
        exh.box('galv', 0.1, 0.24, bw - 0.1, x, H + 0.12, zc, 0.006);
        exh.cyl('stainless', 0.018, 0.12, x, yE + 0.3, zc - bw / 2 - 0.06, 'z', 8);
        exh.box('black', 0.05, 0.05, 0.08, x, yE + 0.3, zc - bw / 2 - 0.15, 0.006);
      }
      exh.tube('galv', [[xS1 - 0.3, yE + 0.3, zc - bw / 2 - 0.19], [xS1 - 0.3, H + 0.05, zc - bw / 2 - 0.19]], 0.01);
    } else {
      // oxidation / three-way catalyst housing
      xS0 = xS1 - 1.3;
      exh.lathe('clad', [[rp, 0], [0.52, 0.28], [0.52, 1.02], [rp, 1.3]], xS0, yE, zc, 'x', 20);
      for (const x of [xS0 + 0.3, xS0 + 1.0]) { exh.flange('bolt', x, yE, zc, 'x', 0.57, 0.03, 16, 20); exh.box('galv', 0.1, yE - H - 0.3, 0.7, x, (yE - 0.3 + H) / 2, zc, 0.006); }
      exh.cyl('stainless', 0.018, 0.1, xS0 + 0.65, yE + 0.56, zc, 'y', 8); exh.box('black', 0.05, 0.08, 0.05, xS0 + 0.65, yE + 0.64, zc, 0.006);
    }
    exh.flange('bolt', xS0 - (sp.scr ? 0.42 : 0), yE, zc, 'x', 0.29, 0.03, 10, 18);
    const xU = xS0 - (sp.scr ? 0.42 : 0);
    const ub = Math.max(xa + 0.42, xU - 0.75);
    exh.tube('clad', [[xU, yE, zc], [ub, yE, zc], [ub, yE, zs], [xU + 0.1, yE, zs]], rp, { bend: 0.4, radial: 16, n: 6 });
    // silencer
    const sx0 = xU + 0.1, Ls = sp.scr ? 2.5 : 2.2, sr = 0.47;
    exh.lathe('clad', [[rp, 0], [rp, 0.02], [sr - 0.08, 0.12, 1], [sr, 0.24, 1], [sr, Ls - 0.24, 1], [sr - 0.08, Ls - 0.12, 1], [rp, Ls - 0.02], [rp, Ls]], sx0, yE, zs, 'x', 24);
    for (const f of [0.3, 0.5, 0.7]) exh.cyl('stainless', sr + 0.006, 0.05, sx0 + Ls * f, yE, zs, 'x', 24, sr + 0.006, true);
    for (const f of [0.25, 0.75]) {
      exh.box('galv', 0.1, yE - H - 0.25, 0.7, sx0 + Ls * f, (yE - 0.25 + H) / 2, zs, 0.006);
      exh.box('galv', 0.14, 0.02, 0.8, sx0 + Ls * f, H + 0.01, zs, 0.004);
    }
    for (const f of [0.2, 0.8]) { exh.box('clad', 0.02, 0.12, 0.1, sx0 + Ls * f, yE + sr + 0.04, zs, 0.004); }
    exh.box('alu', 0.2, 0.004, 0.12, sx0 + Ls * 0.5, yE, zs + sr + 0.008, 0.001);
    // outlet elbow and stack
    const stx = sx0 + Ls + 0.5, stTop = H + 2.75;
    exh.flange('bolt', sx0 + Ls + 0.02, yE, zs, 'x', 0.29, 0.03, 10, 18);
    exh.tube('clad', [[sx0 + Ls, yE, zs], [stx, yE, zs], [stx, yE + 0.75, zs]], rp, { bend: 0.36, radial: 16, n: 6 });
    exh.flange('bolt', stx, yE + 0.75, zs, 'y', 0.29, 0.03, 10, 18);
    exh.cyl('stainless', 0.215, stTop - yE - 0.75, stx, (stTop + yE + 0.75) / 2, zs, 'y', 20, 0.215, true);
    exh.cyl('louverDark', 0.2, stTop - yE - 0.8, stx, (stTop + yE + 0.75) / 2, zs, 'y', 12, 0.2, true);
    exh.torus('stainless', 0.218, 0.012, stx, stTop, zs, 'y', 20, 6);
    exh.torus('stainless', 0.218, 0.01, stx, yE + 1.4, zs, 'y', 20, 6);
    // support brace to the roof
    exh.tube('galv', [[stx, yE + 1.4, zs + 0.22], [stx + 0.5, H + 0.03, zs + 0.5]], 0.016);
    exh.tube('galv', [[stx, yE + 1.4, zs - 0.22], [stx + 0.5, H + 0.03, zs - 0.5]], 0.016);
    // counterweighted rain cap, shown lifted
    exh.push(stx - 0.235, stTop + 0.01, zs, 0, 0, 0.6);
    exh.cyl('stainless', 0.235, 0.012, 0.235, 0.01, 0, 'y', 20);
    exh.box('stainless', 0.2, 0.02, 0.05, -0.08, 0.01, 0, 0.004);
    exh.cyl('bolt', 0.05, 0.07, -0.2, 0.01, 0, 'z', 10);
    exh.pop();
    exh.cyl('bolt', 0.012, 0.12, stx - 0.235, stTop + 0.01, zs, 'z', 6);
    A.exhaustTip = new THREE.Vector3(stx, stTop + 0.05, zs);
  }

  // ---- gas train at the +X end
  {
    const gy = sp.mobile ? 0 : 0.1, py = o.gasY, gz = o.gasZ;
    gas.push(xb + 0.85, 0, 0);
    if (!sp.mobile) {
      for (const x of [-0.35, 0.35]) gas.box('frame', 0.1, 0.1, 2.5, x, 0.05, -0.1, 0.008);
      for (const z of [-1.25, -0.1, 1.05]) gas.box('frame', 0.6, 0.1, 0.1, 0, 0.05, z, 0.008);
      for (const [x, z] of [[0.75, -1.5], [0.75, 1.35]]) { // bollards
        gas.cyl('yellow', 0.057, 1.0, x, 0.5, z, 'y', 12); gas.lathe('yellow', [[0.057, 0], [0.05, 0.02, 1], [0, 0.035]], x, 1.0, z, 'y', 12);
        gas.cyl('black', 0.058, 0.08, x, 0.8, z, 'y', 12);
      }
      gas.tube('yellow', [[0, -0.05, -1.25], [0, py, -1.25], [0, py, -0.95]], 0.057, { bend: 0.12 });
      gas.lathe('galv', [[0.06, 0], [0.12, 0], [0.12, 0.012], [0.07, 0.04], [0.06, 0.04]], 0, 0, -1.25, 'y', 14);
    } else {
      gas.tube('yellow', [[0, py, -1.3], [0, py, -0.95]], 0.057, { caps: true });
      gas.flange('bolt', 0, py, -1.31, 'z', 0.1, 0.03, 6, 14);
      gas.tube('braid', [[0, py, -1.33], [0, py, -1.7], [0.2, -DECK + 0.08, -1.95], [0.9, -DECK + 0.06, -2.1]], 0.05, { bend: 0.3, n: 6 });
    }
    gas.tube('yellow', [[0, py, -0.95], [0, py, gz], [-0.42, py, gz]], 0.057, { bend: 0.12 });
    // pipe stands
    for (const z of [-0.62, 0.72]) {
      gas.box('frame', 0.06, py - gy - 0.06, 0.06, 0, (py - 0.06 + gy) / 2, z, 0.006);
      gas.box('frame', 0.16, 0.012, 0.1, 0, py - 0.063, z, 0.002);
      gas.torus('bolt', 0.062, 0.007, 0, py, z, 'z', 12, 5);
    }
    // manual ball valve
    let z = -0.82;
    gas.flange('bolt', 0, py, z - 0.11, 'z', 0.105, 0.03, 6, 14); gas.flange('bolt', 0, py, z + 0.11, 'z', 0.105, 0.03, 6, 14);
    gas.lathe('yellow', [[0.06, -0.1], [0.085, -0.07, 1], [0.105, 0, 1], [0.085, 0.07, 1], [0.06, 0.1]], 0, py, z, 'z', 14);
    gas.cyl('bolt', 0.025, 0.1, 0, py + 0.12, z, 'y', 8);
    gas.box('black', 0.035, 0.016, 0.36, 0, py + 0.175, z + 0.13, 0.005);
    // filter
    z = -0.42;
    gas.lathe('yellow', [[0, -0.34], [0.1, -0.34, 1], [0.135, -0.3, 1], [0.135, 0.1], [0.16, 0.1], [0.16, 0.13], [0.135, 0.13], [0.13, 0.16, 1], [0, 0.18]], 0, py, z, 'y', 16);
    for (let i = 0; i < 8; i++) gas.bolt(Math.cos(i / 8 * TAU) * 0.147, py + 0.135, z + Math.sin(i / 8 * TAU) * 0.147, 'y', 0.009);
    gas.cyl('brass', 0.015, 0.05, 0, py - 0.36, z, 'y', 6);
    // regulator: diaphragm case and spring tower
    z = 0.06;
    gas.rbox('paintGrey', 0.2, 0.2, 0.24, 0, py, z, 0.03, 2);
    gas.flange('bolt', 0, py, z - 0.13, 'z', 0.105, 0.025, 6, 14); gas.flange('bolt', 0, py, z + 0.13, 'z', 0.105, 0.025, 6, 14);
    gas.cyl('paintGrey', 0.05, 0.1, 0, py + 0.14, z, 'y', 10);
    gas.lathe('paintGrey', [[0, 0], [0.12, 0, 1], [0.215, 0.05, 1], [0.235, 0.06], [0.235, 0.075], [0.215, 0.085, 1], [0.12, 0.13, 1], [0.06, 0.14], [0.06, 0.34], [0.045, 0.36, 1], [0, 0.365]], 0, py + 0.18, z, 'y', 22);
    for (let i = 0; i < 12; i++) gas.bolt(Math.cos(i / 12 * TAU) * 0.222, py + 0.258, z + Math.sin(i / 12 * TAU) * 0.222, 'y', 0.008);
    gas.tube('copper', [[0.1, py + 0.24, z], [0.2, py + 0.24, z], [0.2, py + 0.1, z + 0.3], [0.03, py + 0.05, z + 0.3]], 0.006, { bend: 0.04 });
    // double block shutoff valves with solenoid actuators
    for (const zz of [0.42, 0.68]) {
      gas.rbox('alu', 0.17, 0.17, 0.17, 0, py, zz, 0.02, 2);
      gas.box('black', 0.11, 0.17, 0.11, 0, py + 0.17, zz, 0.012);
      gas.cyl('bolt', 0.02, 0.03, 0, py + 0.27, zz, 'y', 8);
      gas.tube('cable', [[0.055, py + 0.2, zz], [0.14, py + 0.2, zz], [0.2, py + 0.5, 0.95], [0.2, py + 0.62, 1.05]], 0.011, { bend: 0.06 });
    }
    // gauges and pressure switch
    for (const [zz, m] of [[-0.62, 'gaugeFace'], [0.26, 'gaugeFace'], [0.55, 'black']]) {
      gas.cyl('brass', 0.008, 0.1, 0, py + 0.1, zz, 'y', 6);
      if (m === 'black') gas.box('black', 0.07, 0.09, 0.06, 0, py + 0.19, zz, 0.008);
      else { gas.cyl('bolt', 0.045, 0.03, 0.01, py + 0.19, zz, 'x', 14); gas.cyl(m, 0.039, 0.004, 0.027, py + 0.19, zz, 'x', 14); gas.box('black', 0.002, 0.03, 0.004, 0.03, py + 0.2, zz, 0.0005); }
    }
    // junction box on a post
    gas.box('frame', 0.05, 1.5 - gy, 0.05, 0.2, (1.5 + gy) / 2, 1.08, 0.006);
    gas.box('paintGrey', 0.3, 0.38, 0.14, 0.2, 1.45, 1.0, 0.01);
    gas.box('paintGrey', 0.26, 0.34, 0.012, 0.275 + 0.0, 1.45, 1.0 - 0.076, 0.004);
    gas.tube('galv', [[0.2, 1.64, 1.0], [0.2, 1.9, 1.0], [-0.83, 1.9, 1.0]], 0.012, { bend: 0.05 });
    // flex connector into the enclosure
    gas.flange('bolt', -0.42, py, gz, 'x', 0.1, 0.03, 6, 14);
    gas.tube('braid', [[-0.43, py, gz], [-0.8, py, gz]], 0.062, { radial: 12 });
    gas.cyl('stainless', 0.068, 0.05, -0.47, py, gz, 'x', 12); gas.cyl('stainless', 0.068, 0.05, -0.77, py, gz, 'x', 12);
    // vent line up the corner post with a gooseneck
    gas.tube('galv', [[0, py + 0.3, 0.06 - 0.2], [-0.2, py + 0.45, -0.3], [-0.78, py + 0.45, -1.38], [-0.78, H + 0.5, -1.38], [-0.6, H + 0.5, -1.38], [-0.6, H + 0.36, -1.38]], 0.014, { bend: 0.07 });
    gas.tube('galv', [[0, py + 0.09, 0.55], [-0.3, py + 0.3, 0.55], [-0.78, py + 0.3, -1.32], [-0.78, H + 0.38, -1.32], [-0.62, H + 0.38, -1.32], [-0.62, H + 0.26, -1.32]], 0.011, { bend: 0.07 });
    gas.pop();
  }

  // ---- trailer chassis for mobile units
  if (sp.mobile) {
    const yg = -DECK, nose = xa - 1.75, tail = xb + 1.55, tl = tail - nose, tcx = (tail + nose) / 2;
    for (const s of [1, -1]) {
      const z = s * 0.5;
      trl.box('chassis', tl, 0.03, 0.2, tcx, -0.015, z, 0.005);
      trl.box('chassis', tl, 0.4, 0.02, tcx, -0.23, z, 0.004);
      trl.box('chassis', tl - 1.0, 0.03, 0.2, tcx + 0.5, -0.445, z, 0.005);
      trl.box('chassis', tl - 0.1, 0.2, 0.06, tcx, -0.1, s * 1.27, 0.008);
      for (let x = nose + 0.6; x < tail; x += 0.6) trl.pbox('chassis', 0.08, 0.14, 0.72, x, -0.09, s * 0.88);
    }
    for (let x = nose + 0.3; x < tail; x += 1.2) trl.pbox('chassis', 0.1, 0.3, 0.98, x, -0.2, 0);
    // nose deck, rear deck
    trl.box('floor', 1.7, 0.012, 2.6, xa - 0.9, 0.006, 0, 0.002);
    trl.box('floor', 1.5, 0.012, 2.6, xb + 0.8, 0.006, 0, 0.002);
    trl.box('chassis', 0.08, 0.34, 2.6, nose + 0.04, -0.15, 0, 0.01);
    // front connections
    for (const [z, m] of [[-0.25, 'estop'], [0, 'black'], [0.25, 'urea']]) { trl.box('bolt', 0.05, 0.1, 0.1, nose - 0.02, -0.12, z, 0.008); trl.cyl(m, 0.03, 0.04, nose - 0.06, -0.12, z, 'x', 8); }
    // kingpin and upper coupler
    trl.box('chassis', 1.3, 0.02, 1.1, nose + 0.95, -0.47, 0, 0.004);
    trl.lathe('steel', [[0, -0.13], [0.036, -0.13], [0.036, -0.1], [0.025, -0.09], [0.025, -0.04], [0.045, -0.03], [0.045, 0]], nose + 0.95, -0.48, 0, 'y', 14);
    // landing gear
    const lx = xa + 0.9;
    for (const s of [1, -1]) {
      const z = s * 0.7;
      trl.box('chassis', 0.13, 0.75, 0.13, lx, -0.45, z, 0.01);
      trl.box('galv', 0.1, 0.36, 0.1, lx, yg + 0.21, z, 0.008);
      trl.box('chassis', 0.3, 0.03, 0.3, lx, yg + 0.015, z, 0.006);
      trl.tube('chassis', [[lx, -0.75, z], [lx + 0.6, -0.1, z]], 0.025, { radial: 6 });
      trl.box('chassis', 0.16, 0.14, 0.12, lx, -0.3, z + s * 0.11, 0.01);
    }
    trl.cyl('chassis', 0.02, 1.4, lx, -0.3, 0, 'z', 8);
    trl.tube('chassis', [[lx, -0.3, 0.87], [lx, -0.3, 1.05], [lx, -0.48, 1.05], [lx, -0.48, 1.2]], 0.012, { bend: 0.03 });
    // axles, suspension, wheels
    const tireP = [[0.29, -0.118, 1], [0.335, -0.14, 1], [0.39, -0.142, 1], [0.428, -0.124, 1], [0.44, -0.1, 1], [0.44, 0.1, 1], [0.428, 0.124, 1], [0.39, 0.142, 1], [0.335, 0.14, 1], [0.29, 0.118, 1]];
    const rimP = [[0.292, 0.118], [0.28, 0.1, 1], [0.262, 0.03, 1], [0.2, -0.02, 1], [0.13, 0.0, 1], [0.118, 0.04], [0.09, 0.04], [0.09, 0.07], [0, 0.07]];
    const tire = latheGeom(tireP, 22), rim = latheGeom(rimP, 18);
    const wy = yg + 0.44;
    [xb - 3.6, xb - 2.3, xb - 1.0].forEach((ax) => {
      trl.cyl('chassis', 0.065, 2.0, ax, wy, 0, 'z', 10);
      for (const s of [1, -1]) {
        for (const z of [0.86, 1.16]) trl.geo('tire', tire, ax, wy, s * z, 'z');
        trl.geo('rim', rim, ax, wy, s * 1.16, [0, 0, s]);
        trl.cyl('chassis', 0.2, 0.2, ax, wy, s * 0.62, 'z', 14);
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; trl.bolt(ax + Math.cos(a) * 0.105, wy + Math.sin(a) * 0.105, s * (1.16 + 0.05), 'z', 0.014); }
        trl.cyl('steel', 0.05, 0.05, ax, wy, s * (1.16 + 0.09), 'z', 10);
        // hanger, trailing arm, air spring
        trl.box('chassis', 0.14, 0.34, 0.08, ax - 0.5, -0.6, s * 0.5, 0.008);
        trl.tube('chassis', [[ax - 0.5, -0.72, s * 0.5], [ax + 0.25, wy + 0.02, s * 0.5]], 0.04, { radial: 6 });
        trl.cyl('rubber', 0.12, 0.2, ax + 0.25, -0.56, s * 0.5, 'y', 12);
        trl.cyl('bolt', 0.125, 0.02, ax + 0.25, -0.455, s * 0.5, 'y', 12);
        // fender arc
        trl.arc('chassis', 0.5, 0.62, ax, wy, s * 1.0, 'z', -0.9, 1.8, 8);
      }
    });
    for (const s of [1, -1]) { // mud flaps, lights, underride guard
      trl.box('rubber', 0.012, 0.55, 0.6, xb - 0.42, yg + 0.42, s * 1.0, 0.003);
      trl.box('chassis', 0.03, 0.03, 0.62, xb - 0.42, yg + 0.7, s * 1.0, 0.004);
      for (const [dz, m] of [[0, 'lensRed'], [0.16, 'lensRed'], [0.32, 'lensAmber']]) {
        trl.cyl('rubber', 0.058, 0.02, tail + 0.002, -0.17, s * (0.75 + dz), 'x', 12);
        trl.cyl(m, 0.048, 0.014, tail + 0.012, -0.17, s * (0.75 + dz), 'x', 12);
      }
      trl.box('chassis', 0.07, 0.5, 0.07, tail - 0.1, -0.55, s * 0.6, 0.006);
      for (let i = 0; i < 6; i++) trl.pbox(i % 2 ? 'gaugeFace' : 'estop', 0.004, 0.05, 0.2, tail + 0.001, -0.3, s * (0.15 + i * 0.2));
      // conspicuity tape along the side rail
      for (let x = nose + 0.4; x < tail - 0.3; x += 0.6) trl.pbox(Math.round(x / 0.6) % 2 ? 'gaugeFace' : 'estop', 0.28, 0.05, 0.004, x, -0.1, s * 1.301);
      // marker lights
      for (const x of [nose + 0.2, tcx, tail - 0.2]) trl.box('lensAmber', 0.09, 0.035, 0.012, x, -0.03, s * 1.303, 0.004);
    }
    trl.box('chassis', 0.12, 0.34, 2.6, tail - 0.06, -0.17, 0, 0.012);
    trl.box('chassis', 0.09, 0.09, 2.3, tail - 0.1, -0.8, 0, 0.008);
    trl.box('gaugeFace', 0.004, 0.16, 0.32, tail + 0.002, -0.17, 0, 0.001);
    // outriggers, deployed
    for (const x of [xa + 2.6, xb - 4.6]) for (const s of [1, -1]) {
      trl.box('chassis', 0.14, 0.14, 0.9, x, -0.3, s * 1.2, 0.01);
      trl.box('galv', 0.1, 0.1, 0.5, x, -0.3, s * 1.62, 0.008);
      trl.box('chassis', 0.13, 0.5, 0.13, x, -0.3, s * 1.86, 0.01);
      trl.box('galv', 0.09, 0.5, 0.09, x, yg + 0.27, s * 1.86, 0.008);
      trl.box('chassis', 0.36, 0.03, 0.36, x, yg + 0.015, s * 1.86, 0.006);
      trl.cyl('bolt', 0.02, 0.14, x, 0.0, s * 1.86, 'y', 6);
      trl.box('bolt', 0.2, 0.014, 0.02, x + 0.08, 0.06, s * 1.86, 0.003);
    }
    // access stairs at the doors
    for (const d of [o.ctrl, o.door1, o.door2]) {
      const cx = (d[0] + d[1]) / 2, ns = 5, rise = (DECK + hs) / ns;
      for (let i = 0; i < ns; i++) {
        const y = hs - (i + 0.0) * rise - 0.02, z = hw + 0.16 + i * 0.25;
        trl.pbox('galv', 0.9, 0.03, 0.26, cx, y, z);
      }
      for (const s of [-1, 1]) {
        trl.tube('galv', [[cx + s * 0.47, hs - 0.06, hw + 0.03], [cx + s * 0.47, yg + 0.02, hw + 0.16 + ns * 0.25]], 0.022, { radial: 6 });
        trl.tube('galv', [[cx + s * 0.47, hs - 0.02, hw + 0.1], [cx + s * 0.47, hs + 0.95, hw + 0.1], [cx + s * 0.47, yg + 1.0, hw + 0.1 + ns * 0.25], [cx + s * 0.47, yg + 0.02, hw + 0.1 + ns * 0.25]], 0.017, { bend: 0.06, radial: 6 });
      }
    }
  }

  // ---- placards (fade with the enclosure)
  const dec = new Kit(), zf = hw + 0.012, py = hs + 1.55;
  placard(dec, 4, 0.34, 0.34, o.door1[0] + 0.5, hs + 1.7, zf + 0.022, 0);
  placard(dec, 3, 0.34, 0.34, o.door2[0] + 0.5, hs + 1.7, zf + 0.022, 0);
  placard(dec, 0, 0.36, 0.36, o.panel[1] - 0.32, hs + 0.62, zf + 0.008, 0);
  placard(dec, 2, 0.36, 0.36, o.panel[1] - 0.74, hs + 0.62, zf + 0.008, 0);
  placard(dec, 5, 0.34, 0.34, o.panel[0] + 0.32, hs + 0.62, zf + 0.008, 0);
  placard(dec, 1, 0.36, 0.36, xa - 0.012 - 0.426 - 0.014, py - 0.1, 0.55, -HP);
  placard(dec, 6, 0.3, 0.3, xa - 0.012 - 0.426 - 0.014, py - 0.1, -0.05, -HP);
  placard(dec, 4, 0.34, 0.34, (o.panel[0] + o.panel[1]) / 2 + 0.5, hs + 0.62, -zf - 0.008, PI);
  placard(dec, 2, 0.36, 0.36, (o.panel[0] + o.panel[1]) / 2 - 0.5, hs + 0.62, -zf - 0.008, PI);

  const parts = { enclosure: enc.build(), decals: dec.build(), base: base.build(), radiator: rad.build(), exhaust: exh.build(), gasTrain: gas.build(), trailer: trl.build() };
  let tris = 0; for (const k of Object.keys(parts)) tris += parts[k].tris;
  const byPart = {}; for (const k of Object.keys(parts)) { byPart[k] = {}; for (const [m, g] of parts[k]) byPart[k][m] = g.attributes.position.count / 3; }
  return { parts, A, o, tris, byPart, rotor: rotorGeom(0.6, 7) };
}

// ---------------------------------------------------------------- interior

function buildInterior(sp) {
  const o = layout(sp), { xa, xb, H, hs, yc, yt, xr, xf, xt, xg0, xg1, Lb } = o;
  const eng = new Kit(IALIAS), gen = new Kit(IALIAS), bfr = new Kit(IALIAS), ctl = new Kit(IALIAS), room = new Kit(IALIAS), hot = new Kit(IALIAS);
  const n = sp.cyl / 2, fl = hs + 0.012, A = {};

  // ---- base frame on spring isolators
  const fx0 = xg0 - 0.15, fx1 = xf + 0.6, fL = fx1 - fx0, fcx = (fx0 + fx1) / 2, fy = fl + 0.13, ftop = fy + 0.33;
  for (const s of [1, -1]) {
    const z = s * 0.72;
    bfr.box('frame', fL, 0.03, 0.24, fcx, fy + 0.015, z, 0.006);
    bfr.box('frame', fL, 0.27, 0.025, fcx, fy + 0.165, z, 0.004);
    bfr.box('frame', fL, 0.03, 0.24, fcx, fy + 0.315, z, 0.006);
    const ni = Math.round(fL / 1.3) + 1;
    for (let i = 0; i < ni; i++) {
      const x = fx0 + 0.25 + (fL - 0.5) * i / (ni - 1);
      bfr.box('frame', 0.32, 0.016, 0.24, x, fl + 0.008, z, 0.003);
      bfr.cyl('black', 0.085, 0.05, x, fl + 0.04, z, 'y', 14);
      for (let c = 0; c < 3; c++) bfr.torus('steel', 0.06, 0.011, x, fl + 0.072 + c * 0.018, z, 'y', 12, 5);
      bfr.cyl('yellow', 0.09, 0.02, x, fl + 0.122, z, 'y', 14);
      for (const dx of [-0.13, 0.13]) bfr.bolt(x + dx, fl + 0.02, z, 'y', 0.012);
      bfr.box('frame', 0.012, 0.27, 0.2, x + 0.14, fy + 0.165, z, 0.002);
    }
    bfr.box('frame', 0.03, 0.33, 0.24, fx0, fy + 0.165, z, 0.004); bfr.box('frame', 0.03, 0.33, 0.24, fx1, fy + 0.165, z, 0.004);
    for (const x of [fx0 + 0.5, fx1 - 0.5]) { bfr.box('frame', 0.16, 0.14, 0.03, x, ftop + 0.05, z + s * 0.09, 0.006); bfr.cyl('louverDark', 0.03, 0.032, x, ftop + 0.07, z + s * 0.09, 'z', 10); }
  }
  for (let x = fx0 + 0.4; x < fx1; x += 1.05) bfr.box('frame', 0.16, 0.2, 1.3, x, fy + 0.13, 0, 0.006);

  // ---- alternator
  {
    const P = [[0, 0], [0.4, 0, 1], [0.5, 0.08, 1], [0.5, 0.44], [0.6, 0.47], [0.7, 0.47], [0.7, 0.55], [0.68, 0.56], [0.68, 1.84], [0.7, 1.85], [0.7, 1.93], [0.68, 1.96], [0.63, 2.24], [0.74, 2.24], [0.74, 2.3], [0, 2.3]];
    gen.lathe('engine', P, xg0, yc, 0, 'x', 36);
    // air inlet grilles on the exciter end, outlet screens at the drive end
    for (const th of [0.5, 2.6, 4.2]) gen.arc('perfDark', 0.504, 0.3, xg0 + 0.26, yc, 0, 'x', th, 1.1, 8);
    for (const th of [0.35, PI + 0.35]) gen.arc('perfDark', 0.664, 0.22, xg0 + 2.1, yc, 0, 'x', th, 1.0, 8);
    gen.cyl('engine', 0.24, 0.1, xg0 - 0.05, yc, 0, 'x', 16);
    gen.cyl('black', 0.15, 0.03, xg0 - 0.11, yc, 0, 'x', 14);
    gen.tube('steel', [[xg0 - 0.05, yc + 0.24, 0], [xg0 - 0.05, yc + 0.5, 0], [xg0 + 0.3, yc + 0.5, 0.3]], 0.008, { bend: 0.04 });
    for (let i = 0; i < 12; i++) { const a = i / 12 * TAU; gen.bolt(xg0 + 2.305, yc + Math.cos(a) * 0.69, Math.sin(a) * 0.69, 'x', 0.016); }
    // louvered cooling air panels on both sides, end cover bolts
    for (const s of [1, -1]) {
      gen.push(0, 0, 0, 0, 0, 0, 1, 1, s);
      for (const cx of [xg0 + 0.82, xg0 + 1.55]) {
        const w = 0.34, h = 0.32, cy = yc - 0.08;
        for (const dy of [-h / 2, h / 2]) gen.box('engine', w + 0.05, 0.03, 0.08, cx, cy + dy, 0.665, 0.006);
        for (const dx of [-w / 2, w / 2]) gen.box('engine', 0.03, h + 0.05, 0.08, cx + dx, cy, 0.665, 0.006);
        gen.pbox('louverDark', w, h, 0.02, cx, cy, 0.655);
        for (let i = 0; i < 8; i++) { gen.push(cx, cy - h / 2 + 0.03 + i * 0.037, 0.688, 0.7, 0, 0); gen.pbox('engine', w, 0.004, 0.045, 0, 0, 0); gen.pop(); }
        for (const dx of [-w / 2, w / 2]) for (const dy of [-h / 2, h / 2]) gen.bolt(cx + dx, cy + dy, 0.707, 'z', 0.008);
      }
      gen.pop();
    }
    for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * TAU; gen.bolt(xg0 + 0.466, yc + Math.cos(a) * 0.65, Math.sin(a) * 0.65, [-1, 0, 0], 0.013); }
    // longitudinal frame ribs
    for (let i = 0; i < 10; i++) {
      const a = (i + 0.5) / 10 * TAU; if (Math.sin(a) > 0.75) continue;
      gen.push(xg0 + 1.2, yc, 0, a, 0, 0); gen.box('engine', 1.26, 0.035, 0.03, 0, 0.69, 0, 0.006); gen.pop();
    }
    // feet
    for (const s of [1, -1]) {
      gen.box('engine', 1.5, 0.068, 0.24, xg0 + 1.2, ftop + 0.034, s * 0.66, 0.008);
      for (const dx of [-0.6, 0, 0.6]) {
        gen.box('engine', 0.05, 0.42, 0.2, xg0 + 1.2 + dx, ftop + 0.26, s * 0.6, 0.006);
        for (const e of [-0.1, 0.1]) gen.bolt(xg0 + 1.2 + dx + e, ftop + 0.074, s * 0.72, 'y', 0.018);
      }
    }
    // lifting lugs
    for (const dx of [0.62, 1.8]) { gen.box('engine', 0.03, 0.14, 0.14, xg0 + dx, yc + 0.72, 0.42, 0.006); gen.box('engine', 0.03, 0.14, 0.14, xg0 + dx, yc + 0.72, -0.42, 0.006); }
    // terminal box with cable entry
    const tx = xg0 + 1.1, ty = yc + 0.68 + 0.27;
    gen.box('engine', 0.95, 0.56, 1.15, tx, ty, 0, 0.02);
    gen.box('engine', 0.7, 0.14, 0.9, tx, yc + 0.66, 0, 0.01);
    gen.box('engine', 0.85, 0.46, 0.02, tx, ty, 0.585, 0.008);
    for (const a of [-0.38, 0, 0.38]) for (const b of [-0.19, 0.19]) gen.bolt(tx + a, ty + b, 0.598, 'z', 0.011);
    gen.box('alu', 0.26, 0.13, 0.003, tx - 0.27, ty + 0.06, 0.597, 0.001);
    gen.box('paintGrey', 0.3, 0.36, 0.14, tx - 0.25, yc + 0.3, 0.74, 0.01); // AVR box
    gen.tube('cable', [[tx - 0.25, yc + 0.48, 0.74], [tx - 0.25, yc + 0.62, 0.7], [tx - 0.25, ty - 0.1, 0.6]], 0.014, { bend: 0.05 });
    gen.box('bolt', 0.8, 0.02, 0.3, tx, ty + 0.2, -0.6, 0.004); // gland plate
    A.cables = [];
    for (let i = 0; i < 6; i++) {
      const x = tx - 0.3 + (i % 3) * 0.3, z = -0.63 - Math.floor(i / 3) * 0.1;
      gen.cyl('brass', 0.045, 0.05, x, ty + 0.2, z - 0.03, 'z', 10);
      A.cables.push([x, ty + 0.2, z - 0.05]);
    }
    // bus bar stubs visible through a clear inspection window
    gen.box('glass', 0.4, 0.26, 0.006, tx + 0.15, ty - 0.02, 0.598, 0.002);
    gen.box('engine', 0.2, 0.004, 0.14, xg0 + 1.6, yc - 0.2, 0.0, 0.001);
    gen.box('alu', 0.22, 0.14, 0.003, xg0 + 1.2, yc + 0.1, 0.683, 0.001);
  }

  // ---- engine block, sump, flywheel housing
  {
    const sh = new THREE.Shape();
    [[-0.5, -0.38], [0.5, -0.38], [0.58, -0.1], [0.58, 0.25], [0.483, 0.437], [0.137, 0.637], [0, 0.5], [-0.137, 0.637], [-0.483, 0.437], [-0.58, 0.25], [-0.58, -0.1]]
      .forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: Lb - 0.024, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.012, bevelSegments: 1, steps: 1 });
    g.rotateY(HP);
    eng.geo('engine', g, xr + 0.012, yc, 0);
    // oil pan
    eng.box('engine', Lb, 0.03, 1.06, xr + Lb / 2, yc - 0.385, 0, 0.006);
    eng.rbox('engine', Lb - 0.12, 0.38, 0.88, xr + Lb / 2, yc - 0.58, 0, 0.05, 2);
    for (let x = xr + 0.08; x < xf; x += 0.13) for (const s of [1, -1]) eng.bolt(x, yc - 0.405, s * 0.5, [0, -1, 0], 0.011);
    for (let x = xr + 0.5; x < xf - 0.3; x += 0.52) eng.box('engine', 0.03, 0.34, 0.9, x, yc - 0.58, 0, 0.006);
    eng.cyl('brass', 0.02, 0.05, xf - 0.4, yc - 0.72, 0.46, 'z', 8);
    for (const s of [1, -1]) {
      // crankcase inspection doors
      for (let i = 0; i < n; i++) {
        const x = xr + 0.2 + 0.26 * i + (s < 0 ? 0.05 : 0);
        eng.push(x, yc - 0.1, s * 0.585, 0, 0, 0);
        eng.rbox('engine', 0.2, 0.17, 0.03, 0, 0, 0, 0.012, 1);
        for (const a of [-0.08, 0.08]) for (const b of [-0.065, 0.065]) eng.bolt(a, b, s * 0.018, [0, 0, s], 0.009);
        // detonation sensor and pigtail up to the block loom
        eng.cyl('black', 0.015, 0.034, 0.1, 0.3, s * 0.022, 'z', 8); eng.bolt(0.1, 0.3, s * 0.008, [0, 0, s], 0.019, 'bolt', 0.006);
        eng.cyl('cable', 0.004, 0.05, 0.1, 0.325, s * 0.03, 'y', 5);
        eng.pop();
      }
      eng.tube('cable', [[xr + 0.06, yc + 0.245, s * 0.612], [xf - 0.05, yc + 0.245, s * 0.612]], 0.012, { radial: 6, caps: true });
      for (let x = xr + 0.33; x < xf - 0.1; x += 0.52) { eng.box('bolt', 0.022, 0.04, 0.008, x, yc + 0.245, s * 0.628, 0.002); eng.bolt(x, yc + 0.275, s * 0.606, [0, 0, s], 0.007, 'bolt'); }
      // engine mounts: back plate on the block, gussets, foot on a rubber pad
      const mxs = n > 8 ? [xr + 0.3, xr + Lb / 2, xf - 0.3] : [xr + 0.3, xf - 0.3];
      const gs = new THREE.Shape();
      [[0.585, yc - 0.19], [0.63, yc - 0.19], [0.85, ftop + 0.09], [0.85, ftop + 0.035], [0.64, ftop + 0.035], [0.585, yc - 0.4]].forEach((p, i) => (i ? gs.lineTo(p[0], p[1]) : gs.moveTo(p[0], p[1])));
      gs.closePath();
      const gg = new THREE.ExtrudeGeometry(gs, { depth: 0.022, bevelEnabled: false }); gg.rotateY(-HP);
      eng.push(0, 0, 0, 0, 0, 0, 1, 1, s);
      for (const x of mxs) {
        eng.box('engine', 0.38, 0.25, 0.025, x, yc - 0.295, 0.5975, 0.005);
        for (const a of [-0.15, 0.15]) for (const b of [-0.09, 0.09]) eng.bolt(x + a, yc - 0.295 + b, 0.614, 'z', 0.013);
        for (const dx of [-0.1, 0.122]) eng.geo('engine', gg, x + dx, 0, 0);
        eng.box('engine', 0.38, 0.035, 0.25, x, ftop + 0.0375, 0.745, 0.006);
        eng.box('rubber', 0.36, 0.02, 0.23, x, ftop + 0.01, 0.745, 0.003);
        for (const dx of [-0.15, 0.15]) { eng.bolt(x + dx, ftop + 0.062, 0.78, 'y', 0.019); eng.cyl('bolt', 0.024, 0.004, x + dx, ftop + 0.056, 0.78, 'y', 10); }
      }
      eng.pop();
    }
    // flywheel housing
    eng.lathe('engine', [[0.45, 0], [0.56, 0], [0.74, 0.14, 1], [0.74, 0.38], [0.79, 0.38], [0.79, 0.42], [0.3, 0.42]], xg1 + 0.3, yc, 0, 'x', 32);
    for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; eng.bolt(xr - 0.045, yc + Math.cos(a) * 0.765, Math.sin(a) * 0.765, [-1, 0, 0], 0.014); }
    eng.box('engine', 0.12, 0.1, 0.02, xr - 0.2, yc + 0.3, 0.675, 0.004);
    // coupling guard
    eng.cyl('perfYellow', 0.52, 0.34, xg1 + 0.15, yc, 0, 'x', 28, 0.52, true);
    for (const x of [xg1 + 0.0, xg1 + 0.3]) eng.torus('yellow', 0.52, 0.012, x, yc, 0, 'x', 28, 5);
    eng.cyl('black', 0.3, 0.26, xg1 + 0.15, yc, 0, 'x', 16);
    // starters
    for (const s of [1, -1]) {
      const sy = yc - 0.5, sz = s * 0.56;
      eng.cyl('black', 0.085, 0.36, xr + 0.2, sy, sz, 'x', 14);
      eng.cyl('steel', 0.07, 0.1, xr - 0.02, sy, sz, 'x', 12);
      eng.cyl('black', 0.045, 0.2, xr + 0.22, sy + 0.12, sz + s * 0.03, 'x', 10);
      eng.cyl('copper', 0.012, 0.03, xr + 0.34, sy + 0.12, sz + s * 0.03, 'x', 6);
      eng.tube('cable', [[xr + 0.36, sy + 0.12, sz + s * 0.03], [xr + 0.5, sy + 0.12, sz + s * 0.1], [xr + 0.5, sy - 0.2, sz + s * 0.2]], 0.016, { bend: 0.06 });
    }
  }

  // ---- cylinder banks
  const bankLen = 0.26 * n;
  for (const s of [1, -1]) {
    const x0 = xr + 0.2 + (s < 0 ? 0.05 : 0), xm = x0 + 0.26 * (n - 1) / 2;
    eng.push(0, 0, 0, 0, 0, 0, 1, 1, s); eng.push(0, yc, 0, PI / 6, 0, 0);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.26 * i;
      eng.box('engine', 0.236, 0.21, 0.4, x, 0.725, 0, 0.012);
      eng.rbox('alu', 0.216, 0.115, 0.35, x, 0.887, 0, 0.03, 2);
      eng.box('rubber', 0.224, 0.008, 0.358, x, 0.832, 0, 0.002);
      for (const b of [-0.085, 0.085]) eng.box('alu', 0.17, 0.012, 0.022, x, 0.946, b, 0.004);
      eng.cyl('alu', 0.052, 0.016, x, 0.946, 0, 'y', 12);
      for (const a of [-0.082, 0.082]) for (const b of [-0.145, 0.145]) eng.bolt(x + a, 0.944, b, 'y', 0.01);
      // ignition coil and lead
      eng.cyl('bolt', 0.04, 0.012, x, 0.948, 0, 'y', 10);
      eng.cyl('black', 0.031, 0.1, x, 1.0, 0, 'y', 10);
      eng.box('black', 0.04, 0.035, 0.06, x, 1.03, 0.03, 0.006);
      eng.tube('cable', [[x, 1.035, 0.06], [x, 1.035, 0.14], [x + 0.03, 0.975, 0.215]], 0.007, { bend: 0.03, n: 3 });
      // exhaust port stub (insulated) with flange
      eng.box('castRaw', 0.15, 0.12, 0.02, x, 0.76, -0.208, 0.004);
      eng.tube('blanket', [[x, 0.76, -0.2], [x, 0.80, -0.28], [x, 0.87, -0.34]], 0.052, { bend: 0.04, radial: 8, n: 3 });
      // intake runner
      eng.box('engine', 0.16, 0.14, 0.02, x, 0.735, 0.208, 0.004);
      eng.cyl('engine', 0.056, 0.1, x, 0.73, 0.255, 'z', 10);
      for (const a of [-0.062, 0.062]) for (const b of [-0.052, 0.052]) eng.bolt(x + a, 0.735 + b, 0.222, 'z', 0.008);
      // gas admission valve and jumper
      eng.cyl('black', 0.024, 0.07, x + 0.06, 0.835, 0.335, 'y', 8);
      eng.cyl('brass', 0.012, 0.03, x + 0.06, 0.79, 0.335, 'y', 6);
      eng.tube('steel', [[x + 0.06, 0.865, 0.36], [x + 0.06, 0.865, 0.42]], 0.007, { radial: 5 });
      // water outlet stub
      eng.cyl('engine', 0.018, 0.06, x - 0.07, 0.845, 0.215, 'z', 6);
      // head core plugs
      eng.cyl('steel', 0.022, 0.006, x - 0.06, 0.68, 0.201, 'z', 8);
      // exhaust port thermocouple with sheathed lead
      eng.bolt(x + 0.022, 0.852, -0.252, [0, 1, 0.5], 0.009, 'brass', 0.014);
      eng.tube('stainless', [[x + 0.022, 0.86, -0.248], [x + 0.022, 0.935, -0.215], [x + 0.055, 0.975, -0.2]], 0.0035, { bend: 0.02, n: 2, radial: 4 });
    }
    eng.tube('stainless', [[x0 - 0.1, 0.975, -0.2], [x0 + bankLen - 0.16, 0.975, -0.2]], 0.009, { radial: 6, caps: true });
    for (let i = 0; i < n; i += 2) eng.box('bolt', 0.02, 0.012, 0.03, x0 + 0.26 * i + 0.13, 0.962, -0.192, 0.003);
    // ignition harness rail
    eng.box('black', bankLen + 0.1, 0.045, 0.04, xm, 0.972, 0.225, 0.008);
    for (let i = 0; i < n; i += 2) eng.box('bolt', 0.03, 0.05, 0.05, x0 + 0.26 * i + 0.13, 0.94, 0.2, 0.004);
    // water rail
    eng.tube('engine', [[x0 - 0.12, 0.87, 0.245], [x0 + bankLen - 0.1, 0.87, 0.245], [x0 + bankLen + 0.02, 0.93, 0.1]], 0.03, { bend: 0.08, caps: true });
    // intake manifold log
    eng.lathe('engine', [[0, 0], [0.07, 0, 1], [0.088, 0.03, 1], [0.088, bankLen + 0.06, 1], [0.07, bankLen + 0.09, 1], [0, bankLen + 0.09]], x0 - 0.2, 0.72, 0.385, 'x', 16);
    for (let i = 1; i < n; i += 2) eng.flange('engine', x0 + 0.26 * i + 0.13, 0.72, 0.385, 'x', 0.108, 0.03, 8, 16);
    // gas rail
    eng.tube('steel', [[x0 - 0.3, 0.865, 0.42], [x0 + bankLen - 0.14, 0.865, 0.42]], 0.016, { caps: true });
    for (let i = 0; i < n; i += 3) eng.box('bolt', 0.03, 0.06, 0.03, x0 + 0.26 * i + 0.13, 0.84, 0.43, 0.004);
    // exhaust manifold: blanketed sections with bellows
    for (let j = 0; j < n / 2; j++) {
      const cx = x0 + 0.26 * (2 * j + 0.5);
      eng.lathe('blanket', [[0.07, -0.225], [0.098, -0.21, 1], [0.102, -0.18, 1], [0.102, 0.18, 1], [0.098, 0.21, 1], [0.07, 0.225]], cx, 0.87, -0.34, 'x', 14);
      for (const d of [-0.12, 0.12]) eng.cyl('steel', 0.104, 0.012, cx + d, 0.87, -0.34, 'x', 14, 0.104, true);
      if (j < n / 2 - 1) for (let c = 0; c < 3; c++) eng.torus('stainless', 0.07, 0.012, cx + 0.26 - 0.022 + c * 0.022, 0.87, -0.34, 'x', 12, 5);
    }
    eng.lathe('blanket', [[0, 0], [0.09, 0, 1], [0.1, 0.02, 1], [0.1, 0.06]], x0 + bankLen - 0.065, 0.87, -0.34, [-1, 0, 0], 12);
    eng.pop(); eng.pop();

    // ---- per side: turbo, charge air, aftercooler, air cleaner (world frame, mirrored)
    eng.push(0, 0, 0, 0, 0, 0, 1, 1, s); hot.push(0, 0, 0, 0, 0, 0, 1, 1, s);
    const mz = 0.14, my = yc + 0.923;
    eng.tube('blanket', [[x0 - 0.1, my, mz], [xr - 0.1, my + 0.04, mz + 0.03], [xt + 0.14, yt - 0.17, 0.21], [xt + 0.0, yt - 0.17, 0.21]], 0.085, { bend: 0.12, radial: 12 });
    // turbine housing (hot), centre section, compressor
    hot.lathe('castRaw', [[0.075, -0.085], [0.17, -0.085, 1], [0.215, -0.045, 1], [0.215, 0.045, 1], [0.17, 0.085, 1], [0.075, 0.085]], xt, yt, 0.21, 'z', 22);
    hot.cyl('castRaw', 0.1, 0.16, xt + 0.03, yt - 0.165, 0.21, 'x', 12);
    hot.flange('castRaw', xt + 0.12, yt - 0.165, 0.21, 'x', 0.125, 0.025, 0, 12);
    hot.cyl('castRaw', 0.095, 0.1, xt, yt, 0.08, 'z', 14);
    hot.flange('castRaw', xt, yt, 0.035, 'z', 0.125, 0.02, 0, 14);
    eng.cyl('castRaw', 0.075, 0.13, xt, yt, 0.36, 'z', 14);
    eng.flange('bolt', xt, yt, 0.3, 'z', 0.13, 0.016, 8, 16);
    eng.tube('steel', [[xt, yt + 0.07, 0.36], [xt, yt + 0.16, 0.36], [xt + 0.3, yt + 0.16, 0.36], [xt + 0.36, yc + 0.7, 0.5]], 0.008, { bend: 0.04 });
    eng.tube('steel', [[xt, yt - 0.07, 0.36], [xt, yt - 0.3, 0.36], [xt + 0.2, yc + 0.72, 0.42]], 0.014, { bend: 0.05 });
    eng.lathe('alu', [[0.08, -0.06], [0.16, -0.065, 1], [0.215, -0.03, 1], [0.215, 0.03, 1], [0.17, 0.062, 1], [0.1, 0.07], [0.09, 0.13], [0.07, 0.13]], xt, yt, 0.49, 'z', 22);
    eng.flange('bolt', xt, yt, 0.425, 'z', 0.15, 0.014, 10, 18);
    // wastegate actuator
    eng.cyl('steel', 0.05, 0.07, xt - 0.22, yt + 0.1, 0.32, 'x', 12);
    eng.tube('steel', [[xt - 0.18, yt + 0.1, 0.32], [xt - 0.05, yt + 0.16, 0.24]], 0.006);
    // compressor discharge to the aftercooler
    eng.cyl('alu', 0.072, 0.14, xt + 0.14, yt - 0.14, 0.49, [0.5, -1, 0], 12);
    eng.tube('alu', [[xt + 0.17, yt - 0.2, 0.49], [xt + 0.2, yt - 0.42, 0.52], [xt + 0.08, yc + 0.72, 0.7], [xt + 0.08, yc + 0.6, 0.7]], 0.07, { bend: 0.14, radial: 12 });
    eng.tube('silicone', [[xt + 0.196, yt - 0.33, 0.512], [xt + 0.186, yt - 0.44, 0.535]], 0.079, { radial: 12, bend: 0 });
    for (const [dx, dy, dz] of [[0.197, -0.34, 0.512], [0.188, -0.43, 0.532]]) eng.torus('steel', 0.081, 0.006, xt + dx, yt + dy, dz, [0.08, -1, 0.2], 14, 4);
    // aftercooler
    const ax = xr - 0.3, ay = yc + 0.46, az = 0.72;
    eng.rbox('alu', 0.46, 0.32, 0.3, ax, ay, az, 0.025, 2);
    eng.box('alu', 0.5, 0.03, 0.34, ax, ay + 0.165, az, 0.006);
    for (const a of [-0.22, -0.07, 0.07, 0.22]) for (const b of [-0.15, 0.15]) eng.bolt(ax + a, ay + 0.184, az + b, 'y', 0.009);
    for (let i = 0; i < 5; i++) eng.box('alu', 0.012, 0.26, 0.012, ax - 0.16 + i * 0.08, ay - 0.01, az + 0.152, 0.002);
    eng.tube('engine', [[ax - 0.1, ay - 0.16, az], [ax - 0.1, ay - 0.3, az + 0.02], [ax + 0.5, yc - 0.52, 0.66]], 0.03, { bend: 0.08 });
    eng.tube('engine', [[ax - 0.24, ay, az], [ax - 0.36, ay, az], [ax - 0.36, ay - 0.4, az - 0.05]], 0.03, { bend: 0.07, caps: true });
    // throttle body between aftercooler and intake log
    const lz = 0.72 * 0.5 + 0.385 * 0.866, ly = yc + 0.72 * 0.866 - 0.385 * 0.5;
    eng.cyl('alu', 0.09, 0.2, xr + 0.0, ly, lz, 'x', 14);
    eng.flange('bolt', xr - 0.06, ly, lz, 'x', 0.11, 0.02, 6, 14);
    eng.box('black', 0.12, 0.12, 0.09, xr - 0.0, ly + 0.14, lz, 0.01);
    eng.cyl('steel', 0.012, 0.1, xr, ly + 0.07, lz, 'y', 6);
    // compressor inlet: hump hose, gas mixer, air cleaner
    eng.cyl('silicone', 0.094, 0.09, xt, yt, 0.665, 'z', 14);
    for (const z of [0.632, 0.698]) eng.torus('steel', 0.096, 0.006, xt, yt, z, 'z', 14, 4);
    eng.cyl('alu', 0.1, 0.16, xt, yt, 0.79, 'z', 14);
    eng.flange('bolt', xt, yt, 0.715, 'z', 0.125, 0.014, 8, 16);
    eng.cyl('alu', 0.04, 0.1, xt, yt - 0.12, 0.79, 'y', 10);
    eng.box('black', 0.09, 0.07, 0.09, xt - 0.12, yt + 0.02, 0.79, 0.008);
    eng.lathe('black', [[0.1, 0], [0.205, 0.0], [0.21, 0.03, 1], [0.21, 0.05], [0.1, 0.05]], xt, yt, 0.87, 'z', 20);
    eng.cyl('pleat', 0.195, 0.3, xt, yt, 1.07, 'z', 22, 0.195, true);
    eng.lathe('black', [[0.205, 0], [0.21, 0.02, 1], [0.2, 0.05, 1], [0.05, 0.06], [0, 0.06]], xt, yt, 1.22, 'z', 20);
    eng.cyl('bolt', 0.02, 0.03, xt, yt, 1.29, 'z', 6);
    eng.pop(); hot.pop();
  }
  // turbo pedestal and exhaust collector
  eng.box('engine', 0.3, 0.2, 0.86, xt, yc + 0.84, 0, 0.012);
  eng.box('engine', 0.06, yt - 0.26 - (yc + 0.9), 0.5, xt - 0.1, (yt - 0.26 + yc + 0.9) / 2, 0, 0.008);
  eng.box('engine', 0.34, 0.03, 0.62, xt, yt - 0.26, 0, 0.006);
  hot.lathe('castRaw', [[0.1, -0.04], [0.14, 0.0, 1], [0.17, 0.12, 1], [0.2, 0.2], [0.24, 0.2], [0.24, 0.225], [0.17, 0.225]], xt, yt + 0.02, 0, 'y', 18);
  hot.cyl('castRaw', 0.1, 0.16, xt, yt, 0, 'z', 14);
  A.riser = [xt, yt + 0.245];

  // ---- front end: gear cover, damper, pumps, thermostat housing
  {
    eng.rbox('engine', 0.14, 1.2, 1.26, xf + 0.07, yc + 0.07, 0, 0.04, 2);
    for (let i = 0; i < 18; i++) { const a = i / 18 * TAU; eng.bolt(xf + 0.142, yc + 0.07 + Math.sin(a) * 0.54, Math.cos(a) * 0.57, 'x', 0.011); }
    eng.cyl('engine', 0.2, 0.06, xf + 0.17, yc + 0.42, 0.3, 'x', 16); eng.cyl('engine', 0.2, 0.06, xf + 0.17, yc + 0.42, -0.3, 'x', 16);
    eng.cyl('engine', 0.12, 0.08, xf + 0.18, yc, 0, 'x', 14);
    A.damper = new THREE.Vector3(xf + 0.27, yc, 0);
    // damper guard hoop
    eng.torus('yellow', 0.42, 0.012, xf + 0.3, yc, 0, 'x', 28, 5, PI);
    for (const s of [1, -1]) eng.box('yellow', 0.16, 0.03, 0.02, xf + 0.23, yc, s * 0.42, 0.004);
    for (const s of [1, -1]) {
      // water pumps: volute, inlet, belt-free gear drive housing
      const pz = s * 0.5, pyy = yc - 0.38;
      eng.lathe('engine', [[0.06, 0], [0.16, 0, 1], [0.2, 0.04, 1], [0.2, 0.1, 1], [0.16, 0.14, 1], [0.1, 0.15], [0.1, 0.2], [0.13, 0.2], [0.13, 0.22], [0.07, 0.22]], xf + 0.14, pyy, pz, 'x', 20);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; eng.bolt(xf + 0.365, pyy + Math.cos(a) * 0.112, pz + Math.sin(a) * 0.112, 'x', 0.009); }
      eng.tube('engine', [[xf + 0.22, pyy + 0.14, pz], [xf + 0.22, pyy + 0.42, pz + s * 0.08], [xf + 0.1, pyy + 0.5, pz + s * 0.08]], 0.055, { bend: 0.1 });
    }
    // thermostat housing and crossovers
    eng.rbox('engine', 0.32, 0.26, 0.5, xf - 0.02, yc + 0.78, 0, 0.04, 2);
    eng.box('engine', 0.2, 0.03, 0.4, xf - 0.02, yc + 0.92, 0, 0.006);
    for (const a of [-0.07, 0.07]) for (const b of [-0.16, 0.16]) eng.bolt(xf - 0.02 + a, yc + 0.94, b, 'y', 0.01);
    eng.cyl('engine', 0.068, 0.12, xf + 0.19, yc + 0.8, -0.12, 'x', 12);
    eng.flange('bolt', xf + 0.25, yc + 0.8, -0.12, 'x', 0.1, 0.02, 6, 14);
    A.htOut = [xf + 0.26, yc + 0.8, -0.12]; A.htIn = [xf + 0.36, yc - 0.38, -0.5]; A.ltIn = [xf + 0.36, yc - 0.38, 0.5];
    // lifting eyes
    for (const x of [xr + 0.25, xf - 0.25]) { eng.box('engine', 0.03, 0.16, 0.12, x, yc + 0.62, 0, 0.006); eng.torus('engine', 0.05, 0.016, x, yc + 0.74, 0, 'x', 12, 6); }
  }

  // ---- service side accessories: oil filters, ECM, dipstick; far side: oil cooler, breather
  {
    const fx = xf - 0.75, fz = 0.76;
    eng.rbox('engine', 0.66, 0.075, 0.17, fx, yc + 0.012, fz, 0.02, 1);
    eng.box('engine', 0.24, 0.07, 0.14, fx, yc + 0.012, 0.63, 0.008);
    for (let i = 0; i < 4; i++) eng.bolt(fx - 0.24 + i * 0.16, yc + 0.054, fz, 'y', 0.014);
    for (let i = 0; i < 4; i++) {
      const x = fx - 0.24 + i * 0.16;
      eng.lathe('filterWhite', [[0, -0.33], [0.05, -0.33, 1], [0.072, -0.31, 1], [0.072, -0.02], [0.066, 0]], x, yc - 0.03, fz, 'y', 14);
      eng.cyl('black', 0.074, 0.03, x, yc - 0.3, fz, 'y', 14, 0.074, true);
      eng.cyl('bolt', 0.02, 0.016, x, yc - 0.368, fz, 'y', 6);
    }
    eng.tube('engine', [[fx + 0.33, yc + 0.02, fz], [fx + 0.48, yc + 0.02, fz], [fx + 0.48, yc - 0.2, 0.6]], 0.03, { bend: 0.07 });
    // ECM on brackets with harness
    const ex = xr + Lb * 0.42, ey = yc + 0.12;
    eng.box('black', 0.42, 0.3, 0.08, ex, ey, 0.67, 0.012);
    for (let i = 0; i < 6; i++) eng.box('black', 0.42, 0.012, 0.012, ex, ey - 0.12 + i * 0.048, 0.714, 0.003);
    for (const dx of [-0.12, 0.12]) { eng.box('bolt', 0.09, 0.05, 0.05, ex + dx, ey - 0.17, 0.67, 0.006); }
    eng.tube('cable', [[ex - 0.12, ey - 0.2, 0.67], [ex - 0.12, ey - 0.3, 0.66], [xr + 0.3, ey - 0.3, 0.64], [xr + 0.2, yc + 0.3, 0.62]], 0.018, { bend: 0.06 });
    eng.tube('cable', [[ex + 0.12, ey - 0.2, 0.67], [ex + 0.12, ey - 0.3, 0.66], [xf - 0.2, ey - 0.3, 0.64], [xf - 0.1, yc + 0.5, 0.62]], 0.018, { bend: 0.06 });
    for (let x = xr + 0.5; x < xf - 0.3; x += 0.45) eng.box('bolt', 0.03, 0.05, 0.03, x, ey - 0.3, 0.62, 0.004);
    // dipstick and oil fill
    eng.tube('steel', [[xr + Lb * 0.7, yc - 0.45, 0.45], [xr + Lb * 0.7, yc - 0.25, 0.64], [xr + Lb * 0.7, yc + 0.32, 0.66]], 0.009, { bend: 0.1 });
    eng.torus('yellow', 0.025, 0.006, xr + Lb * 0.7, yc + 0.345, 0.66, 'x', 10, 5);
    eng.cyl('engine', 0.045, 0.2, xr + Lb * 0.78, yc - 0.2, 0.63, [0, 1, 0.6], 10);
    eng.cyl('yellow', 0.055, 0.035, xr + Lb * 0.78, yc - 0.1, 0.69, [0, 1, 0.6], 12);
    // oil cooler (shell and tube) on the far side
    const ox = xr + Lb * 0.55;
    eng.lathe('engine', [[0, -0.7], [0.09, -0.7, 1], [0.115, -0.67, 1], [0.115, -0.56], [0.14, -0.56], [0.14, -0.53], [0.11, -0.53], [0.11, 0.53], [0.14, 0.53], [0.14, 0.56], [0.115, 0.56], [0.115, 0.67, 1], [0.09, 0.7, 1], [0, 0.7]], ox, yc - 0.08, -0.74, 'x', 16);
    for (const dx of [-0.4, 0.4]) { eng.box('engine', 0.08, 0.1, 0.12, ox + dx, yc - 0.08, -0.63, 0.008); eng.cyl('engine', 0.035, 0.14, ox + dx, yc - 0.24, -0.74, 'y', 8); }
    eng.tube('engine', [[ox + 0.62, yc - 0.08, -0.86], [ox + 0.62, yc - 0.08, -0.95], [xf + 0.05, yc - 0.3, -0.8], [xf + 0.2, yc - 0.34, -0.66]], 0.035, { bend: 0.08 });
    // crankcase breather
    const bx = xr + 0.75;
    eng.lathe('black', [[0, 0], [0.08, 0, 1], [0.09, 0.02, 1], [0.09, 0.26], [0.07, 0.3, 1], [0, 0.31]], bx, yc + 0.52, -0.9, 'y', 14);
    eng.box('bolt', 0.05, 0.05, 0.16, bx, yc + 0.62, -0.8, 0.006);
    eng.tube('rubber', [[bx, yc + 0.83, -0.9], [bx, yc + 0.98, -0.9], [bx + 0.2, yc + 1.02, -0.5], [bx + 0.2, yc + 0.95, -0.42]], 0.025, { bend: 0.08 });
    eng.tube('rubber', [[bx, yc + 0.52, -0.9], [bx, yc + 0.1, -0.9], [bx, yc - 0.5, -0.86]], 0.02, { bend: 0.08 });
    // far side sensor junction box and conduit
    eng.box('paintGrey', 0.3, 0.24, 0.1, xr + Lb * 0.25, yc + 0.1, -0.67, 0.01);
    eng.tube('cable', [[xr + Lb * 0.25, yc + 0.22, -0.67], [xr + Lb * 0.25, yc + 0.4, -0.7], [xr + Lb * 0.6, yc + 0.34, -0.72]], 0.014, { bend: 0.06 });
  }


  // ---- instruments, prelube pump, sensors, drains, earthing
  {
    // engine mounted gauge panel
    const px = xf - 0.15, py = yc + 0.13, pz = 0.655;
    eng.box('paintGrey', 0.27, 0.2, 0.05, px, py, pz, 0.008);
    for (const dx of [-0.1, 0.1]) eng.box('bolt', 0.03, 0.03, 0.05, px + dx, py + 0.06, pz - 0.04, 0.004);
    for (let i = 0; i < 3; i++) {
      const gx = px - 0.085 + i * 0.085;
      eng.cyl('black', 0.036, 0.02, gx, py + 0.035, pz + 0.032, 'z', 14);
      eng.cyl('gaugeFace', 0.03, 0.004, gx, py + 0.035, pz + 0.042, 'z', 12);
      eng.push(gx, py + 0.035, pz + 0.045, 0, 0, 0.7 - i * 0.9); eng.box('black', 0.003, 0.024, 0.002, 0, 0.01, 0, 0.0005); eng.pop();
      eng.tube('copper', [[gx, py - 0.1, pz - 0.01], [gx, py - 0.2, pz - 0.01], [gx - 0.05 - i * 0.03, py - 0.3, pz - 0.06]], 0.003, { bend: 0.03, n: 2, radial: 4 });
      eng.bolt(gx, py - 0.105, pz - 0.01, [0, -1, 0], 0.007, 'brass', 0.012);
    }
    lab(eng, 11, 0.13, 0.065, px, py - 0.055, pz + 0.0262);
    // prelube pump on the rail: motor, gear pump, braided suction and discharge
    const qx = xr + 0.86, qy = ftop + 0.1, qz = 0.76;
    eng.box('frame', 0.44, 0.012, 0.2, qx + 0.04, ftop + 0.006, qz, 0.003);
    eng.cyl('paintGrey', 0.074, 0.22, qx - 0.04, qy, qz, 'x', 14);
    eng.cyl('black', 0.078, 0.03, qx - 0.165, qy, qz, 'x', 14);
    for (let i = 0; i < 6; i++) { const a = i / 6 * PI - 0.2; eng.box('paintGrey', 0.2, 0.006, 0.012, qx - 0.04, qy + Math.sin(a) * 0.077, qz + Math.cos(a) * 0.077, 0.002); }
    eng.box('paintGrey', 0.07, 0.05, 0.07, qx - 0.04, qy + 0.09, qz, 0.006);
    eng.rbox('alu', 0.12, 0.13, 0.13, qx + 0.14, qy, qz, 0.015, 1);
    for (const a of [-0.045, 0.045]) for (const b of [-0.045, 0.045]) eng.bolt(qx + 0.202, qy + a, qz + b, 'x', 0.007, 'bolt');
    eng.tube('braid', [[qx + 0.14, qy + 0.07, qz], [qx + 0.14, qy + 0.2, qz], [qx + 0.3, qy + 0.42, qz - 0.1], [qx + 0.3, yc - 0.03, 0.66]], 0.016, { bend: 0.07, n: 4, radial: 6 });
    eng.tube('braid', [[qx + 0.14, qy, qz - 0.07], [qx + 0.14, qy, qz - 0.2], [qx + 0.3, qy - 0.0, 0.47]], 0.019, { bend: 0.06, n: 3, radial: 6 });
    eng.bolt(qx + 0.14, qy + 0.075, qz, 'y', 0.02, 'brass', 0.02); eng.bolt(qx + 0.14, qy, qz - 0.075, [0, 0, -1], 0.022, 'brass', 0.02);
    eng.tube('cable', [[qx - 0.04, qy + 0.115, qz], [qx - 0.04, qy + 0.2, qz], [qx - 0.3, qy + 0.3, 0.62], [qx - 0.3, yc + 0.24, 0.615]], 0.009, { bend: 0.05, n: 3, radial: 5 });
    // sump drain ball valve with capped outlet
    const dx0 = xf - 0.4, dy0 = yc - 0.72;
    eng.box('brass', 0.045, 0.045, 0.06, dx0, dy0, 0.515, 0.006);
    eng.box('yellow', 0.012, 0.012, 0.1, dx0, dy0 + 0.035, 0.535, 0.003);
    eng.bolt(dx0, dy0, 0.552, 'z', 0.018, 'brass', 0.02);
    // coolant temperature senders on the thermostat housing and a vent line to the roof
    for (const dz of [-0.09, 0.09]) {
      eng.bolt(xf - 0.02, yc + 0.948, dz, 'y', 0.014, 'brass', 0.02);
      eng.cyl('black', 0.012, 0.04, xf - 0.02, yc + 0.975, dz, 'y', 8);
      eng.tube('cable', [[xf - 0.02, yc + 0.995, dz], [xf - 0.02, yc + 1.04, dz], [xf - 0.16, yc + 1.03, dz + 0.1], [xf - 0.3, yc + 1.0, 0.2]], 0.005, { bend: 0.03, n: 2, radial: 4 });
    }
    eng.tube('steel', [[xf - 0.1, yc + 0.935, 0], [xf - 0.1, yc + 1.12, 0], [xf + 0.3, yc + 1.2, -0.3]], 0.007, { bend: 0.05, n: 3, radial: 5 });
    // speed pickup on the flywheel housing
    eng.cyl('bolt', 0.011, 0.07, xr - 0.2, yc + 0.36, 0.69, [0, 0.5, 1], 8);
    eng.cyl('black', 0.014, 0.03, xr - 0.2, yc + 0.385, 0.74, [0, 0.5, 1], 8);
    eng.tube('cable', [[xr - 0.2, yc + 0.39, 0.75], [xr - 0.2, yc + 0.42, 0.8], [xr + 0.0, yc + 0.3, 0.7], [xr + 0.07, yc + 0.245, 0.615]], 0.005, { bend: 0.04, n: 3, radial: 4 });
    // earth strap from the alternator foot to the frame, and a bonded lug
    gen.tube('cableGY', [[xg0 + 0.5, ftop + 0.08, 0.79], [xg0 + 0.42, ftop + 0.02, 0.86], [xg0 + 0.42, ftop - 0.12, 0.86]], 0.009, { bend: 0.04, n: 3, radial: 5 });
    gen.bolt(xg0 + 0.5, ftop + 0.075, 0.79, 'y', 0.014, 'copper'); gen.bolt(xg0 + 0.42, ftop - 0.13, 0.848, 'z', 0.014, 'copper');
    // bearing RTD junction box with liquid tight flex up to the terminal box
    gen.box('paintGrey', 0.16, 0.12, 0.07, xg0 + 1.72, yc + 0.34, 0.64, 0.008);
    for (const a of [-0.065, 0.065]) for (const b of [-0.045, 0.045]) gen.bolt(xg0 + 1.72 + a, yc + 0.34 + b, 0.677, 'z', 0.006, 'bolt');
    gen.tube('cable', [[xg0 + 1.72, yc + 0.4, 0.64], [xg0 + 1.72, yc + 0.56, 0.6], [xg0 + 1.6, yc + 0.66, 0.5]], 0.012, { bend: 0.06, n: 3, radial: 6 });
    gen.tube('cable', [[xg0 + 1.8, yc + 0.34, 0.64], [xg0 + 2.0, yc + 0.34, 0.66], [xg0 + 2.12, yc + 0.2, 0.68]], 0.006, { bend: 0.04, n: 2, radial: 4 });
    // grease line to the drive end bearing
    gen.tube('copper', [[xg0 + 2.2, yc + 0.3, 0.6], [xg0 + 2.2, yc + 0.55, 0.42], [xg0 + 2.12, yc + 0.66, 0.2]], 0.004, { bend: 0.04, n: 2, radial: 4 });
    gen.bolt(xg0 + 2.2, yc + 0.29, 0.605, [0, -0.5, 1], 0.008, 'brass', 0.014);
  }

  // ---- labels and plates
  {
    const big = sp.cyl > 16, tx = xg0 + 1.1, ty = yc + 0.95;
    lab(gen, big ? 0 : 1, 0.2, 0.1, xg0 + 1.2, yc + 0.1, 0.6855);
    lab(gen, 6, 0.24, 0.12, tx - 0.27, ty + 0.06, 0.5995);
    atlasArc(gen, 'label', 4, 4, 5, 0.5235, 0.26, xg1 + 0.15, yc, 0, 'x', -0.75, 0.25, true);
    eng.box('alu', 0.21, 0.11, 0.003, xr + 0.62, yc + 0.075, 0.5935, 0.001);
    lab(eng, big ? 2 : 3, 0.2, 0.1, xr + 0.62, yc + 0.075, 0.5958);
    lab(eng, 7, 0.14, 0.07, xr + Lb * 0.78 + 0.16, yc + 0.07, 0.5935);
    lab(eng, 4, 0.2, 0.1, xt, yc + 0.84, 0.4315); lab(eng, 4, 0.2, 0.1, xt, yc + 0.84, -0.4315, PI);
    lab(eng, 14, 0.15, 0.075, xf - 0.02, yc + 0.78, 0.2515);
    lab(eng, 15, 0.16, 0.08, xf + 0.1415, yc + 0.57, 0, HP);
    lab(eng, 5, 0.18, 0.09, xf + 0.1415, yc - 0.42, 0, HP);
    const fx = xf - 0.75;
    for (let i = 0; i < 4; i++) atlasArc(eng, 'label', 4, 4, 8, 0.0728, 0.15, fx - 0.24 + i * 0.16, yc - 0.17, 0.76, 'y', 0.25 * (i - 1.2), 2.4, false);
    const cyg = H - 0.42;
    for (const x of [xt + 1.4, xf + 0.2]) atlasArc(room, 'label', 4, 4, 9, 0.0458, 0.32, x, cyg, o.gasZ, 'x', 0.55, 2.2, true);
    atlasArc(room, 'label', 4, 4, 10, 0.0608, 0.11, o.pipeX[0], hs + 1.72, -1.31, 'y', 0.5, 2.3, false);
    lab(bfr, 12, 0.14, 0.07, fx0 + 1.0, fy + 0.19, 0.7335);
    for (const x of [fx0 + 0.72, fx1 - 0.72]) lab(bfr, 13, 0.16, 0.08, x, fy + 0.19, 0.7335);
  }

  // ---- damper (animated, own geometry)
  const dk = new Kit(IALIAS);
  dk.lathe('black', [[0.1, 0], [0.34, 0], [0.365, 0.02, 1], [0.365, 0.1, 1], [0.34, 0.12], [0.2, 0.12], [0.18, 0.09], [0.1, 0.09]], -0.06, 0, 0, 'x', 32);
  dk.cyl('steel', 0.1, 0.14, 0.01, 0, 0, 'x', 16);
  for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; dk.bolt(0.085, Math.cos(a) * 0.065, Math.sin(a) * 0.065, 'x', 0.012, 'steel'); }
  dk.box('gaugeFace', 0.004, 0.11, 0.022, 0.061, 0.27, 0, 0.001);
  dk.box('gaugeFace', 0.03, 0.004, 0.02, 0.0, 0.3655, 0, 0.001);
  dk.box('steel', 0.004, 0.05, 0.05, 0.061, -0.25, 0.0, 0.001);

  // ---- room: exhaust riser, coolant pipes, gas pipe, vent fan, trays, lights, batteries
  {
    const [rx, ry] = A.riser;
    for (let i = 0; i < 4; i++) room.torus('stainless', 0.2, 0.02, rx, ry + 0.05 + i * 0.04, 0, 'y', 18, 6);
    room.cyl('stainless', 0.18, 0.2, rx, ry + 0.1, 0, 'y', 14);
    room.flange('bolt', rx, ry + 0.22, 0, 'y', 0.27, 0.02, 10, 18);
    room.cyl('blanket', 0.235, H - 0.02 - ry - 0.23, rx, (H - 0.02 + ry + 0.23) / 2, 0, 'y', 18, 0.235, true);
    // coolant: HT supply, LT, HT return
    const wz = -1.31, top = H - 0.02;
    room.tube('pipe', [A.htOut, [o.pipeX[0], A.htOut[1], A.htOut[2]], [o.pipeX[0], A.htOut[1], wz], [o.pipeX[0], top, wz]], 0.06, { bend: 0.13 });
    room.tube('pipe', [A.htIn, [o.pipeX[2], A.htIn[1], A.htIn[2]], [o.pipeX[2], A.htIn[1], wz], [o.pipeX[2], top, wz]], 0.06, { bend: 0.13 });
    room.tube('pipe', [A.ltIn, [o.pipeX[1], A.ltIn[1], A.ltIn[2]], [o.pipeX[1], A.ltIn[1] - 0.22, 0.2], [o.pipeX[1], A.ltIn[1] - 0.22, wz], [o.pipeX[1], top, wz]], 0.042, { bend: 0.1 });
    for (const [p, r] of [[A.htOut, 0.066], [A.htIn, 0.066], [A.ltIn, 0.048]]) {
      room.cyl('silicone', r, 0.14, p[0] + 0.1, p[1], p[2], 'x', 12);
      for (const dx of [0.05, 0.15]) room.torus('steel', r + 0.002, 0.005, p[0] + dx, p[1], p[2], 'x', 12, 4);
    }
    for (const x of [o.pipeX[0], o.pipeX[2]]) {
      room.flange('bolt', x, hs + 2.0, wz, 'y', 0.1, 0.03, 6, 14);
      room.box('galv', 0.04, 0.04, 0.12, x, hs + 1.4, wz - 0.05, 0.004); room.torus('bolt', 0.065, 0.006, x, hs + 1.4, wz, 'y', 12, 4);
    }
    // butterfly valve on the return
    room.cyl('paintGrey', 0.085, 0.07, o.pipeX[2], hs + 1.1, wz, 'y', 12); room.box('black', 0.03, 0.02, 0.24, o.pipeX[2], hs + 1.1, wz + 0.16, 0.004);
    // gas: wall entry, up and along the ceiling, drops with flex to both mixers
    const gy = o.gasY, gz = o.gasZ, cy = H - 0.42, mxz = 0.79;
    room.tube('yellow', [[xb - 0.02, gy, gz], [xb - 0.45, gy, gz], [xb - 0.45, cy, gz], [xt + 0.25, cy, gz], [xt + 0.25, cy, -mxz], [xt + 0.25, yt + 0.12, -mxz]], 0.045, { bend: 0.1 });
    room.tube('yellow', [[xt + 0.25, cy, mxz], [xt + 0.25, yt + 0.12, mxz]], 0.045, { caps: true });
    for (const s of [1, -1]) {
      room.tube('braid', [[xt + 0.25, yt + 0.13, s * mxz], [xt + 0.25, yt - 0.02, s * mxz], [xt + 0.2, yt - 0.26, s * (mxz + 0.04)], [xt + 0.04, yt - 0.26, s * mxz], [xt, yt - 0.16, s * mxz]], 0.03, { bend: 0.09, n: 5 });
      room.cyl('stainless', 0.036, 0.04, xt + 0.25, yt + 0.1, s * mxz, 'y', 8);
    }
    // fuel metering valve on the ceiling run
    const vx = (xt + xf) / 2;
    room.rbox('alu', 0.24, 0.18, 0.18, vx, cy, gz, 0.02, 2);
    room.box('black', 0.14, 0.16, 0.14, vx, cy - 0.17, gz, 0.012);
    for (const dx of [-0.14, 0.14]) room.flange('bolt', vx + dx, cy, gz, 'x', 0.085, 0.02, 6, 14);
    for (let x = xt + 0.8; x < xb - 0.6; x += 1.5) { room.box('galv', 0.04, H - 0.2 - cy, 0.04, x, (H - 0.2 + cy) / 2, gz + 0.07, 0.004); room.torus('bolt', 0.05, 0.006, x, cy, gz, 'x', 10, 4); }
    room.box('galv', 0.04, 0.5, 0.04, xb - 0.5, gy + 0.6, gz + 0.07, 0.004);
    // ventilation fan in the bulkhead
    const vy = hs + 1.75;
    room.lathe('paintGrey', [[0.56, -0.1], [0.62, -0.1], [0.62, 0.1], [0.56, 0.1], [0.555, 0.0, 1], [0.56, -0.1]], o.xbh, vy, 0, 'x', 28);
    room.cyl('paintGrey', 0.13, 0.3, o.xbh + 0.1, vy, 0, 'x', 14);
    for (let a = 0; a < 4; a++) { room.push(o.xbh + 0.1, vy, 0, a * HP + 0.4, 0, 0); room.box('paintGrey', 0.03, 0.03, 0.46, 0, 0, 0.34, 0.004); room.pop(); }
    room.geoR('guard', new THREE.CircleGeometry(0.6, 28), o.xbh - 0.11, vy, 0, 0, -HP, 0);
    A.ventFan = new THREE.Vector3(o.xbh - 0.04, vy, 0);
    // discharge attenuator splitters
    for (const z of [-0.9, -0.3, 0.3, 0.9]) room.box('lining', xb - o.xbh - 0.75, 1.5, 0.16, (xb + o.xbh) / 2 + 0.12, hs + 1.72, z, 0.02);
    // overhead cable tray from the alternator terminal box to the control room
    const ty = H - 0.52, tz = -1.05, tx0 = xa + 0.5, tx1 = xg0 + 1.6;
    for (const dz of [-0.15, 0.15]) room.box('galv', tx1 - tx0, 0.08, 0.012, (tx0 + tx1) / 2, ty + 0.04, tz + dz, 0.002);
    for (let x = tx0 + 0.1; x < tx1; x += 0.3) room.box('galv', 0.03, 0.014, 0.3, x, ty + 0.01, tz, 0.002);
    for (let x = tx0 + 0.4; x < tx1; x += 1.2) for (const dz of [-0.16, 0.16]) room.cyl('bolt', 0.006, H - 0.2 - ty, x, (H - 0.2 + ty) / 2, tz + dz, 'y', 5);
    A.cables.forEach((c, i) => {
      const zz = tz - 0.1 + (i % 3) * 0.08 + Math.floor(i / 3) * 0.03, yy = ty + 0.06 + Math.floor(i / 3) * 0.07;
      room.tube('cable', [c, [c[0], c[1], zz], [c[0], yy, zz], [xa + 0.9 + i * 0.05, yy, zz], [xa + 0.9 + i * 0.05, hs + 2.2, zz]], 0.034, { bend: 0.14, radial: 8 });
    });
    // second tray with control wiring along the service side ceiling
    const t2 = 1.12;
    for (const dz of [-0.08, 0.08]) room.box('galv', o.xbh - xa - 2.0, 0.05, 0.01, (o.xbh + xa + 2.0) / 2 - 0.1, ty + 0.2, t2 + dz, 0.002);
    for (let x = xa + 2.0; x < o.xbh - 0.3; x += 0.3) room.box('galv', 0.025, 0.012, 0.16, x, ty + 0.18, t2, 0.002);
    for (const dz of [-0.03, 0.02]) room.tube('cable', [[xa + 1.9, ty + 0.21, t2 + dz], [o.xbh - 0.3, ty + 0.21, t2 + dz]], 0.014, { radial: 5 });
    // starting batteries and charger
    const bx = xg1 - 0.1, bz = -1.1;
    room.box('frame', 1.2, 0.04, 0.34, bx, fl + 0.24, bz, 0.006);
    for (const dx of [-0.55, 0.55]) room.box('frame', 0.04, 0.24, 0.34, bx + dx, fl + 0.12, bz, 0.006);
    for (let i = 0; i < 4; i++) {
      const x = bx - 0.42 + i * 0.28;
      room.rbox('black', 0.25, 0.22, 0.3, x, fl + 0.37, bz, 0.015, 1);
      room.box('paintGrey', 0.25, 0.02, 0.3, x, fl + 0.485, bz, 0.006);
      room.cyl('bolt', 0.012, 0.03, x - 0.08, fl + 0.505, bz + 0.08, 'y', 6); room.cyl('bolt', 0.012, 0.03, x + 0.08, fl + 0.505, bz + 0.08, 'y', 6);
      if (i < 3) room.tube('cable', [[x + 0.08, fl + 0.52, bz + 0.08], [x + 0.14, fl + 0.56, bz + 0.08], [x + 0.2, fl + 0.52, bz + 0.08]], 0.011, { bend: 0.03, n: 3 });
    }
    room.tube('cable', [[bx + 0.5, fl + 0.52, bz + 0.08], [bx + 0.5, fl + 0.6, bz + 0.3], [xr + 0.5, fl + 0.3, -0.9], [xr + 0.5, yc - 0.7, -0.76]], 0.016, { bend: 0.1 });
    room.box('paintGrey', 0.4, 0.5, 0.16, bx - 0.2, hs + 1.5, -1.3, 0.01);
    room.cyl('lampG', 0.012, 0.01, bx - 0.3, hs + 1.65, -1.216, 'z', 8);
    // fire extinguisher by door 2
    room.lathe('estop', [[0, 0], [0.07, 0, 1], [0.075, 0.02, 1], [0.075, 0.38, 1], [0.04, 0.45, 1], [0.025, 0.47]], o.door2[1] + 0.25, fl + 0.3, 1.25, 'y', 14);
    room.box('black', 0.03, 0.05, 0.1, o.door2[1] + 0.25, fl + 0.8, 1.27, 0.006);
    // drip tray lip under the engine
    room.box('frame', fL - 0.8, 0.03, 0.02, fcx, fl + 0.015, 1.02, 0.004); room.box('frame', fL - 0.8, 0.03, 0.02, fcx, fl + 0.015, -1.02, 0.004);
  }

  // ---- control room: genset control panel and breaker section
  {
    const cx = xa + 0.92, cz = -1.08, cy = fl + 0.1, fz = cz + 0.25;
    ctl.box('black', 1.36, 0.1, 0.46, cx, fl + 0.05, cz, 0.006);
    ctl.box('paintGrey', 1.4, 2.0, 0.5, cx, cy + 1.0, cz, 0.012);
    for (const dx of [-0.35, 0.35]) {
      ctl.box('paintGrey', 0.68, 1.94, 0.022, cx + dx, cy + 1.0, fz + 0.008, 0.008);
      ctl.box('steel', 0.025, 0.16, 0.03, cx + dx * 0.12 + Math.sign(dx) * 0.0, cy + 1.0, fz + 0.035, 0.006);
    }
    // HMI
    ctl.box('black', 0.46, 0.31, 0.02, cx - 0.35, cy + 1.48, fz + 0.026, 0.008);
    ctl.quad('hmi', 0.4, 0.25, cx - 0.35, cy + 1.48, fz + 0.037);
    // pilot lamps, selector switches, e-stop
    ['lampG', 'lampW', 'lampA', 'lampW', 'lampG'].forEach((m, i) => { ctl.cyl('bolt', 0.02, 0.012, cx - 0.55 + i * 0.1, cy + 1.2, fz + 0.025, 'z', 10); ctl.cyl(m, 0.014, 0.014, cx - 0.55 + i * 0.1, cy + 1.2, fz + 0.03, 'z', 8); });
    for (let i = 0; i < 4; i++) { ctl.cyl('black', 0.022, 0.03, cx - 0.5 + i * 0.1, cy + 1.08, fz + 0.03, 'z', 10); ctl.box('black', 0.008, 0.04, 0.012, cx - 0.5 + i * 0.1, cy + 1.08, fz + 0.05, 0.002); }
    ctl.cyl('yellow', 0.04, 0.012, cx - 0.1, cy + 1.08, fz + 0.025, 'z', 12); ctl.cyl('estop', 0.028, 0.03, cx - 0.1, cy + 1.08, fz + 0.04, 'z', 12);
    // meters and protection relay on the right door
    for (let i = 0; i < 3; i++) { ctl.box('black', 0.11, 0.11, 0.02, cx + 0.16 + i * 0.14, cy + 1.6, fz + 0.026, 0.006); ctl.box('gaugeFace', 0.09, 0.09, 0.004, cx + 0.16 + i * 0.14, cy + 1.6, fz + 0.037, 0.002); ctl.box('black', 0.003, 0.05, 0.002, cx + 0.17 + i * 0.14, cy + 1.59, fz + 0.04, 0.0005); }
    ctl.box('black', 0.3, 0.2, 0.02, cx + 0.3, cy + 1.36, fz + 0.026, 0.006); ctl.box('lampW', 0.12, 0.06, 0.004, cx + 0.25, cy + 1.4, fz + 0.037, 0.002);
    for (let i = 0; i < 6; i++) ctl.box('gaugeFace', 0.022, 0.022, 0.006, cx + 0.2 + (i % 3) * 0.04, cy + 1.32 - Math.floor(i / 3) * 0.035, fz + 0.037, 0.002);
    for (let i = 0; i < 8; i++) ctl.box('louverDark', 0.4, 0.012, 0.004, cx + 0.3, cy + 0.3 + i * 0.03, fz + 0.021, 0.001);
    for (const dx of [-0.6, 0.1]) ctl.box('alu', 0.2, 0.04, 0.003, cx + dx + 0.15, cy + 1.82, fz + 0.021, 0.001);
    // breaker / switchgear section against the end wall
    const sx = xa + 0.5, sz = 0.55;
    ctl.box('black', 0.56, 0.1, 1.0, sx, fl + 0.05, sz, 0.006);
    ctl.box('paintGrey', 0.6, 2.1, 1.04, sx, cy + 1.05, sz, 0.012);
    ctl.box('paintGrey', 0.022, 0.9, 0.96, sx + 0.305, cy + 1.55, sz, 0.008); ctl.box('paintGrey', 0.022, 0.98, 0.96, sx + 0.305, cy + 0.58, sz, 0.008);
    ctl.box('black', 0.03, 0.26, 0.2, sx + 0.32, cy + 1.5, sz, 0.008); ctl.box('black', 0.06, 0.12, 0.04, sx + 0.35, cy + 1.46, sz, 0.008);
    ctl.box('glass', 0.008, 0.14, 0.3, sx + 0.318, cy + 1.82, sz, 0.002);
    for (const [dz, m] of [[-0.3, 'lampG'], [-0.2, 'lampA'], [0.3, 'lampW']]) ctl.cyl(m, 0.014, 0.014, sx + 0.322, cy + 1.25, sz + dz, 'x', 8);
    for (let i = 0; i < 10; i++) ctl.box('louverDark', 0.004, 0.012, 0.6, sx + 0.317, cy + 0.2 + i * 0.03, sz, 0.001);
    ctl.box('steel', 0.03, 0.14, 0.025, sx + 0.33, cy + 0.9, sz + 0.4, 0.006);
    // conduit from panel top to tray, floor mat, small desk shelf
    for (const dx of [-0.4, 0, 0.4]) ctl.tube('galv', [[cx + dx, cy + 2.0, cz], [cx + dx, H - 0.5, cz]], 0.02, { radial: 6 });
    ctl.box('rubber', 1.3, 0.008, 0.8, cx, fl + 0.004, -0.3, 0.002);
  }

  const parts = { engine: eng.build(), hot: hot.build(), generator: gen.build(), baseFrame: bfr.build(), controlPanel: ctl.build(), room: room.build() };
  const damper = dk.build();
  let tris = damper.tris; for (const k of Object.keys(parts)) tris += parts[k].tris;
  return { parts, damper, A, tris };
}

// ---------------------------------------------------------------- instance

const EXT = new Map(), INT = new Map(), STATUS = {
  running: { color: 0x3ddc84, i: 2.2 }, standby: { color: 0xa9b8c8, i: 0.35 }, fault: { color: 0xf5a623, i: 2.4 }, service: { color: 0x6fd0ff, i: 1.6 },
};
let _beaconGeo = null, _idPlane = null, _haloTex = null;
const TIER = 0.2; // stack light tier pitch, m
// Stack light tiers, top to bottom. Index 0 red (#ff5247, confirmed by the owner for alarms), 1 white, 2 green.
// e = lens emissive intensity when lit (kept moderate so the hue survives ACES in daylight), h = halo gain.
// The halo sprite is HDR and additive: it is what clears the scene bloom threshold and carries the color at distance.
const TIERS = [
  { off: 0x6e0f0a, lit: 0xff1408, e: 1.7, h: 1.6 },
  { off: 0xc9cdce, lit: 0xf2f5ff, e: 5, h: 1.4 },
  { off: 0x0f5a2c, lit: 0x08c83c, e: 1.5, h: 1.5 },
];
// State mapping (chosen by the project coordinator): running = green steady, standby = white steady,
// fault = red flashing about 1.5 Hz (sharp on, soft decay), service = white slow blink about 0.5 Hz.
const TIER_OF = { running: 2, standby: 1, fault: 0, service: 1 };
const _HV = new THREE.Vector3(), _HQ = new THREE.Quaternion();

function haloTexture() {
  if (_haloTex) return _haloTex;
  const c = canvas(128, 128), ctx = c.getContext('2d'), g = ctx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.22, 'rgba(255,255,255,0.85)'); g.addColorStop(0.45, 'rgba(255,255,255,0.4)'); g.addColorStop(0.75, 'rgba(255,255,255,0.08)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_haloTex = t);
}

// additive light spill for the fault flash: one patch on the roof, two on the ground around the control end
function spillGeometry(o, yB, b) {
  const pos = [], uv = [], col = [];
  const quad = (x0, x1, z0, z1, y, R, k) => {
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z1], [x0, z0], [x1, z1], [x1, z0]]) {
      pos.push(x, y, z); uv.push(0.5 + (x - b.x) / (2 * R), 0.5 + (z - b.z) / (2 * R)); col.push(k, k, k);
    }
  };
  quad(o.xa + 0.03, o.xa + 3.4, -o.hw + 0.03, o.hw - 0.03, o.H + 0.04, 3.0, 1);
  quad(o.xa - 4.5, o.xa + 5.0, b.z - 5.0, -o.hw - 0.06, 0.03 - yB, 5.5, 0.55);
  quad(o.xa - 4.5, o.xa - 0.06, -o.hw - 0.06, o.hw + 1.5, 0.03 - yB, 5.5, 0.55);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

function idTexture(id, unit) {
  const c = canvas(1024, 400), ctx = c.getContext('2d');
  ctx.fillStyle = '#22262a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  const draw = (txt, size, y) => {
    ctx.font = `bold ${size}px "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
    let w = ctx.measureText(txt).width; const sc = Math.min(1, 980 / w);
    ctx.save(); ctx.translate(512, y); ctx.scale(sc, 1);
    ctx.fillText(txt, 0, 0);
    // stencil bridges through each glyph
    ctx.globalCompositeOperation = 'destination-out';
    let x = -w / 2;
    for (const ch of txt) { const cw = ctx.measureText(ch).width; if (ch !== '-' && ch !== '.' && ch !== ' ' && ch !== '1') ctx.fillRect(x + cw * 0.5 - size * 0.018, -size, size * 0.036, size * 1.2); x += cw; }
    ctx.restore();
  };
  draw(String(id || unit).toUpperCase(), 235, 225);
  if (id) draw(String(unit).toUpperCase(), 110, 360);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/**
 * Build one generator set.
 * @param {{unit?: 'PWR2.6-S'|'PWR2.6-M'|'PWR2.0', id?: string}} opts
 * @returns {THREE.Group} group with the model API in userData
 */
export function buildGenset(opts = {}) {
  const unit = SPECS[opts.unit] ? opts.unit : 'PWR2.6-S', sp = SPECS[unit], id = opts.id;
  const M = materials();
  if (!EXT.has(unit)) EXT.set(unit, buildExterior(sp));
  const ext = EXT.get(unit), o = ext.o, yB = ext.A.yB;

  const root = new THREE.Group(); root.name = `genset:${id || unit}`;
  const body = new THREE.Group(); body.position.y = yB; root.add(body);
  const own = [], fadeMats = new Map(), fadeMeshes = [], roofMeshes = [];
  const fadeMat = (key) => {
    let m = fadeMats.get(key);
    if (!m) { m = M[key].clone(); m.userData = { ...M[key].userData }; fadeMats.set(key, m); own.push(m); }
    return m;
  };
  const resolve = (key) => M[key === 'engine' ? sp.paint : key];
  const mkPart = (name, geoms, parent, fade, matOf) => {
    const g = new THREE.Group(); g.name = name;
    for (const [key, geom] of geoms) {
      const mat = matOf ? matOf(key) : fade ? fadeMat(key) : resolve(key);
      const mesh = new THREE.Mesh(geom, mat);
      const glow = key === 'glow' || key === 'hmi';
      mesh.castShadow = !glow && key !== 'decal'; mesh.receiveShadow = !glow;
      if (fade) fadeMeshes.push(mesh);
      g.add(mesh);
    }
    parent.add(g);
    return g;
  };

  const parts = {};
  parts.base = mkPart('base', ext.parts.base, body, false);
  parts.enclosure = mkPart('enclosure', ext.parts.enclosure, body, true);
  const decals = mkPart('decals', ext.parts.decals, parts.enclosure, true);
  parts.radiator = mkPart('radiator', ext.parts.radiator, body, false);
  parts.exhaust = mkPart('exhaust', ext.parts.exhaust, body, false);
  parts.gasTrain = mkPart('gasTrain', ext.parts.gasTrain, body, false);
  if (sp.mobile) parts.trailer = mkPart('trailer', ext.parts.trailer, body, false);
  parts.radiator.traverse((m) => m.isMesh && roofMeshes.push(m));
  parts.exhaust.traverse((m) => m.isMesh && roofMeshes.push(m));
  // interior placeholders so the scene can hold stable references
  for (const k of ['engine', 'generator', 'controlPanel']) { parts[k] = new THREE.Group(); parts[k].name = k; }
  const interior = new THREE.Group(); interior.name = 'interior'; interior.visible = false; body.add(interior);

  // fans
  const fans = ext.A.fans.map((p) => {
    const m = new THREE.Mesh(ext.rotor, M.fan); m.position.copy(p); m.castShadow = false; parts.radiator.add(m); return m;
  });

  // stack light lenses (ribbed), one material per tier per instance, plus a single halo sprite that sits on the lit tier
  if (!_beaconGeo) {
    const pr = [[0.106, 0.013]];
    for (let i = 0; i < 9; i++) { const y = 0.018 + i * 0.0182; pr.push([0.11, y, 1], [0.11, y + 0.011, 1], [0.105, y + 0.0146, 1]); }
    pr.push([0.106, TIER - 0.013]);
    _beaconGeo = latheGeom(pr, 20);
  }
  const lensMats = TIERS.map((T) => {
    const m = new THREE.MeshStandardMaterial({ color: T.off, emissive: T.lit, emissiveIntensity: 0, roughness: 0.2, metalness: 0.0, transparent: true, opacity: 0.94 });
    own.push(m); return m;
  });
  lensMats.forEach((m, i) => {
    const lens = new THREE.Mesh(_beaconGeo, m); lens.position.copy(ext.A.beacon); lens.position.y += (2 - i) * TIER; lens.name = 'stack-lens-' + i; body.add(lens);
  });
  // Billboarded mesh rather than a Sprite: the scene AO pass only skips meshes flagged noAO, and a sprite would occlude there.
  const haloMat = new THREE.MeshBasicMaterial({ map: haloTexture(), color: 0xffffff, transparent: true, depthWrite: false, fog: false });
  own.push(haloMat);
  if (!_idPlane) _idPlane = new THREE.PlaneGeometry(1, 1);
  const halo = new THREE.Mesh(_idPlane, haloMat); halo.name = 'stack-halo'; halo.userData.noAO = true; halo.castShadow = halo.receiveShadow = false;
  halo.position.copy(ext.A.beacon); body.add(halo);
  // face the camera; 1 m wide up close, shrinking to 0.6 m (under 3 lens diameters) and fading by 60 m so a yard of units does not wash out
  halo.onBeforeRender = (r, sc, cam) => {
    const d = cam.position.distanceTo(halo.getWorldPosition(_HV)), f = Math.min(1, Math.max(0, (d - 15) / 45)), k = 1 - 0.4 * f;
    halo.scale.set(k, k, 1);
    halo.quaternion.copy(body.getWorldQuaternion(_HQ).invert().multiply(cam.quaternion));
    halo.updateMatrix(); halo.matrixWorld.multiplyMatrices(body.matrixWorld, halo.matrix);
    haloMat.opacity = (st.he || 0) * 1.0; // full intensity at every distance (owner request); only the size shrinks with distance
  };
  let spill = null; // built on the first fault only

  // stencilled ID on both sides
  const idTex = idTexture(id, unit);
  const idMat = new THREE.MeshStandardMaterial({ map: idTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false });
  own.push(idMat, idTex);
  if (!_idPlane) _idPlane = new THREE.PlaneGeometry(1, 1);
  const pcx = (o.panel[0] + o.panel[1]) / 2, pw = Math.min(1.7, o.panel[1] - o.panel[0] - 0.26);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(_idPlane, idMat); m.scale.set(pw, pw * 0.39, 1);
    m.position.set(pcx, o.hs + 1.55, s * (o.hw + 0.022)); if (s < 0) m.rotation.y = PI;
    decals.add(m);
  }

  // bounds
  if (!ext.bounds) {
    const bb = new THREE.Box3();
    root.updateMatrixWorld(true);
    root.traverse((m) => { if (m.isMesh) { if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); } });
    ext.bounds = bb;
  }
  const bb = ext.bounds, size = bb.getSize(new THREE.Vector3());

  const st = { status: 'standby', rpm: 0, heat: 0, first: true, opacity: 1, load: 0.8 };
  let inner = null;

  function ensureInterior() {
    if (inner) return;
    if (!INT.has(unit)) INT.set(unit, buildInterior(sp));
    const I = INT.get(unit);
    const MI = interiorMaterials();
    const resolveI = (key) => (key === 'engine' ? MI[sp.paint] : MI[key] || M[key]);
    inner = { hotMat: weather(MI.castRaw.clone(), MI.castRaw.userData.wear), hmiMat: M.hmi.clone() };
    inner.hotMat.emissive = new THREE.Color(0xff5a1e); inner.hotMat.emissiveIntensity = 0;
    own.push(inner.hotMat, inner.hmiMat);
    const vib = new THREE.Group(); vib.name = 'genset-set'; interior.add(vib);
    const addTo = (grp, geoms, matOf) => { for (const [key, geom] of geoms) { const mesh = new THREE.Mesh(geom, matOf ? matOf(key) : resolveI(key)); const glow = key === 'glow' || key === 'hmi'; mesh.castShadow = !glow && key !== 'label'; mesh.receiveShadow = !glow; grp.add(mesh); } };
    addTo(parts.engine, I.parts.engine); addTo(parts.engine, I.parts.hot, () => inner.hotMat);
    addTo(parts.generator, I.parts.generator);
    addTo(parts.controlPanel, I.parts.controlPanel, (k) => (k === 'hmi' ? inner.hmiMat : resolveI(k)));
    vib.add(parts.engine, parts.generator);
    interior.add(parts.controlPanel);
    parts.baseFrame = new THREE.Group(); parts.baseFrame.name = 'baseFrame'; addTo(parts.baseFrame, I.parts.baseFrame); interior.add(parts.baseFrame);
    parts.room = new THREE.Group(); parts.room.name = 'room'; addTo(parts.room, I.parts.room); interior.add(parts.room);
    inner.vib = vib;
    inner.damper = new THREE.Group(); inner.damper.position.copy(I.A.damper); addTo(inner.damper, I.damper); parts.engine.add(inner.damper);
    inner.ventFan = new THREE.Mesh(ext.rotor, M.fan); inner.ventFan.rotation.z = -HP; inner.ventFan.scale.setScalar(0.9);
    const vf = new THREE.Group(); vf.position.copy(I.A.ventFan); vf.add(inner.ventFan); parts.room.add(vf); inner.ventPivot = vf;
    inner.tris = I.tris;
    root.userData.stats.interiorTriangles = I.tris;
  }

  function setEnclosureOpacity(a) {
    a = Math.max(0, Math.min(1, +a || 0));
    if (a < 1) ensureInterior();
    st.opacity = a;
    const tr = a < 0.999;
    for (const m of fadeMats.values()) {
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
      m.opacity = (m.name === 'lining' || m.name === 'decal') ? a * a : a; m.depthWrite = a > 0.5;
      if (m.userData.alphaTest) m.alphaTest = m.userData.alphaTest * a;
    }
    idMat.opacity = a * a;
    parts.enclosure.visible = a > 0.004;
    const cast = a > 0.6;
    for (const m of fadeMeshes) if (m.material.name !== 'glow' && m.material.name !== 'hmi' && m.material.name !== 'decal') m.castShadow = cast;
    for (const m of roofMeshes) m.castShadow = cast && !m.material.userData.noShadow;
    interior.visible = tr;
  }

  function setStatus(s) {
    if (!STATUS[s]) s = 'standby';
    st.status = s;
    const k = TIER_OF[s];
    halo.position.y = ext.A.beacon.y + (2 - k + 0.5) * TIER;
    if (s === 'fault' && !spill) {
      if (!ext.spillGeo) ext.spillGeo = spillGeometry(o, yB, ext.A.beacon);
      const sm = new THREE.MeshBasicMaterial({ map: haloTexture(), color: 0x000000, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      own.push(sm);
      spill = new THREE.Mesh(ext.spillGeo, sm); spill.name = 'stack-spill'; spill.userData.noAO = true; spill.renderOrder = 1; body.add(spill);
    }
    lights(st.t || 0);
    if (st.first) { st.first = false; st.rpm = st.heat = s === 'running' ? 1 : 0; }
  }

  function lights(t) {
    const s = st.status, k = TIER_OF[s];
    let e = 1;
    if (s === 'fault') { const p = (t * 1.5) % 1; e = p < 0.035 ? p / 0.035 : Math.max(0.03, Math.exp(-(p - 0.035) * 5.2)); }
    else if (s === 'service') { const w = Math.sin(t * PI); e = 0.06 + 0.94 * Math.min(1, Math.max(0, w * 2.5 + 0.5)); }
    for (let i = 0; i < 3; i++) lensMats[i].emissiveIntensity = i === k ? TIERS[i].e * e : 0;
    haloMat.color.setHex(TIERS[k].lit).multiplyScalar(TIERS[k].h); st.he = Math.min(1, e); // alpha blended so the hue stays saturated on bright backgrounds
    if (spill) { spill.visible = s === 'fault'; if (spill.visible) spill.material.color.setHex(TIERS[0].lit).multiplyScalar(0.5 * e); }
  }

  function update(dt, t, tel) {
    dt = Math.min(0.1, Math.max(0, dt || 0)); t = t || 0; st.t = t;
    const run = st.status === 'running' ? 1 : 0;
    const load = typeof tel?.load === 'number' ? Math.max(0, Math.min(1.1, tel.load > 1.5 ? tel.load / 100 : tel.load)) : 0.8;
    st.rpm += (run - st.rpm) * Math.min(1, dt * 0.9);
    st.heat += (run * (0.55 + 0.45 * load) - st.heat) * Math.min(1, dt * 0.25);
    if (st.rpm > 0.002) {
      const w = dt * st.rpm * (9 + 9 * load);
      for (let i = 0; i < fans.length; i++) fans[i].rotation.y += w * (1 + 0.03 * i);
    }
    lights(t);
    if (inner && interior.visible) {
      const r = st.rpm;
      inner.vib.position.set(Math.sin(t * 157.1) * 0.0006 * r, Math.sin(t * 171.3 + 1.1) * 0.0012 * r, Math.sin(t * 143.7 + 2.3) * 0.0009 * r);
      inner.damper.rotation.x += dt * r * 21;
      inner.ventFan.rotateY(dt * r * 16); // spin about the fan shaft (local axis), not world vertical
      inner.hotMat.emissiveIntensity = st.heat * 0.022 * (1 + 0.03 * Math.sin(t * 2.7));
      inner.hmiMat.emissiveIntensity = (st.status === 'service' ? 0.6 : 1.1) + 0.04 * Math.sin(t * 9.0);
    }
  }

  function dispose() {
    for (const x of own) x.dispose();
    own.length = 0;
    if (root.parent) root.parent.remove(root);
  }

  const top = bb.max.y;
  root.userData = {
    kind: 'genset', id, unit,
    size: { x: size.x, y: size.y, z: size.z },
    hudAnchor: new THREE.Vector3(0, top + 0.5, 0),
    focus: { center: new THREE.Vector3(0, yB + o.H * 0.52, 0), radius: o.L * 0.56 },
    exhaustTip: ext.A.exhaustTip.clone().add(new THREE.Vector3(0, yB, 0)),
    parts,
    stats: { byPart: ext.byPart, exteriorTriangles: ext.tris + ext.rotor.attributes.position.count / 3 * fans.length, interiorTriangles: 0 },
    setEnclosureOpacity, setStatus, update, dispose,
  };
  setStatus('standby'); st.first = true;
  return root;
}
