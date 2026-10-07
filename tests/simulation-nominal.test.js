import { describe, it, expect } from "vitest";
import { loadSim } from "./helpers/load-module.js";

const TICKS = 300;
const BAND = 0.005; // 0.5 percent

function run(sim, n) { for (let i = 0; i < n; i++) sim.tick(true); }

describe("simulation nominal behavior", () => {
  it("running assets stay within 0.5 percent of nominal over 300 ticks", () => {
    const { Sim, schema } = loadSim();
    const running = Object.values(Sim.gensets()).filter((g) => g.status === "running");
    expect(running.length).toBeGreaterThan(0);
    const stats = {};
    for (const g of running) { stats[g.id] = {}; for (const td of schema.tags) if (!td.cumulative) stats[g.id][td.tag] = { min: Infinity, max: -Infinity, sum: 0 }; }
    for (let i = 0; i < TICKS; i++) {
      Sim.tick(true);
      for (const g of running) for (const [tag, s] of Object.entries(stats[g.id])) {
        const v = g.tags[tag].value; s.min = Math.min(s.min, v); s.max = Math.max(s.max, v); s.sum += v;
      }
    }
    for (const g of running) {
      expect(g.status, `${g.id} status`).toBe("running");
      for (const [tag, s] of Object.entries(stats[g.id])) {
        const mean = s.sum / TICKS;
        expect(mean, `${g.id} ${tag} mean`).toBeGreaterThan(0);
        expect((s.max - mean) / mean, `${g.id} ${tag} above mean`).toBeLessThanOrEqual(BAND);
        expect((mean - s.min) / mean, `${g.id} ${tag} below mean`).toBeLessThanOrEqual(BAND);
        expect(g.tags[tag].quality, `${g.id} ${tag} quality`).toBe("GOOD");
      }
      const rpm = schema.tags.find((t) => t.tag === "engine_speed").ranges[g.model].nominal;
      const rpmMean = stats[g.id].engine_speed.sum / TICKS;
      expect(Math.abs(rpmMean - rpm) / rpm, `${g.id} rpm vs nominal`).toBeLessThanOrEqual(BAND);
      const mwMean = stats[g.id].real_power.sum / TICKS;
      const mwNominal = g.ratingMw * g.load;
      expect(Math.abs(mwMean - mwNominal) / mwNominal, `${g.id} MW vs rating*load`).toBeLessThanOrEqual(BAND);
    }
  });

  it("standby assets report zero speed and power with NOT_RUNNING", () => {
    const { Sim, schema } = loadSim();
    run(Sim, 20);
    const standby = Object.values(Sim.gensets()).filter((g) => g.status === "standby");
    expect(standby.length).toBeGreaterThan(0);
    for (const g of standby) {
      expect(g.tags.engine_speed.value).toBe(0);
      expect(g.tags.real_power.value).toBe(0);
      for (const td of schema.tags) expect(g.tags[td.tag].quality, `${g.id} ${td.tag}`).toBe("NOT_RUNNING");
    }
  });

  it("energy_total integrates real_power per tick and holds on standby", () => {
    const { Sim } = loadSim();
    const gs = Object.values(Sim.gensets());
    const running = gs.filter((g) => g.status === "running");
    const standby = gs.filter((g) => g.status === "standby");
    for (let i = 0; i < 10; i++) {
      const before = Object.fromEntries(gs.map((g) => [g.id, g.tags.energy_total.value]));
      Sim.tick(true);
      for (const g of running) {
        const delta = g.tags.energy_total.value - before[g.id];
        expect(delta, `${g.id} energy delta`).toBeGreaterThan(0);
        expect(delta).toBeCloseTo(g.tags.real_power.value / 3600, 9);
      }
      for (const g of standby) expect(g.tags.energy_total.value, `${g.id} standby energy`).toBe(before[g.id]);
    }
  });
});
