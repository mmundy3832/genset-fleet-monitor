# Handoff: Genset Fleet Monitor

Written 2026-10-07 at the end of the first PIV run. Read this, then docs/prd.md and
docs/prd.feature-list.json. The original build session lives in the second-brain
project history (session 725155f0-373b-4282-ba43-0aa96c913520) and is not visible from
this folder.

## State

- 12 of 12 feature-list tasks passed and merged on main. Every coded task has a red
  commit before its green commit (git log --oneline shows the pairs).
- Test stack: vitest 5 as the only dev dependency. `npm test` runs 32 tests. The site
  itself has no build step and no runtime dependencies.
- Run-end full suite: 31 of 32. The one failure is a flake (see Open decision 1), not a
  regression. Feature-list status is "partial" for that reason.
- Headless Chromium check on main: page loads with no console errors, Esri dark
  basemap renders, 6 site pins, KPIs populated, schema version 1.0.0.
- No git remote yet. README carries an OWNER placeholder in the Pages URL.

## How it was built

PRD (docs/prd.md, section 11 holds the 22 acceptance criteria) -> feature list
(docs/prd.feature-list.json, audited 100 percent, docs/prd.feature-list.coverage.md) ->
PIV loop via /piv-cloud: plan, red tests and verify in the orchestrator, Implement on
claude-haiku sub-agents (no escalation needed). Research inputs are in docs/research/.

## Open decision 1: task-003 flaky bound (do this first)

tests/simulation-nominal.test.js "running assets stay within 0.5 percent of nominal"
failed 1 of 12 runs. The test measures spread about the 300-tick sample mean; the
simulator bounds its random walk at WOBBLE_MAX = 0.003 of nominal, so spread about the
mean can reach 0.6 percent.

- o1 (recommended): set WOBBLE_MAX to 0.002 in js/simulation.js. Production-only
  change; frozen test stays valid. Re-run task-003 through the loop:
  `/piv-cloud docs/prd.feature-list.json phase-1 task-003` (flat list: pass any phase id).
- o2: expose Sim.nominal(gensetId, tag) and measure against true nominal. Touches
  production and a frozen test; needs a new red commit.

## Open decision 2: publish

Repo name used locally: genset-fleet-monitor (keeps the PROPWR mark out of the URL).
Steps once Mark names the GitHub owner/repo:

    gh repo create <owner>/genset-fleet-monitor --public --source . --push
    gh api -X POST repos/<owner>/genset-fleet-monitor/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
    sed -i 's#OWNER#<owner>#g' README.md && git commit -am "README: Pages URL" && git push

Then re-run `npm test` (readme test checks the Pages line) and open the Pages URL.

## Manual click-through still owed (PRD marks these Manual verification only)

1. `./run.sh`, click a pin: panel opens, map flies to the site, cards show gauges,
   sparklines, quality badges, OEM wordmark badges.
2. Simulate Fault: one pin turns amber and buzzes, its card shows the alarm banner,
   the event log shows the ALARM entry. Clear Fault returns it to green.
3. Start / Stop / Load setpoint on a card: toast "Monitor only. Not permitted to
   change." and no state change.
4. Schema button: modal with one row per tag, both OEM raw names, "estimate" badges
   on Waukesha entries and fuel_flow.
5. Hover help: every button shows a title tooltip.
6. Zoom in past level 7: site labels become permanent; zoom out: hover only.

## Known limits

- Waukesha ESM raw tag names and all alarm setpoints are engineering estimates
  (docs/research/operating-ranges.md). The schema flags them provenance "estimate".
- Package ratings (2.6 and 2.0 MWe) follow propwr.com; OEM engine data sheets give
  1.97 and about 1.8 MWe. Recorded in the research doc.
- PWR5.7 (Solar Taurus 60) is deferred to a later version.
