# PRD: PROPWR Genset Monitoring Portfolio Demo

Written 2026-10-07 in a claude.ai project session. Pasted into Code unchanged except for markdown headings.

## 1. Goal & Context

A portfolio demo for the PROPWR IoT Software Engineer role (R-101078, Tomball, TX). It presents a control-room-style monitoring dashboard for a simulated fleet of PROPWR gensets across Texas. Purpose: visibly demonstrate the posting's core responsibilities: owning/versioning an asset & datastream schema, standardizing tag names and engineering units across OEMs, edge-to-cloud telemetry visualization, and data-quality validation.

Constraints: Static site (HTML/CSS/JS, no backend, no build step). Deployable to GitHub Pages for an instant public link, and clone-and-run locally via a one-line script. Target: complete and shareable today.

## 2. Architecture / File Structure

Plain static files, no framework, no build step. Split into clean, inspectable files (the structure is itself part of the portfolio):

- index.html: entry point
- /data/schema.json: canonical tag definitions (first-class versioned artifact)
- /data/sites.json: sites and installed gensets
- /js/simulation.js: telemetry generation, wobble, fault logic
- /js/render.js: map + panel rendering, gauges, sparklines
- /css/: dark control-room styling
- README.md: overview, clone-and-run instructions, disclaimer
- run.sh: one-line local launch (serve + open browser)

## 3. Data Model (three layers)

Site: id, name, type (data center | drill head | hospital), latitude, longitude, list of genset ids.

Genset (asset): serial number (faked), OEM (Caterpillar | Waukesha), model (G3520 | 9394S5), PROPWR unit name (PWR2.6-S | PWR2.6-M | PWR2.0), status (running | standby | fault), nominal power rating.

Live telemetry (per genset): stream of tags. Each tag has a canonical name, engineering unit, and value. Tags: RPM, real power output (MW), coolant temp, oil pressure, exhaust temp, fuel flow, running energy total. Both OEM types reference the same canonical tag definitions from schema.json.

## 4. Schema (the differentiator, make it visible)

Canonical tag definitions live in schema.json with a version field, tag name, engineering unit, and nominal/min/max range. Single source of truth both OEM panels render from.

OEM name mapping: each canonical tag shows the raw OEM source name (Cat vs. Waukesha) mapped to the standardized canonical name. Expose this mapping in a small in-app "Schema" view and in the README.

Data-quality validation: when a value leaves its defined range, flag it as a validation event (bad quality / out of range), not just a color change.

## 5. UI / Look & Feel

Dark control-room (SCADA/NOC) aesthetic. Slate background; green = healthy, amber = alarm (no red).

Texas map overview: dark-themed Texas; glowing pins colored by status; live total generation across all online units + count running; one amber fault pin draws the eye. Click a pin to zoom/transition into that site.

Per-site / per-genset panel: radial gauges/arc meters for marquee values (RPM, MW) that sweep as values move; trend sparklines beneath; OEM logo + faked serial + model in the header. Subtle live motion (1s updates, gentle jitter, pulsing status dot).

Monitor-only guardrail: controls are visibly present but trigger a "Monitor only. Not permitted to change" message when used.

## 6. Behavior

Nominal: values sit steady with tiny wobble (tenths of a percent around nominal). Reads as a healthy machine, not an RNG.

Simulate Fault button: picks one genset at random, pushes it out of spec. Its site pin goes amber on the map with a pulse/buzz; alarm shows in its panel; others stay green.

Clear Fault button: returns it to green/nominal.

Repeat simulate: a different random unit faults.

## 7. Fleet Scope (use only units with sourceable specs)

- Caterpillar G3520 gas recip: PWR2.6-S, PWR2.6-M
- Waukesha 9394S5 rich burn: PWR2.0
- Solar Taurus 60 turbine (PWR5.7) excluded from v1; note in README as planned addition.

Example sites: a couple of data centers; drill heads near Midland-Odessa; a hospital.

## 8. Research Tasks (dispatch an agent in Code)

1. Realistic operating ranges for Cat G3520 and Waukesha 9394S5: RPM, output (MW), coolant temp, oil pressure, exhaust temp, fuel flow. Populate schema.json ranges.
2. OEM logos (Caterpillar, Waukesha) and PROPWR unit specs/power ratings.

## 9. Delivery

- Static files, no build step.
- run.sh: one-line clone-and-run (launch local server + open browser).
- Full README: what it is, clone-and-run steps, GitHub Pages link, schema explanation, disclaimer.
- Enable GitHub Pages for an instant public URL.

## 10. Disclaimer (footer + README)

This is an independent portfolio demonstration built with simulated data. It is not affiliated with, endorsed by, or connected to PROPWR, ProPetro, Caterpillar, or INNIO Waukesha. All telemetry values are generated for illustration only and do not represent any real equipment or installation. OEM names, models, and logos are referenced solely to illustrate a multi-vendor data-normalization concept.
