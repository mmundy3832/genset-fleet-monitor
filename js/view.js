/* view.js
 * Pure view-model helpers. No DOM, no Leaflet, no Sim access.
 * render.js calls these to turn simulation state into strings and numbers.
 */
(function (global) {
  "use strict";

  var MONITOR_ONLY = "Monitor only. Not permitted to change.";

  /** Site status -> CSS class string for a map pin. */
  function pinClass(siteStatus) {
    throw new Error("NotImplemented: pinClass");
  }

  /** Fleet totals + schema version -> header KPI strings. */
  function formatKpis(fleet, schemaVersion) {
    throw new Error("NotImplemented: formatKpis");
  }

  /** value within [min, max] -> arc fraction clamped to [0, 1]. */
  function gaugeArc(value, min, max) {
    throw new Error("NotImplemented: gaugeArc");
  }

  /** history[] -> SVG polyline points string for a width x height box. */
  function sparklinePoints(history, width, height) {
    throw new Error("NotImplemented: sparklinePoints");
  }

  /** schema -> one row per canonical tag for the Schema view. */
  function schemaRows(schema) {
    throw new Error("NotImplemented: schemaRows");
  }

  /** Control action -> guard result. Never calls anything on sim. */
  function controlGuard(action, sim) {
    throw new Error("NotImplemented: controlGuard");
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
