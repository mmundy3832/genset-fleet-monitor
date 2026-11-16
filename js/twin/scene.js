// 3D scene engine: renderer, sky and lighting, post-processing, site loading and warm-up,
// per-frame model updates, picking and hover, enclosure fades.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CameraRig, DEG } from './camera.js';
import { loadModels, buildSite, disposeSite, findSite, siteKind, siteSpec } from './layouts.js';
import { buildGround } from './ground.js';

const smoother = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (6 * t - 15) + 10); };
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
// Lowest enclosure opacity the slider or options can ask for, so a ghost of the cover always remains.
export const ENCLOSURE_FLOOR = 0.08;
// Width of the asset HUD card for a viewport width (compact on small screens). Shared by the
// HUD, which sizes the card, and assetPose, which keeps a column of that width clear.
export const hudCardWidth = (w) => Math.max(120, Math.min(w < 1000 ? 300 : 404, w - 28));
const clampEnclosure = (v) => Math.min(1, Math.max(ENCLOSURE_FLOOR, isFinite(v) ? v : 0.15));

// Lighting presets. Values chosen by eye from screenshots (not physical measurements).
const THEMES = {
  light: {
    sunElev: 33, sunAzOff: 108, skyElev: 33, skyAzOff: 108,
    turbidity: 3.6, rayleigh: 0.85, mie: 0.004, mieG: 0.8, clouds: 0.32, cloudDensity: 0.35,
    sunColor: 0xfff1e0, sunIntensity: 8.5, hemiSky: 0xfff3e2, hemiGround: 0xa39478, hemi: 0.85,
    env: 0.24, exposure: 0.5, bounce: 0x9a8c74, bounceGain: 1.5, fog: 0xbccbd6, fogDensity: 0.00020,
    bloom: 0.10, bloomThreshold: 9.5, flood: 0, lens: 0, night: false
  },
  dark: {
    sunElev: 34, sunAzOff: -55, skyElev: 1.6, skyAzOff: 158,
    turbidity: 6.5, rayleigh: 2.4, mie: 0.006, mieG: 0.86, clouds: 0.38, cloudDensity: 0.45,
    sunColor: 0x93a9da, sunIntensity: 0.55, hemiSky: 0x3b4a6e, hemiGround: 0x17140f, hemi: 0.45,
    env: 1.0, exposure: 1.25, bounce: 0x2a2620, bounceGain: 0.25, fog: 0x2b3044, fogDensity: 0.00026,
    bloom: 0.32, bloomThreshold: 1.6, flood: 1, floodCd: 170, lens: 5, night: true
  }
};

export class TwinScene {
  constructor(container, opts) {
    this.container = container;
    this.opts = opts || {};
    this.Sim = this.opts.Sim || null;
    this.models = null;
    this.layout = null;
    this.ground = null;
    this.assets = new Map();
    this.updaters = [];
    this.focusId = null;
    this.hoverId = null;
    this.enclosureOpacity = clampEnclosure(this.opts.enclosureOpacity != null ? Number(this.opts.enclosureOpacity) : 0.15);
    this.theme = this.opts.theme === 'light' ? 'light' : 'dark';
    this.frameListeners = [];
    this.running = false;
    this.time = 0;
    this.lastNow = 0;
    this.stats = { frames: 0, ema: 16, samples: [] };
    this.qualityLocked = !!this.opts.quality && this.opts.quality !== 'auto';
    this.quality = this.qualityLocked ? this.opts.quality : 'high';

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', alpha: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = 'twin-canvas';
    renderer.domElement.setAttribute('tabindex', '0');
    renderer.domElement.setAttribute('aria-label', '3D view of the selected site');
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.maxAniso = renderer.capabilities.getMaxAnisotropy();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 45000);
    this.camera.position.set(0, 120, 160);

    // sky, sun, fill
    this.sky = new Sky();
    this.sky.scale.setScalar(40000);
    this.sky.userData.noAO = true;
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.autoUpdate = false;      // refreshed only when the frustum moves or something fades
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.2);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xbccbd6, 0.0002);
    this.sunDir = new THREE.Vector3(0.4, 0.6, 0.5).normalize();
    this.viewAzimuth = 0.6;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;

    // yard floodlights for the night theme, used only when the models bring no lights of their own
    this.floods = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.SpotLight(0xffe2b8, 0, 220, 62 * DEG, 0.7, 1.6);
      l.castShadow = false;
      this.scene.add(l);
      this.scene.add(l.target);
      this.floods.push(l);
    }

    // hover bracket box
    this.hoverBox = makeBracketBox();
    this.hoverBox.visible = false;
    this.scene.add(this.hoverBox);
    this._hoverAlpha = 0;

    this.rig = new CameraRig(this.camera, renderer.domElement, {
      reducedMotion: this.opts.reducedMotion, idleOrbit: this.opts.idleOrbit
    });

    this._buildComposer();
    this.setTheme(this.theme);
    this._bindPointer();

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this._kick(); });
    this._loop = this._loop.bind(this);
    this._raycaster = new THREE.Raycaster();
    this._ray = new THREE.Ray();
    this._inv = new THREE.Matrix4();
    this._box = new THREE.Box3();
    this._v = new THREE.Vector3();
    this.resize();
  }

  // ---- composer and quality ------------------------------------------------------------------

  _buildComposer() {
    const r = this.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(2, size.x), Math.max(2, size.y), { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(r, rt);
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    const gtao = new GTAOPass(this.scene, this.camera, 512, 512);
    gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 8, distanceFallOff: 1, screenSpaceRadius: false });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    gtao.blendIntensity = 0.9;
    // Keep ghosted enclosures, glass and the sky out of the AO depth/normal pass so occlusion
    // is computed on the machine inside a faded cover, not on the cover.
    const base = gtao._overrideVisibility && gtao._overrideVisibility.bind(gtao);
    if (base && gtao._visibilityCache) {
      const scene = this.scene;
      gtao._overrideVisibility = function () {
        base();
        const cache = gtao._visibilityCache;
        scene.traverse((o) => {
          if (!o.visible || !o.isMesh) return;
          const m = o.material;
          const ghost = o.userData.noAO || (m && !Array.isArray(m) && m.transparent && m.opacity < 0.98 && !o.userData.keepInAO);
          if (ghost) { o.visible = false; cache.push(o); }
        });
      };
    }
    composer.addPass(gtao);
    this.gtao = gtao;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.15, 0.55, 1.2);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    composer.addPass(this.smaa);
    this.composer = composer;
    this._applyQuality();
  }

  _applyQuality() {
    const q = this.quality;
    this.gtao.enabled = q === 'high';
    this.bloom.enabled = q !== 'low';
    this.smaa.enabled = q !== 'low';
    const map = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== map) {
      this.sun.shadow.mapSize.set(map, map);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.container.dataset.quality = q;
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
    this._applyQuality();
    this.resize();
  }

  _pixelRatio() {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    const pr = this._pixelRatio();
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    // ambient occlusion is computed at reduced resolution and blended onto the full-size frame
    const ao = this.opts.aoScale || 0.6;
    this.gtao.setSize(Math.max(2, Math.round(w * pr * ao)), Math.max(2, Math.round(h * pr * ao)));
    this.camera.aspect = w / h;
    this.width = w; this.height = h;
    this.rig._applyView();
    this._kick();
  }

  // ---- theme, sky, lights --------------------------------------------------------------------

  setTheme(theme) {
    this.theme = theme === 'light' ? 'light' : 'dark';
    const T = THEMES[this.theme];
    const u = this.sky.material.uniforms;
    u.turbidity.value = T.turbidity;
    u.rayleigh.value = T.rayleigh;
    u.mieCoefficient.value = T.mie;
    u.mieDirectionalG.value = T.mieG;
    if (u.cloudCoverage) { u.cloudCoverage.value = T.clouds; u.cloudDensity.value = T.cloudDensity; }
    const dir = (elev, az) => new THREE.Vector3(Math.cos(elev * DEG) * Math.sin(az), Math.sin(elev * DEG), Math.cos(elev * DEG) * Math.cos(az));
    const skySun = dir(T.skyElev, this.viewAzimuth + T.skyAzOff * DEG);
    u.sunPosition.value.copy(skySun);
    this.sunDir.copy(dir(T.sunElev, this.viewAzimuth + T.sunAzOff * DEG));
    this.sun.color.setHex(T.sunColor);
    this.sun.intensity = T.sunIntensity;
    this.hemi.color.setHex(T.hemiSky);
    this.hemi.groundColor.setHex(T.hemiGround);
    this.hemi.intensity = T.hemi;
    this.scene.fog.color.setHex(T.fog);
    this._fogBase = T.fogDensity;
    this.renderer.toneMappingExposure = T.exposure;
    this.scene.environmentIntensity = T.env;
    this.bloom.strength = T.bloom;
    this.bloom.threshold = T.bloomThreshold;

    // environment from the sky (sun disc off so the key light's highlight is not doubled)
    // A ground-colored disc fills the lower half, so upward-facing bounce is warm earth and
    // not the sky shader's below-horizon blue.
    const envScene = new THREE.Scene();
    if (u.showSunDisc) u.showSunDisc.value = 0;
    const bounce = new THREE.Color(T.bounce).multiplyScalar(T.bounceGain);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(30000, 48), new THREE.MeshBasicMaterial({ color: bounce, fog: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -40;
    envScene.add(disc);
    envScene.add(this.sky);
    const rt = this.pmrem.fromScene(envScene, 0, 1, 50000);
    this.scene.add(this.sky);
    if (u.showSunDisc) u.showSunDisc.value = 1;
    disc.geometry.dispose(); disc.material.dispose();
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this._applyNight();
    this._shadowDirty = true;
    this.container.dataset.twinTheme = this.theme;
    this._kick();
  }

  _applyNight() {
    const T = THEMES[this.theme];
    const L = this.layout;
    let modelLights = 0;
    if (L) {
      L.group.traverse((o) => {
        const f = o.userData && o.userData.setNight;
        if (typeof f === 'function') { try { f.call(o.userData, T.night); } catch (e) { /* ignore */ } }
        if (o.isLight) modelLights++;
      });
    }
    const on = T.flood && L && modelLights === 0;
    const c = L ? L.center : new THREE.Vector3();
    const r = L ? Math.min(60, L.radius * 0.8) : 30;
    // yard light poles: lens glow is a shared material, and up to four of the poles carry a
    // real spotlight. Poles come in left/right pairs along the yard. A small yard lights all
    // four of its poles. A long one lights one pole per pair, alternating sides, so the pools
    // of light overlap down the whole length.
    const poles = (L && L.poles) || [];
    if (poles.length && poles[0].userData.lensMaterial) poles[0].userData.lensMaterial.emissiveIntensity = T.lens;
    const pick = [];
    const pairs = Math.floor(poles.length / 2);
    if (poles.length <= 4) poles.forEach((p) => pick.push(p));
    else {
      const n = Math.min(this.floods.length, pairs);
      for (let i = 0; i < n; i++) {
        const k = n === 1 ? 0 : Math.round((i * (pairs - 1)) / (n - 1));
        pick.push(poles[k * 2 + (i % 2)]);
      }
    }
    const long = poles.length > 4;
    this.floods.forEach((l, i) => {
      const p = pick[i];
      if (p && p.userData.light) {
        p.updateWorldMatrix(true, false);
        l.position.copy(p.userData.light).applyMatrix4(p.matrixWorld);
        const d = (p.userData.lightDir || new THREE.Vector3(0.5, -0.85, 0)).clone().transformDirection(p.matrixWorld);
        l.target.position.copy(l.position).addScaledVector(d, 12);
        l.angle = 66 * DEG;
        // long yards: slower falloff so the light reaches the middle rows, scaled to give the
        // same level under the pole as the standard falloff does
        l.decay = long ? 1.15 : 1.6;
        l.userData.gain = long ? Math.pow(Math.max(4, l.position.y - c.y), 1.15 - 1.6) * 1.5 : 1;
      } else {
        const a = this.viewAzimuth + (i * 90 + 45) * DEG;
        l.position.set(c.x + Math.sin(a) * r, c.y + 12, c.z + Math.cos(a) * r);
        l.target.position.set(c.x + Math.sin(a) * r * 0.2, c.y - 1.5, c.z + Math.cos(a) * r * 0.2);
        l.angle = 62 * DEG;
        l.decay = 1.6;
        l.userData.gain = i < 4 ? 1 : 0;
      }
      l.intensity = on && (p || !poles.length) ? T.floodCd * l.userData.gain : 0;
    });
  }

  // during warm-up: aim the shadow frustum at the whole site so every caster is uploaded
  _updateSunFor(layout) {
    const keep = this.rig.target.clone(), pos = this.camera.position.clone();
    this.rig.target.copy(layout.center); this.camera.position.copy(layout.center).add(new THREE.Vector3(0, 400, 0));
    this._updateSun();
    this.rig.target.copy(keep); this.camera.position.copy(pos);
  }

  _updateSun() {
    const rig = this.rig, sun = this.sun;
    const dist = this.camera.position.distanceTo(rig.target);
    const maxExt = (this.layout ? this.layout.radius : 60) + 30;
    // extent snaps to half-octave steps so the shadow texel grid is stable while orbiting
    let ext = Math.min(maxExt, Math.max(14, dist * 0.8));
    ext = Math.min(maxExt, 14 * Math.pow(Math.SQRT2, Math.ceil(Math.log(ext / 14) / Math.log(Math.SQRT2))));
    const cam = sun.shadow.camera;
    const D = ext * 2 + 80;
    // snap the focus to the shadow texel grid in light space
    const up = Math.abs(this.sunDir.y) > 0.99 ? this._v.set(1, 0, 0) : this._v.set(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(up, this.sunDir).normalize();
    const lup = new THREE.Vector3().crossVectors(this.sunDir, right).normalize();
    const texel = (ext * 2) / sun.shadow.mapSize.x;
    const f = rig.target;
    const fx = Math.round(f.dot(right) / texel) * texel, fy = Math.round(f.dot(lup) / texel) * texel, fz = f.dot(this.sunDir);
    const focus = new THREE.Vector3().addScaledVector(right, fx).addScaledVector(lup, fy).addScaledVector(this.sunDir, fz);
    if (!sun.target.position.equals(focus) || cam.right !== ext) this._shadowDirty = true;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(this.sunDir, D);
    if (cam.right !== ext) {
      cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
      cam.near = 1; cam.far = D * 2;
      cam.updateProjectionMatrix();
      sun.shadow.normalBias = Math.max(0.02, texel * 1.6);
    }
    // haze thins out when looking down from altitude
    const h = this.camera.position.y;
    this.scene.fog.density = this._fogBase / (1 + Math.pow(h / 500, 1.4));
    const u = this.sky.material.uniforms;
    if (u.time) u.time.value = this.time;
  }

  // ---- site loading --------------------------------------------------------------------------

  async ensureModels() {
    if (!this._modelsPromise) this._modelsPromise = loadModels();
    this.models = await this._modelsPromise;
    return this.models;
  }

  // Builds (time-sliced), adds, compiles and warms a site while nothing is shown, so the first
  // visible frame and everything after it are free of build, upload and compile hitches.
  async loadSite(siteId) {
    if (this.layout && this.layout.siteId === siteId && !this._loading) return this.layout;
    if (this._loading && this._loading.siteId === siteId) return this._loading.promise;
    // one build at a time: a newer request waits for the one in progress, then replaces it
    const prev = this._loading ? this._loading.promise.catch(() => null) : Promise.resolve();
    const job = { siteId };
    job.promise = prev.then(() => (this.layout && this.layout.siteId === siteId ? this.layout : this._loadSite(siteId)));
    this._loading = job;
    try { return await job.promise; } finally { if (this._loading === job) this._loading = null; }
  }

  async _loadSite(siteId) {
    const M = await this.ensureModels();
    const t0 = performance.now();
    // imagery downloads while the site is being built
    const site = findSite(this.Sim, siteId) || {};
    const kind = siteKind(site);
    const spec = siteSpec(siteId, kind);
    const groundP = buildGround({
      lat: site.lat, lon: site.lon, kind, imagery: this.opts.imagery !== false, timeoutMs: 4500, maxAnisotropy: this.maxAniso,
      // the procedural site ground covers the close range, so the sharpest tile ring is not needed
      near: !(M.buildings && typeof M.buildings.buildGround === 'function') || this.opts.siteGround === false
    });
    const layout = await buildSite(siteId, { models: M, Sim: this.Sim, budgetMs: 7 });
    const tGround = performance.now();
    const ground = await groundP;
    await nextFrame();
    if (!this._siteGround(M, layout, spec, ground)) ground.addApron(layout.siteRadius, layout.center);
    const tAdd = performance.now();
    this.unloadSite();

    this.layout = layout;
    this.ground = ground;
    this.viewAzimuth = layout.viewAzimuth;
    this.assets.clear();
    layout.assets.forEach((a) => {
      const ud = a.object.userData;
      const s = ud.size;
      this.assets.set(a.id, {
        id: a.id, kind: a.kind, object: a.object, ud, slot: a.slot, status: null,
        opacity: 1, fade: null, opened: false,
        box: new THREE.Box3(new THREE.Vector3(-s.x / 2, 0, -s.z / 2), new THREE.Vector3(s.x / 2, s.y, s.z / 2))
      });
    });
    this.updaters = [];
    layout.group.traverse((o) => {
      if (o.userData && typeof o.userData.update === 'function' && !(o.userData.id && this.assets.has(o.userData.id) && this.assets.get(o.userData.id).object === o)) {
        this.updaters.push(o.userData);
      }
      if (o.isMesh && o.material && o.material.map && o.material.map.isTexture && o.material.map.anisotropy < 4) o.material.map.anisotropy = Math.min(8, this.maxAniso);
    });
    this.syncStatus(true);
    this.setTheme(this.theme);        // sun and sky follow this site's view direction; also applies night state
    this._buildPlume();

    // progressive warm-up: reveal a few objects per frame into a tiny target so geometry and
    // texture uploads and shader compiles are spread out, never in a visible frame
    const pieces = [];
    layout.yard.children.forEach((c) => pieces.push(c));
    pieces.push(layout.backdrop);
    ground.group.children.forEach((c) => pieces.push(c));
    pieces.forEach((p) => { p.userData._vis = p.visible; p.visible = false; });
    this.scene.add(ground.group);
    this.scene.add(layout.group);
    layout.group.updateMatrixWorld(true);
    const warmRT = new THREE.WebGLRenderTarget(96, 96);
    const warmCam = this.camera.clone();
    warmCam.position.set(layout.center.x + 120, 160, layout.center.z + 160);
    warmCam.lookAt(layout.center);
    warmCam.updateMatrixWorld(true);
    const prevTarget = this.renderer.getRenderTarget();
    const per = Math.max(1, Math.ceil(pieces.length / 28));
    const tBuild = performance.now();
    for (let i = 0; i < pieces.length; i += per) {
      for (let k = i; k < Math.min(pieces.length, i + per); k++) {
        pieces[k].visible = pieces[k].userData._vis !== false;
        delete pieces[k].userData._vis;
      }
      this._updateSunFor(layout);
      this.sun.shadow.needsUpdate = true;
      this.renderer.setRenderTarget(warmRT);
      this.renderer.render(this.scene, warmCam);
      this.renderer.setRenderTarget(prevTarget);
      await nextFrame();
    }
    warmRT.dispose();
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch (e) { /* older drivers: compiled on first render */ }
    await nextFrame();
    // one full-size composer frame (still hidden) allocates pass targets and compiles the
    // post-processing programs for this light setup
    this._updateSun();
    this.composer.render(0);
    layout.buildMs = performance.now() - t0;
    layout.timing = { build: Math.round(tGround - t0), ground: Math.round(tAdd - tGround), warm: Math.round(performance.now() - tBuild) };
    this._warmAt = performance.now();
    return layout;
  }

  // Procedural site ground from buildings.js (dirt, public road, vegetation that match the
  // model). With imagery it is a flat patch feathered into the aerial photo, without imagery
  // it is the whole landscape. Lives in the building's frame so its road meets the entry.
  _siteGround(M, layout, spec, groundInfo) {
    const imagery = groundInfo.imagery;
    const fn = M.buildings && M.buildings.buildGround;
    if (typeof fn !== 'function' || this.opts.siteGround === false) return false;
    try {
      const bud = layout.backdrop.userData || {};
      const b = bud.bounds || { x0: -100, x1: 100, z0: -80, z1: 80 };
      const yl = layout.yard.position, yh = layout.yard.userData.half, yr = Math.max(yh.x, yh.z) + 8;
      const clear = { x0: Math.min(b.x0, yl.x - yr) - 6, x1: Math.max(b.x1, yl.x + yr) + 6, z0: Math.min(b.z0, yl.z - yr) - 6, z1: Math.max(b.z1, yl.z + yr) + 6 };
      const reach = Math.max(Math.abs(clear.x0), Math.abs(clear.x1), Math.abs(clear.z0), Math.abs(clear.z1));
      const size = imagery ? Math.max(900, reach * 2 + 500) : 3200;
      const g = fn({
        kind: spec.ground || 'westTexas', variant: spec.ground || 'westTexas', seed: layout.seed, size,
        relief: imagery ? 0 : undefined, flatRadius: Math.max(260, reach + 60),
        roadZ: bud.entry && isFinite(bud.entry.z) ? bud.entry.z + 4.5 : Math.max(160, clear.z1 + 20), clear
      });
      if (!g || !g.isObject3D) return false;
      if (imagery) {
        const mesh = g.getObjectByName('ground');
        if (mesh && mesh.material) {
          const c = document.createElement('canvas');
          c.width = c.height = 256;
          const ctx = c.getContext('2d');
          const inner = Math.min(0.8, (reach + 40) / (size / 2));
          const gr = ctx.createRadialGradient(128, 128, 128 * inner, 128, 128, 126);
          gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#000');
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 256, 256);
          ctx.fillStyle = gr; ctx.fillRect(0, 0, 256, 256);
          const alpha = new THREE.CanvasTexture(c);
          mesh.material.alphaMap = alpha;
          mesh.material.transparent = true;
          mesh.material.depthWrite = false;
          mesh.material.polygonOffset = false;   // the imagery sits half a meter lower, no offset needed
          mesh.material.needsUpdate = true;
          mesh.renderOrder = 1;
          mesh.userData.keepInAO = true;
          // pull the procedural ground part of the way toward the photo's average tone so
          // the feathered patch does not read as a different colored disc from the air
          const hc = g.userData && g.userData.horizonColor, ic = groundInfo.nearTint;
          if (hc && ic && hc.r > 0.01 && hc.g > 0.01 && hc.b > 0.01) {
            const k = 0.55, cl = (v) => Math.min(1.2, Math.max(0.5, v));
            mesh.material.color.setRGB(1 + (cl(ic.r / hc.r) - 1) * k, 1 + (cl(ic.g / hc.g) - 1) * k, 1 + (cl(ic.b / hc.b) - 1) * k);
          }
          layout.groundFeather = alpha;
        }
      }
      g.position.y -= 0.03;
      layout.group.add(g);
      layout.siteGround = g;
      layout.horizonColor = g.userData && g.userData.horizonColor;
      return true;
    } catch (err) {
      console.warn('[twin] buildGround failed, using the plain apron', err);
      return false;
    }
  }

  unloadSite() {
    if (!this.layout) return;
    this.scene.remove(this.layout.group);
    disposeSite(this.layout);
    if (this.ground) { this.scene.remove(this.ground.group); this.ground.dispose(); }
    if (this.plume) { this.scene.remove(this.plume); this.plume.geometry.dispose(); this.plume.material.dispose(); this.plume = null; }
    this.layout = null; this.ground = null;
    this.assets.clear(); this.updaters = [];
    this.focusId = null; this.hoverId = null;
  }

  // ---- poses the camera flies to -------------------------------------------------------------

  facilityPose() {
    const L = this.layout;
    const fov = 38;
    const aspect = this.camera.aspect || 1.6;
    const fit = L.radius / Math.sin((fov * DEG) / 2) * (aspect < 1.2 ? 1.25 : 0.86);
    return { target: L.center.clone(), radius: Math.max(40, fit), polar: 61 * DEG, azimuth: L.viewAzimuth, fov };
  }

  // Straight down, north up, at the altitude where the view covers the same ground as a
  // Leaflet map at this zoom in a viewport of this height.
  topDownPose(mapZoom) {
    const L = this.layout;
    const fov = 44;
    const lat = isFinite(L.lat) ? L.lat : 32;
    const mpp = (156543.03392 * Math.cos(lat * DEG)) / Math.pow(2, mapZoom || 17);
    const h = ((this.height || 800) * mpp) / (2 * Math.tan((fov * DEG) / 2));
    return { target: new THREE.Vector3(0, 0, 0), radius: h, polar: 0.4 * DEG, azimuth: 0, fov };
  }

  assetPose(id) {
    const a = this.assets.get(id);
    if (!a) return null;
    const obj = a.object;
    obj.updateWorldMatrix(true, false);
    const f = a.ud.focus;
    const center = f.center.clone().applyMatrix4(obj.matrixWorld);
    const fov = 34;
    let radius = Math.max(9, (f.radius / Math.sin((fov * DEG) / 2)) * 1.12);
    // Leave a clear column beside the unit for its HUD card: slide the picture sideways
    // (the orbit pivot stays on the unit) and back off until the unit fits in what is left.
    // Skipped on narrow viewports, where the card cannot sit beside the unit anyway.
    const W = this.width || 1200, H = this.height || 800;
    const column = hudCardWidth(W) + 14 + 34;                // card width, screen margin, gap to the unit
    let shift = 0;
    if (W - column >= 290) {
      shift = column / (2 * W);
      const half = (W - column) / 2 - 22;                    // px available on each side of the unit's center
      const px = (r) => (H / 2) * f.radius / (r * Math.tan((fov * DEG) / 2));
      if (px(radius) > half) radius *= px(radius) / half;
    }
    // 3/4 views of the service (+Z) side; take whichever needs the smaller swing
    const q = new THREE.Quaternion(); obj.getWorldQuaternion(q);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const service = Math.atan2(n.x, n.z);
    const cur = this.rig.currentPose().azimuth;
    const cands = [service + 52 * DEG, service - 52 * DEG];
    const d = (x) => Math.abs(Math.atan2(Math.sin(x - cur), Math.cos(x - cur)));
    const az = d(cands[0]) <= d(cands[1]) ? cands[0] : cands[1];
    return { target: center, radius, polar: 60 * DEG, azimuth: az, fov, shift };
  }

  applyLimits(mode) {
    const L = this.layout;
    if (!L) return;
    if (mode === 'asset' || mode === 'asset-loose') {
      const a = this.assets.get(this.focusId);
      const r = a ? a.ud.focus.radius : 8;
      // loose: the user interrupted the flight somewhere else, so do not clamp them in
      const loose = mode === 'asset-loose';
      this.rig.setLimits({ mode: 'asset', minDistance: Math.max(3, r * 0.45), maxDistance: loose ? Math.max(2600, L.siteRadius * 6) : r * 9,
        center: loose ? L.center : this.rig.target.clone(), panRadius: loose ? L.siteRadius : r * 1.2 });
    } else {
      this.rig.setLimits({ mode, minDistance: 14, maxDistance: Math.max(2600, L.siteRadius * 6), center: L.center, panRadius: L.siteRadius });
    }
  }

  // ---- focus and enclosure fades -------------------------------------------------------------

  // Builds the lazily constructed interior of an asset now (and compiles its shaders) so the
  // cost does not land in the middle of a flight. Resolves when it is safe to start fading.
  async prewarmAsset(id) {
    const a = this.assets.get(id);
    if (!a || a.opened) return;
    a.opened = true;
    // 0.99: enough to switch the cover to its transparent material variants and show the
    // interior, visually indistinguishable from solid
    try { a.ud.setEnclosureOpacity(0.99); } catch (e) { console.warn('[twin] setEnclosureOpacity failed', e); }
    a.opacity = 0.99;
    try { await this.renderer.compileAsync(a.object, this.camera, this.scene); } catch (e) { /* compiled on first render */ }
    // two real frames upload the interior's geometry and textures (shadow and AO passes included)
    this._shadowDirty = true;
    await nextFrame();
    await nextFrame();
  }

  setFocus(id, opts) {
    opts = opts || {};
    this.focusId = id && this.assets.has(id) ? id : null;
    const T = opts.duration != null ? opts.duration : 1.5;
    this.assets.forEach((a) => {
      const goal = a.id === this.focusId ? this.enclosureOpacity : 1;
      if (a.id === this.focusId && !a.opened && goal < 1) return;   // waits for prewarmAsset
      this._fade(a, goal, T, opts.delay || 0);
    });
  }

  startFocusFade(duration, delay) {
    const a = this.assets.get(this.focusId);
    if (a) this._fade(a, this.enclosureOpacity, duration != null ? duration : 1.5, delay || 0);
  }

  _fade(a, goal, T, delay) {
    if (Math.abs(a.opacity - goal) < 1e-3 && !a.fade) return;
    if (a.fade && Math.abs(a.fade.to - goal) < 1e-3) return;
    if (goal < 1) a.opened = true;
    a.fade = { from: a.opacity, to: goal, t: -delay, T: Math.max(0.01, T) };
  }

  setEnclosureOpacity(v) {
    this.enclosureOpacity = clampEnclosure(v);
    const a = this.assets.get(this.focusId);
    if (a && a.opened) this._fade(a, this.enclosureOpacity, 0.25, 0);
  }

  // ---- telemetry -----------------------------------------------------------------------------

  telemetry(id) {
    const S = this.Sim;
    try {
      if (S && typeof S.asset === 'function') return S.asset(id);
      if (S && typeof S.genset === 'function') return S.genset(id);
    } catch (e) { /* fall through */ }
    return undefined;
  }

  syncStatus(force) {
    this.assets.forEach((a) => {
      const t = this.telemetry(a.id);
      const s = (t && t.status) || 'standby';
      if (typeof a.ud.setAlarm === 'function') {
        let bad = s === 'fault';
        const tags = (t && t.tags) || {};
        for (const k in tags) { const q = tags[k] && tags[k].quality; if (q === 'ALARM' || q === 'OUT_OF_RANGE') { bad = true; break; } }
        if (bad !== a.alarm) { a.alarm = bad; try { a.ud.setAlarm(bad); } catch (e) { /* ignore */ } }
      }
      if (force || s !== a.status) {
        a.status = s;
        try { a.ud.setStatus(s); } catch (e) { /* ignore */ }
        this._plumeDirty = true;
      }
    });
  }

  // ---- exhaust heat haze ---------------------------------------------------------------------
  // One Points cloud for the whole site, animated in the vertex shader. Very faint by design.
  _buildPlume() {
    if (this.plume) { this.scene.remove(this.plume); this.plume.geometry.dispose(); this.plume.material.dispose(); this.plume = null; }
    if (this.opts.plume === false) return;
    const tips = [];
    this.assets.forEach((a) => {
      const tip = a.ud.exhaustTip;
      if (a.kind === 'genset' && tip && tip.isVector3) { a.object.updateWorldMatrix(true, false); tips.push({ a, p: tip.clone().applyMatrix4(a.object.matrixWorld) }); }
    });
    if (!tips.length) return;
    const N = 10;
    const pos = new Float32Array(tips.length * N * 3), seed = new Float32Array(tips.length * N), on = new Float32Array(tips.length * N);
    tips.forEach((t, i) => {
      for (let k = 0; k < N; k++) {
        const j = i * N + k;
        pos[j * 3] = t.p.x; pos[j * 3 + 1] = t.p.y; pos[j * 3 + 2] = t.p.z;
        seed[j] = (k + ((i * 0.37) % 1)) / N;
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    geo.setAttribute('on', new THREE.BufferAttribute(on, 1));
    geo.boundingSphere = new THREE.Sphere(this.layout.center.clone(), this.layout.radius + 60);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: false,
      uniforms: { time: { value: 0 }, scale: { value: 800 }, tint: { value: new THREE.Color(0xd9dde0) }, strength: { value: 0.05 } },
      vertexShader: `
        attribute float seed; attribute float on;
        uniform float time; uniform float scale;
        varying float vA;
        void main() {
          float age = fract(time * 0.22 + seed);
          vec3 p = position;
          float w = seed * 40.0;
          p.y += age * 5.5;
          p.x += age * age * 2.6 + sin(time * 0.9 + w) * 0.25 * age;
          p.z += age * age * 1.1 + cos(time * 0.7 + w * 1.3) * 0.25 * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = scale * (1.3 + age * 4.2) / max(1.0, -mv.z);
          vA = on * smoothstep(0.0, 0.1, age) * (1.0 - age);
        }`,
      fragmentShader: `
        uniform vec3 tint; uniform float strength;
        varying float vA;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c) * 4.0;
          float a = exp(-d * 2.4) * (1.0 - d) * vA * strength;
          if (a < 0.002) discard;
          gl_FragColor = vec4(tint, a);
        }`
    });
    this.plume = new THREE.Points(geo, mat);
    this.plume.frustumCulled = true;
    this.plume.renderOrder = 5;
    this.plume.userData.tips = tips;
    this.plume.userData.n = N;
    this.scene.add(this.plume);
    this._plumeDirty = true;
  }

  _updatePlume() {
    const p = this.plume;
    if (!p) return;
    p.material.uniforms.time.value = this.time;
    p.material.uniforms.scale.value = (this.height || 800) * this._pixelRatio() * 0.9;
    // Faint, but it has to read against the ground behind it: darker haze over sunlit
    // concrete, paler haze against the night. Values chosen by eye from screenshots.
    const day = this.theme === 'light';
    p.material.uniforms.strength.value = day ? 0.5 : 0.07;
    p.material.uniforms.tint.value.setHex(day ? 0x6b7176 : 0xb9c2cc);
    if (this._plumeDirty) {
      this._plumeDirty = false;
      const on = p.geometry.attributes.on, N = p.userData.n;
      p.userData.tips.forEach((t, i) => { for (let k = 0; k < N; k++) on.array[i * N + k] = t.a.status === 'running' ? 1 : 0; });
      on.needsUpdate = true;
    }
  }

  // ---- picking and hover ---------------------------------------------------------------------

  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    let best = null, bestD = Infinity;
    this.assets.forEach((a) => {
      this._inv.copy(a.object.matrixWorld).invert();
      this._ray.copy(this._raycaster.ray).applyMatrix4(this._inv);
      const hit = this._ray.intersectBox(a.box, this._v);
      if (hit) {
        const d = hit.applyMatrix4(a.object.matrixWorld).distanceTo(this._raycaster.ray.origin);
        if (d < bestD) { bestD = d; best = a.id; }
      }
    });
    return best;
  }

  setHover(id) {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    if (this.onHover) this.onHover(id);
  }

  _bindPointer() {
    const dom = this.renderer.domElement;
    let down = null, moved = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now(), b: e.button }; });
    dom.addEventListener('pointermove', (e) => { moved = { x: e.clientX, y: e.clientY, buttons: e.buttons }; });
    dom.addEventListener('pointerleave', () => { moved = null; this.setHover(null); });
    dom.addEventListener('pointerup', (e) => {
      if (!down || down.b !== 0) { down = null; return; }
      const click = Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 450;
      down = null;
      if (click && this.onPick) this.onPick(this.pick(e.clientX, e.clientY));
    });
    this._hoverPoll = () => {
      if (!moved || moved.buttons) return;
      const id = this.pick(moved.x, moved.y);
      this.setHover(id === this.focusId ? null : id);
    };
  }

  _updateHoverBox(dt) {
    const a = this.hoverId ? this.assets.get(this.hoverId) : null;
    const goal = a ? 1 : 0;
    this._hoverAlpha += (goal - this._hoverAlpha) * (1 - Math.exp(-dt / 0.09));
    const hb = this.hoverBox;
    if (a) {
      const s = a.ud.size;
      a.object.updateWorldMatrix(true, false);
      hb.matrix.copy(a.object.matrixWorld).multiply(new THREE.Matrix4().makeScale(s.x / 2 + 0.25, s.y / 2 + 0.2, s.z / 2 + 0.25).setPosition(0, s.y / 2 + 0.05, 0));
      hb.matrixWorldNeedsUpdate = true;
    }
    hb.material.opacity = this._hoverAlpha * 0.95;
    hb.visible = this._hoverAlpha > 0.02;
  }

  // ---- loop ----------------------------------------------------------------------------------

  onFrame(fn) { this.frameListeners.push(fn); }

  start() { this.running = true; this._kick(); }
  stop() { this.running = false; }

  _kick() {
    if (this._raf || !this.running) return;
    this.lastNow = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  _visible() {
    return this.running && !document.hidden && !this.container.hidden && this.container.clientWidth > 0;
  }

  _loop(now) {
    this._raf = 0;
    if (!this._visible()) return;       // paused; _kick() restarts on show, resize or tab focus
    this._raf = requestAnimationFrame(this._loop);
    const raw = this.lastNow ? (now - this.lastNow) / 1000 : 1 / 60;
    this.lastNow = now;
    // a long frame slows the animation down for a moment instead of making it jump ahead
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    this.renderFrame(dt, now, raw);
  }

  renderFrame(dt, now, raw) {
    const t = this.time;
    this.rig.update(dt, now);
    if (this._hoverPoll && !this.rig.flying) this._hoverPoll();

    // models
    this.assets.forEach((a) => {
      if (a.fade) {
        const f = a.fade;
        f.t += dt;
        if (f.t >= 0) {
          const k = smoother(f.t / f.T);
          a.opacity = f.from + (f.to - f.from) * k;
          if (f.t >= f.T) { a.opacity = f.to; a.fade = null; }
          try { a.ud.setEnclosureOpacity(a.opacity); } catch (e) { a.fade = null; }
        }
      }
      try { a.ud.update(dt, t, this.telemetry(a.id)); } catch (e) { /* a bad model must not stop the frame */ }
    });
    for (let i = 0; i < this.updaters.length; i++) { try { this.updaters[i].update(dt, t, undefined); } catch (e) { /* ignore */ } }

    this._updateSun();
    // static casters: redraw the shadow map when the frustum moved, while an enclosure is
    // fading, and a few times a second regardless
    this._shadowAge = (this._shadowAge || 0) + dt;
    let fading = false;
    this.assets.forEach((a) => { if (a.fade) fading = true; });
    if (this._shadowDirty || fading || this._shadowAge > 0.3) { this.sun.shadow.needsUpdate = true; this._shadowDirty = false; this._shadowAge = 0; }
    this._updatePlume();
    this._updateHoverBox(dt);
    for (let i = 0; i < this.frameListeners.length; i++) this.frameListeners[i](dt, now);

    if (this.quality === 'low') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);

    this._trackPerf(raw != null ? raw : dt, now);
  }

  _trackPerf(raw, now) {
    const st = this.stats;
    const ms = raw * 1000;
    st.frames++;
    if (st.samples.length < 6000) st.samples.push(ms);
    if (ms > 250) return;                                  // tab switch or debugger, not a signal
    st.ema += (ms - st.ema) * 0.03;
    if (this.qualityLocked || !this._warmAt || now - this._warmAt < 4000) { st.slow = 0; return; }
    // step down after about 1.5 s of sustained frames slower than 30 fps
    st.slow = st.ema > 33 ? (st.slow || 0) + raw : 0;
    if (st.slow > 1.5) {
      st.slow = 0; st.ema = 16; this._warmAt = now;
      if (this.quality === 'high') this.setQuality('medium');
      else if (this.quality === 'medium') this.setQuality('low');
    }
  }
}

// Corner brackets of a unit cube (-1..1), drawn as line segments around a hovered asset.
function makeBracketBox() {
  const pts = [];
  const L = 0.22;
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) {
    pts.push(x, y, z, x - x * L * 0.6, y, z);
    pts.push(x, y, z, x, y - y * L * 1.4, z);
    pts.push(x, y, z, x, y, z - z * L * 1.6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthTest: true });
  const l = new THREE.LineSegments(geo, mat);
  l.matrixAutoUpdate = false;
  l.frustumCulled = false;
  l.renderOrder = 10;
  return l;
}
