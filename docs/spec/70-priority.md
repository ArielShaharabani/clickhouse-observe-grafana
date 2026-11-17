## Development priority

Build the shared search context, KQL/Lucene-style query bar, filter pills and click-to-filter actions first: almost every other feature writes into them. Importance is 1–5 (5 = most important). ES|QL is rated 1 because the target interface is a KQL/Lucene-like syntax, not a piped query language.

| Spec ID | Feature | Importance | Why | Tightly coupled to (importance) |
| --- | --- | --- | --- | --- |
| SHARED-STATE-01/02 | Search context + URL state | 5 | Every drilldown, handoff and filter reads and writes this one object, so it must exist before anything else. | DISC-FILTER-01 (5), DISC-SEARCH-02 (5), LENS-INTERACT-02 (4), DISC-TIME-01 (3) |
| DISC-SEARCH-02 | KQL/Lucene-style query bar with field and value autocomplete | 5 | It is the chosen way users ask questions, and autocomplete is what makes it usable without knowing the schema. | SHARED-STATE-01 (5), DISC-SIDEBAR-01 (4), DISC-FILTER-01 (5) |
| SHARED-AUTOCOMPLETE-01 | Autocomplete everywhere (fields, values, functions) | 5 | It is a principle every input must follow, so it is cheapest to build once as a shared service before the inputs that use it. | DISC-SEARCH-02 (5), DISC-SIDEBAR-01 (4), DISC-FILTER-02 (3), LENS-DIM-03 (3) |
| DISC-FILTER-01 | Filter pills (negate, disable, pin, label) | 5 | Every click-to-filter action lands here, so it is the backbone of exploration without typing. | SHARED-ACTION-01 (5), DISC-FILTER-02 (3), SHARED-STATE-01 (5) |
| SHARED-ACTION-01 | Filter for / out / copy on every value | 5 | It directly fixes the top pain point that you cannot filter from a table, and it is reused by tables, charts, legends and flyouts. | DISC-TABLE-02 (5), LENS-INTERACT-01 (4), DISC-FILTER-01 (5) |
| DISC-SIDEBAR-02 | Field statistics popover | 5 | It answers “what values does this field have?” in one click and is the single biggest gap versus Grafana. | DISC-SIDEBAR-01 (4), DISC-FILTER-01 (5), LENS-AUTO-01 (4), SHARED-PERF-01 (3) |
| DISC-TABLE-01/02 | Results grid with summary column and cell actions | 5 | It is where log investigation actually happens, and its cells are the most-used filter source. | SHARED-ACTION-01 (5), DISC-DOC-01 (4), DISC-SIDEBAR-01 (4) |
| DISC-SIDEBAR-01 | Field list (grouped, typed, searchable) | 4 | It is the entry point to field stats, columns and Lens, but a simple version is enough at first. | DISC-SIDEBAR-02 (5), DISC-TABLE-01 (5), LENS-AUTO-01 (4) |
| DISC-CHART-01 | Hits histogram with brush and series actions | 4 | It shows the time shape of the problem and turns a spike into a time filter with one drag. | DISC-TIME-01 (3), DISC-CHART-02 (3), SHARED-STATE-01 (5) |
| DISC-DOC-01 | Document flyout | 4 | Reading one event in full is a daily need, and Grafana's row expansion lacks navigation and pinning. | DISC-TABLE-02 (5), DISC-DOC-02 (3), SHARED-ACTION-01 (5) |
| LENS-AUTO-01 / LENS-SUGG-01 | Automatic chart choice + suggestions | 4 | It replaces the query builder's poor defaults with a correct first chart, which is the core of Lens's value. | LENS-TYPE-01 (4), LENS-DIM-01 (4), DISC-SIDEBAR-02 (5) |
| LENS-TYPE-01 | One-menu chart switching with remapping | 4 | It fixes the pain point that visualization types are hard to switch in Grafana. | LENS-AUTO-01 (4), LENS-DIM-01 (4) |
| LENS-DIM-01/02 | Dimension groups + metric editor (percentile, unique count, time shift) | 4 | It covers percentiles and similar functions that today force users into SQL. | LENS-DIM-04 (3), LENS-DIM-03 (3), LENS-AUTO-01 (4) |
| LENS-INTERACT-01 | Click a chart value to filter, with multi-dimension chooser | 4 | It keeps charts explorable instead of being dead ends. | SHARED-ACTION-01 (5), DISC-FILTER-01 (5) |
| LENS-INTERACT-02 / DISC-CHART-03 | Handoff Discover ↔ Lens (Visualize, Explore in Discover) | 4 | It is the bridge between searching and charting that the single-product assumption depends on. | SHARED-STATE-01 (5), LENS-SAVE-01 (4), DISC-SIDEBAR-02 (5) |
| LENS-SAVE-01 | Save chart to dashboard | 4 | Moving an ad hoc finding into an operational dashboard quickly is a stated base assumption. | LENS-INTERACT-02 (4), LENS-AUTO-01 (4) |
| DISC-TIME-01/02 | Time picker, shift, Update state | 3 | Grafana already has most of it; only shorthand input and the dirty-state cue are missing. | SHARED-STATE-01 (5), DISC-CHART-01 (4) |
| DISC-CHART-02 | Histogram breakdown + legend filters | 3 | It shows which value drives a spike, but users can get there through field stats first. | DISC-CHART-01 (4), DISC-SIDEBAR-02 (5), SHARED-ACTION-01 (5) |
| DISC-FILTER-02 | Filter builder popover (operators, OR/AND, DSL) | 3 | Needed for manual filters, but most filters will come from clicks. | DISC-FILTER-01 (5), DISC-SEARCH-02 (5) |
| DISC-DOC-02 | Surrounding documents | 3 | Very useful in incidents and simple to build with search\_after-style paging, but used less often. | DISC-DOC-01 (4), DISC-FILTER-01 (5) |
| DISC-PATTERNS-01 | Log pattern analysis | 3 | High value for noisy logs, but the costliest feature on ClickHouse, which has no built-in text categorization. | DISC-FILTER-01 (5), DISC-TABLE-01 (5) |
| DISC-FIELDSTATS-01 | Field statistics tab | 3 | Useful for profiling unknown data, and cheap once the popover backend exists. | DISC-SIDEBAR-02 (5), LENS-AUTO-01 (4) |
| LENS-DIM-03 | Formula editor | 3 | Ratios like error rate need it, but quick functions cover most questions. | LENS-DIM-02 (4), DISC-SEARCH-02 (5) |
| LENS-DIM-04 | Top values editor (size, rank, other, missing) | 3 | Defaults work for most cases; the options matter for high-cardinality fields. | LENS-DIM-01 (4), LENS-AUTO-01 (4) |
| SHARED-PERF-01 | Loading, sampling and cancel cues | 3 | Sample labels keep statistics trustworthy and loading cues keep large queries usable. | DISC-SIDEBAR-02 (5), DISC-PATTERNS-01 (3) |
| LENS-CHART-01 | Table and Metric chart specifics | 2 | Grafana's Table and Stat panels already cover most of this. | LENS-TYPE-01 (4) |
| LENS-STYLE-01 | Style and Legend panels | 2 | Grafana's panel options already cover axes and legends. | LENS-TYPE-01 (4) |
| LENS-LAYER-01 | Layers, annotations, reference lines | 2 | Mostly a dashboard concern that Grafana already handles. | LENS-DIM-01 (4) |
| LENS-INSPECT-01 | Inspector | 2 | Grafana's query inspector exists; only cell filter actions are new. | SHARED-ACTION-01 (5) |
| DISC-SEARCH-03 | Saved queries menu | 2 | Convenient, but Explore query history covers part of it. | DISC-SEARCH-02 (5), DISC-FILTER-01 (5) |
| DISC-NAV-01 | Session tabs | 2 | Nice for parallel investigations, not needed for the core workflow. | SHARED-STATE-01 (5) |
| DISC-SESSION-01 | Save, share, export, alert from search | 2 | Grafana already provides sharing and alerting elsewhere. | SHARED-STATE-01 (5) |
| SHARED-A11Y-01 | Keyboard and accessibility | 2 | Mostly inherited from Grafana's UI components. | DISC-TABLE-01 (5), LENS-DIM-01 (4) |
| DISC-ESQL-01 | ES | QL mode | 1 | Out of scope: the query interface will be KQL/Lucene-like, not a piped language. |
