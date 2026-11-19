/**
 * DISC-SESSION-01 share modal: the link for "Share this Discover session".
 *
 * Discover keeps the address bar in sync with encodeLogsState (urlState.ts), so the shared link is
 * built from the current query string, restricted to the codec's own parameters (anything else on
 * the URL — e.g. a one-shot trace hand-off — is dropped). With "Use absolute time range" the
 * relative `from` / `to` (`now-15m`) are replaced by the epoch-ms bounds the page is showing, the
 * same absolute form the codec already writes for brushed ranges.
 */
import { TimeRange } from '@grafana/data';
import { LogsQueryState, SavedSearch, SelectedColumn } from '../types';

/** Parameters encodeLogsState writes; the only ones a shared link carries. */
export const SHAREABLE_PARAMS = ['q', 'filters', 'cols', 'sort', 'from', 'to', 'ds', 'interval', 'bd'] as const;

export function isRelativeRange(timeRange: TimeRange): boolean {
  const { from, to } = timeRange.raw;
  return (typeof from === 'string' && from.startsWith('now')) || (typeof to === 'string' && to.startsWith('now'));
}

/** Parameters a shared Visualize link carries: the chart and the shared search context. */
export const VISUALIZE_SHAREABLE_PARAMS = ['lens', 'q', 'filters', 'from', 'to', 'ds'] as const;

export function buildShareUrl(
  currentHref: string,
  timeRange: TimeRange,
  absolute: boolean,
  params: readonly string[] = SHAREABLE_PARAMS
): string {
  const url = new URL(currentHref);
  const sp = new URLSearchParams();
  for (const k of params) {
    const v = url.searchParams.get(k);
    if (v !== null) {
      sp.set(k, v);
    }
  }
  if (absolute) {
    sp.set('from', String(timeRange.from.valueOf()));
    sp.set('to', String(timeRange.to.valueOf()));
  }
  const qs = sp.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`;
}

function sameColumns(a: SelectedColumn[] | undefined, b: SelectedColumn[] | undefined): boolean {
  const ids = (cols: SelectedColumn[] | undefined) => (cols ?? []).map((c) => c.id).join('\u0000');
  return ids(a) === ids(b);
}

function sameFilters(a: LogsQueryState['filters'], b: LogsQueryState['filters'] | undefined): boolean {
  const norm = (fs: LogsQueryState['filters'] | undefined) =>
    JSON.stringify((fs ?? []).map((f) => ({ ...f, id: undefined })));
  return norm(a) === norm(b);
}

/**
 * "You have unsaved changes": true when no saved search of this view matches the current query,
 * filters, columns and sort (the time range is not part of the comparison — a saved search keeps
 * its own, and sharing always sends the current one).
 */
export function hasUnsavedChanges(
  state: Pick<LogsQueryState, 'search' | 'filters' | 'columns' | 'sort'>,
  saved: SavedSearch[],
  viewId?: string
): boolean {
  return !saved.some(
    (s) =>
      (!viewId || !s.dataViewId || s.dataViewId === viewId) &&
      (s.search ?? '') === state.search &&
      sameFilters(state.filters, s.filters) &&
      sameColumns(state.columns, s.columns) &&
      (s.sort?.col ?? '') === (state.sort?.col ?? '') &&
      (s.sort?.dir ?? '') === (state.sort?.dir ?? '')
  );
}
