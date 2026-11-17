## Grafana mapping

Grafana already covers time handling, log volume and basic filter-for/out in log details; the biggest gaps are field statistics, the filter model, pattern analysis for non-Loki sources and field-first chart building. Status is relative to Grafana 13.x (Explore, Logs panel, ad-hoc filters, Logs Drilldown app) as documented; verify against your target version.

| Spec ID | Capability | Grafana today | Status | Build approach |
| --- | --- | --- | --- | --- |
| DISC-SIDEBAR-02 | Field stats popover with top values, distribution, filter ±, Visualize | Log details “show stats” icon computes stats over the displayed rows only | Partial | Panel/app component that issues sampler + terms aggs per field |
| DISC-FIELDSTATS-01 | Field statistics tab for all fields | Logs Drilldown Fields tab shows volume per extracted field (Loki) | Partial (Loki only) | Batch sampler queries; table with mini charts |
| DISC-SIDEBAR-01 | Grouped, searchable, typed field list | Field toggles inside log details | Missing | `FieldList` from datasource field caps + existence query |
| DISC-FILTER-01/02 | Filter pills with disable, negate, pin, label, DSL; rich operators | Ad-hoc filters: =, !=, regex, <, >, One of / Not one of (11.5+); no disable or pin | Partial | Extend ad-hoc filter model; custom filter-bar component |
| DISC-SEARCH-02 | KQL with field + value autocomplete | Per-datasource editors (Lucene for Elasticsearch, LogQL builder) | Partial | Shared query input using `getTagKeys` / `getTagValues` |
| DISC-TIME-01 | Time picker, shift, zoom out | Time picker, zoom out, shift | Exists | Reuse; add shorthand typing + duration badge |
| DISC-CHART-01 | Hits histogram with brush, pinned tooltip actions | Explore log volume (Elasticsearch and Loki full-range), brush-to-zoom | Partial | Add right-click series actions |
| DISC-CHART-02 | Breakdown by any field | Logs Drilldown breakdowns per label (Loki) | Partial | Breakdown selector → terms sub-agg on volume query |
| DISC-TABLE-01/02 | Grid with summary column, cell actions, sample size | Logs panel; Table panel with filter links | Partial | Logs grid panel with cell action bar |
| DISC-DOC-01 | Doc flyout: table/JSON, pin, prev/next | Log details row expansion with filter ±, stats, toggle field | Partial | Side drawer component |
| DISC-DOC-02 | Surrounding documents | “Show context” documented for Loki | Partial (Loki) | `search_after` both directions around anchor |
| DISC-PATTERNS-01 | Pattern analysis | Logs Drilldown Patterns tab from Loki ingestion patterns | Partial (Loki) | `categorize_text` agg for Elasticsearch/OpenSearch |
| DISC-ESQL-01 | Piped query with result-driven chart | SQL editors per datasource | Partial | Auto-viz from result frame shape |
| DISC-NAV-01 | Multiple tabs per session | Explore split view (2 panes) | Partial | Scenes tab state |
| LENS-AUTO-01 / SUGG-01 | Field-first auto chart + suggestions | Visualization suggestions in panel editor (query-first) | Partial | Suggestion engine (section 8) |
| LENS-DIM-02/03 | Per-metric filter, time shift, formula | Query options, transformations, expressions (panel-wide) | Partial | Dimension model compiled to datasource queries |
| LENS-INTERACT-01 | Click value → filter, multi-dim chooser | Data links; ad-hoc “filter for value” on some panels | Partial | Action registry + chooser modal |
| LENS-INTERACT-02 | Explore in Discover with columns | “Explore” from panel menu | Partial | Pass columns in URL state |
| LENS-INSPECT-01 | Inspector data + requests | Query inspector (Data, Stats, JSON, Query) | Exists | Add cell filter actions |
| SHARED-STATE-01/02 | One context in URL across apps | Dashboard variables + Explore URL state | Partial | Scenes `UrlSyncManager` with a shared context object |

Sources: [Grafana Explore logs integration (v13.2)](https://grafana.com/docs/grafana/v13.2/explore/logs-integration/) · [Filter and group by (v13.2)](https://grafana.com/docs/grafana/v13.2/visualizations/dashboards/build-dashboards/filter-group-by/) · [Logs Drilldown labels and fields](https://grafana.com/docs/grafana/latest/explore/simplified-exploration/logs/labels-and-fields/) · [Logs Drilldown changelog](https://grafana.com/grafana/plugins/grafana-lokiexplore-app/changelog/) · [Grafana 11.5 Filters UI (One of operators)](https://cdn2.opsmatters.com/videos/grafana-115-new-filters-ui-grafana-dashboards-public-preview-grafana-labs)
