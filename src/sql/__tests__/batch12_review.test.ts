/**
 * Batch-12 review fixes:
 *  - one predicate per field kind for both KQL and filter pills (sql/fieldPredicates.ts): "exists" on
 *    a JSON array / whole JSON column, value ops on a whole JSON column;
 *  - typed dynamic JSON paths (`.:T`) are filtered through the bare path's text, so rows whose value
 *    has another type than the sampled one are not dropped (and `typed = 'abc'` no longer throws);
 *  - the prefix value lookup accepts a single quoted identifier (the old inline regex accepted only "");
 *  - introspection queries quote the table through tableRef().
 */
import { rangeUtil } from '@grafana/data';
import { FieldModel } from '../fieldModel';
import { buildFieldIndex } from '../fields';
import { hasScalarTypedSubcolumn, jsonPathField, stripTypedSubcolumn } from '../jsonPaths';
import { buildJsonPathTypesSampleQuery, buildJsonPathsQuery, buildMapKeysQuery } from '../introspection';
import { buildFilterConditions, buildSearchClause, isQuotedIdentifier } from '../queryBuilder';
import { loadPrefixValues } from '../kql/_values';
import { runQueryRows } from '../../data/runQuery';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('../../data/runQuery');
const mockRun = runQueryRows as jest.MockedFunction<typeof runQueryRows>;

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};

const col = (name: string, type: FieldModel['type'], rawType: string): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
  rawType,
});

const fields: FieldModel[] = [
  col('Body', 'string', 'String'),
  col('ServiceName', 'string', 'LowCardinality(String)'),
  col('Payload', 'json', 'JSON(user.id UInt32)'),
  jsonPathField('Payload', 'user.id', 'UInt32'),
  jsonPathField('Payload', 'request.duration_ms', undefined, ['Int64']),
  jsonPathField('Payload', 'request.tags', undefined, ['Array(Nullable(String))']),
];
const index = buildFieldIndex(fields);
const kql = (q: string) => buildSearchClause(q, config, index);
const pill = (field: string, op: string, value = '', values?: string[]) =>
  buildFilterConditions([{ id: 'p', field, op: op as never, value, values }], config, index)[0];

describe('filter-pill exists / not_exists per field kind', () => {
  it('a JSON array path is present when it has an element (its text "[]" is never empty)', () => {
    expect(pill('Payload.request.tags', 'exists')).toBe('notEmpty(Payload.request.tags.:`Array(Nullable(String))`)');
    expect(pill('Payload.request.tags', 'not_exists')).toBe('empty(Payload.request.tags.:`Array(Nullable(String))`)');
  });

  it('a whole JSON column is present when it has any path (its text "{}" is never empty)', () => {
    expect(pill('Payload', 'exists')).toBe('notEmpty(JSONAllPaths("Payload"))');
    expect(pill('Payload', 'not_exists')).toBe('empty(JSONAllPaths("Payload"))');
  });

  it('a whole JSON column matches nothing on a value, like KQL', () => {
    expect(pill('Payload', '=', 'x')).toBe('0');
    expect(pill('Payload', '!=', 'x')).toBe('NOT 0');
  });

  it('plain columns keep their SQL', () => {
    expect(pill('ServiceName', 'exists')).toBe('notEmpty(toString("ServiceName"))');
    expect(pill('ServiceName', 'not_exists')).toBe('empty(toString("ServiceName"))');
  });

  it('KQL `field:*` and the "exists" pill compile to the same predicate', () => {
    for (const f of ['ServiceName', 'Payload', 'Payload.user.id', 'Payload.request.duration_ms', 'Payload.request.tags']) {
      expect(kql(`${f}:*`)).toBe(pill(f, 'exists'));
      expect(kql(`not ${f}:*`)).toBe(`NOT (${pill(f, 'exists')})`);
    }
  });
});

describe('typed dynamic JSON paths in filters keep other-typed rows', () => {
  it('pills compare the bare path as text', () => {
    expect(pill('Payload.request.duration_ms', '=', '503')).toBe("toString(Payload.request.duration_ms) = '503'");
    expect(pill('Payload.request.duration_ms', '!=', '503')).toBe("toString(Payload.request.duration_ms) != '503'");
    expect(pill('Payload.request.duration_ms', 'one_of', '', ['1', '2'])).toBe(
      "toString(Payload.request.duration_ms) IN ('1', '2')"
    );
    expect(pill('Payload.request.duration_ms', 'contains', '50')).toBe("toString(Payload.request.duration_ms) ILIKE '%50%'");
    expect(pill('Payload.request.duration_ms', 'exists')).toBe("notEmpty(ifNull(toString(Payload.request.duration_ms), ''))");
  });

  it('declared paths and arrays keep the typed read', () => {
    expect(pill('Payload.user.id', '=', '14')).toBe("Payload.user.id = '14'");
    expect(pill('Payload.request.tags', '=', 'retry')).toBe(
      "arrayExists(x -> toString(x) = 'retry', Payload.request.tags.:`Array(Nullable(String))`)"
    );
  });
});

describe('typed-subcolumn suffix helpers', () => {
  it('strip only a trailing suffix, never a quoted segment holding ".:"', () => {
    expect(stripTypedSubcolumn('Payload."a.:b"')).toBe('Payload."a.:b"');
    expect(stripTypedSubcolumn('Payload."a.:b".:Int64')).toBe('Payload."a.:b"');
    expect(hasScalarTypedSubcolumn('Payload.a.:Int64')).toBe(true);
    expect(hasScalarTypedSubcolumn('Payload.a.:`Array(Nullable(String))`')).toBe(false);
    expect(hasScalarTypedSubcolumn('Payload."a.:b"')).toBe(false);
  });
});

describe('prefix value lookup on a quoted identifier', () => {
  const timeRange = rangeUtil.convertRawToRange({ from: 'now-1h', to: 'now' });
  beforeEach(() => mockRun.mockReset().mockResolvedValue([{ value: 'pay', count: 1 }]));

  it('isQuotedIdentifier mirrors the lexer', () => {
    expect(isQuotedIdentifier('"user-name"')).toBe(true);
    expect(isQuotedIdentifier('"a""b"')).toBe(true);
    expect(isQuotedIdentifier('"a\\"b"')).toBe(true);
    expect(isQuotedIdentifier('""')).toBe(true);
    expect(isQuotedIdentifier('"a" OR 1=1 --"')).toBe(false);
    expect(isQuotedIdentifier('"a"b"')).toBe(false);
  });

  it('runs the lookup for a quoted column name', async () => {
    const vals = await loadPrefixValues(
      config,
      '"user-name"',
      { table: 'otel_logs', conditions: [], timeRange, cacheKey: 'k' },
      'pa'
    );
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][0].sql).toContain('toString("user-name") AS __pv');
    expect(vals).toEqual([{ value: 'pay', count: 1 }]);
  });

  it('refuses a hostile expression', async () => {
    const opts = { table: 'otel_logs', conditions: [], timeRange, cacheKey: 'k2' };
    expect(await loadPrefixValues(config, '"a" OR 1=1 --"', opts, 'pa')).toEqual([]);
    expect(mockRun).not.toHaveBeenCalled();
  });
});

describe('introspection quotes the table through tableRef', () => {
  it('escapes a double quote in the table name', () => {
    const t = { table: 'a"b' };
    expect(buildJsonPathTypesSampleQuery(config, 'Payload', t)).toContain('FROM "default"."a""b" LIMIT');
    expect(buildJsonPathsQuery(config, 'Payload', t)).toContain('FROM "default"."a""b"');
    expect(buildMapKeysQuery(config, 'LogAttributes', { table: 'a"b', conditions: [] })).toContain('FROM "default"."a""b"');
  });
});
