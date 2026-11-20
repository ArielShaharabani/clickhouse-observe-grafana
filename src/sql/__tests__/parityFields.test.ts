import { buildFieldStatsBatchQuery, parseFieldStatsRow } from '../fieldStats';
import { buildFieldIndex } from '../fields';
import { FieldModel } from '../fieldModel';
import { unknownKqlFields } from '../kql/unknownFields';
import { buildTimeBoundsQuery } from '../timeBounds';
import { buildFilterConditions } from '../queryBuilder';
import { groupWithNext, removeFromGroup, sanitizeFilterPills, setGroupOp } from '../filters';
import { DEFAULT_SOURCE_CONFIG, FilterPill, SourceConfig } from '../../types';

const config: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'otel_logs',
};

const col = (name: string, type: FieldModel['type'] = 'string'): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});

describe('PARITY-FIELDS #40 field statistics', () => {
  it('counts the empty string as a value for real columns and keeps Map keys as "missing"', () => {
    const sql = buildFieldStatsBatchQuery(
      config,
      [
        { sqlExpr: 'ServiceName', numeric: false, blankIsValue: true },
        { sqlExpr: "LogAttributes['k']", numeric: false },
      ],
      { table: 't', conditions: [], sampleSize: 100 }
    );
    expect(sql).toContain('toString(ServiceName) AS v0');
    expect(sql).toContain('isNotNull(v0)');
    expect(sql).not.toContain('notEmpty(v0)');
    expect(sql).toContain("ifNull(toString(LogAttributes['k']), '') AS v1");
    expect(sql).toContain('notEmpty(v1)');
  });

  it('profiles a time field as a min / max range', () => {
    const targets = [{ sqlExpr: 'Timestamp', numeric: false, time: true, blankIsValue: true }];
    const sql = buildFieldStatsBatchQuery(config, targets, { table: 't', conditions: [], sampleSize: 100 });
    expect(sql).toContain('minIf(v0');
    expect(sql).toContain('maxIf(v0');
    const [s] = parseFieldStatsRow(
      { total: 10, d0: 10, u0: 10, tv0: [], tc0: [], tlo0: '2026-01-01 00:00:00', thi0: '2026-01-08 00:00:00' },
      targets
    );
    expect(s.range).toEqual({ min: '2026-01-01 00:00:00', max: '2026-01-08 00:00:00' });
    const [none] = parseFieldStatsRow({ total: 10, d0: 0, u0: 0, tv0: [], tc0: [] }, targets);
    expect(none.range).toBeUndefined();
  });
});

describe('PARITY-FIELDS #44 unknown KQL fields', () => {
  const fields = [col('ServiceName'), col('Body'), col('LogAttributes', 'map')];
  const index = buildFieldIndex(fields);
  it('reports fields that are not in the data view', () => {
    expect(unknownKqlFields('nosuchfield : x', config, index)).toEqual(['nosuchfield']);
    expect(unknownKqlFields('ServiceName : a and (nope : b or other > 3)', config, index)).toEqual(['nope', 'other']);
    expect(unknownKqlFields('not ghost : 1', config, index)).toEqual(['ghost']);
  });
  it('stays quiet for known fields, map keys, bare terms, wildcards, bad syntax and no fields yet', () => {
    expect(unknownKqlFields('ServiceName : a', config, index)).toEqual([]);
    expect(unknownKqlFields('LogAttributes.http.method : GET', config, index)).toEqual([]);
    expect(unknownKqlFields('error timeout', config, index)).toEqual([]);
    expect(unknownKqlFields('Serv* : a', config, index)).toEqual([]);
    expect(unknownKqlFields('ServiceName : (', config, index)).toEqual([]);
    expect(unknownKqlFields('nosuchfield : x', config, buildFieldIndex([]))).toEqual([]);
    expect(unknownKqlFields('', config, index)).toEqual([]);
  });
});

describe('PARITY-FIELDS #10 time bounds', () => {
  it('builds one min / max aggregate over the time field', () => {
    const sql = buildTimeBoundsQuery({ ...config, columns: { ...config.columns, timestamp: 'Timestamp' } });
    expect(sql).toContain('min(Timestamp)');
    expect(sql).toContain('max(Timestamp)');
    expect(sql).toContain('FROM "default"."otel_logs"');
    expect(sql).not.toContain('WHERE');
  });
  it('is empty without a time field', () => {
    expect(buildTimeBoundsQuery({ ...config, columns: { ...config.columns, timestamp: '' } })).toBe('');
  });
});

describe('PARITY-FIELDS #39 filter groups', () => {
  const p = (id: string, value: string, extra: Partial<FilterPill> = {}): FilterPill => ({
    id,
    field: 'ServiceName',
    op: '=',
    value,
    ...extra,
  });
  const cfg = { ...config, columns: { ...config.columns, timestamp: '' } };
  const or = { group: 'g1', groupOp: 'or' as const };

  it('plain pills are ANDed, an OR group is one parenthesised condition', () => {
    expect(buildFilterConditions([p('a', 'x'), p('b', 'y')], cfg)).toHaveLength(2);
    const sql = buildFilterConditions([p('a', 'x', or), p('b', 'y', or), p('c', 'z')], cfg);
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(/^\(\(.*'x'.*\) OR \(.*'y'.*\)\)$/);
    expect(sql[1]).toContain("'z'");
  });
  it('disabled members drop out; one left is not wrapped; AND groups stay flat', () => {
    const sql = buildFilterConditions([p('a', 'x', { ...or, disabled: true }), p('b', 'y', or)], cfg);
    expect(sql).toHaveLength(1);
    expect(sql[0]).not.toContain(' OR ');
    const and = { group: 'g', groupOp: 'and' as const };
    expect(buildFilterConditions([p('a', 'x', and), p('b', 'y', and)], cfg)).toHaveLength(2);
  });
  it('quotes values inside groups', () => {
    const [c] = buildFilterConditions([p('a', "x' OR 1=1 --", or), p('b', 'y', or)], cfg);
    expect(c).not.toContain("'x' OR 1=1");
  });
  it('groupWithNext joins, keeps members adjacent, removeFromGroup dissolves a pair', () => {
    const f = [p('a', '1'), p('b', '2'), p('c', '3')];
    const g = groupWithNext(f, 'a');
    expect(g.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(g[0].group).toBeTruthy();
    expect(g[0].group).toBe(g[1].group);
    expect(g[2].group).toBeUndefined();
    const g2 = groupWithNext(g, 'a');
    expect(g2.filter((x) => x.group === g[0].group)).toHaveLength(3);
    const un = removeFromGroup(g, 'b');
    expect(un.every((x) => !x.group)).toBe(true);
    expect(setGroupOp(g, g[0].group!, 'and')[0].groupOp).toBe('and');
    expect(groupWithNext([p('a', '1')], 'a')).toHaveLength(1);
  });
  it('sanitizes group fields from untrusted input', () => {
    const [a, b, c] = sanitizeFilterPills([
      { id: 'a', field: 'f', op: '=', value: 'v', group: 'g1', groupOp: 'or' },
      { id: 'b', field: 'f', op: '=', value: 'v', group: '<script>', groupOp: 'or' },
      { id: 'c', field: 'f', op: '=', value: 'v', group: 'g2', groupOp: 'drop table' },
    ]);
    expect(a.group).toBe('g1');
    expect(a.groupOp).toBe('or');
    expect(b.group).toBeUndefined();
    expect(b.groupOp).toBeUndefined();
    expect(c.groupOp).toBe('and');
  });
});
