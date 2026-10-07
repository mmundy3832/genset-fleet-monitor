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

  global.View = {
    MONITOR_ONLY: MONITOR_ONLY,
    pinClass: pinClass,
    formatKpis: formatKpis,
    gaugeArc: gaugeArc,
    sparklinePoints: sparklinePoints,
    schemaRows: schemaRows,
    controlGuard: controlGuard
  };
})(window);
