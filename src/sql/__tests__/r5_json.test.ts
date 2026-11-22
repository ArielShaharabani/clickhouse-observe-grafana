/**
 * R5-JSON: native JSON column paths in Discover / Visualize.
 * - dynamic paths are read as typed subcolumns (`.:T`) when the bounded type sample saw one type;
 * - KQL / filter pills on JSON paths: ranges skip missing / non-numeric values, wildcards and
 *   "contains" work on numeric paths, array paths match any element, a whole JSON column matches
 *   nothing on a value and "exists" on any path;
 * - the KQL bar drills into a JSON column like a Map ("Payload." lists its paths);
 * - field source badge + ClickHouse type tooltip (#7).
 */
import { FieldModel, mapValueType } from '../fieldModel';
import { buildFieldIndex } from '../fields';
import {
  isTypedSubcolumnType,
  jsonPathField,
  parseJsonPathTypes,
  stripTypedSubcolumn,
  typedSubcolumnSuffix,
} from '../jsonPaths';
import { buildJsonPathTypesSampleQuery, buildJsonPathsQuery, JSON_TYPES_SAMPLE_SIZE } from '../introspection';
import { buildFilterConditions, buildSearchClause, isSafeColumnExpr, quoteIdentifier } from '../queryBuilder';
import { getSuggestions } from '../kql/suggest';
import { buildMapKeyField } from '../keys';
import { fieldSourceBadge, fieldTypeTooltip } from '../../components/FieldSidebar/fieldIcons';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

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
  col('Payload', 'json', 'JSON(user.id UInt32)'),
  col('LogAttributes', 'map', 'Map(LowCardinality(String), String)'),
  jsonPathField('Payload', 'user.id', 'UInt32'),
  jsonPathField('Payload', 'user.name', undefined, ['String']),
  jsonPathField('Payload', 'request.duration_ms', undefined, ['Int64']),
  jsonPathField('Payload', 'request.tags', undefined, ['Array(Nullable(String))']),
  jsonPathField('Payload', 'mixed', undefined, ['Int64', 'String']),
];
const index = buildFieldIndex(fields);
const kql = (q: string) => buildSearchClause(q, config, index);

describe('jsonPathField', () => {
  it('keeps a declared path bare, typed from the declaration', () => {
    expect(jsonPathField('Payload', 'user.id', 'UInt32')).toMatchObject({
      sqlExpr: 'Payload.user.id',
      type: 'number',
      rawType: 'UInt32',
      source: 'json',
      jsonColumn: 'Payload',
    });
  });

  it('reads a single-typed dynamic path as the typed subcolumn', () => {
    expect(jsonPathField('Payload', 'request.duration_ms', undefined, ['Int64'])).toMatchObject({
      sqlExpr: 'Payload.request.duration_ms.:Int64',
      type: 'number',
      rawType: 'Int64',
    });
    expect(jsonPathField('Payload', 'flags.debug', undefined, ['Bool']).type).toBe('boolean');
    expect(jsonPathField('Payload', 'request.tags', undefined, ['Array(Nullable(String))'])).toMatchObject({
      sqlExpr: 'Payload.request.tags.:`Array(Nullable(String))`',
      type: 'array',
    });
  });

  it('leaves mixed, unknown and non-allowlisted types as a bare string Dynamic', () => {
    expect(jsonPathField('Payload', 'mixed', undefined, ['Int64', 'String'])).toMatchObject({
      sqlExpr: 'Payload.mixed',
      type: 'string',
      rawType: 'Dynamic(Int64, String)',
    });
    expect(jsonPathField('Payload', 'unseen')).toMatchObject({ sqlExpr: 'Payload.unseen', type: 'string', rawType: 'Dynamic' });
    expect(jsonPathField('Payload', 'at', undefined, ['DateTime64(9)'])).toMatchObject({ sqlExpr: 'Payload.at', type: 'string' });
  });

  it('quotes odd path segments before the typed suffix', () => {
    expect(jsonPathField('Payload', 'user-id', undefined, ['Int64']).sqlExpr).toBe('Payload."user-id".:Int64');
  });

  it('accepts only plain scalar / array types into the SQL', () => {
    expect(isTypedSubcolumnType('Float64')).toBe(true);
    expect(isTypedSubcolumnType('Array(Array(Nullable(Int64)))')).toBe(true);
    expect(isTypedSubcolumnType('String`) OR 1=1 --')).toBe(false);
    expect(isTypedSubcolumnType('Decimal(10, 2)')).toBe(false);
    expect(typedSubcolumnSuffix('Int64')).toBe('.:Int64');
    expect(stripTypedSubcolumn('Payload.a.b.:Int64')).toBe('Payload.a.b');
  });

  it('parses the type sample cell, dropping None and malformed input', () => {
    const m = parseJsonPathTypes('{"a":["Int64","None"],"b":["String"]}');
    expect([...m.entries()]).toEqual([
      ['a', ['Int64']],
      ['b', ['String']],
    ]);
    expect(parseJsonPathTypes('not json').size).toBe(0);
    expect(parseJsonPathTypes('[1]').size).toBe(0);
  });
});

describe('typed subcolumn expressions are trusted column references', () => {
  it('passes the shapes jsonPathField builds', () => {
    expect(isSafeColumnExpr('Payload.request.duration_ms.:Int64')).toBe(true);
    expect(isSafeColumnExpr('Payload.request.tags.:`Array(Nullable(String))`')).toBe(true);
    expect(quoteIdentifier('Payload.a.:Int64')).toBe('Payload.a.:Int64');
  });

  it('rejects anything else after the suffix', () => {
    expect(isSafeColumnExpr('Payload.a.:Int64 OR 1=1')).toBe(false);
    expect(isSafeColumnExpr('Payload.a.:`Int64` OR `x`')).toBe(false);
    expect(isSafeColumnExpr('Payload.:Int64')).toBe(false);
  });
});

describe('buildJsonPathTypesSampleQuery', () => {
  it('samples a bounded number of rows, unordered and unfiltered', () => {
    const sql = buildJsonPathTypesSampleQuery(config, 'Payload', { table: 'otel_logs' });
    expect(sql).toContain('SELECT toJSONString(distinctJSONPathsAndTypes(Payload)) AS types');
    expect(sql).toContain(`FROM (SELECT Payload FROM "default"."otel_logs" LIMIT ${JSON_TYPES_SAMPLE_SIZE})`);
    expect(sql).not.toMatch(/WHERE|ORDER BY/);
  });

  it('leaves the whole-table path query bare', () => {
    expect(buildJsonPathsQuery(config, 'Payload', { table: 'otel_logs' })).not.toContain('distinctJSONPathsAndTypes');
  });
});

describe('KQL on JSON paths', () => {
  it('compares numerically through toFloat64OrNull, so a missing path never matches', () => {
    // The bare path, not the typed subcolumn: a row holding "503" (another type) still compares.
    expect(kql('Payload.request.duration_ms < 100')).toBe('toFloat64OrNull(toString(Payload.request.duration_ms)) < 100');
    // A text value no longer throws "Cannot parse string 'dave' as Float64".
    expect(kql('Payload.user.name > 1')).toBe('toFloat64OrNull(toString(Payload.user.name)) > 1');
  });

  it('compares a typed dynamic path as its bare path as text, so other-typed rows are not dropped', () => {
    // `Payload.request.duration_ms.:Int64 = '503'` was NULL for a row holding "503" and threw on 'abc'.
    expect(kql('Payload.request.duration_ms : 503')).toBe("toString(Payload.request.duration_ms) = '503'");
    expect(kql('Payload.request.duration_ms : abc')).toBe("toString(Payload.request.duration_ms) = 'abc'");
    expect(kql('Payload.request.duration_ms : "503"')).toBe("toString(Payload.request.duration_ms) = '503'");
    expect(kql('Payload.request.duration_ms : null')).toBe('Payload.request.duration_ms IS NULL');
    // Declared paths keep their typed comparison.
    expect(kql('Payload.user.id : 14')).toBe("Payload.user.id = '14'");
  });

  it('stringifies before a wildcard (ILIKE refuses numbers)', () => {
    expect(kql('Payload.user.id : 14*')).toBe("toString(Payload.user.id) ILIKE '14%'");
  });

  it('matches any element of an array path', () => {
    expect(kql('Payload.request.tags : retry')).toBe(
      "arrayExists(x -> toString(x) = 'retry', Payload.request.tags.:`Array(Nullable(String))`)"
    );
    expect(kql('Payload.request.tags : ret*')).toBe(
      "arrayExists(x -> toString(x) ILIKE 'ret%', Payload.request.tags.:`Array(Nullable(String))`)"
    );
    expect(kql('Payload.request.tags:*')).toBe('notEmpty(Payload.request.tags.:`Array(Nullable(String))`)');
  });

  it('a whole JSON column matches nothing on a value, and exists on any path', () => {
    expect(kql('Payload : x')).toBe('0');
    expect(kql('Payload:*')).toBe('notEmpty(JSONAllPaths("Payload"))');
  });

  it('leaves Map ranges as they were', () => {
    expect(kql('LogAttributes.duration > 5')).toBe("toFloat64(LogAttributes['duration']) > 5");
  });
});

describe('filter pills on JSON paths', () => {
  const pill = (field: string, op: string, value = '', values?: string[]) =>
    buildFilterConditions([{ id: 'p', field, op: op as never, value, values }], config, index)[0];

  it('ranges compare numerically, like Map values', () => {
    expect(pill('Payload.request.duration_ms', 'gte', '100')).toBe(
      "toFloat64OrNull(toString(Payload.request.duration_ms)) >= toFloat64OrNull('100')"
    );
  });

  it('"does not exist" counts a missing (NULL) typed path', () => {
    expect(pill('Payload.request.duration_ms', 'not_exists')).toBe(
      "empty(ifNull(toString(Payload.request.duration_ms), ''))"
    );
  });

  it('"contains" stringifies a numeric path; array paths match any element', () => {
    expect(pill('Payload.user.id', 'contains', '14')).toBe("toString(Payload.user.id) ILIKE '%14%'");
    expect(pill('Payload.request.tags', '=', 'retry')).toBe(
      "arrayExists(x -> toString(x) = 'retry', Payload.request.tags.:`Array(Nullable(String))`)"
    );
    expect(pill('Payload.request.tags', '!=', 'retry')).toBe(
      "NOT arrayExists(x -> toString(x) = 'retry', Payload.request.tags.:`Array(Nullable(String))`)"
    );
  });
});

describe('KQL autocomplete into a JSON column', () => {
  it('accepting the JSON column inserts "Payload." to browse its paths', () => {
    const s = getSuggestions('Payl', 4, fields).suggestions.find((x) => x.text === 'Payload.');
    expect(s).toMatchObject({ insertText: 'Payload.', description: 'json · browse paths' });
  });

  it('"Payload." lists the paths, with their types', () => {
    const texts = getSuggestions('Payload.', 8, fields).suggestions.map((x) => `${x.text} ${x.description}`);
    expect(texts).toEqual(
      expect.arrayContaining(['Payload.request.duration_ms number', 'Payload.user.id number', 'Payload.user.name string'])
    );
  });

  it('values of a path are fetched with its typed expression and inserted unquoted for numbers', () => {
    const q = 'Payload.request.duration_ms : ';
    const r = getSuggestions(q, q.length, fields, [{ value: '503', count: 2 }]);
    expect(r.valueContext?.sqlExpr).toBe('Payload.request.duration_ms.:Int64');
    expect(r.suggestions[0].insertText).toBe('503 ');
  });
});

describe('field source badge and type tooltip (#7)', () => {
  const mapKey = buildMapKeyField('LogAttributes', { key: 'http.method' }, 'Map(LowCardinality(String), String)');

  it('labels Map and JSON columns and the fields they contain', () => {
    expect(fieldSourceBadge(fields[1])).toBe('JSON');
    expect(fieldSourceBadge(fields[2])).toBe('Map');
    expect(fieldSourceBadge(fields[3])).toBe('JSON');
    expect(fieldSourceBadge(mapKey)).toBe('Map');
    expect(fieldSourceBadge(fields[0])).toBeNull();
  });

  it('shows the ClickHouse type on hover', () => {
    expect(fieldTypeTooltip(fields[5])).toBe(
      'Payload.request.duration_ms\nPath in JSON column Payload\nClickHouse type: Int64'
    );
    expect(fieldTypeTooltip(mapKey)).toBe('LogAttributes.http.method\nKey of Map column LogAttributes\nClickHouse type: String');
    expect(fieldTypeTooltip(fields[2])).toBe('LogAttributes\nMap column\nClickHouse type: Map(LowCardinality(String), String)');
    expect(fieldTypeTooltip({ displayName: 'x', type: 'number' })).toBe('x\nType: number');
  });

  it('mapValueType reads the value type of a Map', () => {
    expect(mapValueType('Map(String, Map(String, UInt64))')).toBe('Map(String, UInt64)');
    expect(mapValueType('String')).toBeUndefined();
  });
});

describe('exists on a typed JSON path is NULL-safe', () => {
  it('so its negation matches the rows without the path', () => {
    expect(buildSearchClause('not Payload.request.duration_ms:*', config, index)).toBe(
      "NOT (notEmpty(ifNull(toString(Payload.request.duration_ms), '')))"
    );
  });
});

describe('value lookup refuses names that are not known fields (SQL injection guard)', () => {
  it('an undiscovered typed name never becomes the sampled expression', () => {
    for (const q of ['x) OR 1=1 -- : ', 'foo(bar) : ', 'Unknown.field : ', '"a"" OR 1" : ']) {
      const r = getSuggestions(q, q.length, fields, [{ value: 'v', count: 1 }]);
      expect(r.valueContext).toBeUndefined();
      expect(r.suggestions).toEqual([]);
    }
    const typing = 'nope : ab';
    expect(getSuggestions(typing, typing.length, fields).valueContext).toBeUndefined();
  });

  it('discovered fields and Map keys still get a (quoted) expression', () => {
    const q1 = 'Payload.user.id : ';
    expect(getSuggestions(q1, q1.length, fields).valueContext?.sqlExpr).toBe('Payload.user.id');
    const q2 = "LogAttributes.it's : ";
    expect(getSuggestions(q2, q2.length, fields).valueContext?.sqlExpr).toBe(`LogAttributes['it\\'s']`);
  });
});
