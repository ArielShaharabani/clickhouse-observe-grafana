/**
 * Query menu bulk actions (DISC-SEARCH-03 "Apply to all"). Pure: each returns the new filter list;
 * the pinned store is updated by the caller for pin / unpin (see applyToAllPins).
 */

import { FilterPill } from '../types';
import { negateFilter } from '../sql/filters';
import { pinFilterInStore, replacePinInStore, unpinFilterInStore } from './sharedSearch';

export type ApplyToAllAction = 'enable' | 'disable' | 'pin' | 'unpin' | 'invert';

export function applyToAll(filters: FilterPill[], action: ApplyToAllAction): FilterPill[] {
  switch (action) {
    case 'enable':
      return filters.map((f) => (f.disabled ? { ...f, disabled: false } : f));
    case 'disable':
      return filters.map((f) => (f.disabled ? f : { ...f, disabled: true }));
    case 'pin':
      return filters.map((f) => (f.pinned ? f : { ...f, pinned: true }));
    case 'unpin':
      return filters.map((f) => (f.pinned ? { ...f, pinned: false } : f));
    case 'invert':
      return filters.map((f) => ({ ...f, ...negateFilter(f) }));
  }
}

/**
 * Mirrors a bulk action into the pinned store (D7): pin stores every pill that was not pinned yet
 * on `table`; unpin removes every pinned pill; invert replaces a pinned pill's stored condition.
 */
export function applyToAllPins(before: FilterPill[], after: FilterPill[], action: ApplyToAllAction, table: string): void {
  if (action === 'pin') {
    before.forEach((f) => {
      if (!f.pinned) {
        pinFilterInStore({ ...f, pinned: true }, table);
      }
    });
  } else if (action === 'unpin') {
    before.forEach((f) => {
      if (f.pinned) {
        unpinFilterInStore(f);
      }
    });
  } else if (action === 'invert') {
    before.forEach((f, i) => {
      if (f.pinned) {
        replacePinInStore(f, after[i], table);
      }
    });
  }
}

/** Which "Apply to all" items make sense for the current pills (others are hidden). */
export function applicableActions(filters: FilterPill[]): ApplyToAllAction[] {
  if (filters.length === 0) {
    return [];
  }
  const out: ApplyToAllAction[] = [];
  if (filters.some((f) => f.disabled)) {
    out.push('enable');
  }
  if (filters.some((f) => !f.disabled)) {
    out.push('disable');
  }
  if (filters.some((f) => !f.pinned)) {
    out.push('pin');
  }
  if (filters.some((f) => f.pinned)) {
    out.push('unpin');
  }
  out.push('invert');
  return out;
}
