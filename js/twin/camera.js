// Camera rig: one spline-based flight system for every move (fly-in, fly-out, facility to
// asset arc, asset to asset dolly), with damped OrbitControls between flights.
//
// Every flight:
//  - starts from the CURRENT camera state (so retargeting mid-flight blends, never restarts),
//  - samples a designed orbit-space path into knots and runs position and look-target through
//    a uniform Catmull-Rom spline (C1 at every knot),
//  - is driven by elapsed time (requestAnimationFrame delta) through a quintic smootherstep,
//    so it starts and stops with zero velocity and zero acceleration,
//  - carries the camera's velocity at the moment it starts as a decaying offset, so a flight
//    that begins while the camera is already moving has no velocity discontinuity.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEG = Math.PI / 180;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smoother = (t) => { t = clamp01(t); return t * t * t * (t * (6 * t - 15) + 10); };
const window01 = (a, b, x) => smoother((x - a) / (b - a));
// Time warps (flight time 0..1 to path position 0..1). All start and stop at rest.
// 'in' picks up speed sooner, so the fly-in is already descending while the 2D map fades out
// instead of sitting still for half a second after the map's own zoom has stopped.
// 'out' is its mirror: it arrives without a long, nearly motionless tail before the map
// takes over again.
const WARP = {
  even: smoother,
  in: (x) => smoother(Math.pow(clamp01(x), 0.7)),
  out: (x) => 1 - smoother(Math.pow(1 - clamp01(x), 0.7))
};
const KNOTS = 25;            // knots per flight path
const DIM = 9;               // px py pz tx ty tz fov roll shift
const CARRY_T = 0.9;         // seconds over which carried-in velocity is absorbed

// Uniform Catmull-Rom over DIM-dimensional knots. C1 continuous, endpoints reflected.
function splineAt(knots, u, out) {
  const n = knots.length - 1;
  const x = clamp01(u) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const f = x - i;
  const p1 = knots[i], p2 = knots[i + 1];
  const p0 = i > 0 ? knots[i - 1] : null;
  const p3 = i + 2 <= n ? knots[i + 2] : null;
  const f2 = f * f, f3 = f2 * f;
  for (let d = 0; d < DIM; d++) {
    const a = p0 ? p0[d] : 2 * p1[d] - p2[d];
    const b = p1[d], c = p2[d];
    const e = p3 ? p3[d] : 2 * p2[d] - p1[d];
    out[d] = 0.5 * ((2 * b) + (-a + c) * f + (2 * a - 5 * b + 4 * c - e) * f2 + (-a + 3 * b - 3 * c + e) * f3);
  }
  return out;
}

// h(0)=0, h'(0)=1, h(T)=h'(T)=h''(T)=0: turns an initial velocity into a bounded, decaying offset.
function carry(t) {
  if (t >= CARRY_T) return 0;
  const k = 1 - t / CARRY_T;
  return t * k * k * k;
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class CameraRig {
  constructor(camera, dom, opts) {
    opts = opts || {};
    this.camera = camera;
    this.dom = dom;
    this.reducedMotion = !!opts.reducedMotion;
    this.target = new THREE.Vector3(0, 0, 0);
    this.roll = 0;
    this.shift = 0;                  // sideways view offset, fraction of the viewport width (+ moves the scene left)
    this.flight = null;
    this.mode = 'facility';
    this.limits = { center: new THREE.Vector3(), panRadius: 200 };
    this.lastInput = performance.now();
    this.idleOrbit = opts.idleOrbit !== false;
    this.idleDelay = 6;
    this.trace = null;               // set to [] to record per-frame camera state
    this.onUserInput = null;
    this._state = new Float64Array(DIM);
    this._prev = new Float64Array(DIM);
    this._vel = new Float64Array(DIM);
    this._tmp = new Float64Array(DIM);
    this._hasPrev = false;
    this._autoSpeed = 0;
    this._v = new THREE.Vector3();

    // Registered before OrbitControls so an interrupting pointerdown re-enables the controls
    // in time for OrbitControls to handle that same event.
    const interrupt = (e) => {
      this.lastInput = performance.now();
      if (this.flight && this.flight.interruptible) this.cancel();
      if (this.onUserInput) this.onUserInput(e);
    };
    dom.addEventListener('pointerdown', interrupt);
    dom.addEventListener('wheel', interrupt, { passive: true });
    dom.addEventListener('pointermove', () => { this.lastInput = performance.now(); }, { passive: true });
    dom.addEventListener('keydown', () => { this.lastInput = performance.now(); });

    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.085;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.panSpeed = 0.8;
    c.maxPolarAngle = 85 * DEG;
    c.minPolarAngle = 0.5 * DEG;
    c.minDistance = 10;
    c.maxDistance = 2500;
    c.autoRotate = false;
    c.enabled = false;
    this.controls = c;
  }

  get flying() { return !!this.flight; }

  // ---- poses ---------------------------------------------------------------------------------
  // pose = { target: Vector3, radius, polar (rad from +Y), azimuth (rad, 0 = camera due south
  // of target looking north), fov (deg), shift (optional, see this.shift) }

  currentPose() {
    const off = this._v.copy(this.camera.position).sub(this.target);
    const r = Math.max(0.001, off.length());
    return {
      target: this.target.clone(), radius: r,
      polar: Math.acos(THREE.MathUtils.clamp(off.y / r, -1, 1)),
      azimuth: Math.atan2(off.x, off.z), fov: this.camera.fov, shift: this.shift
    };
  }

  _posOf(target, radius, polar, az, out) {
    const s = Math.sin(polar);
    return out.set(target.x + radius * s * Math.sin(az), target.y + radius * Math.cos(polar), target.z + radius * s * Math.cos(az));
  }

  // Jump straight to a pose (no flight). Used for the fly-in start and reduced-motion cuts.
  setPose(pose) {
    this.flight = null;
    this.target.copy(pose.target);
    this._posOf(pose.target, pose.radius, pose.polar, pose.azimuth, this.camera.position);
    this.camera.fov = pose.fov;
    this.roll = 0;
    this.shift = pose.shift || 0;
    this._applyLook();
    this._hasPrev = false;
    this._vel.fill(0);
    this._clearControlInertia();
  }

  setLimits(l) {
    const c = this.controls;
    if (l.minDistance != null) c.minDistance = l.minDistance;
    if (l.maxDistance != null) c.maxDistance = l.maxDistance;
    if (l.center) this.limits.center.copy(l.center);
    if (l.panRadius != null) this.limits.panRadius = l.panRadius;
    if (l.mode) this.mode = l.mode;
  }

  // ---- flights -------------------------------------------------------------------------------
  // style: 'arc' | 'dolly' | 'flyIn' | 'flyOut'. Resolves true when the flight completes,
  // false if it was interrupted or replaced.
  flyTo(end, opts) {
    opts = opts || {};
    if (this.flight) this._finishFlight(false);
    const start = this.currentPose();
    const style = opts.style || 'arc';
    if (this.reducedMotion || opts.duration === 0) {
      this.setPose(end);
      if (opts.handoff !== false) this._handoff();
      return Promise.resolve(true);
    }
    const dAz = shortestAngle(start.azimuth, end.azimuth);
    const dist = start.target.distanceTo(end.target);
    const bump = style === 'dolly' ? Math.min(0.28, dist / 120) : (opts.bump || 0);
    const bank = (opts.bank != null ? opts.bank : (style === 'flyIn' || style === 'flyOut' ? 5 : 2.2)) * DEG
      * THREE.MathUtils.clamp(dAz / (80 * DEG), -1, 1);
    const logR0 = Math.log(start.radius), logR1 = Math.log(end.radius);
    const tgt = new THREE.Vector3(), pos = new THREE.Vector3();
    const knots = [];
    for (let i = 0; i < KNOTS; i++) {
      const u = i / (KNOTS - 1);
      let wT = u, wR = u, wP = u, wA = u, wF = u;
      if (style === 'flyIn') {
        // hold the map-like top-down look while descending, then tilt and swing into the oblique
        wP = window01(0.12, 1, u); wA = window01(0.05, 1, u); wT = window01(0, 0.85, u); wF = window01(0.3, 1, u);
      } else if (style === 'flyOut') {
        // rise first, swing to north-up, finish looking straight down
        wP = window01(0, 0.82, u); wA = window01(0, 0.9, u); wT = window01(0.1, 1, u); wF = window01(0, 0.7, u);
        wR = window01(0, 1, u) * 0.35 + u * 0.65;
      }
      tgt.lerpVectors(start.target, end.target, wT);
      const r = Math.exp(lerp(logR0, logR1, wR)) * (1 + bump * Math.sin(Math.PI * u) ** 2);
      const polar = lerp(start.polar, end.polar, wP);
      const az = start.azimuth + dAz * wA;
      this._posOf(tgt, r, polar, az, pos);
      if (pos.y < 0.8) pos.y = 0.8;
      const k = new Float64Array(DIM);
      k[0] = pos.x; k[1] = pos.y; k[2] = pos.z; k[3] = tgt.x; k[4] = tgt.y; k[5] = tgt.z;
      k[6] = lerp(start.fov, end.fov, wF);
      k[7] = bank * Math.sin(Math.PI * u) ** 2;
      k[8] = lerp(start.shift || 0, end.shift || 0, u);
      knots.push(k);
    }
    const dAng = Math.abs(dAz) + Math.abs(end.polar - start.polar);
    const auto = THREE.MathUtils.clamp(1.1 + dAng * 0.55 + Math.abs(logR1 - logR0) * 0.35 + dist / 90, 1.2, 3.0);
    this._clearControlInertia();
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this._autoSpeed = 0;
    let resolve;
    const promise = new Promise((r) => { resolve = r; });
    this.flight = {
      knots, T: opts.duration || auto, t: 0, end, style,
      warp: style === 'flyIn' ? WARP.in : style === 'flyOut' ? WARP.out : WARP.even,
      v0: Float64Array.from(this._vel),
      startRoll: this.roll,
      interruptible: opts.interruptible !== false,
      handoff: opts.handoff !== false,
      resolve
    };
    return promise;
  }

  // Stop the flight where it is and give control to the user.
  cancel() {
    if (!this.flight) return;
    this.flight.handoff = true;
    this._finishFlight(false);
  }

  // Debug: pose a flight at normalized time x (0..1) and hold it (for mid-flight screenshots).
  freezeAt(x) {
    const f = this.flight;
    if (!f) return;
    f.frozen = true;
    f.t = x * f.T;
    this._applyFlight(f);
  }

  _finishFlight(done) {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    if (f.handoff) this._handoff();
    f.resolve(done);
  }

  _handoff() {
    const c = this.controls;
    c.target.copy(this.target);
    this._clearControlInertia();
    c.enabled = true;
    this.lastInput = performance.now();
  }

  // OrbitControls keeps private damping deltas. With damping off, one update() applies and
  // zeroes them; the pose is restored afterwards so nothing moves.
  _clearControlInertia() {
    const c = this.controls, cam = this.camera;
    const p = cam.position.clone(), q = cam.quaternion.clone(), t = this.target.clone();
    const en = c.enabled, auto = c.autoRotate;
    c.enabled = true; c.autoRotate = false; c.enableDamping = false;
    c.target.copy(t);
    const minD = c.minDistance, maxD = c.maxDistance, maxP = c.maxPolarAngle;
    c.minDistance = 0; c.maxDistance = Infinity; c.maxPolarAngle = Math.PI;
    c.update();
    c.minDistance = minD; c.maxDistance = maxD; c.maxPolarAngle = maxP;
    c.enableDamping = true; c.enabled = en; c.autoRotate = auto;
    cam.position.copy(p); cam.quaternion.copy(q); c.target.copy(t);
  }

  _applyLook() {
    const cam = this.camera;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    if (this.roll) cam.rotateZ(this.roll);
    this._applyView();
  }

  // Off-axis projection: the orbit pivot stays on the target while the picture slides
  // sideways, which leaves room beside a focused asset for its HUD card. Only ratios matter
  // to three.js, and setViewOffset overwrites aspect with fullWidth / fullHeight, so the
  // offset is passed in units of the aspect ratio.
  _applyView() {
    const cam = this.camera, asp = cam.aspect;
    if (Math.abs(this.shift) > 1e-5) cam.setViewOffset(asp, 1, this.shift * asp, 0, asp, 1);
    else if (cam.view && cam.view.enabled) cam.clearViewOffset();
    else cam.updateProjectionMatrix();
  }

  _applyFlight(f) {
    const s = this._tmp;
    splineAt(f.knots, f.warp(f.t / f.T), s);
    const h = carry(f.t);
    if (h > 0) for (let d = 0; d < DIM; d++) s[d] += f.v0[d] * h;
    // roll that was present when the flight began fades out with the carry window
    const rollIn = f.startRoll * (1 - smoother(f.t / CARRY_T));
    this.camera.position.set(s[0], Math.max(0.8, s[1]), s[2]);
    this.target.set(s[3], s[4], s[5]);
    this.camera.fov = s[6];
    this.roll = s[7] + rollIn;
    this.shift = s[8];
    this._applyLook();
  }

  // ---- per frame -----------------------------------------------------------------------------
  update(dt, now) {
    const cam = this.camera, c = this.controls, f = this.flight;
    if (f) {
      if (!f.frozen) f.t += dt;
      this._applyFlight(f);
      if (!f.frozen && f.t >= f.T && f.t >= Math.min(CARRY_T, f.T + CARRY_T)) {
        // land exactly on the end pose
        this.target.copy(f.end.target);
        this._posOf(f.end.target, f.end.radius, f.end.polar, f.end.azimuth, cam.position);
        cam.fov = f.end.fov;
        this.roll = 0;
        this.shift = f.end.shift || 0;
        this._applyLook();
        this._finishFlight(true);
      }
    } else if (c.enabled) {
      // idle orbit eases in and out so it never starts with a jerk
      const idle = this.idleOrbit && !this.reducedMotion && this.mode === 'facility'
        && (now - this.lastInput) / 1000 > this.idleDelay;
      const goal = idle ? 0.35 : 0;
      this._autoSpeed += (goal - this._autoSpeed) * (1 - Math.exp(-dt / (idle ? 1.2 : 0.25)));
      if (Math.abs(this._autoSpeed) < 0.002 && !idle) this._autoSpeed = 0;
      c.autoRotate = this._autoSpeed !== 0;
      c.autoRotateSpeed = this._autoSpeed;
      c.update(dt);
      // keep the look target on site and above ground
      const t = c.target, lim = this.limits;
      const dx = t.x - lim.center.x, dz = t.z - lim.center.z;
      const d = Math.hypot(dx, dz);
      let sx = 0, sz = 0, sy = 0;
      if (d > lim.panRadius) { const k = lim.panRadius / d - 1; sx = dx * k; sz = dz * k; }
      if (t.y < 0) sy = -t.y; else if (t.y > 12) sy = 12 - t.y;
      if (sx || sy || sz) { t.x += sx; t.y += sy; t.z += sz; cam.position.x += sx; cam.position.y += sy; cam.position.z += sz; }
      if (cam.position.y < 0.8) cam.position.y = 0.8;
      this.target.copy(t);
      // any residual bank from an interrupted flight relaxes to level
      if (this.roll) {
        this.roll *= Math.exp(-dt / 0.18);
        if (Math.abs(this.roll) < 1e-4) this.roll = 0;
        cam.rotateZ(this.roll);
      }
    }

    // velocity estimate (per second) of the full camera state, for carry-over into the next flight
    const s = this._state;
    s[0] = cam.position.x; s[1] = cam.position.y; s[2] = cam.position.z;
    s[3] = this.target.x; s[4] = this.target.y; s[5] = this.target.z; s[6] = cam.fov; s[7] = this.roll; s[8] = this.shift;
    if (this._hasPrev && dt > 1e-4) {
      // In a flight the path is analytic, so the last frame's difference is exact. Under
      // OrbitControls the input is noisy, so smooth it a little.
      const a = f ? 1 : 1 - Math.exp(-dt / 0.04);
      for (let d = 0; d < DIM; d++) this._vel[d] += ((s[d] - this._prev[d]) / dt - this._vel[d]) * a;
    }
    this._prev.set(s);
    this._hasPrev = true;

    const dist = cam.position.distanceTo(this.target);
    const near = THREE.MathUtils.clamp(dist * 0.04, 0.25, 30);
    if (Math.abs(near - cam.near) / cam.near > 0.02) { cam.near = near; cam.updateProjectionMatrix(); }
    if (this.trace) this.trace.push([now, s[0], s[1], s[2], s[3], s[4], s[5], s[6], dt, f ? 1 : 0]);
  }
}

export { DEG };
