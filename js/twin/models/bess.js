// 20 ft liquid-cooled LFP battery container (5.0 MWh), 6.06 x 2.44 x 2.90 m.
// Doors face +Z, chiller on the -X end, electrical end on +X. Interior is built lazily on first open.
import * as THREE from 'three';
import { M, B, C, add, mesh, decal, tube, pipePath, bake, instantiate, corrugGeo, louver, labelMat, signMat, sphereGeo, planeGeo, bolts, canvasTex } from './yard.js';

const L = 6.058, W = 2.438, H = 2.896, hx = L / 2, hz = W / 2;
const BAY0 = -hx + 0.14, CH = 1.1, MUL = 0.05;
const DY0 = 0.17, DH = H - 0.12 - DY0;
const XS = BAY0 + CH + MUL, PW = (hx - 0.14 - XS - 2 * MUL) / 3;
const RACKS = 6, LEVELS = 8, RX0 = -1.68, RP = 0.685, MW = 0.62, MH = 0.235, MD = 2.0, MY0 = 0.25, MP = 0.268, MZ = -0.04, FZ = MZ + MD / 2;
const FONT = '"Arial Narrow", "Liberation Sans Narrow", Arial, Helvetica, sans-serif';
const STATUS = { running: 0x3ddc84, standby: 0xa9b8c8, fault: 0xf5a623, service: 0x6fd0ff };
const v = (x, y, z) => new THREE.Vector3(x, y, z);
let _static = null, _interior = null, _rotor = null;

// ---------------------------------------------------------------- label art
const LBL = {
  ess: () => labelMat('ess', 512, 384, (c, w, h) => {
    c.fillStyle = '#f4f3ee'; c.fillRect(0, 0, w, h); c.strokeStyle = '#111'; c.lineWidth = 10; c.strokeRect(8, 8, w - 16, h - 16);
    c.fillStyle = '#f0c419'; c.fillRect(22, 22, w - 44, 120); c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 58px ' + FONT; c.fillText('ENERGY STORAGE', w / 2, 56); c.fillText('SYSTEM', w / 2, 110);
    c.font = 'bold 40px ' + FONT; c.fillText('LITHIUM IRON PHOSPHATE (LFP)', w / 2, 190);
    c.font = 'bold 46px ' + FONT; c.fillText('5.0 MWh  /  1500 V DC', w / 2, 250);
    c.font = 'bold 30px ' + FONT; c.fillText('DO NOT OPEN WHILE ENERGIZED', w / 2, 312); c.fillText('ARC FLASH AND SHOCK HAZARD', w / 2, 348);
  }),
  nfpa: () => labelMat('nfpa', 256, 256, (c, w) => {
    c.clearRect(0, 0, w, w); c.translate(w / 2, w / 2); c.rotate(Math.PI / 4);
    const s = 86, q = [['#1f5fbf', -s, 0, '2'], ['#c0362c', -s, -s, '1'], ['#f0c419', 0, -s, '1'], ['#f4f3ee', 0, 0, '']];
    for (const [col, x, y] of q) { c.fillStyle = col; c.fillRect(x, y, s, s); }
    c.strokeStyle = '#111'; c.lineWidth = 6; c.strokeRect(-s, -s, 2 * s, 2 * s); c.beginPath(); c.moveTo(-s, 0); c.lineTo(s, 0); c.moveTo(0, -s); c.lineTo(0, s); c.stroke();
    c.rotate(-Math.PI / 4); c.fillStyle = '#111'; c.font = 'bold 56px ' + FONT; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('2', -61, 2); c.fillText('1', 0, -59); c.fillText('1', 61, 2);
  }, true),
  vent: () => labelMat('vent', 512, 128, (c, w, h) => {
    c.fillStyle = '#f0c419'; c.fillRect(0, 0, w, h); c.fillStyle = '#111';
    for (let x = -h; x < w + h; x += 44) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 22, 0); c.lineTo(x + 22 - 26, 26); c.lineTo(x - 26, 26); c.fill(); c.beginPath(); c.moveTo(x, h - 26); c.lineTo(x + 22, h - 26); c.lineTo(x + 22 - 26, h); c.lineTo(x - 26, h); c.fill(); }
    c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 44px ' + FONT; c.fillText('DEFLAGRATION VENT  KEEP CLEAR', w / 2, h / 2 + 2);
  }),
  estop: () => labelMat('estop', 256, 80, (c, w, h) => { c.fillStyle = '#f0c419'; c.fillRect(0, 0, w, h); c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 34px ' + FONT; c.fillText('EMERGENCY STOP', w / 2, h / 2 + 2); }),
  fdc: () => labelMat('fdc', 256, 80, (c, w, h) => { c.fillStyle = '#a5382c'; c.fillRect(0, 0, w, h); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 30px ' + FONT; c.fillText('FDC  DRY STANDPIPE', w / 2, h / 2 + 2); }),
  cool: () => labelMat('cool', 256, 80, (c, w, h) => { c.fillStyle = '#e9e9e4'; c.fillRect(0, 0, w, h); c.strokeStyle = '#111'; c.lineWidth = 4; c.strokeRect(3, 3, w - 6, h - 6); c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 30px ' + FONT; c.fillText('LIQUID COOLING UNIT', w / 2, h / 2 + 2); }),
  dc: () => signMat('dc1500', 'DANGER', '#b3261e', ['1500 V DC', 'BATTERY CIRCUIT']),
  arc: () => signMat('arc', 'WARNING', '#d9820f', ['ARC FLASH HAZARD', 'PPE REQUIRED']),
  module: () => new THREE.MeshStandardMaterial({
    roughness: 0.5, metalness: 0.3, map: canvasTex('modface', 512, 192, (c, w, h) => {
      c.fillStyle = '#30353b'; c.fillRect(0, 0, w, h); c.strokeStyle = '#1b1e21'; c.lineWidth = 6; c.strokeRect(5, 5, w - 10, h - 10);
      c.strokeStyle = '#4a5058'; c.lineWidth = 2; c.strokeRect(11, 11, w - 22, h - 22);
      c.fillStyle = '#16181a'; for (let i = 0; i < 9; i++) c.fillRect(190 + i * 14, 40, 7, 112);
      c.fillStyle = '#ecebe6'; c.fillRect(340, 36, 110, 70); c.fillStyle = '#111'; for (let i = 0; i < 22; i++) c.fillRect(348 + i * 4.4, 44, i % 3 ? 2 : 3, 26);
      c.font = 'bold 14px ' + FONT; c.fillText('LFP 104 kWh', 348, 88); c.fillText('SIM-PACK', 348, 101);
      c.fillStyle = '#f0c419'; c.beginPath(); c.moveTo(372, 164); c.lineTo(396, 122); c.lineTo(420, 164); c.fill(); c.fillStyle = '#111'; c.fillRect(394, 136, 4, 16); c.fillRect(394, 155, 4, 4);
      c.fillStyle = '#8a9096'; for (const [x, y] of [[20, 20], [w - 20, 20], [20, h - 20], [w - 20, h - 20], [w / 2, 20], [w / 2, h - 20]]) { c.beginPath(); c.arc(x, y, 6, 0, 6.2832); c.fill(); }
      c.fillStyle = '#22262a'; c.fillRect(24, 76, 60, 40); c.fillRect(100, 76, 60, 40);
    }),
  }),
};
let _modFace = null;

// ---------------------------------------------------------------- exterior
function doorLeaf(S, x0, lw, hingeLeft) {
  const cx = x0 + lw / 2, yc = DY0 + DH / 2, out = hingeLeft ? -1 : 1;
  add(S, B(lw - 0.008, DH, 0.035, 0.012), 'white', cx, yc, hz - 0.02);
  add(S, B(lw - 0.17, DH - 0.3, 0.012, 0.006), 'white', cx + out * 0.02, yc, hz + 0.0);
  const xh = hingeLeft ? x0 : x0 + lw;
  for (const k of [0.08, 0.36, 0.64, 0.92]) {
    add(S, C(0.014, 0.13, 8), 'galv', xh, DY0 + DH * k, hz + 0.006);
    add(S, B(0.075, 0.1, 0.006, 0.002), 'galv', xh - out * 0.04, DY0 + DH * k, hz + 0.0);
  }
  const xr = (hingeLeft ? x0 + lw : x0) + out * 0.115, zr = hz + 0.028;
  tube(S, v(xr, DY0 - 0.035, zr), v(xr, DY0 + DH + 0.04, zr), 0.0135, 'galv', 8);
  for (const k of [0.07, 0.3, 0.7, 0.93]) add(S, B(0.055, 0.045, 0.04, 0.006), 'galv', xr, DY0 + DH * k, hz + 0.018);
  for (const yy of [DY0 - 0.035, DY0 + DH + 0.04]) add(S, B(0.065, 0.05, 0.045, 0.008), 'galv', xr, yy, hz + 0.022);
  const yh = DY0 + 1.08;
  add(S, B(0.05, 0.07, 0.04, 0.008), 'galv', xr, yh, zr + 0.01);
  add(S, B(0.36, 0.032, 0.012, 0.004), 'galv', xr + out * 0.17, yh, zr + 0.028);
  add(S, B(0.045, 0.1, 0.03, 0.006), 'galv', xr + out * 0.3, yh, hz + 0.012);
  add(S, B(0.1, 0.02, 0.02, 0.006), 'black', xr + out * 0.36, yh, zr + 0.03);
}
function buildStatic() {
  const F = new THREE.Group(), S = new THREE.Group();
  // frame: castings, posts, rails, floor, roof bows
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    for (const y of [0.059, H - 0.059]) {
      add(F, B(0.178, 0.118, 0.162, 0.012), 'white', sx * (hx - 0.089), y, sz * (hz - 0.081));
      add(F, C(0.03, 0.006, 10), 'black', sx * (hx - 0.089), y, sz * (hz - 0.001), Math.PI / 2).scale.x = 1.5;
      add(F, C(0.03, 0.006, 10), 'black', sx * (hx - 0.001), y, sz * (hz - 0.081), 0, 0, Math.PI / 2).scale.z = 1.4;
    }
    add(F, C(0.03, 0.006, 10), 'black', sx * (hx - 0.089), H - 0.001, sz * (hz - 0.081)).scale.x = 1.6;
    add(F, B(0.15, H - 0.236, 0.15, 0.012), 'white', sx * (hx - 0.075), H / 2, sz * (hz - 0.075));
  }
  for (const sz of [-1, 1]) {
    add(F, B(L - 0.356, 0.16, 0.07, 0.008), 'white', 0, 0.08, sz * (hz - 0.035));
    add(F, B(L - 0.356, 0.115, 0.07, 0.008), 'white', 0, H - 0.0575, sz * (hz - 0.035));
    for (const x of [-1.03, 1.03]) add(F, B(0.36, 0.1, 0.006, 0), 'black', x, 0.07, sz * (hz + 0.0005));
  }
  for (const sx of [-1, 1]) { add(F, B(0.07, 0.16, W - 0.324, 0.008), 'white', sx * (hx - 0.035), 0.08, 0); add(F, B(0.07, 0.115, W - 0.324, 0.008), 'white', sx * (hx - 0.035), H - 0.0575, 0); }
  add(F, B(L - 0.16, 0.03, W - 0.16, 0), 'dark', 0, 0.165, 0);
  for (let i = 0; i < 9; i++) add(F, B(0.05, 0.12, W - 0.14, 0), 'dark', -hx + 0.35 + i * (L - 0.7) / 8, 0.09, 0);
  for (let i = 0; i < 6; i++) add(F, B(0.05, 0.06, W - 0.14, 0), 'white', -hx + 0.6 + i * (L - 1.2) / 5, H - 0.115, 0);
  add(F, B(MUL, DH + 0.03, 0.07, 0.006), 'white', BAY0 + CH + MUL / 2, DY0 + DH / 2, hz - 0.04);
  for (let p = 1; p < 3; p++) add(F, B(MUL, DH + 0.03, 0.07, 0.006), 'white', XS + p * (PW + MUL) - MUL / 2, DY0 + DH / 2, hz - 0.04);
  // chiller end (-X): wall, fan rings, intake louver, service panel
  add(F, B(0.04, H - 0.27, W - 0.3, 0.006), 'white', -hx + 0.05, H / 2, 0);
  for (const z of [-0.56, 0.56]) {
    add(F, C(0.47, 0.004, 28), 'black', -hx + 0.027, 2.08, z, 0, 0, Math.PI / 2);
    add(F, C(0.5, 0.075, 28, 0.5, true), 'whiteDS', -hx - 0.005, 2.08, z, 0, 0, Math.PI / 2);
    add(F, B(0.012, 1.06, 1.06, 0.004), 'white', -hx + 0.036, 2.08, z);
    const gr = decal(F, 'grille', 0.99, 0.99, -hx - 0.04, 2.08, z, -Math.PI / 2); gr.castShadow = false;
    const bp = []; for (const a of [-1, 1]) for (const b of [-1, 1]) bp.push(v(-hx + 0.028, 2.08 + a * 0.49, z + b * 0.49));
    bolts(F, bp, 0.012, 0.02, 'galv', v(1, 0, 0));
  }
  louver(F, 2.0, 0.8, 'white', -hx + 0.03, 0.72, 0, -Math.PI / 2);
  add(F, B(0.012, 0.3, 0.9, 0.004), 'white', -hx + 0.028, 1.33, -0.5);
  decal(F, LBL.cool(), 0.42, 0.13, -hx + 0.02, 1.33, -0.5, -Math.PI / 2);
  add(F, B(0.03, 0.22, 0.26, 0.01), 'grey70', -hx + 0.02, 1.33, 0.55); add(F, C(0.012, 0.45, 6), 'galv', -hx + 0.02, 1.33 - 0.33, 0.55);
  // chiller bay door (+Z)
  const cxb = BAY0 + CH / 2;
  add(F, B(CH, DH + 0.01, 0.01, 0), 'rubber', cxb, DY0 + DH / 2, hz - 0.045);
  add(F, B(CH - 0.008, DH, 0.035, 0.012), 'white', cxb, DY0 + DH / 2, hz - 0.02);
  louver(F, 0.82, 0.8, 'white', cxb, 2.02, hz - 0.001); louver(F, 0.82, 0.8, 'white', cxb, 0.75, hz - 0.001);
  for (const k of [0.1, 0.5, 0.9]) add(F, C(0.014, 0.13, 8), 'galv', BAY0, DY0 + DH * k, hz + 0.006);
  add(F, B(0.04, 0.22, 0.03, 0.008), 'black', BAY0 + CH - 0.07, 1.38, hz + 0.012);
  decal(F, LBL.cool(), 0.42, 0.13, cxb - 0.08, 1.38, hz - 0.0015);
  // status bar housing, strobe mount, horn
  add(F, B(0.58, 0.07, 0.03, 0.008), 'dark', 1.9, H - 0.0575, hz + 0.012);
  add(F, B(0.08, 0.012, 0.08, 0.002), 'galv', 2.6, H + 0.006, hz - 0.08);
  add(F, C(0.016, 0.14, 8), 'galv', 2.6, H + 0.07, hz - 0.08); add(F, C(0.062, 0.05, 14), 'dark', 2.6, H + 0.165, hz - 0.08);
  add(F, B(0.11, 0.11, 0.07, 0.012), 'grey70', 2.35, H - 0.0575, hz + 0.03); add(F, C(0.04, 0.012, 12), 'dark', 2.35, H - 0.0575, hz + 0.066, Math.PI / 2);

  // shell: back wall, roof, vent panels, hood
  add(S, corrugGeo(L - 0.3, H - 0.275, 0.2788, 0.036, 'trap'), 'whiteDS', 0, 0.16, -(hz - 0.05), 0, Math.PI);
  add(S, B(L - 0.16, 0.03, W - 0.14, 0.006), 'white', 0, H - 0.035, 0);
  for (let i = 0; i < 14; i++) add(S, B(0.11, 0.014, W - 0.5, 0.006), 'white', -hx + 0.3 + i * (L - 0.6) / 13, H - 0.018, 0);
  for (const x of [-0.85, 0.6, 2.05]) {
    add(S, B(1.0, 0.035, 1.5, 0.008), 'white', x, H - 0.006, 0); add(S, B(0.88, 0.02, 1.38, 0.008), 'white', x, H + 0.018, 0);
    decal(S, LBL.vent(), 0.72, 0.18, x, H + 0.0295, 0.3, 0, -Math.PI / 2);
    const bp = []; for (let i = 0; i < 6; i++) for (const s of [-1, 1]) bp.push(v(x - 0.47 + i * 0.188, H + 0.014, s * 0.72)); for (let i = 1; i < 8; i++) for (const s of [-1, 1]) bp.push(v(x + s * 0.47, H + 0.014, -0.72 + i * 0.18));
    bolts(S, bp, 0.01, 0.014, 'galv');
  }
  add(S, B(0.62, 0.52, 0.2, 0.02), 'white', 2.15, 2.3, -hz - 0.06); louver(S, 0.5, 0.38, 'white', 2.15, 2.28, -hz - 0.162, Math.PI);
  add(S, B(0.7, 0.03, 0.26, 0.008), 'white', 2.15, 2.57, -hz - 0.08, -0.15);
  add(S, B(1.0, 0.72, 0.05, 0.008), 'white', -2.3, 0.72, -hz + 0.02); louver(S, 0.9, 0.6, 'white', -2.3, 0.72, -hz - 0.006, Math.PI);
  // doors
  for (let p = 0; p < 3; p++) {
    const x0 = XS + p * (PW + MUL), lw = PW / 2;
    add(S, B(PW, DH + 0.01, 0.01, 0), 'rubber', x0 + PW / 2, DY0 + DH / 2, hz - 0.045);
    doorLeaf(S, x0, lw, true); doorLeaf(S, x0 + lw, lw, false);
    const c0 = x0 + lw / 2 - 0.06, c1 = x0 + lw * 1.5 + 0.06, zl = hz + 0.0065;
    if (p === 0) { decal(S, LBL.nfpa(), 0.4, 0.4, c0, 1.95, zl); decal(S, LBL.dc(), 0.38, 0.285, c1, 1.95, zl); }
    if (p === 1) { decal(S, LBL.ess(), 0.5, 0.375, c0, 1.92, zl); decal(S, LBL.arc(), 0.38, 0.285, c1, 1.95, zl); }
  }
  // +X end wall with electrical fittings. E local z points out (+X), local x = -world z.
  add(S, B(0.04, H - 0.27, W - 0.3, 0.006), 'white', hx - 0.05, H / 2, 0);
  const E = new THREE.Group(); E.position.set(hx - 0.03, 0, 0); E.rotation.y = Math.PI / 2; S.add(E);
  add(E, B(1.2, 2.0, 0.012, 0), 'rubber', 0.3, 1.32, 0.004);
  add(E, B(1.18, 1.98, 0.03, 0.01), 'white', 0.3, 1.32, 0.02); add(E, B(1.0, 1.7, 0.01, 0.005), 'white', 0.3, 1.32, 0.037);
  for (const yy of [0.6, 1.32, 2.05]) add(E, C(0.013, 0.12, 8), 'galv', 0.895, yy, 0.04);
  add(E, B(0.04, 0.22, 0.03, 0.008), 'black', -0.22, 1.3, 0.05);
  decal(E, LBL.dc(), 0.44, 0.33, 0.3, 1.85, 0.0435); decal(E, LBL.arc(), 0.36, 0.27, 0.3, 1.4, 0.0435);
  add(E, B(0.14, 0.18, 0.08, 0.012), 'yellow', -0.8, 1.35, 0.04); add(E, C(0.045, 0.02, 14), 'black', -0.8, 1.35, 0.09, Math.PI / 2); add(E, C(0.038, 0.035, 14), 'red', -0.8, 1.35, 0.112, Math.PI / 2);
  decal(E, LBL.estop(), 0.24, 0.075, -0.8, 1.52, 0.002);
  add(E, B(0.36, 0.2, 0.012, 0.004), 'red', -0.8, 0.78, 0.006);
  for (const dx of [-0.085, 0.085]) { add(E, C(0.042, 0.08, 12), 'brass', -0.8 + dx, 0.78, 0.05, Math.PI / 2); add(E, C(0.052, 0.03, 12), 'brass', -0.8 + dx, 0.78, 0.1, Math.PI / 2); }
  decal(E, LBL.fdc(), 0.3, 0.094, -0.8, 0.95, 0.002);
  add(E, B(1.05, 0.3, 0.016, 0.004), 'galv', 0.3, 0.42, 0.008);
  for (let i = 0; i < 4; i++) {
    const lx = -0.06 + i * 0.24;
    add(E, C(0.05, 0.06, 10), 'dark', lx, 0.42, 0.04, Math.PI / 2);
    pipePath(E, [v(lx, 0.42, 0.05), v(lx, 0.42, 0.24), v(lx, -0.06, 0.24)], 0.03, 'cable', 0.1, 8);
    add(E, C(0.0315, 0.04, 8, 0.0315, true), i % 2 ? 'hdpe' : 'red', lx, 0.2, 0.24);
  }
  add(E, B(0.2, 0.26, 0.1, 0.012), 'grey70', 0.95, 0.55, 0.05); tube(E, v(0.95, 0.42, 0.05), v(0.95, 0, 0.05), 0.02, 'galv', 6);
  add(E, B(0.07, 0.04, 0.012, 0.003), 'copper', -0.4, 0.22, 0.008);
  pipePath(E, [v(-0.4, 0.22, 0.012), v(-0.4, 0.22, 0.08), v(-0.4, 0.02, 0.08), v(-0.4, 0.015, 0.3)], 0.009, 'green', 0.03, 5);
  return { frame: bake(F), shell: bake(S) };
}
function rotorGeo() {
  if (_rotor) return _rotor;
  const g = new THREE.Group();
  add(g, C(0.11, 0.07, 14), 'dark', 0, 0, 0);
  for (let i = 0; i < 7; i++) { const b = add(g, B(0.34, 0.006, 0.17, 0), 'dark', 0, 0, 0); b.rotation.y = i * Math.PI * 2 / 7; b.translateX(0.27); b.rotateX(0.5); }
  return (_rotor = bake(g)[0].geometry);
}

// ---------------------------------------------------------------- interior
function buildInteriorStatic() {
  const g = new THREE.Group(), x1 = RX0 + RACKS * RP, top = MY0 + LEVELS * MP;
  // rack frame
  for (let i = 0; i <= RACKS; i++) {
    const x = RX0 + i * RP - RP / 2 + (RP) / 2 - RP / 2 + RP / 2;
    for (const z of [FZ + 0.03, MZ - MD / 2 - 0.03]) add(g, B(0.04, top - 0.18 + 0.1, 0.04, 0), 'rack', RX0 + i * RP, 0.18 + (top - 0.08) / 2, z);
    for (let k = 0; k < LEVELS; k++) add(g, B(0.045, 0.02, MD, 0), 'rack', RX0 + i * RP, MY0 + k * MP - 0.012, MZ);
    void x;
  }
  for (const z of [FZ + 0.03, MZ - MD / 2 - 0.03]) for (const y of [0.2, top + 0.02]) add(g, B(x1 - RX0 + 0.04, 0.04, 0.04, 0), 'rack', (RX0 + x1) / 2, y, z);
  // per rack: coolant manifolds, BMS box, bus droppers
  for (let i = 0; i < RACKS; i++) {
    const xu = RX0 + i * RP, xc = xu + RP / 2;
    tube(g, v(xu - 0.016, 0.22, FZ + 0.075), v(xu - 0.016, top - 0.05, FZ + 0.075), 0.015, 'blue', 6);
    tube(g, v(xu + 0.016, 0.22, FZ + 0.075), v(xu + 0.016, top - 0.05, FZ + 0.075), 0.015, 'steel', 6);
    add(g, B(0.5, 0.13, 0.36, 0.01), 'dark', xc, top + 0.11, FZ - 0.16);
    add(g, B(0.42, 0.07, 0.004, 0), 'grey70', xc, top + 0.11, FZ + 0.021);
    for (const [dx, zz] of [[0.2, 0.86], [-0.2, 0.8]]) pipePath(g, [v(xc + dx, top - MP * 0.5 + 0.03, FZ + 0.04), v(xc + dx, top - MP * 0.5 + 0.03, FZ + 0.09), v(xc + dx, 2.62, FZ + 0.09), v(xc + dx, 2.62, zz)], 0.014, 'orange', 0.04, 6);
  }
  tube(g, v(RX0 + RACKS * RP - 0.016, 0.22, FZ + 0.075), v(RX0 + RACKS * RP - 0.016, top - 0.05, FZ + 0.075), 0.015, 'blue', 6);
  // coolant headers to the chiller, DC bus, cable tray
  tube(g, v(-2.2, 0.215, FZ + 0.075), v(x1, 0.215, FZ + 0.075), 0.028, 'blue', 8); tube(g, v(-2.2, 0.215, FZ + 0.15), v(x1, 0.215, FZ + 0.15), 0.028, 'steel', 8);
  add(g, B(x1 - RX0 + 0.5, 0.05, 0.008, 0), 'copper', (RX0 + x1) / 2 + 0.25, 2.62, 0.86); add(g, B(x1 - RX0 + 0.5, 0.05, 0.008, 0), 'copper', (RX0 + x1) / 2 + 0.25, 2.62, 0.8);
  for (let i = 0; i <= 6; i++) add(g, B(0.03, 0.09, 0.12, 0.004), 'polymer', RX0 + i * (x1 - RX0) / 6, 2.66, 0.83);
  const ty = 2.66, tz = -0.25;
  for (const z of [-0.15, 0.15]) add(g, B(4.9, 0.06, 0.008, 0), 'galv', 0.35, ty, tz + z);
  for (let i = 0; i < 17; i++) add(g, B(0.02, 0.012, 0.3, 0), 'galv', -2.05 + i * 0.3, ty - 0.024, tz);
  for (const [z, r, m] of [[-0.09, 0.02, 'cable'], [-0.04, 0.018, 'cable'], [0.02, 0.022, 'blue'], [0.08, 0.016, 'hdpe']]) tube(g, v(-2.05, ty - 0.018 + r + 0.012, tz + z), v(2.75, ty - 0.018 + r + 0.012, tz + z), r, m, 6);
  // detection and suppression on the roof bows
  for (const x of [-0.6, 1.8]) { add(g, C(0.04, 0.1, 10), 'yellow', x, H - 0.2, 0.5); add(g, C(0.028, 0.03, 10), 'steel', x, H - 0.26, 0.5); }
  add(g, C(0.06, 0.04, 14), 'hdpe', 0.6, H - 0.165, 0.45);
  tube(g, v(-1.7, H - 0.19, 0.2), v(2.5, H - 0.19, 0.2), 0.014, 'red', 6);
  for (const x of [-1.2, 0, 1.2, 2.3]) { add(g, C(0.012, 0.05, 6), 'brass', x, H - 0.225, 0.2); add(g, C(0.03, 0.006, 10), 'brass', x, H - 0.25, 0.2); }
  // PDU / DC combiner at +X
  const px = 2.74;
  add(g, B(0.4, 2.3, 1.7, 0.015), 'grey70', px, 0.18 + 1.15, -0.1);
  for (const z of [-0.52, 0.32]) { add(g, B(0.012, 2.1, 0.78, 0.006), 'grey70', px - 0.205, 1.35, z); add(g, B(0.02, 0.18, 0.03, 0.006), 'black', px - 0.215, 1.3, z + 0.3); }
  for (let i = 0; i < 6; i++) add(g, B(0.02, 0.09, 0.05, 0.004), 'dark', px - 0.215, 1.9, -0.8 + i * 0.1);
  add(g, B(0.03, 0.2, 0.06, 0.008), 'orange', px - 0.22, 0.9, -0.5); add(g, B(0.012, 0.16, 0.24, 0), 'glass', px - 0.213, 1.9, 0.3);
  // bulkhead and chiller bay machinery
  add(g, B(0.03, 2.5, W - 0.2, 0), 'galvT', -1.775, 0.18 + 1.25, 0);
  add(g, B(0.06, 1.15, 2.1, 0), 'coil', -2.9, 2.08, 0);
  add(g, C(0.14, 0.45, 14), 'black', -2.35, 0.42, -0.6); const dm = add(g, sphereGeo(0.14, 14, 5, Math.PI / 2), 'black', -2.35, 0.645, -0.6); dm.scale.y = 0.6;
  add(g, C(0.07, 0.36, 10), 'black', -2.6, 0.38, -0.3);
  add(g, B(0.14, 0.52, 0.26, 0.01), 'steel', -2.15, 0.52, 0.1);
  add(g, C(0.09, 0.26, 12), 'blue', -2.45, 0.32, 0.55, 0, 0, Math.PI / 2); add(g, C(0.075, 0.2, 12), 'grey70', -2.2, 0.32, 0.55, 0, 0, Math.PI / 2);
  add(g, B(0.28, 0.3, 0.2, 0.03), 'hdpe', -2.0, 1.4, -0.7); add(g, C(0.04, 0.03, 10), 'black', -2.0, 1.565, -0.7);
  add(g, B(0.12, 0.6, 0.45, 0.01), 'grey70', -1.85, 1.3, 0.3);
  pipePath(g, [v(-2.35, 0.7, -0.6), v(-2.35, 1.7, -0.6), v(-2.85, 1.7, -0.6)], 0.012, 'copper', 0.05, 6);
  pipePath(g, [v(-2.6, 0.56, -0.3), v(-2.6, 0.9, -0.3), v(-2.15, 0.9, -0.3), v(-2.15, 0.9, 0.05)], 0.012, 'copper', 0.05, 6);
  pipePath(g, [v(-2.2, 0.215, FZ + 0.075), v(-2.45, 0.215, FZ + 0.075), v(-2.45, 0.215, 0.7)], 0.028, 'blue', 0.07, 8);
  pipePath(g, [v(-2.2, 0.215, FZ + 0.15), v(-2.6, 0.215, FZ + 0.15), v(-2.6, 0.5, FZ + 0.15), v(-2.6, 0.5, 0.2), v(-2.2, 0.5, 0.2)], 0.028, 'steel', 0.07, 8);
  pipePath(g, [v(-2.0, 1.25, -0.7), v(-2.0, 0.8, -0.7), v(-2.0, 0.8, 0.0)], 0.014, 'rubber', 0.05, 6);
  const parts = bake(g);
  // instance transforms
  const mods = [], faces = [], conns = [], jumps = [], hoses = [], leds = [], bms = [];
  const mk = (x, y, z, rz = 0) => new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromAxisAngle(v(0, 0, 1), rz), v(1, 1, 1));
  for (let i = 0; i < RACKS; i++) for (let k = 0; k < LEVELS; k++) {
    const xc = RX0 + (i + 0.5) * RP, y = MY0 + k * MP + MH / 2;
    mods.push(mk(xc, y, MZ)); faces.push(mk(xc, y, FZ + 0.0015));
    conns.push(mk(xc + 0.2, y + 0.03, FZ + 0.025), mk(xc - 0.2, y + 0.03, FZ + 0.025));
    if (k < LEVELS - 1) jumps.push(mk(xc + (k % 2 ? -0.2 : 0.2), y + 0.03 + MP / 2, FZ + 0.045));
    hoses.push(mk(xc - RP / 2 + 0.06, y - 0.06, FZ + 0.03), mk(xc + RP / 2 - 0.06, y - 0.06, FZ + 0.03));
    leds.push(mk(xc + 0.275, y + 0.085, FZ + 0.004));
  }
  for (let i = 0; i < RACKS; i++) for (let j = 0; j < 3; j++) bms.push(mk(RX0 + (i + 0.5) * RP - 0.15 + j * 0.04, MY0 + LEVELS * MP + 0.11, FZ + 0.025));
  for (const x of [-0.6, 1.8]) bms.push(mk(x + 0.045, H - 0.2, 0.5));
  const jump = new THREE.TorusGeometry(MP / 2, 0.009, 6, 8, Math.PI); jump.rotateZ(Math.PI / 2); jump.rotateY(Math.PI / 2);
  const conn = new THREE.CylinderGeometry(0.024, 0.027, 0.05, 10); conn.rotateX(Math.PI / 2);
  const hose = new THREE.CylinderGeometry(0.011, 0.011, 0.09, 6); hose.rotateZ(Math.PI / 2);
  return { parts, mods, faces, conns, jumps, hoses, leds, bms, geo: { jump, conn, hose, led: new THREE.BoxGeometry(0.014, 0.014, 0.006) } };
}
function instanced(geo, mat, mats, shadow) {
  const m = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((mm, i) => m.setMatrixAt(i, mm)); m.instanceMatrix.needsUpdate = true;
  m.castShadow = !!shadow; m.receiveShadow = !!shadow; m.computeBoundingSphere(); return m;
}

// ---------------------------------------------------------------- builder
export function buildBess({ id } = {}) {
  if (!_static) {
    _static = buildStatic();
    const box = new THREE.Box3(); [..._static.frame, ..._static.shell].forEach((p) => box.union(p.geometry.boundingBox));
    _static.size = box.getSize(new THREE.Vector3());
  }
  const group = new THREE.Group(), own = [], st = { status: 'standby', alarm: false, fan: 0, opacity: 1 };
  group.add(instantiate(_static.frame));
  const matMap = new Map(), shell = instantiate(_static.shell, matMap); group.add(shell);
  const fade = [...matMap.values()];
  fade.forEach((m) => { m.userData.baseT = m.transparent; m.userData.baseDW = m.depthWrite; });
  own.push(...fade);
  // stenciled id across the third door pair
  let idTex = null;
  if (id) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 112; const x = c.getContext('2d');
    x.fillStyle = '#2b3036'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.font = 'bold 96px ' + FONT; x.fillText(String(id).toUpperCase(), 256, 60, 500);
    x.globalCompositeOperation = 'destination-out'; for (let i = 18; i < 512; i += 37) x.fillRect(i, 0, 3, 112); x.fillRect(0, 57, 512, 3);
    idTex = new THREE.CanvasTexture(c); idTex.colorSpace = THREE.SRGBColorSpace; idTex.anisotropy = 8;
    const m = new THREE.MeshStandardMaterial({ map: idTex, transparent: true, alphaTest: 0.35, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.userData.baseT = true; m.userData.baseDW = true; fade.push(m); own.push(m);
    const xm = XS + 2 * (PW + MUL) + PW / 2;
    const d = new THREE.Mesh(planeGeo(0.56, 0.1225), m); d.position.set(xm - PW / 4 - 0.06, 2.33, hz + 0.0065); d.receiveShadow = true; shell.add(d);
    const d2 = new THREE.Mesh(planeGeo(1.3, 0.285), m); d2.position.set(0.4, 1.75, -hz - 0.0); d2.rotation.y = Math.PI; d2.position.z = -hz + 0.012; shell.add(d2);
  }
  // fans
  const rotors = [];
  const rotMat = M('dark');
  for (const z of [-0.56, 0.56]) { const piv = new THREE.Group(); piv.position.set(-hx + 0.0, 2.08, z); piv.rotation.z = Math.PI / 2; const r = new THREE.Mesh(rotorGeo(), rotMat); r.rotation.y = z; piv.add(r); group.add(piv); rotors.push(r); }
  // status bar and strobe
  const barMat = new THREE.MeshStandardMaterial({ color: 0x111417, emissive: STATUS.standby, emissiveIntensity: 0.5, roughness: 0.4 });
  const bar = new THREE.Mesh(B(0.5, 0.03, 0.012, 0.004), barMat); bar.position.set(1.9, H - 0.0575, hz + 0.03); group.add(bar);
  const strobeMat = new THREE.MeshStandardMaterial({ color: 0xd98a1a, emissive: 0xf5a623, emissiveIntensity: 0.05, roughness: 0.25, transparent: true, opacity: 0.92 });
  const strobe = new THREE.Mesh(C(0.05, 0.08, 14, 0.042), strobeMat); strobe.position.set(2.6, H + 0.23, hz - 0.08); group.add(strobe);
  const cap = new THREE.Mesh(sphereGeo(0.042, 14, 5, Math.PI / 2), strobeMat); cap.position.set(2.6, H + 0.27, hz - 0.08); cap.scale.y = 0.6; group.add(cap);
  own.push(barMat, strobeMat);

  let interior = null, ledMat = null, bmsMat = null;
  function buildInterior() {
    if (!_interior) _interior = buildInteriorStatic();
    if (!_modFace) _modFace = LBL.module();
    const I = _interior; interior = instantiate(I.parts);
    interior.add(instanced(B(MW, MH, MD, 0.012), M('module'), I.mods, true));
    interior.add(instanced(planeGeo(MW - 0.02, MH - 0.02), _modFace, I.faces));
    interior.add(instanced(I.geo.conn, M('orange'), I.conns));
    interior.add(instanced(I.geo.jump, M('orange'), I.jumps));
    interior.add(instanced(I.geo.hose, M('rubber'), I.hoses));
    ledMat = new THREE.MeshBasicMaterial({ color: STATUS[st.status], toneMapped: false });
    bmsMat = new THREE.MeshBasicMaterial({ color: 0x3ddc84, toneMapped: false });
    interior.add(instanced(I.geo.led, ledMat, I.leds)); interior.add(instanced(I.geo.led, bmsMat, I.bms));
    own.push(ledMat, bmsMat);
    group.add(interior);
  }
  const col = new THREE.Color();
  group.userData = {
    kind: 'bess', id,
    size: { x: _static.size.x, y: _static.size.y, z: _static.size.z },
    hudAnchor: v(0, H + 0.55, 0),
    focus: { center: v(0, H / 2, 0), radius: 3.6 },
    setEnclosureOpacity(a) {
      a = Math.min(1, Math.max(0, a)); st.opacity = a;
      if (a < 1 && !interior) buildInterior();
      if (interior) interior.visible = a < 0.999;
      shell.visible = a > 0.01;
      const solid = a >= 0.999;
      for (const m of fade) {
        const t = !solid || m.userData.baseT, dw = m.userData.baseDW && a > 0.55;
        if (m.transparent !== t) { m.transparent = t; m.needsUpdate = true; }
        m.opacity = a; m.depthWrite = dw;
      }
      shell.traverse((o) => { if (o.isMesh) { if (o.userData.cast === undefined) o.userData.cast = o.castShadow; o.castShadow = o.userData.cast && a > 0.5; } });
    },
    setStatus(s) { if (STATUS[s] === undefined) return; st.status = s; barMat.emissive.setHex(STATUS[s]); if (ledMat) ledMat.color.setHex(s === 'standby' ? 0x3ddc84 : STATUS[s]); },
    setAlarm(on) { st.alarm = !!on; },
    update(dt, t, tel) {
      const hv = tel && tel.tags && tel.tags.hvac_state && tel.tags.hvac_state.value;
      const cooling = hv ? hv === 'cooling' : st.status === 'running';
      st.fan += ((cooling ? 34 : 0) - st.fan) * Math.min(1, dt * 1.2);
      if (st.fan > 0.01) { rotors[0].rotation.y += st.fan * dt; rotors[1].rotation.y -= st.fan * dt; }
      const s = st.status;
      barMat.emissiveIntensity = s === 'running' ? 2.2 : s === 'standby' ? 0.45 : s === 'fault' ? 0.4 + 2.6 * (0.5 + 0.5 * Math.sin(t * 6.5)) : 1.6 + 0.4 * Math.sin(t * 1.6);
      const ph = (t * 1.3) % 1, flash = st.alarm && (ph < 0.07 || (ph > 0.16 && ph < 0.23));
      strobeMat.emissiveIntensity = flash ? 9 : st.alarm ? 0.3 : 0.05;
      if (interior && interior.visible) {
        bmsMat.color.setHex(0x3ddc84).multiplyScalar(((t * 2.2) % 1) < 0.6 ? 1 : 0.15);
        if (s === 'fault') ledMat.color.copy(col.setHex(STATUS.fault)).multiplyScalar(0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 6.5)));
      }
    },
    dispose() {
      own.forEach((m) => m.dispose()); if (idTex) idTex.dispose();
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
    },
  };
  return group;
}
