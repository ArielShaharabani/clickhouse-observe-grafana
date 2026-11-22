# R5-TABS pending notes

**No SQL change.** No query text, builder or escaping is touched; queries are only aborted earlier (client side). No new untrusted input.

Root cause: Grafana's frontend `backend_srv` runs at most 5 `/api/ds/query` requests at once when the server has no HTTP/2 (`FetchQueueWorker`: `http2Enabled ? 1000 : 5`, verified in Grafana 13.0.2's served bundle) and queues the rest. Discover remounts on every session-tab switch (and on leaving for Visualize), but `LogsExplorer` never aborted its list / histogram / count queries on unmount, so a slow tab kept its slots and every query of the next tab (or Visualize) waited behind them. Unsubscribing a request frees its slot (`fetchQueue.setDone` + the fetch abort), which is what the existing abort signals already do.

## CHANGELOG

### Fixed
- **A slow or stuck Discover tab no longer stalls the other tabs or Visualize.** Leaving a tab (switching, closing, opening another page) stops waiting for its queries, which frees Grafana's few concurrent query slots and drops results nobody shows.

## Decision

R5-TABS (user item 4: "if the first tab in discover is stuck then all others are as well … same with visualize"). Only the active Discover tab is mounted (unchanged), so "inactive tabs must not query or hold results" already held; the gap was that the unmounted tab's in-flight requests kept running. `useAbortOnUnmount` (`src/data/abortOnUnmount.ts`) aborts the latest list / histogram controllers and bumps their run ids when `LogsExplorer` unmounts; `useFieldDiscovery` bumps its run id on unmount so a gone page starts no Map-key samples. Shared, deduped metadata reads (system.columns, JSON paths, skip indexes) are deliberately not aborted: another tab may be waiting on the same promise and they are cheap. Visualize already aborted its chart / layer queries on unmount. Memory was not the cause: one tab's rows are held at a time; the tab list stores URL params only. Not changed: ClickHouse keeps executing an abandoned query (HTTP protocol; probed `cancel_http_readonly_queries_on_client_close` as a query setting and a URL parameter, neither stopped a running `sleepEachRow` query).

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/data/__tests__/abortOnUnmount.test.tsx` (a fake datasource with Grafana's 5-slot queue: a stuck tab's 6 queries hold every slot, switching tabs frees them and the next tab answers; the leaky variant stays blocked; the hook aborts only the latest controller, on unmount only), `src/components/__tests__/FieldsContext.test.tsx` (no Map-key samples after unmount) |
| E2E | `tests/features/r5-tabs.spec.ts` (stuck tab held via `page.route`, New tab answers, stuck requests aborted) — not run (coordinator) |

## Deferred
- Server-side cancellation of abandoned queries (`KILL QUERY` by a tagged `query_id` / `log_comment`; needs the KILL grant).
- On-demand popover queries (field top values, Map keys) and "Search entire time range" take no abort signal; they are LIMIT-sampled and short.
