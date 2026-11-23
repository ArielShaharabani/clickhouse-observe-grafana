# R6-TZ: time zone settings

SQL impact: none by design. Only the `timezone` field of the Grafana request changes (it was `'browser'`); no query text is built from the zone.

## CHANGELOG
- The time picker's "Change time settings" now works: the time zone and fiscal year start month you pick apply to every time shown in Discover and Visualize (grid, detail drawer, compare and surrounding documents, histogram axis / tooltip / caption / bucket menu, chart axes, tooltips, annotations, inspector). The default is Grafana's own preference; "Default" in the picker goes back to it. The choice is kept per browser.
- Relative ranges with rounding (`now/d`, Today, Yesterday, This week, fiscal ranges, shorthand `td`/`yd`/`tw`) resolve in the chosen zone and fiscal month, including from URLs, saved searches and saved queries; changing the zone re-resolves a relative range on screen. Absolute ranges keep the same instants.
- The query request carries the chosen zone.

## Decision
- `src/utils/timeZone.ts` is a small `useSyncExternalStore` store `{timeZone, fiscalYearStartMonth}`; the pick lives in localStorage (`clickhouse-observe.timeSettings`), validated on read and write (`browser` | `utc` | IANA id known to both moment-timezone and Intl, month integer 0-11). Non-React code uses `getTimeZoneSettings()` / `formatInZone` / `resolveRange`; components call `useTimeZoneSettings()` so they re-render, and memoised ticks/rows list the zone as a dependency.
- Bucket alignment NOT changed. Day / week / month / year buckets are `toStartOfInterval` in the column / server zone (UTC for the fixture), and the client side (fillEmptyBuckets, bucketEnd, stepBucket, partial-bucket detection, histogram brush ranges) plus the Visualize WITH FILL clauses and exported dashboard panels all assume that single alignment. Aligning them to the picked zone would need a validated IANA name in every one of those places, DST-aware step arithmetic in both SQL and TS, and a different SQL for dashboards; doing part of it would make buckets and gap-fill disagree. Consequence: a day bucket is a server-zone day, shown at its exact instant in the chosen zone (e.g. 19:00 the day before in New York). Sub-day buckets are unaffected except in zones with non-whole-hour offsets.
- Formatted CSV of the Visualize inspector uses the zone (it is the same text as the table); raw CSV, API, ISO strings and URL epochs are unchanged.
- The admin default time range (App config) is parsed in the viewer's zone at load; no zone is stored in the setting.

## TESTING
- jest: `src/utils/__tests__/timeZone.test.ts` (store, persistence, validation, formatting, ticks, DST ranges, fiscal).
- e2e `tests/features/r6-timezone.spec.ts`: see run notes in the final report.

## Deferred
- Zone-aligned day-or-larger buckets (see Decision).
