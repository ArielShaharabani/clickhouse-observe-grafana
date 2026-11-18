# DATAVIEW-TIME pending notes (#16d)

PLAN row 16d — DATA-VIEW time field gap (spec 00-preamble "Data view = index pattern + time field").

## CHANGELOG

### Added
- **Time field on the Configuration page's shared data views** (#16d). Shared views get the same column mapping as Create data view: the table's columns are listed (debounced lookup of the typed datasource / database / table, falls back to typed names when the table can't be listed), a dedicated Timestamp field picker, and every other mapping chosen from the table's columns. The time field stays editable after creation (shared views here, personal views through Edit data view).
- **Converted time fields** (#16d). Besides Date / DateTime columns, the Timestamp field picker lists numeric columns (read as epoch seconds / ms / µs / ns, with an Epoch unit picker; the unit is guessed from one sample value) and text columns (parsed with `parseDateTime64BestEffortOrNull`, no-zone text read as UTC). A converted choice is flagged in the picker (ClickHouse converts every row; no time-index use). Stored as `timestampFormat` on the view (unset = native).
- Every query reads the time field through one function, `timeExpr` (`src/sql/timeExpr.ts`): time filter, histogram, grid sort, detail lookup, surrounding documents, field samples / top values / numeric stats, Map-key sampling and the Lens date histogram. A native column produces byte-identical SQL to before.

### Changed
- On a converted view the raw epoch / text column is an ordinary field: the detail drawer shows it as a number / text, and the grid's Time cell (the converted time) has no filter actions (it can't be compared with the raw column).
- Create data view: the Advanced column mapping no longer repeats the Timestamp field (one picker, with conversion).

### Security
- `buildColumnsQuery` / `buildTablesQuery` now quote the database and table as string literals (`quoteString`); the Configuration page runs them on admin-typed names. The time sample query quotes column and table through `quoteIdentifier` / `tableRef`. `timestampFormat` from stored config is checked against the enum (unknown = native) and never inserted into SQL.

## Decision

DATAVIEW-TIME (#16d). A data view's time field may be a non-DateTime column read through a conversion, stored as `timestampFormat` (`native` | `epoch_s|ms|us|ns` | `string`; unset = native) next to `columns.timestamp`. All SQL reads the field through `timeExpr(config)`: native → the mapped column unchanged (existing SQL byte-identical), converted → the quoted column in a fixed template per format (`toDateTime64(toInt64(c),3)`, `fromUnixTimestamp64Milli/Micro/Nano(toInt64(c))`, `parseDateTime64BestEffortOrNull(toString(c), 9, 'UTC')`). Converted values are aliased as `CORE_ALIAS.timestamp` in every projection (also `SELECT *` hydration), so grid, drawer, compare and row keys see the same time. The `$__timeInterval` macro gets the explicit `toStartOfInterval` form when the time expression has parentheses / commas (macro parser limitation, same rule as the Lens dashboard export). Coarse pruning (`partitionTimestamp`) is unchanged: it is a Date column compared against the time range, valid whatever the time field's type. One picker component (`TimeFieldSelect`) serves Create / Edit data view and the Configuration page, so both offer the same choices; the epoch unit default comes from one sample value (10/13/16/19 digits → s/ms/µs/ns), changeable by the user. Not done: filters on the raw column by time value, and the time-index cost of a converted field (inherent; flagged in the UI).

## TESTING

| Case | Status |
| --- | --- |
| Converted time fields (epoch s / ms / ns, ISO text) find every fixture row in the fixture range and filter by level (`tests/features/dataview-time.spec.ts`, fixture view `default.spec_logs_epoch` from `scripts/clickhouse-init/05_dataview_time_fixture.sql`) | ✅ |
| Converted epoch ms over the incident window matches the native view's count | ✅ |
| Edit data view: switch time column, epoch unit guessed from a sample, saved to the personal view | ✅ |
| Configuration page: shared view lists the table's columns, time field picker offers number / text columns with conversion flagged | ✅ |
| `timeExpr` per format, hostile stored config, column kinds, every query builder + Lens through `timeExpr` (jest `src/sql/__tests__/timeExpr.test.ts`) | ✅ |
| Picker options / defaults / guess / note, `omitKeys`, schema-query escaping (jest `src/components/__tests__/TimeFieldSelect.test.tsx`) | ✅ |

Fixture note: on a ClickHouse volume created before 05_dataview_time_fixture.sql, load it once: `docker exec -i clickhouse-observe-grafana-dev-clickhouse-1 clickhouse-client --multiquery < scripts/clickhouse-init/05_dataview_time_fixture.sql` (CREATE OR REPLACE VIEW, safe to repeat; already loaded on the dev stack 2026-11-18).
