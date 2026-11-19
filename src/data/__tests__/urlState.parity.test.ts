/**
 * PARITY-HISTOGRAM URL state: auto-refresh is paused unless the URL says otherwise (validated),
 * and a hand-written `bd=field:<name>` resolves to the column field or is dropped.
 */
import { dateTime } from '@grafana/data';
import { cleanRefreshInterval, decodeLogsState, encodeLogsState, resolveBreakdownField } from '../urlState';
import { FieldModel } from '../../sql/fieldModel';

const base = {
  search: '',
  filters: [],
  columns: [],
  timeRange: { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } },
};

describe('auto-refresh in the URL', () => {
  it('is omitted when paused (the default) and kept when chosen', () => {
    expect(encodeLogsState(base).has('refresh')).toBe(false);
    expect(encodeLogsState({ ...base, refresh: '' }).has('refresh')).toBe(false);
    const sp = encodeLogsState({ ...base, refresh: '30s' });
    expect(sp.get('refresh')).toBe('30s');
    expect(decodeLogsState(sp).refresh).toBe('30s');
  });

  it('decodes nothing (paused) for a missing, junk, too-fast or injection-shaped value', () => {
    expect(decodeLogsState(new URLSearchParams('')).refresh).toBeUndefined();
    for (const bad of ['off', '1s', '0s', '30', 'abc', '5x', '1m;DROP', '99999h', '-5s']) {
      expect(decodeLogsState(new URLSearchParams({ refresh: bad })).refresh).toBeUndefined();
    }
    expect(cleanRefreshInterval('5s')).toBe('5s');
    expect(cleanRefreshInterval('1h')).toBe('1h');
    expect(cleanRefreshInterval('1d')).toBe('1d');
  });
});

describe('URL breakdown field resolution', () => {
  const fields = [
    { id: 'col:ServiceName', name: 'ServiceName' },
    { id: 'map:LogAttributes:http.method', name: 'http.method' },
  ] as FieldModel[];

  it('resolves the exact id', () => {
    expect(resolveBreakdownField('col:ServiceName', fields)?.id).toBe('col:ServiceName');
    expect(resolveBreakdownField('map:LogAttributes:http.method', fields)?.id).toBe('map:LogAttributes:http.method');
  });

  it('resolves a bare column name (bd=field:ServiceName) to its canonical col: id', () => {
    expect(resolveBreakdownField('ServiceName', fields)?.id).toBe('col:ServiceName');
  });

  it('finds nothing for an unknown name (the caller then drops it from the URL)', () => {
    expect(resolveBreakdownField('NoSuchField', fields)).toBeUndefined();
    expect(resolveBreakdownField('http.method', fields)).toBeUndefined();
  });

  it('a malformed bd value never decodes to a breakdown', () => {
    for (const bad of ['field:', 'foo', 'Severity', '']) {
      expect(decodeLogsState(new URLSearchParams({ bd: bad })).breakdown).toBeUndefined();
    }
  });
});
