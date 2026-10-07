import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ROOT, readText } from "./helpers/load-module.js";

describe("GitHub Pages readiness", () => {
  it(".nojekyll exists and all local references are relative", () => {
    expect(fs.existsSync(path.join(ROOT, ".nojekyll")), ".nojekyll at repo root").toBe(true);

    const files = ["index.html", ...fs.readdirSync(path.join(ROOT, "js")).map((f) => "js/" + f)];
    const bad = [];
    for (const f of files) {
      const src = readText(f);
      const re = /(?:src|href)=["'](\/[^/"'][^"']*)["']|fetch\(\s*["'](\/[^/"'][^"']*)["']/g;
      let m;
      while ((m = re.exec(src))) bad.push(`${f}: ${m[1] || m[2]}`);
    }
    expect(bad, "root-absolute references break Pages subpaths").toEqual([]);

    // every external resource is https (Pages is https-only; mixed content is blocked)
    const external = [...readText("index.html").matchAll(/(?:src|href)=["'](https?:[^"']+)["']/g)].map((m) => m[1]);
    expect(external.length).toBeGreaterThan(0);
    for (const u of external) expect(u.startsWith("https://"), u).toBe(true);

    // the basemap must render on a deployed site with no API key: tile URL template is https and
    // not on a provider that now requires a key (CARTO basemaps, Stadia/Stamen, MapTiler, Mapbox, Thunderforest)
    const render = readText("js/render.js");
    const tile = /L\.tileLayer\(\s*["']([^"']+)["']/.exec(render);
    expect(tile, "L.tileLayer(<url template>) in js/render.js").not.toBeNull();
    expect(tile[1].startsWith("https://"), tile[1]).toBe(true);
    expect(tile[1]).not.toMatch(/cartocdn|basemaps\.cartocdn|stadiamaps|maptiler|mapbox|thunderforest|apikey|api_key|access_token/i);

    // README carries the Pages link line
    expect(readText("README.md")).toMatch(/github\.io\/genset-fleet-monitor/);
  });
});
