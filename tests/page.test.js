import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readText } from "./helpers/load-module.js";

// every .js file under a directory, recursively (js/twin/** is included)
function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? jsFiles(dir + "/" + e.name) : e.name.endsWith(".js") ? [dir + "/" + e.name] : []);
}

const DISCLAIMER =
  "This is an independent portfolio demonstration built with simulated data. It is not affiliated with, endorsed by, or connected to PROPWR, ProPetro, Caterpillar, or INNIO Waukesha. All telemetry values are generated for illustration only and do not represent any real equipment or installation. OEM names, models, and logos are referenced solely to illustrate a multi-vendor data-normalization concept.";
const norm = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function html() {
  const p = path.join(ROOT, "index.html");
  expect(fs.existsSync(p), "index.html missing").toBe(true);
  return fs.readFileSync(p, "utf8");
}
function render() {
  const p = path.join(ROOT, "js/render.js");
  expect(fs.existsSync(p), "js/render.js missing").toBe(true);
  return fs.readFileSync(p, "utf8");
}
// attribute value of the first tag carrying id="<id>"
function tagWithId(doc, id) {
  const m = new RegExp(`<[a-z]+[^>]*\\bid=["']${id}["'][^>]*>`, "i").exec(doc);
  return m ? m[0] : null;
}
const titleOf = (tag) => (/\btitle=["']([^"']*)["']/.exec(tag) || [])[1];

describe("index.html structure", () => {
  it("index.html references css/style.css, js/simulation.js, js/view.js, js/render.js and Leaflet", () => {
    const doc = html();
    expect(doc).toMatch(/<link[^>]+href=["']css\/style\.css["']/);
    for (const js of ["js/simulation.js", "js/view.js", "js/render.js"]) {
      expect(doc, js).toMatch(new RegExp(`<script[^>]+src=["']${js.replace(/[./]/g, "\\$&")}["']`));
    }
    expect(doc).toMatch(/leaflet(\.min)?\.js/);
    expect(doc).toMatch(/leaflet(\.min)?\.css/);
    // simulation and view load before render
    expect(doc.indexOf("js/simulation.js")).toBeLessThan(doc.indexOf("js/render.js"));
    expect(doc.indexOf("js/view.js")).toBeLessThan(doc.indexOf("js/render.js"));
  });

  it("index.html has map, panel, KPI, Simulate Fault, Clear Fault, Schema, toast and footer elements", () => {
    const doc = html();
    for (const id of ["map", "panel", "kpi-mw", "kpi-running", "kpi-alarms", "kpi-version", "toast", "schema-modal"]) {
      expect(tagWithId(doc, id), `element #${id}`).not.toBeNull();
    }
    for (const [id, label] of [["btn-fault", /simulate fault/i], ["btn-clear", /clear fault/i], ["btn-schema", /schema/i]]) {
      const tag = tagWithId(doc, id);
      expect(tag, `button #${id}`).not.toBeNull();
      expect(tag.startsWith("<button"), `#${id} is a <button>`).toBe(true);
      const title = titleOf(tag);
      expect(title && title.trim().length > 8, `#${id} needs a title attribute with hover help`).toBe(true);
      const inner = new RegExp(`id=["']${id}["'][^>]*>([^<]*)<`).exec(doc);
      expect(inner && inner[1], `#${id} label`).toMatch(label);
    }
    expect(doc).toMatch(/<footer[\s>]/);
    const r = render();
    for (const fn of ["View.pinClass", "View.formatKpis", "View.gaugeArc", "View.sparklinePoints", "View.schemaRows", "View.controlGuard", "Sim.simulateFault", "Sim.clearFault", "Sim.tick"]) {
      expect(r, `render.js uses ${fn}`).toContain(fn);
    }
    expect(r, "1 s update loop").toMatch(/setInterval\([^)]*1000\)/);
    // card controls are built in render.js and must carry hover help explaining monitor-only
    expect(r).toMatch(/title=/);
    expect(r).toMatch(/[Mm]onitor only/);
  });

  it("footer contains the disclaimer verbatim", () => {
    const doc = html();
    const footer = /<footer[\s\S]*?<\/footer>/i.exec(doc);
    expect(footer, "footer element").not.toBeNull();
    expect(norm(footer[0])).toContain(norm(DISCLAIMER));
  });

  it("no root-absolute local paths in index.html or js/", () => {
    html(); render();
    const files = ["index.html", ...jsFiles("js")];
    const bad = [];
    for (const f of files) {
      const src = readText(f);
      const re = /(?:src|href)=["'](\/[^/"'][^"']*)["']|fetch\(\s*["'](\/[^/"'][^"']*)["']/g;
      let m;
      while ((m = re.exec(src))) bad.push(`${f}: ${m[1] || m[2]}`);
    }
    expect(bad, "root-absolute references break GitHub Pages subpaths").toEqual([]);
    expect(fs.existsSync(path.join(ROOT, ".nojekyll"))).toBe(true);
  });
});

describe("3D twin DOM contract", () => {
  it("index.html has #twin, twin.css, the three import map and the twin module script", () => {
    const doc = html();
    const twin = tagWithId(doc, "twin");
    expect(twin, "#twin").not.toBeNull();
    expect(twin).toMatch(/\bhidden\b/);
    expect(doc).toMatch(/<link[^>]+href=["']css\/twin\.css["']/);
    expect(doc).toMatch(/<script type="importmap">[\s\S]*three@0\.187\.0\/build\/three\.module\.js[\s\S]*three@0\.187\.0\/examples\/jsm\/[\s\S]*<\/script>/);
    expect(doc).toMatch(/<script[^>]+type=["']module["'][^>]+src=["']js\/twin\/main\.js["']/);
    expect(doc.indexOf("js/render.js")).toBeLessThan(doc.indexOf("js/twin/main.js"));
    expect(tagWithId(doc, "btn-theme")).not.toBeNull();
  });

  it("render.js exposes App and FleetMap", () => {
    const r = render();
    expect(r).toMatch(/window\.App\s*=/);
    expect(r).toMatch(/window\.FleetMap\s*=/);
    expect(r).toMatch(/World_Light_Gray_Base/);
  });
});
