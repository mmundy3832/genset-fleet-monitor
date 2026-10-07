# Genset Fleet Monitor

A static control-room demo of a simulated PROPWR natural gas genset fleet across Texas, built to show a versioned multi-OEM telemetry schema, edge-to-cloud visualization, and data-quality validation. Portfolio demo for the PROPWR IoT Software Engineer role (R-101078).

## Live demo

GitHub Pages: https://mmundy3832.github.io/genset-fleet-monitor/

## Run it locally

```bash
git clone https://github.com/mmundy3832/genset-fleet-monitor.git
cd genset-fleet-monitor
./run.sh
```

run.sh serves the folder on port 8080 (pass another port as the first argument) and opens a browser; set NO_BROWSER=1 to skip the browser. No build step, no runtime dependencies.

## What you are looking at

- Texas map with one pin per site; click a pin for the site panel
- Per-genset cards with gauges, sparklines, quality badges
- Simulate Fault pushes one random unit out of spec and its pin goes amber
- Clear Fault restores it
- Controls are monitor-only; activating them shows "Monitor only. Not permitted to change"
- Schema view shows the canonical tag table

## The schema is the product

data/schema.json is the single versioned source of truth. Every value on screen resolves through a canonical tag with an engineering unit and per-model ranges. Both OEM panels render from it. Validation raises a quality code (GOOD, OUT_OF_RANGE, ALARM, NOT_RUNNING) and logs an event when a value leaves its range.

| Canonical tag | Unit | Caterpillar (EMCP 4) | Waukesha (ESM) |
|---|---|---|---|
| engine_speed | rpm | Engine Speed | Engine RPM |
| real_power | MW | Generator Total Real Power | Gen kW |
| coolant_temp | degC | Engine Coolant Temperature | JW Temp |
| oil_pressure | kPa | Engine Oil Pressure | Oil Press |
| exhaust_temp | degC | Exhaust Temperature | Exh Temp (stack) |
| fuel_flow | scfh | Fuel Flow Rate (gas) | Fuel Flow |
| energy_total | MWh | Generator Total kW Hours Export | kWh Total |

Caterpillar EMCP 4 register names are sourced from the public EMCP 4 Modbus manual. Waukesha ESM names are engineering estimates pending the ESM manual; data/schema.json carries a provenance flag per entry and is canonical over this table.

## Fleet scope

Cat G3520 (PWR2.6-S stationary with SCR, PWR2.6-M mobile) and Waukesha 9394S5 rich burn (PWR2.0). Planned addition: PWR5.7 (Solar Taurus 60 gas turbine). Package ratings follow propwr.com; OEM engine data sheet ratings differ and are recorded in docs/research/operating-ranges.md.

## Project layout

- index.html
- data/schema.json
- data/sites.json
- js/simulation.js
- js/view.js
- js/render.js
- css/style.css
- run.sh
- tests/
- docs/prd.md
- docs/prd.feature-list.json
- docs/prd.feature-list.coverage.md
- docs/research/

## Process

Built from a PRD through a feature list with 100 percent acceptance-criteria coverage and a Plan, TestAuthor, Implement, Verify loop; tests are committed red before any production code. npm test runs them (vitest, dev dependency only).

## Disclaimer

This is an independent portfolio demonstration built with simulated data. It is not affiliated with, endorsed by, or connected to PROPWR, ProPetro, Caterpillar, or INNIO Waukesha. All telemetry values are generated for illustration only and do not represent any real equipment or installation. OEM names, models, and logos are referenced solely to illustrate a multi-vendor data-normalization concept.
