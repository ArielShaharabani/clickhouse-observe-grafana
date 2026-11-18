# DISC-SEARCH-03 pending notes (#30, Query menu)

## CHANGELOG

### Added
- **Query menu** (#30, DISC-SEARCH-03; spec 10-discover.md "Query menu"). A ⋮ button left of the Discover query input:
  - **Apply to all** — Enable all, Disable all, Pin all, Unpin all, Invert inclusion (only the items that change something are listed). Pin / unpin / invert update the pinned store (D7) like the pill menu does.
  - **Clear all** — clears the query and every filter on this page (stored pins are kept, same as the pill bar's Clear all).
  - **Load query** — saved queries for the active data view (plus view-less ones), by name, with their description.
  - **Save query** — name (unique per view, case-insensitive: "Name conflicts with an existing saved query"), description, **Include filters**, **Include time filter**. After a load the menu offers **Save changes to "…"** and **Save as new query**.
  - **Manage saved queries** — list with delete.
  - **Language** — KQL (checked); Lucene listed as not supported.
- Saved queries are lighter than saved searches (query + filters + optional time; no columns / sort) and live in localStorage (`poortuna-clickhouse-observe:saved-queries`).

### Security
- Saved queries read back from storage are rebuilt field by field (`sanitizeSavedQuery`): filters through `sanitizeFilterPills`, a time range kept only when both ends are `now…` math or epoch milliseconds, size caps on name / query / description / entry count; the page re-sanitizes filters before applying them.
- **Saved searches** (pre-existing): loading one now also runs its filters through `sanitizeFilterPills` (columns were already rebuilt by `sanitizeColumns`).

## Decision

DISC-SEARCH-03. A saved *query* is a separate, lighter object than the existing saved *search* (the SQL bar's "Saved" menu, which also stores columns, sort and time and belongs to DISC-SESSION-01): Kibana keeps the two apart the same way. Storage is per browser (localStorage), scoped to the data view like saved searches. Everything read from storage is untrusted (`src/data/savedQueries.ts`). "Apply to all" is pure (`src/state/queryMenu.ts`) with a separate pin-store mirror so pins follow D7: pin stores each newly pinned condition on the active table, unpin removes, invert replaces the stored condition. Clear all is page-only like the pill bar's Clear all (stored pins stay; they return on the next page). Lucene is listed but disabled — the query language is KQL only (ES|QL / Lucene out of scope). The menu reuses Grafana's `Dropdown` + `Menu` (sub-menus open on hover / ArrowRight).

## TESTING

| Case | Status |
| --- | --- |
| Saved queries store: add / update / delete, sort by name, data-view scoping, case-insensitive name conflict (jest `savedQueries.test.ts`) | ✅ |
| Hostile storage: malformed entries dropped, bad filter ops / non-string values dropped, SQL-ish time bounds dropped, oversize entries dropped, corrupt JSON → [] (jest `savedQueries.test.ts`) | ✅ |
| Apply to all: enable / disable / pin / unpin / invert, applicable items only, pinned-store mirror for pin / invert / unpin (jest `queryMenu.test.ts`) | ✅ |
| Menu: save with filters + time and load back, Save changes / Save as new after load, duplicate name rejected, Apply to all + Clear all callbacks, KQL / Lucene section (jest `QueryMenu.test.tsx`) | ✅ |
| E2E: save → Clear all → load restores query + filters and counts; duplicate name; Apply to all disable / enable / invert counts; hostile stored query sanitized on load; language section (`tests/features/disc-search-03.spec.ts`) | ⏳ coordinator |
