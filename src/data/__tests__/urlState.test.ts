/**
 * Round-trip tests for the Logs Explorer shareable-URL encode/decode helpers.
 */

import { dateTime } from '@grafana/data';
import { encodeLogsState, decodeLogsState } from '../urlState';
import { FilterPill, SelectedColumn } from '../../types';

const filters: FilterPill[] = [
  { id: 'f1', field: 'SeverityText', op: '=', value: 'ERROR' },
];

const columns: SelectedColumn[] = [
  { id: 'timestamp', key: '__timestamp', sqlExpr: 'Timestamp', displayName: 'Time', type: 'time', isCore: true },
  { id: 'body', key: '__body', sqlExpr: 'Body', displayName: 'Message', type: 'text', isCore: true },
];

const disabledFilters: FilterPill[] = [
  { id: 'f1', field: 'SeverityText', op: '=', value: 'ERROR' },
  { id: 'f2', field: 'HostName', op: '!=', value: 'host-1', disabled: true },
];

describe('encodeLogsState / decodeLogsState round-trip', () => {
  it('round-trips a disabled filter pill', () => {
    const timeRange = {
      from: dateTime(Date.now() - 3600_000),
      to: dateTime(Date.now()),
      raw: { from: 'now-1h', to: 'now' },
    };
    const encoded = encodeLogsState({
      search: '',
      filters: disabledFilters,
      columns: [],
      timeRange,
    });
    const decoded = decodeLogsState(encoded);
    expect(decoded.filters).toEqual(disabledFilters);
    expect(decoded.filters?.[1].disabled).toBe(true);
  });


  it('round-trips search, filters, columns, sort, relative time range, and view id', () => {
    const timeRange = {
      from: dateTime(Date.now() - 3600_000),
      to: dateTime(Date.now()),
      raw: { from: 'now-1h', to: 'now' },
    };
    const encoded = encodeLogsState({
      search: 'error',
      filters,
      columns,
      sort: { col: '__timestamp', dir: 'desc' },
      timeRange,
      viewId: 'shared_123',
    });
    const decoded = decodeLogsState(encoded);

    expect(decoded.search).toBe('error');
    expect(decoded.filters).toEqual(filters);
    expect(decoded.columns).toEqual(columns);
    expect(decoded.sort).toEqual({ col: '__timestamp', dir: 'desc' });
    expect(decoded.viewId).toBe('shared_123');
    // Relative range preserved as 'now-1h'/'now', not frozen to an absolute instant.
    expect(decoded.timeRange?.raw.from).toBe('now-1h');
    expect(decoded.timeRange?.raw.to).toBe('now');
  });

  it('round-trips an absolute time range as epoch-ms, not a relative string', () => {
    const from = dateTime(1700000000000);
    const to = dateTime(1700003600000);
    const encoded = encodeLogsState({
      search: '',
      filters: [],
      columns: [],
      timeRange: { from, to, raw: { from, to } },
    });
    const decoded = decodeLogsState(encoded);
    expect(decoded.timeRange?.from.valueOf()).toBe(1700000000000);
    expect(decoded.timeRange?.to.valueOf()).toBe(1700003600000);
  });

  it('omits empty search/filters/columns/sort/viewId from the URL entirely', () => {
    const encoded = encodeLogsState({
      search: '   ',
      filters: [],
      columns: [],
      timeRange: { from: dateTime(0), to: dateTime(1), raw: { from: 'now-1h', to: 'now' } },
    });
    expect(encoded.has('q')).toBe(false);
    expect(encoded.has('filters')).toBe(false);
    expect(encoded.has('cols')).toBe(false);
    expect(encoded.has('sort')).toBe(false);
    expect(encoded.has('ds')).toBe(false);
  });

  it('decode is best-effort: malformed filters/cols JSON is dropped, not thrown', () => {
    const sp = new URLSearchParams();
    sp.set('filters', '{not valid json');
    sp.set('cols', '"a string, not an array"');
    sp.set('sort', 'garbage-no-colon');
    const decoded = decodeLogsState(sp);
    expect(decoded.filters).toBeUndefined();
    expect(decoded.columns).toBeUndefined();
    expect(decoded.sort).toBeUndefined();
  });

  it('decode returns an empty object for an empty URLSearchParams', () => {
    const decoded = decodeLogsState(new URLSearchParams());
    expect(decoded).toEqual({});
  });

  it('decodes traceId/dsUid — the inbound-only trace->logs deep-link contract', () => {
    const sp = new URLSearchParams();
    sp.set('traceId', 'deadbeefcafebabe0123456789abcdef');
    sp.set('dsUid', 'afrf0mt8ssn40d');
    const decoded = decodeLogsState(sp);
    expect(decoded.traceId).toBe('deadbeefcafebabe0123456789abcdef');
    expect(decoded.dsUid).toBe('afrf0mt8ssn40d');
  });

  it('never emits traceId/dsUid from encodeLogsState — they are decode-only', () => {
    const encoded = encodeLogsState({
      search: 'error',
      filters,
      columns,
      timeRange: { from: dateTime(0), to: dateTime(1), raw: { from: 'now-1h', to: 'now' } },
      viewId: 'shared_123',
    });
    expect(encoded.has('traceId')).toBe(false);
    expect(encoded.has('dsUid')).toBe(false);
  });

  it('decodes ISO-8601 from/to (as Kibana writes them) and rejects garbage', () => {
    const iso = decodeLogsState(new URLSearchParams({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-08T00:00:00Z' }));
    expect(iso.timeRange?.from.valueOf()).toBe(Date.UTC(2026, 0, 1));
    expect(iso.timeRange?.to.valueOf()).toBe(Date.UTC(2026, 0, 8));
    expect(decodeLogsState(new URLSearchParams({ from: 'junk', to: 'junk' })).timeRange).toBeUndefined();
  });

  const decodeTime = (from: string, to: string) => decodeLogsState(new URLSearchParams({ from, to })).timeRange;
  it('ISO needs a time zone; zone offsets are honoured; non-ISO strings are dropped', () => {
    expect(decodeTime('2026-01-01T02:00:00+02:00', '2026-01-02T00:00:00Z')?.from.valueOf()).toBe(Date.UTC(2026, 0, 1));
    expect(decodeTime('2026-01-01T00:00:00', '2026-01-02T00:00:00Z')).toBeUndefined();
    expect(decodeTime('2026-01-01', '2026-01-02')).toBeUndefined();
    expect(decodeTime('Jan 1 2026', 'Jan 2 2026')).toBeUndefined();
  });

  it('invalid now-expressions are dropped, valid ones kept', () => {
    expect(decodeTime('nowgarbage', 'now')).toBeUndefined();
    expect(decodeTime('now-1h', 'now')?.raw.from).toBe('now-1h');
    expect(decodeTime('now/d', 'now/d')?.raw.to).toBe('now/d');
  });

  it('accepts any finite number as epoch ms (decimal, exponent), rejects empty/NaN', () => {
    expect(decodeTime('1700000000000.5', '1.7000036e12')?.to.valueOf()).toBe(1700003600000);
    expect(decodeTime('abc', '1700000000000')).toBeUndefined();
  });
});

describe('decodeLogsState drops untrusted filter pills', () => {
  const decode = (pills: unknown) => decodeLogsState(new URLSearchParams({ filters: JSON.stringify(pills) })).filters;
  const ok = { id: 'a', field: 'ServiceName', op: '=', value: 'x' };

  it('drops a pill with an unknown op', () => {
    expect(decode([ok, { ...ok, id: 'b', op: 'LIKE' }, { ...ok, id: 'c', op: "= '' OR 1=1 --" }])).toEqual([ok]);
    expect(decode([{ ...ok, op: undefined }])).toEqual([]);
  });

  it('drops a pill whose field is not a string', () => {
    expect(decode([ok, { ...ok, id: 'b', field: { a: 1 } }, { ...ok, id: 'c', field: 5 }])).toEqual([ok]);
  });

  it('drops a pill whose value is not a string; a missing value becomes empty', () => {
    expect(decode([ok, { ...ok, id: 'b', value: 5 }, { ...ok, id: 'c', value: ['x'] }])).toEqual([ok]);
    expect(decode([{ id: 'e', field: 'ServiceName', op: 'exists' }])).toEqual([
      { id: 'e', field: 'ServiceName', op: 'exists', value: '' },
    ]);
  });

  it('drops a pill whose values are not an array of strings', () => {
    const oneOf = { id: 'o', field: 'ServiceName', op: 'one_of', value: '', values: ['a', 'b'] };
    expect(decode([oneOf, { ...oneOf, id: 'p', values: 'a' }, { ...oneOf, id: 'q', values: ['a', 1] }])).toEqual([oneOf]);
  });

  it('drops non-object entries and keeps the range operators', () => {
    const between = { id: 'r', field: 'n', op: 'between', value: '', values: ['1', '2'] };
    expect(decode([null, 'x', 3, between])).toEqual([between]);
  });
});
