# R2-FIXES — comparison round 2 fixes done by the coordinator

Findings doc: https://claude.ai/artifact/Y5yzCp7mwEvtJtTWYPput7 (numbers = "Prioritized findings" rows).

## CHANGELOG
- Fix: the ClickHouse dev healthcheck never passed (compose interpolated `$rc` away), so the MEMORY_LIMIT_EXCEEDED self-restart could not run; `$$rc` now (finding 1).
- Fix: Discover → Add to dashboard table panel no longer shows "COUNT 200" for 1,207 matches: it holds the newest 1,000 documents, pages, and says so in its description (finding 3).
- Fix: the dashboard Log volume panel uses about 60 buckets like Discover (`maxDataPoints: 60`), not one per pixel of panel width (finding 10).

- Fix: after an invalid search, Discover's histogram no longer keeps the previous search's bars and row count; it says "No chart: the search has an error", as Kibana clears its chart (finding 2).
- Fix: the Discover histogram tooltip shows exact counts with separators ("Total: 1,920"), not "1.92 K" (finding 6).
- Fix: the Field statistics tab says "Calculated from 2,161 records" when every matching document was used; "sample" only when the 5,000-row cap is reached (finding 20).
- Fix: the document JSON view shows every DateTime column as ISO 8601, including the partition column `TimestampTime` (finding 18; the single-document link length is unchanged).
- Discover histogram: Millisecond interval (Kibana has it); scaled through 2/5/10/…/500 ms and then seconds with the usual notice when it would exceed 1,000 bars; buckets use `toDateTime64(ts, 3)`; maps to Visualize's `1ms` both ways (finding 21).

## DECISIONS
Round 2 #3: Grafana's table footer "Count" counts the rows the panel received, so with a row-capped query it read as the number of matches. Removed; the cap (1,000, `EXPORT_TABLE_LIMIT`) is in the panel description and the table paginates (`enablePagination`, Grafana 13 table option). A true total would need a second query per refresh; Open in Discover gives it. Round 2 #10: `$__timeInterval` follows the query's interval, which Grafana derives from the panel's max data points (default: panel width in px, ~1,000+), giving 1–4 events per bar; 60 matches Discover's auto interval (3 h on 7 days, 5 min on 4 h). Round 2 #16 (Other in two passes) stays deferred per D52: the top-N CTE is needed with or without Other, and Other measured no extra cost at 50M rows.

## TESTING
| Area | Test | Kind |
| --- | --- | --- |
| Add to dashboard table | no footer, pagination, description states 1,000, `LIMIT 1000` (`parityDashboards.test.ts`) | unit |
| Add to dashboard volume | `maxDataPoints` 60 (`panelExport.test.ts`) | unit |
| Discover histogram | invalid search hides bars and count (`LogsHistogramPanel.test.tsx`; `parity-fields.spec.ts` invalid query) | unit + e2e |
| Field statistics tab | "sample" only at the cap (`sampleCaption`, `FieldStatsTab.test.tsx`) | unit |
| Document JSON | TimestampTime as ISO (`parityGrid.test.tsx`) | unit |
| Histogram interval | Millisecond exact / scaled to ms steps / to seconds (`parityHistogram.test.tsx`); DateTime64 bucket SQL (`build_volume_query.test.ts`) | unit |
