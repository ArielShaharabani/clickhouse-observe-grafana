# SHARED-PERF-01 pending notes (#25, Loading / sampling cues)

**No query SQL changed.** Cancel aborts the browser request only (the existing AbortController path); ClickHouse may still finish the query, and the Cancel tooltip says so.

## CHANGELOG

### Added
- **Loading bar** (SHARED-PERF-01): a thin indeterminate bar under the toolbar on Discover (list + histogram queries) and Visualize (field discovery + chart query). Zero-height, so it never shifts the layout; respects reduced motion.
- **Slow query chip with Cancel** on Discover: after 2 s a "Still running · Ns" chip appears; Cancel stops waiting for the list and histogram queries (previous results stay, no error banner) and leaves a dismissible "Query cancelled" notice until the next run.
- **Approximation label on Visualize**: a chart with a Unique count metric says "Unique counts are approximate (ClickHouse uniq)."

### Changed
- The map keys popover caption reads "Discovered from N sample records." (was "N records"), matching the field statistics popover.

## Decision

SHARED-PERF-01 (#25). Verified against spec 30-shared.md: per-panel spinners already existed (Discover refetch overlay, histogram, Lens chart and field list); the field statistics popover already said "Calculated from 5,000 sample records." Built: one shared `QueryProgress` component (`src/components/QueryProgress/`) for the global bar and the slow-query chip; Discover cancel = bump both run ids + abort both controllers, so the aborted calls' catch/finally blocks are no-ops (no error, no stale loading state). Not built, by design: "Refresh shows Update when stale" (search, filters and time apply live here, there is no unapplied state; raw SQL already has its own Run); "Probability used: N%" (no query uses ClickHouse SAMPLE; the Diagnostics drawer already flags one if a raw query does); ES|QL status line (ES|QL out of scope). Deferred: "Send to background" / background searches (needs stored server-side searches); Cancel on Visualize (a cancelled chart needs its own empty state; the bar and "Still running" chip are there, without Cancel); real server-side cancel (`KILL QUERY` by query_id). Known gap: cancelling the very first Discover load leaves the grid's empty state ("No logs found…") under the "Query cancelled" notice.

## TESTING

| Case | Status |
| --- | --- |
| Loading bar on Discover appears while queries run, disappears after (`tests/features/shared-perf-01.spec.ts`, queries delayed with page.route) | written, e2e not run (coordinator) |
| Slow Discover query: "Still running" chip after 2 s, Cancel stops loading, no error banner, cancelled notice dismissible (`shared-perf-01.spec.ts`) | written, e2e not run (coordinator) |
| Visualize: bar while the chart runs; Unique count note shown, exact metrics have none (`shared-perf-01.spec.ts`) | written, e2e not run (coordinator) |
| QueryProgress unit: idle renders nothing, bar immediate, chip after delay, Cancel → onCancel + notice, new run clears notice, finished run leaves none; `formatElapsed`; `lensApproxNote` (jest `QueryProgress.test.tsx`) | ✅ |
| Map keys popover caption says "sample records" (jest `FieldKeysPopover.test.tsx`) | ✅ |
