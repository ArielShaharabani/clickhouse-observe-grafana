# PARITY-GRID pending notes

**This change touches SQL generation** (`src/sql/queryBuilder.ts`): `buildLogsQuery` appends a time tie-break to any non-time sort (`ORDER BY <sortCol> <dir>, <time> DESC`, the time being the `__timestamp` alias in the grid projection and `timeExpr(config)` otherwise; both trusted, from the view mapping); new `buildDocumentByAnchorQuery` (`SELECT * [, converted time AS __timestamp] … WHERE <time> = fromUnixTimestamp64Nano(<ns>) AND <rowId> = <id> LIMIT 1`). The coordinator should run the security review. Untrusted input: the single-document path (`doc/<viewId>/<ns>_<id>`), parsed by the existing `parseAnchorParam` and re-checked by `isContextAnchor` (digits only, Int64 / UInt64 range) before inlining; malformed anchors produce no query. URL / saved-search column widths (`cols[].width`) are display-only: `sanitizeColumns` keeps only a finite number clamped to 60–1200, and queries read a width-free copy (`stripColumnWidths`). `ret` is re-serialized as query params under the `logs` route (`discoverReturnUrl`); a filter added on the single-document page goes back through `decodeLogsState` → `sanitizeFilterPills`. No user input is string-concatenated into SQL.

## CHANGELOG

### Added
- **Column resize (PARITY-GRID).** Drag a column header's right edge (or focus the handle and use ←/→; double-click resets). Widths are kept with the columns in the URL and saved searches and never re-run the query. Dragging the header body still reorders.
- **Column header menu.** Clicking a header name opens a menu like Kibana's: Sort ascending, Sort descending, Move left, Move right, Reset width, Copy name, Remove column (the small ‹ › × icons are gone).
- **View single document.** The document panel links to `doc/<dataViewId>/<docId>`, a permalink page showing that one document (same identity as surrounding documents); filtering from it returns to Discover with the filter.
- **Add filter on Surrounding documents.**

### Changed
- **Document panel navigation covers every loaded row** (`51 of 200`, not `1 of 50`), fetching more when stepping past the last loaded row; the grid follows to the document's page. ←/→ step between documents, Escape closes the panel, focus moves into the panel and back to the row. "First / Last log on this page" are now "First log" / "Last log".
- **Wider document panel** (55 % by default, at least 400 px, still resizable); field names wrap at the dots; the panel toolbar wraps so the search box is never cut; JSON shows the time as ISO 8601.
- **Field popover:** filter for / out buttons are always visible on every value, with a bar gauge; "sample records" only when the 5,000-row sample is full; Map keys can be added as a column in one click from the key list; the drilled key's back link sits inside the popover and long names wrap.
- **Surrounding documents:** the anchor row stays highlighted on any zebra stripe; dense rows with page scroll; the anchor stays in view after Load newer; the detail panel is sticky and resizable.

### Fixed
- Adding columns no longer collapses the field list to one-letter names or clips the grid and pager on the right; the grid scrolls sideways inside its own area and the message column keeps a readable width.
- Sorting by a column keeps time order (newest first) among equal values.
- The Body field can no longer be added as a second column while the Message column shows Body (its field-list entry says so).
- The cell action bar on the first row no longer covers the column header.

## Decision

PARITY-GRID (Kibana 9.5 comparison, grid / document panel / context view / field popover). Document navigation walks the loaded rows (`rows`, 200 initially) rather than the grid page, like Kibana's flyout over its sample; stepping past the last loaded row calls the grid's own `ensureRows` and the grid page follows the open document (`src/pages/_docNav.ts`). Keyboard: ←/→ (Kibana's flyout keys), ignored in text inputs and for events from portalled popovers; Escape closes; the panel focuses itself on mount, and the grid returns focus to the row's button when the selection clears and focus would otherwise land on `<body>`. Column widths are part of `SelectedColumn` (`width?`), so they travel with `cols` and saved searches like order does; the queries use `stripColumnWidths` behind a string-keyed memo, so a resize never re-runs anything. Widths are applied as width/min/max on the header and cells plus a capped content box (table cells treat width as a hint). The header name opens a menu (not a sort): sort direction is explicit (`SET_SORT` gained `dir`), which made the header-click toggle unnecessary. Non-time sorts add `, <time> DESC`. `ADD_COLUMN` refuses a column whose expression is already shown, except the core time column (a converted time field shows a converted value). The sidebar min width (200 px) and `min-width: 0 !important` on the results / table panes override `useSplitter`'s inline `min-width: min-content`, which was what let a wide grid push the sidebar to its 60 px floor. "View single document" reuses the surrounding-documents anchor (epoch-ns timestamp + `cityHash64` row id) instead of inventing a second identity; the page navigates in the same tab (an async anchor lookup before `window.open` would be popup-blocked). The JSON tab converts only the mapped time column and `__timestamp` (epoch ms → ISO; ClickHouse DateTime text keeps its fractional digits). Map keys: one click from the opened key list (a per-key ⊕), not from the sidebar row itself — keys are only known after the on-demand query, and another agent may flatten Map keys into the field list. Popover caption: "sample records" only when the sample reached its cap (5,000 stats / 500 keys).

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/pages/__tests__/parity_grid.test.ts` (doc navigation targets, width reducer / sanitizer / URL round trip, explicit sort, duplicate Body, ISO time, single-doc URL + SQL + hostile anchors, filter hand-back), `src/components/__tests__/parityGrid.test.tsx` (header menu, resize handles, anchor marker, focus return, panel Escape / ←/→ / focus / ISO JSON / single document / dot wrapping, popover buttons + caption + back link, "shown as Message"), `build_logs_query.test.ts` (tie-break), `FieldKeysPopover.test.tsx` (one-click add, caption), `a11y.test.tsx` (header menu) |
| E2E | `tests/features/parity-grid.spec.ts` — not run (coordinator) |
| E2E | `tests/features/disc-doc-01.spec.ts` (First / Last log names) — not run (coordinator) |
| IT-F | Column widths travel with `cols` (URL); resize doesn't re-query — e2e `parity-grid.spec.ts` "columns resize …" not run (coordinator) |
| IT-I | Context view Add filter + anchor highlight — e2e `parity-grid.spec.ts` "surrounding documents …" not run (coordinator) |

## Deferred

- Item 10 (chart caption overlap in the detail panel) — handled by another agent.
- Map keys as one click directly from the sidebar row: needs the keys in the field list (another agent may flatten Map keys); here it is one click from the opened key list.
- Header menu: Copy column (all values) and Edit data view field; header line limits.
- The document panel's width is the existing splitter (persisted per viewer), not a separate drag handle on the panel edge.
- "View single document" opens in the same tab (Kibana: new tab).
