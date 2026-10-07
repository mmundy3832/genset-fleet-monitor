import { describe, it, expect } from "vitest";
import { loadSim } from "./helpers/load-module.js";

function pick(Sim, status) {
  return Object.values(Sim.gensets()).find((g) => g.status === status && g.model === "G3520");
}
const rangeOf = (schema, tag, model) => schema.tags.find((t) => t.tag === tag).ranges[model];

describe("validation", () => {
  it("classifies GOOD, OUT_OF_RANGE, ALARM against model ranges", () => {
    const { Sim, schema } = loadSim();
    const g = pick(Sim, "running");
    const jw = rangeOf(schema, "coolant_temp", g.model);
    expect(Sim.validate(g.id, "coolant_temp", jw.nominal)).toBe("GOOD");
    expect(Sim.validate(g.id, "coolant_temp", jw.min)).toBe("GOOD");
    expect(Sim.validate(g.id, "coolant_temp", jw.max)).toBe("GOOD");
    expect(Sim.validate(g.id, "coolant_temp", (jw.max + jw.alarm_hi) / 2)).toBe("OUT_OF_RANGE");
    expect(Sim.validate(g.id, "coolant_temp", jw.alarm_hi + 0.1)).toBe("ALARM");
    const oil = rangeOf(schema, "oil_pressure", g.model);
    expect(Sim.validate(g.id, "oil_pressure", oil.nominal)).toBe("GOOD");
    expect(Sim.validate(g.id, "oil_pressure", (oil.min + oil.alarm_lo) / 2)).toBe("OUT_OF_RANGE");
    expect(Sim.validate(g.id, "oil_pressure", oil.alarm_lo - 1)).toBe("ALARM");
    // cumulative tags are never range-validated
    expect(Sim.validate(g.id, "energy_total", 1e9)).toBe("GOOD");
    // standby assets are not validated
    const s = pick(Sim, "standby");
    expect(Sim.validate(s.id, "coolant_temp", jw.alarm_hi + 50)).toBe("NOT_RUNNING");
  });

  it("emits event on entry to OUT_OF_RANGE or ALARM and on return to GOOD", () => {
    const { Sim, schema } = loadSim();
    const g = pick(Sim, "running");
    const jw = rangeOf(schema, "coolant_temp", g.model);
    const n0 = Sim.events().length;

    Sim.setValue(g.id, "coolant_temp", (jw.max + jw.alarm_hi) / 2);
    expect(g.tags.coolant_temp.quality).toBe("OUT_OF_RANGE");
    expect(Sim.events().length).toBe(n0 + 1);
    let ev = Sim.events()[0];
    expect(ev.kind).toBe("OUT_OF_RANGE");
    expect(ev.gensetId).toBe(g.id);
    expect(ev.tag).toBe("coolant_temp");
    expect(ev.t).toMatch(/^\d\d:\d\d:\d\d$/);

    Sim.setValue(g.id, "coolant_temp", jw.alarm_hi + 2);
    expect(g.tags.coolant_temp.quality).toBe("ALARM");
    expect(Sim.events().length).toBe(n0 + 2);
    ev = Sim.events()[0];
    expect(ev.kind).toBe("ALARM");
    expect(ev.gensetId).toBe(g.id);
    expect(ev.tag).toBe("coolant_temp");

    // same state again: no duplicate event
    Sim.setValue(g.id, "coolant_temp", jw.alarm_hi + 3);
    expect(Sim.events().length).toBe(n0 + 2);

    Sim.setValue(g.id, "coolant_temp", jw.nominal);
    expect(g.tags.coolant_temp.quality).toBe("GOOD");
    expect(Sim.events().length).toBe(n0 + 3);
    ev = Sim.events()[0];
    expect(ev.kind).toBe("CLEARED");
    expect(ev.gensetId).toBe(g.id);
    expect(ev.tag).toBe("coolant_temp");
  });
});
