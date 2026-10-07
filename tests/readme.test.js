import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readJson } from "./helpers/load-module.js";

const DISCLAIMER =
  "This is an independent portfolio demonstration built with simulated data. It is not affiliated with, endorsed by, or connected to PROPWR, ProPetro, Caterpillar, or INNIO Waukesha. All telemetry values are generated for illustration only and do not represent any real equipment or installation. OEM names, models, and logos are referenced solely to illustrate a multi-vendor data-normalization concept.";
const norm = (s) => s.replace(/\s+/g, " ").trim();

function readme() {
  const p = path.join(ROOT, "README.md");
  expect(fs.existsSync(p), "README.md missing").toBe(true);
  return fs.readFileSync(p, "utf8");
}

describe("README", () => {
  it("README has run.sh steps, Pages link line, PWR5.7 note, disclaimer verbatim", () => {
    const md = readme();
    expect(md).toMatch(/git clone/);
    expect(md).toMatch(/run\.sh/);
    expect(md).toMatch(/GitHub Pages/i);
    expect(md).toMatch(/PWR5\.7/);
    expect(md).toMatch(/Taurus 60/);
    expect(norm(md)).toContain(norm(DISCLAIMER));
  });

  it("README lists every canonical tag from schema.json with both OEM raw names", () => {
    const md = readme();
    const schema = readJson("data/schema.json");
    for (const t of schema.tags) expect(md, `tag ${t.tag}`).toContain(t.tag);
    // a markdown table with a Caterpillar column and a Waukesha column
    const header = md.split("\n").find((l) => /^\|/.test(l) && /Caterpillar/.test(l) && /Waukesha/.test(l));
    expect(header, "mapping table header with Caterpillar and Waukesha columns").toBeDefined();
    expect(md).toMatch(/schema\.json/);
  });
});
