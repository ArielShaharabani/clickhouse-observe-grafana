import { DEFAULT_LOGS_QUERY_STATE, DEFAULT_SOURCE_CONFIG, FilterPill } from '../../types';
import { buildFieldIndex } from '../fields';
import { jsonPathField } from '../jsonPaths';
import { buildWhereConditions } from '../queryBuilder';

const objects = jsonPathField('P', 'arr:y', undefined, ['Array(JSON(max_dynamic_types=16, max_dynamic_paths=256))']);
const mixed = jsonPathField('P', 'mix', undefined, ['Int64', 'String']);
const tags = jsonPathField('P', 'tags', undefined, ['Array(Nullable(String))']);
const typed = jsonPathField('P', 'name', undefined, ['String']);
const index = buildFieldIndex([objects, mixed, tags, typed]);
const where = (f: Partial<FilterPill> & { field: string }) =>
  buildWhereConditions(
    DEFAULT_SOURCE_CONFIG,
    { ...DEFAULT_LOGS_QUERY_STATE, filters: [{ id: '1', op: '=', value: '', ...f }] },
    index
  ).pop();

const LIST = '[{"in:ner":1}]';
const JSON_TEXT = (e: string) => `replaceAll(ifNull(toJSONString(${e}), ''), '\\\\/', '/')`;

it('a list of objects compares with its JSON; the bare comparison (which throws) is never sent', () => {
  const eq = `(toString(P."arr:y") IN ('${LIST}') OR ${JSON_TEXT('P."arr:y"')} IN ('${LIST}'))`;
  expect(where({ field: objects.sqlExpr, value: LIST })).toBe(eq);
  expect(where({ field: objects.sqlExpr, value: LIST, op: '!=' })).toBe(`NOT ${eq}`);
  expect(where({ field: objects.sqlExpr, op: 'one_of', values: [LIST] })).toBe(eq);
  expect(where({ field: objects.sqlExpr, value: 'ner', op: 'contains' })).toBe(`toString(P."arr:y") ILIKE '%ner%'`);
});

it('a path with mixed types compares as text', () => {
  expect(where({ field: mixed.sqlExpr, value: 'plain' })).toBe(`toString(P.mix) = 'plain'`);
  expect(where({ field: mixed.sqlExpr, op: 'one_of', values: ['5', 'x'] })).toBe(`toString(P.mix) IN ('5', 'x')`);
});

it('a list of plain values: any element, or the whole list as shown in the grid', () => {
  const e = tags.sqlExpr;
  expect(where({ field: e, value: 'x' })).toBe(`arrayExists(x -> toString(x) = 'x', ${e})`);
  expect(where({ field: e, value: '["x"]' })).toBe(
    `(arrayExists(x -> toString(x) = '["x"]', ${e}) OR ${JSON_TEXT(e)} IN ('["x"]'))`
  );
  expect(where({ field: e, op: 'not_one_of', values: ['x', 'y'] })).toBe(
    `NOT (arrayExists(x -> toString(x) = 'x', ${e}) OR arrayExists(x -> toString(x) = 'y', ${e}))`
  );
});

it('a quote in the value stays inside its literal', () => {
  expect(where({ field: objects.sqlExpr, value: `[{"a":"'"}]` })).not.toMatch(/[^\\]''\}\]'/);
  expect(where({ field: objects.sqlExpr, value: `[{"a":"'"}]` })).toContain(`\\'`);
});

it('typed scalar paths are unchanged', () => {
  expect(where({ field: typed.sqlExpr, value: 'a' })).toBe(`toString(P.name) = 'a'`);
});
