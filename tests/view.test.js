import { describe, it, expect } from "vitest";
import { loadModule, readJson } from "./helpers/load-module.js";

const View = loadModule("js/view.js").View;

describe("View helpers", () => {
  it("pinClass maps running, standby, fault to pin classes", () => {
    expect(View.pinClass("running")).toBe("pin running");
    expect(View.pinClass("standby")).toBe("pin standby");
    expect(View.pinClass("fault")).toBe("pin fault");
    expect(View.pinClass("bogus")).toBe("pin standby");
    expect(View.pinClass(undefined)).toBe("pin standby");
  });

  it("formatKpis renders MW to one decimal, running/total, alarms, version", () => {
    const k = View.formatKpis({ mw: 23.4567, running: 11, alarms: 1, total: 15 }, "1.0.0");
    expect(k.mw).toBe("23.5");
    expect(k.running).toBe("11 / 15");
    expect(k.alarms).toBe("1");
    expect(k.version).toBe("1.0.0");
    const z = View.formatKpis({ mw: 0, running: 0, alarms: 0, total: 0 }, "0.1.0-draft");
    expect(z.mw).toBe("0.0");
    expect(z.running).toBe("0 / 0");
    expect(z.version).toBe("0.1.0-draft");
  });

  it("gaugeArc clamps fraction to [0,1] and sparklinePoints maps history to SVG points", () => {
    expect(View.gaugeArc(1800, 0, 2000)).toBeCloseTo(0.9, 6);
    expect(View.gaugeArc(-5, 0, 100)).toBe(0);
    expect(View.gaugeArc(500, 0, 100)).toBe(1);
    expect(View.gaugeArc(50, 100, 100)).toBe(0);      // degenerate range
    expect(View.gaugeArc(NaN, 0, 100)).toBe(0);
    expect(View.gaugeArc(null, 0, 100)).toBe(0);

    expect(View.sparklinePoints([], 86, 20)).toBe("");
    const pts = View.sparklinePoints([1, 2, 3], 86, 20).split(" ");
    expect(pts.length).toBe(3);
    const xy = pts.map((p) => p.split(",").map(Number));
    expect(xy[0][0]).toBe(0);
    expect(xy[2][0]).toBe(86);
    // SVG y grows downward: the max value sits at the top (smallest y)
    expect(xy[2][1]).toBeLessThan(xy[0][1]);
    for (const [x, y] of xy) {
      expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(86);
      expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(20);
    }
    // flat series sits mid-height, never NaN
    const flat = View.sparklinePoints([5, 5, 5, 5], 86, 20).split(" ").map((p) => Number(p.split(",")[1]));
    for (const y of flat) { expect(Number.isNaN(y)).toBe(false); expect(y).toBeCloseTo(10, 6); }
  });

  it("controlGuard returns the monitor-only message and calls no Sim mutator", () => {
    const calls = [];
    const spySim = new Proxy({}, { get: (_, prop) => (...args) => { calls.push(String(prop)); return undefined; } });
    for (const action of ["start", "stop", "setpoint"]) {
      const r = View.controlGuard(action, spySim);
      expect(r.allowed).toBe(false);
      expect(r.action).toBe(action);
      expect(r.message).toBe("Monitor only. Not permitted to change.");
    }
    expect(calls).toEqual([]);
  });

  it("schemaRows returns one row per tag with unit, per-model ranges, both OEM raw names and provenance", () => {
    const schema = readJson("data/schema.json");
    const rows = View.schemaRows(schema);
    expect(rows.length).toBe(schema.tags.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], t = schema.tags[i];
      expect(r.tag).toBe(t.tag);
      expect(r.label).toBe(t.label);
      expect(r.unit).toBe(t.unit);
      for (const m of Object.keys(t.ranges)) {
        expect(r.ranges[m]).toBeDefined();
        for (const k of ["nominal", "min", "max", "alarm_lo", "alarm_hi"]) expect(k in r.ranges[m]).toBe(true);
        expect(typeof r.ranges[m].provenance).toBe("string");
      }
      for (const oem of ["Caterpillar", "Waukesha"]) {
        expect(r.oem[oem].name).toBe(t.oem_source[oem].name);
        expect(typeof r.oem[oem].provenance).toBe("string");
      }
    }
    // provenance falls back to "unknown" when the schema does not carry it
    const bare = { tags: [{ tag: "x", label: "X", unit: "u", ranges: { A: { nominal: 1, min: 0, max: 2, alarm_lo: null, alarm_hi: null } }, oem_source: { Caterpillar: { name: "a" }, Waukesha: { name: "b" } } }] };
    const row = View.schemaRows(bare)[0];
    expect(row.ranges.A.provenance).toBe("unknown");
    expect(row.oem.Waukesha.provenance).toBe("unknown");
    const src = { tags: [{ ...bare.tags[0], ranges: { A: { ...bare.tags[0].ranges.A, provenance: "sourced" } }, oem_source: { Caterpillar: { name: "a", provenance: "estimate" }, Waukesha: { name: "b" } } }] };
    expect(View.schemaRows(src)[0].ranges.A.provenance).toBe("sourced");
    expect(View.schemaRows(src)[0].oem.Caterpillar.provenance).toBe("estimate");
  });
});
