import { describe, it, expect } from "vitest";
import { loadSim } from "./helpers/load-module.js";

describe("Sim.siteSummary", () => {
  it("hospital totals match asset values", () => {
    const { Sim } = loadSim();
    const s = Sim.siteSummary("bigspring-hosp");
    const run = ["BSRM-01", "BSRM-02", "BSRM-03"].map((id) => Sim.asset(id));
    expect(s.customer).toBe("Caprock Regional Medical Center");
    expect(s.type).toBe("hospital");
    expect(s.redundancy).toBe("N+1");
    expect(s.running).toBe(3);
    expect(s.standby).toBe(1);
    expect(s.alarms).toBe(0);
    expect(s.inService).toBe(0);
    expect(s.installedMw).toBeCloseTo(10.4, 9);
    expect(s.onlineMw).toBeCloseTo(7.8, 9);
    expect(s.outputMw).toBeCloseTo(run.reduce((a, g) => a + g.tags.real_power.value, 0), 9);
    expect(s.outputMw).toBeGreaterThan(4.2);
    expect(s.outputMw).toBeLessThan(4.8);
    expect(s.spareMw).toBeCloseTo(s.installedMw - s.outputMw, 9);
  });

  it("battery SOC and ride-through = MWh x SOC / output", () => {
    const { Sim } = loadSim();
    const s = Sim.siteSummary("bigspring-hosp");
    const bs = [Sim.asset("BSRM-B1"), Sim.asset("BSRM-B2")];
    expect(s.bess.count).toBe(2);
    expect(s.bess.mwh).toBe(10);
    const soc = (bs[0].tags.soc.value + bs[1].tags.soc.value) / 2;
    expect(s.bess.socPct).toBeCloseTo(soc, 9);
    const stored = bs.reduce((a, b) => a + 5 * b.tags.soc.value / 100, 0);
    expect(s.bess.rideThroughMin).toBeCloseTo(stored / s.outputMw * 60, 6);
    expect(s.bess.rideThroughMin).toBeGreaterThan(60);
  });

  it("midwest campus and sites without storage", () => {
    const { Sim } = loadSim();
    const m = Sim.siteSummary("midwest-dc");
    expect(m.running).toBe(25);
    expect(m.standby).toBe(3);
    expect(m.installedMw).toBeCloseTo(72.8, 9);
    expect(m.onlineMw).toBeCloseTo(65, 9);
    expect(m.outputMw).toBeGreaterThan(55);
    expect(m.bess.count).toBe(6);
    expect(m.bess.mwh).toBe(30);
    const o = Sim.siteSummary("odessa-dc");
    expect(o.bess).toEqual({ count: 0, mwh: 0, socPct: null, rideThroughMin: null });
    expect(Sim.siteSummary("nope")).toBeNull();
  });

  it("work orders in the last 90 days count against the service as-of date", () => {
    const { Sim, service } = loadSim();
    const s = Sim.siteSummary("bigspring-hosp");
    let wo = 0, un = 0;
    const cutoff = Date.parse(service.asOf) - 90 * 86400000;
    for (const a of Sim.assets("bigspring-hosp")) for (const r of service.records[a.id]) {
      if (Date.parse(r.date) >= cutoff) { wo++; if (r.type === "unscheduled") un++; }
    }
    expect(s.workOrders90d).toBe(wo);
    expect(s.unscheduled90d).toBe(un);
    expect(wo).toBeGreaterThan(0);
    expect(Sim.siteServiceRecords("bigspring-hosp", 5).length).toBe(5);
    const all = Sim.siteServiceRecords("bigspring-hosp");
    for (let i = 1; i < all.length; i++) expect(all[i - 1].date >= all[i].date).toBe(true);
  });
});

describe("nextService", () => {
  it("nextDuePoint walks the interval grid", () => {
    const { Sim } = loadSim();
    const n = Sim.nextDuePoint;
    expect(n(11482, 1500, 0)).toBe(12000);
    expect(n(11482, 3000, 500)).toBe(12500);
    expect(n(100, 3000, 500)).toBe(500);
    expect(n(500, 3000, 500)).toBe(3500);
    expect(n(0, 1500, 0)).toBe(1500);
    expect(n(3000, 1500, 0)).toBe(4500);
  });

  it("BSRM-02 next service is the oil change at 12,000 h", () => {
    const { Sim } = loadSim();
    const g = Sim.asset("BSRM-02");
    expect(g.nextService.task).toMatch(/Oil and filter change/);
    expect(g.nextService.dueInH).toBeCloseTo(518, 0);
    const due = Sim.dueList("BSRM-02");
    expect(due.map((d) => d.dueAtH)).toEqual([12000, 12000, 12000, 12500, 13000, 16000].sort((a, b) => a - b));
    for (let i = 1; i < due.length; i++) expect(due[i].dueInH).toBeGreaterThanOrEqual(due[i - 1].dueInH);
  });

  it("SCR inspection applies to PWR2.6-S only, batteries are due on a calendar", () => {
    const { Sim } = loadSim();
    expect(Sim.dueList("BSRM-02").some((d) => d.id === "scr")).toBe(true);
    expect(Sim.dueList("SP14-01").some((d) => d.id === "scr")).toBe(false);
    const b = Sim.dueList("MWH-B1");
    expect(b.length).toBe(1);
    expect(b[0].dueInH).toBeGreaterThan(0);
    expect(b[0].dueInH).toBeLessThanOrEqual(91 * 24);
  });

  it("serviceRecords returns the asset history or an empty list", () => {
    const { Sim } = loadSim();
    expect(Sim.serviceRecords("BSRM-02")[0].wo).toBe("WO-20418");
    expect(Sim.serviceRecords("nope")).toEqual([]);
    const { Sim: bare } = loadSim({ service: null });
    expect(bare.serviceRecords("BSRM-02")).toEqual([]);
    expect(bare.asset("BSRM-02").nextService).toBeNull();
  });
});
