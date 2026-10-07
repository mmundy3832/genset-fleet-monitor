# Handoff: Genset Fleet Monitor

Updated 2026-10-07 after the repo-local session. Read this, then docs/prd.md and
docs/prd.feature-list.json. The original build session lives in the second-brain
project history (session 725155f0-373b-4282-ba43-0aa96c913520) and is not visible from
this folder.

## State

- Complete for this version. 12 of 12 feature-list tasks passed and merged on main;
  feature-list status is "passed". Every coded task has a red commit before its green
  commit (git log --oneline shows the pairs).
- Test stack: vitest 5 as the only dev dependency. `npm test` runs 32 tests, 32 pass.
  The site itself has no build step and no runtime dependencies.
- Published: https://github.com/mmundy3832/genset-fleet-monitor (public), GitHub Pages
  from main at the root: https://mmundy3832.github.io/genset-fleet-monitor/
- Manual click-through (the PRD's "Manual verification only" criteria) done by Mark on
  the live site: panel and gauges, Simulate Fault and Clear Fault, control-button toast,
  Schema modal, hover tooltips, zoom labels. All 22 acceptance criteria are verified.

## How it was built

PRD (docs/prd.md, section 11 holds the 22 acceptance criteria) -> feature list
(docs/prd.feature-list.json, audited 100 percent, docs/prd.feature-list.coverage.md) ->
PIV loop via /piv-cloud: plan, red tests and verify in the orchestrator, Implement on
claude-haiku sub-agents (no escalation needed). Research inputs are in docs/research/.

## Resolved decisions

1. task-003 flaky bound. The test measures spread about the 300-tick sample mean; with
   WOBBLE_MAX at 0.003 that spread could reach 0.6 percent against a 0.5 percent band
   (1 failure in 12 runs). Fixed by setting WOBBLE_MAX to 0.002 in js/simulation.js
   (commit 987930d). The frozen test is unchanged; 40 of 40 runs green afterward.
2. Publish. Repo created under mmundy3832 as genset-fleet-monitor (keeps the PROPWR
   mark out of the URL), Pages enabled, README URLs filled in (commit a9d5640).

## Known limits

- Waukesha ESM raw tag names and all alarm setpoints are engineering estimates
  (docs/research/operating-ranges.md). The schema flags them provenance "estimate".
- Package ratings (2.6 and 2.0 MWe) follow propwr.com; OEM engine data sheets give
  1.97 and about 1.8 MWe. Recorded in the research doc.
- PWR5.7 (Solar Taurus 60) is deferred to a later version.
