(function () {
  "use strict";

  var map = null;
  var markers = {};
  var lastSiteStatus = {};
  var tileLayers = { dark: null, light: null };
  var FLEET_PAD = [60, 60];
  var THEME_KEY = "gfm-theme";

  /* ---------- App: shared UI state (selection + theme) ---------- */

  var store = View.createSelectionStore(function (assetId) {
    var a = Sim.asset(assetId);
    return a ? a.siteId : null;
  });
  var theme = "dark";
  var themeListeners = [];
  var readyResolve;
  var readyPromise = new Promise(function (res) { readyResolve = res; });

  try {
    var saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") theme = saved;
  } catch (e) { /* storage blocked: stay on the default */ }

  var App = {
    selection: store.selection,
    selectSite: store.selectSite,
    selectAsset: store.selectAsset,
    onSelection: store.onSelection,
    theme: function () { return theme; },
    onTheme: function (fn) { themeListeners.push(fn); },
    setTheme: function (t) { setTheme(t); },
    autoFly: true,          // the 3D scene sets this false to drive the camera and map itself
    ready: readyPromise     // resolves after Sim.init and map creation
  };
  window.App = App;

  /* ---------- FleetMap: 2D map handle for the 3D scene ---------- */

  function siteById(id) {
    return Sim.sites().sites.find(function (s) { return s.id === id; });
  }

  function fitFleet(animate) {
    var pts = Sim.sites().sites.map(function (s) { return [s.lat, s.lon]; });
    map.fitBounds(pts, { padding: FLEET_PAD, animate: !!animate, duration: 0.9, maxZoom: 7 });
  }

  function whenMoveEnds(fn) {
    var done = false;
    function finish() { if (!done) { done = true; map.off("moveend", finish); fn(); } }
    map.on("moveend", finish);
    setTimeout(finish, 4000);
  }

  var FleetMap = {
    map: null,
    flyToSite: function (siteId, zoom, seconds) {
      var site = siteById(siteId);
      if (!map || !site) return Promise.resolve();
      return new Promise(function (resolve) {
        whenMoveEnds(resolve);
        map.flyTo([site.lat, site.lon], zoom || 9, { duration: seconds == null ? 0.9 : seconds });
      });
    },
    reset: function (seconds) {
      if (!map) return Promise.resolve();
      return new Promise(function (resolve) {
        whenMoveEnds(resolve);
        var pts = Sim.sites().sites.map(function (s) { return [s.lat, s.lon]; });
        map.flyToBounds(pts, { padding: FLEET_PAD, maxZoom: 7, duration: seconds == null ? 0.9 : seconds });
      });
    }
  };
  window.FleetMap = FleetMap;

  /* ---------- theme ---------- */

  function setTheme(t) {
    if (t !== "light" && t !== "dark") return;
    var changed = t !== theme;
    theme = t;
    document.documentElement.setAttribute("data-theme", t);
    try { window.localStorage.setItem(THEME_KEY, t); } catch (e) { /* ignore */ }
    var btn = document.getElementById("btn-theme");
    if (btn) btn.textContent = t === "dark" ? "Light theme" : "Dark theme";
    if (map && tileLayers.dark && tileLayers.light) {
      map.removeLayer(tileLayers[t === "dark" ? "light" : "dark"]);
      tileLayers[t].addTo(map);
    }
    if (changed) themeListeners.forEach(function (fn) { fn(t); });
  }
  document.documentElement.setAttribute("data-theme", theme);

  function showToast(msg) {
    var toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(function () {
      toast.classList.remove("show");
    }, 2200);
  }

  function renderKpis() {
    var fleet = Sim.fleet();
    var kpis = View.formatKpis(fleet, Sim.schema().version);
    document.getElementById("kpi-mw").textContent = kpis.mw;
    document.getElementById("kpi-running").textContent = kpis.running;
    document.getElementById("kpi-alarms").textContent = kpis.alarms;
    document.getElementById("kpi-version").textContent = kpis.version;

    var alarmsKpi = document.querySelector(".kpi:nth-child(3)");
    if (fleet.alarms > 0) {
      alarmsKpi.classList.remove("ok");
      alarmsKpi.classList.add("alarm");
    } else {
      alarmsKpi.classList.remove("alarm");
      alarmsKpi.classList.add("ok");
    }
  }

  function updateMarkers() {
    var selectedSiteId = App.selection.siteId;
    var sites = Sim.sites().sites;
    sites.forEach(function (site) {
      var status = Sim.siteStatus(site.id);
      var pinClass = View.pinClass(status);
      var marker = markers[site.id];
      if (marker) {
        var newClass = pinClass + (selectedSiteId === site.id ? " selected" : "");
        marker.setIcon(L.divIcon({
          className: "pin-icon",
          html: '<div class="' + newClass + '"><div class="ring"></div><div class="dot"></div></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        }));
        var tooltip = marker.getTooltip();
        if (tooltip) {
          var tooltipClass = "pin-label" + (status === "fault" ? " fault" : "");
          tooltip.options.className = tooltipClass;
          if (tooltip.getElement && tooltip.getElement()) {
            var elem = tooltip.getElement();
            var leafletClass = "";
            for (var i = 0; i < elem.classList.length; i++) {
              if (elem.classList[i].indexOf("leaflet-tooltip-") === 0) {
                leafletClass = " " + elem.classList[i];
                break;
              }
            }
            elem.className = "leaflet-tooltip " + tooltipClass + leafletClass;
          }
        }
      }
      lastSiteStatus[site.id] = status;
    });
  }

  /* ---------- panel pieces ---------- */

  function renderGauge(asset, tag) {
    var tagDef = asset.defs.find(function (t) { return t.tag === tag; });
    var r = tagDef.ranges[asset.model];
    var t = asset.tags[tag];
    var quality = t.quality;
    var fraction = View.gaugeArc(t.value, r.min, r.max);
    var arcLength = 157;
    var offset = arcLength * (1 - fraction);

    var isAlarm = (quality === "ALARM" || quality === "OUT_OF_RANGE");
    var arcClass = isAlarm ? "arc alarm" : "arc";

    return '<div class="gauge' + (isAlarm ? " alarm" : "") + '">' +
      '<svg viewBox="0 0 130 80">' +
      '<path class="track" d="M 15 70 A 50 50 0 0 1 115 70"></path>' +
      '<path class="' + arcClass + '" d="M 15 70 A 50 50 0 0 1 115 70" style="stroke-dasharray: ' + arcLength + '; stroke-dashoffset: ' + offset + ';"></path>' +
      '</svg>' +
      '<div class="gv">' + Sim.format(t.value, tagDef) + '</div>' +
      '<div class="gl">' + tagDef.label + ' (' + tagDef.unit + ')</div>' +
      '</div>';
  }

  function renderSparkline(history) {
    if (!history || history.length === 0) {
      return '<svg class="spark" viewBox="0 0 86 20"><polyline points=""></polyline></svg>';
    }
    var points = View.sparklinePoints(history, 86, 20);
    return '<svg class="spark" viewBox="0 0 86 20"><polyline points="' + points + '"></polyline></svg>';
  }

  function chip(status) {
    var g = View.statusGlyph(status);
    return '<span class="chip ' + g.status + '">' + View.statusGlyphSvg(status, 12) + g.label + '</span>';
  }

  function tile(value, label, sub, cls) {
    return '<div class="tile' + (cls ? " " + cls : "") + '"><div class="tv">' + value + '</div><div class="tl">' + label + '</div>' +
      (sub ? '<div class="ts">' + sub + '</div>' : '') + '</div>';
  }

  function kvRow(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }

  function workOrderHtml(r, withAsset) {
    return '<div class="wo"><div class="w1"><span class="wd">' + r.date + '</span><span class="wn">' + r.wo + '</span>' +
      '<span class="wtag ' + r.type + '">' + r.type + '</span>' +
      (withAsset ? '<button class="wlink" data-asset="' + r.assetId + '" title="Open ' + r.assetId + '">' + r.assetId + '</button>' : '') +
      '</div><div class="wdesc">' + r.desc + '</div>' +
      '<div class="wm">' + View.formatHours(r.hours) + ' h &middot; tech ' + r.tech + '</div></div>';
  }

  function eventsHtml(ids, limit) {
    var evs = Sim.events().filter(function (ev) { return ids.indexOf(ev.assetId || ev.gensetId) >= 0; }).slice(0, limit);
    var html = '<div class="events"><h3>Validation events</h3>';
    if (!evs.length) html += '<div class="none">No validation events yet. Use Simulate Fault to generate some.</div>';
    evs.forEach(function (ev) {
      html += '<div class="ev ' + (ev.kind || "INFO") + '"><span class="t">' + (ev.t || "--:--:--") + '</span>' +
        '<span class="m">' + (ev.msg || "") + '</span></div>';
    });
    return html + '</div>';
  }

  function fmtMw(v) { return v.toFixed(v >= 10 ? 1 : 2); }

  /* ---------- facility tabs ---------- */

  function siteSummaryTab(site) {
    var s = Sim.siteSummary(site.id);
    var b = s.bess;
    var html = '<div class="tiles">' +
      tile(fmtMw(s.outputMw) + ' <small>MW</small>', 'Site output', s.running + ' running, ' + s.standby + ' standby') +
      tile(fmtMw(s.onlineMw) + ' / ' + fmtMw(s.installedMw) + ' <small>MW</small>', 'Online / installed', s.inService ? s.inService + ' in service' : '') +
      tile(fmtMw(s.spareMw) + ' <small>MW</small>', 'Spare capacity', 'online headroom ' + fmtMw(s.onlineMw - s.outputMw) + ' MW') +
      tile(s.redundancy || '--', 'Redundancy', site.peak_mw ? 'peak load ' + site.peak_mw + ' MW' : '') +
      (b.count ?
        tile(b.socPct.toFixed(0) + ' <small>% SOC</small>', 'Battery', b.count + ' x 5 MWh, ' + b.mwh.toFixed(0) + ' MWh installed') +
        tile(View.formatRideThrough(b.rideThroughMin), 'Ride-through', 'at current site output') :
        tile('none', 'Battery', 'no storage at this site') + tile('--', 'Ride-through', '')) +
      tile(String(s.unscheduled90d), 'Unscheduled WOs', 'last 90 days, ' + s.workOrders90d + ' total', s.unscheduled90d > 2 ? 'warn' : '') +
      tile(String(s.alarms), 'Alarms', s.alarms ? 'asset flagged' : 'all clear', s.alarms ? 'alarm' : 'ok') +
      '</div>';
    html += '<table class="kv">' + (s.customer && s.customer !== site.name ? kvRow('Customer', s.customer) : '') + kvRow('Facility type', s.type);
    if (site.beds) html += kvRow('Beds', site.beds);
    html += kvRow('Location', site.lat.toFixed(4) + ', ' + site.lon.toFixed(4));
    html += '</table>';
    if (site.note) html += '<div class="sub">' + site.note + '</div>';
    return html;
  }

  function siteAssetsTab(site) {
    var html = '<div class="alist">';
    Sim.assets(site.id).forEach(function (a) {
      html += '<button class="arow ' + a.status + '" data-asset="' + a.id + '" title="Open ' + a.id + '">' +
        View.statusGlyphSvg(a.status, 12) +
        '<span class="aid">' + a.id + '</span><span class="aunit">' + a.unit + '</span>' +
        '<span class="aval">' + View.assetRowValue(a) + '</span></button>';
    });
    return html + '</div>';
  }

  function siteServiceTab(site) {
    var recs = Sim.siteServiceRecords(site.id, 25);
    var html = '<div class="sec" style="margin-top:0">Most recent work orders</div>';
    if (!recs.length) return html + '<div class="none">No service records.</div>';
    recs.forEach(function (r) { html += workOrderHtml(r, true); });
    return html;
  }

  function siteEventsTab(site) {
    return eventsHtml(Sim.assets(site.id).map(function (a) { return a.id; }), 40);
  }

  /* ---------- asset tabs ---------- */

  function assetOverviewTab(a, site) {
    var html = "";
    var fault = Sim.activeFault();
    if (fault && fault.assetId === a.id) {
      var tagDef = a.defs.find(function (t) { return t.tag === fault.scenario.tag; });
      html += '<div class="alarm-banner">' + fault.scenario.label + ': ' + fault.scenario.tag + ' ' +
        Sim.format(a.tags[fault.scenario.tag].value, tagDef) + ' ' + tagDef.unit + '</div>';
    }
    var isBess = a.kind === "bess";
    var next = a.nextService;
    html += '<table class="kv">' +
      kvRow('Asset no.', a.assetNo || '--') +
      kvRow('Serial', a.serial) +
      kvRow(isBess ? 'Chemistry' : 'Engine / model', isBess ? 'LFP, liquid-cooled' : '<span class="oem ' + (a.oem === "Caterpillar" ? "cat" : "wks") + '">' + a.oemShort + '</span> ' + a.model) +
      kvRow('Rating', isBess ? a.ratingMwh.toFixed(1) + ' MWh / ' + a.ratingMw.toFixed(1) + ' MW' : a.ratingMw.toFixed(1) + ' MW') +
      kvRow('Commissioned', a.commissioned || '--') +
      kvRow(isBess ? 'Online hours / cycles' : 'Run hours / starts', View.formatHours(a.runHours) + ' h / ' + View.formatHours(a.starts)) +
      kvRow('Next service', next ? next.task + '<br>' + View.formatDue(next.dueInH, a.kind) : '--') +
      '</table>';
    html += '<div class="gauges">' +
      (isBess ? renderGauge(a, "soc") + renderGauge(a, "bess_power")
              : renderGauge(a, "engine_speed") + renderGauge(a, "real_power")) +
      '</div>';
    return html;
  }

  function assetLiveTab(a) {
    var html = '<table class="tags">';
    a.defs.forEach(function (tagDef) {
      var tag = a.tags[tagDef.tag];
      var quality = tag.quality;
      var formatted = (quality === "NOT_RUNNING") ? "--" : (tagDef.enum ? tag.value : Sim.format(tag.value, tagDef));
      var rowClass = (quality === "ALARM" || quality === "OUT_OF_RANGE") ? " alarm" : "";
      html += '<tr class="' + rowClass + '">' +
        '<td class="tag">' + tagDef.tag + '</td>' +
        '<td class="val">' + formatted + '</td>' +
        '<td class="unit">' + tagDef.unit + '</td>' +
        '<td class="q"><span class="qb ' + quality + '">' + quality + '</span></td>' +
        '<td class="spark">' + renderSparkline(tag.history) + '</td>' +
        '</tr>';
    });
    html += '</table>';
    var names = a.kind === "bess" ? ["Charge", "Discharge", "Power setpoint"] : ["Start", "Stop", "Load setpoint"];
    html += '<div class="controls">';
    names.forEach(function (n) {
      html += '<button title="Monitor only. This demo cannot change equipment state.">' + n + '</button>';
    });
    return html + '<span class="lock">monitor only</span></div>';
  }

  function assetServiceTab(a) {
    var html = '<div class="sec" style="margin-top:0">Next due</div><div class="tiles">';
    Sim.dueList(a.id).slice(0, 4).forEach(function (d, i) {
      html += tile(View.formatDue(d.dueInH, a.kind), d.task,
        a.kind === "bess" ? '' : 'at ' + View.formatHours(d.dueAtH) + ' h', i === 0 ? 'ok' : '');
    });
    html += '</div><div class="sec">Work order history</div>';
    var recs = Sim.serviceRecords(a.id);
    if (!recs.length) return html + '<div class="none">No service records.</div>';
    recs.forEach(function (r) { html += workOrderHtml(r, false); });
    return html;
  }

  function assetEventsTab(a) {
    return eventsHtml([a.id], 40);
  }

  /* ---------- panel shell: header + tabs + body, 1 Hz safe ---------- */

  var panelState = { key: "", tab: "", lastHead: "", lastTabs: "", pressing: false };

  function panelEl(sel) { return document.getElementById("panel").querySelector(sel); }

  function headerHtml(site, a) {
    if (!a) {
      var status = Sim.siteStatus(site.id);
      return (site.customer && site.customer !== site.name ? '<div class="cust">' + site.customer + '</div>' : '') +
        '<div class="panel-head"><div><h2>' + site.name + '</h2>' +
        '<div class="sub">' + site.type + ' &middot; ' + Sim.assets(site.id).length + ' assets</div></div>' +
        '<button class="back" data-back="fleet" title="Zoom back out to the fleet overview">Back to map</button></div>' +
        '<div class="ph-line">' + chip(status === "fault" ? "fault" : status) + '</div>';
    }
    return '<button class="back-link" data-back="site" title="Back to the facility view of ' + site.name + '">&lsaquo; ' + site.name + '</button>' +
      '<div class="panel-head"><div><h2>' + a.id + '</h2>' +
      '<div class="sub">' + a.unit + ' &middot; ' + (site.customer || "") + '</div></div>' + chip(a.status) + '</div>';
  }

  function tabsHtml(hasAsset, active) {
    return View.panelTabs(hasAsset).map(function (t) {
      return '<button class="tab' + (t === active ? ' active' : '') + '" data-tab="' + t + '">' + t + '</button>';
    }).join("");
  }

  function bodyHtml(hasAsset, tab, site, a) {
    if (hasAsset) {
      if (tab === "Overview") return assetOverviewTab(a, site);
      if (tab === "Live data") return assetLiveTab(a);
      if (tab === "Service") return assetServiceTab(a);
      return assetEventsTab(a);
    }
    if (tab === "Summary") return siteSummaryTab(site);
    if (tab === "Assets") return siteAssetsTab(site);
    if (tab === "Service") return siteServiceTab(site);
    return siteEventsTab(site);
  }

  function renderPanel() {
    var panel = document.getElementById("panel");
    var sel = App.selection;
    if (!sel.siteId) {
      if (panelState.key !== "none") {
        panel.innerHTML = '<div class="empty">Select a site pin to open its panel.</div>';
        panelState.key = "none"; panelState.lastHead = ""; panelState.lastTabs = "";
      }
      return;
    }
    var site = siteById(sel.siteId);
    if (!site) return;
    var a = sel.assetId ? Sim.asset(sel.assetId) : null;
    var hasAsset = !!a;
    var key = (hasAsset ? "a:" + a.id : "s:" + site.id);
    var fresh = key !== panelState.key;
    if (fresh) {
      panel.innerHTML = '<div class="ph"></div><div class="tabs"></div><div class="tab-body"></div>';
      panelState.key = key; panelState.lastHead = ""; panelState.lastTabs = "";
    }
    panelState.tab = View.resolveTab(hasAsset, panelState.tab);

    var head = headerHtml(site, a);
    if (head !== panelState.lastHead) { panelEl(".ph").innerHTML = head; panelState.lastHead = head; }
    var tabs = tabsHtml(hasAsset, panelState.tab);
    if (tabs !== panelState.lastTabs) { panelEl(".tabs").innerHTML = tabs; panelState.lastTabs = tabs; }

    if (panelState.pressing) return;      // do not swap nodes under a click in progress
    var body = panelEl(".tab-body");
    var top = fresh ? 0 : body.scrollTop;
    body.innerHTML = bodyHtml(hasAsset, panelState.tab, site, a);
    body.scrollTop = top;
  }

  function setTab(tab) {
    panelState.tab = tab;
    renderPanel();
    panelEl(".tab-body").scrollTop = 0;
  }

  function initPanelEvents() {
    var panel = document.getElementById("panel");
    panel.addEventListener("mousedown", function () { panelState.pressing = true; });
    document.addEventListener("mouseup", function () { setTimeout(function () { panelState.pressing = false; }, 0); });
    panel.addEventListener("click", function (e) {
      var el = e.target.closest ? e.target.closest("button") : null;
      if (!el) return;
      if (el.getAttribute("data-tab")) { setTab(el.getAttribute("data-tab")); return; }
      if (el.getAttribute("data-asset")) { App.selectAsset(el.getAttribute("data-asset")); return; }
      var back = el.getAttribute("data-back");
      if (back === "fleet") { App.selectSite(null); return; }
      if (back === "site") { App.selectAsset(null); return; }
      if (el.parentNode && el.parentNode.classList.contains("controls")) {
        showToast(View.controlGuard(el.textContent.trim(), Sim).message);
      }
    });
  }

  function renderAll() {
    renderKpis();
    updateMarkers();
    renderPanel();
  }

  var lastFlownSite = null;
  function onSelection(sel) {
    renderPanel();
    updateMarkers();
    if (!App.autoFly || !map) return;
    if (sel.siteId !== lastFlownSite) {
      lastFlownSite = sel.siteId;
      if (sel.siteId) FleetMap.flyToSite(sel.siteId, 9, 0.9);
      else FleetMap.reset(0.9);
    }
  }

  function updateTooltipPermanence() {
    var zoom = map.getZoom();
    var shouldBePermanent = zoom >= 7;
    var sites = Sim.sites().sites;
    sites.forEach(function (site) {
      var marker = markers[site.id];
      if (marker) {
        var existingTooltip = marker.getTooltip();
        var hasFault = false;
        if (existingTooltip && existingTooltip.options && existingTooltip.options.className) {
          hasFault = existingTooltip.options.className.indexOf("fault") >= 0;
        }
        var tooltipClass = "pin-label" + (hasFault ? " fault" : "");
        marker.unbindTooltip();
        marker.bindTooltip(site.name, {
          className: tooltipClass,
          direction: "top",
          offset: [0, -10],
          permanent: shouldBePermanent
        });
      }
    });
  }

  function initMap() {
    map = L.map("map", { zoomControl: false, attributionControl: true });
    FleetMap.map = map;

    tileLayers.dark = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors",
      maxZoom: 16
    });
    tileLayers.light = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors",
      maxZoom: 16
    });
    tileLayers[theme].addTo(map);
    fitFleet(false);

    var sites = Sim.sites().sites;
    sites.forEach(function (site) {
      var status = Sim.siteStatus(site.id);
      var pinClass = View.pinClass(status);

      var marker = L.marker([site.lat, site.lon], {
        icon: L.divIcon({
          className: "pin-icon",
          html: '<div class="' + pinClass + '"><div class="ring"></div><div class="dot"></div></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      })
      .bindTooltip(site.name, { className: "pin-label", direction: "top", offset: [0, -10], permanent: false })
      .addTo(map);

      marker.on("click", function () {
        App.selectSite(site.id);
      });

      markers[site.id] = marker;
      lastSiteStatus[site.id] = status;
    });

    updateTooltipPermanence();
    map.on("zoomend", updateTooltipPermanence);
  }

  function openSchema() {
    var modal = document.getElementById("schema-modal");
    modal.classList.add("open");

    var versionDiv = document.getElementById("schema-version");
    var schema = Sim.schema();
    versionDiv.textContent = "Schema " + schema.version + ": " + schema.status;

    var tbody = document.getElementById("schema-tbody");
    tbody.innerHTML = "";

    var rows = View.schemaRows(schema);
    rows.forEach(function (row) {
      var tr = document.createElement("tr");

      var tagCell = document.createElement("td");
      tagCell.className = "mono";
      tagCell.textContent = row.tag;
      tr.appendChild(tagCell);

      var unitCell = document.createElement("td");
      unitCell.textContent = row.unit;
      tr.appendChild(unitCell);

      var g3520Cell = document.createElement("td");
      if (row.ranges.G3520) {
        var r = row.ranges.G3520;
        var prov = r.provenance ? ' <span class="qb estimate">' + r.provenance + '</span>' : '';
        g3520Cell.innerHTML = r.nominal + ' / ' + r.min + '..' + r.max + ' / ' + r.alarm_lo + '..' + r.alarm_hi + prov;
        if (r.provenance === "estimate") {
          var qb = g3520Cell.querySelector(".qb");
          if (qb) qb.classList.add("estimate");
        }
      }
      tr.appendChild(g3520Cell);

      var wauksheaCell = document.createElement("td");
      if (row.ranges["9394S5"]) {
        var r = row.ranges["9394S5"];
        var prov = r.provenance ? ' <span class="qb estimate">' + r.provenance + '</span>' : '';
        wauksheaCell.innerHTML = r.nominal + ' / ' + r.min + '..' + r.max + ' / ' + r.alarm_lo + '..' + r.alarm_hi + prov;
        if (r.provenance === "estimate") {
          var qb = wauksheaCell.querySelector(".qb");
          if (qb) qb.classList.add("estimate");
        }
      }
      tr.appendChild(wauksheaCell);

      var catCell = document.createElement("td");
      catCell.className = "raw";
      if (row.oem.Caterpillar) {
        var cat = row.oem.Caterpillar;
        catCell.innerHTML = cat.name;
        if (cat.register || cat.scaling) {
          catCell.innerHTML += '<small>' + (cat.register || '') + (cat.scaling ? (cat.register ? ' ' : '') + cat.scaling : '') + '</small>';
        }
      }
      tr.appendChild(catCell);

      var wksCell = document.createElement("td");
      wksCell.className = "raw";
      if (row.oem.Waukesha) {
        var wks = row.oem.Waukesha;
        wksCell.innerHTML = wks.name;
        if (wks.register || wks.scaling) {
          wksCell.innerHTML += '<small>' + (wks.register || '') + (wks.scaling ? (wks.register ? ' ' : '') + wks.scaling : '') + '</small>';
        }
      }
      tr.appendChild(wksCell);

      tbody.appendChild(tr);
    });
  }

  function closeSchema() {
    var modal = document.getElementById("schema-modal");
    modal.classList.remove("open");
  }


  function init() {
    Promise.all([
      fetch("data/schema.json").then(function (r) { return r.json(); }),
      fetch("data/sites.json").then(function (r) { return r.json(); }),
      fetch("data/service.json").then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (data) {
      var schema = data[0];
      var sites = data[1];

      Sim.init(schema, sites, data[2]);
      initMap();
      setTheme(theme);
      initPanelEvents();
      App.onSelection(onSelection);
      renderAll();

      Sim.onTick(renderAll);
      setInterval(Sim.tick, 1000);

      document.getElementById("btn-fault").addEventListener("click", function () {
        var fault = Sim.simulateFault();
        if (fault) {
          var gs = Sim.asset(fault.assetId);
          if (gs) {
            App.selectSite(gs.siteId);
          }
        }
      });

      document.getElementById("btn-clear").addEventListener("click", function () {
        Sim.clearFault();
        updateMarkers();
        renderPanel();
      });

      document.getElementById("btn-theme").addEventListener("click", function () {
        setTheme(theme === "dark" ? "light" : "dark");
      });

      document.getElementById("btn-schema").addEventListener("click", function () {
        openSchema();
      });

      document.getElementById("schema-close").addEventListener("click", function () {
        closeSchema();
      });

      document.getElementById("schema-modal").addEventListener("click", function (e) {
        if (e.target === this) {
          closeSchema();
        }
      });

      document.addEventListener("keydown", function (e) {
        if (e.key !== "Escape") return;
        var modal = document.getElementById("schema-modal");
        if (modal.classList.contains("open")) { closeSchema(); return; }
        if (App.selection.assetId) App.selectAsset(null);
        else if (App.selection.siteId) App.selectSite(null);
      });

      readyResolve(App);
      window.dispatchEvent(new Event("fleetmap-ready"));
    }).catch(function (err) {
      var panel = document.getElementById("panel");
      panel.innerHTML = '<div class="empty">Error loading data: ' + err.message + '</div>';
    });
  }

  init();
})();
