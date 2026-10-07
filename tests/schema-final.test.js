import { describe, it, expect } from "vitest";
import { readJson, readText } from "./helpers/load-module.js";

const schema = readJson("data/schema.json");
const raw = readText("data/schema.json");
const research = readText("docs/research/operating-ranges.md");
const PROV = ["sourced", "estimate"];

function semverAtLeast(v, major, minor, patch) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  return a > major || (a === major && (b > minor || (b === minor && c >= patch)));
}

describe("schema.json final", () => {
  it("schema version >= 1.0.0 and no PLACEHOLDER strings", () => {
    expect(semverAtLeast(schema.version, 1, 0, 0), `version ${schema.version}`).toBe(true);
    expect(raw.includes("PLACEHOLDER"), "PLACEHOLDER present").toBe(false);
    expect(schema.status).toMatch(/docs\/research\/operating-ranges\.md/);
    // package ratings follow propwr.com, not OEM engine data sheets
    expect(schema.tags.find((t) => t.tag === "real_power").ranges.G3520.max).toBe(2.6);
    expect(schema.tags.find((t) => t.tag === "real_power").ranges["9394S5"].max).toBe(2.0);
  });

  it("every range and oem_source carries provenance sourced|estimate and every sourced raw name appears in docs/research/operating-ranges.md", () => {
    for (const t of schema.tags) {
      for (const [model, r] of Object.entries(t.ranges)) {
        expect(PROV, `${t.tag}.ranges.${model}.provenance`).toContain(r.provenance);
      }
      for (const [oem, src] of Object.entries(t.oem_source)) {
        expect(PROV, `${t.tag}.oem_source.${oem}.provenance`).toContain(src.provenance);
        expect(typeof src.name, `${t.tag}.oem_source.${oem}.name`).toBe("string");
        if (src.provenance === "sourced") {
          expect(research.includes(src.name), `${t.tag} ${oem} raw name "${src.name}" not in research doc`).toBe(true);
          if (src.register != null) {
            expect(research.includes(String(src.register)), `${t.tag} ${oem} register "${src.register}" not in research doc`).toBe(true);
          }
        }
      }
    }
    // at least one sourced entry exists (the EMCP 4 map is sourced) and at least one estimate is honest
    const all = schema.tags.flatMap((t) => Object.values(t.oem_source).map((s) => s.provenance));
    expect(all).toContain("sourced");
    expect(all).toContain("estimate");
  });
});
