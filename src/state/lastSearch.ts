/**
 * The tab's last shared search context (#16c). Visualize opened with no search context in its URL
 * — Grafana's side-menu entry is a static link — restores the query, filters, time and data view
 * the user last had on any page of this tab. Kept in session storage (per tab, like pinned
 * filters). Stored text is untrusted: it is decoded and re-encoded through the URL codec, so it
 * gets exactly the validation a link gets.
 */
import { getDefaultTimeRange } from '@grafana/data';
import { decodeLogsState, encodeLogsState } from '../data/urlState';

export const LAST_SEARCH_KEY = 'clickhouse-observe.lastSearch';

/** URL params that make up the shared search context. */
export const SEARCH_CONTEXT_PARAMS = ['q', 'filters', 'from', 'to', 'ds'] as const;

export function hasSearchContext(sp: URLSearchParams): boolean {
  return SEARCH_CONTEXT_PARAMS.some((k) => sp.has(k));
}

/** Remember `sp`'s search context for this tab; URLs without one are ignored. */
export function rememberSearchContext(sp: URLSearchParams): void {
  if (!hasSearchContext(sp)) {
    return;
  }
  const keep = new URLSearchParams();
  for (const k of SEARCH_CONTEXT_PARAMS) {
    const v = sp.get(k);
    if (v !== null) {
      keep.set(k, v);
    }
  }
  try {
    window.sessionStorage.setItem(LAST_SEARCH_KEY, keep.toString());
  } catch {
    // Private mode / blocked storage: nothing to restore later.
  }
}

/**
 * The remembered context as URL params, validated like a link: malformed filters / time are
 * dropped, and a data view not in `viewIds` is dropped. undefined when nothing usable is stored.
 */
export function restoreSearchContext(viewIds: string[]): URLSearchParams | undefined {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(LAST_SEARCH_KEY);
  } catch {
    return undefined;
  }
  if (!raw) {
    return undefined;
  }
  const decoded = decodeLogsState(new URLSearchParams(raw));
  const enc = encodeLogsState({
    search: decoded.search ?? '',
    filters: decoded.filters ?? [],
    columns: [],
    timeRange: decoded.timeRange ?? getDefaultTimeRange(),
    viewId: decoded.viewId && viewIds.includes(decoded.viewId) ? decoded.viewId : undefined,
  });
  if (!decoded.timeRange) {
    enc.delete('from');
    enc.delete('to');
  }
  return hasSearchContext(enc) ? enc : undefined;
}
