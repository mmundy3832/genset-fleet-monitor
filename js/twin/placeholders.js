// Fallback stand-ins used when a model module (js/twin/models/*.js) is missing, lacks an
// export, or throws. They implement the same userData API as the real models so the scene,
// camera and HUD code never has to special-case them.
import * as THREE from 'three';

const STATUS_COLOR = { running: 0x3ddc84, standby: 0xa9b8c8, fault: 0xf5a623, service: 0x6fd0ff };
const geoCache = new Map();
const matCache = new Map();

function box(w, h, d) {
  const k = w + '|' + h + '|' + d;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(k);
}
function mat(color, rough, metal) {
  const k = color + '|' + rough + '|' + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal || 0 }));
  return matCache.get(k);
}
function mesh(geo, material, x, y, z) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x || 0, y || 0, z || 0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function baseUserData(kind, id, sx, sy, sz) {
  return {
    kind, id, placeholder: true,
    size: { x: sx, y: sy, z: sz },
    hudAnchor: new THREE.Vector3(0, sy + 0.6, 0),
    focus: { center: new THREE.Vector3(0, sy * 0.5, 0), radius: Math.hypot(sx, sy, sz) * 0.5 },
    setEnclosureOpacity() {}, setStatus() {}, update() {}, dispose() {}
  };
}

// Genset or battery container stand-in with a fading shell, an inner block and a beacon.
export function placeholderAsset(opts) {
  opts = opts || {};
  const isBess = opts.kind === 'bess';
  const mobile = /-M$|2\.0/.test(opts.unit || '');
  const sx = isBess ? 6.06 : 12.2, sy = isBess ? 2.9 : 3.3, sz = isBess ? 2.44 : 3.0;
  const lift = mobile ? 1.25 : 0.25;
  const g = new THREE.Group();
  const shellMat = new THREE.MeshStandardMaterial({ color: isBess ? 0xe9ecee : 0xd5d9dc, roughness: 0.55, metalness: 0.35 });
  const shell = mesh(box(sx, sy, sz), shellMat, 0, lift + sy / 2, 0);
  g.add(shell);
  g.add(mesh(box(sx + 0.2, lift, sz * 0.9), mat(0x2b2f33, 0.8, 0.4), 0, lift / 2, 0));
  let exhaustTip = null;
  if (!isBess) {
    g.add(mesh(box(2.4, 0.9, 2.2), mat(0x8d949a, 0.5, 0.7), -3.2, lift + sy + 0.45, 0));
    g.add(mesh(box(0.5, 1.4, 0.5), mat(0x6b7278, 0.4, 0.8), 1.5, lift + sy + 0.7, 0.6));
    exhaustTip = new THREE.Vector3(1.5, lift + sy + 1.5, 0.6);
  }
  const inner = new THREE.Group();
  inner.visible = false;
  g.add(inner);
  let innerBuilt = false;
  function buildInner() {
    innerBuilt = true;
    if (isBess) {
      for (let i = 0; i < 5; i++) inner.add(mesh(box(0.9, sy * 0.8, sz * 0.7), mat(0x3a4650, 0.6, 0.5), -2.2 + i * 1.1, lift + sy * 0.45, 0));
    } else {
      inner.add(mesh(box(4.6, 1.9, 1.6), mat(0xc9a227, 0.5, 0.4), -0.6, lift + 1.2, 0));
      inner.add(mesh(box(2.6, 1.7, 1.7), mat(0x55606a, 0.5, 0.6), 3.4, lift + 1.1, 0));
      inner.add(mesh(box(1.2, 2.4, 2.4), mat(0x30363b, 0.7, 0.5), -4.6, lift + 1.4, 0));
    }
  }
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: STATUS_COLOR.standby, emissiveIntensity: 1 });
  const beacon = mesh(new THREE.SphereGeometry(0.12, 12, 8), beaconMat, sx / 2 - 0.3, lift + sy + 0.12, sz / 2 - 0.3);
  beacon.castShadow = false;
  g.add(beacon);

  let status = 'standby';
  const ud = baseUserData(isBess ? 'bess' : 'genset', opts.id, sx, sy + lift + (isBess ? 0 : 1.4), sz);
  ud.exhaustTip = exhaustTip;
  ud.setEnclosureOpacity = function (a) {
    a = Math.min(1, Math.max(0, a));
    if (a < 1 && !innerBuilt) buildInner();
    inner.visible = a < 0.999;
    shellMat.transparent = a < 0.999;
    shellMat.depthWrite = a > 0.6;
    shellMat.opacity = a;
    shell.visible = a > 0.01;
    shell.castShadow = a > 0.5;
  };
  ud.setStatus = function (s) {
    status = s;
    beaconMat.emissive.setHex(STATUS_COLOR[s] || STATUS_COLOR.standby);
  };
  ud.update = function (dt, t) {
    beaconMat.emissiveIntensity = status === 'fault' ? 1.2 + Math.sin(t * 6) * 1.0 : status === 'standby' ? 0.5 : 2.0;
  };
  ud.dispose = function () { shellMat.dispose(); beaconMat.dispose(); };
  g.userData = ud;
  if (opts.status) ud.setStatus(opts.status);
  return g;
}

// Generic static stand-in (switchgear, transformer, building and so on).
export function placeholderProp(name, sx, sy, sz, color) {
  const g = new THREE.Group();
  g.add(mesh(box(sx, sy, sz), mat(color || 0x9aa1a7, 0.7, 0.2), 0, sy / 2, 0));
  g.userData = baseUserData(name === 'building' ? 'building' : 'prop', undefined, sx, sy, sz);
  g.userData.propName = name;
  return g;
}

// Thin run between points (cable tray, pipe).
export function placeholderRun(points, radius, color, y) {
  const g = new THREE.Group();
  const m = mat(color, 0.5, 0.5);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    if (len < 0.01) continue;
    const seg = mesh(box(1, 1, 1), m, (a.x + b.x) / 2, (y || 0) + (a.y + b.y) / 2, (a.z + b.z) / 2);
    seg.scale.set(radius * 2, radius * 2, len + radius * 2);
    seg.lookAt(b.x, (y || 0) + b.y, b.z);
    g.add(seg);
  }
  g.userData = baseUserData('prop', undefined, 1, 1, 1);
  return g;
}

export function placeholderFence(points, height) {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.6, metalness: 0.6, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i], b = points[i + 1];
    const len = a.distanceTo(b);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(len, height), m);
    p.position.set((a.x + b.x) / 2, height / 2, (a.z + b.z) / 2);
    p.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    g.add(p);
  }
  g.userData = baseUserData('prop', undefined, 1, height, 1);
  return g;
}
