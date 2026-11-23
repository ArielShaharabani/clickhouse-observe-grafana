/** Round 8 data fixes (audit W1-W8, W10, M4, M9). */
import { dateTime } from '@grafana/data';
import { compileLens, LENS_ROW_LIMIT, shapeLensRows, truncatedNote } from '../compile';
import { BucketDim, decodeLens, encodeLens, FiltersDim, LensState, MetricDim, RangeDim, TermsDim } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const from = dateTime(Date.UTC(2026, 0, 1));
const to = dateTime(Date.UTC(2026, 0, 8));
const tr = { from, to, raw: { from, to } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const svc: TermsDim = { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 3 };
const date: BucketDim = { kind: 'date_histogram', id: 'd', field: 'Timestamp', label: 'Timestamp', interval: '1h' };
const range = { from: from.valueOf(), to: to.valueOf() };
const H = 3600_000;
const st = (buckets: BucketDim[], metrics: MetricDim[] = [count]): LensState => ({ chartType: 'bar', buckets, metrics });
const sqlOf = (s: LensState, mode: 'app' | 'dashboard' = 'app') => compileLens(s, config, conds, tr, mode).sql;

describe('W1: cut results', () => {
  it('drops the half-read last bucket and never fills with 0', () => {
    const rows = Array.from({ length: LENS_ROW_LIMIT + 1 }, (_, i) => ({
      b0: range.from + Math.floor(i / 1000) * H,
      b1: `v${i % 1000}`,
      m0: 1,
    }));
    const s = st([date, { ...svc, id: 'b1' }]);
    const cut = shapeLensRows(s, rows, H, { interval: { n: 1, unit: 'h' }, range });
    expect(cut.truncated).toBe(true);
    expect(cut.xs).toHaveLength(50);
    expect(cut.series.every((x) => !x.zeroFill)).toBe(true);
    expect(truncatedNote(cut)).toContain('50,000');
    const whole = shapeLensRows(s, rows.slice(0, LENS_ROW_LIMIT), H, { interval: { n: 1, unit: 'h' }, range });
    expect(whole.truncated).toBeUndefined();
    expect(whole.xs).toHaveLength(168);
    expect(truncatedNote(whole)).toBeNull();
    const partial = shapeLensRows(s, rows.slice(0, LENS_ROW_LIMIT).concat([{ b0: rows[49999].b0, b1: 'z', m0: 1 }]), H);
    expect(partial.xs).toHaveLength(49);
  });
  it('asks for one row more; panels keep their limit; top values are capped', () => {
    expect(sqlOf(st([svc]))).toMatch(/LIMIT 50001$/);
    expect(sqlOf(st([svc]), 'dashboard')).toMatch(/LIMIT 10000$/);
    const s = decodeLens(encodeLens(st([{ ...svc, size: 100000 }])))!;
    expect((s.buckets[0] as TermsDim).size).toBe(1000);
    expect(sqlOf(st([{ ...svc, size: 5000 }]))).toContain('LIMIT 1000)');
  });
});
