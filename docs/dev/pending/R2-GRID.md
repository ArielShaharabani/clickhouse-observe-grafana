# R2-GRID (Kibana 9.5.6 comparison findings 8 and 19)

## CHANGELOG bullets
- Discover grid: the default row is now one line of message with an ellipsis (about 40 px instead of 83 px; "Body cell lines" default 3 -> 1). A saved Display options choice still wins. The histogram is 104 px tall (was 128) with a tighter header, so more rows fit above the fold.
- Discover pager: shows the number of matching documents (the histogram's count, no extra query): "200 of 1,207 loaded", and the document panel reads "1 of 1,207". Paging past the loaded rows fetches at least 200 rows per request (was exactly the missing page, 50). A "Load all N" button appears when at most 5,000 documents match. Raw SQL and views without a time field keep "200 rows loaded+".

## DECISIONS paragraph
R2-GRID. Row density: only the default changed (`DEFAULT_GRID_DISPLAY` = normal density, 1 body line); the Display options and the localStorage choice are untouched, so anyone who picked a value keeps it. Grafana's own side menu docking (300 px) is a Grafana user preference and is deliberately not touched by the plugin. Total: `knownTotal()` (`_docNav.ts`) reuses the histogram's summed count, and only when the view has a time field, the query is not raw SQL, the histogram is not loading, and the count is not below the rows already loaded (stale); otherwise the UI keeps the old loaded-rows wording. The count is not clamped into `hasMore`: a slightly stale total never stops loading. Load-more chunk is `max(needed - loaded, 200)`; "Load all" requests enough pages to cover the total and is offered up to 5,000 documents. There is still no "Last page" button for large totals (it would fetch the whole result).

## TESTING rows
| Area | Test | Where |
| --- | --- | --- |
| Grid default | default display is normal/1 line, saved choice wins | `LogsTable.grid.test.tsx` |
| Pager | loaded label with/without total, Load all button | `PaginationBar.test.tsx` |
| Doc panel | label uses known total; `knownTotal` guards; chunk 200 | `parity_grid.test.ts` |
| e2e | document panel "50 of 41,520" etc.; pager text `/ loaded/` | `tests/features/parity-grid.spec.ts` |
