/** Round 8 data fixes (audit W1-W8, W10, M4, M9). */
import { dateTime } from '@grafana/data';
import { compileLens, LENS_ROW_LIMIT, shapeLensRows, truncatedNote } from '../compile';
import { BucketDim, decodeLens, encodeLens, FiltersDim, LensState, MetricDim, RangeDim, TermsDim } from '../state';
import { tableColumns } from '../tableChart';
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

describe('W2: date histogram as breakdown', () => {
  it('one series per bucket, in time order, labelled with the date', () => {
    const s = st([svc, date]);
    const rows = [
      { b0: 'a', b1: range.from + H, m0: 2 },
      { b0: 'a', b1: range.from, m0: 1 },
      { b0: 'b', b1: range.from, m0: 3 },
    ];
    const r = shapeLensRows(s, rows, H);
    expect(r.series.map((x) => x.breakdown)).toEqual([String(range.from), String(range.from + H)]);
    expect(r.series[0].name).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/);
    expect([...r.series[0].points.values()]).toEqual([1, 3]);
    expect([...r.series[1].points.values()]).toEqual([2]);
  });
});

describe('W3: overlapping ranges', () => {
  it('a record is put in every range it fits', () => {
    const b: RangeDim = { kind: 'range', id: 'r', field: 'SeverityNumber', label: 's', numeric: true, ranges: [{ to: 10 }, { to: 14 }, {}] };
    const sql = sqlOf(st([b]));
    expect(sql).not.toContain('multiIf');
    expect(sql).toContain('arrayJoin(arrayFilter(__r -> __r >= 0');
    if (process.env.R8_SQL) {
      console.log(sql);
    }
  });
});

describe('W4 / M4: filters and ranges', () => {
  const f: FiltersDim = {
    kind: 'filters',
    id: 'f',
    field: '',
    label: 'Filters',
    filters: [
      { query: 'a: 1', label: 'bad' },
      { query: 'a: 2', label: 'bad' },
      { query: 'a: 3', label: 'none' },
    ],
  };
  it('equal labels stay separate series; a filter without records is 0', () => {
    const r = shapeLensRows(st([svc, f]), [
      { b0: 'p', b1: 1, m0: 5 },
      { b0: 'p', b1: 0, m0: 7 },
    ]);
    expect(r.series.map((x) => [x.name, x.points.get('p')])).toEqual([
      ['bad', 7],
      ['bad (2)', 5],
      ['none', 0],
    ]);
    expect(r.table.rows).toEqual([
      ['p', 'bad', 7],
      ['p', 'bad (2)', 5],
      ['p', 'none', 0],
    ]);
  });
  it('on the axis: every entry, in order; other metrics stay empty', () => {
    const avg: MetricDim = { kind: 'metric', id: 'm1', op: 'avg', field: 'SeverityNumber', numeric: true };
    const r = shapeLensRows(st([f], [count, avg]), [{ b0: 1, m0: 5, m1: 2 }]);
    expect(r.xLabels).toEqual(['bad', 'bad (2)', 'none']);
    expect(r.table.rows.map((x) => x.slice(1))).toEqual([
      [0, null],
      [5, 2],
      [0, null],
    ]);
  });
  it('saved panels get the same labels', () => {
    expect(sqlOf(st([f]), 'dashboard')).toContain("['bad', 'bad (2)', 'none']");
  });
  it('a pivoted table keeps equal labels apart', () => {
    const s: LensState = { chartType: 'table', buckets: [svc, { ...f, pivot: true }], metrics: [count] };
    const cols = tableColumns(
      s,
      shapeLensRows(s, [
        { b0: 'p', b1: 0, m0: 1 },
        { b0: 'p', b1: 1, m0: 2 },
      ]).table
    );
    expect(cols.map((c) => c.values)).toEqual([['p'], [1], [2], [0]]);
  });
});
