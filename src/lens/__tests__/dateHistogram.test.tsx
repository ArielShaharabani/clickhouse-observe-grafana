import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens, shapeLensRows } from '../compile';
import { DimensionEditor } from '../DimensionEditor';
import { withBucketField, withDateOptions } from '../dimensions';
import { discoverIntervalOf, lensForHistogram } from '../handoff';
import {
  bucketStartSql,
  dashboardBucketSql,
  intervalError,
  intervalFromDiscover,
  intervalToDiscover,
  LENS_MAX_BUCKETS,
  parseInterval,
  resolveLensInterval,
  stepBucket,
} from '../interval';
import { buildLensPanel } from '../panelExport';
import { BucketDim, DateHistogramDim, decodeLens, encodeLens, LensField, LensState, MetricDim } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const H = 3_600_000;
const DAY = 24 * H;
const at = (ms: number) => dateTime(ms);
const rangeOf = (fromMs: number, toMs: number) => ({
  from: at(fromMs),
  to: at(toMs),
  raw: { from: at(fromMs), to: at(toMs) },
});
const T0 = Date.UTC(2026, 0, 1);
const week = rangeOf(T0, T0 + 7 * DAY);
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];

const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const date: DateHistogramDim = {
  kind: 'date_histogram',
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto',
};
const lensWith = (b: DateHistogramDim): LensState => ({ chartType: 'bar', buckets: [b], metrics: [count] });
const sqlOf = (b: DateHistogramDim, mode: 'app' | 'dashboard' = 'app', range = week) =>
  compileLens(lensWith(b), config, conds, range, mode);

describe('interval grammar (LENS-DIM-05)', () => {
  it('accepts <n><unit>', () => {
    expect(parseInterval('5m')).toEqual({ n: 5, unit: 'm' });
    expect(parseInterval(' 3h ')).toEqual({ n: 3, unit: 'h' });
    expect(parseInterval('1M')).toEqual({ n: 1, unit: 'M' });
    expect(parseInterval('250ms')).toEqual({ n: 250, unit: 'ms' });
    expect(parseInterval('9999d')).toEqual({ n: 9999, unit: 'd' });
  });

  it.each([
    'auto',
    '',
    '0m',
    '05m',
    '10000d',
    '1.5h',
    '-1h',
    '1 h',
    '1H',
    '1hour',
    '1h; DROP TABLE x',
    "1h') OR 1=1 --",
    '1 SECOND',
    '1h\n',
    '${__interval}',
  ])('rejects %j', (t) => {
    expect(parseInterval(t.replace(/\n$/, '\nx'))).toBeNull();
  });

  it('rejects non-strings and explains the format', () => {
    expect(parseInterval(5)).toBeNull();
    expect(parseInterval({ n: 1, unit: 'h' })).toBeNull();
    expect(intervalError('xyz')).toMatch(/5m, 3h, 2w/);
    expect(intervalError('2w')).toBeNull();
  });
});

describe('interval resolution', () => {
  it('auto keeps the Discover auto interval (whole seconds)', () => {
    const iv = resolveLensInterval('auto', week);
    expect(iv.unit).toBe('s');
    expect(iv.requested).toBeNull();
    expect(iv.scaled).toBe(false);
  });

  it('a typed interval is used as is while under the bucket cap', () => {
    expect(resolveLensInterval('1h', week)).toMatchObject({ n: 1, unit: 'h', scaled: false });
  });

  it('is a minimum: scaled up (same unit) past the cap', () => {
    const iv = resolveLensInterval('1m', week); // 10,080 one-minute buckets
    expect(iv.unit).toBe('m');
    expect(iv.scaled).toBe(true);
    expect((7 * DAY) / (iv.n * 60_000)).toBeLessThanOrEqual(LENS_MAX_BUCKETS);
  });

  it('steps calendar units exactly', () => {
    const jan31 = Date.UTC(2026, 0, 31);
    expect(stepBucket(Date.UTC(2026, 0, 1), { n: 1, unit: 'M' }, 1)).toBe(Date.UTC(2026, 1, 1));
    expect(stepBucket(Date.UTC(2026, 0, 1), { n: 1, unit: 'y' }, 1)).toBe(Date.UTC(2027, 0, 1));
    expect(stepBucket(Date.UTC(2026, 2, 1), { n: 2, unit: 'M' }, -1)).toBe(Date.UTC(2026, 0, 1));
    expect(stepBucket(jan31, { n: 3, unit: 'h' }, 2)).toBe(jan31 + 6 * H);
  });
});

describe('date histogram SQL', () => {
  it('auto: unchanged shape', () => {
    const { sql, intervalMs } = sqlOf(date);
    expect(sql).toMatch(/toUnixTimestamp\(toStartOfInterval\("Timestamp", INTERVAL \d+ SECOND\)\) \* 1000 AS b0/);
    expect(intervalMs).toBeGreaterThan(0);
  });

  it('typed intervals use the parsed number and a unit keyword', () => {
    expect(sqlOf({ ...date, interval: '3h' }).sql).toContain(
      'toUnixTimestamp(toStartOfInterval("Timestamp", INTERVAL 3 HOUR)) * 1000 AS b0'
    );
    expect(sqlOf({ ...date, interval: '1M' }, 'app', rangeOf(T0, T0 + 365 * DAY)).sql).toContain('INTERVAL 1 MONTH');
    expect(sqlOf({ ...date, interval: '1w' }).sql).toContain('INTERVAL 1 WEEK');
    expect(sqlOf({ ...date, interval: '3h' }).intervalMs).toBe(3 * H);
  });

  it('milliseconds bucket on DateTime64', () => {
    const r = rangeOf(T0, T0 + 60_000);
    expect(sqlOf({ ...date, interval: '500ms' }, 'app', r).sql).toContain(
      'toUnixTimestamp64Milli(toStartOfInterval(toDateTime64("Timestamp", 3), INTERVAL 500 MILLISECOND)) AS b0'
    );
  });

  it('the scaled interval is what the query uses', () => {
    const { sql, interval } = sqlOf({ ...date, interval: '1s' });
    expect(interval?.scaled).toBe(true);
    expect(sql).toContain(`INTERVAL ${interval!.n} SECOND`);
  });

  it('saved panels: never below the minimum (fixed), calendar units kept', () => {
    expect(sqlOf({ ...date, interval: '5m' }, 'dashboard').sql).toContain(
      'toStartOfInterval(toDateTime("Timestamp"), INTERVAL greatest(300, $__interval_s) second) AS b0'
    );
    expect(sqlOf({ ...date, interval: '1M' }, 'dashboard').sql).toContain(
      'toStartOfInterval(toDateTime("Timestamp"), INTERVAL 1 MONTH) AS b0'
    );
    expect(sqlOf(date, 'dashboard').sql).toContain('$__timeInterval("Timestamp") AS b0');
    expect(dashboardBucketSql('t', { n: 250, unit: 'ms' })).toContain('greatest(1, $__interval_s)');
    expect(bucketStartSql('t', { n: 2, unit: 'd' })).toBe(
      'toUnixTimestamp(toStartOfInterval(t, INTERVAL 2 DAY)) * 1000'
    );
  });

  it('a saved panel keeps the interval', () => {
    const panel = buildLensPanel(lensWith({ ...date, interval: '15m' }), config, conds, week, {
      id: 1,
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    });
    expect(JSON.stringify(panel)).toContain('greatest(900, $__interval_s)');
  });
});

describe('URL / saved state', () => {
  it('round-trips the options', () => {
    const b: DateHistogramDim = { ...date, interval: '2w', emptyRows: false, dropPartial: true, unbound: true };
    expect(decodeLens(encodeLens(lensWith(b)))?.buckets[0]).toEqual(b);
  });

  it('a hostile or malformed interval drops the dimension; unknown keys are stripped', () => {
    const raw = (interval: unknown, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ chartType: 'bar', metrics: [count], buckets: [{ ...date, interval, ...extra }] });
    expect(decodeLens(raw('1h) * 1000 AS b0, (SELECT name FROM system.users) AS x --'))?.buckets).toEqual([]);
    expect(decodeLens(raw(3600))?.buckets).toEqual([]);
    const kept = decodeLens(raw('5m', { emptyRows: 'no', dropPartial: 1, unbound: 'yes', sql: 'x' }))?.buckets[0];
    expect(kept).toEqual({ ...date, interval: '5m' });
  });

  it('editor helpers normalise like URL input', () => {
    expect(withDateOptions(date, { interval: 'bogus' })).toEqual(date);
    expect(withDateOptions(date, { interval: '10m', emptyRows: false })).toEqual({
      ...date,
      interval: '10m',
      emptyRows: false,
    });
    const other: LensField = { id: 'c', sqlExpr: 'ObservedTimestamp', label: 'ObservedTimestamp', type: 'time' };
    const str: LensField = { id: 's', sqlExpr: 'Body', label: 'Body', type: 'string' };
    expect(withBucketField({ ...date, interval: '1h' }, other)).toMatchObject({
      field: 'ObservedTimestamp',
      interval: '1h',
    });
    expect(withBucketField(date, str)).toBe(date);
  });
});

describe('shaping: empty rows, partial intervals, binding', () => {
  // Picker 01:30 → 05:30, hourly buckets: 01:00 (partial) … 05:00 (partial); data at 02:00 and 04:00.
  const range = { from: T0 + 1.5 * H, to: T0 + 5.5 * H };
  const rows = [
    { b0: T0 + 2 * H, m0: 3 },
    { b0: T0 + 4 * H, m0: 1 },
  ];
  const iv = { n: 1, unit: 'h' as const };
  const xsOf = (b: DateHistogramDim) => shapeLensRows(lensWith(b), rows, H, { interval: iv, range }).xs;

  it('default: empty rows over the whole picker range (bound)', () => {
    expect(xsOf({ ...date, interval: '1h' })).toEqual([1, 2, 3, 4, 5].map((h) => T0 + h * H));
  });

  it('Include empty rows off: only buckets with data', () => {
    expect(xsOf({ ...date, interval: '1h', emptyRows: false })).toEqual([T0 + 2 * H, T0 + 4 * H]);
  });

  it('Bind to global time picker off: filled between first and last only', () => {
    expect(xsOf({ ...date, interval: '1h', unbound: true })).toEqual([2, 3, 4].map((h) => T0 + h * H));
  });

  it('Drop partial intervals: edge buckets the range only partly covers are dropped (rows too)', () => {
    const edgeRows = [{ b0: T0 + 1 * H, m0: 9 }, ...rows, { b0: T0 + 5 * H, m0: 9 }];
    const r = shapeLensRows(lensWith({ ...date, interval: '1h', dropPartial: true }), edgeRows, H, {
      interval: iv,
      range,
    });
    expect(r.xs).toEqual([2, 3, 4].map((h) => T0 + h * H));
    expect(r.table.rows.map((x) => x[0])).toEqual([T0 + 2 * H, T0 + 4 * H]);
  });

  it('calendar months fill on month starts', () => {
    const m = { n: 1, unit: 'M' as const };
    const r = shapeLensRows(
      lensWith({ ...date, interval: '1M' }),
      [
        { b0: Date.UTC(2026, 0, 1), m0: 1 },
        { b0: Date.UTC(2026, 3, 1), m0: 1 },
      ],
      30 * DAY,
      { interval: m, range: { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 5, 15) } }
    );
    expect(r.xs).toEqual([0, 1, 2, 3, 4, 5].map((mo) => Date.UTC(2026, mo, 1)));
  });

  it('without options the old behaviour stays (fill between first and last)', () => {
    expect(shapeLensRows(lensWith(date), rows, H).xs).toEqual([2, 3, 4].map((h) => T0 + h * H));
  });
});

describe('hand-offs keep the interval', () => {
  const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };
  it('Discover histogram interval → Visualize minimum interval and back', () => {
    const lens = lensForHistogram(ctx, undefined, 'hour')!;
    expect(lens.buckets[0]).toMatchObject({ kind: 'date_histogram', interval: '1h' });
    expect(discoverIntervalOf(lens)).toBe('hour');
    expect(lensForHistogram(ctx)!.buckets[0]).toMatchObject({ interval: 'auto' });
    expect(intervalFromDiscover('auto')).toBe('auto');
    expect(intervalToDiscover('5m')).toBeUndefined();
    expect(intervalToDiscover('1M')).toBe('month');
    expect(intervalToDiscover('auto')).toBe('auto');
  });
});

describe('date histogram editor', () => {
  beforeAll(() => {
    // jsdom has no canvas; the Combobox measures text with it.
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const fields: LensField[] = [
    { id: 'ts', sqlExpr: 'Timestamp', label: 'Timestamp', type: 'time' },
    { id: 'ots', sqlExpr: 'ObservedTimestamp', label: 'ObservedTimestamp', type: 'time' },
    { id: 'svc', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
  ];
  function Harness({ initial, onState }: { initial: DateHistogramDim; onState?: (d: BucketDim) => void }) {
    const [dim, setDim] = useState<BucketDim>(initial);
    return (
      <DimensionEditor
        dim={dim}
        group="Horizontal axis"
        fields={fields}
        timeRange={{ from: week.from.valueOf(), to: week.to.valueOf() }}
        timeField="Timestamp"
        onChange={(d) => {
          setDim(d as BucketDim);
          onState?.(d as BucketDim);
        }}
        onRemove={() => {}}
        onClose={() => {}}
      />
    );
  }

  it('Customize time interval reveals Minimum interval and the bucket size', () => {
    let last: BucketDim | undefined;
    render(<Harness initial={date} onState={(d) => (last = d)} />);
    expect(screen.queryByRole('combobox', { name: /Minimum interval/ })).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/^Auto: /);
    fireEvent.click(screen.getByRole('switch', { name: 'Customize time interval' }));
    expect(last).toMatchObject({ interval: '1h' });
    expect(screen.getByRole('combobox', { name: /Minimum interval/ })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Bucket size: 1 hour');
  });

  it('a too-small interval says it was scaled', () => {
    render(<Harness initial={{ ...date, interval: '1s' }} />);
    expect(screen.getByRole('status').textContent).toMatch(/^Interval scaled to .* to stay under 500 buckets$/);
  });

  it('advanced options write the state; Bind only for another date field', () => {
    let last: BucketDim | undefined;
    const { unmount } = render(<Harness initial={date} onState={(d) => (last = d)} />);
    expect(screen.queryByRole('checkbox', { name: /Bind to global time picker/ })).toBeNull();
    fireEvent.click(screen.getByLabelText('Include empty rows'));
    expect(last).toMatchObject({ emptyRows: false });
    fireEvent.click(screen.getByLabelText('Drop partial intervals'));
    expect(last).toMatchObject({ dropPartial: true });
    unmount();
    render(
      <Harness
        initial={{ ...date, field: 'ObservedTimestamp', label: 'ObservedTimestamp' }}
        onState={(d) => (last = d)}
      />
    );
    fireEvent.click(screen.getByRole('checkbox', { name: /Bind to global time picker/ }));
    expect(last).toMatchObject({ unbound: true });
  });
});
