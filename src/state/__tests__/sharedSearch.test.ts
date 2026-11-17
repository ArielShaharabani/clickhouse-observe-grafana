import { dateTime, rangeUtil } from '@grafana/data';
import { decodeLogsState, encodeLogsState } from '../../data/urlState';
import { FilterPill } from '../../types';
import {
  buildAppPageUrl,
  loadPinnedFilters,
  mergePinnedFilters,
  normalizePinnedFlags,
  pinFilterInStore,
  replacePinInStore,
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

describe('SHARED-STATE-01 / DISC-FILTER-01: pinned filters', () => {
  beforeEach(() => window.sessionStorage.clear());
  const A = 'default.spec_logs';
  const B = 'default.otel_logs';

  it('pins and unpins by condition, not id, with one stored entry per condition', () => {
    pinFilterInStore(pill('a'), A);
    pinFilterInStore(pill('a-again', { value: 'a' }), A);
    expect(loadPinnedFilters()).toEqual([expect.objectContaining({ value: 'a', pinned: true, pinnedTable: A })]);
    unpinFilterInStore(pill('other-id', { value: 'a' }));
    expect(loadPinnedFilters()).toEqual([]);
  });

  it('stores the condition only: a disabled pill is pinned enabled', () => {
    pinFilterInStore(pill('a', { disabled: true }), A);
    expect(loadPinnedFilters()[0].disabled).toBeUndefined();
  });

  it('replaces the stored condition when a pinned pill is edited or excluded', () => {
    pinFilterInStore(pill('error'), A);
    replacePinInStore(pill('error'), pill('error', { op: '!=' }), A);
    expect(loadPinnedFilters()).toEqual([expect.objectContaining({ value: 'error', op: '!=' })]);
  });

  it('returns [] when storage is empty or corrupt', () => {
    expect(loadPinnedFilters()).toEqual([]);
    window.sessionStorage.setItem(PINNED_FILTERS_KEY, '{not json');
    expect(loadPinnedFilters()).toEqual([]);
  });

  it('merges stored pins into filters without duplicating an equivalent pill', () => {
    pinFilterInStore(pill('error'), A);
    pinFilterInStore(pill('warn'), A);
    const merged = mergePinnedFilters([pill('error', { id: 'url-id' })], loadPinnedFilters(), A);
    expect(merged.map((f) => [f.value, f.pinned])).toEqual([
      ['error', true],
      ['warn', true],
    ]);
    expect(merged[1]).not.toHaveProperty('pinnedTable');
  });

  it('treats one_of value sets as equal regardless of order', () => {
    pinFilterInStore(pill('y', { op: 'one_of', value: '', values: ['b', 'a'] }), A);
    const url = [pill('x', { op: 'one_of', value: '', values: ['a', 'b'] })];
    expect(mergePinnedFilters(url, loadPinnedFilters(), A)).toHaveLength(1);
  });

  it('gives an appended pin a fresh id when its id collides with an existing pill', () => {
    pinFilterInStore(pill('same', { value: 'warn' }), A);
    const merged = mergePinnedFilters([pill('same', { value: 'error' })], loadPinnedFilters(), A);
    expect(new Set(merged.map((f) => f.id)).size).toBe(2);
  });

  it('applies a pin disabled on a view that reads a different table', () => {
    pinFilterInStore(pill('error'), A);
    expect(mergePinnedFilters([], loadPinnedFilters(), A)[0].disabled).toBeUndefined();
    expect(mergePinnedFilters([], loadPinnedFilters(), B)[0].disabled).toBe(true);
  });

  it("ignores pinned flags that are not in this user's store (foreign links)", () => {
    const foreign = [pill('error', { pinned: true }), pill('warn')];
    expect(normalizePinnedFlags(foreign, []).map((f) => f.pinned)).toEqual([undefined, undefined]);
    pinFilterInStore(pill('warn'), A);
    expect(normalizePinnedFlags(foreign, loadPinnedFilters()).map((f) => !!f.pinned)).toEqual([false, true]);
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
