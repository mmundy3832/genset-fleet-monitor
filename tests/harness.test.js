import { describe, it, expect } from "vitest";
import { loadModule, loadSim } from "./helpers/load-module.js";

describe("test harness", () => {
  it("loading js/simulation.js exposes Sim with init and tick", () => {
    const win = loadModule("js/simulation.js");
    expect(typeof win.Sim).toBe("object");
    expect(typeof win.Sim.init).toBe("function");
    expect(typeof win.Sim.tick).toBe("function");
  });

  it("loadSim initializes every asset from sites.json", () => {
    const { Sim, sites } = loadSim();
    const expected = sites.sites.reduce((n, s) => n + s.gensets.length, 0);
    expect(Object.keys(Sim.gensets()).length).toBe(expected);
  });
});
