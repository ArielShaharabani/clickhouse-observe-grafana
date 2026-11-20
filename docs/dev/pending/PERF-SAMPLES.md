# PERF-SAMPLES (pending)

## CHANGELOG
- Faster field discovery on big tables: the Map-key sample now reads the latest hour of the range first (cost no longer grows with table size or range), and only widens to the full range, then 7 days, when a window has too few rows to hold any keys.
- A Map column that is simply empty in the range (e.g. ScopeAttributes) is no longer sampled a second time on every load.

## DECISIONS (paragraph)
PERF-SAMPLES. `buildDiscoveryWindows` now yields ordered windows: `recent` (last 1 h before `$__toTime`, with a 25 h coarse-partition bound), `range`, `wide` (7 d); windows the range already covers are skipped. `fetchMapKeys` walks them only while the sample found no keys AND is not full (`total < 500`); the key query emits a `''` sentinel key so `total` is visible for a sample that has rows but no keys, which is how "empty column" is told apart from "window had no rows". Measured (docker ClickHouse, medians of 3, 7 d range, `ORDER BY Timestamp DESC LIMIT 500`): perf_logs_50m before/after ResourceAttributes 404 -> 30 ms, LogAttributes 353 -> 26 ms, ScopeAttributes 329 -> 19 ms; perf_logs_1m 43/30/24 -> 15/20/14 ms; spec_logs 12/13/10 -> 9/9/10 ms. Same keys found on all three tables (3/4/0 on perf, 3/3/0 on spec_logs). No-ORDER-BY was measured too (24-28 ms warm) but rejected: with ORDER BY (ServiceName, ...) it returns the first service's oldest rows, biasing the key set. SAMPLE was not used (no sampling key on these tables). Trade-off: a sparse key present only in rows older than the latest hour of a full (500-row) recent sample is not discovered by the page-load sample (it still shows in the per-column popover, which uses the page filters and range); a column whose recent window is full of empty maps is treated as empty. Deferred: remember per-table "empty column" across time-range changes.

## TESTING rows
| Area | Case | How |
|---|---|---|
| Unit | recent/range/wide window SQL, window list skips covered windows | perfMetadata.test.tsx |
| Unit | full sample with no keys is not retried (one sample for an empty column) | perfMetadata.test.tsx |
| Unit | sparse sample (no rows) widens range -> 7 d | perfMetadata.test.tsx |
| E2E | perf-metadata.spec.ts: map-key samples still time-bounded (now matched on `mapKeys(m)`) | playwright (coordinator) |
