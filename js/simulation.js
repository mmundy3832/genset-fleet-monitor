/* simulation.js
 * Telemetry generation, wobble, fault logic, and data-quality validation.
 * Everything here reads tag definitions and ranges from data/schema.json.
 * No DOM access. render.js consumes the state this module exposes.
 */
(function (global) {
  "use strict";

  var HISTORY = 60;          // samples kept per tag for sparklines (1 sample/s)
  var WOBBLE_MAX = 0.002;    // +/- 0.2% of nominal: reads as a healthy machine
  var WOBBLE_STEP = 0.0008;  // random-walk step per tick
  var FAULT_RAMP_S = 6;      // seconds to drive a faulted tag past its alarm limit

  var schema = null;
  var sites = null;
  var gensets = {};          // id -> runtime state
  var events = [];           // validation event log, newest first
  var listeners = [];
  var activeFault = null;    // { gensetId, scenario }
  var tick = 0;

  function now() {
    var d = new Date();
    return d.toISOString().substr(11, 8);
  }

  function emit(ev) {
    ev.t = now();
    ev.tick = tick;
    events.unshift(ev);
    if (events.length > 200) events.pop();
  }

  function rangesFor(gs, tagDef) {
    return tagDef.ranges[gs.model];
  }

  /* Data-quality validation against schema ranges.
   * Returns one of the schema quality codes. */
  function validate(gs, tagDef, value) {
    if (gs.status === "standby") return "NOT_RUNNING";
    var r = rangesFor(gs, tagDef);
    if (!r || tagDef.cumulative) return "GOOD";
    if (r.alarm_hi != null && value > r.alarm_hi) return "ALARM";
    if (r.alarm_lo != null && value < r.alarm_lo) return "ALARM";
    if (r.max != null && value > r.max) return "OUT_OF_RANGE";
    if (r.min != null && value < r.min) return "OUT_OF_RANGE";
    return "GOOD";
  }

  function initGenset(site, g) {
    var unit = sites.units[g.unit];
    var model = unit.model;
    var gs = {
      id: g.id,
      siteId: site.id,
      unit: g.unit,
      model: model,
      oem: sites.models[model].oem,
      oemShort: sites.models[model].oem_short,
      serial: g.serial,
      ratingMw: unit.rating_mw,
      load: g.load,
      status: g.status,            // running | standby | fault
      fault: null,                 // scenario object while faulted
      faultProgress: 0,
      tags: {}                     // tag -> { value, quality, wobble, history[] }
    };
    schema.tags.forEach(function (td) {
      gs.tags[td.tag] = { value: 0, quality: "GOOD", wobble: 0, history: [] };
    });
    // Seed energy totals with a plausible run history.
    gs.tags.energy_total.value = Math.round((800 + Math.random() * 6000) * 10) / 10;
    gensets[g.id] = gs;
    return gs;
  }

  function nominalFor(gs, td) {
    var r = rangesFor(gs, td);
    if (td.tag === "real_power") return gs.ratingMw * gs.load;
    if (td.tag === "fuel_flow") return r.nominal * gs.load;          // fuel tracks load
    if (td.tag === "exhaust_temp") return r.nominal - (1 - gs.load) * 90; // cooler at part load
    if (td.tag === "coolant_temp") return r.nominal - (1 - gs.load) * 6;
    return r.nominal;
  }

  function step(gs) {
    schema.tags.forEach(function (td) {
      var t = gs.tags[td.tag];
      var r = rangesFor(gs, td);
      var v;

      if (td.cumulative) {
        if (gs.status !== "standby") {
          t.value += gs.tags.real_power.value / 3600; // MW * 1s -> MWh
        }
        v = t.value;
      } else if (gs.status === "standby") {
        v = (td.tag === "coolant_temp") ? 38 + Math.sin(tick / 40) * 0.4   // block heater keeps it warm
          : (td.tag === "oil_pressure") ? 0
          : (td.tag === "exhaust_temp") ? 30 + Math.sin(tick / 55) * 0.3
          : 0;
      } else {
        // Bounded random walk around nominal.
        t.wobble += (Math.random() - 0.5) * 2 * WOBBLE_STEP;
        if (t.wobble > WOBBLE_MAX) t.wobble = WOBBLE_MAX;
        if (t.wobble < -WOBBLE_MAX) t.wobble = -WOBBLE_MAX;
        v = nominalFor(gs, td) * (1 + t.wobble);

        // Fault injection: drive the chosen tag past its alarm limit over FAULT_RAMP_S.
        if (gs.fault && gs.fault.tag === td.tag) {
          var p = Math.min(1, gs.faultProgress / FAULT_RAMP_S);
          var limit = gs.fault.direction === "hi" ? r.alarm_hi : r.alarm_lo;
          var overshoot = gs.fault.direction === "hi" ? limit * 1.03 : limit * 0.9;
          v = v + (overshoot - v) * p;
        }
      }

      if (!td.cumulative) t.value = v;
      applyQuality(gs, td, t);

      t.history.push(t.value);
      if (t.history.length > HISTORY) t.history.shift();
    });

    if (gs.fault) {
      gs.faultProgress += 1;
      var ft = gs.tags[gs.fault.tag];
      if (ft.quality === "ALARM" && gs.status !== "fault") {
        gs.status = "fault";
        emit({ kind: "ALARM", gensetId: gs.id, tag: gs.fault.tag,
               msg: gs.id + " " + gs.fault.label + " (asset flagged)" });
      }
    }
  }

  function fmt(v, td) {
    if (v == null || isNaN(v)) return "--";
    return v.toFixed(td.decimals);
  }

  /* Apply quality-transition logic: validate, emit on change, update quality.
   * Used by both step() and setValue(). */
  function applyQuality(gs, td, t) {
    var q = validate(gs, td, t.value);
    if (q !== t.quality) {
      if (q === "ALARM" || q === "OUT_OF_RANGE") {
        emit({ kind: q, gensetId: gs.id, tag: td.tag,
               msg: gs.id + " " + td.tag + " " + fmt(t.value, td) + " " + td.unit + " -> " + q });
      } else if ((t.quality === "ALARM" || t.quality === "OUT_OF_RANGE") && q === "GOOD") {
        emit({ kind: "CLEARED", gensetId: gs.id, tag: td.tag,
               msg: gs.id + " " + td.tag + " back in range" });
      }
      t.quality = q;
    }
  }

  /* ---------- public API ---------- */

  var Sim = {
    init: function (schemaJson, sitesJson) {
      schema = schemaJson;
      sites = sitesJson;
      gensets = {};
      events = [];
      sites.sites.forEach(function (s) {
        s.gensets.forEach(function (g) { initGenset(s, g); });
      });
      // Warm the history buffers so sparklines are full on first paint.
      for (var i = 0; i < HISTORY; i++) Sim.tick(true);
      events = [];
      emit({ kind: "INFO", gensetId: "", tag: "", msg: "schema " + schema.version + " loaded, " + Object.keys(gensets).length + " assets" });
      return Sim;
    },

    tick: function (silent) {
      tick += 1;
      Object.keys(gensets).forEach(function (id) { step(gensets[id]); });
      if (!silent) listeners.forEach(function (fn) { fn(); });
    },

    onTick: function (fn) { listeners.push(fn); },

    schema: function () { return schema; },
    sites: function () { return sites; },
    gensets: function () { return gensets; },
    genset: function (id) { return gensets[id]; },
    events: function () { return events; },
    format: fmt,

    siteGensets: function (siteId) {
      return Object.keys(gensets).map(function (k) { return gensets[k]; })
        .filter(function (g) { return g.siteId === siteId; });
    },

    /* Site status rolls up from its assets: any fault -> fault, all standby -> standby, else running. */
    siteStatus: function (siteId) {
      var list = Sim.siteGensets(siteId);
      if (list.some(function (g) { return g.status === "fault"; })) return "fault";
      if (list.every(function (g) { return g.status === "standby"; })) return "standby";
      return "running";
    },

    fleet: function () {
      var mw = 0, running = 0, alarms = 0, total = 0;
      Object.keys(gensets).forEach(function (k) {
        var g = gensets[k];
        total += 1;
        if (g.status !== "standby") { mw += g.tags.real_power.value; running += 1; }
        if (g.status === "fault") alarms += 1;
      });
      return { mw: mw, running: running, alarms: alarms, total: total };
    },

    activeFault: function () { return activeFault; },

    /* Tuning constants exposed read-only: { HISTORY, WOBBLE_MAX, WOBBLE_STEP, FAULT_RAMP_S }. */
    constants: function () {
      return { HISTORY, WOBBLE_MAX, WOBBLE_STEP, FAULT_RAMP_S };
    },

    /* Classify a value for one asset's tag against its model ranges (quality code). */
    validate: function (gensetId, tag, value) {
      var gs = gensets[gensetId];
      if (!gs) throw new Error("Unknown genset: " + gensetId);
      var td = schema.tags.find(function (t) { return t.tag === tag; });
      if (!td) throw new Error("Unknown tag: " + tag);
      return validate(gs, td, value);
    },

    /* Test accessor: set one tag's value on an asset and run validation + event emission for it. */
    setValue: function (gensetId, tag, value) {
      var gs = gensets[gensetId];
      if (!gs) throw new Error("Unknown genset: " + gensetId);
      var td = schema.tags.find(function (t) { return t.tag === tag; });
      if (!td) throw new Error("Unknown tag: " + tag);
      var t = gs.tags[tag];
      t.value = value;
      applyQuality(gs, td, t);
    },

    /* Pick a random running asset and push one tag out of spec. */
    simulateFault: function () {
      if (activeFault) Sim.clearFault();
      var candidates = Object.keys(gensets).filter(function (k) { return gensets[k].status === "running"; });
      if (!candidates.length) return null;
      var gs = gensets[candidates[Math.floor(Math.random() * candidates.length)]];
      var scenarios = schema.fault_scenarios;
      var sc = scenarios[Math.floor(Math.random() * scenarios.length)];
      gs.fault = sc;
      gs.faultProgress = 0;
      activeFault = { gensetId: gs.id, scenario: sc };
      emit({ kind: "INFO", gensetId: gs.id, tag: sc.tag, msg: "fault injected on " + gs.id + ": " + sc.label });
      return activeFault;
    },

    clearFault: function () {
      if (!activeFault) return;
      var gs = gensets[activeFault.gensetId];
      gs.fault = null;
      gs.faultProgress = 0;
      gs.status = "running";
      schema.tags.forEach(function (td) { gs.tags[td.tag].wobble = 0; });
      emit({ kind: "CLEARED", gensetId: gs.id, tag: "", msg: gs.id + " fault cleared, returned to nominal" });
      activeFault = null;
    }
  };

  global.Sim = Sim;
})(window);
