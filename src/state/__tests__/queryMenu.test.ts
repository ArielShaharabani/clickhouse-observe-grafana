import { FilterPill } from '../../types';
import { applicableActions, applyToAll, applyToAllPins } from '../queryMenu';
import { loadPinnedFilters } from '../sharedSearch';

const a: FilterPill = { id: 'a', field: 'ServiceName', op: '=', value: 'payments' };
const b: FilterPill = { id: 'b', field: 'SeverityText', op: '!=', value: 'debug', disabled: true };
const c: FilterPill = { id: 'c', field: 'Body', op: 'contains', value: 'timeout', pinned: true };

beforeEach(() => window.sessionStorage.clear());

describe('Apply to all (DISC-SEARCH-03)', () => {
  it('enable / disable / pin / unpin / invert every pill', () => {
    const all = [a, b, c];
    expect(applyToAll(all, 'enable').every((f) => !f.disabled)).toBe(true);
    expect(applyToAll(all, 'disable').every((f) => f.disabled)).toBe(true);
    expect(applyToAll(all, 'pin').every((f) => f.pinned)).toBe(true);
    expect(applyToAll(all, 'unpin').every((f) => !f.pinned)).toBe(true);
    expect(applyToAll(all, 'invert').map((f) => f.op)).toEqual(['!=', '=', 'not_contains']);
    // Untouched pills keep their identity (no needless re-render / pin churn).
    expect(applyToAll(all, 'enable')[0]).toBe(a);
  });

  it('only offers actions that change something', () => {
    expect(applicableActions([])).toEqual([]);
    expect(applicableActions([a])).toEqual(['disable', 'pin', 'invert']);
    expect(applicableActions([b, c])).toEqual(['enable', 'disable', 'pin', 'unpin', 'invert']);
  });

  it('mirrors pin / unpin / invert into the pinned store (D7)', () => {
    const table = 'default.otel_logs';
    let before = [a, b];
    let after = applyToAll(before, 'pin');
    applyToAllPins(before, after, 'pin', table);
    expect(loadPinnedFilters().map((p) => [p.field, p.pinnedTable])).toEqual([
      ['ServiceName', table],
      ['SeverityText', table],
    ]);
    // The pin is the condition: per-page disabled state is not stored.
    expect(loadPinnedFilters()[1].disabled).toBeUndefined();

    before = after;
    after = applyToAll(before, 'invert');
    applyToAllPins(before, after, 'invert', table);
    expect(
      loadPinnedFilters()
        .map((p) => p.op)
        .sort()
    ).toEqual(['!=', '=']);
    expect(loadPinnedFilters().find((p) => p.field === 'ServiceName')!.op).toBe('!=');

    before = after;
    after = applyToAll(before, 'unpin');
    applyToAllPins(before, after, 'unpin', table);
    expect(loadPinnedFilters()).toEqual([]);
  });
});
