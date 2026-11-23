# Visualize data audit: report

Branch feat/batch-14, commit 1bbba3f, app at http://localhost:3000 (Grafana 13.0.2, ClickHouse 26.3).
I did not change src. Nothing was committed, rebuilt or restarted.

## 1. Summary

- About 200 chart configurations were drawn. About 100 of them were also saved to a dashboard and read back.
- Every number was compared with a query written by hand and run on ClickHouse, not with the app's SQL.
- The plain paths are right. Line, area, bar, pie, donut, heat map, gauge, metric and table of counts and aggregates match. 7 XY charts had all 224 marks equal to the query. For 5 of them the geometry was also compared, and it was within 0.01 px. Pie arcs match to 0.01 %.
- 38 discrepancies were found:
  - wrong data in Visualize: 10 (W1-W10)
  - dashboard panel differs from Visualize or from the data: 12 (E1-E12)
  - misleading drawing: 9 (M1-M9)
  - label or format problem: 7 (L1-L7)
- The worst are: rows cut at 10,000 and drawn as 0 (W1), a date histogram as breakdown (W2), overlapping ranges (W3), saved bar and area panels that do not start at 0 (E1), saved heat maps shifted by one bucket (E2), saved panels that show "No data" (E3).

Ranking inside each list is by severity. "High" means a user can read a wrong fact from a normal chart.

Tables used: spec_logs, perf_logs_1m, and audit_edge, audit_cal, audit_ties. The audit_ tables are dropped. They can be made again from scratchpad/tables.sql. A data view audit-edge has time field ts. Cases are in scratchpad/cases-*.json. Case names are in brackets. Screenshots and dumps are in scratchpad/audit-out.

## 2. Discrepancies

### Wrong data in Visualize

**W1. High. The result is cut at 10,000 rows with no notice. The missing part is drawn as 0.** [c-limit, seen 2 times]
- Steps: perf_logs_1m, 1-8 Jan, Bar, X Timestamp with interval 30m, Breakdown Top 100 of Body with Other, Count.
- Chart: full bars until 4 Jan 12:00, then empty to 8 Jan. Tooltip at 7 Jan 07:30 says 0 for every series. The bars total 502,905. The Inspector says "10,000 rows" and nothing else.
- Query: `SELECT count() FROM perf_logs_1m` = 1,000,000. `SELECT toStartOfInterval(Timestamp, INTERVAL 30 MINUTE) h, count() ... ` for 7 Jan 00:00 = 2,977.
- Also in a Table [c-limit-table]: TOTAL (summary row, Sum) shows 401,401 (second run 401,402). Query: `SELECT count() FROM perf_logs_1m WHERE Body IN (SELECT Body FROM perf_logs_1m GROUP BY 1 ORDER BY count() DESC, 1 LIMIT 9000)` = 547,531.
- Cause: src/lens/compile.ts:86, 648, 828 (LIMIT). No check of rows == LENS_ROW_LIMIT in LensPage.tsx. zeroFill at compile.ts ~1120 turns missing into 0. Size of a terms bucket has no upper cap in state.ts.

**W2. High. A date histogram as Breakdown keeps only one bucket per bar.** [d-datebreak, u-datebreak, b-datebreak]
- Steps (UI only): Bar, X Top values of ServiceName, Breakdown Top values of SeverityText. Open the breakdown, choose Date histogram.
- Chart: payments 144, auth 144, checkout 144 ... No breakdown is drawn.
- Query: `SELECT ServiceName, count() FROM spec_logs GROUP BY 1` = payments 9,264, the others 8,064. 144 is only the last 3-hour bucket.
- Cause: compile.ts bucketCell returns undefined for a date_histogram, so all rows share one series name and overwrite each other (compile.ts:1097-1128). BucketEditors offers the function on the breakdown (dimensions.ts withBucketFunction).

**W3. High. Overlapping custom ranges count a record only in the first range.** [c-overlap, a-range]
- Steps: spec_logs, Bar, X Intervals of SeverityNumber with ranges "< 10", "< 14" and an open range.
- Chart: "< 10" 32,249, "< 14" 6,080, "All values" 3,191.
- Query: `SELECT countIf(SeverityNumber<10), countIf(SeverityNumber<14), count() FROM spec_logs` = 32,249, 38,329, 41,520. Second example: duration 0-1000, 500-1500, 1500+: chart 10,144 for 500-1500, query 20,191.
- The label says "from <= x < to". Elasticsearch and Kibana count a record in every range it fits. Filters buckets do this correctly.
- Cause: compile.ts:390 (multiIf, first match wins).

**W4. High. Two Filters or ranges with the same label in a breakdown: the last overwrites the first.** [a-fbreak, c-fbreak2, c-rangebreakdup]
- Steps: X ServiceName, Breakdown Filters: "SeverityText: error" labelled bad, "SeverityText: warn" labelled bad.
- Chart: payments "bad" 1,198. The 1,575 errors are gone.
- Query: `SELECT ServiceName, countIf(SeverityText='error'), countIf(SeverityText='warn') FROM spec_logs GROUP BY 1` = payments 1,575 and 1,198. The saved panel shows 2,773 (sum): a third answer.
- Also for automatic labels that round to the same text. Table "Split metrics by" keys on labels too [by code; the test data had no collision].
- Cause: compile.ts:1104-1109 (series keyed by display name), tableChart.ts cellKey.

**W5. Medium. Automatic Intervals put values in the wrong bucket (float rounding).** [b-range-fl, seen 2 times]
- Steps: audit_edge, X Intervals of fl (0, 0.1, ... 0.9), granularity 2.
- Chart: 0.2-0.3 has 178, 0.3-0.4 is empty, 0.5-0.6 has 178, 0.7-0.8 is empty.
- Query: `SELECT round(fl*10), count() FROM audit_edge GROUP BY 1` = 88 or 89 in every bucket.
- Cause: compile.ts:406 `floor(x / w) * w`; floor(0.3/0.1) is 2.

**W6. Medium. Big numbers or inf in Intervals collapse into one bar.** [b-range-big, b-range-bad, seen 2 times]
- big (9.007e15 and up): 11 result rows of about 100 become one bar of 2, labelled "9,007,199,254,740,000 - 9,007,199,254,740,000". Query: `SELECT intDiv(big,100), count() ...` gives 11 groups; total 887.
- bad (has inf and nan): one bar "0 - 0" with 739. 148 rows were overwritten. One infinite value makes the width infinite.
- Cause: compile.ts normNum (12 digits) and num() (null becomes 0); CTE rng at compile.ts ~402.

**W7. Medium. Top values ranked by a metric ignore its Time shift and Reduced time range.** [c-rankreduced, c-rankshift, same in 2 runs]
- Reduced: Top 3 of name by Max of dur, last 1h. Chart shows (missing) 64, (empty) 27, Other -63. Query: `SELECT name, maxIf(dur, ts > '2026-02-07 23:00:00') FROM audit_edge GROUP BY 1 ORDER BY 2 DESC` = (missing) 64, empty 27, beta 0. beta should be third.
- Shift 1d: Top 2 of name by Sum of dur, range 2 Feb 00-12. Chart shows beta 27 and (empty) -223, the lowest of all. Query on 1 Feb 00-12 = Other 153, a 153, beta 27.
- Cause: compile.ts:463-470: the rank uses metricFilterSql only, not metricCond, and the CTE reads the unshifted window.

**W8. Medium. A Map key counts records that do not have the key as an empty value.** [b-map-terms, u-json, c-uniqnum, c-uniqform]
- Steps: click + on attrs.num, the default chart. The first, highest bar is "(empty)" 443. No record has an empty num. "Include documents without the field" is off.
- Query: `SELECT countIf(mapContains(attrs,'num')), uniqExactIf(attrs['num'], mapContains(attrs,'num')) FROM audit_edge` = 444 and 10. Unique count shows 11. Formula count(num) shows 887.
- For attrs.k, "(empty)" 443 = 222 real empty values + 221 without the key. With missing on it is right.
- Cause: compile.ts:475, 489 (missingAwareRaw only when b.missing), metricSql 'unique', formula.ts emitAgg count / unique_count.

**W9. Medium. "per day / hour" with a Month interval divides by 30 days.** [b-iv-norm, seen 2 times]
- Chart: Dec 4.133 per day, Jan 4.067. Query: `SELECT toStartOfMonth(ts), count()/toDayOfMonth(toLastDayOfMonth(ts)) FROM audit_cal` = 4.000 and 3.935. February would be 7 % too low. Year uses 365 days.
- The saved panel has the same error.
- Cause: interval.ts UNIT_MS (M = 30 days) used in compile.ts:661 perUnit.

**W10. Low. A tie at the edge of Top N is broken at random.** [b-ties, c-limit-table]
- 40 values with 1,000 records each, Top 5: k16, k17, k30, k39, k4. The total of the Table in W1 changed between two runs (401,401 and 401,402). No tie-break in count order.
- Cause: compile.ts:471-472 `count() DESC` has no `, v` (ascending has it).

### Dashboard panel differs (export)

**E1. High. Saved time-series bar and area panels do not start at 0.** [a-refs, a-partial, a-droppartial, c-area-panel, c-barline]
- Visualize draws 5,760 and 6,960 on 0-7,000. The panel axis runs 5,600-7,100, so 6,960 looks about 8 times 5,760. Real ratio 1.2. In a-partial the axis starts at 1,250.
- A static reference line at 5,000 falls outside the axis and is not seen.
- Cause: render/styleConfig.ts:36 returns early when the chart has no Style, so axisSoftMin: 0 (line 52) is never set. With any Style set it is.

**E2. High. A saved heat map over time is shifted by one bucket.** [a-heat, c-heat3h, b-neg-heat]
- The incident is at 5 Jan 06:00-12:00 (6h buckets) and 09:00-12:00 (3h). The panel draws it at 00:00-06:00 and at 06:00-09:00. The first bucket is off the chart, the last place is empty.
- Query: `SELECT toStartOfInterval(Timestamp, INTERVAL 6 HOUR), count() FROM spec_logs WHERE ServiceName='payments'` = 1,488 at 06:00. The panel query itself returns 06:00.
- Grafana heatmap rows read the time as the end of the bucket.
- Cause: panelExport.ts:418-445 (rowsFrame layout auto, no x layout; the query needs the bucket end or another layout).

**E3. High. Category X + Breakdown + two metrics: the saved panel says "No data".** [d-2mbreak, d-2mbreakspec, b-dupname]
- Visualize draws 40 right bars. Panel: No data.
- Cause: panelExport.ts:275-279 (rename, partitionByValues, joinByField).

**E4. High. Saved pie and Metric panels show at most 25 values.** [b-pie30, b-metric30, seen 2 times]
- 40 equal values: Visualize 40 slices of 2.5 %. The panel has 25 slices, each drawn as 4 %, with no notice. The Stat panel shows 25 of 40 tiles.
- Cause: panelExport.ts:316 and 320, reduceOptions without `limit` (Grafana default 25).

**E5. Medium. Negative heat map cells are hidden in the panel.** [b-neg-heat]
- Visualize draws -234 to 183. The panel draws only 3 to 183; negative cells look like no data.
- Cause: panelExport.ts:435 filterValues le -1e-9.

**E6. Medium. The first, partial bucket is not drawn on time panels.** [a-partial]
- Range 2 Jan 13:00 to 5 Jan 07:00, 1d. Visualize: 2 Jan 2,640. The panel starts at 3 Jan, because the bucket start is before the range. Query: 2,640. Bars are also centred on the bucket start, so each covers half of the earlier bucket and the first is cut in half.
- Cause: panelExport.ts timeseries branch. Partly Grafana's own behaviour.

**E7. Medium. Drop partial intervals is ignored.** [a-droppartial]
- Visualize shows 3 and 4 Jan. The panel also shows 5 Jan with 1,681.
- Cause: compile.ts, dashboard mode has no dropPartial.

**E8. Medium. Date columns in another time zone bucket differently.** [b-tj, seen 2 times]
- tj is DateTime('Asia/Jerusalem'), 1d. Visualize: 132, 144, 24, 143, 144, 144, 144, 12 (Jerusalem days). Panel: 144, 144, 23, 144 ... (UTC days).
- Cause: interval.ts dashboardBucketSql: toDateTime(col) drops the column's zone.

**E9. Medium. A bar chart state without a sub-type is stacked in Visualize and grouped in the panel.** [a-bar-nosub]
- Charts made in the UI get a sub-type. A hand-made or old link may not.
- Cause: panelExport.ts stackingOf (undefined = none), XyChart (undefined = stacked).

**E10. Medium. Bar values in a stacked panel sit on the next segment.** [a-barh]
- "5714" (info) is printed on the green error segment, "1575" on the warn segment.
- Cause: styleConfig.ts showValue 'auto' with stacking in barchart.

**E11. Low. Other panel differences.**
- The Maximum value metric of a Metric chart becomes extra tiles (payments 9264), and no progress bar. [a-metricby, d-metricmax0]
- A value '' is named "m0" (pie, stat, legend) or "Value" (gauge, heat map). [c-emptydonut, c-emptymetric, c-emptygauge, b-neg-heat]
- Intervals labels lose the range: "0", "0.200" instead of "0 - 1,000", "0.2 - 0.3". [a-rangeauto, b-range-fl]
- The series order differs, so stacks are in another order (debug at the bottom instead of info). [a-bar-stacked, a-barcat-stacked]
- A percentage panel tooltip shows raw counts. A percentage reference line at 50 is not drawn. [a-refpct]
- NaN and infinity are shown as numbers (NaN, ∞), where Visualize shows "-". [b-bad]
- Numbers have no thousands separators and other decimals: 41520, 1592 for 1,591.68. [a-metric, a-metricby]
- A heat map table panel has its rows in another order. [a-heatcat]
- A log panel starts at 1,000 where Visualize starts at 1. [a-log]

**E12. Low. A custom interval is widened in the panel.** [c-intervaldash]
- 30m in Visualize (120 a bar). 3h in the panel (720 a bar). The spec says the panel follows the dashboard's resolution. maxDataPoints is 60, so almost every custom interval is widened. This is documented, but the numbers do not match.

### Misleading drawing in Visualize

**M1. High. Include empty rows off: bars and time axis do not line up.** [b-gap-noempty, c-noemptyline, seen 2 times]
- Data has a gap 3 Feb 02:00 to 18:00. Bars are packed by index, but the axis is linear in time. The bar of 5 Feb 00:00 is at x=352; the "Feb 5" tick is at x=392, over 5 Feb 12:00. All bars after the gap are under the wrong date. The gap is not visible.
- Cause: XyChart.tsx:656 timePos (linear) and cx0 (by index).

**M2. Medium. Very fine Millisecond interval over a long range: no gaps and no axis.** [b-iv-1ms]
- 1ms over 314 days: 1,059 equal bars side by side, no time labels. The data has a 35-day gap. The scaling stops at 1,000,000 ms, so 27,130 buckets are needed and the fill gives up.
- Cause: interval.ts resolveLensInterval (cap 1,000,000), compile.ts MAX_FILLED_BUCKETS.

**M3. Medium. Colour by value uses one scale for all columns of a Table.** [a-tablecolor, seen in Visualize and panel]
- Count 8,064 is the lowest of its column and is orange. Average 1,591 is the highest of its column and is green.
- Cause: tableChart.ts tableOverrides: no fieldMinMax, so Grafana takes min and max over the whole table.

**M4. Medium. Filters and ranges with no records are left out.** [a-fbucket, c-fzero]
- A filter with 0 matches, or a custom range with 0 records, has no bar, row or legend entry. Kibana shows 0.
- Cause: compile.ts filtersBucket / rangeBucket (GROUP BY only), no fill in shapeLensRows.

**M5. Medium. A pie hides negative values and takes percentages of the rest.** [b-neg-pie]
- a = -186 and Other = -189 have no slice and "0%". (missing) 154 is called 41.29 %. The real total is -2 over the six values. No notice.
- Cause: PieChart.tsx pieLayout.

**M6. Medium. Log scale.** [a-log, b-logstack, b-logneg]
- In a stacked log bar, payments has 1,575 errors and 777 debug, but the info segment (5,714) takes almost all the height. Segment heights say nothing.
- A value of -186 is drawn as a 1 px bar at the bottom, as if it were about 1.
- Cause: style.ts scalePos, XyChart stacking. The scale is offered for stacked charts.

**M7. Medium. Day, week and month buckets are UTC (or column zone), while the axis is in the user's zone.** [b-tz-*, b-tzM-*, c-tzlocal]
- Browser in New York, 1d: the bar "02-01 19:00" holds 144. Days start at 19:00 local. In Jerusalem 2 Feb local has 144 but 3 Feb local has 24 and 4 Feb 143; the bars say 23 and 144. A month bar is labelled "10-31 20:00". The labels are honest, but a "day" is not the user's day. Kibana uses the user's zone.
- Cause: interval.ts bucketStartSql has no time zone.

**M8. Low. Gauges.**
- With Minimum 7,000, 9,264 fills 90 % and 8,064 fills 42 % of the arc. No minimum or maximum is written on the arc. [a-gaugemin]
- Horizontal bars with a breakdown clip the lower half of the numbers. [a-gaugemax]

**M9. Low. Others.**
- Axis side Right is ignored in a stacked chart. The axis title then says only "Count of records" while the axis shows Sum of ctr (71,160). [d-rightstack] Cause: styleConfig.ts autoAxisTitles.
- A line of a metric with only NaN / inf values is an empty chart with no message. Inf or NaN in a column makes avg, sum, max "-" with no reason. [b-badline, b-bad]
- Month buckets are equal width, but ticks and annotations are placed by 30-day steps. An annotation at 1 Aug is 5 px right of the August bar's left edge (about 3 days). [b-iv-1Mline]
- A Formula count() draws a gap where Count draws 0. [b-formulacount]
- A breakdown ranked by count, with no Count metric on the chart, is listed by name, for one count-ranked case: the legend says auth, payments; by count payments is first. [a-lvtop3] Ranking by the metric itself gave the right order. [c-ranksum]

### Labels and formats

**L1. Medium. A pie, donut or gauge whose first value is an empty string loses all names.** [b-pie-name, c-emptydonut, c-emptygauge, 3 charts]
- Every slice is called "Count of records", with two colours. Percentages are rounded to whole numbers (33 %, 17 %). Every gauge is called "Count of records".
- Query: name values '', Other, a, beta with 148 each.
- Cause: LensChart.tsx:196 and gaugeSpec.ts:133 use `xs[0] !== ''` to mean "no breakdown".

**L2. Medium. Median and percentile are estimates, but no note says so.** [c-medianonly, a-ops]
- 95th percentile of duration for payments: chart 6,017.35. Query `quantileExactInclusive(0.95)` = 5,985.7. All services: 1,961.45, exact 1,963.  The estimate uses 8,192 samples. approx.ts says "null when every number is exact".
- Also no note for Formula unique_count, for a calculation over unique, or for a computed Unique reference line. Plain Unique count has its note, so it is not a bug (TraceId: 995,573 shown, 1,000,000 exact).
- Cause: src/lens/approx.ts:9.

**L3. Medium. Small numbers are shown as 0.** [b-tiny-*, seen 2 times]
- Average 0.0003: bars full height, bar label 0, every axis tick "0", tile 0, table 0, pie "0 (50%)", heat map 0, Inspector 0. The table shows 0.001 for 0.0006. Stat and bar panels show 0.000300.
- Cause: axisNumber.ts:1 (3 decimals), MetricTiles.tsx:35 (2 decimals).

**L4. Medium. Long category labels are cut at 14 characters with no "…".** [b-long]
- Three bars are all labelled "GET /api/v1/cu". Horizontal bars are right.
- Cause: XyChart.tsx:497.

**L5. Low. The same Value format reads differently per chart.** [b-fmt-*]
- 71,160 with number: bar, pie, heat map "71,160.0"; metric, table, gauge "71160.0".
- `0,0` : "71,160" and "71160". `$0.0a` : "$71.2k" and "$71160.0" (abbreviation lost). `0.0a` : "71.2k" and "71.2 K". Duration: "1.2 min" and "1.19 mins". `0,0.0 req/s` : metric tile has two spaces.
- A chart without a format mixes 2 decimals (tile, Inspector) and 3 (table, bar).
- Cause: metricOptions.ts grafanaUnit and formatValue.

**L6. Low. Ambiguous names.**
- Bars over 1 year: both are named "01-01 00:00" (2025 and 2026) for screen readers. Under 2 days of span the date is lost: two days are both "00:00". [b-iv-1y, a-droppartial] Cause: XyChart.tsx xLabel. Tooltips are right.
- An empty value has no name in pies (label " 12.51%", blank legend), tiles and table cells, but "(empty)" in bars and gauges. [c-pie-fmt, c-emptymetric, c-emptytable]
- Two metrics with the same automatic label are "Count of records" and "Count of records (2)"; a filter is not part of the label. [a-shift]
- A square root axis has ticks 1,875 / 7,500 / 16,875. [a-sqrt]

**L7. Low. Other.**
- A Date column with interval Auto fails: "Illegal interval kind for argument data type Date" (SECOND on a Date). Interval 1d works and the saved panel works. [b-dateauto, seen 2 times] Cause: interval.ts bucketStartSql.
- Integers above 2^53 lose digits: max of big 9,007,199,254,741,999 is shown as 9,007,199,254,742,000. Sum 3,990,189,269,850,491,451 is shown as ...491,400. [b-big]

### Documented or accepted, not counted

- Unique count is approximate and labelled.
- The time range works in whole seconds. A range ending at 01:10:00.600 shows 7 records, the query has 8. [b-edge-ms] DECISIONS.md says so.
- The range end is included (`<= to`), so a day range can hold one more record (6,961 for 5 Jan). Documented.
- A Table's Split metrics by is not exported. Reference line labels, computed lines and annotations are not exported. Documented.
- The Moving average excludes the current bucket, as documented.
- A whole Array column as Top values shows "['t1','t2']", not elements. The picker does not offer it; it was reached by URL only.

## 3. Coverage

Match = the drawn value equals the direct query. "Panel" = the saved dashboard panel.

| Item | Checked how | Result |
| --- | --- | --- |
| Line | all 224 marks and positions, tooltip, panel tooltip | match |
| Area stacked / percentage / unstacked | all marks, percentages in tooltips | match; panel E1 |
| Bar stacked / percentage / unstacked, time X | all marks, bar heights | match; panel E1, E6 |
| Bar categories, 3 sub-types | 20 marks each, heights, tooltip | match; E9, L4 |
| Bar horizontal | marks, widths, values | match; panel E10 |
| Table, two buckets, three buckets, date | cells, Inspector, panel | match; W1 |
| Table pivot, summary (sum, avg, min, max, count) | cells and footer | match; M3; pivot not exported |
| Metric, breakdown, secondary, maximum | tiles, progress value | match; E11, L3 |
| Pie, donut | slice values, arc share, percent labels | match; L1, M5, E4 |
| Heat map time X, category X, 60 rows | 140 cells, colour order, legend ends | match; panel E2, E5 |
| Gauge arc, bar, by value, min, max, bands, maximum metric | values, note for more than 12, pictures | match; M8, L1. Panel matches and shows all 40 |
| count, avg, sum, min, max, std dev, last value, percentile rank | per service against spec_logs | match |
| median, percentile | per service | L2 (estimate, no label) |
| unique | per service | match; W8 on Map keys |
| cumulative sum, differences, moving average, counter rate | 1d and 6h with gap and breakdown | match |
| formula: ratio, overall_sum, arithmetic, unique_count | per service | match; W8, L2 |
| Reduced time range | per service | match; W7 for rank |
| Time shift | 1d line, 1d tile, 12h line, filter + shift | match; W7 for rank; top values only from the unshifted window (shifted records of other values go to Other) |
| Metric filter (KQL) | counts per day and service | match |
| Normalize | per minute and hour | match; W9 for months |
| Value formats, rounding | 11 formats x 6 charts | L3, L5 |
| Hide zero option | not in the app | not checked (does not exist) |
| Interval auto, 1ms, 30s, 1h, 30m, 6h, 1d, 1w, 2w, 1M, 3M, 1y | counts per bucket; 1d, 1w, 1M, 3M, 1y, auto compared in full | match; M2 for 1ms |
| Time zone | UTC, Jerusalem, New York browser; Jerusalem column | M7, E8 |
| Time zone chosen in Grafana preferences | URL parameter had no effect | not checked |
| DST change days | not checked | not checked (only labels seen) |
| Empty buckets, partial edges, drop partial | counts, shading | match; M1, E6, E7 |
| Unbound histogram | looked at only | no mismatch seen, not fully checked |
| Top values count, alpha, ascending, metric; Other; missing; ties | against spec_logs and audit_edge, with real values "Other", "(missing)", '' and NULL | match; W7, W8, W10 |
| Include / exclude lists, regex | not checked | not checked |
| Intervals custom and automatic, negative | counts | W3, W5, W6; negative match |
| Filters bucket | counts incl. overlap, empty query | match; W4, M4 |
| Breakdown | terms, filters, ranges, date | W2, W4 |
| Multiple metrics | values | match; E3 |
| Secondary axis | ticks, panel | match unstacked; M9 stacked |
| Reference lines, computed lines, annotations | value, pixel position | match (5,000 / 9.817 / 41,520; three annotations); M9 months |
| Axis bounds full, data, custom; log; sqrt | ticks, heights | match; M6. Custom bounds hide the base by choice |
| Tooltips | about 25 | match |
| Legend, order | order of names | match for count; M9 for others |
| LIMIT 10,000 | 1M rows | W1 |
| Filters + KQL + partial time range | a-filters | match, panel match |
| Discover histogram -> Visualize | 3 cases: full, range, KQL + filter | match (41,520 / 2,121 / 1,363) |
| Explore in Discover, Open panel, Edit in Visualize round trip | not checked | not checked |
| Data types: DateTime64, Date, Map, JSON paths, Bool, Enum, IPv4, Decimal, Nullable, LowCardinality(Nullable), epoch time field, view without time | values | match except W6, W8, L7 |
| Array elements | not offered | not applicable |
| Inspector data table | in about 60 cases | match with the query rows |
| CSV download | not checked | not checked |

## 4. Method and limits

- A Playwright script opened each chart by URL state, waited, and read aria-labels, rectangles, paths, ticks, legend, tooltips, tiles and tables. It then saved the chart with the Save dialog, opened the panel full size and read its text, table cells and tooltips. Canvas panels were read from tooltips and screenshots.
- Scripts: audit-harness.spec.ts, audit-discover.spec.ts, audit-ui.spec.ts, gen-a.mjs to gen-d.mjs, compare.mjs, show.mjs, all in the scratchpad.
- All 224 marks were compared by script for 7 charts, and the geometry for 5 (not the stacked and percentage areas); the heat map (140 cells) and 6 calendar intervals too. Other charts were compared by reading values side by side.
- About 35 screenshots were read by eye, at least one per chart type. The rest were not looked at.
- W1-W10, E1-E4, E7-E9, M1, M3, L1-L4 and L7 (Date) were seen at least twice (a second run or a second chart). E5, E6, E10-E12, M2, M4-M6, M8, M9, L5, L6 and the big-integer item were each seen once, with the cause in the code, or in several cases of one run. M7 was seen in 5 cases.
- Most Kibana statements are from the spec and from general knowledge. Kibana was not run.
- Heat map panel tooltips could not be read. Its position was read from pictures and from the panel's own query rows.
- Panels were checked in a full-size view in Grafana 13.0.2, dark theme only.
- The export of a result cut at 10,000 rows was not tested.
- Once, my command `taskkill /IM chrome-headless-shell.exe` ended every headless Chrome on this machine, not only mine. Another test run at that moment (about 17:41) could have failed because of it.
- Clean-up: audit_ tables dropped, test dashboards deleted (a search for "audit" returns none), spec files removed from the repo.
- At the end `git status` showed changes by someone else during the audit: src/sql/fieldPredicates.ts, fields.ts, kql/toSql.ts, queryBuilder.ts, src/sql/__tests__/json_list_filter.test.ts and tests/features/zz.spec.ts. They are not mine and I left them alone. I tested the dist that was deployed at the start (module.js 23 Nov 17:37). Someone rebuilt dist at 18:24:58. Cases run before that used the old build. The reruns of about 20 cases ran around that time, see file times in audit-out; all gave the same results.
- Line numbers were read at commit 1bbba3f. A few are approximate (~).

## Re-check after the fixes (2026-11-24)

31 fixed, 7 partly, 0 wrong. Remaining: E5 (negative heat map cells: filter fixed, not re-checked after the E2 rewrite); E6 first partial bucket in panels; E11 range labels, gauge empty name, percentage reference line, infinity; M6 no note for negatives on a log axis; M9 right axis in a stacked chart (one axis by design), NaN table cells blank; L5 abbreviations / durations in tables and gauges; L6 square-root ticks; integers over 2^53; one colour shared by two slices of a pie with negatives; `timezone=` URL parameter not read.
