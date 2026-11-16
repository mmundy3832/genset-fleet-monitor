import { describe, it, expect } from "vitest";
import { readJson, readText } from "./helpers/load-module.js";

const sites = readJson("data/sites.json");
const service = readJson("data/service.json");
const schema = readJson("data/schema.json");
const assets = sites.sites.flatMap((s) => [...s.gensets, ...(s.bess || [])].map((a) => ({ ...a, siteId: s.id })));
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

describe("fleet data", () => {
  it("expected showcase fleet", () => {
    const site = (id) => sites.sites.find((s) => s.id === id);
    const h = site("bigspring-hosp");
    expect(h.customer).toBe("Caprock Regional Medical Center");
    expect(h.beds).toBe(400);
    expect(h.redundancy).toBe("N+1");
    expect(h.gensets.map((g) => g.id)).toEqual(["BSRM-01", "BSRM-02", "BSRM-03", "BSRM-04"]);
    expect(h.gensets.map((g) => g.status)).toEqual(["running", "running", "running", "standby"]);
    expect(h.bess.map((b) => b.id)).toEqual(["BSRM-B1", "BSRM-B2"]);
    const m = site("midwest-dc");
    expect(m.name).toBe("Midwest Hyperscale Campus");
    expect(m.redundancy).toBe("N+3");
    expect([m.lat, m.lon]).toEqual([41.26, -95.86]);
    expect(m.gensets.length).toBe(28);
    expect(m.gensets.filter((g) => g.status === "running").length).toBe(25);
    expect(m.bess.length).toBe(6);
    for (const s of sites.sites) expect(typeof s.customer, `${s.id} customer`).toBe("string");
    expect(assets.length).toBeGreaterThanOrEqual(40);
  });

  it("ids, asset numbers and serials are unique and serials keep the SIM- prefix", () => {
    for (const key of ["id", "assetNo", "serial"]) {
      const v = assets.map((a) => a[key]);
      expect(new Set(v).size, `${key} unique`).toBe(v.length);
    }
    for (const a of assets) expect(a.serial.startsWith("SIM-"), a.serial).toBe(true);
    for (const a of assets) {
      const re = a.unit === "PWR-BESS5" ? /^PW-BE-\d{4}$/ : a.unit === "PWR2.6-S" ? /^PW-26S-\d{4}$/ : a.unit === "PWR2.6-M" ? /^PW-26M-\d{4}$/ : /^PW-20M-\d{4}$/;
      expect(a.assetNo, a.id).toMatch(re);
    }
  });

  it("commissioning dates and hours are consistent", () => {
    for (const a of assets) {
      expect(a.commissioned >= "2025-06-01" && a.commissioned <= "2026-08-31", `${a.id} ${a.commissioned}`).toBe(true);
      const maxH = days(a.commissioned, "2026-11-16") * 24;
      expect(a.runHours, `${a.id} runHours`).toBeLessThanOrEqual(maxH);
      if (a.status === "running" && a.unit !== "PWR-BESS5") expect(a.runHours / maxH, `${a.id} duty`).toBeGreaterThan(0.85);
      if (a.status === "standby") expect(a.runHours / maxH, `${a.id} standby duty`).toBeLessThan(0.1);
    }
  });

  it("BSRM-02 keeps its fixture identity", () => {
    const g = assets.find((a) => a.id === "BSRM-02");
    expect(g).toMatchObject({ assetNo: "PW-26S-0147", serial: "SIM-CAT-7A3F21", commissioned: "2025-06-18", runHours: 11482, starts: 214 });
  });
});

describe("service.json", () => {
  it("every asset has records, newest first, hours never above runHours, unique WO numbers", () => {
    const wos = [];
    for (const a of assets) {
      const recs = service.records[a.id];
      expect(recs && recs.length, `${a.id} records`).toBeGreaterThan(0);
      for (let i = 1; i < recs.length; i++) expect(recs[i - 1].date >= recs[i].date, `${a.id} order`).toBe(true);
      for (const r of recs) {
        expect(r.wo).toMatch(/^WO-\d{5}$/);
        expect(["scheduled", "unscheduled"]).toContain(r.type);
        expect(r.tech).toMatch(/^[A-Z]{2}$/);
        expect(r.hours, `${a.id} ${r.wo} hours`).toBeLessThanOrEqual(a.runHours);
        expect(r.date >= a.commissioned && r.date <= service.asOf, `${a.id} ${r.wo} date`).toBe(true);
        wos.push(r.wo);
      }
      if (a.unit !== "PWR-BESS5") {
        const n = recs.filter((r) => r.type === "unscheduled").length;
        expect(n, `${a.id} unscheduled`).toBeGreaterThanOrEqual(1);
        expect(n, `${a.id} unscheduled`).toBeLessThanOrEqual(3);
      }
    }
    expect(new Set(wos).size).toBe(wos.length);
    expect(Object.keys(service.records).sort()).toEqual(assets.map((a) => a.id).sort());
  });

  it("scheduled genset records land on the maintenance grid", () => {
    const g = service.records["BSRM-02"];
    const oil = g.filter((r) => r.desc.startsWith("Oil and filter change"));
    for (const r of oil) expect(r.hours % 1500, r.wo).toBe(0);
  });

  it("BSRM-02 most recent records are the fixtures", () => {
    const r = service.records["BSRM-02"].slice(0, 4);
    expect(r.map((x) => [x.date, x.wo, x.type, x.hours])).toEqual([
      ["2026-10-06", "WO-20418", "scheduled", 10500],
      ["2026-08-25", "WO-20177", "scheduled", 9500],
      ["2026-08-04", "WO-19903", "scheduled", 9000],
      ["2026-07-15", "WO-19544", "unscheduled", 8512]
    ]);
    expect(r[0].desc).toMatch(/oil and filter change, oil sample/i);
    expect(r[1].desc).toMatch(/spark plugs replaced, valve lash set/i);
    expect(r[2].desc).toMatch(/oil and filter change, air filter/i);
    expect(r[3].desc).toMatch(/cyl 14 ignition coil replaced \(misfire\)/i);
  });

  it("batteries get quarterly inspections", () => {
    const r = service.records["MWH-B1"].filter((x) => x.type === "scheduled");
    expect(r.length).toBeGreaterThanOrEqual(1);
    for (const x of r) expect(x.desc).toMatch(/Quarterly inspection/);
  });
});

describe("schema 1.1 additions", () => {
  it("adds enclosure tags, battery tags and a battery fault scenario", () => {
    expect(schema.version).toBe("1.1.0");
    for (const t of ["enclosure_temp", "enclosure_humidity"]) expect(schema.tags.find((x) => x.tag === t), t).toBeDefined();
    const bt = Object.fromEntries(schema.bess_tags.map((t) => [t.tag, t]));
    for (const t of ["soc", "soh", "bess_power", "cell_temp_min", "cell_temp_max", "rack_voltage", "bess_humidity", "h2", "co", "hvac_state"]) expect(bt[t], t).toBeDefined();
    expect(bt.h2.ranges["PWR-BESS5"]).toMatchObject({ max: 10, alarm_hi: 25, provenance: "estimate" });
    expect(bt.co.ranges["PWR-BESS5"]).toMatchObject({ max: 25, alarm_hi: 100 });
    expect(bt.cell_temp_max.ranges["PWR-BESS5"].alarm_hi).toBe(45);
    expect(schema.fault_scenarios.some((s) => s.tag === "h2" && s.target === "bess")).toBe(true);
  });

  it("customer names are not marked undisclosed in the data", () => {
    expect(readText("data/sites.json").toLowerCase()).not.toContain("undisclosed");
  });
});
