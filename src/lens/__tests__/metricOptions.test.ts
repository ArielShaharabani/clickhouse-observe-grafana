import { dateTime } from '@grafana/data';
import { compileLens } from '../compile';
import { withOp } from '../dimensions';
import {
  cleanMetricOptions,
  formatValue,
  grafanaUnit,
  optionsLabelSuffix,
  parseSpan,
  patternError,
  spanError,
} from '../metricOptions';
import { autoLabel, decodeLens, encodeLens, LensField, LensState, MetricDim } from '../state';
import { buildWhereConditions } from '../../sql/queryBuilder';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

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
const conds = buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, search: '', filters: [] });

const date = {
  kind: 'date_histogram' as const,
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto' as const,
};
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const avg: MetricDim = {
  kind: 'metric',
  id: 'm1',
  op: 'avg',
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};
const lens = (metrics: MetricDim[], buckets: LensState['buckets'] = [date]): LensState => ({
  chartType: 'line',
  buckets,
  metrics,
});

describe('parseSpan', () => {
  it('accepts a whole number and a known unit only', () => {
    expect(parseSpan('3h')).toEqual({ n: 3, unit: 'h' });
    expect(parseSpan(' 1M ')).toEqual({ n: 1, unit: 'M' });
    for (const bad of ['', '0d', '-1d', '1.5h', '1 day', '3x', '1d; DROP TABLE x', "1d') OR 1=1 --", '99999y', 5]) {
      expect(parseSpan(bad)).toBeNull();
    }
    expect(spanError('abc')).toMatch(/whole number/);
    expect(spanError('')).toBeNull();
  });
});

describe('formatValue', () => {
  const dflt = (v: number) => `d${v}`;
  it('formats each kind', () => {
    expect(formatValue(1234.567, undefined, dflt)).toBe('d1234.567');
    expect(formatValue(1234.567, { id: 'number', decimals: 1 }, dflt)).toBe('1,234.6');
    expect(formatValue(0.256, { id: 'percent', decimals: 1 }, dflt)).toBe('25.6%');
    expect(formatValue(2048, { id: 'bytes' }, dflt)).toBe('2.0 KiB');
    expect(formatValue(1500, { id: 'bits' }, dflt)).toBe('1.5 kb');
    expect(formatValue(1500, { id: 'duration', durationUnit: 'ms' }, dflt)).toBe('1.5 s');
    expect(formatValue(90, { id: 'duration', durationUnit: 'm' }, dflt)).toBe('1.5 h');
    expect(formatValue(1234567, { id: 'custom', pattern: '0.0a' }, dflt)).toBe('1.2m');
    expect(formatValue(1234.5, { id: 'custom', pattern: '$0,0.00' }, dflt)).toBe('$1,234.50');
    expect(formatValue(3.14159, { id: 'custom', pattern: '0.00 req/s' }, dflt)).toBe('3.14 req/s');
    expect(formatValue(0.5, { id: 'custom', pattern: '0%' }, dflt)).toBe('50%');
  });
  it('validates custom patterns', () => {
    expect(patternError('0,0.00')).toBeNull();
    expect(patternError('abc')).not.toBeNull();
    expect(patternError('0'.repeat(50))).not.toBeNull();
  });
  it('maps to Grafana units', () => {
    expect(grafanaUnit({ id: 'bytes' })).toEqual({ unit: 'bytes', decimals: undefined });
    expect(grafanaUnit({ id: 'percent', decimals: 1 })).toEqual({ unit: 'percentunit', decimals: 1 });
    expect(grafanaUnit({ id: 'duration', durationUnit: 's' })).toEqual({ unit: 's' });
    expect(grafanaUnit({ id: 'custom', pattern: '0.0 req/s' })).toEqual({ unit: 'suffix: req/s', decimals: 1 });
    expect(grafanaUnit(undefined)).toEqual({});
  });
});

describe('cleanMetricOptions (untrusted URL input)', () => {
  it('keeps only valid, known options', () => {
    expect(
      cleanMetricOptions({
        filter: 'SeverityText : ERROR',
        shift: '1d',
        reducedRange: '15m',
        normalize: 'h',
        format: { id: 'bytes', decimals: 3, evil: 1 },
        color: '#AABBCC',
        axis: 'right',
        sql: 'DROP TABLE x',
      })
    ).toEqual({
      filter: 'SeverityText : ERROR',
      shift: '1d',
      reducedRange: '15m',
      normalize: 'h',
      format: { id: 'bytes', decimals: 3 },
      color: '#aabbcc',
      axis: 'right',
    });
    expect(
      cleanMetricOptions({
        shift: "1d') OR 1=1",
        reducedRange: 'x',
        normalize: 'week',
        format: { id: 'custom', pattern: '<script>' },
        color: 'red;background:url(x)',
        axis: 'top',
        filter: 'x'.repeat(5000),
      })
    ).toEqual({});
  });

  it('decodeLens drops unknown metric keys and bad options', () => {
    const raw = JSON.stringify({
      chartType: 'line',
      buckets: [date],
      metrics: [{ ...avg, shift: '1d; DROP', color: '#00ff00', sqlExpr: 'evil', extra: { a: 1 } }],
    });
    const m = decodeLens(raw)!.metrics[0] as unknown as Record<string, unknown>;
    expect(m.color).toBe('#00ff00');
    expect(m.shift).toBeUndefined();
    expect(m.sqlExpr).toBeUndefined();
    expect(m.extra).toBeUndefined();
    // Round trip keeps valid options.
    const s = lens([{ ...avg, filter: 'a : b', shift: '1w', format: { id: 'percent' } }]);
    expect(decodeLens(encodeLens(s))!.metrics[0]).toMatchObject({
      filter: 'a : b',
      shift: '1w',
      format: { id: 'percent' },
    });
  });

  it('options survive a function change', () => {
    const fields: LensField[] = [{ id: 'sn', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' }];
    const m = { ...avg, filter: 'a : b', color: '#112233', shift: '1d' };
    expect(withOp(m, 'max', fields)).toMatchObject({ op: 'max', filter: 'a : b', color: '#112233', shift: '1d' });
    expect(withOp(m, 'count', fields)).toMatchObject({ op: 'count', filter: 'a : b', shift: '1d' });
  });

  it('labels show what changes the measure', () => {
    expect(optionsLabelSuffix({ shift: '1d', normalize: 'h' })).toBe(' per hour (1d ago)');
    expect(autoLabel({ ...count, reducedRange: '15m' })).toBe('Count of records (last 15m)');
  });
});

describe('compileLens with metric options', () => {
  it('Filter by compiles KQL into a conditional aggregate', () => {
    const { sql } = compileLens(lens([{ ...count, filter: 'SeverityText : "ERROR"' }, avg]), config, conds, range);
    expect(sql).toMatch(/countIf\(\(.*SeverityText.*'ERROR'.*\)\) AS m0/);
    expect(sql).toContain('avg("SeverityNumber") AS m1');
  });

  it('Filter by values are escaped (no injection through KQL)', () => {
    const { sql } = compileLens(lens([{ ...count, filter: 'SeverityText : "x\') OR 1=1 --"' }]), config, conds, range);
    expect(sql).toContain("\\'");
    expect(sql).not.toMatch(/'x'\) OR 1=1/);
  });

  it('invalid Filter by matches nothing', () => {
    const { sql } = compileLens(lens([{ ...count, filter: 'a : (' }]), config, conds, range);
    expect(sql).toContain('countIf(0) AS m0');
  });

  it('Time shift reads each row once per shift and aggregates its own copy', () => {
    const { sql } = compileLens(lens([count, { ...count, id: 'm2', shift: '1d' }]), config, conds, range);
    expect(sql).toContain('ARRAY JOIN [0, 1] AS __s');
    expect(sql).toContain('countIf(__s = 0) AS m0');
    expect(sql).toContain('countIf(__s = 1) AS m1');
    expect(sql).toContain('multiIf(__s = 1, Timestamp + INTERVAL 1 DAY, Timestamp)');
    expect(sql).toContain('Timestamp >= $__fromTime - INTERVAL 1 DAY AND Timestamp <= $__toTime - INTERVAL 1 DAY');
    // The plain time condition is replaced by the window prefilter + the shifted check.
    expect(sql).toContain(
      'multiIf(__s = 1, Timestamp + INTERVAL 1 DAY, Timestamp) >= $__fromTime AND multiIf(__s = 1, Timestamp + INTERVAL 1 DAY, Timestamp) <= $__toTime'
    );
  });

  it('no shift SQL without a shifted metric, and shift text never reaches SQL', () => {
    expect(compileLens(lens([count]), config, conds, range).sql).not.toContain('ARRAY JOIN');
    const tampered = { ...count, shift: "1d') OR 1=1 --" } as MetricDim;
    const { sql } = compileLens(lens([tampered]), config, conds, range);
    expect(sql).not.toContain('ARRAY JOIN');
    expect(sql).not.toContain('OR 1=1');
  });

  it('formulas get the copy condition when another metric is shifted', () => {
    const f: MetricDim = { kind: 'metric', id: 'f', op: 'formula', formula: 'count()', formulaFields: {} };
    const { sql } = compileLens(lens([f, { ...count, shift: '1w' }]), config, conds, range);
    expect(sql).toContain('countIf(__s = 0) AS m0');
    expect(sql).toContain('countIf(__s = 1) AS m1');
  });

  it('Reduced time range limits a metric to the end of the range (no date histogram)', () => {
    const { sql } = compileLens(
      { chartType: 'metric', buckets: [], metrics: [{ ...count, reducedRange: '15m' }] },
      config,
      conds,
      range
    );
    expect(sql).toContain('countIf(Timestamp > $__toTime - INTERVAL 15 MINUTE) AS m0');
    // Ignored with a date histogram.
    expect(compileLens(lens([{ ...count, reducedRange: '15m' }]), config, conds, range).sql).toContain('count() AS m0');
  });

  it('Normalize by unit scales by the bucket width', () => {
    const { sql, intervalMs } = compileLens(lens([{ ...count, normalize: 'h' }]), config, conds, range);
    expect(intervalMs).toBe(6 * 3600 * 1000);
    expect(sql).toContain('(count()) * 0.166666666667 AS m0');
    const dash = compileLens(lens([{ ...count, normalize: 'm' }]), config, conds, range, 'dashboard').sql;
    expect(dash).toContain('(count()) * (60 / $__interval_s) AS m0');
    // No date histogram: no normalization.
    expect(
      compileLens({ chartType: 'metric', buckets: [], metrics: [{ ...count, normalize: 'h' }] }, config, conds, range)
        .sql
    ).toContain('count() AS m0');
  });

  it('dashboard mode escapes $ in a Filter by value', () => {
    const { sql } = compileLens(
      lens([{ ...count, filter: 'Body : "$__fromTime"' }]),
      config,
      conds,
      range,
      'dashboard'
    );
    // The only $__fromTime left is the WHERE clause's own macro.
    expect(sql.split('$__fromTime').length - 1).toBe(1);
    expect(sql).toContain('\\x24');
  });
});
