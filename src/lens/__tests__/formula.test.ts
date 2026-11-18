import { dateTime } from '@grafana/data';
import {
  fieldToken,
  formulaErrors,
  FormulaFields,
  formulaToSql,
  parseFormula,
  quickToFormula,
  MAX_FORMULA_LEN,
} from '../formula';
import { compileLens } from '../compile';
import { decodeLens, encodeLens, LensState, MetricDim, sanitizeLens } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const ctx = { config };
const fields: FormulaFields = {
  SeverityNumber: { expr: 'SeverityNumber', numeric: true },
  SeverityText: { expr: 'SeverityText', numeric: false },
  'LogAttributes.http-status': { expr: "LogAttributes['http-status']", numeric: false },
};
const sql = (f: string, flds = fields) => formulaToSql(f, flds, ctx);
const errs = (f: string, flds = fields) => formulaErrors(f, flds).map((e) => e.message);

describe('formula: parse + compile', () => {
  it('count()', () => {
    expect(sql('count()')).toBe('count()');
  });

  it('error rate with a KQL filter goes through the KQL compiler', () => {
    const out = sql("count(kql='SeverityText : ERROR') / count()")!;
    expect(out).toMatch(/^\(countIf\(\(.*SeverityText.*'ERROR'.*\)\) \/ nullIf\(count\(\), 0\)\)$/);
  });

  it('aggregations map to ClickHouse functions', () => {
    expect(sql('average(SeverityNumber)')).toBe('avg("SeverityNumber")');
    expect(sql('sum(SeverityNumber)')).toBe('sum("SeverityNumber")');
    expect(sql('median(SeverityNumber)')).toBe('quantile(0.5)("SeverityNumber")');
    expect(sql('percentile(SeverityNumber, percentile=95)')).toBe('quantile(0.95)("SeverityNumber")');
    expect(sql('percentile(SeverityNumber)')).toBe('quantile(0.95)("SeverityNumber")');
    expect(sql('unique_count(SeverityText)')).toBe('uniq("SeverityText")');
    expect(sql('count(SeverityText)')).toBe('count("SeverityText")');
  });

  it('KQL filter on other aggregations uses the -If combinator', () => {
    expect(sql("sum(SeverityNumber, kql='SeverityNumber > 10')")).toMatch(/^sumIf\("SeverityNumber", \(.+\)\)$/);
    expect(sql("median(SeverityNumber, kql='SeverityText : x')")).toMatch(
      /^quantileIf\(0\.5\)\("SeverityNumber", \(.+\)\)$/
    );
  });

  it('precedence, unary minus and math functions', () => {
    expect(sql('1 + 2 * count()')).toBe('(1 + (2 * count()))');
    expect(sql('-(count() - 1)')).toBe('(-(count() - 1))');
    expect(sql('round(average(SeverityNumber), 2)')).toBe('round(avg("SeverityNumber"), 2)');
    expect(sql('clamp(count(), 0, 100)')).toBe('least(greatest(count(), 0), 100)');
    expect(sql('pick_max(count(), 1)')).toBe('greatest(count(), 1)');
  });

  it('division by zero yields an empty value', () => {
    expect(sql('count() / 0')).toBe('(count() / nullIf(0, 0))');
  });

  it('a field name that is not a bare identifier is written in backticks and quoted in SQL', () => {
    expect(fieldToken('LogAttributes.http-status')).toBe('`LogAttributes.http-status`');
    expect(sql('unique_count(`LogAttributes.http-status`)')).toBe("uniq(LogAttributes['http-status'])");
  });

  it('a non-number field in a numeric aggregation is an error', () => {
    expect(errs('sum(SeverityText)')).toEqual([expect.stringContaining('needs a number field')]);
  });

  it('reports useful errors', () => {
    expect(errs('')).toEqual(['Formula is empty']);
    expect(errs('count(')).toEqual([expect.stringContaining('incomplete')]);
    expect(errs('foo()')).toEqual(['Unknown function foo']);
    expect(errs('average(Nope)')).toEqual(['Unknown field Nope']);
    expect(errs('SeverityNumber')).toEqual([expect.stringContaining('inside a function')]);
    expect(errs('1 + 2')).toEqual([expect.stringContaining('at least one aggregation')]);
    expect(errs('sum(average(SeverityNumber))')).toEqual([expect.stringContaining('must be a field')]);
    expect(errs("count(shift='1w')")).toEqual(['Time shift is not supported yet']);
    expect(errs('percentile(SeverityNumber, percentile=150)')).toEqual([expect.stringContaining('between 0 and 100')]);
    expect(errs("count(kql='a :')")).toEqual([expect.stringContaining('Invalid KQL')]);
    expect(errs('count() count()')).toHaveLength(1);
  });

  it('reports every error, not just the first', () => {
    expect(errs('average(Nope) + foo()')).toHaveLength(2);
  });

  it('quick functions convert to formulas', () => {
    expect(quickToFormula('count')).toBe('count()');
    expect(quickToFormula('median', 'SeverityNumber')).toBe('median(SeverityNumber)');
    expect(quickToFormula('avg', 'SeverityNumber')).toBe('average(SeverityNumber)');
    expect(quickToFormula('percentile', 'SeverityNumber', 90)).toBe('percentile(SeverityNumber, percentile=90)');
    expect(quickToFormula('unique', 'a-b')).toBe('unique_count(`a-b`)');
  });
});

describe('formula: injection attempts never reach SQL', () => {
  const attempts = [
    'count()); DROP TABLE spec_logs; --',
    'count() FROM system.users --',
    'count() UNION ALL SELECT 1',
    'sleep(3)',
    "file('/etc/passwd')",
    'count() /* x */',
    'count() -- x',
    'sum(SeverityNumber); SELECT 1',
    'count(SeverityNumber) OR 1=1',
    'average(`SeverityNumber"; DROP TABLE x; --`)',
    "count(kql='x', percentile=1, kql='y')",
    'count()\u0000',
    'currentUser()',
    'count(1)',
    "count('x')",
    '1e999999 * count()',
  ];
  it.each(attempts)('%s', (f) => {
    const out = sql(f);
    if (out !== null) {
      // Only an accepted shape may compile; nothing outside the whitelist survives.
      expect(out).not.toMatch(/DROP|UNION|SELECT|system\.|sleep|file\(|currentUser|--|\/\*|;/i);
    }
    expect(out === null || formulaErrors(f, fields).length === 0).toBe(true);
  });

  it('a field name containing SQL is a field lookup, never SQL', () => {
    const evil = 'x"; DROP TABLE t; --';
    expect(sql(`count(${fieldToken(evil)})`)).toBeNull();
    // Even with an entry for it, the expression is quoted (sanitizeLens additionally drops it).
    const out = sql(`count(${fieldToken(evil)})`, { [evil]: { expr: evil, numeric: false } })!;
    expect(out).toBe(`count("x""; DROP TABLE t; --")`);
  });

  it('KQL quotes are escaped by the KQL compiler', () => {
    const out = sql("count(kql='SeverityText : \"a\\' OR 1=1 --\"')")!;
    // One escaped string literal: the quote cannot end it early.
    expect(out).toBe(`countIf(("SeverityText" = 'a\\' OR 1=1 --'))`);
  });

  it('a too-long formula is rejected', () => {
    expect(sql('count() + '.repeat(MAX_FORMULA_LEN))).toBeNull();
  });

  it('deep nesting is rejected without blowing the stack', () => {
    expect(sql(`${'('.repeat(5000)}count()${')'.repeat(5000)}`)).toBeNull();
    expect(sql(`${'-'.repeat(5000)}count()`)).toBeNull();
  });

  it('dashboard mode writes $ in a KQL value as \\x24 (no macro expansion)', () => {
    const out = formulaToSql('count(kql=\'SeverityText : "$__timeFilter"\')', fields, { config, dashboard: true })!;
    expect(out).not.toContain('$');
    expect(out).toContain('\\x24__timeFilter');
  });
});

describe('formula in Lens state', () => {
  const from = dateTime(Date.UTC(2026, 0, 1));
  const range = { from, to: from, raw: { from, to: from } };
  const formula = (f: string, flds: FormulaFields = fields): MetricDim => ({
    kind: 'metric',
    id: 'm0',
    op: 'formula',
    formula: f,
    formulaFields: flds,
  });
  const allowed = new Set(['SeverityNumber', 'SeverityText', "LogAttributes['http-status']", 'Timestamp']);

  it('round-trips through the URL codec, dropping unknown keys', () => {
    const s: LensState = { chartType: 'metric', buckets: [], metrics: [formula('count()')] };
    const raw = JSON.parse(encodeLens(s));
    raw.metrics[0].evil = 'x';
    raw.metrics[0].field = 'DROP';
    const back = decodeLens(JSON.stringify(raw))!;
    expect(back.metrics[0]).toEqual({
      kind: 'metric',
      id: 'm0',
      op: 'formula',
      formula: 'count()',
      formulaFields: fields,
      name: undefined,
    });
  });

  it('sanitizeLens drops a formula that refers to a field outside the data view', () => {
    const s: LensState = {
      chartType: 'metric',
      buckets: [],
      metrics: [formula('sum(x)', { x: { expr: '(SELECT 1)', numeric: true } })],
    };
    expect(sanitizeLens(s, allowed).metrics).toHaveLength(0);
  });

  it('sanitizeLens drops an invalid formula and keeps a valid one', () => {
    const bad = { ...formula('drop()'), id: 'm1' };
    const s: LensState = { chartType: 'metric', buckets: [], metrics: [formula('count() / 2'), bad] };
    expect(sanitizeLens(s, allowed).metrics.map((m) => m.id)).toEqual(['m0']);
  });

  it('compiles into the chart query as a metric column', () => {
    const { sql: q } = compileLens(
      { chartType: 'metric', buckets: [], metrics: [formula("count(kql='SeverityText : ERROR') / count()")] },
      config,
      [],
      range
    );
    expect(q).toMatch(/SELECT \(countIf\(.+\) \/ nullIf\(count\(\), 0\)\) AS m0/);
  });

  it('an invalid formula that slipped through compiles to NULL, never its text', () => {
    const { sql: q } = compileLens(
      { chartType: 'metric', buckets: [], metrics: [formula('count()); DROP TABLE x; --')] },
      config,
      [],
      range
    );
    expect(q).toContain('SELECT NULL AS m0');
    expect(q).not.toContain('DROP');
  });

  it('parses into an AST (sanity)', () => {
    expect(parseFormula('count() / 2')).toMatchObject({ type: 'bin', op: '/' });
  });
});
