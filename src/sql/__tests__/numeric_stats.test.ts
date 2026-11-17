import { buildNumericStatsQuery } from '../queryBuilder';
import { fetchNumericStats, fetchFieldValuesWithTotal } from '../kql/_values';
import { runQueryRows } from '../../data/runQuery';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { rangeUtil } from '@grafana/data';
import { FieldModel, isBreakdownField } from '../fieldModel';

jest.mock('../../data/runQuery', () => ({ runQueryRows: jest.fn() }));

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const timeRange = rangeUtil.convertRawToRange({ from: 'now-7d', to: 'now' });
const opts = { table: 'spec_logs', conditions: ["ServiceName = 'payments'"], timeRange, cacheKey: 'k' };

describe('DISC-SIDEBAR-02: numeric field statistics query', () => {
  it('samples the most recent rows, computes min/median/max and 10 equal-width buckets', () => {
    const sql = buildNumericStatsQuery(config, 'SeverityNumber', { table: 'spec_logs', conditions: ["ServiceName = 'payments'"], sampleSize: 5000 });
    expect(sql).toContain('toFloat64OrNull(toString(SeverityNumber))');
    expect(sql).toContain("WHERE ServiceName = 'payments'");
    expect(sql).toContain('ORDER BY Timestamp DESC');
    expect(sql).toContain('LIMIT 5000');
    expect(sql).toContain('quantileExact(0.5)(v)');
    expect(sql).toMatch(/least\(9, .*floor/);
    // The sample is read once (single subquery), and the division is guarded inside floor().
    expect(sql.match(/LIMIT 5000/g)).toHaveLength(1);
    expect(sql).toContain('if(hi > lo, (x - lo) / (hi - lo), 0)');
  });
});

describe('DISC-SIDEBAR-02: numeric stats parsing', () => {
  beforeEach(() => (runQueryRows as jest.Mock).mockReset());

  it('returns summary stats and ten buckets (missing buckets filled with 0)', async () => {
    (runQueryRows as jest.Mock).mockResolvedValue([{ lo: 5, hi: 17, med: 9, n: 10, buckets: [2, 0, 0, 6, 0, 0, 0, 0, 0, 2] }]);
    const stats = await fetchNumericStats(config, 'SeverityNumber', { ...opts, sampleSize: 5000 });
    expect(stats).toMatchObject({ min: 5, max: 17, median: 9, count: 10 });
    expect(stats.buckets).toHaveLength(10);
    expect(stats.buckets.map((b) => b.count)).toEqual([2, 0, 0, 6, 0, 0, 0, 0, 0, 2]);
    expect(stats.buckets[0].from).toBe(5);
    expect(stats.buckets[9].to).toBe(17);
  });

  it('puts every value in one bucket when min equals max', async () => {
    (runQueryRows as jest.Mock).mockResolvedValue([{ lo: 0, hi: 0, med: 0, n: 4, buckets: '[4,0,0,0,0,0,0,0,0,0]' }]);
    const stats = await fetchNumericStats(config, 'TraceFlags', { ...opts, sampleSize: 5000 });
    expect(stats.buckets.filter((b) => b.count > 0)).toEqual([{ from: 0, to: 0, count: 4 }]);
  });

  it('returns an empty result when no sampled row has a numeric value', async () => {
    (runQueryRows as jest.Mock).mockResolvedValue([{ lo: null, hi: null, med: null, n: 0, buckets: [] }]);
    const stats = await fetchNumericStats(config, 'Body', { ...opts, sampleSize: 5000 });
    expect(stats).toEqual({ min: 0, max: 0, median: 0, count: 0, buckets: [] });
    (runQueryRows as jest.Mock).mockResolvedValue([]);
    expect(await fetchNumericStats(config, 'Body', { ...opts, sampleSize: 5000 })).toMatchObject({ count: 0 });
  });

  it('passes the requested sample size to the top-values query', async () => {
    (runQueryRows as jest.Mock).mockResolvedValue([]);
    await fetchFieldValuesWithTotal(config, 'ServiceName', { ...opts, sampleSize: 5000 });
    expect((runQueryRows as jest.Mock).mock.calls[0][0].sql).toContain('LIMIT 5000');
  });
});

describe('DISC-SIDEBAR-02: one breakdown rule for picker and popover', () => {
  const f = (type: string) => ({ type }) as unknown as FieldModel;
  it('allows scalar fields and rejects whole containers', () => {
    expect(['string', 'number', 'boolean', 'date'].map((t) => isBreakdownField(f(t)))).toEqual([true, true, true, true]);
    expect(['map', 'json', 'tuple', 'array'].map((t) => isBreakdownField(f(t)))).toEqual([false, false, false, false]);
  });
});
