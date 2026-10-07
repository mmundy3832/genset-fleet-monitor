# PRD: PROPWR Genset Monitoring Portfolio Demo

Status: Approved 2026-10-07 (Mark). Written in a claude.ai project session; pasted into Code unchanged except for markdown headings, then section 11 added in Code to make the PRD auditable.

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

## 11. Acceptance criteria

Added in Code 2026-10-07 so the feature list can be audited. Criteria marked "Manual verification only" are checked by opening the site in a browser via run.sh.

- AC-1: data/schema.json has a top-level semver "version" string, and every tag entry has "tag", "unit", "decimals", a "ranges" object with an entry for every model in sites.json (G3520 and 9394S5) carrying the keys nominal, min, max, alarm_lo, alarm_hi, and an "oem_source" object with an entry for both Caterpillar and Waukesha carrying "name".
- AC-2: data/sites.json is internally consistent: every genset's "unit" exists in "units", every unit's "model" exists in "models", every site has id, name, type, lat, lon, and gensets, every genset has id, unit, serial, status in {running, standby}, and load in [0, 1], and every serial starts with "SIM-".
- AC-3: With no fault active, every running asset's non-cumulative tag values stay within 0.5 percent of their nominal value across 300 consecutive ticks, and every standby asset reports engine_speed 0, real_power 0, and quality NOT_RUNNING on all tags.
- AC-4: Validation classifies a value against the asset model's schema ranges: beyond alarm_hi or below alarm_lo is ALARM, between max and alarm_hi (or min and alarm_lo) is OUT_OF_RANGE, within [min, max] is GOOD. Every transition into OUT_OF_RANGE or ALARM, and every return to GOOD, appends an event with kind, gensetId, tag, and a timestamp to the event log.
- AC-5: simulateFault selects one running asset and one fault scenario; within FAULT_RAMP_S plus 2 ticks that asset's status is "fault", its site status is "fault", and every other asset remains "running" or "standby" with all tags GOOD or NOT_RUNNING. clearFault returns the asset to "running" with all tags GOOD within 5 ticks and logs a CLEARED event. Over 20 simulate/clear cycles at least 2 distinct assets are selected.
- AC-6: fleet() returns mw equal to the sum of real_power over non-standby assets, running equal to the count of non-standby assets, alarms equal to the count of assets in "fault", and total equal to the asset count.
- AC-7: energy_total increases on every tick for a running asset by real_power / 3600 (MW to MWh per second) and does not change for a standby asset.
- AC-8: The map shows one pin per site over a dark Texas basemap; a pin's CSS class is derived from site status (running, standby, fault) by a pure function; clicking a pin selects that site and opens its panel. Manual verification only: the basemap, glow, and click-to-zoom transition are visual browser behavior.
- AC-9: The header shows total generation in MW to one decimal, running count over total count, alarm count, and the schema version, computed by a pure formatter from fleet() and schema.version.
- AC-10: Each genset card shows an OEM badge (logo or wordmark per docs/research/brand-and-specs.md), the PROPWR unit name, model, serial, and a status dot; two radial gauges for engine_speed and real_power whose arc fraction is a pure clamp of (value - min) / (max - min) to [0, 1]; a tag table with canonical name, value, unit, quality badge, and a sparkline whose points are a pure function of the history buffer; and an alarm banner when the asset is in "fault". Manual verification only: gauge sweep animation and pulsing status dot are visual browser behavior.
- AC-11: Start, Stop, and Load setpoint controls are present on every card. Activating any of them shows the toast "Monitor only. Not permitted to change." and changes no simulation state; the guard is a pure function that returns the message and never calls a Sim mutator.
- AC-12: A Schema view, opened from the header, lists every canonical tag with its unit, ranges per model, and the raw OEM source name for Caterpillar and Waukesha, built from schema.json at runtime by a pure row-builder that returns exactly one row per tag.
- AC-13: css/style.css uses green for healthy and amber for alarm and contains no red color token (no "red", "#f00", "#ff0000", or "rgb(255, 0, 0)").
- AC-14: README.md states what the demo is, gives clone-and-run steps using run.sh, has a GitHub Pages link line, explains the schema and lists every canonical tag with both OEM raw names, notes PWR5.7 (Solar Taurus 60) as a planned addition, and contains the section 10 disclaimer verbatim.
- AC-15: index.html renders the section 10 disclaimer verbatim in the footer.
- AC-16: run.sh is executable, passes "bash -n", and when started with NO_BROWSER=1 and a port argument serves index.html with HTTP 200 on that port within 3 seconds.
- AC-17: index.html loads in a browser with no console errors and the map, header KPIs, and panel render. Manual verification only: requires a browser session.
- AC-18: Values update once per second with gentle jitter, gauges sweep to new values, and the status dot pulses. Manual verification only: motion is visual browser behavior.
- AC-19: The site works under a GitHub Pages subpath: .nojekyll exists at the repo root and every local asset and data reference in index.html and the JS files is relative (no leading slash).
- AC-20: sites.json contains at least two sites of type "data center", at least two of type "drill head" located within 1.0 degree of Midland (31.9973, -102.0779), and at least one of type "hospital".
- AC-21: sites.json uses only the units PWR2.6-S, PWR2.6-M, and PWR2.0 and only the models G3520 and 9394S5.
- AC-22: schema.json version is 1.0.0 or later and contains no "PLACEHOLDER" strings. Every range limit and raw OEM name carries a "provenance" value of "sourced" or "estimate" that traces to docs/research/operating-ranges.md, and the Schema view shows that provenance per cell. Package ratings (2.6 and 2.0 MWe) follow propwr.com, not the OEM engine data sheets; the research doc records the difference.
