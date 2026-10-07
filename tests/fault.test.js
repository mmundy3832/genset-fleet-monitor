import { describe, it, expect } from "vitest";
import { loadSim } from "./helpers/load-module.js";

const healthy = (g) => (g.status === "running" || g.status === "standby") &&
  Object.values(g.tags).every((t) => t.quality === "GOOD" || t.quality === "NOT_RUNNING");
const ticks = (Sim, n) => { for (let i = 0; i < n; i++) Sim.tick(true); };

describe("fault injection", () => {
  it("simulateFault flags one asset and its site, others stay healthy", () => {
    const { Sim } = loadSim();
    const C = Sim.constants();
    expect(Number.isInteger(C.FAULT_RAMP_S)).toBe(true);
    expect(C.FAULT_RAMP_S).toBeGreaterThan(0);
    const f = Sim.simulateFault();
    expect(f).not.toBeNull();
    const gs = Sim.genset(f.gensetId);
    expect(gs.status).toBe("running");
    expect(f.scenario.tag in gs.tags).toBe(true);
    ticks(Sim, C.FAULT_RAMP_S + 2);
    expect(gs.status).toBe("fault");
    expect(gs.tags[f.scenario.tag].quality).toBe("ALARM");
    expect(Sim.siteStatus(gs.siteId)).toBe("fault");
    for (const other of Object.values(Sim.gensets())) {
      if (other.id === gs.id) continue;
      expect(healthy(other), `${other.id} should be healthy`).toBe(true);
    }
    for (const s of Sim.sites().sites) {
      if (s.id !== gs.siteId) expect(Sim.siteStatus(s.id)).not.toBe("fault");
    }
    expect(Sim.fleet().alarms).toBe(1);
    expect(Sim.activeFault().gensetId).toBe(gs.id);
  });

  it("clearFault restores running and GOOD and logs CLEARED", () => {
    const { Sim } = loadSim();
    const C = Sim.constants();
    const f = Sim.simulateFault();
    const gs = Sim.genset(f.gensetId);
    ticks(Sim, C.FAULT_RAMP_S + 2);
    expect(gs.status).toBe("fault");
    const n0 = Sim.events().length;
    Sim.clearFault();
    expect(Sim.activeFault()).toBeNull();
    let good = false;
    for (let i = 0; i < 5 && !good; i++) { Sim.tick(true); good = healthy(gs) && gs.status === "running"; }
    expect(gs.status).toBe("running");
    expect(healthy(gs), "all tags GOOD after clear").toBe(true);
    const since = Sim.events().slice(0, Sim.events().length - n0);
    expect(since.some((e) => e.kind === "CLEARED" && e.gensetId === gs.id)).toBe(true);
    expect(Sim.fleet().alarms).toBe(0);
    expect(Sim.siteStatus(gs.siteId)).not.toBe("fault");
  });

  it("20 cycles select at least two distinct assets", () => {
    const { Sim } = loadSim();
    const picked = new Set();
    for (let i = 0; i < 20; i++) {
      const f = Sim.simulateFault();
      picked.add(f.gensetId);
      Sim.clearFault();
    }
    expect(picked.size).toBeGreaterThanOrEqual(2);
    // every asset is back to running after the cycles
    for (const g of Object.values(Sim.gensets())) expect(g.status).not.toBe("fault");
  });

  it("fleet totals match asset states", () => {
    const { Sim } = loadSim();
    const C = Sim.constants();
    const check = () => {
      const gs = Object.values(Sim.gensets());
      const f = Sim.fleet();
      const live = gs.filter((g) => g.status !== "standby");
      expect(f.total).toBe(gs.length);
      expect(f.running).toBe(live.length);
      expect(f.alarms).toBe(gs.filter((g) => g.status === "fault").length);
      expect(f.mw).toBeCloseTo(live.reduce((s, g) => s + g.tags.real_power.value, 0), 9);
    };
    ticks(Sim, 3); check();
    Sim.simulateFault(); ticks(Sim, C.FAULT_RAMP_S + 2); check();
    Sim.clearFault(); ticks(Sim, 2); check();
  });
});
