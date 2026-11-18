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
 * 4. No `lens` → the draft saved for that view's datasource + table (LENS-SAVE-01).
 */
import { DataView, SourceConfig } from '../types';
import { mergePinnedFilters, StoredPin, tableKey } from '../state/sharedSearch';
import { hasSearchContext } from '../state/lastSearch';
import { encodeLens, LensState } from './state';

/** Scope of a Lens draft: the datasource + table a chart was built on. */
export function draftScopeOf(view: Pick<SourceConfig, 'datasourceUid' | 'database' | 'logsTable'>): string {
  return `${view.datasourceUid}|${tableKey(view.database, view.logsTable)}`;
}

export interface VisualizeEntryInput {
  params: URLSearchParams;
  views: DataView[];
  activeView: DataView | null;
  storedPins: StoredPin[];
  restoreContext: (viewIds: string[]) => URLSearchParams | undefined;
  loadDraft: (scope: string) => LensState | undefined;
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
  if (!sp.has('lens')) {
    const draft = input.loadDraft(draftScopeOf(view));
    if (draft) {
      sp.set('lens', encodeLens(draft));
    }
  }
  return { params: sp, view };
}
