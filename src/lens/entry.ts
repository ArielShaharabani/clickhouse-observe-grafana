/**
 * How Visualize opens (#16b / #16c): one pure function builds the URL the page settles on, so
 * every mount-time adjustment lands in ONE URL update (two setSearchParams calls in a row each
 * start from the render-time params, and the second would drop the first's change).
 *
 * Order:
 * 1. No search context in the URL (Grafana's side-menu link) → the tab's last context (#16c).
 * 2. The data view: the URL's `ds` when it names a known view, else the active view; `ds` is then
 *    always written, so the URL names the view the chart is built on.
 * 3. No `filters` → stored pinned filters (D7: disabled when pinned on another table).
 *
 * The chart itself (`lens`) comes only from the URL: a fresh open (the side-menu link) starts with
 * an empty workspace, as Kibana's Lens does; a reload keeps the chart because the URL carries it
 * (round 3 #19 — the per-tab draft that used to refill an open without `lens` is gone).
 */
import { DataView } from '../types';
import { mergePinnedFilters, StoredPin, tableKey } from '../state/sharedSearch';
import { hasSearchContext } from '../state/lastSearch';

export interface VisualizeEntryInput {
  params: URLSearchParams;
  views: DataView[];
  activeView: DataView | null;
  storedPins: StoredPin[];
  restoreContext: (viewIds: string[]) => URLSearchParams | undefined;
}

export interface VisualizeEntry {
  params: URLSearchParams;
  /** The view the page must be on; undefined when there are no views at all. */
  view?: DataView;
}

export function visualizeEntry(input: VisualizeEntryInput): VisualizeEntry {
  const sp = new URLSearchParams(input.params);
  if (!hasSearchContext(sp)) {
    input.restoreContext(input.views.map((v) => v.id))?.forEach((v, k) => sp.set(k, v));
  }
  const view = input.views.find((v) => v.id === sp.get('ds')) ?? input.activeView ?? undefined;
  if (!view) {
    sp.delete('ds');
    return { params: sp };
  }
  sp.set('ds', view.id);
  if (!sp.has('filters')) {
    const pins = mergePinnedFilters([], input.storedPins, tableKey(view.database, view.logsTable));
    if (pins.length > 0) {
      sp.set('filters', JSON.stringify(pins));
    }
  }
  return { params: sp, view };
}
