# Development plan — feature queue

Features are built **in this order** (the spec's Development priority table, `docs/spec/70-priority.md`).
"Verify" = feature exists in v0.10.0: add spec tests and fill gaps. "Build" = new.
A feature never starts before the features it reads/writes are done.

Status values: `todo` · `in-progress` · `done` (with PR link) · `skipped` (with reason).

| # | Spec ID | Feature | Imp. | Kind | Status | PR |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | — | Test foundation: provisioning, deterministic fixture, e2e harness, router | — | Build | done | [PR 1](https://github.com/ArielShaharabani/clickhouse-observe-grafana/pull/1) |
| 1 | SHARED-STATE-01/02 | Shared search context + URL state | 5 | Build | todo | |
| 2 | SHARED-AUTOCOMPLETE-01 | Autocomplete service | 5 | Build | todo | |
| 3 | DISC-SEARCH-02 | KQL bar + autocomplete | 5 | Verify | todo | |
| 4 | DISC-FILTER-01 | Filter pills (+ pin) | 5 | Verify | todo | |
| 5 | SHARED-ACTION-01 | Action registry | 5 | Build | todo | |
| 6 | DISC-SIDEBAR-02 | Field stats popover | 5 | Verify | todo | |
| 7 | DISC-TABLE-01/02 | Results grid + cell actions | 5 | Verify | todo | |
| 8 | DISC-SIDEBAR-01 | Field list | 4 | Verify | todo | |
| 9 | DISC-CHART-01 | Histogram + brush + series actions | 4 | Verify | todo | |
| 10 | DISC-DOC-01 | Document flyout | 4 | Verify | todo | |
| 11 | LENS-AUTO-01 / LENS-SUGG-01 | Lens page, auto chart, suggestions | 4 | Build | todo | |
| 12 | LENS-TYPE-01 | One-menu chart switching | 4 | Build | todo | |
| 13 | LENS-DIM-01/02 | Dimensions + metric editor | 4 | Build | todo | |
| 14 | LENS-INTERACT-01 | Click-to-filter + chooser | 4 | Build | todo | |
| 15 | LENS-INTERACT-02 / DISC-CHART-03 | Discover ↔ Lens handoff | 4 | Build | todo | |
| 16 | LENS-SAVE-01 | Save to dashboard | 4 | Build | todo | |
| 17 | DISC-TIME-01/02 | Time picker, Update state | 3 | Verify | todo | |
| 18 | DISC-CHART-02 | Breakdown + legend actions | 3 | Verify | todo | |
| 19 | DISC-FILTER-02 | Filter builder | 3 | Verify | todo | |
| 20 | DISC-DOC-02 | Surrounding documents | 3 | Build | todo | |
| 21 | DISC-PATTERNS-01 | Log patterns | 3 | Build | todo | |
| 22 | DISC-FIELDSTATS-01 | Field statistics tab | 3 | Build | todo | |
| 23 | LENS-DIM-03 | Formula editor | 3 | Build | todo | |
| 24 | LENS-DIM-04 | Top values editor | 3 | Build | todo | |
| 25 | SHARED-PERF-01 | Loading / sampling cues | 3 | Verify | todo | |
| 26 | LENS-CHART-01 | Table + Metric specifics | 2 | Build | todo | |
| 27 | LENS-STYLE-01 | Style + Legend panels | 2 | Build | todo | |
| 28 | LENS-LAYER-01 | Layers | 2 | Build | todo | |
| 29 | LENS-INSPECT-01 | Inspector (reuse Diagnostics) | 2 | Build | todo | |
| 30 | DISC-SEARCH-03 | Saved queries menu | 2 | Verify | todo | |
| 31 | DISC-NAV-01 | Session tabs | 2 | Build | todo | |
| 32 | DISC-SESSION-01 | Save / share / export | 2 | Verify | todo | |
| 33 | SHARED-A11Y-01 | Keyboard + accessibility | 2 | Verify | todo | |
| — | DISC-ESQL-01 | ES\|QL | 1 | — | skipped (out of scope: KQL/Lucene-style only) | |

## Per-feature loop
1. Branch `feat/<spec-id-lowercase>`; set status `in-progress`; update `PROGRESS.md`.
2. Restate the spec's acceptance criteria (`docs/spec/`) as a test list in `PROGRESS.md`.
3. Write tests first: jest unit/component, SQL-string tests for new queries, e2e in `tests/features/<spec-id>.spec.ts`.
4. Implement, reusing existing modules (`src/sql/*`, `src/data/runQuery.ts`, components).
5. Add/enable integration cases in `tests/integration/` for every interaction with done features (`TESTING.md` matrix).
6. Gates: `npm run typecheck && npm run lint && npm run test:ci && npm run build`, `npx playwright test`, `/code-review`, `/security-review` if SQL generation changed, autocomplete checklist (SHARED-AUTOCOMPLETE-01).
7. CHANGELOG `[Unreleased]` entry + version bump (`package.json` and `src/plugin.json`), update PLAN/PROGRESS/TESTING, push, PR, merge when green, pull `master`.
