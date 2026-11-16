import { describe, it, expect } from "vitest";
import { readText } from "./helpers/load-module.js";

function block(css, selector) {
  const i = css.indexOf(selector + " {");
  return css.slice(i, css.indexOf("}", i));
}

describe("palette", () => {
  const css = readText("css/style.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const dark = block(css, ":root");
  const light = block(css, ':root[data-theme="light"]');

  it("alarm token is red in both themes", () => {
    expect(dark).toMatch(/--alarm:\s*#ff5247;/i);
    expect(light).toMatch(/--alarm:\s*#d92d20;/i);
    expect(dark).toMatch(/--alarm-text:/);
    expect(light).toMatch(/--alarm-text:/);
  });

  it("warning token is amber and stays distinct from alarm", () => {
    expect(dark).toMatch(/--warning:\s*#f5a623;/i);
    expect(light).toMatch(/--warning:/);
    expect(css).not.toMatch(/--amber:/);
  });

  it("fault and alarm status uses the alarm token, not warning", () => {
    expect(css).toMatch(/\.glyph\.fault\s*\{\s*fill:\s*var\(--alarm\)/);
    expect(css).toMatch(/\.chip\.fault\s*\{\s*color:\s*var\(--alarm-text\)/);
    expect(css).toMatch(/\.pin\.fault \.dot\s*\{\s*background:\s*var\(--alarm\)/);
  });
});
