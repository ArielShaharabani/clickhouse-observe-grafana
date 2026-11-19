# PARITY-MINORS pending notes

No SQL change. Untrusted input: saved-search payloads read from Grafana dashboards and localStorage go through `sanitizeSavedSearch` (name/search/description/tag length caps, filters through `sanitizeFilterPills`, sort/timeRange shape-checked, columns re-resolved against the view by `sanitizeColumns` on load, `sharedUid` taken only from the dashboard's own uid and checked with `isDashboardUid` before any API path). Dashboard titles/tags are plain strings sent as JSON. The breakdown field in the Discover link is a `col:` field id from the discovered field list, re-resolved by Discover.

## CHANGELOG

### Added
- **Shared saved searches (comparison #5).** "Save current" now stores the search as a panel-less Grafana dashboard tagged `observe-saved-search`, so every user who can see dashboards sees it in the Saved searches menu (like Kibana saved objects). Browser-only searches stay listed (marked "(this browser)"); if the viewer cannot create dashboards the search is saved in the browser and the menu says so.
- **Description and tags** in the save dialog; the description shows as the item's tooltip, tags as #tags.
- **Copy column** in the column header menu: copies every loaded value of the column, one per line.

### Fixed
- **Explore in Discover from Visualize keeps the chart's breakdown** (`bd=field:col:<expr>`) when the chart's top-values field is a known column (#38).

## Decision

Shared store: Grafana dashboards tagged `observe-saved-search`, payload in a custom top-level `observeSavedSearch` field, in the General folder. Chosen over plugin jsonData (needs admin to write), over a folder (creating folders needs more rights than creating a dashboard, and a fixed folder uid would have to be bootstrapped) and over user preferences/localStorage (not shared). Tag search (`/api/search?tag=`) lists them with the viewer's own permissions, so access control, audit history and delete rights are Grafana's. Cost: one GET per shared search on menu open (capped at 100). Legacy local searches are listed together, not migrated automatically (migration would publish private searches without consent). Title includes the generated id so equal names never collide (`name-exists`). Breakdown handoff: first terms bucket whose field is a `col:` field; map keys/expressions get none.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/data/__tests__/savedSearchesShared.test.ts`, `src/lens/__tests__/handoff.test.ts` (breakdown), `parityGrid.test.tsx` (Copy column) |
| E2E | `tests/features/feat-parity-minors.spec.ts` — not run (coordinator) |

## Deferred

- Editing/renaming a shared search in place; "migrate local searches to shared" action.
- Folder/permission choice for shared searches (General folder only).
