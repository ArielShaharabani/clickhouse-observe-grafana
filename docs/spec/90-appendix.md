## Appendix

### Test environment

| Item | Value |
| --- | --- |
| Kibana / Elasticsearch | 9.5.5, Docker, single node, security off, trial license (all features) |
| Browser automation | Playwright Chromium over CDP, 1600×1000 viewport |
| `Telemetry logs` (`logs-app-*`) | 150,000 synthetic OTel-style logs over 7 days: `service.name` (5 services), `log.level`, `host.name` (8), `cloud.region`, `http.*`, `event.duration` (ns), `trace.id`, `tags` (array), `client.geo.location`; payments error/latency spike 2 days before capture |
| `Telemetry metrics` (`metrics-app-*`) | 16,128 docs, 5-minute samples per host: CPU, memory, network, request count, latency |
| Kibana sample data | Web logs (14,074), eCommerce (4,675), Flights (13,014) |

### Screenshot index

All captures are in the local scratchpad folder `…/scratchpad/shots/` on the machine that ran the session. Key ones are embedded below.

| File | Shows | Spec |
| --- | --- | --- |
| disc\_01\_initial | Discover default layout | Page layout |
| disc\_02\_fieldpop\_keyword | Field popover, keyword top values | DISC-SIDEBAR-02 |
| pop\_duration\_distribution | Number field distribution | DISC-SIDEBAR-02 |
| disc\_03\_filter\_added | Pill + highlighted summary | DISC-FILTER-01 |
| disc\_04\_filter\_pill\_menu | Pill menu | DISC-FILTER-01 |
| disc\_05\_edit\_filter | Filter editor | DISC-FILTER-02 |
| disc\_08\_kql\_value\_suggest | KQL value suggestions, Update state | DISC-SEARCH-02 |
| disc\_09\_timepicker | Time picker presets | DISC-TIME-01 |
| disc\_10\_breakdown / disc\_11\_hist\_tooltip / disc\_14\_bar\_rightclick | Breakdown, tooltip, pinned actions | DISC-CHART-01/02 |
| disc\_13\_after\_brush | Brushed time range | DISC-CHART-01 |
| disc\_16\_cell\_expand / disc\_18\_cell\_popover\_kw | Cell actions | DISC-TABLE-02 |
| disc\_19\_column\_menu | Column menu | DISC-TABLE-03 |
| disc\_20\_doc\_flyout / disc\_22\_flyout\_value\_click | Doc flyout | DISC-DOC-01 |
| disc\_23\_surrounding | Context view | DISC-DOC-02 |
| disc\_24\_patterns / disc\_25\_pattern\_expand | Patterns | DISC-PATTERNS-01 |
| disc\_28\_fieldstats / disc\_29\_fieldstats\_numeric\_expand | Field statistics tab | DISC-FIELDSTATS-01 |
| disc\_33\_esql\_stats / disc\_34\_esql\_autocomplete | ES\|QL | DISC-ESQL-01 |
| lens\_01\_from\_visualize | Lens from Visualize | LENS-AUTO-01 |
| lens\_04/05/06 | Dimension editor, advanced, formula | LENS-DIM-02/03 |
| lens\_09\_bar\_breakdown / lens\_11\_bar\_click | Style panel, filter chooser | LENS-STYLE-01, LENS-INTERACT-01 |
| lens\_14\_topvalues\_editor | Top values editor | LENS-DIM-04 |
| lens\_17\_Metric | Metric with breakdown | LENS-CHART-01 |

### Not exercised

Dashboard-level drilldowns (URL and dashboard-to-dashboard), annotations and reference-line layers, gauge/heat map/treemap rendering, alert rule creation, CSV report generation and the Maps app were seen only as menu entries, not run end to end.

### Key screenshots

**Field statistics popover (DISC-SIDEBAR-02)** — top values with ⊕/⊖, sample footer, Visualize.

&#91;image: Field statistics popover for log.level\]

**Pinned histogram tooltip (DISC-CHART-01)** — right-click: per-series checkboxes, Filter by time, Filter selected series.

&#91;image: Right-click actions on a stacked histogram bar\]

**Document flyout (DISC-DOC-01)** — push layout, prev/next, Table/JSON, pin and filter actions.

&#91;image: Document detail flyout\]

**Surrounding documents (DISC-DOC-02)** — disabled filter pill, highlighted anchor, Load 5 newer/older.

&#91;image: Surrounding documents view\]

**Patterns tab (DISC-PATTERNS-01)** — count, log-rate sparkline, highlighted tokens, filter actions.

&#91;image: Log pattern analysis\]

**Field statistics tab (DISC-FIELDSTATS-01)** — mini distributions, expanded numeric stats.

&#91;image: Field statistics tab with expanded numeric field\]

**Lens from Visualize (LENS-AUTO-01)** — auto bar chart and suggestions strip.

&#91;image: Lens opened from a keyword field\]

**Multi-dimension click (LENS-INTERACT-01)** — Select filters to apply.

&#91;image: Select filters to apply modal\]
