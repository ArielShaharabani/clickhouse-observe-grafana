# R5-PADDING: padding polish (user item 11)

SQL impact: none (style-only changes; no query or schema changes).

## CHANGELOG

- Replaced hard-coded px paddings/gaps with theme tokens in Emotion blocks:
  LogsExplorer rail button padding, SearchBar item badge padding, XyChart color-grid gap,
  PieChart legend item padding, VolumeHistogram legend row padding.

## Decision

- Only tokenize spacing where the value maps to a theme step (0.25 = 2px, 0.5 = 4px, 0.75 = 6px).
  Sub-4px optical nudges (e.g. icon `margin-top: 2px/3px`) and dense-table 1-2px gaps are left as-is.
- `LensChart.tsx` gauge/lone-name styles use a plain object with no theme, so their `8px`/`4px` values were not changed.
- Waterfall `margin-left: 136px` is a column-width alignment and is left as-is.

## TESTING

- typecheck: pass. eslint on touched files: 0 errors.
- jest `src/pages src/components/SearchBar src/components/VolumeHistogram src/lens/render`: 5 suites, 56 tests pass.
- e2e rows: not run (coordinator).

## Deferred

- Inline-style `TraceViewPickerModal.tsx` padding (`8px 12px`, `marginBottom: 4`): not a css/getStyles block, left for a later pass.
- Toolbar gap inconsistencies in LogsTable/FieldStatsTab (1-2px dense-table gaps): left as design density.
