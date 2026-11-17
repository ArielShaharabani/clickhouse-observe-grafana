/**
 * Shared search context across app pages (spec SHARED-STATE-01/02/03, docs/spec/30-shared.md).
 *
 * The URL is the single source of truth for the search context (view, query, filters, time,
 * interval, breakdown) — the same model as Kibana's `_g`/`_a` params — so any page can be opened
 * from a link and every hand-off between pages is just a URL built here. The one exception is
 * *pinned* filters: like Kibana's global filters they follow the user to pages opened without
 * them, so they are also kept in per-tab session storage. The store changes only on explicit
 * pin/unpin/delete actions, and pins are merged only into pages whose URL has no `filters` param,
 * so a shared link with filters always reproduces exactly what the sender saw.
 */
import { EncodeLogsUrlStateInput, encodeLogsState } from '../data/urlState';
import { prefixRoute } from '../utils/utils.routing';
import { FilterPill } from '../types';
import { nextId, samePill } from '../sql/filters';

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

/**
 * URL filters plus any pinned pill not already present (same condition = `samePill` from
 * sql/filters.ts: field, operator, value or value set). An equivalent URL pill is marked pinned
 * instead of duplicated. An appended pill whose id collides with a URL pill gets a fresh id.
 */
export function mergePinnedFilters(urlFilters: FilterPill[], pinned: FilterPill[]): FilterPill[] {
  const result = urlFilters.map((f) => (pinned.some((p) => samePill(p, f)) ? { ...f, pinned: true } : f));
  for (const p of pinned) {
    if (!result.some((f) => samePill(f, p))) {
      const id = result.some((f) => f.id === p.id) ? nextId() : p.id;
      result.push({ ...p, id, pinned: true });
    }
  }
  return result;
}

/** Add `pill` to the pinned store (explicit user action). */
export function pinFilterInStore(pill: FilterPill): void {
  const current = loadPinnedFilters().filter((p) => !samePill(p, pill));
  savePinnedFilters([...current, { ...pill, pinned: true }]);
}

/** Remove `pill` (by condition) from the pinned store — on unpin or when a pinned pill is deleted. */
export function unpinFilterInStore(pill: FilterPill): void {
  savePinnedFilters(loadPinnedFilters().filter((p) => !samePill(p, pill)));
}

/**
 * Pinned pills carried into another data view. Pills reference SQL expressions of the previous
 * table, so on a different table they arrive disabled (visible, re-enable to apply) instead of
 * breaking the first query with an unknown column.
 */
export function carryPinnedToView(pinned: FilterPill[], sameTable: boolean): FilterPill[] {
  return sameTable ? pinned : pinned.map((p) => ({ ...p, disabled: true }));
}

/**
 * Bring the pinned store in line after any pill change (pin, unpin, edit, exclude, disable,
 * delete, clear all): pinned pills that disappeared, were unpinned or changed condition are
 * removed under their old condition; every pinned pill in `next` is (re)stored as it is now.
 */
export function syncPinnedStore(prev: FilterPill[], next: FilterPill[]): void {
  for (const p of prev) {
    if (!p.pinned) {
      continue;
    }
    const n = next.find((f) => f.id === p.id);
    if (!n || !n.pinned || !samePill(n, p)) {
      unpinFilterInStore(p);
    }
  }
  for (const n of next) {
    if (n.pinned) {
      pinFilterInStore(n);
    }
  }
}
