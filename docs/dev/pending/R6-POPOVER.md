Popover audit (R6). No SQL change.

## CHANGELOG
- Fixed: Visualize "Add layer" opened its menu at the far right of the dimensions panel instead of under the button. It and the layer actions menu now use Grafana's Dropdown + Menu (floating placement, flips near edges, Escape / outside click close, focus returns to the button).
- Fixed: the chart type list could run past the right edge or bottom of the window when the dimensions panel is narrow or the window is small; it now stays inside and its list scrolls.
- Fixed: the legend actions menu on Visualize charts now closes on a click outside it.
- Fixed: the data view picker and Saved searches menus now close on Escape.

## Decision
Audit by measuring trigger and popup rectangles in Chromium at 1000x700 and 1600x900 with the splitters at min and max. Only measured defects were fixed. Menus that already render in a portal with fixed placement were left alone.

## TESTING
- tests/features/r6-popovers.spec.ts: run by the author on the r6-popover container; coordinator to rerun.

## Deferred
- BreakdownPicker (260px, absolute, left-anchored) fits by about 9px at 1000px wide; it sits in the histogram toolbar being edited by another agent.
