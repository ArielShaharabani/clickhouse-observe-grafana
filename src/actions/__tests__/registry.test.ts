import { ActionHost, fieldActions, fieldLabelFor, isFilterableValue, valueActions } from '../registry';
import { FilterPill } from '../../types';

const host = (): ActionHost & { added: FilterPill[]; copied: string[] } => {
  const added: FilterPill[] = [];
  const copied: string[] = [];
  return { added, copied, addFilter: (p) => added.push(p), copyText: (t) => copied.push(t) };
};
const ctx = { field: 'ServiceName', fieldLabel: 'Service', value: 'payments' };

describe('SHARED-ACTION-01: value actions', () => {
  it('offers filter for, filter out and copy with consistent labels', () => {
    const actions = valueActions(ctx, host());
    expect(actions.map((a) => a.id)).toEqual(['filterFor', 'filterOut', 'copy']);
    expect(actions.map((a) => a.tooltip)).toEqual(['Filter for value', 'Filter out value', 'Copy value']);
    expect(actions.map((a) => a.ariaLabel)).toEqual([
      'Filter for Service: payments',
      'Filter out Service: payments',
      'Copy value of Service',
    ]);
  });

  it('builds the right filter pills and copies the value', () => {
    const h = host();
    for (const a of valueActions(ctx, h)) {
      a.run();
    }
    expect(h.added.map((p) => [p.field, p.op, p.value])).toEqual([
      ['ServiceName', '=', 'payments'],
      ['ServiceName', '!=', 'payments'],
    ]);
    expect(h.copied).toEqual(['payments']);
  });

  it('names fields the same way on every surface, derived from the SQL expression', () => {
    expect(fieldLabelFor("LogAttributes['http.method']")).toBe('LogAttributes.http.method');
    expect(fieldLabelFor('ServiceName')).toBe('ServiceName');
    const [a] = valueActions({ field: "LogAttributes['http.method']", value: 'GET' }, host());
    expect(a.ariaLabel).toBe('Filter for LogAttributes.http.method: GET');
  });

  it('speaks empty values as (empty) and truncates long ones', () => {
    expect(valueActions({ field: 'Body', value: '' }, host())[0].ariaLabel).toBe('Filter for Body: (empty)');
    const long = 'x'.repeat(500);
    expect(valueActions({ field: 'Body', value: long }, host())[0].ariaLabel.length).toBeLessThan(90);
  });

  it('offers copy only for values that cannot be filtered on', () => {
    expect(valueActions({ ...ctx, filterable: false }, host()).map((a) => a.id)).toEqual(['copy']);
    expect(isFilterableValue(null)).toBe(false);
    expect(isFilterableValue({ a: 1 })).toBe(false);
    expect(isFilterableValue('{"k":"v"}', 'map')).toBe(false);
    expect(isFilterableValue('{"k":"v"}', 'string')).toBe(true);
    expect(isFilterableValue('')).toBe(true);
  });

  it('only offers copy when the surface cannot add filters (read-only)', () => {
    expect(valueActions(ctx, { copyText: () => undefined }).map((a) => a.id)).toEqual(['copy']);
  });

  it('can be limited to a subset, in the requested order', () => {
    expect(valueActions(ctx, host(), ['filterOut', 'filterFor']).map((a) => a.id)).toEqual(['filterOut', 'filterFor']);
  });
});

describe('SHARED-ACTION-01: field actions', () => {
  it('offers exists / does-not-exist filters on the field', () => {
    const h = host();
    const actions = fieldActions({ field: 'TraceId' }, h);
    expect(actions.map((a) => a.ariaLabel)).toEqual([
      'Filter to rows where TraceId has any value',
      'Filter to rows where TraceId is missing',
    ]);
    expect(actions.map((a) => a.tooltip)).toEqual([
      'Filter to rows where this field has any value',
      'Filter to rows where this field is missing',
    ]);
    actions.forEach((a) => a.run());
    expect(h.added.map((p) => [p.field, p.op])).toEqual([
      ['TraceId', 'exists'],
      ['TraceId', 'not_exists'],
    ]);
  });

  it('offers nothing when the surface cannot add filters', () => {
    expect(fieldActions({ field: 'TraceId' }, { copyText: () => undefined })).toEqual([]);
  });
});
