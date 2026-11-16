/* simulation.js
 * Telemetry generation, wobble, fault logic, and data-quality validation.
 * Everything here reads tag definitions and ranges from data/schema.json
 * (genset tags in schema.tags, battery tags in schema.bess_tags) and asset
 * identity from data/sites.json. Service history comes from data/service.json.
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
  var service = null;        // { asOf, schedule, records }
  var gensets = {};          // id -> runtime state (gensets only)
  var bessUnits = {};        // id -> runtime state (batteries only)
  var assetList = [];        // gensets then batteries, in data order
  var events = [];           // validation event log, newest first
  var listeners = [];
  var activeFault = null;    // { gensetId, assetId, scenario }
  var DAY_MS = 86400000;
  var BESS_SOC_MIN = 72;     // slow SOC drift stays inside this band (%)
  var BESS_SOC_MAX = 93;
  var BESS_DRIFT_MAX = 0.002; // %/s
  var tick = 0;

  function now() {
    var d = new Date();
    return d.toISOString().substr(11, 8);
  }

  function emit(ev) {
    ev.t = now();
    ev.tick = tick;
    if (ev.assetId == null) ev.assetId = ev.gensetId;
    events.unshift(ev);
    if (events.length > 200) events.pop();
  }

  function rangesFor(gs, tagDef) {
    return tagDef.ranges ? tagDef.ranges[gs.model] : null;
  }

  function defsFor(a) {
    return a.kind === "bess" ? (schema.bess_tags || []) : schema.tags;
  }

  function isIdle(a) {
    return a.status === "standby" || a.status === "service";
  }

  function findDef(a, tag) {
    return defsFor(a).find(function (t) { return t.tag === tag; });
  }

  function parseDay(str) {
    return new Date(str + "T00:00:00Z").getTime();
  }

  function assetById(id) {
    return gensets[id] || bessUnits[id];
  }

  /* Data-quality validation against schema ranges.
   * Returns one of the schema quality codes. */
  function validate(gs, tagDef, value) {
    if (isIdle(gs)) return "NOT_RUNNING";
    var r = rangesFor(gs, tagDef);
    if (!r || tagDef.cumulative || tagDef.enum) return "GOOD";
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
      kind: "genset",
      siteId: site.id,
      unit: g.unit,
      model: model,
      oem: sites.models[model].oem,
      oemShort: sites.models[model].oem_short,
      serial: g.serial,
      assetNo: g.assetNo || null,
      commissioned: g.commissioned || null,
      runHours: g.runHours || 0,
      starts: g.starts || 0,
      nextService: null,
      ratingMw: unit.rating_mw,
      load: g.load,
      status: g.status,            // running | standby | fault | service
      prevStatus: null,
      fault: null,                 // scenario object while faulted
      faultProgress: 0,
      tags: {}                     // tag -> { value, quality, wobble, history[] }
    };
    Object.defineProperty(gs, "defs", { value: schema.tags, enumerable: false });
    schema.tags.forEach(function (td) {
      gs.tags[td.tag] = { value: 0, quality: "GOOD", wobble: 0, history: [] };
    });
    // Seed energy totals with a plausible run history.
    gs.tags.energy_total.value = gs.runHours > 0
      ? Math.round(gs.runHours * gs.ratingMw * (g.status === "running" ? g.load : 0.6) * 10) / 10
      : Math.round((800 + Math.random() * 6000) * 10) / 10;
    gensets[g.id] = gs;
    assetList.push(gs);
    return gs;
  }

  function initBess(site, b) {
    var unit = (sites.bess_units || {})[b.unit] || { model: b.unit, oem_short: "PWR", rating_mw: 2.5, rating_mwh: 5 };
    var a = {
      id: b.id,
      kind: "bess",
      siteId: site.id,
      unit: b.unit,
      model: unit.model,
      oem: unit.oem_short,
      oemShort: unit.oem_short,
      serial: b.serial,
      assetNo: b.assetNo || null,
      commissioned: b.commissioned || null,
      runHours: b.runHours || 0,
      starts: b.starts || 0,       // equivalent full cycles for a battery
      nextService: null,
      ratingMw: unit.rating_mw,
      ratingMwh: unit.rating_mwh,
      load: 0,
      status: b.status || "running",
      prevStatus: null,
      fault: null,
      faultProgress: 0,
      drift: (Math.random() - 0.5) * BESS_DRIFT_MAX,
      soh: 97 + Math.random() * 2.5,
      tags: {}
    };
    Object.defineProperty(a, "defs", { value: schema.bess_tags || [], enumerable: false });
    a.defs.forEach(function (td) {
      a.tags[td.tag] = { value: td.enum ? "idle" : 0, quality: "GOOD", wobble: 0, history: [] };
    });
    a.tags.soc.value = 78 + Math.random() * 12;
    bessUnits[b.id] = a;
    assetList.push(a);
    return a;
  }

  /* ---------- service schedule ---------- */

  /* Next due point for an hours-based task: the smallest offset + k*interval (k >= 0, > 0 h)
   * that is strictly greater than runHours. Pure. */
  function nextDuePoint(runHours, intervalH, offsetH) {
    if (offsetH > 0 && runHours < offsetH) return offsetH;
    var base = offsetH > 0 ? offsetH : 0;
    return base + (Math.floor((runHours - base) / intervalH) + 1) * intervalH;
  }

  /* All upcoming tasks for an asset, soonest first: [{ id, task, dueAtH, dueInH }]. */
  function dueList(a) {
    var list = [];
    if (!service || !service.schedule) return list;
    if (a.kind === "bess") {
      var q = (service.schedule.bess || [])[0];
      if (!q) return list;
      var recs = (service.records && service.records[a.id]) || [];
      var last = null;
      recs.forEach(function (r) { if (r.type === "scheduled" && (last === null || r.date > last)) last = r.date; });
      var from = parseDay(last || a.commissioned || service.asOf);
      var dueMs = from + q.intervalDays * DAY_MS;
      var inH = (dueMs - parseDay(service.asOf)) / 3600000;
      list.push({ id: q.id, task: q.task, dueAtH: a.runHours + inH, dueInH: inH });
      return list;
    }
    (service.schedule.genset || []).forEach(function (t) {
      if (t.scrOnly && a.unit !== "PWR2.6-S") return;
      var at = nextDuePoint(a.runHours, t.intervalH, t.offsetH);
      list.push({ id: t.id, task: t.task, dueAtH: at, dueInH: at - a.runHours });
    });
    // stable sort: ties keep schedule order
    return list.map(function (d, i) { return { d: d, i: i }; })
      .sort(function (x, y) { return (x.d.dueInH - y.d.dueInH) || (x.i - y.i); })
      .map(function (x) { return x.d; });
  }

  function refreshNext(a) {
    var l = dueList(a);
    a.nextService = l.length ? { task: l[0].task, dueInH: l[0].dueInH, dueAtH: l[0].dueAtH } : null;
  }

  function nominalFor(gs, td) {
    var r = rangesFor(gs, td);
    if (td.tag === "real_power") return gs.ratingMw * gs.load;
    if (td.tag === "fuel_flow") return r.nominal * gs.load;          // fuel tracks load
    if (td.tag === "exhaust_temp") return r.nominal - (1 - gs.load) * 90; // cooler at part load
    if (td.tag === "enclosure_temp") return 28 + 16 * gs.load;             // hot while running
    if (td.tag === "coolant_temp") return r.nominal - (1 - gs.load) * 6;
    return r.nominal;
  }

  function applyFault(gs, td, r, v) {
    if (gs.fault && gs.fault.tag === td.tag) {
      var p = Math.min(1, gs.faultProgress / FAULT_RAMP_S);
      var limit = gs.fault.direction === "hi" ? r.alarm_hi : r.alarm_lo;
      var overshoot = gs.fault.direction === "hi" ? limit * 1.03 : limit * 0.9;
      v = v + (overshoot - v) * p;
    }
    return v;
  }

  function checkFaultState(gs) {
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

  function pushHistory(t, v) {
    t.history.push(v);
    if (t.history.length > HISTORY) t.history.shift();
  }

  function stepBess(b) {
    var T = b.tags;
    var mwh = b.ratingMwh;
    // SOC drifts slowly and reflects at the band edges. Power follows the drift.
    b.drift += (Math.random() - 0.5) * 0.0002;
    if (b.drift > BESS_DRIFT_MAX) b.drift = BESS_DRIFT_MAX;
    if (b.drift < -BESS_DRIFT_MAX) b.drift = -BESS_DRIFT_MAX;
    var soc = T.soc.value + b.drift;
    if (soc > BESS_SOC_MAX) { soc = BESS_SOC_MAX; b.drift = -Math.abs(b.drift); }
    if (soc < BESS_SOC_MIN) { soc = BESS_SOC_MIN; b.drift = Math.abs(b.drift); }
    var power = -(b.drift / 100) * mwh * 3600;      // MW, + discharge
    b.load = Math.abs(power) / b.ratingMw;
    var wave = Math.sin(tick / 120);
    var tmax = 26.5 + 0.6 * wave + Math.abs(power) * 1.2 + (Math.random() - 0.5) * 0.1;
    var vals = {
      soc: soc,
      soh: b.soh,
      bess_power: power,
      cell_temp_max: tmax,
      cell_temp_min: tmax - 2.6 - 0.2 * Math.abs(wave),
      rack_voltage: 1100 + 1.8 * soc + (Math.random() - 0.5) * 2,
      bess_humidity: 40 + 2 * Math.sin(tick / 200),
      h2: Math.max(0, 0.5 + (Math.random() - 0.5) * 0.6),
      co: Math.max(0, 1.5 + (Math.random() - 0.5) * 1.6)
    };
    defsFor(b).forEach(function (td) {
      var t = T[td.tag];
      if (td.enum) {
        var s = b.status === "fault" && b.fault && b.fault.tag !== "h2" ? "fault" : (tmax > 27.2 ? "cooling" : "idle");
        t.value = s;
        t.quality = "GOOD";
        pushHistory(t, td.enum.indexOf(s));
        return;
      }
      var r = rangesFor(b, td);
      t.value = applyFault(b, td, r, vals[td.tag]);
      applyQuality(b, td, t);
      pushHistory(t, t.value);
    });
    if (b.status !== "service") b.runHours += 1 / 3600;
    checkFaultState(b);
    refreshNext(b);
  }

  function step(gs) {
    if (gs.kind === "bess") return stepBess(gs);
    schema.tags.forEach(function (td) {
      var t = gs.tags[td.tag];
      var r = rangesFor(gs, td);
      var v;

      if (td.cumulative) {
        if (!isIdle(gs)) {
          t.value += gs.tags.real_power.value / 3600; // MW * 1s -> MWh
        }
        v = t.value;
      } else if (isIdle(gs)) {
        v = (td.tag === "coolant_temp") ? 38 + Math.sin(tick / 40) * 0.4   // block heater keeps it warm
          : (td.tag === "oil_pressure") ? 0
          : (td.tag === "exhaust_temp") ? 30 + Math.sin(tick / 55) * 0.3
          : (td.tag === "enclosure_temp") ? 22 + Math.sin(tick / 90) * 0.8     // near ambient
          : (td.tag === "enclosure_humidity") ? 55 + Math.sin(tick / 110) * 3
          : 0;
      } else {
        // Bounded random walk around nominal.
        t.wobble += (Math.random() - 0.5) * 2 * WOBBLE_STEP;
        if (t.wobble > WOBBLE_MAX) t.wobble = WOBBLE_MAX;
        if (t.wobble < -WOBBLE_MAX) t.wobble = -WOBBLE_MAX;
        v = nominalFor(gs, td) * (1 + t.wobble);

        // Fault injection: drive the chosen tag past its alarm limit over FAULT_RAMP_S.
        v = applyFault(gs, td, r, v);
      }

      if (!td.cumulative) t.value = v;
      applyQuality(gs, td, t);

      pushHistory(t, t.value);
    });

    if (gs.status === "running" || gs.status === "fault") gs.runHours += 1 / 3600;
    checkFaultState(gs);
    refreshNext(gs);
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
    init: function (schemaJson, sitesJson, serviceJson) {
      schema = schemaJson;
      sites = sitesJson;
      service = serviceJson || null;
      gensets = {};
      bessUnits = {};
      assetList = [];
      events = [];
      activeFault = null;
      sites.sites.forEach(function (s) {
        s.gensets.forEach(function (g) { initGenset(s, g); });
        (s.bess || []).forEach(function (b) { initBess(s, b); });
      });
      // Warm the history buffers so sparklines are full on first paint.
      for (var i = 0; i < HISTORY; i++) Sim.tick(true);
      // Warm-up must not age the fleet: restore hours from data.
      sites.sites.forEach(function (s) {
        s.gensets.concat(s.bess || []).forEach(function (d) {
          var a = assetById(d.id);
          a.runHours = d.runHours || 0;
          refreshNext(a);
        });
      });
      events = [];
      emit({ kind: "INFO", gensetId: "", tag: "", msg: "schema " + schema.version + " loaded, " + assetList.length + " assets" });
      return Sim;
    },

    tick: function (silent) {
      tick += 1;
      assetList.forEach(step);
      if (!silent) listeners.forEach(function (fn) { fn(); });
    },

    onTick: function (fn) { listeners.push(fn); },

    schema: function () { return schema; },
    sites: function () { return sites; },
    gensets: function () { return gensets; },
    genset: function (id) { return gensets[id]; },

    /* Runtime assets (gensets then batteries) for a site, or every asset when siteId is omitted. */
    assets: function (siteId) {
      return assetList.filter(function (a) { return siteId == null || a.siteId === siteId; });
    },
    asset: function (id) { return assetById(id); },
    service: function () { return service; },

    /* Service history for one asset, newest first: [{ date, wo, type, hours, desc, tech }]. */
    serviceRecords: function (assetId) {
      return (service && service.records && service.records[assetId]) || [];
    },

    /* Work orders across a site's assets, newest first, each tagged with assetId. */
    siteServiceRecords: function (siteId, limit) {
      var all = [];
      Sim.assets(siteId).forEach(function (a) {
        Sim.serviceRecords(a.id).forEach(function (r) {
          all.push({ assetId: a.id, date: r.date, wo: r.wo, type: r.type, hours: r.hours, desc: r.desc, tech: r.tech });
        });
      });
      all.sort(function (x, y) { return x.date < y.date ? 1 : x.date > y.date ? -1 : (x.wo < y.wo ? 1 : -1); });
      return limit ? all.slice(0, limit) : all;
    },

    /* Upcoming tasks for an asset, soonest first: [{ id, task, dueAtH, dueInH }]. */
    dueList: function (assetId) {
      var a = assetById(assetId);
      return a ? dueList(a) : [];
    },
    nextDuePoint: nextDuePoint,

    /* Site rollup used by the facility panel. Output counts gensets only. */
    siteSummary: function (siteId) {
      var site = sites.sites.find(function (s) { return s.id === siteId; });
      if (!site) return null;
      var list = Sim.assets(siteId);
      var gs = list.filter(function (a) { return a.kind === "genset"; });
      var bs = list.filter(function (a) { return a.kind === "bess"; });
      var out = 0, online = 0, installed = 0, running = 0, standby = 0;
      gs.forEach(function (g) {
        installed += g.ratingMw;
        if (g.status === "running" || g.status === "fault") {
          running += 1; online += g.ratingMw; out += g.tags.real_power.value;
        } else if (g.status === "standby") {
          standby += 1;
        }
      });
      var mwh = 0, socSum = 0, stored = 0;
      bs.forEach(function (b) {
        mwh += b.ratingMwh; socSum += b.tags.soc.value; stored += b.ratingMwh * b.tags.soc.value / 100;
      });
      var asOf = service ? parseDay(service.asOf) : Date.now();
      var cutoff = asOf - 90 * DAY_MS;
      var wo = 0, unsched = 0;
      list.forEach(function (a) {
        Sim.serviceRecords(a.id).forEach(function (r) {
          if (parseDay(r.date) >= cutoff) { wo += 1; if (r.type === "unscheduled") unsched += 1; }
        });
      });
      return {
        customer: site.customer || "",
        type: site.type,
        outputMw: out,
        onlineMw: online,
        installedMw: installed,
        spareMw: installed - out,
        running: running,
        standby: standby,
        alarms: list.filter(function (a) { return a.status === "fault"; }).length,
        inService: list.filter(function (a) { return a.status === "service"; }).length,
        redundancy: site.redundancy || "",
        workOrders90d: wo,
        unscheduled90d: unsched,
        bess: {
          count: bs.length,
          mwh: mwh,
          socPct: bs.length ? socSum / bs.length : null,
          rideThroughMin: bs.length && out > 0 ? stored / out * 60 : null
        }
      };
    },

    /* Take an asset out of (or back into) service. Service status behaves like standby. */
    setServiceMode: function (id, on) {
      var a = assetById(id);
      if (!a) throw new Error("Unknown asset: " + id);
      if (on && a.status !== "service") { a.prevStatus = a.status === "fault" ? "running" : a.status; a.status = "service"; }
      if (!on && a.status === "service") { a.status = a.prevStatus || "standby"; a.prevStatus = null; }
    },
    events: function () { return events; },
    format: fmt,

    siteGensets: function (siteId) {
      return Object.keys(gensets).map(function (k) { return gensets[k]; })
        .filter(function (g) { return g.siteId === siteId; });
    },

    /* Site status rolls up from its assets: any fault -> fault, all standby -> standby, else running. */
    siteStatus: function (siteId) {
      if (Sim.assets(siteId).some(function (a) { return a.status === "fault"; })) return "fault";
      var list = Sim.siteGensets(siteId);
      if (list.every(function (g) { return g.status === "standby" || g.status === "service"; })) return "standby";
      return "running";
    },

    fleet: function () {
      var mw = 0, running = 0, alarms = 0, total = 0;
      Object.keys(gensets).forEach(function (k) {
        var g = gensets[k];
        total += 1;
        if (g.status === "running" || g.status === "fault") { mw += g.tags.real_power.value; running += 1; }
      });
      Object.keys(bessUnits).forEach(function (k) { if (bessUnits[k].status === "fault") alarms += 1; });
      Object.keys(gensets).forEach(function (k) { if (gensets[k].status === "fault") alarms += 1; });
      return { mw: mw, running: running, alarms: alarms, total: total };
    },

    activeFault: function () { return activeFault; },

    /* Tuning constants exposed read-only: { HISTORY, WOBBLE_MAX, WOBBLE_STEP, FAULT_RAMP_S }. */
    constants: function () {
      return { HISTORY, WOBBLE_MAX, WOBBLE_STEP, FAULT_RAMP_S };
    },

    /* Classify a value for one asset's tag against its model ranges (quality code). */
    validate: function (gensetId, tag, value) {
      var gs = assetById(gensetId);
      if (!gs) throw new Error("Unknown genset: " + gensetId);
      var td = findDef(gs, tag);
      if (!td) throw new Error("Unknown tag: " + tag);
      return validate(gs, td, value);
    },

    /* Test accessor: set one tag's value on an asset and run validation + event emission for it. */
    setValue: function (gensetId, tag, value) {
      var gs = assetById(gensetId);
      if (!gs) throw new Error("Unknown genset: " + gensetId);
      var td = findDef(gs, tag);
      if (!td) throw new Error("Unknown tag: " + tag);
      var t = gs.tags[tag];
      t.value = value;
      applyQuality(gs, td, t);
    },

    /* Pick a scenario, then a random running asset of the matching kind, and push one tag out of spec. */
    simulateFault: function () {
      if (activeFault) Sim.clearFault();
      var scenarios = schema.fault_scenarios;
      var sc = scenarios[Math.floor(Math.random() * scenarios.length)];
      var kind = sc.target === "bess" ? "bess" : "genset";
      var candidates = assetList.filter(function (a) { return a.kind === kind && a.status === "running"; });
      if (!candidates.length) return null;
      var gs = candidates[Math.floor(Math.random() * candidates.length)];
      gs.fault = sc;
      gs.faultProgress = 0;
      activeFault = { gensetId: gs.id, assetId: gs.id, scenario: sc };
      emit({ kind: "INFO", gensetId: gs.id, tag: sc.tag, msg: "fault injected on " + gs.id + ": " + sc.label });
      return activeFault;
    },

    clearFault: function () {
      if (!activeFault) return;
      var gs = assetById(activeFault.gensetId);
      gs.fault = null;
      gs.faultProgress = 0;
      gs.status = "running";
      defsFor(gs).forEach(function (td) { gs.tags[td.tag].wobble = 0; });
      emit({ kind: "CLEARED", gensetId: gs.id, tag: "", msg: gs.id + " fault cleared, returned to nominal" });
      activeFault = null;
    }
  };

  global.Sim = Sim;
})(window);
