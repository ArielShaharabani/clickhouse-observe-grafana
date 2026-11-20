# PERF-URLQ (comparison round 2, finding 4)

## CHANGELOG
- Fixed: opening Discover with a query (`q=`) or filters in the URL no longer runs the document list and the histogram twice. The re-run after field discovery now happens only when the SQL built with the discovered fields differs from the SQL that already ran (a Map key or JSON path unknown at first); a config-column search such as `SeverityText : error` compiles the same and is not repeated or cancelled.

## DECISIONS
PERF-URLQ. Root cause: the one-shot "reconcile" effect in LogsExplorer (added so a search naming a Map key / JSON path still resolves after discovery) re-issued fetchLogs and fetchVolume whenever the page opened with a search or filters, whatever they contained. The first list run was a newest-first windowed search (1 h, 6 h, 30 h windows when few rows match), so the re-run cancelled it mid-widening and repeated every window: 15 requests (6 list, 2 histogram) with `q=SeverityText : error` against 9 without. Fix: fetchLogs/fetchVolume record the SQL they issued; the reconcile compiles both queries with the discovered index and re-runs only the one whose SQL differs (`src/pages/_discoveryReconcile.ts`). The first query is never delayed; results are unchanged because an unchanged SQL string yields identical rows. Note the list may still send several requests per load by design (windowed search widening until 200 rows), each window once. Visualize already waits for discovery (`fieldsLoading`) and keys its effect on the query inputs, so a chart opened with `q=` + a lens sends exactly one chart query; pinned by the e2e spec.

## TESTING
| Area | Test | Where |
|---|---|---|
| Reconcile only when compiled SQL differs (config column: none; Map key: both; never-run: both) | jest | `src/pages/__tests__/discovery_reconcile.test.ts` |
| Discover `q=` / `filters=`: no repeated list window, one histogram query | e2e | `tests/features/perf-urlq.spec.ts` |
| Visualize `q=` + lens: one chart query | e2e | `tests/features/perf-urlq.spec.ts` |
