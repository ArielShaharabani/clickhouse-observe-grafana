# R6-UI: Discover UI fixes (no SQL impact)

## CHANGELOG
- Fixed: hovering or drop-targeting a Discover table column header no longer shows scrolled rows through it (tint is an image layer over the opaque header; header now sits above row cell toolbars).
- Added: the histogram height is adjustable by a drag handle at its bottom edge (arrow keys, Home/End, double-click resets to 104); remembered per browser, never taller than ~60% of the window.
- Removed: the Language (KQL / Lucene) group from the query menu; Lucene is not implemented.
- Changed: Discover tabs are larger and shrink as more open, like browser tabs; the strip scrolls only when all tabs are at minimum width, and the active tab is scrolled into view.
- Changed: tab reordering uses pointer drag: grab anywhere on a tab, drop anywhere (also past the ends), neighbours move aside live, Escape cancels.

## Decision
- Sticky th keeps `background` opaque; hover/drag tints use `background-image: linear-gradient`. th z-index 6 (> cellToolbar 5).
- Histogram height: min 80, max 60% of window.innerHeight, key `clickhouse-observe.logsExplorer.histogramHeight`; no query re-run.
- Tab drop index = count of other tabs whose midpoint is left of the dragged tab's centre (`tabDropIndex`); onMove(id,to) unchanged.
- Tab strip: inner scroller holds the tabs, + and the all-tabs button stay outside it.

## TESTING
- e2e disc-search-03 (language section removed), disc-nav-01 / r5-tabs unchanged expectations: not run (coordinator).

## Deferred
- Spec line in docs/spec/10-discover.md still lists Kibana's Language toggle (describes Kibana).
