import { dateTime } from '@grafana/data';
import { compileLens, shapeLensRows, uniqueMetricLabels } from '../compile';
import { decodeLens, LensState, sanitizeLens } from '../state';
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
const range = { from, to, raw: { from, to } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime', "ServiceName = 'payments'"];

const date = {
  kind: 'date_histogram' as const,
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto' as const,
};
const level = { kind: 'terms' as const, id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 9 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };
const median = {
  kind: 'metric' as const,
  id: 'm1',
  op: 'median' as const,
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};

describe('compileLens', () => {
  it('date histogram + top values breakdown + count', () => {
    const { sql, intervalMs } = compileLens(
      { chartType: 'line', buckets: [date, level], metrics: [count] },
      config,
      conds,
      range
    );
    expect(intervalMs).toBe(3 * 3600 * 1000); // 7 days / ~60 buckets → 3 hours (Kibana; PARITY-HISTOGRAM)
    expect(sql).toContain('toUnixTimestamp(toStartOfInterval("Timestamp", INTERVAL 10800 SECOND)) * 1000 AS b0');
    expect(sql).toContain('WITH top1 AS (SELECT toString("SeverityText") AS v FROM "default"."spec_logs" WHERE');
    expect(sql).toContain(
      'ServiceName = \'payments\' AND toString("SeverityText") IS NOT NULL GROUP BY v ORDER BY count() DESC, v LIMIT 9)'
    );
    expect(sql).toContain('toString("SeverityText") GLOBAL IN (SELECT v FROM top1)');
    expect(sql).toContain('GROUP BY b0, b1');
    expect(sql).toContain('ORDER BY b0, b1');
  });

  it('terms on X orders by the first metric; median is a quantile; no bucket → one row', () => {
    const terms = compileLens(
      { chartType: 'bar', buckets: [level], metrics: [count, median] },
      config,
      conds,
      range
    ).sql;
    expect(terms).toContain('quantile(0.5)("SeverityNumber") AS m1');
    expect(terms).toContain('ORDER BY m0 DESC, b0');
    const metric = compileLens({ chartType: 'metric', buckets: [], metrics: [count] }, config, conds, range).sql;
    expect(metric).not.toContain('GROUP BY');
    expect(metric).toContain('SELECT count() AS m0');
  });

  it('non-numeric fields are cast for numeric aggregates; unique count uses uniq', () => {
    const sql = compileLens(
      {
        chartType: 'metric',
        buckets: [],
        metrics: [
          { kind: 'metric', id: 'a', op: 'avg', field: "LogAttributes['latency']", fieldLabel: 'latency' },
          { kind: 'metric', id: 'u', op: 'unique', field: 'TraceId', fieldLabel: 'TraceId' },
        ],
      },
      config,
      [],
      range
    ).sql;
    expect(sql).toContain("avg(toFloat64OrNull(toString(LogAttributes['latency']))) AS m0");
    expect(sql).toContain('uniq("TraceId") AS m1');
  });
});

describe('shapeLensRows', () => {
  const state: LensState = { chartType: 'line', buckets: [date, level], metrics: [count] };
  it('one series per breakdown value over sorted time buckets', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const r = shapeLensRows(state, [
      { b0: String(t0 + 6 * 3600 * 1000), b1: 'error', m0: 2 },
      { b0: t0, b1: 'info', m0: 5 },
      { b0: t0, b1: 'error', m0: 1 },
    ]);
    expect(r.xIsTime).toBe(true);
    expect(r.xs).toEqual([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 1, 6)]);
    // Legend / stack order: by total count, descending (info 5 > error 3), as in Kibana.
    expect(r.series.map((s) => s.name)).toEqual(['info', 'error']);
    expect(r.series[1].points.get(Date.UTC(2026, 0, 1))).toBe(1);
    expect(r.table.columns).toEqual(['Timestamp', 'Top 9 values of SeverityText', 'Count of records']);
  });

  it('several metrics without breakdown: one series per metric, named by its label', () => {
    const r = shapeLensRows({ chartType: 'bar', buckets: [level], metrics: [count, median] }, [
      { b0: 'error', m0: 3, m1: 17 },
    ]);
    expect(r.xIsTime).toBe(false);
    expect(r.series.map((s) => s.name)).toEqual(['Count of records', 'Median of SeverityNumber']);
  });
});

describe('untrusted lens URL state (security regression guard)', () => {
  const hostile = '(SELECT groupArray(name) FROM system.users)';
  const raw = JSON.stringify({
    chartType: 'bar',
    buckets: [{ kind: 'terms', id: 'b', field: hostile, label: 'x', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm', op: 'unique', field: `${hostile}) AS m0 --` }],
  });

  it('sanitizeLens drops dimensions on fields that were not discovered', () => {
    const s = sanitizeLens(decodeLens(raw)!, new Set(['ServiceName', 'Timestamp']));
    expect(s).toEqual({ chartType: 'bar', buckets: [], metrics: [] }); // nothing safe left → empty workspace
  });

  it('even unsanitized, a hostile field never reaches the SQL unquoted', () => {
    const sql = compileLens(decodeLens(raw)!, config, [], range).sql;
    expect(sql).not.toContain(`toString(${hostile})`);
    expect(sql).toContain('toString("(SELECT groupArray(name) FROM system.users)")');
    expect(sql).not.toMatch(/uniq\(\(SELECT/);
  });

  it('discovered Map accessors still pass through as expressions', () => {
    const sql = compileLens(
      {
        chartType: 'bar',
        buckets: [{ kind: 'terms', id: 'b', field: "LogAttributes['http.method']", label: 'm', size: 9 }],
        metrics: [],
      },
      config,
      [],
      range
    ).sql;
    expect(sql).toContain("toString(LogAttributes['http.method'])");
  });
});

describe('duplicate metric labels', () => {
  it('stay distinct so series never merge', () => {
    expect(uniqueMetricLabels([median, median, count])).toEqual([
      'Median of SeverityNumber',
      'Median of SeverityNumber (2)',
      'Count of records',
    ]);
  });
});

describe('time gaps are filled so the axis is linear in time', () => {
  it('adds the missing buckets between the first and last', () => {
    const h = 3_600_000;
    const r = shapeLensRows(
      { chartType: 'line', buckets: [date], metrics: [count] },
      [
        { b0: 0, m0: 1 },
        { b0: 3 * h, m0: 2 },
      ],
      h
    );
    expect(r.xs).toEqual([0, h, 2 * h, 3 * h]);
    expect(r.series[0].zeroFill).toBe(true);
  });
});
