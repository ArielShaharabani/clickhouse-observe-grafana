# Round 8: fixing the Visualize audit findings

Grafana app plugin (ClickHouse, Lens-like "Visualize", src/lens). Findings with full details: `C:\Users\Ariel\co-wt\audit-report.md` (codes W/E/M/L). Read it, CLAUDE.md and .config/AGENTS/instructions.md first.

## Rules for every agent
- Work only in your own worktree and branch. Small local diffs: the others' areas are listed below.
- The machine is very low on memory: no plugin builds, no Playwright test runs, no docker restarts, never kill processes you did not start. `npx jest --maxWorkers=1 <related paths>`; `npx tsc --noEmit -p .` sparingly.
- Keep each file's line endings (some are CRLF or mixed): Edit tool or byte-preserving scripts, never whole-file prettier. Bash heredocs collapse double backslashes: use the Write tool for such code.
- node_modules is a junction: never delete or change it. Don't touch .config, CHANGELOG.md, package.json, docs.
- Check generated SQL on ClickHouse: `docker exec clickhouse-observe-grafana-dev-clickhouse-1 clickhouse-client -q "..."` on default.spec_logs (2026-01-01..08) or perf_logs_1m; scratch tables `r8<name>_*`, dropped afterwards.
- User values reach SQL only through the existing quoting helpers.
- Saved panels are read back by panelImport.ts / sqlRead.ts (old and new SQL) and signed by panelSource.ts: keep those tests green.
- Jest tests per fix. Commit per item on your branch, message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.
- Final report under 300 words: per item fixed / how verified / not fixed and why; behaviour changes; tests run with counts; changelog lines.

## data — C:\Users\Ariel\co-wt\r8-data
Items: W1, W2, W3, W4, W5, W6, W7, W8, W10, M4, L2; from M9 "formula count() gap" and "legend order when ranked by count without a Count metric".
Owns: compile.ts (except date buckets), row shaping, formula.ts, approx.ts, tableChart.ts cell keys, state / suggest / dimensions, LensPage notices.
- W1: detect a truncated result, never zero-fill as if complete, clear notice on chart and Inspector; raise the app-mode limit to about 50,000; cap Top values at 1000 (UI and sanitising).
- W2: date histogram as breakdown gives one series per date bucket, labelled with the date.
- W3: a record counts in every range it fits (as Filters buckets do).
- W4: key series and cells by identity, not label; disambiguate equal labels for display only.
- W7: the rank uses the same condition and window as the metric drawn.
- W8: Map keys: a record without the key is missing, not empty (count, unique, terms, formula, click filters agree).
- W10: deterministic tie-break by value.
- M4: explicitly configured filters and ranges with no records are drawn as 0.
- L2: note on median / percentile estimates and the other cases listed; keep the approximate functions.

## time — C:\Users\Ariel\co-wt\r8-time
Items: W9, M2, M7, E7, E8, E12, L7; from L6 date names; from M9 month ticks / annotations.
Owns: interval.ts, date-bucket and time-zone parts of compile.ts, utils/timeZone.ts, render/timeTicks.ts, and xLabel / month positions in XyChart.tsx.
- M7: buckets of a day or more (hours where the offset is not whole) start in the user's zone (utils/timeZone.ts; `browser` resolved to an IANA name, strictly validated, quoted), including DST days, bucket ends, zero fill, partial shading, click filters, labels. Discover's histogram (buildVolumeQuery) too if simple.
- W9: normalise by the bucket's real length. M2: widen instead of drawing unfilled buckets as contiguous, with the existing note.
- E8: exported panels keep Visualize's zone. E7: drop partial intervals in panels. E12: a custom interval stays in the panel within a sane bucket cap; auto still follows the dashboard.
- L7: Date column with auto interval works; integers over 2^53 exact if the change is small, else explain.
- Verify New_York and Jerusalem DST days and Asia/Kolkata.

## panel — C:\Users\Ariel\co-wt\r8-panel
Items: E1, E2, E3, E4, E5, E6, E9, E10, E11 (every bullet), M3; from M9 right axis / autoAxisTitles.
Owns: panelExport.ts, render/styleConfig.ts, render/fieldConfig.ts, tableChart.ts overrides, sanitising a bar without sub-type.
- E1 axisSoftMin 0 unless data bounds were chosen. E2 heat map cells cover [start, start+interval). E3 fix the transformation chain. E4 reduceOptions.limit. E5 hide only empty cells. E6 bars cover their bucket. E9 stacked everywhere. E10 no misplaced values. M3 fieldMinMax per column. Say which E11 bullets Grafana can't express.
- Verify for real: create dashboards (title prefix r8panel, deleted at the end) through http://localhost:3000 API from JSON your code generates, screenshot `/d-solo/...` one at a time with a small node script using playwright chromium (one page, closed), look at it, and compare with direct queries.

## draw — C:\Users\Ariel\co-wt\r8-draw
Items: M1, M5, M6, M8, L1, L3, L4, L5; from L6 everything except date names; from M9 "NaN / inf line empty with no message".
Owns: src/lens/render/* except styleConfig, fieldConfig, timeTicks and the xLabel / month code in XyChart; metricOptions.ts formats; axisNumber; MetricTiles.
- M1: with Include empty rows off, bars stand at their true time (gaps visible) so axis, ticks, shading and brush agree.
- M5: with negative values the pie says so (notice as Kibana) and percentages are not presented as parts of the whole.
- M6: no stacking on log scale (draw unstacked or say so); values <= 0 are not drawn as about 1.
- M8: gauges write min and max; numbers not clipped. L1: use the real "has breakdown", not `xs[0] !== ''`.
- L3: small numbers keep significant digits everywhere. L4: ellipsis plus full text in title / tooltip. L5: one format reads the same in every chart type. L6: empty values show "(empty)" everywhere; equal metric labels get distinguishing text.
