# DISC-CHART-02 pending notes

**SQL generation: unchanged.** The breakdown query (top-10 CTE + `other`) already existed; this feature only changes the picker and the legend UI. No security review needed.

## CHANGELOG

### Added
- **Histogram legend ⋮ menu.** Hovering (or keyboard-focusing) a legend row shows ⋮; it opens a popover titled with the value with `Filter for` / `Filter out` (from the shared action registry). Focus moves into the popover; Escape or a click outside closes it. Shift-click still opens the same popover.
- **Hidden legend series show an eye-slash icon** instead of their colour swatch; legend rows expose `aria-pressed` (shown / hidden) and the legend is a labelled list ("Histogram legend").

### Changed
- **Breakdown picker label reads `Breakdown by <field>`** (`Breakdown by Severity` for the severity breakdown); `No breakdown` until one is chosen. The trigger has `aria-expanded`, the list is a labelled dialog with a labelled search box, the chosen entry has `aria-current`, and Escape closes it and returns focus to the trigger.
- **Ctrl/Cmd+click on a legend entry hides that series** (tooltip wording; behaviour unchanged: a second Ctrl+click shows it again).

### Fixed
- The synthetic `other` series of a field breakdown could be "filtered" from the legend (shift-click) or a bar-segment click, adding a pill for the literal value `other`. It no longer offers filter actions anywhere (right-click bucket actions already excluded it).
- Hidden legend series were kept when the breakdown changed, so a series isolated under one field could hide every series of the next. Changing the breakdown (field or mode) now clears hidden / hovered series and closes the legend menu.

## Decision

DISC-CHART-02 (breakdown + legend actions). The picker and the stacked top-N breakdown already existed (v0.10.0); this pass fills the spec's interaction gaps rather than rebuilding them. Legend filter actions reuse the bar-segment popover (`breakdownPopover`) and `valueActions(..., ['filterFor', 'filterOut'])` from the action registry, so legend, segment and right-click bucket all add the same pill. One rule decides what can be filtered from the chart (`isFilterableLevel`): a target field and `onAddFilter` must exist, the mode isn't `single`, and in field-breakdown mode the synthetic `other` series is excluded. A severity value literally named "other" stays filterable. Isolate / hide are client-side view state only (the query, row list and counts are unchanged); hidden state resets when the breakdown key (`colorMode|field`) changes, done during render, not in an effect, to avoid a frame with stale hidden series. Not done: the spec's `_index` / `_ignored` entries (Elasticsearch meta fields, no ClickHouse equivalent). Known ambiguity, pre-existing: a real value spelled `other` in a field breakdown merges with the synthetic rest series (the volume SQL labels the rest `'other'`); left for a follow-up that would need a row-kind column like LENS-DIM-04's.

## TESTING

| Area | Row |
| --- | --- |
| Breakdown picker | `No breakdown` → search `servicen` → ServiceName: label `Breakdown by ServiceName`, URL `bd=field:col:ServiceName`, five services in the legend; Escape closes (e2e `disc-chart-02.spec.ts`) |
| Legend isolate / hide | click auth isolates (4 eye-slash icons, rows unchanged 41,520); Ctrl+click hides payments only (e2e); y-axis rescales to the visible series (jest `VolumeHistogram.legend.test.tsx`) |
| Legend ⋮ actions | Filter for payments → 9,264 rows + pill; Filter out → 32,256 (e2e); no menu for `other` or without a target field; Escape; focus moves in (jest) |
| IT: DISC-SIDEBAR-02 × DISC-CHART-02 | field popover "Break down histogram by ServiceName" → label + legend Filter for auth → 8,064 (e2e) |
| IT: SHARED-ACTION-01 × DISC-CHART-02 | legend filter pill comes from `valueActions`, same pill shape as cells / popover (e2e + jest) |
| IT: severity breakdown | `Breakdown by Severity`; legend Filter for error → 3,191 (e2e) |

## Acceptance

| Criterion | Test / status |
| --- | --- |
| `No breakdown ⌄` opens a searchable list of aggregatable fields | e2e "No breakdown → search and pick a field"; field list = `isBreakdownField` (existing) |
| `_index`, `_ignored` entries | gap: Elasticsearch meta fields, nothing equivalent in ClickHouse |
| Label becomes `Breakdown by <field>`; bars stack by top values; legend on the right | e2e (label, legend); jest `triggerLabel`; stacking is the existing top-10 query |
| Legend click isolates; others show eye-slash; y-axis rescales | jest "click isolates a series…"; e2e "legend: click isolates…" |
| Ctrl+click hides it | jest + e2e |
| Hover shows ⋮ → popover titled with the value: Filter for / Filter out | jest "⋮ opens a popover…"; e2e "legend ⋮ → Filter for…" |
| Also reachable from field popover 📊 (DISC-SIDEBAR-02) | e2e "IT: breakdown chosen from the field popover…" |
