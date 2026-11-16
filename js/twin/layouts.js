// Site layouts: turns Sim.assets(siteId) plus the model builders into a placed THREE.Group.
// World frame: +X east, -Z north, Y up. The site pin (lat/lon) is the world origin.
import * as THREE from 'three';
import { placeholderAsset, placeholderProp, placeholderRun, placeholderFence } from './placeholders.js';
import { paintGround } from './ground.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GENSET_GAP = 4.5;      // clear aisle between neighboring units, m
const TRAY_H = 0.6;          // placeholder cable tray height, m
const PIPE_H = 0.45;         // gas pipe run height, m
const GAS_YELLOW = 0xe2b21c;

// ---- model modules -------------------------------------------------------------------------

export async function loadModels() {
  const out = { genset: null, bess: null, yard: null, buildings: null, missing: [] };
  await Promise.all(['genset', 'bess', 'yard', 'buildings'].map(async (name) => {
    try {
      out[name] = await import('./models/' + name + '.js');
    } catch (err) {
      out.missing.push(name);
      console.info('[twin] model module "' + name + '" unavailable, using placeholders (' + (err && err.message) + ')');
    }
  }));
  return out;
}

function pickFn(mod, names) {
  if (!mod) return null;
  for (const n of names) if (typeof mod[n] === 'function') return mod[n];
  return null;
}

// Calls a builder defensively. Returns null if it is missing, throws or returns a non-Object3D.
function tryBuild(mod, names, opts) {
  const fn = pickFn(mod, names);
  if (!fn) return null;
  try {
    const o = fn(opts);
    if (o && o.isObject3D) {
      if (!o.userData) o.userData = {};
      return o;
    }
  } catch (err) {
    console.warn('[twin] ' + names[0] + ' failed, using placeholder:', err);
  }
  return null;
}

function sizeOf(obj, fx, fy, fz) {
  const s = obj && obj.userData && obj.userData.size;
  if (s && isFinite(s.x) && isFinite(s.z)) return { x: s.x, y: isFinite(s.y) ? s.y : fy, z: s.z };
  return { x: fx, y: fy, z: fz };
}

function makeAsset(M, a) {
  const opts = { id: a.id, unit: a.unit, status: a.status, model: a.model, kind: a.kind };
  let obj = a.kind === 'bess'
    ? tryBuild(M.bess, ['buildBess', 'buildBESS', 'buildBattery', 'build', 'default'], opts)
    : tryBuild(M.genset, ['buildGenset', 'build', 'default'], opts);
  if (!obj) obj = placeholderAsset(opts);
  const ud = obj.userData;
  const s = sizeOf(obj, a.kind === 'bess' ? 6.06 : 12.2, a.kind === 'bess' ? 2.9 : 4.2, a.kind === 'bess' ? 2.44 : 3.0);
  ud.size = s;
  if (!ud.hudAnchor || !ud.hudAnchor.isVector3) ud.hudAnchor = V(0, s.y + 0.6, 0);
  if (!ud.focus || !ud.focus.center) ud.focus = { center: V(0, s.y * 0.5, 0), radius: Math.hypot(s.x, s.y, s.z) * 0.5 };
  for (const f of ['setEnclosureOpacity', 'setStatus', 'update', 'dispose']) if (typeof ud[f] !== 'function') ud[f] = function () {};
  ud.id = a.id;
  ud.kind = a.kind === 'bess' ? 'bess' : 'genset';
  return obj;
}

// ---- yard furniture wrappers ---------------------------------------------------------------

function prop(M, names, opts, ph) {
  return tryBuild(M.yard, names, opts) || placeholderProp(names[0], ph[0], ph[1], ph[2], ph[3]);
}
const switchgear = (M, sections) => prop(M, ['buildSwitchgear'], { sections }, [sections * 1.1 + 1.5, 3.2, 3.6, 0xb9bfc4]);
const transformer = (M, mva) => prop(M, ['buildTransformer'], { mva }, [3.6, 3.4, 2.8, 0x7e8a80]);
const gasSkid = (M) => prop(M, ['buildGasSkid'], {}, [5, 2, 2.4, 0xa9a48f]);
const lightPole = (M, height) => prop(M, ['buildLightPole'], { height }, [0.25, height, 0.25, 0x8d949a]);
const bollard = (M) => prop(M, ['buildBollard'], {}, [0.17, 1.05, 0.17, 0xe2b21c]);
const ureaTank = (M) => prop(M, ['buildUreaTank'], {}, [3.2, 2.8, 2.4, 0xe6e9ea]);
const controlTrailer = (M) => prop(M, ['buildControlTrailer'], {}, [9.5, 3.1, 2.8, 0xdfe2e3]);

function cableTray(M, points) {
  const pts = points.map((p) => V(p.x, 0, p.z));
  return tryBuild(M.yard, ['buildCableTray'], { points: pts }) || placeholderRun(pts.map((p) => V(p.x, TRAY_H, p.z)), 0.22, 0x9aa3ab, 0);
}
function pipeRun(M, points, radius) {
  const pts = points.map((p) => V(p.x, 0, p.z));
  return tryBuild(M.yard, ['buildPipeRun'], { points: pts, radius: radius || 0.08, color: GAS_YELLOW }) || placeholderRun(pts.map((p) => V(p.x, PIPE_H, p.z)), radius || 0.08, GAS_YELLOW, 0);
}
function fence(M, points, gates) {
  return tryBuild(M.yard, ['buildFence'], { points, height: 2.4, gates }) || placeholderFence(points, 2.4);
}

// Flat surface painted in one non-tiling canvas: the yard base (compacted gravel) and roads.
// Also the fallback when yard.js buildPad is unavailable.
function flatSlab(w, d, kind, y) {
  const spec = { concrete: [0xb4b1aa, 0.07], gravel: [0xa39b8c, 0.3], asphalt: [0x4a4b4e, 0.14], road: [0xb5ab97, 0.22] }[kind] || [0x9a988f, 0.16];
  const tex = paintGround(Math.max(w, d) > 60 ? 2048 : 1024, new THREE.Color(spec[0]), { grit: spec[1], seed: Math.round(w * 13 + d * 7) });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({ map: tex, bumpMap: tex, bumpScale: kind === 'gravel' ? 0.6 : 0.25, roughness: kind === 'asphalt' ? 0.88 : 0.96, metalness: 0, envMapIntensity: 0.6 })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = y || 0.02;
  m.receiveShadow = true;
  m.userData = { kind: 'prop', dispose() { m.geometry.dispose(); m.material.dispose(); tex.dispose(); } };
  return m;
}
function pad(M, w, d, kind, y) {
  const p = tryBuild(M.yard, ['buildPad'], { w, d, kind });
  if (p) { p.position.y += y || 0; return p; }
  return flatSlab(w, d, kind, (y || 0) + 0.02);
}

// ---- generator yard --------------------------------------------------------------------------
// Yard-local frame: +X east, +Z south. Units keep the model convention (long axis X, service
// side +Z, cable box on the -X end, gas train on the +X end) and are turned so cable ends
// face the power spine. Returns a group whose origin is the center of the occupied area.
//
// o.arrange: 'rows' (side by side, o.rows = 1 or 2 back-to-back rows) or 'inline' (end to end)
// o.elec:    'line' ([transformers][switchgear][batteries] in one line-up) or 'tiered'
//            (switchgear flanked by battery columns, transformers behind)
// o.margin:  clear strip between the equipment and the fence, a number or { x, z }
// o.entryGap, o.skidGap: distance from the row ends to the switchgear line-up and to the gas
//            skid (rows layouts). Smaller values make a shorter yard for a tight site.
async function buildYard(M, gensets, batteries, o, slice) {
  const g = new THREE.Group();
  const placed = [];
  const bounds = new THREE.Box2();
  const grow = (x, z, hx, hz) => { bounds.expandByPoint(new THREE.Vector2(x - hx, z - hz)); bounds.expandByPoint(new THREE.Vector2(x + hx, z + hz)); };
  const add = (obj, x, z, ry) => { obj.position.x += x; obj.position.z += z; if (ry) obj.rotation.y = ry; g.add(obj); return obj; };
  const name = o.yardName || 'Yard A';

  const objs = [];
  for (const a of gensets) { objs.push(makeAsset(M, a)); await slice(); }
  const bessObjs = [];
  for (const a of batteries) { bessObjs.push(makeAsset(M, a)); await slice(); }
  const gl = objs.length ? Math.max(...objs.map((x) => x.userData.size.x)) : 12.2;
  const gw = objs.length ? Math.max(...objs.map((x) => x.userData.size.z)) : 3.0;
  const inline = o.arrange === 'inline';
  const rows = inline ? 1 : (o.rows || 1);
  const n = objs.length;

  // --- gensets, and where each one's cable and gas ends are ---
  const cableEnds = [], gasEnds = [];
  let power, gas, entry, entryDir, skidAt, north = null, slabs = [];
  if (inline) {
    const pitchX = gl + 3.6;
    const x0 = -((n - 1) * pitchX) / 2;
    objs.forEach((obj, i) => {
      const x = x0 + i * pitchX;
      add(obj, x, 0, Math.PI);
      grow(x, 0, gl / 2, gw / 2);
      cableEnds.push(V(x + gl / 2, 0, 0)); gasEnds.push(V(x - gl / 2, 0, 0));
      placed.push({ id: gensets[i].id, kind: 'genset', object: obj, slot: name + ' \u00b7 slot ' + (i + 1) });
    });
    const zP = -(gw / 2 + 2.3), zG = gw / 2 + 2.3, xE = x0 + (n - 1) * pitchX + gl / 2 + 7;
    power = { axis: 'x', at: zP, from: x0 + gl / 2 + 1.1, to: xE };
    gas = [{ axis: 'x', at: zG, from: x0 - gl / 2 - 7, to: x0 + (n - 1) * pitchX - gl / 2 - 1.1 }];
    entry = V(xE, 0, zP); entryDir = 'east';
    skidAt = V(x0 - gl / 2 - 9, 0, zG);
    slabs = [[0, 0, n * pitchX + 1, gw + 2.6]];
  } else {
    const pitch = gw + GENSET_GAP;
    const perRow = Math.max(1, Math.ceil(n / rows));
    const L = (perRow - 1) * pitch;
    const rowX = rows === 1 ? [0] : [-(gl / 2 + 2.8), gl / 2 + 2.8];
    objs.forEach((obj, i) => {
      const r = Math.floor(i / perRow), k = i % perRow;
      const x = rowX[r], z = -L / 2 + k * pitch;
      const east = rows === 1 || r === 0;           // cable end points east (toward the spine)
      add(obj, x, z, east ? Math.PI : 0);
      grow(x, z, gl / 2, gw / 2);
      cableEnds.push(V(x + (east ? 1 : -1) * gl / 2, 0, z)); gasEnds.push(V(x - (east ? 1 : -1) * gl / 2, 0, z));
      placed.push({ id: gensets[i].id, kind: 'genset', object: obj, slot: name + (rows > 1 ? ' \u00b7 row ' + 'AB'[r] : '') + ' \u00b7 slot ' + (k + 1) });
    });
    const spineX = rows === 1 ? gl / 2 + 2.2 : 0;
    const zS = L / 2 + gw / 2, zN = -zS;
    const sideElec = o.elec === 'side';
    const eGap = o.entryGap || 6, sGap = o.skidGap || 9.5, headGap = Math.min(4.5, sGap - 4);
    power = { axis: 'z', at: spineX, from: -L / 2, to: sideElec ? L / 2 : zS + eGap };
    gas = (rows === 1 ? [-(gl / 2 + 1.8)] : [rowX[0] - gl / 2 - 1.8, rowX[1] + gl / 2 + 1.8]).map((x) => ({ axis: 'z', at: x, from: zN - (rows === 1 ? 1.5 : headGap), to: L / 2 + 0.9 }));
    if (sideElec) { entry = V(spineX + 0.6, 0, 0); entryDir = 'east'; } else { entry = V(spineX, 0, zS + eGap); entryDir = 'south'; }
    // support strip: beside the gas skid at the north end, or (when the electrical line-up
    // runs down the east side) across the south end of the row
    north = sideElec ? { x: gas[0].at + 3, z: zS + 4.0 } : { x: (rows === 1 ? gas[0].at - 1.5 : 0) + 8, z: zN - (sGap - 1) };
    skidAt = V(rows === 1 ? gas[0].at : 0, 0, zN - sGap);
    slabs = rowX.map((x) => [x, 0, gl + 2.4, L + gw + 3]);
  }
  if (o.slabs !== false) {
    let topY = 0;
    slabs.forEach((s) => { const p = pad(M, s[2], s[3], 'concrete', 0.03); add(p, s[0], s[1]); topY = Math.max(topY, (p.userData.topY || 0.05) + 0.03); });
    objs.forEach((q) => { q.position.y += topY; });       // units stand on the slab, not in it
  }

  // --- electrical block, built in its own frame: origin = power entry, +Z away from the units ---
  const eg = new THREE.Group();
  const eb = new THREE.Box2();
  const egrow = (x, z, hx, hz) => { eb.expandByPoint(new THREE.Vector2(x - hx, z - hz)); eb.expandByPoint(new THREE.Vector2(x + hx, z + hz)); };
  const eadd = (obj, x, z, ry) => { obj.position.x += x; obj.position.z += z; if (ry) obj.rotation.y = ry; eg.add(obj); return obj; };
  const nSw = o.swgr || 0, nTx = o.xfmr || 0;
  const sw = [], tx = [];
  for (let i = 0; i < nSw; i++) sw.push(switchgear(M, o.sections || 6));
  for (let i = 0; i < nTx; i++) tx.push(transformer(M, o.mva || 10));
  await slice();
  const swS = sw.length ? sizeOf(sw[0], 8, 3.2, 3.6) : { x: 0, y: 0, z: 0 };
  const txS = tx.length ? sizeOf(tx[0], 3.6, 3.4, 2.8) : { x: 0, y: 0, z: 0 };
  const bS = bessObjs.length ? bessObjs[0].userData.size : { x: 0, y: 0, z: 0 };
  const swW = nSw ? nSw * swS.x + (nSw - 1) * 3 : 0;
  const swZ = swS.z / 2 + 1.2;
  sw.forEach((q, i) => { const x = -swW / 2 + swS.x / 2 + i * (swS.x + 3); eadd(q, x, swZ); egrow(x, swZ, swS.x / 2, swS.z / 2); });
  const bessAt = [];
  if (o.elec === 'tiered') {
    // battery columns on both flanks of the switchgear, transformers in a second tier
    const colX = swW / 2 + 4.5 + bS.x / 2, pz = bS.z + 2.4;
    const perCol = Math.ceil(bessObjs.length / 2);
    bessObjs.forEach((q, i) => { const side = i < perCol ? -1 : 1, k = i < perCol ? i : i - perCol; bessAt.push([side * colX, 1.2 + bS.z / 2 + k * pz]); });
    const tz = swS.z + 1.2 + 7 + txS.z / 2, pitchT = txS.x + 5;
    tx.forEach((q, i) => { const x = (i - (nTx - 1) / 2) * pitchT; eadd(q, x, tz); egrow(x, tz, txS.x / 2 + 1.2, txS.z / 2 + 1.2); eg.add(cableTray(M, [V(x, 0, swS.z + 1.2), V(x, 0, tz - txS.z / 2)])); });
    if (bessObjs.length) [-1, 1].forEach((sd) => eg.add(cableTray(M, [V(sd * swW / 2, 0, swZ), V(sd * (colX - bS.x / 2), 0, swZ)])));
  } else {
    const txW = nTx ? nTx * txS.x + (nTx - 1) * 4.5 : 0;
    const txX0 = -swW / 2 - 5 - txW;
    tx.forEach((q, i) => { const x = txX0 + txS.x / 2 + i * (txS.x + 4.5); eadd(q, x, swZ); egrow(x, swZ, txS.x / 2 + 1.2, txS.z / 2 + 1.2); });
    if (nTx && nSw) eg.add(cableTray(M, [V(-swW / 2, 0, swZ), V(txX0 + txW, 0, swZ)]));
    const cols = Math.min(3, bessObjs.length), bx0 = (nSw ? swW / 2 + 5 : -(cols * bS.x + (cols - 1) * 2.2) / 2);
    const pz = bS.z + 2.4, rowsB = Math.ceil(bessObjs.length / 3);
    bessObjs.forEach((q, i) => { bessAt.push([bx0 + bS.x / 2 + (i % 3) * (bS.x + 2.2), swZ - ((rowsB - 1) * pz) / 2 + Math.floor(i / 3) * pz]); });
    if (bessObjs.length && nSw) eg.add(cableTray(M, [V(swW / 2, 0, swZ), V(bx0, 0, swZ)]));
  }
  bessObjs.forEach((q, i) => {
    eadd(q, bessAt[i][0], bessAt[i][1]);
    egrow(bessAt[i][0], bessAt[i][1], bS.x / 2, bS.z / 2);
    if (o.slabs !== false) { const p = pad(M, bS.x + 1.2, bS.z + 1.0, 'concrete', 0.03); eadd(p, bessAt[i][0], bessAt[i][1]); q.position.y += (p.userData.topY || 0.05) + 0.03; }
    placed.push({ id: batteries[i].id, kind: 'bess', object: q, slot: name + ' \u00b7 battery bay ' + (i + 1) });
  });
  tx.forEach((t) => {
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach((c) => eadd(bollard(M), t.position.x + c[0] * (txS.x / 2 + 0.9), t.position.z + c[1] * (txS.z / 2 + 0.9)));
  });
  if (!eb.isEmpty()) {
    // 'south': block frame equals yard frame. 'east': turned so its +Z points east.
    const ry = entryDir === 'east' ? Math.PI / 2 : 0;
    eg.rotation.y = ry;
    eg.position.set(entry.x, 0, entry.z);
    g.add(eg);
    [[eb.min.x, eb.min.y], [eb.max.x, eb.min.y], [eb.min.x, eb.max.y], [eb.max.x, eb.max.y]].forEach((c) => {
      const p = V(c[0], 0, c[1]).applyAxisAngle(V(0, 1, 0), ry).add(entry);
      grow(p.x, p.z, 0.5, 0.5);
    });
  }

  // --- cable trays: every unit drops onto the power spine, the spine runs to the switchgear ---
  if (n && nSw) {
    cableEnds.forEach((c) => {
      if (power.axis === 'z') { if (Math.abs(c.x - power.at) > 0.5) g.add(cableTray(M, [V(c.x - Math.sign(c.x - power.at) * 0.5, 0, c.z), V(power.at, 0, c.z)])); }
      else g.add(cableTray(M, [V(c.x - 0.4, 0, 0), V(c.x + 1.1, 0, 0), V(c.x + 1.1, 0, power.at)]));
    });
    g.add(cableTray(M, power.axis === 'z' ? [V(power.at, 0, power.from), V(power.at, 0, power.to)] : [V(power.from, 0, power.at), V(power.to, 0, power.at)]));
  }

  // --- gas: skid, header, one spine per row, a drop to every unit ---
  if (o.gas !== false && n) {
    const skid = gasSkid(M);
    const sS = sizeOf(skid, 5, 2, 2.4);
    if (inline) {
      add(skid, skidAt.x, skidAt.z);
      grow(skidAt.x, skidAt.z, sS.x / 2 + 0.8, sS.z / 2 + 0.8);
      const sp = gas[0];
      g.add(pipeRun(M, [V(skidAt.x + sS.x / 2, 0, sp.at), V(sp.to, 0, sp.at)], 0.1));
      gasEnds.forEach((c) => g.add(pipeRun(M, [V(c.x - 1.1, 0, sp.at), V(c.x - 1.1, 0, 0.6), V(c.x + 0.2, 0, 0.6)], 0.05)));
      for (let i = -1; i <= 1; i++) add(bollard(M), skidAt.x + i * 1.6, skidAt.z + sS.z / 2 + 1.3);
    } else if (rows === 1) {
      // single row: the skid sits in line with the gas spine, long axis along it
      const z = gas[0].from - 1.2 - sS.x / 2;
      add(skid, skidAt.x, z, Math.PI / 2);
      grow(skidAt.x, z, sS.z / 2 + 0.8, sS.x / 2 + 0.8);
      g.add(pipeRun(M, [V(gas[0].at, 0, z + sS.x / 2), V(gas[0].at, 0, gas[0].to)], 0.09));
      gasEnds.forEach((c) => g.add(pipeRun(M, [V(gas[0].at, 0, c.z + 0.9), V(c.x + Math.sign(gas[0].at - c.x) * 0.2, 0, c.z + 0.9)], 0.05)));
      for (let i = -1; i <= 1; i++) add(bollard(M), skidAt.x + sS.z / 2 + 1.3, z + i * 1.6);
    } else {
      add(skid, skidAt.x, skidAt.z);
      grow(skidAt.x, skidAt.z, sS.x / 2 + 0.8, sS.z / 2 + 0.8);
      const headZ = gas[0].from;
      g.add(pipeRun(M, [V(skidAt.x, 0, skidAt.z + sS.z / 2), V(skidAt.x, 0, headZ)], 0.11));
      const xs = gas.map((q) => q.at).concat([skidAt.x]);
      g.add(pipeRun(M, [V(Math.min(...xs), 0, headZ), V(Math.max(...xs), 0, headZ)], 0.11));
      gas.forEach((q) => g.add(pipeRun(M, [V(q.at, 0, headZ), V(q.at, 0, q.to)], 0.09)));
      gasEnds.forEach((c) => {
        const x = gas.reduce((b2, q) => (Math.abs(q.at - c.x) < Math.abs(b2 - c.x) ? q.at : b2), gas[0].at);
        g.add(pipeRun(M, [V(x, 0, c.z + 0.9), V(c.x + Math.sign(x - c.x) * 0.2, 0, c.z + 0.9)], 0.05));
      });
      for (let i = -2; i <= 2; i++) add(bollard(M), skidAt.x + i * 1.5, skidAt.z + sS.z / 2 + 1.6);
    }
  }

  // --- support equipment: beside the gas skid on the north strip, or along the open side ---
  if (o.urea) {
    const u = ureaTank(M); const us = sizeOf(u, 3.2, 2.8, 2.4);
    const x = inline ? -8 : north.x, z = inline ? -(gw / 2 + 6) : north.z;
    add(u, x, z); grow(x, z, us.x / 2 + 1, us.z / 2 + 1);
  }
  if (o.trailer) {
    const t = controlTrailer(M); const ts = sizeOf(t, 9.5, 3.1, 2.8);
    const x = inline ? 6 : north.x + (o.urea ? 8.6 : 1.5), z = inline ? -(gw / 2 + 6) : north.z;
    add(t, x, z); grow(x, z, ts.x / 2 + 1, ts.z / 2 + 1);
  }

  // --- recentre, then surface, fence, lights, road ---
  if (bounds.isEmpty()) grow(0, 0, 5, 5);
  const m = o.margin != null ? o.margin : 3.0;
  const mx = isFinite(m) ? m : m.x, mz = isFinite(m) ? m : m.z;
  const cx = (bounds.min.x + bounds.max.x) / 2, cz = (bounds.min.y + bounds.max.y) / 2;
  const hw = (bounds.max.x - bounds.min.x) / 2 + mx, hd = (bounds.max.y - bounds.min.y) / 2 + mz;
  g.children.forEach((c) => { c.position.x -= cx; c.position.z -= cz; });
  // yard.js gravel pads carry a tyre-track tile that repeats visibly at yard scale, so the
  // yard base is one painted surface instead
  if (o.surface !== false) g.add(flatSlab(hw * 2 + 2, hd * 2 + 2, o.surface || 'gravel', 0.035));
  if (o.fence !== false) {
    const pts = [V(-hw, 0, -hd), V(hw, 0, -hd), V(hw, 0, hd), V(-hw, 0, hd), V(-hw, 0, -hd)];
    g.add(fence(M, pts, [{ segment: 1, t: 0.72, width: 6, open: 0 }]));
  }
  const poles = [];
  if (o.lights !== false) {
    const nz = Math.max(2, Math.round((hd * 2) / 36) + 1);
    for (let i = 0; i < nz; i++) {
      const z = -hd + 1.3 + (i * (hd * 2 - 2.6)) / (nz - 1);
      [-hw + 1.3, hw - 1.3].forEach((x, j) => { const p = lightPole(M, o.poleHeight || 10); p.position.set(x, 0, z); p.rotation.y = j === 0 ? 0 : Math.PI; g.add(p); poles.push(p); });   // lamp heads (model +X) face into the yard
    }
  }
  if (o.road) {
    const rw = 6.5, gap = 3.5, y = 0.012;
    [[0, -hd - gap - rw / 2, hw * 2 + 2 * (rw + gap), rw], [0, hd + gap + rw / 2, hw * 2 + 2 * (rw + gap), rw],
      [-hw - gap - rw / 2, 0, rw, hd * 2 + 2 * gap], [hw + gap + rw / 2, 0, rw, hd * 2 + 2 * gap]].forEach((r) => {
      const sl = flatSlab(r[2], r[3], 'road', y); sl.position.x = r[0]; sl.position.z = r[1]; g.add(sl);
    });
  }
  const extra = o.road ? 10 : 0;
  g.userData.half = { x: hw + extra, z: hd + extra };
  g.userData.placed = placed;
  g.userData.poles = poles;
  return g;
}

// ---- per-site assembly ---------------------------------------------------------------------

export function siteKind(site) {
  const t = ((site && site.type) || '') + ' ' + ((site && site.id) || '');
  if (/hosp|medical/i.test(t)) return 'hospital';
  if (/test/i.test(t)) return 'testcell';
  if (/drill|well|pad\b|-pad/i.test(t)) return 'wellpad';
  return 'datacenter';
}

// No two sites share a building or a yard arrangement. Unknown sites get defaults from their type.
// place: { x, z, turn } puts the yard center at a building-local point with a fixed heading
// (degrees), for pads where the free ground is not the box the building reports as clear.
const SITE_SPEC = {
  'bigspring-hosp': { variant: 'regional', ground: 'westTexas', yard: { rows: 1, elec: 'side', swgr: 1, sections: 8, xfmr: 1, mva: 12, urea: true, trailer: true, margin: 1.5, yardName: 'Yard A' } },
  'midwest-dc': { variant: 'hyperscale', halls: 4, ground: 'midwest', yard: { rows: 2, elec: 'tiered', swgr: 2, sections: 14, xfmr: 3, mva: 30, urea: true, trailer: true, poleHeight: 12, yardName: 'Block 1' } },
  'odessa-dc': { variant: 'edge', halls: 1, ground: 'westTexas', yard: { rows: 1, elec: 'side', swgr: 1, sections: 6, xfmr: 1, mva: 12, urea: true, yardName: 'Yard A' } },
  'sa-dc': { variant: 'colo', halls: 2, ground: 'southTexas', yard: { rows: 2, elec: 'line', swgr: 1, sections: 6, xfmr: 1, mva: 12, trailer: true, margin: { x: 2.6, z: 1.2 }, entryGap: 3, skidGap: 7, yardName: 'Lot B' } },
  'midland-pad': { variant: 'frac', ground: 'westTexas', yard: { arrange: 'inline', swgr: 1, sections: 2, trailer: true, fence: false, surface: false, slabs: false, lights: false, margin: 2, yardName: 'Pad' } },
  'pecos-pad': { variant: 'drill', ground: 'westTexas', place: { x: 33, z: 21, turn: 90 }, yard: { rows: 1, elec: 'side', swgr: 1, sections: 2, fence: false, surface: false, slabs: false, lights: false, margin: 2, yardName: 'Pad' } },
  'tomball-tc': { variant: 'shop', ground: 'southTexas', yard: { rows: 1, gas: false, fence: false, surface: false, slabs: false, lights: false, margin: 1, yardName: 'Test pad' } }
};
const KIND_DEFAULT = {
  hospital: SITE_SPEC['bigspring-hosp'], datacenter: SITE_SPEC['odessa-dc'], wellpad: SITE_SPEC['midland-pad'], testcell: SITE_SPEC['tomball-tc']
};

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000000;
}

export function findSite(Sim, siteId) {
  try {
    const s = Sim && Sim.sites && Sim.sites();
    const list = (s && s.sites) || s || [];
    return list.find((x) => x.id === siteId) || null;
  } catch (e) { return null; }
}

function listAssets(Sim, siteId) {
  let list = [];
  try {
    if (Sim && typeof Sim.assets === 'function') list = Sim.assets(siteId) || [];
    else if (Sim && typeof Sim.siteGensets === 'function') list = Sim.siteGensets(siteId) || [];
  } catch (e) { list = []; }
  return list.map((a) => Object.assign({}, a, { kind: a.kind === 'bess' ? 'bess' : 'genset' }));
}

// Tries the variant first, then the plain builder, then a placeholder block.
function building(M, fnName, opts, ph) {
  return tryBuild(M.buildings, [fnName], opts)
    || (opts.variant ? tryBuild(M.buildings, [fnName], Object.assign({}, opts, { variant: undefined })) : null)
    || placeholderProp('building', ph[0], ph[1], ph[2], ph[3]);
}

export function siteSpec(siteId, kind) { return SITE_SPEC[siteId] || KIND_DEFAULT[kind] || KIND_DEFAULT.datacenter; }

// Returns { group, assets: [{id, kind, object, slot}], center, radius, siteRadius, viewAzimuth, ... }
export async function buildSite(siteId, ctx) {
  const M = ctx.models, Sim = ctx.Sim;
  // slice() yields to the browser when the build has used its frame budget, so a map
  // animation running underneath stays smooth while a 28 unit site is assembled.
  let last = performance.now();
  const slice = async () => {
    if (performance.now() - last < (ctx.budgetMs || 7)) return;
    await new Promise((r) => requestAnimationFrame(r));
    last = performance.now();
  };
  const site = findSite(Sim, siteId) || { id: siteId, type: '' };
  const kind = siteKind(site);
  const spec = siteSpec(siteId, kind);
  const seed = hashSeed(siteId);
  const all = listAssets(Sim, siteId);
  const gensets = all.filter((a) => a.kind === 'genset');
  const batteries = all.filter((a) => a.kind === 'bess');
  const group = new THREE.Group();
  group.name = 'site:' + siteId;

  const bo = { variant: spec.variant, seed };
  let backdrop;
  if (kind === 'hospital') backdrop = building(M, 'buildHospital', bo, [90, 28, 60, 0xd9d4c8]);
  else if (kind === 'datacenter') backdrop = building(M, 'buildDataCenter', Object.assign({ halls: spec.halls || 1 }, bo), spec.halls > 2 ? [220, 14, 110, 0xcfd3d6] : [90, 12, 60, 0xcfd3d6]);
  else if (kind === 'wellpad') backdrop = building(M, 'buildWellPad', bo, [110, 0.2, 90, 0xb9a98a]);
  else backdrop = building(M, 'buildTestCell', bo, [40, 10, 28, 0xc9ccce]);
  await slice();
  const yo = Object.assign({}, spec.yard);
  if (!yo.swgr && kind !== 'testcell') yo.swgr = 1;
  const yard = await buildYard(M, gensets, batteries, yo, slice);

  // Place the yard in the building's cleared yard area. yardAnchor = { position (near edge
  // midpoint, building-local), dir (unit vector into the yard), clear: { w across, d deep } }.
  // The yard is turned in quarter steps to whichever way overflows the clear area least,
  // with the electrical end toward the building when that is a tie.
  const bs = sizeOf(backdrop, 60, 12, 40);
  const half = yard.userData.half;
  const bud = backdrop.userData || {};
  const ya = bud.yardAnchor;
  const open = kind === 'wellpad' || kind === 'testcell';
  let anchor, turn = 0, yardY = 0;
  const pos = ya && (ya.position || ya);
  if (spec.place && SITE_SPEC[siteId] === spec) {
    turn = (spec.place.turn || 0) * Math.PI / 180;
    anchor = V(spec.place.x, 0, spec.place.z);
    yardY = pos && isFinite(pos.y) ? pos.y : 0;
  } else if (pos && isFinite(pos.x) && isFinite(pos.z)) {
    const dir = ya.dir && isFinite(ya.dir.x) ? V(ya.dir.x, 0, ya.dir.z).normalize() : V(1, 0, 0);
    const clear = ya.clear || { w: half.x * 2, d: half.z * 2 };
    const base = Math.atan2(dir.x, dir.z);                 // rotation that maps yard +Z onto dir
    let best = Infinity, depth = half.z * 2;
    [Math.PI, Math.PI / 2, 0, -Math.PI / 2].forEach((q) => {
      const sw = Math.abs(Math.sin(q)) > 0.7;
      const across = (sw ? half.z : half.x) * 2, dp = (sw ? half.x : half.z) * 2;
      const over = Math.max(0, across - clear.w) + Math.max(0, dp - clear.d);
      if (over < best - 0.5) { best = over; turn = base + q; depth = dp; }
    });
    anchor = V(pos.x, 0, pos.z).addScaledVector(dir, Math.max(clear.d, depth) / 2 + (depth > clear.d ? 1 : 0));
    yardY = isFinite(pos.y) ? pos.y : 0;
  } else {
    turn = (spec.yardTurn || 0) * Math.PI / 180;
    anchor = V(bs.x / 2 + half.x + (open ? 4 : 14), 0, 0);
  }
  yard.rotation.y = turn;
  yard.position.copy(anchor);
  yard.position.y = yardY;
  group.add(backdrop);
  group.add(yard);

  // The yard sits near the pin with the building beside it.
  group.position.set(-anchor.x * 0.6, 0, -anchor.z * 0.6);
  group.updateMatrixWorld(true);

  const assets = yard.userData.placed;
  const yc = yard.getWorldPosition(V(0, 0, 0));
  // the building's visual center: its focus sphere if it has one, else its origin
  const bf = bud.focus && bud.focus.center ? V(bud.focus.center.x, 0, bud.focus.center.z) : V(0, 0, 0);
  const bc = backdrop.localToWorld(bf);
  // frame the assets, not the whole fenced area
  const ac = V(0, 0, 0), tmp = V(0, 0, 0);
  assets.forEach((a) => ac.add(a.object.getWorldPosition(tmp)));
  if (assets.length) ac.multiplyScalar(1 / assets.length); else ac.copy(yc);
  let ar = 8;
  assets.forEach((a) => { ar = Math.max(ar, a.object.getWorldPosition(tmp).distanceTo(ac) + 7); });
  const yardR = Math.hypot(half.x, half.z);
  const radius = Math.max(16, ar * 0.6 + yardR * 0.4);
  const away = yc.clone().sub(bc);
  if (away.lengthSq() < 1) away.set(0.6, 0, 0.8);
  // Camera sits on the far side of the yard from the building, swung to one side, so the
  // building is the backdrop.
  const swing = (seed % 2 ? 1 : -1) * (kind === 'datacenter' ? 34 : 38);
  const viewAzimuth = Math.atan2(away.x, away.z) + THREE.MathUtils.degToRad(swing);
  const siteRadius = yc.distanceTo(bc) + Math.hypot(bs.x, bs.z) / 2 + yardR;
  const center = ac.clone().lerp(yc, 0.35).lerp(bc, open ? 0.15 : 0.06);
  center.y = 1.5 + yardY;

  return {
    siteId, site, kind, spec, seed, group, backdrop, yard, assets, poles: yard.userData.poles,
    center, radius, siteRadius, viewAzimuth, swing: Math.sign(swing), yardY,
    lat: site.lat, lon: site.lon
  };
}

export function disposeSite(layout) {
  if (!layout) return;
  // collect first: some models detach themselves from their parent in dispose()
  const list = [];
  layout.group.traverse((o) => { if (o.userData && typeof o.userData.dispose === 'function') list.push(o.userData); });
  list.forEach((ud) => { try { ud.dispose(); } catch (e) { /* ignore */ } });
}
