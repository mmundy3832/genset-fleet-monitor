import { describe, it, expect } from "vitest";
import { readText } from "./helpers/load-module.js";

describe("palette", () => {
  it("style.css contains no red color token", () => {
    // Comments are not color tokens; strip them before scanning.
    const css = readText("css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).toMatch(/--green:/);
    expect(css).toMatch(/--amber:/);
    const red = /\bred\b|#f00\b|#ff0000\b|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\)/i;
    const hit = css.match(red);
    expect(hit, hit ? `red token found: ${hit[0]}` : "").toBeNull();
  });
});
