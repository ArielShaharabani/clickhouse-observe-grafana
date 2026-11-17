/**
 * Shared search context across app pages (spec SHARED-STATE-01/02/03, docs/spec/30-shared.md).
 *
 * The URL is the single source of truth for the search context (view, query, filters, time,
 * interval, breakdown) — the same model as Kibana's `_g`/`_a` params — so any page can be opened
 * from a link and every hand-off between pages is just a URL built here.
 *
 * The one exception is *pinned* filters. Like Kibana's global filters they follow the user to
 * pages opened without filters, so they are also kept in per-tab session storage. Rules:
 * - The store changes only on explicit pin transitions: pin, unpin, editing or excluding a pinned
 *   pill (its condition is replaced), deleting a pinned pill. Disabling a pill and "Clear all"
 *   never touch the store, and other filter state never leaks into it.
 * - A pill is shown as pinned only if its condition is in *this user's* store; `pinned` flags
 *   arriving in someone else's link or saved search are ignored.
 * - Each stored pin remembers the table it was pinned on; applied to a view on another table it
 *   arrives disabled (its SQL expressions may not exist there).
 * - A link that carries `filters` is reproduced exactly; pins are merged only into pages opened
 *   without filters, into loaded saved searches and into a data view switch.
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

/** A stored pin: the pill's condition plus the table (`database.table`) it was pinned on. */
export interface StoredPin extends FilterPill {
  pinnedTable?: string;
}

/** `database.table` key used to tell whether a pin applies as-is to a view. */
export function tableKey(database: string, table: string): string {
  return `${database}.${table}`;
}

/** Stored pins; [] when absent, corrupt or storage is unavailable. */
export function loadPinnedFilters(): StoredPin[] {
  try {
    const raw = window.sessionStorage.getItem(PINNED_FILTERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredPin[]).filter((f) => f && f.pinned) : [];
  } catch {
    return [];
  }
}

function savePins(pins: StoredPin[]): void {
  try {
    window.sessionStorage.setItem(PINNED_FILTERS_KEY, JSON.stringify(pins));
  } catch {
    // Private mode / blocked storage: pinning then only lasts for the current URL.
  }
}

function toStoredPin(pill: FilterPill, table: string): StoredPin {
  // The pin is the condition; per-page state (disabled) is not part of it.
  const { disabled: _disabled, ...rest } = pill;
  return { ...rest, pinned: true, pinnedTable: table };
}

/** Pin `pill` (replacing any stored pin with the same condition). One storage read + write. */
export function pinFilterInStore(pill: FilterPill, table: string): void {
  savePins([...loadPinnedFilters().filter((p) => !samePill(p, pill)), toStoredPin(pill, table)]);
}

/** Remove the stored pin with `pill`'s condition. */
export function unpinFilterInStore(pill: FilterPill): void {
  savePins(loadPinnedFilters().filter((p) => !samePill(p, pill)));
}

/** A pinned pill's condition changed (edit / exclude): replace the stored pin in one write. */
export function replacePinInStore(before: FilterPill, after: FilterPill, table: string): void {
  savePins([
    ...loadPinnedFilters().filter((p) => !samePill(p, before) && !samePill(p, after)),
    toStoredPin(after, table),
  ]);
}

function asPill(pin: StoredPin): FilterPill {
  const { pinnedTable: _t, ...pill } = pin;
  return pill;
}

/** Show a pill as pinned only if this user's store has its condition (ignores foreign flags). */
export function normalizePinnedFlags(filters: FilterPill[], stored: StoredPin[]): FilterPill[] {
  return filters.map((f) => {
    const pinned = stored.some((p) => samePill(p, f));
    if (pinned === !!f.pinned) {
      return f;
    }
    const { pinned: _p, ...rest } = f;
    return pinned ? { ...rest, pinned: true } : rest;
  });
}

/**
 * `filters` (pin flags normalized) plus every stored pin not already present. An appended pin is
 * disabled when it was pinned on a different table than `table`; an appended pin whose id collides
 * with an existing pill gets a fresh id.
 */
export function mergePinnedFilters(filters: FilterPill[], stored: StoredPin[], table: string): FilterPill[] {
  const result = normalizePinnedFlags(filters, stored);
  for (const pin of stored) {
    if (result.some((f) => samePill(f, pin))) {
      continue;
    }
    const pill = asPill(pin);
    const id = result.some((f) => f.id === pill.id) ? nextId() : pill.id;
    const otherTable = !!pin.pinnedTable && pin.pinnedTable !== table;
    result.push({ ...pill, id, pinned: true, ...(otherTable ? { disabled: true } : {}) });
  }
  return result;
}
