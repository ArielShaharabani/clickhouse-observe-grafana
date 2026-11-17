/**
 * Shared search context across app pages (spec SHARED-STATE-01/02/03, docs/spec/30-shared.md).
 *
 * The URL is the single source of truth for the search context (view, query, filters, time,
 * interval, breakdown) — the same model as Kibana's `_g`/`_a` params — so any page can be opened
 * from a link and every hand-off between pages is just a URL built here. The one exception is
 * *pinned* filters: like Kibana's global filters they follow the user to pages opened without
 * them, so they are also kept in per-tab session storage and merged in on load.
 */
import { EncodeLogsUrlStateInput, encodeLogsState } from '../data/urlState';
import { prefixRoute } from '../utils/utils.routing';
import { FilterPill } from '../types';

export const PINNED_FILTERS_KEY = 'clickhouse-observe.pinnedFilters';

export type AppPage = 'logs' | 'visualize';

/** Absolute in-app URL for `page` carrying the given search context. */
export function buildAppPageUrl(page: AppPage, state: EncodeLogsUrlStateInput): string {
  return `${prefixRoute(page)}?${encodeLogsState(state).toString()}`;
}

/** Pinned pills from session storage; [] when absent, corrupt or storage is unavailable. */
export function loadPinnedFilters(): FilterPill[] {
  try {
    const raw = window.sessionStorage.getItem(PINNED_FILTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as FilterPill[]).filter((f) => f && f.pinned) : [];
  } catch {
    return [];
  }
}

/** Persist the pinned subset of `filters` (replacing what was stored). Never throws. */
export function savePinnedFilters(filters: FilterPill[]): void {
  try {
    window.sessionStorage.setItem(PINNED_FILTERS_KEY, JSON.stringify(filters.filter((f) => f.pinned)));
  } catch {
    // Private mode / blocked storage: pinning then only lasts for the current URL.
  }
}

/** Same condition as an existing pill — field, operator and value(s) — ignoring id/label. */
function samePill(a: FilterPill, b: FilterPill): boolean {
  return (
    a.field === b.field &&
    a.op === b.op &&
    a.value === b.value &&
    JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? [])
  );
}

/**
 * URL filters plus any pinned pill not already present. An equivalent URL pill is marked pinned
 * instead of duplicated, so the pill keeps its position and id.
 */
export function mergePinnedFilters(urlFilters: FilterPill[], pinned: FilterPill[]): FilterPill[] {
  const result = urlFilters.map((f) => (pinned.some((p) => samePill(p, f)) ? { ...f, pinned: true } : f));
  for (const p of pinned) {
    if (!result.some((f) => samePill(f, p))) {
      result.push({ ...p, pinned: true });
    }
  }
  return result;
}
