import { buildFieldStatsBatchQuery, parseFieldStatsRow } from '../fieldStats';
import { SourceConfig } from '../../types';

const config = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  columns: { timestamp: 'Timestamp' },
} as unknown as SourceConfig;

describe('buildFieldStatsBatchQuery', () => {
  const sql = buildFieldStatsBatchQuery(
    config,
    [
      { sqlExpr: '`SeverityText`', numeric: false },
      { sqlExpr: '`SeverityNumber`', numeric: true },
    ],
    { table: 'spec_logs', conditions: ["`ServiceName` = 'payments'"], sampleSize: 5000 }
  );

  it('reads one sample of the most recent matching rows', () => {
    expect(sql).toContain('FROM "default"."spec_logs"');
    expect(sql).toContain("WHERE `ServiceName` = 'payments'");
    expect(sql).toContain('ORDER BY Timestamp DESC');
    expect(sql).toContain('LIMIT 5000');
    expect(sql.match(/FROM "default"/g)).toHaveLength(1);
  });

  it('uses positional aliases, never field names', () => {
    expect(sql).toContain('AS v0');
    expect(sql).toContain('AS v1');
    expect(sql).not.toMatch(/AS `?Severity/);
  });

  it('adds numeric summary columns only for numeric fields', () => {
    expect(sql).toContain('AS a1');
    expect(sql).toContain('AS bk1');
    expect(sql).not.toContain('AS a0');
  });

  it('drops absent stand-ins from counts', () => {
    expect(sql).toContain("v0 NOT IN ('{}', '[]', 'null')");
  });

  it('returns empty SQL for no fields and clamps the sample', () => {
    expect(buildFieldStatsBatchQuery(config, [], { table: 't', conditions: [], sampleSize: 5 })).toBe('');
    const s = buildFieldStatsBatchQuery(config, [{ sqlExpr: 'x', numeric: false }], { table: 't', conditions: [], sampleSize: 0 });
    expect(s).toContain('LIMIT 1');
    expect(s).not.toContain('WHERE');
  });
});

describe('parseFieldStatsRow', () => {
  const targets = [
    { sqlExpr: 'a', numeric: false },
    { sqlExpr: 'b', numeric: true },
  ];

  it('maps positional columns to per-field stats (arrays or JSON text)', () => {
    const [kw, num] = parseFieldStatsRow(
      {
        total: 5000, d0: 5000, u0: 2, tv0: ['info', 'warn'], tc0: [4000, 1000],
        d1: 10, u1: 1, tv1: '["9"]', tc1: '[10]', nn1: 10, lo1: 9, hi1: 9, med1: 9, bk1: '[10,0,0,0,0,0,0,0,0,0]',
      },
      targets
    );
    expect(kw).toEqual({ sampled: 5000, docs: 5000, distinct: 2, top: [{ value: 'info', count: 4000 }, { value: 'warn', count: 1000 }] });
    expect(num.top).toEqual([{ value: '9', count: 10 }]);
    expect(num.numeric).toEqual({ count: 10, min: 9, max: 9, median: 9, buckets: [10, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  });

  it('no numeric values -> empty buckets; no row -> zeros', () => {
    const [, num] = parseFieldStatsRow({ total: 3, d1: 0, u1: 0, tv1: [], tc1: [], nn1: 0, bk1: [] }, targets);
    expect(num.numeric?.buckets).toEqual([]);
    expect(parseFieldStatsRow(undefined, targets)[0]).toEqual({ sampled: 0, docs: 0, distinct: 0, top: [] });
  });
});
