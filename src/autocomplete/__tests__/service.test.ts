import { rangeUtil } from '@grafana/data';
import { createAutocompleteSources, rankFields } from '../service';
import { loadFieldValues } from '../../sql/kql/_values';
import { loadColumnKeys } from '../../sql/keys';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { FieldModel } from '../../sql/fieldModel';
import { buildFieldIndex } from '../../sql/fields';

jest.mock('../../sql/kql/_values', () => ({ loadFieldValues: jest.fn(async () => [{ value: 'error', count: 3 }]) }));
jest.mock('../../sql/keys', () => ({ loadColumnKeys: jest.fn(async () => ({ keys: [], total: 0 })) }));

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const timeRange = rangeUtil.convertRawToRange({ from: 'now-7d', to: 'now' });
const field = (id: string, name: string, type: FieldModel['type']): FieldModel => ({
  id,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});

describe('SHARED-AUTOCOMPLETE-01: value and key sources', () => {
  beforeEach(() => jest.clearAllMocks());

  it('scopes value suggestions to the current time range and filters', async () => {
    const query = {
      ...DEFAULT_LOGS_QUERY_STATE,
      filters: [{ id: 'f', field: 'ServiceName', op: '=' as const, value: 'payments' }],
    };
    const sources = createAutocompleteSources({ config, query, timeRange });
    await sources.loadValues('SeverityText');
    const [, expr, opts] = (loadFieldValues as jest.Mock).mock.calls[0];
    expect(expr).toBe('SeverityText');
    expect(opts.table).toBe('spec_logs');
    expect(opts.timeRange).toBe(timeRange);
    expect(opts.conditions.join(' AND ')).toContain('payments');
    expect(opts.conditions.join(' AND ')).toContain('Timestamp');
    expect(opts.cacheKey).toContain('payments');
  });

  it('leaves out the search text and filters on the field being completed', async () => {
    const query = {
      ...DEFAULT_LOGS_QUERY_STATE,
      search: 'ServiceName: "frontend"',
      filters: [
        { id: 'a', field: 'ServiceName', op: '=' as const, value: 'checkout' },
        { id: 'b', field: 'SeverityText', op: '=' as const, value: 'error' },
        {
          id: 'c',
          field: '',
          op: '=' as const,
          value: '',
          cond: { join: 'or' as const, items: [{ field: 'ServiceName', op: '=' as const, value: 'cart' }] },
        },
      ],
    };
    const sources = createAutocompleteSources({ config, query, timeRange });
    await sources.loadValues('ServiceName');
    const where = (loadFieldValues as jest.Mock).mock.calls[0][2].conditions.join(' AND ');
    expect(where).not.toContain('frontend');
    expect(where).not.toContain('checkout');
    expect(where).not.toContain('cart');
    expect(where).toContain('error');
    // Another field keeps every filter, still without the search text.
    await sources.loadValues('SeverityText');
    const other = (loadFieldValues as jest.Mock).mock.calls[1][2].conditions.join(' AND ');
    expect(other).toContain('checkout');
    expect(other).toContain('cart');
    expect(other).not.toContain('frontend');
  });

  it('drops an unparsable search instead of rejecting (best-effort suggestions)', async () => {
    const query = { ...DEFAULT_LOGS_QUERY_STATE, search: 'level:(' };
    const sources = createAutocompleteSources({ config, query, timeRange });
    await expect(sources.loadValues('SeverityText')).resolves.toEqual([{ value: 'error', count: 3 }]);
    await expect(sources.loadMapKeys('LogAttributes')).resolves.toEqual({ keys: [], total: 0 });
    expect((loadColumnKeys as jest.Mock).mock.calls[0][1]).toBe('LogAttributes');
  });

  it('never rejects: a failing lookup resolves to an empty result', async () => {
    (loadFieldValues as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
    (loadColumnKeys as jest.Mock).mockRejectedValueOnce(new Error('timeout'));
    const sources = createAutocompleteSources({ config, query: DEFAULT_LOGS_QUERY_STATE, timeRange });
    await expect(sources.loadValues('SeverityText')).resolves.toEqual([]);
    await expect(sources.loadMapKeys('LogAttributes')).resolves.toEqual({ keys: [], total: 0 });
  });

  it('separates cached results from before and after field discovery', async () => {
    const before = createAutocompleteSources({ config, query: DEFAULT_LOGS_QUERY_STATE, timeRange });
    const after = createAutocompleteSources({
      config,
      query: DEFAULT_LOGS_QUERY_STATE,
      timeRange,
      fieldIndex: buildFieldIndex([]),
    });
    await before.loadValues('SeverityText');
    await after.loadValues('SeverityText');
    const keys = (loadFieldValues as jest.Mock).mock.calls.map((c) => c[2].cacheKey);
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe('SHARED-AUTOCOMPLETE-01: field suggestions', () => {
  const fields = [
    field('col:ServiceName', 'ServiceName', 'string'),
    field('col:SeverityNumber', 'SeverityNumber', 'number'),
    field('map:LogAttributes:http.status_code', 'http.status_code', 'string'),
    field('col:Timestamp', 'Timestamp', 'time'),
  ];

  it('ranks prefix matches before substring matches and keeps the type for the icon', () => {
    const ranked = rankFields(fields, 'se');
    expect(ranked.map((f) => f.name)).toEqual(['ServiceName', 'SeverityNumber']);
    expect(ranked[1].type).toBe('number');
    expect(rankFields(fields, 'code').map((f) => f.name)).toEqual(['http.status_code']);
  });

  it('matches the on-screen display name of nested Map fields, not just the leaf key', () => {
    const nested = {
      ...field('map:LogAttributes:http.method', 'http.method', 'string'),
      displayName: 'LogAttributes.http.method',
    };
    expect(rankFields([nested], 'LogAttr').map((f) => f.id)).toEqual(['map:LogAttributes:http.method']);
  });

  it('only offers fields valid in the context', () => {
    expect(rankFields(fields, '', { allow: (f) => f.type === 'number' }).map((f) => f.name)).toEqual([
      'SeverityNumber',
    ]);
  });

  it('returns every allowed field, alphabetically, for an empty prefix', () => {
    expect(rankFields(fields, '').map((f) => f.name)).toEqual([
      'http.status_code',
      'ServiceName',
      'SeverityNumber',
      'Timestamp',
    ]);
  });
});
