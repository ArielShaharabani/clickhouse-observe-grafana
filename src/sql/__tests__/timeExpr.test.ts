/**
 * Converted time fields (PLAN #16d): `timeExpr` and every query that reads the time field.
 */
import { dateTime } from '@grafana/data';
import {
  formatsForKind,
  guessEpochFormat,
  isConvertedTimestamp,
  normalizeTimestampFormat,
  timeColumnKind,
  timeExpr,
} from '../timeExpr';
import {
  buildFieldTopValuesQuery,
  buildContextAnchorLookupQuery,
  buildLogDetailQuery,
  buildLogsQuery,
  buildNumericStatsQuery,
  buildSurroundingDocsQuery,
  buildVolumeQuery,
  buildWhereConditions,
  CORE_ALIAS,
  logRowKey,
} from '../queryBuilder';
import { buildMapKeysQuery } from '../introspection';
import { compileLens } from '../../lens/compile';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig, TimestampFormat } from '../../types';

const native: SourceConfig = {
  datasourceUid: 'test',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const epoch = (format: TimestampFormat, col = 'ts_ms'): SourceConfig => ({
  ...native,
  logsTable: 'spec_logs_epoch',
  timestampFormat: format,
  columns: { ...native.columns, timestamp: col },
});

describe('timeExpr', () => {
  it('a native column is used unchanged (same SQL as before converted fields existed)', () => {
    expect(timeExpr(native)).toBe('Timestamp');
    expect(timeExpr({ ...native, timestampFormat: 'native' })).toBe('Timestamp');
    expect(isConvertedTimestamp(native)).toBe(false);
  });

  it('no time field → empty', () => {
    expect(timeExpr({ ...native, columns: { ...native.columns, timestamp: '' } })).toBe('');
    expect(isConvertedTimestamp(epoch('epoch_ms', ''))).toBe(false);
  });

  it.each([
    ['epoch_s', 'toDateTime64(toInt64("ts_ms"), 3)'],
    ['epoch_ms', 'fromUnixTimestamp64Milli(toInt64("ts_ms"))'],
    ['epoch_us', 'fromUnixTimestamp64Micro(toInt64("ts_ms"))'],
    ['epoch_ns', 'fromUnixTimestamp64Nano(toInt64("ts_ms"))'],
    ['string', `parseDateTime64BestEffortOrNull(toString("ts_ms"), 9, 'UTC')`],
  ] as Array<[TimestampFormat, string]>)('%s → %s', (format, sql) => {
    expect(timeExpr(epoch(format))).toBe(sql);
    expect(isConvertedTimestamp(epoch(format))).toBe(true);
  });

  it('a Map value can be a converted time field (trusted accessor form passes unquoted)', () => {
    expect(timeExpr(epoch('epoch_ms', "LogAttributes['ts']"))).toBe(
      `fromUnixTimestamp64Milli(toInt64(LogAttributes['ts']))`
    );
  });

  describe('hostile stored config', () => {
    const HOSTILE_COLS = ['ts") OR 1=1 --', 'a"b', 'back\\slash\\"', "x'), (SELECT 1", 'ts;DROP TABLE t'];
    it.each(HOSTILE_COLS)('column %p stays one quoted identifier', (col) => {
      const sql = timeExpr(epoch('epoch_ms', col));
      const inner = sql.slice('fromUnixTimestamp64Milli(toInt64('.length, -'))'.length);
      // One double-quoted identifier, ClickHouse-escaped: no bare quote or backslash can end it early.
      expect(inner).toMatch(/^"(?:[^"\\]|""|\\[\s\S])*"$/);
      expect(inner).toBe(`"${col.replace(/\\/g, '\\\\').replace(/"/g, '""')}"`);
    });

    it.each(["epoch_ms') OR 1=1 --", 'toString', '', 'EPOCH_MS', null, 42, { a: 1 }])(
      'unknown format %p is read as a native column, never inserted into SQL',
      (format) => {
        const cfg = { ...epoch('epoch_ms'), timestampFormat: format as unknown as TimestampFormat };
        expect(normalizeTimestampFormat(format)).toBe('native');
        expect(timeExpr(cfg)).toBe('ts_ms');
        expect(isConvertedTimestamp(cfg)).toBe(false);
      }
    );
  });
});

describe('time column kinds', () => {
  it.each([
    ['DateTime64(9)', 'datetime'],
    ["DateTime('UTC')", 'datetime'],
    ['Date', 'datetime'],
    ['Date32', 'datetime'],
    ['Nullable(DateTime64(3))', 'datetime'],
    ['UInt32', 'number'],
    ['Int64', 'number'],
    ['Nullable(UInt64)', 'number'],
    ['Decimal(18, 3)', 'number'],
    ['String', 'text'],
    ['LowCardinality(String)', 'text'],
    ['LowCardinality(Nullable(String))', 'text'],
    ['FixedString(24)', 'text'],
    ['UInt8', null],
    ['Map(String, String)', null],
    ['Array(DateTime)', null],
    ['Bool', null],
  ])('%s → %s', (t, kind) => {
    expect(timeColumnKind(t)).toBe(kind);
  });

  it('formats offered per kind (first = default)', () => {
    expect(formatsForKind('datetime')).toEqual(['native']);
    expect(formatsForKind('number')[0]).toBe('epoch_ms');
    expect(formatsForKind('number')).toHaveLength(4);
    expect(formatsForKind('text')).toEqual(['string']);
    expect(formatsForKind(null)).toEqual([]);
  });

  it.each([
    [1767225600, 'epoch_s'],
    ['1767744060000', 'epoch_ms'],
    [1767744060000000, 'epoch_us'],
    ['1767744060000000000', 'epoch_ns'],
    ['n/a', 'epoch_ms'],
    [undefined, 'epoch_ms'],
  ])('epoch unit guessed from %p → %s', (sample, format) => {
    expect(guessEpochFormat(sample)).toBe(format);
  });
});

describe('every query reads a converted time field through timeExpr', () => {
  const cfg = epoch('epoch_ms');
  const TS = 'fromUnixTimestamp64Milli(toInt64("ts_ms"))';
  const state = { ...DEFAULT_LOGS_QUERY_STATE };

  it('time filter', () => {
    expect(buildWhereConditions(cfg, state)[0]).toBe(`${TS} >= $__fromTime AND ${TS} <= $__toTime`);
  });

  it('grid: aliased time column, default sort on it', () => {
    const sql = buildLogsQuery(cfg, state, undefined, { projection: 'grid' });
    expect(sql).toContain(`${TS} AS ${CORE_ALIAS.timestamp}`);
    expect(sql).toContain(`ORDER BY ${CORE_ALIAS.timestamp} DESC`);
    expect(sql).not.toMatch(/\bts_ms\b(?!")/);
  });

  it('full rows: the converted value is aliased too and the sort uses the expression', () => {
    const sql = buildLogsQuery(cfg, state);
    expect(sql).toContain(`SELECT *, ${TS} AS ${CORE_ALIAS.timestamp}`);
    expect(sql).toContain(`ORDER BY ${TS} DESC`);
  });

  it('native full rows are unchanged (no extra alias)', () => {
    const sql = buildLogsQuery(native, state);
    expect(sql).toContain('SELECT *\n');
    expect(sql).toContain('ORDER BY Timestamp DESC');
  });

  it('grid and full rows of the same log get the same row key', () => {
    const v = '2026-01-05 09:00:00.000';
    const grid = {
      [CORE_ALIAS.timestamp]: v,
      [CORE_ALIAS.body]: 'b',
      [CORE_ALIAS.severity]: 'info',
      [CORE_ALIAS.serviceName]: 's',
    };
    const full = { [CORE_ALIAS.timestamp]: v, ts_ms: 1767603600000, Body: 'b', SeverityText: 'info', ServiceName: 's' };
    expect(logRowKey(full, cfg)).toBe(logRowKey(grid, cfg));
  });

  it('detail lookup', () => {
    const sql = buildLogDetailQuery(cfg, { [CORE_ALIAS.timestamp]: 1767603600000 });
    expect(sql).toContain(`${TS} >= fromUnixTimestamp64Milli(1767603600000)`);
    expect(sql).toContain(`${TS} < fromUnixTimestamp64Milli(1767603600001)`);
  });

  it('histogram: fixed interval', () => {
    const sql = buildVolumeQuery(cfg, state, { interval: { unit: 'HOUR', value: 1 }, breakdown: { kind: 'none' } });
    expect(sql).toContain(`toStartOfInterval(${TS}, INTERVAL 1 HOUR) AS time`);
  });

  it('histogram exported to a dashboard: explicit form, not the comma-splitting macro', () => {
    const sql = buildVolumeQuery(epoch('epoch_s'), state, { interval: { macro: true }, breakdown: { kind: 'none' } });
    expect(sql).toContain(
      'toStartOfInterval(toDateTime(toDateTime64(toInt64("ts_ms"), 3)), INTERVAL $__interval_s second) AS time'
    );
    expect(sql).not.toContain('$__timeInterval(');
    // native keeps the macro
    expect(buildVolumeQuery(native, state, { interval: { macro: true }, breakdown: { kind: 'none' } })).toContain(
      '$__timeInterval(Timestamp)'
    );
  });

  it('samples: top values, numeric stats, map keys order by the converted time', () => {
    expect(buildFieldTopValuesQuery(cfg, 'ServiceName', { table: 'spec_logs_epoch', conditions: [] })).toContain(
      `ORDER BY ${TS} DESC`
    );
    expect(
      buildNumericStatsQuery(cfg, 'SeverityNumber', { table: 'spec_logs_epoch', conditions: [], sampleSize: 100 })
    ).toContain(`ORDER BY ${TS} DESC`);
    expect(buildMapKeysQuery(cfg, 'LogAttributes', { table: 'spec_logs_epoch', conditions: [] })).toContain(
      `ORDER BY ${TS} DESC`
    );
  });

  it('surrounding documents: anchor lookup, neighbours and anchor fetch use the converted time', () => {
    const lookup = buildContextAnchorLookupQuery(cfg, { [CORE_ALIAS.timestamp]: 1767603600000 });
    expect(lookup).toContain(`toDateTime64(${TS}, 9)`);
    expect(lookup).toContain(`${TS} >= fromUnixTimestamp64Milli(1767603600000)`);
    const anchor = { ns: '1767603600000000000', id: '42' };
    const newer = buildSurroundingDocsQuery(cfg, anchor, { direction: 'newer', size: 5, columns: [], filters: [] });
    expect(newer).toContain(`${TS} >= fromUnixTimestamp64Nano(1767603600000000000)`);
    expect(newer).toContain(`ORDER BY ${TS} ASC`);
    expect(newer).toContain(`${TS} AS ${CORE_ALIAS.timestamp}`);
    const at = buildSurroundingDocsQuery(cfg, anchor, { direction: 'anchor', size: 1, columns: [], filters: [] });
    expect(at).toContain(`${TS} = fromUnixTimestamp64Nano(1767603600000000000)`);
  });

  describe('Lens time axis', () => {
    const from = dateTime(Date.UTC(2026, 0, 1));
    const to = dateTime(Date.UTC(2026, 0, 8));
    const range = { from, to, raw: { from, to } };
    const lens = (field: string) => ({
      chartType: 'bar' as const,
      buckets: [{ kind: 'date_histogram' as const, id: 'b0', field, label: field, interval: 'auto' as const }],
      metrics: [{ kind: 'metric' as const, id: 'm0', op: 'count' as const }],
    });

    it('date histogram on the time field uses the conversion', () => {
      const { sql } = compileLens(lens('ts_ms'), cfg, [], range);
      expect(sql).toContain(`toStartOfInterval(${TS}, INTERVAL`);
    });

    it('dashboard export uses the explicit form', () => {
      const { sql } = compileLens(lens('ts_ms'), cfg, [], range, 'dashboard');
      expect(sql).toContain(`toStartOfInterval(toDateTime(${TS}), INTERVAL $__interval_s second) AS b0`);
    });

    it('native time field and other fields are quoted as before', () => {
      expect(compileLens(lens('Timestamp'), native, [], range).sql).toContain(
        'toStartOfInterval("Timestamp", INTERVAL'
      );
      expect(compileLens(lens('other_ts'), cfg, [], range).sql).toContain('toStartOfInterval("other_ts", INTERVAL');
    });
  });
});
