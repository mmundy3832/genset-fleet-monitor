import { describe, it, expect } from "vitest";
import { loadSim } from "./helpers/load-module.js";

const ticks = (Sim, n) => { for (let i = 0; i < n; i++) Sim.tick(true); };

describe("Sim.assets / Sim.asset", () => {
  it("returns gensets and batteries per site with contract fields", () => {
    const { Sim } = loadSim();
    const list = Sim.assets("bigspring-hosp");
    expect(list.map((a) => a.id)).toEqual(["BSRM-01", "BSRM-02", "BSRM-03", "BSRM-04", "BSRM-B1", "BSRM-B2"]);
    expect(Sim.assets().length).toBe(Object.keys(Sim.gensets()).length + 8);
    const g = Sim.asset("BSRM-02");
    expect(g).toMatchObject({ kind: "genset", siteId: "bigspring-hosp", unit: "PWR2.6-S", assetNo: "PW-26S-0147", commissioned: "2025-06-18", starts: 214 });
    expect(Sim.asset("nope")).toBeUndefined();
    const b = Sim.asset("BSRM-B1");
    expect(b).toMatchObject({ kind: "bess", ratingMwh: 5, ratingMw: 2.5, status: "running" });
    for (const t of ["soc", "soh", "bess_power", "cell_temp_min", "cell_temp_max", "rack_voltage", "bess_humidity", "h2", "co", "hvac_state"]) {
      expect(b.tags[t], t).toBeDefined();
      expect(Array.isArray(b.tags[t].history)).toBe(true);
    }
    for (const t of ["enclosure_temp", "enclosure_humidity"]) expect(g.tags[t], t).toBeDefined();
  });

  it("legacy APIs still work", () => {
    const { Sim } = loadSim();
    expect(Sim.genset("ODC-01").id).toBe("ODC-01");
    expect(Sim.genset("BSRM-B1")).toBeUndefined();
    expect(Sim.siteGensets("midwest-dc").length).toBe(28);
    expect(Sim.fleet().total).toBe(Object.keys(Sim.gensets()).length);
  });

  it("battery tags stay in band over 300 ticks and SOC drifts slowly inside 70..95", () => {
    const { Sim } = loadSim();
    const bs = Sim.assets().filter((a) => a.kind === "bess");
    const start = bs.map((b) => b.tags.soc.value);
    for (let i = 0; i < 300; i++) {
      Sim.tick(true);
      for (const b of bs) {
        expect(b.tags.soc.value).toBeGreaterThanOrEqual(70);
        expect(b.tags.soc.value).toBeLessThanOrEqual(95);
        expect(b.tags.h2.value).toBeLessThan(2);
        expect(b.tags.co.value).toBeLessThan(5);
        expect(Math.abs(b.tags.bess_power.value)).toBeLessThan(0.5);
        expect(["idle", "cooling"]).toContain(b.tags.hvac_state.value);
      }
    }
    bs.forEach((b, i) => expect(Math.abs(b.tags.soc.value - start[i])).toBeLessThan(2));
    for (const b of bs) for (const t of Object.values(b.tags)) expect(t.quality).toBe("GOOD");
  });

  it("enclosure is hot and dry when running, near ambient on standby", () => {
    const { Sim } = loadSim();
    ticks(Sim, 5);
    const run = Sim.asset("MWH-01"), sb = Sim.asset("MWH-28");
    expect(run.tags.enclosure_temp.value).toBeGreaterThan(35);
    expect(run.tags.enclosure_humidity.value).toBeLessThan(35);
    expect(sb.tags.enclosure_temp.value).toBeLessThan(26);
    expect(sb.tags.enclosure_humidity.value).toBeGreaterThan(40);
  });

  it("run hours accumulate only while running and are restored after warm-up", () => {
    const { Sim } = loadSim();
    const r = Sim.asset("BSRM-02"), s = Sim.asset("BSRM-04");
    expect(r.runHours).toBe(11482);
    const s0 = s.runHours;
    ticks(Sim, 36);
    expect(r.runHours).toBeCloseTo(11482 + 36 / 3600, 6);
    expect(s.runHours).toBe(s0);
  });
});

describe("battery fault scenario", () => {
  it("h2 rises to ALARM, flags the battery and its site, then clears", () => {
    const { Sim } = loadSim();
    const C = Sim.constants();
    let f = null;
    for (let i = 0; i < 400 && !(f && f.scenario.tag === "h2"); i++) { f = Sim.simulateFault(); if (!(f && f.scenario.tag === "h2")) Sim.clearFault(); }
    expect(f && f.scenario.tag, "bess scenario drawn").toBe("h2");
    const b = Sim.asset(f.assetId);
    expect(b.kind).toBe("bess");
    ticks(Sim, C.FAULT_RAMP_S + 2);
    expect(b.status).toBe("fault");
    expect(b.tags.h2.quality).toBe("ALARM");
    expect(b.tags.h2.value).toBeGreaterThan(25);
    expect(Sim.siteStatus(b.siteId)).toBe("fault");
    expect(Sim.fleet().alarms).toBe(1);
    expect(Sim.siteSummary(b.siteId).alarms).toBe(1);
    Sim.clearFault();
    ticks(Sim, 3);
    expect(b.status).toBe("running");
    expect(b.tags.h2.quality).toBe("GOOD");
  });
});

describe("service status", () => {
  it("service mode behaves like standby and is reversible", () => {
    const { Sim } = loadSim();
    Sim.setServiceMode("MWH-02", true);
    ticks(Sim, 3);
    const g = Sim.asset("MWH-02");
    expect(g.status).toBe("service");
    expect(g.tags.real_power.value).toBe(0);
    expect(g.tags.real_power.quality).toBe("NOT_RUNNING");
    expect(Sim.siteSummary("midwest-dc").inService).toBe(1);
    expect(Sim.siteSummary("midwest-dc").running).toBe(24);
    Sim.setServiceMode("MWH-02", false);
    expect(g.status).toBe("running");
  });
});
