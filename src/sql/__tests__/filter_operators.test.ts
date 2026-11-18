/**
 * DISC-FILTER-02: WHERE output for every filter-builder operator, including range operators and
 * hostile values. Every value must reach SQL only through quoteString / quoteIdentifier.
 */
import { buildWhereConditions } from '../queryBuilder';
import { buildFieldIndex } from '../fields';
import { FieldModel } from '../fieldModel';
import { filterLabel, negateFilter } from '../filters';
import { FilterPill, FilterOp, OTEL_COLUMN_MAPPING, DEFAULT_LOGS_QUERY_STATE, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'test',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};

const clause = (pill: Omit<FilterPill, 'id'>, index?: ReturnType<typeof buildFieldIndex>) =>
  buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, filters: [{ id: 'f1', ...pill }] }, index)[1];

const HOSTILE = ["') OR 1=1 --", "a'b", 'back\\slash\\', "\\' OR '1'='1"];
const STRING_LITERAL = /'(?:[^'\\]|\\.)*'/g;

describe('every operator produces its WHERE', () => {
  const cases: Array<[FilterOp, string, Partial<FilterPill>, string]> = [
    ['=', 'ServiceName', { value: 'api' }, `"ServiceName" = 'api'`],
    ['!=', 'ServiceName', { value: 'api' }, `"ServiceName" != 'api'`],
    ['contains', 'ServiceName', { value: 'api' }, `"ServiceName" ILIKE '%api%'`],
    ['not_contains', 'ServiceName', { value: 'api' }, `"ServiceName" NOT ILIKE '%api%'`],
    ['one_of', 'ServiceName', { values: ['a', 'b'] }, `"ServiceName" IN ('a', 'b')`],
    ['not_one_of', 'ServiceName', { values: ['a', 'b'] }, `"ServiceName" NOT IN ('a', 'b')`],
    ['gte', 'SeverityNumber', { value: '13' }, `"SeverityNumber" >= '13'`],
    ['lt', 'SeverityNumber', { value: '13' }, `"SeverityNumber" < '13'`],
    ['between', 'SeverityNumber', { values: ['9', '13'] }, `"SeverityNumber" BETWEEN '9' AND '13'`],
    ['not_between', 'SeverityNumber', { values: ['9', '13'] }, `"SeverityNumber" NOT BETWEEN '9' AND '13'`],
    ['exists', 'SeverityNumber', {}, `notEmpty(toString("SeverityNumber"))`],
    ['not_exists', 'SeverityNumber', {}, `empty(toString("SeverityNumber"))`],
  ];
  it.each(cases)('%s', (op, field, extra, sql) => {
    expect(clause({ field, op, value: '', ...extra })).toBe(sql);
  });
});

describe('range operators', () => {
  it('trims bounds', () => {
    expect(clause({ field: 'SeverityNumber', op: 'between', value: '', values: [' 9 ', '13 '] })).toContain(
      `BETWEEN '9' AND '13'`
    );
  });

  it('incomplete between is 1=0, incomplete not_between is 1=1', () => {
    expect(clause({ field: 'SeverityNumber', op: 'between', value: '', values: ['9'] })).toBe('1=0');
    expect(clause({ field: 'SeverityNumber', op: 'between', value: '', values: ['9', ' '] })).toBe('1=0');
    expect(clause({ field: 'SeverityNumber', op: 'not_between', value: '' })).toBe('1=1');
  });

  it('Map values compare numerically (toFloat64OrNull on both sides)', () => {
    const fields: FieldModel[] = [
      {
        id: 'map:LogAttributes:duration_ms',
        name: 'duration_ms',
        displayName: 'LogAttributes.duration_ms',
        sqlExpr: "LogAttributes['duration_ms']",
        type: 'string',
        source: 'map',
        mapColumn: 'LogAttributes',
      },
    ];
    const index = buildFieldIndex(fields);
    const f = "LogAttributes['duration_ms']";
    expect(clause({ field: f, op: 'gte', value: '1000' }, index)).toBe(
      `toFloat64OrNull(${f}) >= toFloat64OrNull('1000')`
    );
    expect(clause({ field: f, op: 'between', value: '', values: ['5', '10'] }, index)).toBe(
      `toFloat64OrNull(${f}) BETWEEN toFloat64OrNull('5') AND toFloat64OrNull('10')`
    );
  });
});

describe('hostile values never leave their string literal', () => {
  const ops: FilterOp[] = ['=', '!=', 'contains', 'not_contains', 'gte', 'lt'];
  const combos = HOSTILE.flatMap((v) => ops.map((op) => [op, v] as [FilterOp, string]));
  it.each(combos)('%s %j', (op, v) => {
    const got = clause({ field: 'ServiceName', op, value: v });
    // Strip every correctly escaped string literal; only the column and operator may remain.
    expect(got.replace(STRING_LITERAL, '?')).toMatch(/^"ServiceName" (=|!=|ILIKE|NOT ILIKE|>=|<) \?$/);
  });

  it.each(HOSTILE)('one_of / between with %j', (v) => {
    const oneOf = clause({ field: 'ServiceName', op: 'one_of', value: '', values: [v, 'x'] });
    expect(oneOf.replace(STRING_LITERAL, '?')).toBe('"ServiceName" IN (?, ?)');
    const between = clause({ field: 'SeverityNumber', op: 'between', value: '', values: [v, v] });
    expect(between.replace(STRING_LITERAL, '?')).toBe('"SeverityNumber" BETWEEN ? AND ?');
  });

  it('a hostile field is one quoted identifier for range ops', () => {
    expect(clause({ field: 'x) OR 1=1 -- (', op: 'gte', value: '1' })).toBe(`"x) OR 1=1 -- (" >= '1'`);
  });
});

describe('labels and negation', () => {
  it('range labels', () => {
    expect(filterLabel({ id: 'a', field: 'n', op: 'gte', value: '5' })).toBe('n ≥ 5');
    expect(filterLabel({ id: 'a', field: 'n', op: 'lt', value: '5' })).toBe('n < 5');
    expect(filterLabel({ id: 'a', field: 'n', op: 'between', value: '', values: ['1', '2'] })).toBe(
      'n is between 1 and 2'
    );
    expect(filterLabel({ id: 'a', field: 'n', op: 'not_between', value: '', values: ['1', '2'] })).toBe(
      'n is not between 1 and 2'
    );
  });

  it('custom label wins', () => {
    expect(filterLabel({ id: 'a', field: 'n', op: 'gte', value: '5', label: 'big' })).toBe('big');
  });

  it('negate flips range operators and keeps values', () => {
    const p: FilterPill = { id: 'a', field: 'n', op: 'between', value: '', values: ['1', '2'] };
    expect(negateFilter(p)).toMatchObject({ op: 'not_between', values: ['1', '2'] });
    expect(negateFilter(negateFilter(p)).op).toBe('between');
    expect(negateFilter({ id: 'a', field: 'n', op: 'gte', value: '5' }).op).toBe('lt');
    expect(negateFilter({ id: 'a', field: 'n', op: 'lt', value: '5' }).op).toBe('gte');
  });
});
