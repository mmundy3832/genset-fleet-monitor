import { describe, it, expect } from "vitest";
import { readJson } from "./helpers/load-module.js";

const schema = readJson("data/schema.json");
const sites = readJson("data/sites.json");
const MODELS = Object.keys(sites.models);
const MIDLAND = { lat: 31.9973, lon: -102.0779 };
const dist = (a, b) => Math.hypot(a.lat - b.lat, a.lon - b.lon);

describe("schema.json", () => {
  it("schema has semver version and complete per-model ranges and oem_source", () => {
    expect(schema.version).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
    expect(schema.tags.length).toBeGreaterThan(0);
    for (const t of schema.tags) {
      expect(typeof t.tag, "tag").toBe("string");
      expect(typeof t.unit, `${t.tag} unit`).toBe("string");
      expect(Number.isInteger(t.decimals), `${t.tag} decimals`).toBe(true);
      for (const m of MODELS) {
        const r = t.ranges[m];
        expect(r, `${t.tag} ranges for ${m}`).toBeDefined();
        for (const k of ["nominal", "min", "max", "alarm_lo", "alarm_hi"]) {
          expect(k in r, `${t.tag}.ranges.${m}.${k}`).toBe(true);
        }
      }
      for (const oem of ["Caterpillar", "Waukesha"]) {
        expect(typeof t.oem_source?.[oem]?.name, `${t.tag} oem_source ${oem}`).toBe("string");
      }
    }
  });
});

describe("sites.json", () => {
  it("sites cross-reference units and models and use SIM- serials", () => {
    expect(sites.sites.length).toBeGreaterThan(0);
    for (const s of sites.sites) {
      for (const k of ["id", "name", "type", "lat", "lon", "gensets"]) expect(k in s, `${s.id} ${k}`).toBe(true);
      expect(typeof s.lat).toBe("number");
      expect(typeof s.lon).toBe("number");
      expect(s.gensets.length).toBeGreaterThan(0);
      for (const g of s.gensets) {
        for (const k of ["id", "unit", "serial", "status", "load"]) expect(k in g, `${g.id} ${k}`).toBe(true);
        const unit = sites.units[g.unit];
        expect(unit, `${g.id} unit ${g.unit} exists`).toBeDefined();
        expect(sites.models[unit.model], `${g.unit} model ${unit.model} exists`).toBeDefined();
        expect(["running", "standby"]).toContain(g.status);
        expect(g.load).toBeGreaterThanOrEqual(0);
        expect(g.load).toBeLessThanOrEqual(1);
        expect(g.serial.startsWith("SIM-"), `${g.id} serial ${g.serial}`).toBe(true);
      }
    }
    const ids = sites.sites.flatMap((s) => s.gensets.map((g) => g.id));
    expect(new Set(ids).size, "genset ids unique").toBe(ids.length);
  });

  it("sites include two data centers, two drill heads near Midland, one hospital", () => {
    const byType = (t) => sites.sites.filter((s) => s.type === t);
    expect(byType("data center").length).toBeGreaterThanOrEqual(2);
    expect(byType("hospital").length).toBeGreaterThanOrEqual(1);
    const nearMidland = byType("drill head").filter((s) => dist(s, MIDLAND) <= 1.0);
    expect(nearMidland.length, "drill heads within 1.0 degree of Midland").toBeGreaterThanOrEqual(2);
  });

  it("sites use only PWR2.6-S, PWR2.6-M, PWR2.0 and models G3520, 9394S5", () => {
    expect(Object.keys(sites.units).sort()).toEqual(["PWR2.0", "PWR2.6-M", "PWR2.6-S"]);
    expect(Object.keys(sites.models).sort()).toEqual(["9394S5", "G3520"]);
    for (const s of sites.sites) for (const g of s.gensets) expect(Object.keys(sites.units)).toContain(g.unit);
    for (const t of schema.tags) expect(Object.keys(t.ranges).sort()).toEqual(["9394S5", "G3520"]);
  });
});
