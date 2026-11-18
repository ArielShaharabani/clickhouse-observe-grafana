# Testing

## Run everything
```bash
docker compose up -d --build grafana clickhouse      # stack (see PROGRESS.md env notes)
npm run typecheck && npm run lint && npm run test:ci && npm run build
npx playwright test                                   # e2e + integration, needs the stack and a fresh `npm run build`
                                                      # (1 worker, 1 retry, 15 s expect timeout locally: the stack shares a small Docker VM; retried tests show as "flaky")
```

## Layers
| Layer | Where | What |
| --- | --- | --- |
| Unit | `src/**/__tests__/` (jest, jsdom, `@swc/jest`) | Pure SQL-string tests, reducers/stores, Lens `suggest`/`compile` fixtures. Mock queries with `jest.mock('../../data/runQuery')`. |
| Component | `src/**/__tests__/*.test.tsx` (Testing Library) | Each UI feature's acceptance checks. |
| E2E per feature | `tests/features/<spec-id>.spec.ts` | `@grafana/plugin-e2e`; follow `.config/AGENTS/e2e-testing.md`. Use `tests/pages/*` page objects and `tests/fixture.ts` counts. |
| Integration | `tests/integration/*.spec.ts` | Cross-feature matrix below. Runs in full at every feature gate. |
| Flows | `tests/integration/flow-*.spec.ts` | Spec FLOW-1, -2, -4 (FLOW-3 once Patterns exists; FLOW-5 is ES\|QL, out of scope). |

## Fixture (`tests/fixture.ts`)
`default.spec_logs`, data view `spec-fixture`, window 2026-01-01..2026-01-08 UTC.
`SeverityNumber` = OTel numbers (debug 5, info 9, warn 13, error 17). Latest-5,000 sample (popover): info 3,483 · warn 792 · debug 487 · error 238.
Totals: 41,520 rows; info 28,265 · warn 6,080 · debug 3,984 · error 3,191; payments 9,264; payments errors 1,575 (incl. 1,200 incident rows on 2026-01-05 09:00–11:00).

## Integration matrix
Enable a case as soon as both sides exist. Status: `—` not yet possible · `todo` · `✅`.

| Case | Covers | Status |
| --- | --- | --- |
| IT-A | Filter producers (popover ±, exists, cell actions, drawer, legend, histogram series, patterns, stats tab, Lens click/chooser) → filter store → consumers (count, histogram, grid, popover, patterns, stats tab) refresh | Grid, drawer, field list, popover, histogram right-click (`one_of` series), Lens chart click / chooser / legend ✅ (`tests/integration/it-a-filter-producers.spec.ts`); legend/patterns/stats tab/Lens later |
| IT-B | Pill disable / negate / edit / delete / pin re-query; pin survives navigation to Lens | Logs page ✅ (`tests/features/disc-filter-01.spec.ts`; edit → #19); Lens part pending #11 |
| IT-C | Dirty query/time → Update → all panels and highlight refresh | Query part ✅ (`tests/features/disc-search-02.spec.ts`); time has no dirty state (D9) |
| IT-D | Time writers (brush, filter-by-time, shift/zoom, Lens brush) → URL time, interval, Empty field grouping | — |
| IT-E | Breakdown via popover icon and toolbar; carried into Lens | Popover icon ✅ (`tests/features/disc-sidebar-02.spec.ts`); Lens part pending #15 |
| IT-F | Column writers (sidebar, drawer, column menu, Explore in Discover) → grid + context view | — |
| IT-G | Discover → Lens handoff (Visualize, Edit visualization, stats tab) | — |
| IT-H | Lens → Discover (filters, time, bucket columns, consistent counts) | — |
| IT-I | Drawer → surrounding documents (filters disabled, query dropped, columns kept) | — |
| IT-J | Data view switch (columns pruned, filter warnings, fields reload) | — |
| IT-K | URL reload restores state; Lens unsaved state survives refresh | Logs page ✅ (`tests/features/shared-state.spec.ts`); Lens part pending #11 |
| IT-M | Same actions everywhere via the action registry | ✅ names/tooltips asserted on grid, drawer, popover, field list; grid Expand popover uses the same Filter for/out/Copy (`tests/features/disc-table-01.spec.ts`) |
| IT-N | Autocomplete scoped by filters/time (KQL bar today; filter builder, Lens pickers later) | KQL bar ✅ (`tests/features/shared-autocomplete.spec.ts`) |
