import { describe, it, expect } from "vitest";
import { loadModule } from "./helpers/load-module.js";

const View = loadModule("js/view.js").View;

describe("View panel helpers", () => {
  it("statusGlyph pairs shape with word for every status", () => {
    expect(View.statusGlyph("running")).toMatchObject({ shape: "circle", label: "Running" });
    expect(View.statusGlyph("standby")).toMatchObject({ shape: "ring", label: "Standby" });
    expect(View.statusGlyph("fault")).toMatchObject({ shape: "triangle", label: "Alarm" });
    expect(View.statusGlyph("service")).toMatchObject({ shape: "square", label: "Service" });
    expect(View.statusGlyph("bogus").status).toBe("standby");
    expect(View.statusGlyphSvg("fault", 14)).toMatch(/^<svg class="glyph fault"[^>]*width="14"[\s\S]*<polygon/);
    expect(View.statusGlyphSvg("service")).toContain("<rect");
    expect(View.statusGlyphSvg("running")).not.toMatch(/red/i);
  });

  it("formatters", () => {
    expect(View.formatHours(11482)).toBe("11,482");
    expect(View.formatHours(999.6)).toBe("1,000");
    expect(View.formatHours(null)).toBe("--");
    expect(View.formatDue(518.4, "genset")).toBe("in 518 h");
    expect(View.formatDue(-40, "genset")).toBe("overdue by 40 h");
    expect(View.formatDue(24 * 30, "bess")).toBe("in 30 d");
    expect(View.formatRideThrough(107.2)).toBe("1 h 47 min");
    expect(View.formatRideThrough(25)).toBe("25 min");
    expect(View.formatRideThrough(null)).toBe("--");
  });

  it("assetRowValue", () => {
    const g = { kind: "genset", status: "running", tags: { real_power: { value: 2.394 } } };
    expect(View.assetRowValue(g)).toBe("2.39 MW");
    expect(View.assetRowValue({ ...g, status: "standby" })).toBe("standby");
    expect(View.assetRowValue({ kind: "bess", status: "running", tags: { soc: { value: 81.6 } } })).toBe("82% SOC");
  });

  it("tabs per mode and tab resolution", () => {
    expect(View.panelTabs(false)).toEqual(["Summary", "Assets", "Service", "Events"]);
    expect(View.panelTabs(true)).toEqual(["Overview", "Live data", "Service", "Events"]);
    expect(View.resolveTab(true, "Service")).toBe("Service");
    expect(View.resolveTab(true, "Summary")).toBe("Overview");
    expect(View.resolveTab(false, "Live data")).toBe("Summary");
  });

  it("selection store: site, asset, back, listeners", () => {
    const owner = { A1: "s1", B1: "s2" };
    const st = View.createSelectionStore((id) => owner[id] || null);
    const seen = [];
    st.onSelection((sel) => seen.push(sel.siteId + "/" + sel.assetId));
    st.selectSite("s1");
    st.selectSite("s1");            // no change, no event
    st.selectAsset("A1");
    st.selectAsset("B1");           // sets the site too
    st.selectAsset("zzz");          // unknown, ignored
    st.selectAsset(null);
    st.selectAsset(null);           // no change
    st.selectSite(null);
    expect(seen).toEqual(["s1/null", "s1/A1", "s2/B1", "s2/null", "null/null"]);
    expect(st.selection).toEqual({ siteId: null, assetId: null });
  });
});
