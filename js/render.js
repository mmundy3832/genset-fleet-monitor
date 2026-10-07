(function () {
  "use strict";

  var map = null;
  var markers = {};
  var selectedSiteId = null;
  var lastSiteStatus = {};

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

  function renderGauge(tag, value, min, max, ranges) {
    var quality = null;
    var genset = Sim.genset(selectedSiteId);
    if (genset) {
      var gs = Sim.siteGensets(selectedSiteId);
      for (var i = 0; i < gs.length; i++) {
        if (gs[i].tags[tag]) {
          quality = gs[i].tags[tag].quality;
          break;
        }
      }
    }

    var fraction = View.gaugeArc(value, min, max);
    var arcLength = 157;
    var offset = arcLength * (1 - fraction);

    var isAlarm = (quality === "ALARM" || quality === "OUT_OF_RANGE");
    var arcClass = isAlarm ? "arc alarm" : "arc";

    var tagDef = Sim.schema().tags.find(function (t) { return t.tag === tag; });
    var formattedValue = Sim.format(value, tagDef);
    var unit = tagDef.unit;
    var label = tagDef.label;

    return '<div class="gauge' + (isAlarm ? " alarm" : "") + '">' +
      '<svg viewBox="0 0 130 80">' +
      '<path class="track" d="M 15 70 A 50 50 0 0 1 115 70"></path>' +
      '<path class="' + arcClass + '" d="M 15 70 A 50 50 0 0 1 115 70" style="stroke-dasharray: ' + arcLength + '; stroke-dashoffset: ' + offset + ';"></path>' +
      '</svg>' +
      '<div class="gv">' + formattedValue + '</div>' +
      '<div class="gl">' + label + ' (' + unit + ')</div>' +
      '</div>';
  }

  function renderSparkline(history) {
    if (!history || history.length === 0) {
      return '<svg class="spark" viewBox="0 0 86 20"><polyline points=""></polyline></svg>';
    }
    var points = View.sparklinePoints(history, 86, 20);
    return '<svg class="spark" viewBox="0 0 86 20"><polyline points="' + points + '"></polyline></svg>';
  }

  function renderPanel() {
    var panel = document.getElementById("panel");

    if (!selectedSiteId) {
      panel.innerHTML = '<div class="empty">Select a site pin to open its panel.</div>';
      return;
    }

    var sites = Sim.sites().sites;
    var site = sites.find(function (s) { return s.id === selectedSiteId; });
    if (!site) return;

    var gensets = Sim.siteGensets(selectedSiteId);
    var siteStatus = Sim.siteStatus(selectedSiteId);
    var lat = site.lat.toFixed(4);
    var lon = site.lon.toFixed(4);

    var html = '<div class="panel-head">' +
      '<div><h2>' + site.name + '</h2>' +
      '<div class="sub">' + site.type + ' &middot; ' + gensets.length + ' assets &middot; ' + lat + ', ' + lon + '</div>' +
      '</div>' +
      '<button class="back" title="Zoom back out to the Texas overview">Back to map</button>' +
      '</div>';

    gensets.forEach(function (gs) {
      var statusClass = "gs " + gs.status;
      var statusText = gs.status.charAt(0).toUpperCase() + gs.status.slice(1);
      var fault = Sim.activeFault();
      var isFaulted = fault && fault.gensetId === gs.id;

      html += '<div class="' + statusClass + '">' +
        '<div class="gs-head">' +
        '<span class="oem ' + (gs.oem === "Caterpillar" ? "cat" : "wks") + '">' + gs.oemShort + '</span>' +
        '<span class="gs-id">' + gs.id + '</span>' +
        '<span class="gs-meta">' + gs.unit + ' &middot; ' + gs.model + ' &middot; ' + gs.serial + '</span>' +
        '<div class="status' + (gs.status === "standby" ? " standby" : (gs.status === "fault" ? " fault" : "")) + '">' +
        '<span class="sd"></span>' +
        statusText +
        '</div>' +
        '</div>';

      if (isFaulted) {
        var scenario = Sim.activeFault().scenario;
        var tagDef = Sim.schema().tags.find(function (t) { return t.tag === scenario.tag; });
        var value = gs.tags[scenario.tag].value;
        var formatted = Sim.format(value, tagDef);
        html += '<div class="alarm-banner">' + scenario.label + ': ' + scenario.tag + ' ' + formatted + ' ' + tagDef.unit + '</div>';
      }

      var engineSpeedTag = "engine_speed";
      var realPowerTag = "real_power";

      var schema = Sim.schema();
      var engineSpeedDef = schema.tags.find(function (t) { return t.tag === engineSpeedTag; });
      var realPowerDef = schema.tags.find(function (t) { return t.tag === realPowerTag; });

      var engineSpeedValue = gs.tags[engineSpeedTag].value;
      var realPowerValue = gs.tags[realPowerTag].value;

      var engineSpeedRanges = engineSpeedDef.ranges[gs.model];
      var realPowerRanges = realPowerDef.ranges[gs.model];

      html += '<div class="gauges">' +
        renderGauge(engineSpeedTag, engineSpeedValue, engineSpeedRanges.min, engineSpeedRanges.max, engineSpeedRanges) +
        renderGauge(realPowerTag, realPowerValue, realPowerRanges.min, realPowerRanges.max, realPowerRanges) +
        '</div>';

      html += '<table class="tags">';
      schema.tags.forEach(function (tagDef) {
        var tag = gs.tags[tagDef.tag];
        var quality = tag.quality;
        var formatted = (quality === "NOT_RUNNING") ? "--" : Sim.format(tag.value, tagDef);
        var rowClass = (quality === "ALARM" || quality === "OUT_OF_RANGE") ? " alarm" : "";

        var qbClass = "qb " + quality;
        html += '<tr class="' + rowClass + '">' +
          '<td class="tag">' + tagDef.tag + '</td>' +
          '<td class="val">' + formatted + '</td>' +
          '<td class="unit">' + tagDef.unit + '</td>' +
          '<td class="q"><span class="' + qbClass + '">' + quality + '</span></td>' +
          '<td class="spark">' + renderSparkline(tag.history) + '</td>' +
          '</tr>';
      });
      html += '</table>';

      html += '<div class="controls">' +
        '<button title="Monitor only. This demo cannot change equipment state.">Start</button>' +
        '<button title="Monitor only. This demo cannot change equipment state.">Stop</button>' +
        '<button title="Monitor only. This demo cannot change equipment state.">Load setpoint</button>' +
        '<span class="lock">monitor only</span>' +
        '</div>';

      var events = Sim.events().slice(0, 12);
      html += '<div class="events">' +
        '<h3>Validation events</h3>';

      events.forEach(function (ev) {
        var timeStr = ev.t || "--:--:--";
        var msgStr = ev.msg || "";
        var evClass = "ev " + (ev.kind || "INFO");
        html += '<div class="' + evClass + '">' +
          '<span class="t">' + timeStr + '</span>' +
          '<span class="m">' + msgStr + '</span>' +
          '</div>';
      });

      html += '</div>';
      html += '</div>';
    });

    panel.innerHTML = html;

    var backBtn = panel.querySelector(".back");
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        selectedSiteId = null;
        map.setView([31.3, -99.5], 6, { duration: 0.9 });
        updateMarkers();
        renderPanel();
      });
    }

    var controlBtns = panel.querySelectorAll(".controls button");
    controlBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.textContent.trim();
        var result = View.controlGuard(action, Sim);
        showToast(result.message);
      });
    });
  }

  function renderAll() {
    renderKpis();
    updateMarkers();
    renderPanel();
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
    map = L.map("map", { zoomControl: false, attributionControl: true })
      .setView([31.3, -99.5], 6);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri, HERE, Garmin, OpenStreetMap contributors",
      maxZoom: 16
    }).addTo(map);

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
        selectedSiteId = site.id;
        map.flyTo([site.lat, site.lon], 9, { duration: 0.9 });
        updateMarkers();
        renderPanel();
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
      fetch("data/sites.json").then(function (r) { return r.json(); })
    ]).then(function (data) {
      var schema = data[0];
      var sites = data[1];

      Sim.init(schema, sites);
      initMap();
      renderAll();

      Sim.onTick(renderAll);
      setInterval(Sim.tick, 1000);

      document.getElementById("btn-fault").addEventListener("click", function () {
        var fault = Sim.simulateFault();
        if (fault) {
          var gs = Sim.genset(fault.gensetId);
          if (gs) {
            selectedSiteId = gs.siteId;
            var site = Sim.sites().sites.find(function (s) { return s.id === gs.siteId; });
            if (site) {
              map.flyTo([site.lat, site.lon], 9, { duration: 0.9 });
              updateMarkers();
              renderPanel();
            }
          }
        }
      });

      document.getElementById("btn-clear").addEventListener("click", function () {
        Sim.clearFault();
        updateMarkers();
        renderPanel();
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
    }).catch(function (err) {
      var panel = document.getElementById("panel");
      panel.innerHTML = '<div class="empty">Error loading data: ' + err.message + '</div>';
    });
  }

  init();
})();
