## Preamble

Discover and Lens work because every value on screen is a clickable entry point into the next question, and the query, filters and time range follow the user between views. This spec breaks that down feature by feature so it can be fed to a code generator to build equivalent Grafana plugins. Observations come from hands-on use of Kibana 9.5.5 with web-log sample data and a synthetic OpenTelemetry-style log and metrics set.

### Design principles

1. **Zero-config start.** Pick a data source and you see documents, a histogram and a field list immediately. No query, panel or chart type has to be chosen first.
2. **Every value is an action.** Field names, top values, table cells, chart bars, legend items and flyout rows all offer filter-for, filter-out, or visualize.
3. **Progressive disclosure.** Summary first (field list, top-5 values), detail on demand (popover, flyout, full field statistics, Inspect).
4. **Data-driven suggestions.** The tool proposes the chart from the field type and cardinality; the user corrects it instead of building from scratch.
5. **One shared context.** Query, filters, time range and data view are a single state object carried by the URL across Discover, Lens and dashboards.
6. **Reversible, visible state.** Each filter is a pill you can disable, negate, pin or edit without retyping the query.
7. **Sample-honest statistics.** Field stats say what they are computed on (for example, 500 sampled documents) so users can judge confidence.
8. **Logs-native affordances.** Log-level colouring, message summary column, surrounding-documents context and pattern grouping treat logs as first-class, not as generic rows.
9. **Inspectability.** Every panel can show the exact request, response and timings that produced it.
10. **Fast feedback.** Loading bars, partial results, cancel buttons and debounced autocomplete keep exploration interactive on large data.
11. **Autocomplete everywhere.** Every input that names a field, value, function or command suggests the real options: fields with their types, values taken from the data in the current time range, functions with their signatures. This is a cross-cutting requirement (SHARED-AUTOCOMPLETE-01) to verify in every feature, not a property of the query bar alone.

### Glossary

| Term | Meaning | Grafana analogue |
| --- | --- | --- |
| Data view | Named index pattern + time field + field formats and runtime fields | Data source + default query / ad-hoc dataset |
| KQL | Kibana Query Language, a field:value text query with autocomplete | Lucene/LogQL query editor |
| ES\|QL | Piped query language whose result columns drive the table and chart | SQL-style query editors |
| Filter pill | A structured filter shown as a removable chip under the query bar | Ad-hoc filter variable chip |
| Unified search | The query bar + filter bar + time picker shared by every app | Explore toolbar + dashboard variables |
| Breakdown | Splitting a histogram or chart by top values of a field | Group by / legend split |
| Suggestion | An alternative chart Lens proposes from the current dimensions | (none built in) |
| Drilldown | An action triggered from a chart or cell click: filter, navigate, open URL | Data links / panel links |

### How to use this spec as a code-generation prompt

Feed one feature section at a time together with sections 4 (state model) and 8 (blueprint), so the generator has the shared interfaces. Each feature uses the same template, and its acceptance criteria can be turned directly into tests.

### Per-feature template

- **ID & name** — stable ID such as `DISC-SIDEBAR-03`.
- **Purpose** — the user question it answers.
- **Placement** — region, alignment, icon, label and tooltip text.
- **Interaction** — click, hover, drag and keyboard behaviour, step by step.
- **States** — default, loading, empty, error, disabled, overflow.
- **Defaults & options** — exact observed values.
- **Data** — the backend request issued (from Inspect), sampling and limits.
- **Side effects** — filters added, URL changes, navigation, shared state.
- **Edge cases** — high cardinality, missing values, arrays, nested and multi-fields.
- **Acceptance criteria** — testable bullets.
- **Grafana mapping** — how to build it and what exists today.
