import { dateTime } from '@grafana/data';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { FieldIndex } from '../../sql/fields';
import { compileLens, shapeLensRows } from '../compile';
import { LENS_MAX_BUCKETS, intervalMs, resolveLensInterval, stepBucket } from '../interval';
import { quoteString } from '../../sql/queryBuilder';
import { bucketPos, bucketTimeAt } from '../render/timeTicks';
import { xLabel } from '../render/XyChart';
import { LensState } from '../state';

const config = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'r8time_h',
  columns: { ...OTEL_COLUMN_MAPPING, timestamp: 'ts' },
} as unknown as SourceConfig;
const conds = ['ts >= $__fromTime AND ts <= $__toTime'];
const rng = (a: string, b: string) => {
  const from = dateTime(a);
  const to = dateTime(b);
  return { from, to, raw: { from, to } };
};
const year = rng('2026-01-01T00:00:00Z', '2026-12-31T00:00:00Z');
const state = (interval: string, over: object = {}, metric: object = {}): LensState =>
  ({
    chartType: 'bar',
    buckets: [{ kind: 'date_histogram', id: 'x', field: 'ts', label: 'ts', interval, ...over }],
    metrics: [{ kind: 'metric', id: 'm', op: 'count', ...metric }],
  }) as LensState;
const sqlOf = (s: LensState, mode: 'app' | 'dashboard', tz: string, r = year, index?: FieldIndex) =>
  compileLens(s, config, conds, r, mode, index, tz);

describe('buckets in the user zone', () => {
  it('days and longer start at local midnight; zone names are quoted', () => {
    expect(sqlOf(state('1d'), 'app', 'America/New_York').sql).toContain(
      `toUnixTimestamp(toDateTime(toStartOfInterval("ts", INTERVAL 1 DAY, 'America/New_York'), 'America/New_York')) * 1000 AS b0`
    );
    expect(sqlOf(state('1M'), 'dashboard', 'Asia/Jerusalem').sql).toContain(
      `toDateTime(toStartOfInterval(toDateTime("ts"), INTERVAL 1 MONTH, 'Asia/Jerusalem'), 'Asia/Jerusalem') AS b0`
    );
    expect(sqlOf(state('1d'), 'app', "x'y").sql).toContain(quoteString("x'y"));
  });

  it('shorter buckets line up with the clock of the zone, and only where needed', () => {
    const week = rng('2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z');
    expect(resolveLensInterval('1h', week, 'America/New_York').offset).toBeUndefined();
    expect(resolveLensInterval('1h', week, 'Asia/Kolkata').offset).toBe(1800);
    expect(resolveLensInterval('12h', week, 'America/New_York').offset).toBe(7 * 3600);
    expect(sqlOf(state('1h'), 'app', 'Asia/Kolkata', week).sql).toContain(
      'toStartOfInterval("ts" + toIntervalSecond(1800), INTERVAL 3600 SECOND) - toIntervalSecond(1800)'
    );
  });

  it.each([
    ['America/New_York', '2026-03-08T05:00:00Z', 23],
    ['America/New_York', '2026-11-01T04:00:00Z', 25],
    ['Asia/Jerusalem', '2026-03-26T22:00:00Z', 23],
    ['Asia/Jerusalem', '2026-10-24T21:00:00Z', 25],
    ['Asia/Kolkata', '2026-03-07T18:30:00Z', 24],
  ])('DST days: %s %s is %i hours', (tz, start, hours) => {
    const t = Date.parse(start);
    const next = stepBucket(t, { n: 1, unit: 'd', tz }, 1);
    expect((next - t) / 3_600_000).toBe(hours);
    expect(stepBucket(next, { n: 1, unit: 'd', tz }, -1)).toBe(t);
  });

  it('empty days around a DST change are filled once each', () => {
    const r = { from: Date.parse('2026-03-06T05:00:00Z'), to: Date.parse('2026-03-12T04:00:00Z') };
    const res = shapeLensRows(
      state('1d'),
      [{ b0: Date.parse('2026-03-07T05:00:00Z'), m0: 1 }, { b0: Date.parse('2026-03-10T04:00:00Z'), m0: 2 }],
      86_400_000,
      { interval: { n: 1, unit: 'd', tz: 'America/New_York' }, range: r }
    );
    expect(res.xs.map((x) => new Date(Number(x)).toISOString().slice(5, 13))).toEqual([
      '03-06T05', '03-07T05', '03-08T05', '03-09T04', '03-10T04', '03-11T04',
    ]);
  });
});

describe('drawing', () => {
  it('ticks and events follow the real bucket lengths', () => {
    const xs = ['2026-01-01', '2026-02-01', '2026-03-01'].map((d) => Date.parse(`${d}T00:00:00Z`));
    const end = Date.parse('2026-04-01T00:00:00Z');
    expect(xs.map((t) => bucketPos(xs, end, t))).toEqual([0, 1, 2]);
    expect(bucketPos(xs, end, end)).toBe(3);
    expect(bucketPos(xs, end, Date.parse('2026-02-15T00:00:00Z'))).toBe(1.5);
    expect(bucketTimeAt(xs, end, 1.5)).toBe(Date.parse('2026-02-15T00:00:00Z'));
    const r = shapeLensRows(state('1M'), xs.map((b0) => ({ b0, m0: 1 })), 1, { interval: { n: 1, unit: 'M' } });
    expect(r.xEnd).toBe(end);
  });

  it('bucket names are not ambiguous (L6)', () => {
    const t = Date.parse('2026-01-02T00:00:00Z');
    expect(xLabel(t, true, 86_400_000)).toBe('01-02 00:00');
    expect(xLabel(t, true, 365 * 86_400_000)).toBe('2026-01-02 00:00');
    expect(xLabel(t, true, 3_600_000)).toBe('00:00');
  });
});

describe('other interval rules', () => {
  it('normalise uses the real length of a calendar bucket (W9)', () => {
    const s = state('1M', {}, { normalize: 'd' });
    expect(sqlOf(s, 'app', 'UTC').sql).toContain(
      "(count()) * (86400 / (toUnixTimestamp(toDateTime(intDiv(b0, 1000), 'UTC') + INTERVAL 1 MONTH) - toUnixTimestamp(toDateTime(intDiv(b0, 1000), 'UTC'))))"
    );
    expect(sqlOf(s, 'dashboard', 'UTC').sql).toContain(
      '(count()) * (86400 / (toUnixTimestamp(b0 + INTERVAL 1 MONTH) - toUnixTimestamp(b0)))'
    );
  });

  it('a millisecond interval over months is widened under the cap (M2)', () => {
    const r = resolveLensInterval('1ms', year);
    expect(r).toMatchObject({ unit: 's', scaled: true });
    expect((year.to.valueOf() - year.from.valueOf()) / intervalMs(r)).toBeLessThanOrEqual(LENS_MAX_BUCKETS);
  });

  it('a Date column: instants at UTC midnight, auto at least a day (L7)', () => {
    const index = { bySqlExpr: new Map([['ts', { rawType: 'Date' }]]) } as unknown as FieldIndex;
    const r = sqlOf(state('auto'), 'app', 'America/New_York', rng('2026-01-01T00:00:00Z', '2026-01-08T00:00:00Z'), index);
    expect(r.interval).toMatchObject({ n: 1, unit: 'd', tz: 'UTC' });
    expect(r.sql).toContain(`toStartOfInterval(toDateTime("ts"), INTERVAL 1 DAY, 'UTC')`);
  });

  it('Drop partial intervals reaches the saved panel (E7)', () => {
    const { sql } = sqlOf(state('1M', { dropPartial: true }), 'dashboard', 'UTC');
    expect(sql).toContain("HAVING b0 >= $__fromTime AND b0 + INTERVAL 1 MONTH <= toDateTime($__toTime, 'UTC')");
    expect(sql).toContain("toDateTime($__toTime, 'UTC') - INTERVAL 1 MONTH + toIntervalSecond(1)) STEP");
  });
});
