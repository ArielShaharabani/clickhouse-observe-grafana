# DISC-NAV-01 pending notes (#31 Session tabs)

## CHANGELOG

### Added
- **Discover session tabs** (#31 DISC-NAV-01; spec 10-discover.md "Discover tabs"). A tab strip above the Discover toolbar keeps several explorations open in one browser tab, each with its own query, filters, columns, sort, time, data view, interval and breakdown. `+` opens a tab on the current data view; each tab has a ⋮ menu (Rename, Duplicate, Move left / right, Close) and a close button; double-click renames; tabs drag-reorder. The ⌄ menu lists Opened tabs and Recently closed tabs (with "17 seconds ago"-style times; click to restore) and Clear recently closed. The active tab is in the URL (`_tab`), so reload and back / forward land on it. Up to 20 tabs, 10 recently closed.
- Grafana's side-menu Discover entry (a URL with no state) reopens the active tab instead of an empty search. A link with Discover state but no `_tab` (shared link, Explore in Discover, trace deep link) loads into the active tab; a link with another session's `_tab` opens as a new tab.

## Decision

DISC-NAV-01. A tab IS the Discover URL state of one exploration (the same params a shared link carries), so tabs reuse the URL codec and every existing URL behaviour instead of a second state model. `DiscoverTabsHost` (`src/pages/DiscoverTabsHost.tsx`) is the `logs` route: it owns the tab list (session storage `clickhouse-observe.discoverTabs`, per browser tab like pinned filters and the last search), reads the active tab from `_tab`, and renders `LogsExplorer` keyed by the tab id — LogsExplorer decodes its URL once at mount, so a tab switch is a navigation to the target tab's params plus a remount. LogsExplorer itself only gained two props: `tabId` (kept as `_tab` in every URL it writes) and `tabStrip` (rendered above the toolbar); every URL write is saved back into the active tab, so the last search context (#16c) and the shared search state follow the active tab without changes. Stored tabs are untrusted: on load each tab's params are decoded and re-encoded through `decodeLogsState` / `encodeLogsState` (filters through `sanitizeFilterPills`, columns later through `sanitizeColumns` in LogsExplorer, unknown views and params dropped, inbound-only trace params dropped), ids must match `^[a-z0-9]{4,24}$`, titles are stripped of control characters and capped at 80 chars (rendered as text), and list sizes are capped. Not built: tab ⋮ "Inspect" (Diagnostics is already one click away in the toolbar) and "Switch to ES|QL" (ES|QL out of scope); tabs are per browser tab (session storage), not synced across browser tabs or devices.

## TESTING

| Case | Status |
| --- | --- |
| Model: sanitize round-trip, tampered store (bad ids, dup ids, unknown view / params, malformed filters, oversized params, control-char titles), caps, add / duplicate / close / restore / clear / rename / move, last tab can't close (jest `src/state/__tests__/discoverTabs.test.ts`) | ✅ |
| Host: link without `_tab` loads into the active tab; side-menu entry reopens the active tab; unknown `_tab` opens a new tab; switch / add / close keep each tab's state; rename Enter / Escape; tampered storage sanitized before the URL, titles rendered as text (jest `src/pages/__tests__/DiscoverTabsHost.test.tsx`, LogsExplorer mocked) | ✅ |
| E2E: tabs keep their own query and counts, `+` keeps the data view; duplicate = identical state; close → Recently closed ("seconds ago") → restore; rename survives reload and the side-menu link reopens the active tab; Visualize side-menu restore uses the active tab's context; tampered store never reaches the query (`tests/features/disc-nav-01.spec.ts`) | ⏳ written, not run (coordinator) |
