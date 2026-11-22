# R5-QUERYBAR

SQL impact: none. The Schema button reads the columns FieldsContext already loaded from `system.columns` (cached, escaped identifiers via `buildColumnsQuery`); no new query.

## CHANGELOG
- Discover and Visualize share one query bar component (`src/components/QueryBar.tsx`): data view picker, Schema button, Add filter, query menu, KQL search bar, with page-specific trailing controls. `lens/QueryRow.tsx` is now a thin wrapper.
- Visualize: the "Visualize" title left of the data view picker is removed; the picker moved into the query bar row (same place as Discover).
- New "Schema" button next to the data view picker (Discover and Visualize) opening a modal with the view's columns and ClickHouse types, with a filter box.

## Decision
- Kibana-like: data view picker leads the query row on both pages. Schema lists top-level columns only (not Map keys / JSON paths / tuple elements, which are not schema).
- Accessible names unchanged (`Search logs (KQL)`, `Add filter`, `lens-query-row` testid). New: button `Show schema`, table `Schema columns`, textbox `Filter schema columns`.

## TESTING
| Check | Result |
|---|---|
| jest `SchemaButton.test.tsx`, `queryRow.test.tsx` | pass |
| e2e `tests/features/r5-querybar.spec.ts` (Discover schema, Visualize bar/title) | not run (coordinator) |

## Deferred
- Schema modal shows no column comments/default expressions.
