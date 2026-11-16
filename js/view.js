/* view.js
 * Pure view-model helpers. No DOM, no Leaflet, no Sim access.
 * render.js calls these to turn simulation state into strings and numbers.
 */
(function (global) {
  "use strict";

  var MONITOR_ONLY = "Monitor only. Not permitted to change.";

  /** Site status -> CSS class string for a map pin. */
  function pinClass(siteStatus) {
    if (siteStatus === "running" || siteStatus === "fault") {
      return "pin " + siteStatus;
    }
    return "pin standby";
  }

  /** Fleet totals + schema version -> header KPI strings. */
  function formatKpis(fleet, schemaVersion) {
    return {
      mw: fleet.mw.toFixed(1),
      running: fleet.running + " / " + fleet.total,
      alarms: String(fleet.alarms),
      version: String(schemaVersion)
    };
  }

  /** value within [min, max] -> arc fraction clamped to [0, 1]. */
  function gaugeArc(value, min, max) {
    if (!Number.isFinite(value) || max <= min) {
      return 0;
    }
    var frac = (value - min) / (max - min);
    if (frac < 0) return 0;
    if (frac > 1) return 1;
    return frac;
  }

  /** history[] -> SVG polyline points string for a width x height box. */
  function sparklinePoints(history, width, height) {
    if (history.length === 0) {
      return "";
    }

    var lo = Math.min.apply(null, history);
    var hi = Math.max.apply(null, history);
    var points = [];

    for (var i = 0; i < history.length; i++) {
      var x = (i / (history.length - 1)) * width;
      var y;
      if (hi === lo) {
        y = height / 2;
      } else {
        y = height - ((history[i] - lo) / (hi - lo)) * height;
      }
      points.push(Math.round(x * 100) / 100 + "," + Math.round(y * 100) / 100);
    }

    return points.join(" ");
  }

  /** schema -> one row per canonical tag for the Schema view. */
  function schemaRows(schema) {
    return schema.tags.map(function (tag) {
      var row = {
        tag: tag.tag,
        label: tag.label,
        unit: tag.unit,
        decimals: tag.decimals,
        ranges: {},
        oem: {}
      };

      // Build ranges for each model
      Object.keys(tag.ranges).forEach(function (model) {
        var rangeData = tag.ranges[model];
        row.ranges[model] = {
          nominal: rangeData.nominal,
          min: rangeData.min,
          max: rangeData.max,
          alarm_lo: rangeData.alarm_lo,
          alarm_hi: rangeData.alarm_hi,
          provenance: rangeData.provenance || "unknown"
        };
      });

      // Build OEM entries
      Object.keys(tag.oem_source).forEach(function (oemName) {
        var oemData = tag.oem_source[oemName];
        row.oem[oemName] = {
          name: oemData.name,
          register: oemData.register || null,
          scaling: oemData.scaling || null,
          provenance: oemData.provenance || "unknown"
        };
      });

      return row;
    });
  }

  /** Control action -> guard result. Never calls anything on sim. */
  function controlGuard(action, sim) {
    return {
      allowed: false,
      action: action,
      message: MONITOR_ONLY
    };
  }

  /* ---------- selection, status glyphs, panel formatting ---------- */

  var GLYPHS = {
    running: { shape: "circle", label: "Running" },
    standby: { shape: "ring", label: "Standby" },
    fault: { shape: "triangle", label: "Alarm" },
    service: { shape: "square", label: "Service" }
  };

  /** Status -> { status, shape, label }. Unknown statuses read as standby. */
  function statusGlyph(status) {
    var key = GLYPHS[status] ? status : "standby";
    return { status: key, shape: GLYPHS[key].shape, label: GLYPHS[key].label };
  }

  /** Status -> inline SVG string. Color comes from CSS (.glyph.<status>); shape and word carry meaning too. */
  function statusGlyphSvg(status, size) {
    var g = statusGlyph(status);
    var shape;
    if (g.shape === "circle") shape = '<circle cx="6" cy="6" r="5"></circle>';
    else if (g.shape === "ring") shape = '<circle cx="6" cy="6" r="4" class="ring"></circle>';
    else if (g.shape === "triangle") shape = '<polygon points="6,0.8 11.4,10.8 0.6,10.8"></polygon>';
    else shape = '<rect x="1.5" y="1.5" width="9" height="9"></rect>';
    var px = size || 12;
    return '<svg class="glyph ' + g.status + '" viewBox="0 0 12 12" width="' + px + '" height="' + px + '" role="img" aria-label="' + g.label + '">' + shape + '</svg>';
  }

  /** Integer with thousands separators: 11482 -> "11,482". */
  function formatHours(n) {
    if (n == null || !isFinite(n)) return "--";
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  /** Hours until a service is due -> "in 518 h" / "in 12 d" (batteries) / "overdue by 40 h". */
  function formatDue(dueInH, kind) {
    if (dueInH == null || !isFinite(dueInH)) return "--";
    var neg = dueInH < 0;
    var v = Math.abs(dueInH);
    var txt = (kind === "bess" ? Math.round(v / 24) + " d" : formatHours(v) + " h");
    return neg ? "overdue by " + txt : "in " + txt;
  }

  /** Ride-through minutes -> "1 h 47 min" / "25 min" / "--". */
  function formatRideThrough(min) {
    if (min == null || !isFinite(min)) return "--";
    var m = Math.round(min);
    if (m < 60) return m + " min";
    var h = Math.floor(m / 60);
    return h + " h " + (m % 60) + " min";
  }

  /** Compact row value for the asset list: output for gensets, SOC for batteries. */
  function assetRowValue(asset) {
    if (!asset) return "--";
    if (asset.status === "standby") return "standby";
    if (asset.status === "service") return "in service";
    if (asset.kind === "bess") return asset.tags.soc.value.toFixed(0) + "% SOC";
    return asset.tags.real_power.value.toFixed(2) + " MW";
  }

  var SITE_TABS = ["Summary", "Assets", "Service", "Events"];
  var ASSET_TABS = ["Overview", "Live data", "Service", "Events"];

  /** Panel mode -> ordered tab names. */
  function panelTabs(hasAsset) { return (hasAsset ? ASSET_TABS : SITE_TABS).slice(); }

  /** Keep an active tab valid when the panel switches between facility and asset mode. */
  function resolveTab(hasAsset, tab) {
    var tabs = panelTabs(hasAsset);
    return tabs.indexOf(tab) >= 0 ? tab : tabs[0];
  }

  /** Selection store. siteOf(assetId) -> siteId or null. No DOM. */
  function createSelectionStore(siteOf) {
    var selection = { siteId: null, assetId: null };
    var listeners = [];
    function emit() { listeners.forEach(function (fn) { fn(selection); }); }
    return {
      selection: selection,
      selectSite: function (siteId) {
        var id = siteId || null;
        if (selection.siteId === id && selection.assetId === null) return;
        selection.siteId = id;
        selection.assetId = null;
        emit();
      },
      selectAsset: function (assetId) {
        if (assetId == null) {
          if (selection.assetId === null) return;
          selection.assetId = null;
          emit();
          return;
        }
        var site = siteOf(assetId);
        if (!site) return;
        if (selection.assetId === assetId && selection.siteId === site) return;
        selection.siteId = site;
        selection.assetId = assetId;
        emit();
      },
      onSelection: function (fn) { listeners.push(fn); }
    };
  }

  global.View = {
    MONITOR_ONLY: MONITOR_ONLY,
    pinClass: pinClass,
    formatKpis: formatKpis,
    gaugeArc: gaugeArc,
    sparklinePoints: sparklinePoints,
    schemaRows: schemaRows,
    controlGuard: controlGuard,
    statusGlyph: statusGlyph,
    statusGlyphSvg: statusGlyphSvg,
    formatHours: formatHours,
    formatDue: formatDue,
    formatRideThrough: formatRideThrough,
    assetRowValue: assetRowValue,
    panelTabs: panelTabs,
    resolveTab: resolveTab,
    createSelectionStore: createSelectionStore
  };
})(window);
