# R6-PANELS: Edit in Visualize on any dashboard panel, Open panel

SQL impact: none. Visualize still compiles its own queries; the importer only builds a Lens state, filter pills and a search from the panel (SQL text is read, never executed or re-emitted).

## CHANGELOG
- Visualize: the panel menu's "Edit in Visualize" is on every saved dashboard panel. Panels not made in Visualize are converted when Visualize opens (the link carries only the dashboard, panel and time, no SQL): raw-SQL and builder targets of the ClickHouse data source (one SELECT from one table: date buckets, top values, count / unique / sum / avg / min / max / median / percentile / standard deviation, GROUP BY, ORDER BY, LIMIT, simple AND conditions as filter pills), and panels exported from Discover (volume histogram). Chart type, unit, decimals, legend and gauge range carry over.
- Visualize: when a panel is not fully converted, a short note says so and offers the original query (read only, copyable). Joins, subqueries, CTEs, UNION, window functions, HAVING, OR, template variables, several queries, other data sources and other panel types give an empty chart with the reason.
- Visualize: any Save and return of a panel that was not fully converted (or could not be) first asks "Replace the original panel?", listing what would be lost, with "Save as new panel" (adds to the same dashboard, original untouched; primary), "Replace anyway" (version lock kept) and Cancel. Fully converted panels still save in one click. Opening a panel never changes the dashboard.
- Visualize: new "Open panel" action (next to Share / Save): pick a dashboard and a panel (rows included, with type; panels that cannot be converted are marked and say why).
- Dashboards in the newer v2 schema give a clear message instead of an error.

## Decision
- Link: `Edit in Visualize` shows for any panel with a dashboard uid and panel id (Grafana cannot disable a link). Panels with `observeVisualize` keep the old link (state in the URL). Others get `pi=<token>` (apply) which Visualize rewrites to `pi=<token>.k` after writing `ds`, `lens`, `q`, `filters` once; a reload keeps `.k`, re-runs the analysis for the warning and leaves the URL alone.
- Order on the page: the data view is switched first (the page's own view switch rewrites filters), then the URL is written, then `finishImport` (fields known) drops dimensions on missing fields and reports them. Nothing parsed is trusted: fields pass `sanitizeLens` / the discovered-field allow list, pills `sanitizeFilterPills`, state `decodeLens`.
- "Lossless" is conservative: any field override, transformation, non-default threshold / colour / custom option, link, repeat, unmapped option, library panel, extra target or a condition / column that was not carried is listed and makes the import partial. `replacePanelInDashboard` replaces the whole panel, so exactly that list is what is dropped.
- Unsupported panels are not blocked (user refinement): menu link and picker allow them; the replace goes through the same warning.
- The warning mentions Grafana's version history only because the e2e checks that saving adds a dashboard version.
- Parser: small tokenizer + recursive-descent reader (`sqlRead.ts`), bounded (20 000 characters, 4 000 tokens, nesting 40); anything unknown throws and becomes a reason.

## TESTING
| Check | Where | Result |
|---|---|---|
| Tokenizer, parser rejects, importer (supported, partial, unsupported, hostile) | src/lens/__tests__/panelImport.test.ts | jest |
| Replace warning on every save path, link shape | src/lens/__tests__/replaceWarning.test.tsx | jest |
| Menu → import → Save and return / Save as new / Replace anyway / Open panel | tests/features/r6-panels.spec.ts | see report |

## Deferred
- Library panels are read from `/api/library-elements` when opened; the picker lists them as "library panel" without a conversion preview.
- `sumIf`-style conditional aggregates, arithmetic on aggregates (formulas), `LIKE` patterns other than `%text%`, ORDER BY on non-ranked columns, Discover logs tables: reported, not converted.
- Dashboards in the v2 schema: message only.
