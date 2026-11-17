import { dateTime, rangeUtil } from '@grafana/data';
import { decodeLogsState, encodeLogsState } from '../../data/urlState';
import { FilterPill } from '../../types';
import {
  buildAppPageUrl,
  carryPinnedToView,
  loadPinnedFilters,
  mergePinnedFilters,
  pinFilterInStore,
  savePinnedFilters,
  unpinFilterInStore,
  PINNED_FILTERS_KEY,
} from '../sharedSearch';

const range = rangeUtil.convertRawToRange({ from: 'now-7d', to: 'now' });
const pill = (id: string, extra: Partial<FilterPill> = {}): FilterPill => ({ id, field: 'SeverityText', op: '=', value: id, ...extra });

describe('SHARED-STATE-02: interval and breakdown in the URL', () => {
  it('round-trips a non-auto interval', () => {
    const sp = encodeLogsState({ search: '', filters: [], columns: [], timeRange: range, interval: 'hour' });
    expect(sp.get('interval')).toBe('hour');
    expect(decodeLogsState(sp).interval).toBe('hour');
  });

  it('omits the default auto interval and ignores unknown values', () => {
    expect(encodeLogsState({ search: '', filters: [], columns: [], timeRange: range, interval: 'auto' }).has('interval')).toBe(false);
    expect(decodeLogsState(new URLSearchParams('interval=fortnight')).interval).toBeUndefined();
  });

  it.each([
    [{ kind: 'none' as const }, 'none'],
    [{ kind: 'severity' as const }, 'severity'],
    [{ kind: 'field' as const, fieldId: 'map:LogAttributes:http.method' }, 'field:map:LogAttributes:http.method'],
  ])('round-trips breakdown %j as bd=%s', (breakdown, raw) => {
    const sp = encodeLogsState({ search: '', filters: [], columns: [], timeRange: range, breakdown });
    expect(sp.get('bd')).toBe(raw);
    expect(decodeLogsState(sp).breakdown).toEqual(breakdown);
  });

  it('omits breakdown when the user never chose one and drops malformed values', () => {
    expect(encodeLogsState({ search: '', filters: [], columns: [], timeRange: range }).has('bd')).toBe(false);
    expect(decodeLogsState(new URLSearchParams('bd=field:')).breakdown).toBeUndefined();
    expect(decodeLogsState(new URLSearchParams('bd=bogus')).breakdown).toBeUndefined();
  });

  it('keeps the pinned flag on filter pills through the URL', () => {
    const sp = encodeLogsState({ search: '', filters: [pill('error', { pinned: true })], columns: [], timeRange: range });
    expect(decodeLogsState(sp).filters?.[0].pinned).toBe(true);
  });
});

describe('SHARED-STATE-01: pinned filters follow the user across pages', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('saves only pinned pills and loads them back', () => {
    savePinnedFilters([pill('a', { pinned: true }), pill('b')]);
    expect(loadPinnedFilters().map((f) => f.id)).toEqual(['a']);
  });

  it('returns [] when storage is empty or corrupt', () => {
    expect(loadPinnedFilters()).toEqual([]);
    window.sessionStorage.setItem(PINNED_FILTERS_KEY, '{not json');
    expect(loadPinnedFilters()).toEqual([]);
  });

  it('merges pinned pills into URL filters without duplicating an equivalent pill', () => {
    const urlFilters = [pill('error')];
    const pinned = [pill('error', { id: 'other-id', pinned: true }), pill('warn', { pinned: true })];
    const merged = mergePinnedFilters(urlFilters, pinned);
    expect(merged.map((f) => f.value)).toEqual(['error', 'warn']);
    expect(merged.find((f) => f.value === 'error')?.pinned).toBe(true);
  });

  it('treats one_of value sets as equal regardless of order', () => {
    const url = [pill('x', { op: 'one_of', value: '', values: ['a', 'b'] })];
    const pinned = [pill('y', { op: 'one_of', value: '', values: ['b', 'a'], pinned: true })];
    expect(mergePinnedFilters(url, pinned)).toHaveLength(1);
  });

  it('gives an appended pinned pill a fresh id when its id collides with a URL pill', () => {
    const merged = mergePinnedFilters([pill('same', { value: 'error' })], [pill('same', { value: 'warn', pinned: true })]);
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((f) => f.id)).size).toBe(2);
  });

  it('pin and unpin change the store by condition, not id', () => {
    pinFilterInStore(pill('a'));
    pinFilterInStore(pill('a-again', { value: 'a' }));
    expect(loadPinnedFilters()).toHaveLength(1);
    unpinFilterInStore(pill('other-id', { value: 'a' }));
    expect(loadPinnedFilters()).toEqual([]);
  });

  it('carries pins disabled into a view on a different table, enabled on the same table', () => {
    const pins = [pill('a', { pinned: true })];
    expect(carryPinnedToView(pins, true)[0].disabled).toBeUndefined();
    expect(carryPinnedToView(pins, false)[0].disabled).toBe(true);
  });
});

describe('SHARED-STATE-03: building a link to another app page carries the context', () => {
  it('encodes search, filters, time, view, interval and breakdown onto the target page path', () => {
    const tr = rangeUtil.convertRawToRange({ from: dateTime(1767225600000), to: dateTime(1767830400000) });
    const url = buildAppPageUrl('visualize', {
      search: 'Body:timeout',
      filters: [pill('error')],
      columns: [],
      timeRange: tr,
      viewId: 'spec-fixture',
      interval: 'hour',
      breakdown: { kind: 'severity' },
    });
    expect(url.startsWith('/a/poortuna-clickhouse-observe-app/visualize?')).toBe(true);
    const back = decodeLogsState(new URLSearchParams(url.split('?')[1]));
    expect(back).toMatchObject({ search: 'Body:timeout', viewId: 'spec-fixture', interval: 'hour', breakdown: { kind: 'severity' } });
    expect(back.filters?.[0].value).toBe('error');
    expect(back.timeRange?.from.valueOf()).toBe(1767225600000);
  });
});
