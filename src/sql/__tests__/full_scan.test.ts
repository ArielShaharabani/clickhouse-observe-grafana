import {
  budgetSettingsFragments,
  buildPrefixValuesQuery,
  buildRowEstimateQuery,
  normalizeValuePrefix,
  PREFIX_LOOKUP_BUDGET,
  scanCaption,
  scanCompleteness,
  STATS_SCAN_BUDGET,
} from '../fullScan';
import { buildFieldStatsFullScanQuery, parseFieldStatsFullScanRow, rebinHistogram } from '../fieldStats';
import { withSettings } from '../settings';
import { mergeValueLists } from '../kql/_values';
import { SourceConfig } from '../../types';

const config = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  columns: { timestamp: 'Timestamp' },
} as unknown as SourceConfig;

const TIME = 'Timestamp >= $__fromTime AND Timestamp <= $__toTime';

describe('budgetSettingsFragments', () => {
  it('caps time and rows with break modes', () => {
    const sql = withSettings(['SELECT 1'], budgetSettingsFragments(config, PREFIX_LOOKUP_BUDGET));
    expect(sql).toContain('max_execution_time = 2');
    expect(sql).toContain("timeout_overflow_mode = 'break'");
    expect(sql).toContain('max_rows_to_read = 20000000');
    expect(sql).toContain("read_overflow_mode = 'break'");
    expect(sql).toContain('select_sequential_consistency = 1');
    expect(sql.match(/SETTINGS/g)).toHaveLength(1);
  });

  it('a view setting can neither lift the cap nor flip the overflow mode', () => {
    const view = {
      ...config,
      extraQuerySettings: "max_execution_time = 60, max_rows_to_read = 1000000000, timeout_overflow_mode = 'throw'",
    } as SourceConfig;
    const sql = withSettings(['SELECT 1'], budgetSettingsFragments(view, PREFIX_LOOKUP_BUDGET));
    expect(sql).toContain('max_execution_time = 2');
    expect(sql).not.toContain('max_execution_time = 60');
    expect(sql).not.toContain('1000000000');
    expect(sql).toContain("timeout_overflow_mode = 'break'");
    expect(sql).not.toContain("'throw'");
  });

  it('never exceeds the view query timeout', () => {
    const view = { ...config, queryTimeoutSeconds: 5 } as SourceConfig;
    const sql = withSettings(['SELECT 1'], budgetSettingsFragments(view, STATS_SCAN_BUDGET));
    expect(sql).toContain('max_execution_time = 5');
  });
});

describe('normalizeValuePrefix', () => {
  it('needs two characters and a literal prefix', () => {
    expect(normalizeValuePrefix(undefined)).toBeNull();
    expect(normalizeValuePrefix('p')).toBeNull();
    expect(normalizeValuePrefix('pa')).toBe('pa');
    expect(normalizeValuePrefix('"pay')).toBe('pay');
    expect(normalizeValuePrefix('pa' + String.fromCharCode(0xe000))).toBeNull();
  });
});

describe('buildPrefixValuesQuery', () => {
  const build = (prefix: string) =>
    buildPrefixValuesQuery(config, "LogAttributes['http.method']", { table: 'spec_logs', conditions: [TIME], prefix });

  it('looks up the whole time range, no sample', () => {
    const sql = build('pay');
    expect(sql).toContain("SELECT toString(LogAttributes['http.method']) AS value, count() AS count");
    expect(sql).toContain('FROM "default"."spec_logs"');
    expect(sql).toContain(`WHERE ${TIME} AND value ILIKE 'pay%'`);
    expect(sql).toContain('GROUP BY value');
    expect(sql).toContain('ORDER BY count DESC');
    expect(sql).toContain('LIMIT 20');
    expect(sql).not.toContain('ORDER BY Timestamp');
    expect(sql).toContain('max_execution_time = 2');
    expect(sql).toContain("read_overflow_mode = 'break'");
  });

  it('escapes LIKE metacharacters and quotes in the prefix', () => {
    expect(build('50%_x')).toContain("ILIKE '50\\\\%\\\\_x%'");
    expect(build("o'r 1=1 --")).toContain("ILIKE 'o\\'r 1=1 --%'");
    expect(build('a\\b')).toContain("ILIKE 'a\\\\\\\\b%'");
  });
});

describe('buildRowEstimateQuery', () => {
  it('is an EXPLAIN ESTIMATE over the same conditions', () => {
    const sql = buildRowEstimateQuery(config, 'spec_logs', [TIME]);
    expect(sql).toMatch(/^EXPLAIN ESTIMATE SELECT 1\nFROM "default"\."spec_logs"\nWHERE Timestamp/);
  });
});

describe('scanCompleteness / scanCaption', () => {
  const budget = STATS_SCAN_BUDGET;
  it('no row back = time limit', () => {
    const s = scanCompleteness({ scanned: 0, timedOut: true, budget });
    expect(s).toMatchObject({ complete: false, limit: 'time' });
    expect(scanCaption(s)).toContain('10 s time limit');
  });
  it('estimate above the row cap = partial (rows)', () => {
    const s = scanCompleteness({ scanned: 19_000_000, timedOut: false, estimatedRows: 50_000_000, budget });
    expect(s).toMatchObject({ complete: false, limit: 'rows' });
    expect(scanCaption(s)).toBe(
      'Scanned 19,000,000 records (partial: hit the 20,000,000-row read limit of about 50,000,000).'
    );
  });
  it('scanned at the cap = partial even without an estimate', () => {
    expect(scanCompleteness({ scanned: 20_300_000, timedOut: false, budget })).toMatchObject({
      complete: false,
      limit: 'rows',
    });
  });
  it('estimate within the cap = complete', () => {
    const s = scanCompleteness({ scanned: 1234, timedOut: false, estimatedRows: 8192, budget });
    expect(s.complete).toBe(true);
    expect(scanCaption(s)).toBe('Scanned 1,234 records over the full time range (complete).');
  });
  it('no estimate = unknown, said so', () => {
    const s = scanCompleteness({ scanned: 1234, timedOut: false, budget });
    expect(s.complete).toBeUndefined();
    expect(scanCaption(s)).toContain('completeness unknown');
  });
});

describe('buildFieldStatsFullScanQuery', () => {
  const sql = buildFieldStatsFullScanQuery(
    config,
    [
      { sqlExpr: 'SeverityText', numeric: false, blankIsValue: true },
      { sqlExpr: 'SeverityNumber', numeric: true },
    ],
    { table: 'spec_logs', conditions: [TIME] }
  );
  it('reads every matching row with bounded aggregates and the scan budget', () => {
    expect(sql).not.toContain('ORDER BY');
    expect(sql).not.toMatch(/\bLIMIT\b/);
    expect(sql).not.toContain('sumMap');
    expect(sql).not.toContain('groupArray');
    expect(sql).toContain("topKIf(10, 1000, 'counts')(assumeNotNull(v0)");
    expect(sql).toContain('uniqIf(v0,');
    expect(sql).toContain('histogramIf(20)');
    expect(sql).toContain('quantileIf(0.5)');
    expect(sql).toContain('max_execution_time = 10');
    expect(sql).toContain('max_rows_to_read = 20000000');
    expect(sql).toContain("read_overflow_mode = 'break'");
    expect(sql).not.toContain('AS hg0');
    expect(sql).toContain('AS hg1');
  });
});

describe('parseFieldStatsFullScanRow', () => {
  const targets = [
    { sqlExpr: 'a', numeric: false },
    { sqlExpr: 'b', numeric: true },
  ];
  it('maps topK results and re-bins the histogram', () => {
    const [a, b] = parseFieldStatsFullScanRow(
      {
        total: 100,
        d0: 90,
        u0: 2,
        tv0: ['x', 'y'],
        tc0: [60, 30],
        te0: 0,
        d1: 100,
        u1: 3,
        tv1: [],
        tc1: [],
        te1: 4,
        nn1: 100,
        lo1: 0,
        hi1: 10,
        med1: 5,
        hg1: [
          [0, 5, 50],
          [5, 10, 50],
        ],
      },
      targets
    );
    expect(a).toMatchObject({
      sampled: 100,
      docs: 90,
      distinct: 2,
      top: [
        { value: 'x', count: 60 },
        { value: 'y', count: 30 },
      ],
    });
    expect(a.approximate).toBeUndefined();
    expect(b.approximate).toBe(true);
    expect(b.numeric?.buckets).toEqual([10, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
  });
});

describe('rebinHistogram', () => {
  it('puts a zero-width bin in its bucket and handles a constant field', () => {
    expect(rebinHistogram([[3, 3, 7]], 0, 10)[3]).toBe(7);
    expect(rebinHistogram([[4, 4, 5]], 4, 4)).toEqual([5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe('mergeValueLists', () => {
  it('full-range matches first, sampled extras after, deduped', () => {
    expect(
      mergeValueLists(
        [
          { value: 'payments', count: 900 },
          { value: 'payroll', count: 2 },
        ],
        [
          { value: 'payments', count: 40 },
          { value: 'api-pay', count: 3 },
        ]
      )
    ).toEqual([
      { value: 'payments', count: 900 },
      { value: 'payroll', count: 2 },
      { value: 'api-pay', count: 3 },
    ]);
  });
});
