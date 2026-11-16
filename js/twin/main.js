// Entry point for the 3D digital twin. Reacts to App.onSelection and directs the sequence:
// 2D map zoom -> crossfade -> fly-in -> facility view -> asset view, and the same in reverse.
// The scene never talks to the side panel; both go through window.App.
import { TwinScene } from './scene.js';
import { TwinHud } from './hud.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
const FADE_MS = 600;            // must match the #twin opacity transition in css/twin.css
const MAP_ZOOM = 16;            // 2D map zoom the fly-in hands over from (the basemap's max)
const MAP_FLY_S = 1.7;
const FLY_IN_S = 3.8;
const FLY_OUT_S = 3.1;

function readOptions() {
  const o = Object.assign({}, window.TWIN_OPTS || {});
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('twinq')) o.quality = q.get('twinq');             // high | medium | low
    if (q.get('twinimagery') === '0') o.imagery = false;
    if (q.get('twinopen')) o.enclosureOpacity = Number(q.get('twinopen'));
  } catch (e) { /* no URL access */ }
  return o;
}

async function waitForApp() {
  for (let i = 0; i < 400; i++) {
    if (window.App && window.Sim) break;
    await sleep(50);
  }
  if (!window.App || !window.Sim) return false;
  if (window.App.ready && typeof window.App.ready.then === 'function') {
    try { await window.App.ready; } catch (e) { /* carry on with whatever loaded */ }
  }
  return true;
}

class Director {
  constructor(el, scene, hud, opts) {
    this.el = el; this.scene = scene; this.hud = hud; this.opts = opts;
    this.gen = 0;
    this.cur = { siteId: null, assetId: null };
    this.visible = false;
    this.savedFacility = null;
  }

  get map() { return window.FleetMap && window.FleetMap.map ? window.FleetMap : null; }
  mapZoom() {
    const fm = this.map;
    let z = MAP_ZOOM;
    try { if (fm && fm.map.getMaxZoom && isFinite(fm.map.getMaxZoom())) z = Math.min(z, fm.map.getMaxZoom()); } catch (e) { /* default */ }
    return z;
  }

  handle(sel) {
    const gen = ++this.gen;
    const siteId = sel && sel.siteId, assetId = sel && sel.assetId;
    const run = !siteId ? this.exitToMap(gen)
      : (siteId !== this.cur.siteId || !this.visible) ? this.enterSite(siteId, assetId, gen)
        : assetId !== this.cur.assetId ? (assetId ? this.toAsset(assetId, gen) : this.toFacility(gen))
          : Promise.resolve();
    run.catch((err) => console.error('[twin] transition failed', err));
  }

  stale(gen) { return gen !== this.gen; }

  async enterSite(siteId, assetId, gen) {
    const { el, scene, hud } = this;
    const rig = scene.rig;
    const zoom = this.mapZoom();
    const fm = this.map;

    // Returning to the site that is still on screen (for example re-selected during a fly-out):
    // blend back in from wherever the camera is.
    if (this.visible && scene.layout && scene.layout.siteId === siteId) {
      this.cur = { siteId, assetId: null };
      el.classList.add('is-visible');
      el.classList.remove('is-passive');
      if (fm) fm.flyToSite(siteId, zoom, 0.4);
      hud.setMode('facility');
      await rig.flyTo(scene.facilityPose(), { style: 'arc', duration: 2.4 });
      if (this.stale(gen)) return;
      scene.applyLimits('facility');
      hud.setPills(true); hud.setSettled(true);
      if (assetId) return this.toAsset(assetId, gen);
      return;
    }

    hud.setSettled(false); hud.setPills(false); hud.setMode('hidden');
    if (this.visible) {                      // switching straight from one site to another
      el.classList.add('is-passive');
      el.classList.remove('is-visible');
      await sleep(FADE_MS);
      if (this.stale(gen)) return;
      scene.stop();
      this.visible = false;
    }
    this.cur = { siteId: null, assetId: null };

    // Everything heavy happens first, while nothing is moving: the site is built, uploaded to
    // the GPU and its shaders compiled behind a small loading chip (a no-op if hovering the
    // pin already prepared it). Only then do the map zoom and the flight start, so neither
    // can hitch.
    el.hidden = false;
    el.classList.add('is-passive', 'is-loading');
    await nextFrame();
    scene.resize();
    let layout;
    try { layout = await scene.loadSite(siteId); } catch (err) {
      if (!this.stale(gen)) { el.classList.remove('is-loading'); el.hidden = true; }
      throw err;
    }
    if (!this.stale(gen)) el.classList.remove('is-loading');
    if (this.stale(gen)) return;
    if (!layout) return;
    scene.setFocus(null, { duration: 0 });
    hud.setSite(siteId);
    this.savedFacility = null;

    // The 2D map zooms to the pin. The 3D camera starts at the pose that matches the map's
    // final view and takes over while the map is still easing in, so both are moving through
    // the crossfade.
    const t0 = performance.now();
    const mapFly = fm ? fm.flyToSite(siteId, zoom, MAP_FLY_S) : Promise.resolve();
    if (fm) await Promise.race([mapFly, sleep(t0 + MAP_FLY_S * 1000 - 380 - performance.now())]);
    if (this.stale(gen)) return;
    this.cur = { siteId, assetId: null };
    rig.setPose(scene.topDownPose(zoom));
    scene.applyLimits('facility');
    scene.start();
    scene.renderFrame(1 / 60, performance.now());
    await nextFrame();
    this.visible = true;
    el.classList.add('is-visible');
    el.classList.remove('is-passive');
    const flight = rig.flyTo(scene.facilityPose(), { style: 'flyIn', duration: FLY_IN_S });
    const fz = this.opts.freeze;
    if (fz && fz.move === 'flyIn') { rig.freezeAt(fz.at); return; }
    hud.setMode('facility');
    // pills come up as the camera lands; the facility card after it settles
    sleep(FLY_IN_S * 1000 - 700).then(() => { if (!this.stale(gen)) hud.setPills(true); });
    await flight;
    if (this.stale(gen)) return;
    scene.applyLimits('facility');
    hud.setPills(true);
    if (assetId) return this.toAsset(assetId, gen);
    hud.setSettled(true);
  }

  async toAsset(id, gen) {
    const { scene, hud } = this;
    const rig = scene.rig;
    const rec = scene.assets.get(id);
    if (!rec) return this.toFacility(gen);
    const from = this.cur.assetId;
    if (!from && !rig.flying) this.savedFacility = rig.currentPose();
    this.cur.assetId = id;
    hud.setSettled(false);
    hud.setMode('asset', id);
    hud.setPills(true);
    scene.setFocus(id);                       // neighbors close; the target waits for its interior
    // Build the lazily constructed interior while the camera is at rest, so that cost never
    // lands inside a flight. If a flight is already under way, defer it until after landing.
    if (!rec.opened && !rig.flying) {
      await scene.prewarmAsset(id);
      if (this.stale(gen)) return;
    }
    if (rec.opened) scene.startFocusFade(1.7, 0.2);
    const pose = scene.assetPose(id);
    const done = await rig.flyTo(pose, { style: from ? 'dolly' : 'arc' });
    if (this.stale(gen)) return;
    const fz = this.opts.freeze;
    if (fz && fz.move === 'asset') return;
    scene.applyLimits(done ? 'asset' : 'asset-loose');
    if (!rec.opened) {
      await scene.prewarmAsset(id);
      if (this.stale(gen)) return;
      scene.startFocusFade(1.3, 0);
    }
    hud.setSettled(true);
  }

  async toFacility(gen) {
    const { scene, hud } = this;
    this.cur.assetId = null;
    hud.setSettled(false);
    hud.setMode('facility');
    scene.setFocus(null, { duration: 1.5 });  // enclosure fades back to solid during the pull-back
    const pose = this.savedFacility || scene.facilityPose();
    await scene.rig.flyTo(pose, { style: 'arc', bump: 0.05 });
    if (this.stale(gen)) return;
    scene.applyLimits('facility');
    hud.setSettled(true);
  }

  async exitToMap(gen) {
    const { el, scene, hud } = this;
    const fm = this.map;
    if (!this.visible || !scene.layout) {
      this.cur = { siteId: null, assetId: null };
      el.classList.remove('is-loading');
      if (!this.visible) el.hidden = true;
      if (fm) window.FleetMap.reset(0.9);
      return;
    }
    const zoom = this.mapZoom();
    const siteId = scene.layout.siteId;
    this.cur = { siteId: null, assetId: null };
    hud.setSettled(false); hud.setPills(false); hud.setMode('hidden');
    scene.setFocus(null, { duration: 1.2 });
    scene.setHover(null);
    el.classList.add('is-passive');
    // The map waits underneath at the matching view, without animating.
    try { if (fm) { fm.map.stop(); fm.map.setView([scene.layout.lat, scene.layout.lon], zoom, { animate: false }); } } catch (e) { /* map stays where it is */ }
    const T = scene.rig.reducedMotion ? 0 : FLY_OUT_S;
    const flight = scene.rig.flyTo(scene.topDownPose(zoom), { style: 'flyOut', duration: T, interruptible: false, handoff: false });
    const fz = this.opts.freeze;
    if (fz && fz.move === 'flyOut') { scene.rig.freezeAt(fz.at); return; }
    await sleep(T * 1000 - FADE_MS * 0.8);
    if (this.stale(gen)) return;
    el.classList.remove('is-visible');        // crossfade while the camera is still rising
    await sleep(FADE_MS * 0.85);
    if (this.stale(gen)) return;
    // The map eases out to the fleet once the camera has stopped. Starting it earlier was
    // measured to drop frames at the end of the climb (Leaflet sets up its zoom on the main thread).
    if (fm) window.FleetMap.reset(1.8);
    await Promise.all([flight, sleep(FADE_MS * 0.2)]);
    if (this.stale(gen)) return;
    scene.stop();
    el.hidden = true;
    this.visible = false;
    void siteId;
  }
}

async function boot() {
  const el = document.getElementById('twin');
  if (!el) return;
  if (!(await waitForApp())) { console.warn('[twin] App/Sim not found, 3D view disabled'); return; }
  const App = window.App, Sim = window.Sim;
  const opts = readOptions();
  const motion = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  let scene;
  try {
    scene = new TwinScene(el, Object.assign({
      Sim, theme: typeof App.theme === 'function' ? App.theme() : 'dark', reducedMotion: opts.reducedMotion != null ? opts.reducedMotion : motion.matches
    }, opts));
  } catch (err) {
    console.warn('[twin] WebGL unavailable, staying on the 2D map', err);
    return;
  }
  App.autoFly = false;          // this module drives FleetMap.flyToSite / FleetMap.reset from here on

  const hud = new TwinHud(el, scene, {
    Sim,
    onSelectAsset: (id) => App.selectAsset(id),
    onBack: () => { if (App.selection && App.selection.assetId) App.selectAsset(null); else App.selectSite(null); },
    onEnclosure: (v) => scene.setEnclosureOpacity(v)
  });
  const director = new Director(el, scene, hud, opts);
  scene.onFrame((dt) => hud.update(dt));
  scene.onPick = (id) => {
    const sel = App.selection || {};
    if (id) { if (id !== sel.assetId) App.selectAsset(id); } else if (sel.assetId) App.selectAsset(null);
  };
  // Hovering a unit while the camera is at rest builds its interior ahead of the click.
  let hoverTimer = 0;
  scene.onHover = (id) => {
    clearTimeout(hoverTimer);
    if (!id) return;
    hoverTimer = setTimeout(async () => {
      const rec = scene.assets.get(id);
      if (!rec || rec.opened || scene.rig.flying || scene.hoverId !== id) return;
      await scene.prewarmAsset(id);
      if (scene.focusId !== id && !rec.fade) { rec.opacity = 1; try { rec.ud.setEnclosureOpacity(1); } catch (e) { /* ignore */ } }
    }, 220);
  };
  if (typeof Sim.onTick === 'function') Sim.onTick(() => { scene.syncStatus(); hud.refresh(); });
  if (typeof App.onTheme === 'function') App.onTheme((t) => scene.setTheme(t));
  if (motion.addEventListener) motion.addEventListener('change', (e) => { scene.rig.reducedMotion = e.matches; });
  App.onSelection((sel) => director.handle(sel));

  // Glass settings: tint is the darkness of the HUD glass (0..1), blur its backdrop blur in px.
  // Blur is opt-in by class because a backdrop filter costs a compositor pass per panel even at 0px.
  const setGlass = (o) => {
    if (o && o.tint != null) el.style.setProperty('--hud-tint', String(o.tint));
    if (o && o.blur != null) { el.style.setProperty('--hud-blur', o.blur + 'px'); el.classList.toggle('hud-blur', o.blur > 0); }
  };
  // Hovering a map pin prepares that site in the background, so the click that usually
  // follows starts moving at once.
  let pinTimer = 0;
  const prewarm = (siteId) => {
    clearTimeout(pinTimer);
    pinTimer = setTimeout(() => {
      if (director.visible || (App.selection && App.selection.siteId)) return;
      scene.resize();
      scene.loadSite(siteId).catch(() => {});
    }, 140);
  };
  const hookPins = () => {
    const fm = window.FleetMap;
    if (!fm || !fm.map || typeof fm.map.eachLayer !== 'function') return;
    let sites = [];
    try { sites = Sim.sites().sites || []; } catch (e) { return; }
    fm.map.eachLayer((l) => {
      if (l.__twinHover || typeof l.getLatLng !== 'function' || typeof l.on !== 'function') return;
      const ll = l.getLatLng();
      const site = sites.find((x) => Math.abs(x.lat - ll.lat) < 1e-6 && Math.abs(x.lon - ll.lng) < 1e-6);
      if (!site) return;
      l.__twinHover = true;
      l.on('mouseover', () => prewarm(site.id));
      l.on('mouseout', () => clearTimeout(pinTimer));
    });
  };
  hookPins();
  try { if (window.FleetMap && window.FleetMap.map) window.FleetMap.map.on('layeradd', hookPins); } catch (e) { /* no map */ }
  window.addEventListener('fleetmap-ready', hookPins);

  const chip = document.createElement('div');
  chip.className = 'twin-loading';
  chip.setAttribute('role', 'status');
  chip.textContent = 'Preparing 3D view';
  el.appendChild(chip);

  window.Twin = { scene, hud, director, setGlass };
  scene.ensureModels();          // fetch and parse the model modules before the first click
  if (App.selection && App.selection.siteId) director.handle(App.selection);
  window.dispatchEvent(new Event('twin-ready'));
}

boot();
