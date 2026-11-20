# R2-SAVED (comparison round 2, findings 9 and 12)

## CHANGELOG
- Changed: opening or saving a saved search names the Discover tab after it (was "Untitled") and puts its id in the URL (`ss=<id>`). The id is cleared when the query, filters, columns or sort are changed, or the data view switched, and a link carrying only `ss` reopens the saved search in a fresh browser. The Share link keeps `ss`.
- Added: a "Store time range" checkbox in the Save search dialog (default on, as before); a search saved without it leaves the current time range alone when opened.
- Fixed: the delete (trash) button in the Saved searches menu has the accessible name "Delete saved search <title>".
- Changed: new shared saved searches are stored in a Grafana folder "Observe saved searches" (created on first save through the Grafana 12+ folder API); when the user cannot read, create or write it they go to General as before. Existing ones stay where they are and are still listed by tag across folders.

## DECISIONS
R2-SAVED. Supersedes the folder deferral in D50. Folder: documented API is `/apis/folder.grafana.app/v1/namespaces/{namespace}/folders` (Grafana 12+, the plugin requires 13; the legacy `/api/folders` is not in the current docs). The folder has a fixed uid (`observe-saved-searches`, the `metadata.name`), so it is found with GET by uid (no folder listing right needed), created with POST when missing (409 counts as found), the namespace is `config.namespace`. Any failure (read, create, or writing the dashboard into it) falls back to General, so users who cannot create folders behave exactly as before; only a success is cached. Listing is unchanged (tag search across folders). `ss` URL param: the id is validated against the generated shape (`ss_<ms>_<random>`) because the URL is untrusted. A link with `ss` and no query of its own (no q/filters/cols/sort) reopens the saved search (time from the link if present, else the stored one); a link with a query is trusted as is, and the lookup (title search by id, one dashboard read) only names the tab. The id is cleared by comparing search, filters (ignoring ids), column ids and sort to a baseline taken from the first state after the open; the time range is not part of it. Store time: default on to keep the earlier behaviour (Kibana defaults to off, but a saved search used to always carry its range and existing users expect it); off omits `timeRange`, and opening such a search keeps the current range.

## TESTING
| Area | Test | Where |
|---|---|---|
| Folder found / created once / General fallback (create denied, folder not writable); find by id; no stored time keeps range | jest | `src/data/__tests__/savedSearchesShared.test.ts` |
| `ss` encode/decode, malformed dropped; counts as tab state | jest | `src/data/__tests__/urlState.test.ts`, `src/state/__tests__/discoverTabs.test.ts` |
| Save: checkbox default on, tab named, `ss` in URL, folder, fresh load by id, edit clears `ss`, delete button name | e2e | `tests/features/feat-parity-minors.spec.ts` |
