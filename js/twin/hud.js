// HUD: clear-glass HTML overlays inside #twin that track assets in screen space.
// Positions update every frame, values on Sim.onTick (and ease toward new values so they
// never jump). Cards, pills and the leader line animate in after the camera settles.
import * as THREE from 'three';
import { ENCLOSURE_FLOOR, hudCardWidth } from './scene.js';

const DOT = '\u00b7';
const DEGC = '\u00b0C';
const STATUS = {
  running: { word: 'RUNNING', cls: 'run' },
  standby: { word: 'STANDBY', cls: 'stby' },
  fault: { word: 'ALARM', cls: 'alarm' },
  service: { word: 'SERVICE', cls: 'svc' }
};
const GLYPH = {
  run: '<svg class="twin-glyph" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="#3ddc84" stroke="rgba(4,8,12,.75)" stroke-width="1.2"/></svg>',
  stby: '<svg class="twin-glyph" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="4.6" fill="none" stroke="rgba(4,8,12,.75)" stroke-width="4"/><circle cx="7" cy="7" r="4.6" fill="none" stroke="#b9c6d4" stroke-width="2.2"/></svg>',
  alarm: '<svg class="twin-glyph" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2 13.2 12.4H.8Z" fill="#ff5247" stroke="rgba(4,8,12,.75)" stroke-width="1.2" stroke-linejoin="round"/></svg>',
  svc: '<svg class="twin-glyph" viewBox="0 0 14 14" aria-hidden="true"><rect x="2" y="2" width="10" height="10" rx="1" fill="#6fd0ff" stroke="rgba(4,8,12,.75)" stroke-width="1.2"/></svg>'
};
const TAG_LABEL = {
  engine_speed: 'speed', real_power: 'power', coolant_temp: 'coolant temp', oil_pressure: 'oil pressure',
  exhaust_temp: 'exhaust temp', fuel_flow: 'fuel flow', enclosure_temp: 'enclosure temp', enclosure_humidity: 'enclosure humidity',
  soc: 'state of charge', soh: 'health', bess_power: 'power', cell_temp_min: 'cell temp', cell_temp_max: 'cell temp',
  rack_voltage: 'rack voltage', bess_humidity: 'humidity', h2: 'H2', co: 'CO', hvac_state: 'HVAC'
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clean = (s) => String(s == null ? '' : s).replace(/\s*\(customer undisclosed\)/ig, '').replace(/,?\s*customer undisclosed/ig, '').trim();
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }) : '--');

function tagVal(a, tag) {
  const t = a && a.tags && a.tags[tag];
  return t ? t.value : undefined;
}
function tagBad(a, tag) {
  const t = a && a.tags && a.tags[tag];
  if (!t) return false;
  if (tag === 'hvac_state') return t.value === 'fault' || t.value === 2;
  return t.quality === 'ALARM' || t.quality === 'OUT_OF_RANGE';
}
function ratingMw(a, Sim) {
  if (!a) return 0;
  if (isFinite(a.ratingMw)) return a.ratingMw;
  if (isFinite(a.rating_mw)) return a.rating_mw;
  try { const u = Sim.sites().units[a.unit]; if (u && isFinite(u.rating_mw)) return u.rating_mw; } catch (e) { /* unknown */ }
  return 0;
}
function powerMw(a, Sim) {
  const v = tagVal(a, a && a.kind === 'bess' ? 'bess_power' : 'real_power');
  if (typeof v !== 'number') return a && isFinite(a.load) ? a.load * ratingMw(a, Sim) : 0;
  const r = ratingMw(a, Sim);
  return r && v > r * 20 ? v / 1000 : v;       // tolerate kW feeds
}
// Effective display state: a unit with any reading in alarm shows the alarm glyph.
function stateOf(a) {
  if (!a) return { key: 'standby', cls: 'stby', word: 'STANDBY', alarm: false, what: '' };
  let what = '';
  const tags = a.tags || {};
  for (const k in tags) if (tagBad(a, k)) { what = TAG_LABEL[k] || k.replace(/_/g, ' '); break; }
  const alarm = a.status === 'fault' || !!what;
  const base = STATUS[alarm ? 'fault' : a.status] || STATUS.standby;
  return { key: alarm ? 'fault' : a.status, cls: base.cls, word: base.word, alarm, what };
}

// A number that eases toward its target instead of jumping.
class NumText {
  constructor(el, decimals) { this.el = el; this.d = decimals || 0; this.v = null; this.goal = null; this.txt = ''; }
  set(v) {
    if (typeof v !== 'number' || !isFinite(v)) { this.goal = null; this.v = null; this._write('--'); return; }
    this.goal = v;
    if (this.v == null) { this.v = v; this._write(num(v, this.d)); }
  }
  tick(dt) {
    if (this.goal == null || this.v === this.goal) return;
    const k = 1 - Math.exp(-dt / 0.28);
    this.v += (this.goal - this.v) * k;
    if (Math.abs(this.goal - this.v) < 0.5 * Math.pow(10, -this.d) * 0.2) this.v = this.goal;
    this._write(num(this.v, this.d));
  }
  _write(s) { if (s !== this.txt) { this.txt = s; this.el.textContent = s; } }
}

export class TwinHud {
  constructor(container, scene, api) {
    this.container = container;
    this.scene = scene;
    this.api = api;
    this.Sim = api.Sim;
    this.mode = 'hidden';
    this.settled = false;
    this.siteId = null;
    this.assetId = null;
    this.pills = new Map();
    this.charW = 7.2;
    this.nums = [];
    this.cardNums = [];
    this.cardPos = null;
    this.cardSide = 0;               // 0 right, 1 left, 2 above, 3 below the focused unit
    this._v = new THREE.Vector3();
    this._c = new THREE.Vector3();

    const root = document.createElement('div');
    root.className = 'twin-hud';
    root.dataset.mode = 'hidden';
    root.innerHTML =
      '<svg class="twin-svg" aria-hidden="true"><path class="twin-reticle"/><line class="twin-leader" pathLength="1"/><circle class="twin-dot" r="4"/></svg>' +
      '<div class="twin-pills"></div>' +
      '<div class="twin-card"><section class="twin-card-in twin-glass" aria-label="Selected asset"></section></div>' +
      '<section class="twin-site twin-glass" aria-label="Facility summary"></section>' +
      '<div class="twin-controls">' +
        '<button type="button" class="twin-btn twin-glass twin-back" title="Back to the fleet map (Esc)">' +
          '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M8.5 2.5 4 7l4.5 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Fleet map</span></button>' +
        '<label class="twin-slider twin-glass" title="Enclosure opacity. Lower it to see the machine inside the cover.">' +
          '<span>Enclosure</span><input type="range" min="' + Math.round(ENCLOSURE_FLOOR * 100) + '" max="100" step="1" aria-label="Enclosure opacity"><output>15%</output></label>' +
      '</div>' +
      '<div class="twin-hint twin-glass"></div>' +
      '<div class="twin-attrib"></div>';
    container.appendChild(root);
    this.root = root;
    this.svg = root.querySelector('.twin-svg');
    this.leader = root.querySelector('.twin-leader');
    this.dot = root.querySelector('.twin-dot');
    this.reticle = root.querySelector('.twin-reticle');
    this.pillWrap = root.querySelector('.twin-pills');
    this.card = root.querySelector('.twin-card');
    this.cardIn = root.querySelector('.twin-card-in');
    this.site = root.querySelector('.twin-site');
    this.back = root.querySelector('.twin-back');
    this.backLabel = this.back.querySelector('span');
    this.slider = root.querySelector('.twin-slider');
    this.range = this.slider.querySelector('input');
    this.rangeOut = this.slider.querySelector('output');
    this.hint = root.querySelector('.twin-hint');
    this.attrib = root.querySelector('.twin-attrib');

    this.range.value = Math.round(scene.enclosureOpacity * 100);
    this.rangeOut.textContent = this.range.value + '%';
    this.range.addEventListener('input', () => {
      this.rangeOut.textContent = this.range.value + '%';
      api.onEnclosure(Math.max(ENCLOSURE_FLOOR, Number(this.range.value) / 100));
    });
    this.back.addEventListener('click', () => api.onBack());
    this.pillWrap.addEventListener('click', (e) => {
      const b = e.target.closest('.twin-pill');
      if (b) api.onSelectAsset(b.dataset.id);
    });
    this.pillWrap.addEventListener('pointerover', (e) => {
      const b = e.target.closest('.twin-pill');
      if (b) scene.setHover(b.dataset.id === this.assetId ? null : b.dataset.id);
    });
    this.pillWrap.addEventListener('pointerout', () => scene.setHover(null));
  }

  // ---- mode ----------------------------------------------------------------------------------

  setSite(siteId) {
    this.siteId = siteId;
    this.pillWrap.textContent = '';
    this.pills.clear();
    this.nums = [];
    this.scene.assets.forEach((a) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'twin-pill';
      b.dataset.id = a.id;
      b.innerHTML = '<span class="twin-pill-in twin-glass"><span class="g"></span><span class="id">' + esc(a.id) + '</span><span class="sep">' + DOT + '</span><span class="v"></span><span class="more"></span></span>';
      this.pillWrap.appendChild(b);
      const p = { id: a.id, a, el: b, g: b.querySelector('.g'), v: b.querySelector('.v'), more: b.querySelector('.more'), w: 120, h: 26, cls: '', vtxt: '', shown: false, moreN: 0, x: 0, y: 0 };
      p.num = null;
      this.pills.set(a.id, p);
    });
    this._buildSiteCard();
    this.attrib.textContent = (this.scene.ground && this.scene.ground.attribution) || '';
    this.refresh();
    this._measurePills();
  }

  setMode(mode, assetId) {
    const was = this.assetId;
    this.mode = mode;
    this.assetId = mode === 'asset' ? assetId : null;
    this.root.dataset.mode = mode;
    if (mode === 'asset') {
      this.backLabel.textContent = 'Facility';
      this.back.title = 'Back to the facility view (Esc)';
      this.hint.textContent = 'Drag to orbit ' + DOT + ' Scroll to zoom ' + DOT + ' Esc to go back';
      if (was !== assetId) { this._buildCard(); this.cardPos = null; }
    } else {
      this.backLabel.textContent = 'Fleet map';
      this.back.title = 'Back to the fleet map (Esc)';
      this.hint.textContent = 'Click an asset to fly in ' + DOT + ' Drag to orbit ' + DOT + ' Scroll to zoom ' + DOT + ' Esc to go back';
    }
    this.refresh();
  }

  // settled = the camera has arrived; overlays animate in. false = in flight; overlays ease out.
  setSettled(on) {
    this.settled = !!on;
    this.root.classList.toggle('is-settled', this.settled);
  }

  setPills(on) { this.root.classList.toggle('pills-on', !!on); }

  setEnclosureValue(v) {
    this.range.value = Math.round(v * 100);
    this.rangeOut.textContent = this.range.value + '%';
  }

  // ---- facility card -------------------------------------------------------------------------

  _summary() {
    const S = this.Sim;
    let sum = null;
    try { if (S && typeof S.siteSummary === 'function') sum = S.siteSummary(this.siteId); } catch (e) { sum = null; }
    const list = [];
    this.scene.assets.forEach((a) => { const t = this.scene.telemetry(a.id); if (t) list.push(t); });
    const gens = list.filter((a) => a.kind !== 'bess'), bess = list.filter((a) => a.kind === 'bess');
    const site = (this.scene.layout && this.scene.layout.site) || {};
    const calc = {
      customer: site.customer || site.name || this.siteId, type: site.type || '',
      outputMw: gens.reduce((s, a) => s + (a.status === 'running' ? powerMw(a, S) : 0), 0),
      onlineMw: gens.reduce((s, a) => s + (a.status === 'running' ? ratingMw(a, S) : 0), 0),
      installedMw: gens.reduce((s, a) => s + ratingMw(a, S), 0),
      running: gens.filter((a) => a.status === 'running').length,
      standby: gens.filter((a) => a.status === 'standby').length,
      alarms: list.filter((a) => stateOf(a).alarm).length,
      inService: gens.filter((a) => a.status === 'service').length,
      redundancy: '',
      bess: bess.length ? {
        count: bess.length, mwh: bess.reduce((s, a) => s + (a.ratingMwh || 5), 0),
        socPct: bess.reduce((s, a) => s + (tagVal(a, 'soc') || 0), 0) / bess.length, rideThroughMin: null
      } : null
    };
    const out = sum ? Object.assign({}, calc, sum) : calc;
    if (sum && sum.bess === undefined) out.bess = calc.bess;
    if (out.bess && !(out.bess.count > 0)) out.bess = null;      // no battery rows for sites without batteries
    return out;
  }

  _buildSiteCard() {
    const s = this._summary();
    this.site.innerHTML =
      '<div class="twin-row twin-head"><span class="twin-lbl" data-k="type"></span><span class="twin-status" data-k="status"></span></div>' +
      '<div class="twin-title" data-k="name"></div>' +
      '<div class="twin-grid g3">' +
        '<div class="twin-cell"><span class="twin-lbl">Output</span><span class="twin-val"><b data-k="out"></b> <i>MW</i></span></div>' +
        '<div class="twin-cell"><span class="twin-lbl">Online</span><span class="twin-val"><b data-k="onl"></b> <i>MW</i></span></div>' +
        '<div class="twin-cell"><span class="twin-lbl">Installed</span><span class="twin-val"><b data-k="inst"></b> <i>MW</i></span></div>' +
      '</div>' +
      '<div class="twin-bar" title="Output as a share of online capacity"><div data-k="bar"></div></div>' +
      '<div class="twin-list">' +
        '<div class="twin-row"><span class="twin-key">Gensets</span><span class="twin-mono" data-k="gens"></span></div>' +
        '<div class="twin-row"><span class="twin-key">Redundancy</span><span class="twin-mono" data-k="red"></span></div>' +
        (s.bess ? '<div class="twin-row"><span class="twin-key">Battery</span><span class="twin-mono" data-k="bat"></span></div>' +
          '<div class="twin-row"><span class="twin-key">Ride-through</span><span class="twin-mono" data-k="ride"></span></div>' : '') +
      '</div>';
    const q = (k) => this.site.querySelector('[data-k="' + k + '"]');
    this.siteEls = { type: q('type'), status: q('status'), name: q('name'), bar: q('bar'), gens: q('gens'), red: q('red'), bat: q('bat'), ride: q('ride') };
    this.siteNums = { out: new NumText(q('out'), 2), onl: new NumText(q('onl'), 2), inst: new NumText(q('inst'), 1) };
  }

  _refreshSiteCard() {
    if (!this.siteEls) return;
    const s = this._summary(), E = this.siteEls;
    const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    setText(E.type, clean(s.type));
    setText(E.name, clean(s.customer));
    const alarm = (s.alarms || 0) > 0;
    const html = (alarm ? GLYPH.alarm : GLYPH.run) + '<span>' + (alarm ? 'ALARM' : 'NORMAL') + '</span>';
    if (E.status.dataset.s !== String(alarm)) { E.status.dataset.s = String(alarm); E.status.innerHTML = html; E.status.className = 'twin-status ' + (alarm ? 'alarm' : 'run'); }
    this.siteNums.out.set(s.outputMw); this.siteNums.onl.set(s.onlineMw); this.siteNums.inst.set(s.installedMw);
    const pct = s.onlineMw > 0 ? Math.min(100, (s.outputMw / s.onlineMw) * 100) : 0;
    E.bar.style.width = pct.toFixed(1) + '%';
    E.bar.className = alarm ? 'alarm' : '';
    setText(E.gens, (s.running || 0) + ' running ' + DOT + ' ' + (s.standby || 0) + ' standby ' + DOT + ' ' + (s.alarms || 0) + ' alarm' + (s.inService ? ' ' + DOT + ' ' + s.inService + ' service' : ''));
    setText(E.red, clean(s.redundancy) || '--');
    if (s.bess && E.bat) {
      setText(E.bat, s.bess.count + ' units ' + DOT + ' ' + num(s.bess.mwh, 1) + ' MWh ' + DOT + ' SOC ' + num(s.bess.socPct, 0) + '%');
      const m = s.bess.rideThroughMin;
      setText(E.ride, typeof m === 'number' && isFinite(m) ? (m >= 60 ? Math.floor(m / 60) + ' h ' : '') + Math.round(m % 60) + ' min at current load' : 'n/a');
    }
  }

  // ---- asset card ----------------------------------------------------------------------------

  _buildCard() {
    const a = this.scene.telemetry(this.assetId) || { id: this.assetId, kind: 'genset' };
    const rec = this.scene.assets.get(this.assetId);
    const bess = a.kind === 'bess';
    const cell = (k, label, unit, cls) => '<div class="twin-cell" data-c="' + k + '"><span class="twin-lbl">' + label + '</span><span class="twin-val' + (cls || '') + '"><b data-k="' + k + '"></b>' + (unit ? ' <i>' + unit + '</i>' : '') + '</span></div>';
    const head =
      '<div class="twin-row twin-head"><span class="twin-status" data-k="status"></span><span class="twin-lbl" data-k="type"></span></div>' +
      '<div class="twin-row twin-idrow"><span class="twin-id">' + esc(a.id) + '</span><span class="twin-mono twin-slot">' + esc(rec ? rec.slot : '') + '</span></div>' +
      '<div class="twin-grid g2">' +
        '<div class="twin-cell"><span class="twin-lbl">Asset no.</span><span class="twin-mono">' + esc(a.assetNo || '--') + '</span></div>' +
        '<div class="twin-cell"><span class="twin-lbl">Serial</span><span class="twin-mono">' + esc(a.serial || '--') + '</span></div>' +
      '</div>';
    let body;
    if (bess) {
      body =
        '<div class="twin-load"><div class="twin-row"><span class="twin-lbl">State of charge</span><span class="twin-mono"><b class="big" data-k="soc"></b>% ' + DOT + ' <span data-k="flow"></span></span></div>' +
        '<div class="twin-bar"><div data-k="bar"></div></div></div>' +
        '<div class="twin-grid g3">' +
          '<div class="twin-cell" data-c="cell"><span class="twin-lbl">Cell temp</span><span class="twin-val"><b data-k="cmin"></b>-<b data-k="cmax"></b> <i>' + DEGC + '</i></span></div>' +
          cell('bess_humidity', 'Humidity', '%RH') + cell('soh', 'Health', '%') +
          cell('h2', 'H2', '%LEL') + cell('co', 'CO', 'ppm') +
          '<div class="twin-cell" data-c="hvac_state"><span class="twin-lbl">HVAC</span><span class="twin-val word"><b data-k="hvac"></b></span></div>' +
        '</div>';
    } else {
      body =
        '<div class="twin-load"><div class="twin-row"><span class="twin-lbl">Load</span><span class="twin-mono"><b class="big" data-k="mw"></b> / ' + num(ratingMw(a, this.Sim), 2) + ' MW ' + DOT + ' <span data-k="pct"></span>%</span></div>' +
        '<div class="twin-bar"><div data-k="bar"></div></div></div>' +
        '<div class="twin-grid g4">' +
          cell('engine_speed', 'Speed', 'rpm') + cell('coolant_temp', 'Coolant', DEGC) + cell('oil_pressure', 'Oil', 'kPa') + cell('exhaust_temp', 'Exhaust', DEGC) +
        '</div>' +
        '<div class="twin-grid g4">' +
          cell('enclosure_temp', 'Encl. temp', DEGC) + cell('enclosure_humidity', 'Encl. RH', '%') +
        '</div>';
    }
    const foot = '<div class="twin-row twin-foot"><span><span class="twin-key">Run hours</span> <b class="twin-mono" data-k="hours"></b></span>' +
      '<span><span class="twin-key">Next service</span> <b class="twin-mono" data-k="due"></b><span data-k="task"></span></span></div>';
    this.cardIn.innerHTML = head + body + foot;
    const q = (k) => this.cardIn.querySelector('[data-k="' + k + '"]');
    const E = { status: q('status'), type: q('type'), bar: q('bar'), flow: q('flow'), hvac: q('hvac'), due: q('due'), task: q('task') };
    E.cells = {};
    this.cardIn.querySelectorAll('[data-c]').forEach((el) => { E.cells[el.dataset.c] = el; });
    this.cardEls = E;
    const N = (k, d) => (q(k) ? new NumText(q(k), d) : null);
    this.cardNumMap = bess
      ? { soc: N('soc', 0), cmin: N('cmin', 0), cmax: N('cmax', 0), bess_humidity: N('bess_humidity', 0), soh: N('soh', 0), h2: N('h2', 1), co: N('co', 0), hours: N('hours', 0) }
      : { mw: N('mw', 2), pct: N('pct', 0), engine_speed: N('engine_speed', 0), coolant_temp: N('coolant_temp', 0), oil_pressure: N('oil_pressure', 0),
        exhaust_temp: N('exhaust_temp', 0), enclosure_temp: N('enclosure_temp', 1), enclosure_humidity: N('enclosure_humidity', 0), hours: N('hours', 0) };
    this.cardKind = bess ? 'bess' : 'genset';
    this.cardSize = null;
  }

  _refreshCard() {
    if (!this.cardEls || !this.assetId) return;
    const a = this.scene.telemetry(this.assetId);
    if (!a) return;
    const E = this.cardEls, M = this.cardNumMap, S = this.Sim;
    const st = stateOf(a);
    const label = st.alarm ? 'ALARM' + (st.what ? ' ' + DOT + ' ' + st.what.toUpperCase() : '') : st.word;
    if (E.status.dataset.s !== st.cls + label) {
      E.status.dataset.s = st.cls + label;
      E.status.className = 'twin-status ' + st.cls;
      E.status.innerHTML = GLYPH[st.cls] + '<span>' + esc(label) + '</span>';
    }
    const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    const mark = (k, bad) => { const c = E.cells[k]; if (c) c.classList.toggle('is-alarm', !!bad); };
    if (this.cardKind === 'bess') {
      setText(E.type, 'Battery ' + DOT + ' ' + num(a.ratingMwh || 5, 1) + ' MWh LFP');
      const soc = tagVal(a, 'soc');
      M.soc.set(soc);
      E.bar.style.width = Math.max(0, Math.min(100, soc || 0)).toFixed(1) + '%';
      E.bar.className = tagBad(a, 'soc') ? 'alarm' : '';
      const p = powerMw(a, S);
      setText(E.flow, Math.abs(p) < 0.02 ? 'idle' : (p > 0 ? 'discharging ' : 'charging ') + num(Math.abs(p), 2) + ' MW');
      M.cmin.set(tagVal(a, 'cell_temp_min')); M.cmax.set(tagVal(a, 'cell_temp_max'));
      mark('cell', tagBad(a, 'cell_temp_min') || tagBad(a, 'cell_temp_max'));
      for (const k of ['bess_humidity', 'soh', 'h2', 'co']) { M[k].set(tagVal(a, k)); mark(k, tagBad(a, k)); }
      let hv = tagVal(a, 'hvac_state');
      if (typeof hv === 'number') hv = ['idle', 'cooling', 'fault'][hv] || 'idle';
      hv = String(hv || 'idle');
      setText(E.hvac, hv.charAt(0).toUpperCase() + hv.slice(1));
      mark('hvac_state', tagBad(a, 'hvac_state'));
    } else {
      setText(E.type, (a.unit || 'Genset') + ' ' + DOT + ' gas recip');
      const mw = a.status === 'running' || a.status === 'fault' ? powerMw(a, S) : 0, r = ratingMw(a, S);
      const pct = r ? (mw / r) * 100 : 0;
      M.mw.set(mw); M.pct.set(pct);
      E.bar.style.width = Math.max(0, Math.min(100, pct)).toFixed(1) + '%';
      E.bar.className = st.alarm ? 'alarm' : '';
      for (const k of ['engine_speed', 'coolant_temp', 'oil_pressure', 'exhaust_temp', 'enclosure_temp', 'enclosure_humidity']) { M[k].set(tagVal(a, k)); mark(k, tagBad(a, k)); }
    }
    M.hours.set(a.runHours);
    const ns = a.nextService;
    setText(E.due, ns && isFinite(ns.dueInH) ? num(ns.dueInH, 0) + ' h' : '--');
    setText(E.task, ns && ns.task ? ' ' + DOT + ' ' + ns.task : '');
  }

  // ---- pills ---------------------------------------------------------------------------------

  _refreshPills() {
    const S = this.Sim;
    this.pills.forEach((p) => {
      const a = this.scene.telemetry(p.id);
      const st = stateOf(a);
      if (p.cls !== st.cls) { p.cls = st.cls; p.g.innerHTML = GLYPH[st.cls]; p.el.dataset.s = st.cls; }
      p.alarm = st.alarm;
      let txt, numeric = null, d = 2, suffix = '';
      if (!a) txt = '--';
      else if (a.kind === 'bess') { numeric = tagVal(a, 'soc'); d = 0; suffix = '%'; }
      else if (a.status === 'running') { numeric = powerMw(a, S); d = 2; suffix = ' MW'; }
      else txt = st.alarm ? 'alarm' : (a.status || 'standby');
      if (typeof numeric === 'number' && isFinite(numeric)) {
        p.goal = numeric; p.d = d; p.suffix = suffix;
        if (p.cur == null || p.txtMode) { p.cur = numeric; p.txtMode = false; this._writePill(p, num(numeric, d) + suffix); }
      } else {
        p.goal = null; p.cur = null; p.txtMode = true;
        this._writePill(p, txt || '--');
      }
      const title = p.id + ', ' + st.word.toLowerCase() + (st.what ? ' (' + st.what + ')' : '') + '. Click to fly to this unit.';
      if (p.el.title !== title) p.el.title = title;
    });
  }

  // Pill widths are measured once and then tracked arithmetically (the pill font is
  // monospace), so the per-frame declutter never forces a layout.
  _writePill(p, s) {
    if (p.vtxt !== s) {
      p.w += (s.length - p.vtxt.length) * this.charW;
      p.vtxt = s; p.v.textContent = s;
    }
  }

  _measurePills() {
    let cw = 0;
    this.pills.forEach((p) => {
      const w = p.el.offsetWidth;
      if (w) { p.w = w; p.h = p.el.offsetHeight; }
      if (!cw && p.vtxt.length) { const vw = p.v.offsetWidth; if (vw) cw = vw / p.vtxt.length; }
    });
    if (cw) this.charW = cw;
  }

  // ---- ticks ---------------------------------------------------------------------------------

  // 1 Hz: pull new values. Numbers ease toward them in update().
  refresh() {
    if (this.mode === 'hidden') return;
    this._refreshPills();
    this._refreshSiteCard();
    if (this.mode === 'asset') this._refreshCard();
  }

  project(world, out) {
    const cam = this.scene.camera;
    out.copy(world).applyMatrix4(cam.matrixWorldInverse);
    const behind = out.z > -cam.near;
    out.applyMatrix4(cam.projectionMatrix);
    out.x = (out.x * 0.5 + 0.5) * this.w;
    out.y = (-out.y * 0.5 + 0.5) * this.h;
    return !behind;
  }

  // every frame
  update(dt) {
    if (this.mode === 'hidden') return;
    const sc = this.scene;
    this.w = sc.width || this.container.clientWidth;
    this.h = sc.height || this.container.clientHeight;
    const cam = sc.camera;
    cam.updateMatrixWorld();

    // numbers ease
    if (this.siteNums) for (const k in this.siteNums) this.siteNums[k].tick(dt);
    if (this.mode === 'asset' && this.cardNumMap) for (const k in this.cardNumMap) if (this.cardNumMap[k]) this.cardNumMap[k].tick(dt);
    const kEase = 1 - Math.exp(-dt / 0.28);

    // pills: project, prioritize, declutter
    const list = [];
    this.pills.forEach((p) => {
      if (p.goal != null && p.cur !== p.goal) {
        p.cur += (p.goal - p.cur) * kEase;
        if (Math.abs(p.goal - p.cur) < 0.002) p.cur = p.goal;
        this._writePill(p, num(p.cur, p.d) + p.suffix);
      }
      const obj = p.a.object;
      this._v.copy(p.a.ud.hudAnchor).applyMatrix4(obj.matrixWorld);
      p.dist = this._v.distanceTo(cam.position);
      const ok = this.project(this._v, this._c);
      const x = this._c.x, y = this._c.y;
      p.on = ok && p.id !== this.assetId && x > -50 && x < this.w + 50 && y > -30 && y < this.h + 60;
      p.moreNext = 0;
      if (p.on) {
        p.x = Math.min(this.w - p.w / 2 - 6, Math.max(p.w / 2 + 6, x));
        p.y = Math.min(this.h - 8, Math.max(p.h + 22, y));
        list.push(p);
      }
    });
    list.sort((a, b) => (b.alarm ? 1 : 0) - (a.alarm ? 1 : 0) || (b.id === sc.hoverId ? 1 : 0) - (a.id === sc.hoverId ? 1 : 0) || a.dist - b.dist);
    const kept = [];
    // the open asset card is a blocker too, so pills never sit on top of its text
    if (this.mode === 'asset' && this.cardPos && this.cardSize) {
      kept.push({ l: this.cardPos.x - 6, r: this.cardPos.x + this.cardSize.w + 6, t: this.cardPos.y - 6, b: this.cardPos.y + this.cardSize.h + 6, p: { moreNext: 0 }, card: true });
    }
    for (const p of list) {
      const l = p.x - p.w / 2 - 3, r = p.x + p.w / 2 + 3, t = p.y - 14 - p.h - 3, b = p.y - 14 + 3;
      let blocker = null;
      for (const k of kept) { if (l < k.r && r > k.l && t < k.b && b > k.t) { blocker = k; break; } }
      // alarms are never hidden
      if (blocker && (!p.alarm || blocker.card)) { blocker.p.moreNext++; p.on = false; } else kept.push({ l, r, t, b, p });
    }
    this.pills.forEach((p) => {
      if (p.on) p.el.style.transform = 'translate3d(' + (p.x - p.w / 2).toFixed(1) + 'px,' + (p.y - 14 - p.h).toFixed(1) + 'px,0)';
      if (p.on !== p.shown) { p.shown = p.on; p.el.classList.toggle('is-on', p.on); p.el.tabIndex = p.on ? 0 : -1; }
      const n = p.on ? p.moreNext : 0;
      if (n !== p.moreN) {
        const was = p.moreN ? String(p.moreN).length + 1.6 : 0, now = n ? String(n).length + 1.6 : 0;
        p.w += (now - was) * this.charW;
        p.moreN = n; p.more.textContent = n ? '+' + n : '';
      }
      const hov = p.id === sc.hoverId;
      if (hov !== p.hov) { p.hov = hov; p.el.classList.toggle('is-hover', hov); }
    });

    this._updateCard(dt);
  }

  _updateCard(dt) {
    const sc = this.scene;
    const rec = this.mode === 'asset' ? sc.assets.get(this.assetId) : null;
    if (!rec) { this.svg.classList.remove('is-on'); return; }
    const obj = rec.object;
    this._v.copy(rec.ud.hudAnchor).applyMatrix4(obj.matrixWorld);
    const ok = this.project(this._v, this._c);
    const ax = this._c.x, ay = this._c.y;
    // card width follows the viewport (compact on small screens); re-measure when it changes
    const want = hudCardWidth(this.w);
    if (want !== this.cardW) {
      this.cardW = want;
      this.card.style.width = want + 'px';
      this.root.classList.toggle('is-compact', want < 360);
      this.cardSize = null;
    }
    if (!this.cardSize) this.cardSize = { w: this.card.offsetWidth || want, h: this.card.offsetHeight || 300 };
    const cw = this.cardSize.w, ch = this.cardSize.h;
    const m = 14, top = 58, gap = 30;

    // projected bounds of the focused unit: the reticle, and the area the card keeps clear of
    const b = rec.box;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, all = true;
    for (let i = 0; i < 8; i++) {
      this._v.set(i & 1 ? b.max.x : b.min.x, i & 2 ? b.max.y : b.min.y, i & 4 ? b.max.z : b.min.z).applyMatrix4(obj.matrixWorld);
      if (!this.project(this._v, this._c)) { all = false; break; }
      x0 = Math.min(x0, this._c.x); y0 = Math.min(y0, this._c.y); x1 = Math.max(x1, this._c.x); y1 = Math.max(y1, this._c.y);
    }
    if (!all) { x0 = 0; y0 = 0; x1 = this.w; y1 = this.h; }

    // The card sits beside the unit, on whichever side has more free room: right, left,
    // above or below. Room < 0 means the card cannot clear the unit on that side. The side
    // only changes when another one is clearly better, so the card does not flip-flop.
    const room = [
      this.w - m - (x1 + gap + cw),          // 0 right
      x0 - gap - cw - m,                     // 1 left
      y0 - gap - ch - top,                   // 2 above
      this.h - m - (y1 + gap + ch)           // 3 below
    ];
    let side = this.cardSide;
    if (!(side >= 0 && side <= 3)) side = -1;
    for (let i = 0; i < 4; i++) {
      if (side < 0) { side = i; continue; }
      const cur = room[side], cand = room[i];
      if (cand > cur + 60 && (cur < 0 || this.cardPos == null)) side = i;
    }
    this.cardSide = side;
    // Beside the unit the card lines up with the bottom of its bounds: from the 3/4 view the
    // ground in front of the unit is down there, and the neighboring units are further up.
    let gx, gy;
    if (side === 0) { gx = x1 + gap; gy = y1 - ch; }
    else if (side === 1) { gx = x0 - gap - cw; gy = y1 - ch; }
    else if (side === 2) { gx = (x0 + x1) / 2 - cw / 2; gy = y0 - gap - ch; }
    else { gx = (x0 + x1) / 2 - cw / 2; gy = y1 + gap; }
    gx = Math.min(this.w - m - cw, Math.max(m, gx));
    gy = Math.min(this.h - m - ch, Math.max(top, gy));
    if (!this.cardPos) this.cardPos = { x: gx, y: gy };
    const k = 1 - Math.exp(-dt / 0.09);
    this.cardPos.x += (gx - this.cardPos.x) * k;
    this.cardPos.y += (gy - this.cardPos.y) * k;
    const cx = this.cardPos.x, cy = this.cardPos.y;
    this.card.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)';
    this.cardIn.style.transformOrigin = side === 0 ? '0% 50%' : side === 1 ? '100% 50%' : side === 2 ? '50% 100%' : '50% 0%';

    // thin leader from the anchor dot on the unit to the nearest point on the card's edge
    const ex = Math.min(cx + cw, Math.max(cx, ax)), ey = Math.min(cy + ch - 10, Math.max(cy + 10, ay));
    const inside = ax >= cx && ax <= cx + cw && ay >= cy && ay <= cy + ch;
    const show = ok && !inside && ax > -40 && ax < this.w + 40 && ay > -40 && ay < this.h + 40;
    this.svg.classList.toggle('is-on', show);
    if (show) {
      this.leader.setAttribute('x1', ax.toFixed(1)); this.leader.setAttribute('y1', ay.toFixed(1));
      this.leader.setAttribute('x2', ex.toFixed(1)); this.leader.setAttribute('y2', ey.toFixed(1));
      this.dot.setAttribute('cx', ax.toFixed(1)); this.dot.setAttribute('cy', ay.toFixed(1));
    }

    // reticle brackets around the unit
    if (all && x1 - x0 < this.w * 1.2 && y1 - y0 < this.h * 1.2) {
      x0 -= 12; y0 -= 12; x1 += 12; y1 += 12;
      const L = Math.max(10, Math.min(26, (x1 - x0) * 0.08));
      const f = (n) => n.toFixed(1);
      this.reticle.setAttribute('d',
        'M' + f(x0) + ' ' + f(y0 + L) + 'V' + f(y0) + 'H' + f(x0 + L) +
        'M' + f(x1 - L) + ' ' + f(y0) + 'H' + f(x1) + 'V' + f(y0 + L) +
        'M' + f(x1) + ' ' + f(y1 - L) + 'V' + f(y1) + 'H' + f(x1 - L) +
        'M' + f(x0 + L) + ' ' + f(y1) + 'H' + f(x0) + 'V' + f(y1 - L));
      this.reticle.style.visibility = 'visible';
    } else this.reticle.style.visibility = 'hidden';
  }
}
