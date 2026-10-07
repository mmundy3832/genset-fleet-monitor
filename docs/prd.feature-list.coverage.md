# Feature List Coverage Report

**Feature list:** `docs/prd.feature-list.json`
**PRD:** `docs/prd.md`
**Audited at:** 2026-10-07T17:57:36Z
**Coverage:** 100% (22 of 22 ACs covered)
**PIV recommendation:** PASS

## Summary

| Category | Count |
| --- | --- |
| ACs total | 22 |
| ACs covered (planned test) | 22 |
| ACs covered (valid waiver) | 0 |
| ACs with gaps | 0 |
| Invalid waivers | 0 |
| Orphan AC references | 0 |

## Dependency graph

Max width 6, critical path 4 tasks. Workspace: not needed.
Cycles / dangling dependencies (either one = BLOCK): none
Unjustified dependencies (no `dependency_reasons` entry): none

## Coverage map

| AC | Covered by | How |
| --- | --- | --- |
| AC-1 | task-001 | test |
| AC-2 | task-001 | test |
| AC-3 | task-003 | test |
| AC-4 | task-004 | test |
| AC-5 | task-005 | test |
| AC-6 | task-005 | test |
| AC-7 | task-003 | test |
| AC-8 | task-006, task-007 | test |
| AC-9 | task-006 | test |
| AC-10 | task-006, task-007 | test |
| AC-11 | task-006, task-007 | test |
| AC-12 | task-006, task-007 | test |
| AC-13 | task-008 | test |
| AC-14 | task-010 | test |
| AC-15 | task-007 | test |
| AC-16 | task-009 | test |
| AC-17 | task-007 | test |
| AC-18 | task-007 | test |
| AC-19 | task-007, task-012 | test |
| AC-20 | task-001 | test |
| AC-21 | task-001 | test |
| AC-22 | task-006, task-007, task-011 | test |

## Gaps

None.

## Invalid waivers

None. task-002 uses the synthetic infrastructure waiver convention (ac_id 0, token checked against the task description).

## Orphan AC references

None.

## Recommendations to author

- Six ACs carry Manual verification only callouts (8, 10, 17, 18 in part). They count as covered through the pure-logic and static-structure tests on task-006 and task-007; the browser pass is recorded in task-007 result.notes.
- task-003, task-004, task-005 all edit js/simulation.js. They can run concurrently only if each confines its edit to new accessor functions; expect one merge to need a rebase.
- task-011 depends on docs/research/operating-ranges.md, which exists; its Waukesha names are estimates and must be flagged as such.

## Methodology

This report was produced by the `feature-list-audit` skill version 1.1. Coverage is structural: it confirms each AC has at least one task that names a test or holds a valid waiver. It does NOT verify that the named test actually exercises the AC's intent.
