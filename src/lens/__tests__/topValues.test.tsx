import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens, realKey, shapeLensRows } from '../compile';
import { DimensionEditor } from '../DimensionEditor';
import { parseLines, withTermsOptions } from '../dimensions';
import { buildLensPanel } from '../panelExport';
import {
  BucketDim,
  decodeLens,
  encodeLens,
  autoLabelIn,
  dropMissingRankMetric,
  listError,
  regexError,
  LensState,
  MetricDim,
  sanitizeLens,
  TermsDim,
} from '../state';
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
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];

const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const median: MetricDim = {
  kind: 'metric',
  id: 'm1',
  op: 'median',
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};
const svc: TermsDim = { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 3 };
const sqlOf = (b: TermsDim, metrics: MetricDim[] = [count], mode: 'app' | 'dashboard' = 'app') =>
  compileLens({ chartType: 'bar', buckets: [b], metrics }, config, conds, range, mode).sql;

describe('top values SQL (LENS-DIM-04)', () => {
  it('default options keep the original shape', () => {
    const sql = sqlOf(svc);
    expect(sql).toContain('GROUP BY v ORDER BY count() DESC LIMIT 3)');
    expect(sql).toContain('toString("ServiceName") GLOBAL IN (SELECT v FROM top0)');
    expect(sql).not.toContain('Other');
  });

  it('Other: the value is computed once, the row kind is its own column, Other sorts last', () => {
    const sql = sqlOf({ ...svc, other: true });
    expect(sql).toContain(`toString("ServiceName") AS _r0`);
    expect(sql).toContain('multiIf(_r0 IS NULL, 2, _r0 GLOBAL IN (SELECT v FROM top0), 0, 1) AS k0');
    expect(sql).toContain(`if(k0 = 0, _r0, '') AS b0`);
    expect(sql).not.toContain("'Other'");
    expect(sql).toContain(
      'WHERE Timestamp >= $__fromTime AND Timestamp <= $__toTime AND _r0 IS NOT NULL\nGROUP BY b0, k0'
    );
    expect(sql).toContain('ORDER BY k0, m0 DESC, b0, k0');
    // The predicate of include / exclude is evaluated on the alias, once per row.
    const inc = sqlOf({ ...svc, other: true, include: ['a'] });
    expect(inc).toContain(`_r0 IS NOT NULL AND (_r0 IN ('a'))`);
    expect(inc.split("IN ('a')").length - 1).toBe(2); // once in the CTE, once in the outer WHERE
  });

  it('outer order follows the rank: alphabetical by value, custom metric by its column, direction honoured', () => {
    const order = (b: TermsDim, metrics: MetricDim[] = [count]) =>
      /ORDER BY [^\n]*\nLIMIT 10000/.exec(sqlOf(b, metrics))![0];
    expect(order({ ...svc, rankBy: 'alpha' })).toContain('ORDER BY b0 ASC, b0');
    expect(order({ ...svc, rankBy: 'alpha', rankDir: 'desc', other: true })).toContain('ORDER BY k0, b0 DESC, b0, k0');
    expect(order({ ...svc, rankDir: 'asc' })).toContain('ORDER BY m0 ASC, b0');
    expect(order({ ...svc, rankBy: 'metric', rankMetric: 'm1' }, [count, median])).toContain('ORDER BY m1 DESC, b0');
    expect(
      order({ ...svc, rankBy: 'metric', rankMetric: 'm1', rankDir: 'asc', missing: true }, [count, median])
    ).toContain('ORDER BY k0, m1 ASC, b0, k0');
    // First metric is not a count: ranking by count still orders by count().
    expect(order(svc, [median])).toContain('ORDER BY count() DESC, b0');
  });

  it('"(missing)" is an extra bucket outside the top N and keeps NULL out of the ranking', () => {
    const sql = sqlOf({ ...svc, missing: true });
    expect(sql).toContain(`toString("ServiceName") AS v FROM "default"."spec_logs" WHERE`);
    expect(sql).toContain('v IS NOT NULL GROUP BY v');
    expect(sql).toContain('(_r0 IS NULL OR _r0 GLOBAL IN (SELECT v FROM top0))');
  });

  it('missing on a Map key uses mapContains (an absent key reads as an empty string otherwise)', () => {
    const map = { ...svc, field: "LogAttributes['k']", missing: true };
    const sql = sqlOf(map);
    expect(sql).toContain(`if(mapContains(LogAttributes, 'k'), toString(LogAttributes['k']), NULL) AS _r0`);
    // Without the option the field is read as before.
    expect(sqlOf({ ...map, missing: false })).toContain(`toString(LogAttributes['k'])`);
    expect(sqlOf({ ...map, missing: false })).not.toContain('mapContains');
    // A quoted column name and a key with a bracket and quote are handled the same way.
    const odd = sqlOf({ ...svc, field: `"My Map"['a]\\'b']`, missing: true });
    expect(odd).toContain(`mapContains("My Map", 'a]\\'b')`);
  });

  it('ascending count, alphabetical (default ascending) and custom metric ranking', () => {
    expect(sqlOf({ ...svc, rankDir: 'asc' })).toContain('ORDER BY count() ASC, v LIMIT 3');
    expect(sqlOf({ ...svc, rankBy: 'alpha' })).toContain('ORDER BY v ASC LIMIT 3');
    expect(sqlOf({ ...svc, rankBy: 'alpha', rankDir: 'desc' })).toContain('ORDER BY v DESC LIMIT 3');
    expect(sqlOf({ ...svc, rankBy: 'metric', rankMetric: 'm1' }, [count, median])).toContain(
      'ORDER BY quantile(0.5)("SeverityNumber") DESC, v LIMIT 3'
    );
    // A rank metric that does not exist falls back to count.
    expect(sqlOf({ ...svc, rankBy: 'metric', rankMetric: 'gone' })).toContain('ORDER BY count() DESC LIMIT 3');
  });

  it('include / exclude exact values and regular expressions', () => {
    const exact = sqlOf({ ...svc, include: ['a', 'b'], exclude: ['c'] });
    expect(exact).toContain(
      `toString("ServiceName") IS NOT NULL AND (toString("ServiceName") IN ('a', 'b')) AND NOT (toString("ServiceName") IN ('c'))`
    );
    const re = sqlOf({ ...svc, regex: true, include: ['pay.*', 'chk'] });
    expect(re).toContain(
      `(match(toString("ServiceName"), '^(?:pay.*)\\x24') OR match(toString("ServiceName"), '^(?:chk)\\x24'))`
    );
  });

  it('patterns the editor would reject never reach the query; an include list with none usable matches nothing', () => {
    const sql = sqlOf({ ...svc, regex: true, include: ['a)|(.*'], exclude: ['(?=x)', 'ok'] });
    expect(sql).not.toContain('a)|(.*');
    expect(sql).not.toContain('(?=x)');
    expect(sql).toContain(`NOT (match(toString("ServiceName"), '^(?:ok)\\x24'))`);
    expect(sql).toContain('IS NOT NULL AND 0 AND');
  });

  it('hostile values stay inside a string literal', () => {
    const evil = "x') OR 1=1; DROP TABLE t --";
    const sql = sqlOf({ ...svc, include: [evil, "\\' --"], exclude: ['a\\'], regex: false });
    expect(sql).toContain(`IN ('x\\') OR 1=1; DROP TABLE t --', '\\\\\\' --')`);
    expect(sql).toContain(`IN ('a\\\\')`);
    const re = sqlOf({ ...svc, regex: true, include: ["x' OR 1=1; DROP TABLE t --"] });
    expect(re).toContain(`'^(?:x\\' OR 1=1; DROP TABLE t --)\\x24'`);
    // Quotes are always escaped: no unescaped ' can appear inside the hostile literal.
    expect(sql.replace(/\\./g, '')).not.toContain("1=1; DROP TABLE t --'\n");
  });

  it('macro text in a value is hex-escaped so a saved panel never expands it', () => {
    const sql = sqlOf({ ...svc, include: ['$__timeFilter(Timestamp)'] }, [count], 'dashboard');
    expect(sql).not.toContain('$__timeFilter(Timestamp)');
    expect(sql).toContain('\\x24__timeFilter(Timestamp)');
  });

  it('dashboard mode and saved panels carry the options', () => {
    const t: TermsDim = { ...svc, other: true, include: ['payments'] };
    const state: LensState = { chartType: 'bar', buckets: [t], metrics: [count] };
    const panel = buildLensPanel(state, config, conds, range, { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } });
    const raw = (panel.targets![0] as { rawSql: string }).rawSql;
    expect(raw).toContain('AS k0');
    expect(raw).toContain(`IN ('payments')`);
  });
});

describe('top values state (untrusted URL)', () => {
  const decode = (b: object, metrics: MetricDim[] = [count]) =>
    decodeLens(encodeLens({ chartType: 'bar', buckets: [b as BucketDim], metrics }));

  it('round-trips valid options', () => {
    const t: TermsDim = {
      ...svc,
      rankBy: 'metric',
      rankMetric: 'm1',
      rankDir: 'asc',
      other: true,
      missing: true,
      regex: true,
      include: ['a'],
      exclude: ['b'],
    };
    expect(decode(t, [count, median])!.buckets[0]).toEqual(t);
  });

  it('drops invalid / unknown option values and extra properties', () => {
    const b = decode({
      ...svc,
      rankBy: 'DROP',
      rankDir: 'sideways',
      other: 'yes',
      missing: 1,
      include: 'not-a-list',
      exclude: [1, {}, '', 'x'.repeat(500), 'ok'],
      sql: 'SELECT 1',
    })!.buckets[0] as TermsDim;
    expect(b).toEqual({ ...svc, exclude: ['ok'] });
    expect(b).not.toHaveProperty('sql');
  });

  it('caps the number of include values', () => {
    const b = decode({ ...svc, include: Array.from({ length: 500 }, (_, i) => `v${i}`) })!.buckets[0] as TermsDim;
    expect(b.include).toHaveLength(50);
  });

  it('sanitizeLens resets a rank metric that no longer exists', () => {
    const s: LensState = {
      chartType: 'bar',
      buckets: [{ ...svc, rankBy: 'metric', rankMetric: 'zzz' }],
      metrics: [count],
    };
    const out = sanitizeLens(s, new Set(['ServiceName']));
    expect((out.buckets[0] as TermsDim).rankBy).toBeUndefined();
    const ok: LensState = { ...s, buckets: [{ ...svc, rankBy: 'metric', rankMetric: 'm0' }] };
    expect(sanitizeLens(ok, new Set(['ServiceName']))).toBe(ok);
  });

  it('regexError: wrapper-breaking, unsupported and invalid patterns', () => {
    expect(regexError('pay.*')).toBeNull();
    expect(regexError('(a|b)+[(]x\\)')).toBeNull();
    expect(regexError('a)|(.*')).toMatch(/Unbalanced/);
    expect(regexError('(a')).toMatch(/Unbalanced/);
    expect(regexError('[a')).toMatch(/Unbalanced/);
    expect(regexError('a\\')).toMatch(/backslash/);
    expect(regexError('(?=a)b')).toMatch(/Lookaround/);
    expect(regexError('(?<!a)b')).toMatch(/Lookaround/);
    expect(regexError('(a)\\1')).toMatch(/Back-reference/);
    expect(regexError('a**')).toMatch(/Invalid/);
    expect(regexError('x'.repeat(201))).toMatch(/too long/);
  });

  it('listError: too many / too long values are reported, not cut', () => {
    expect(listError(['a', 'b'], false)).toBeNull();
    expect(
      listError(
        Array.from({ length: 51 }, () => 'a'),
        false
      )
    ).toMatch(/Max 50/);
    expect(listError(['x'.repeat(201)], false)).toMatch(/200 characters/);
    expect(listError(['a', '(b'], true)).toMatch(/Unbalanced/);
    expect(listError(['(b'], false)).toBeNull();
  });

  it('a removed rank metric resets the stored rank', () => {
    const s: LensState = {
      chartType: 'bar',
      buckets: [{ ...svc, rankBy: 'metric', rankMetric: 'm1', rankDir: 'asc' }],
      metrics: [count],
    };
    const out = dropMissingRankMetric(s);
    expect(out.buckets[0]).toEqual(svc);
    const ok = { ...s, metrics: [count, median] };
    expect(dropMissingRankMetric(ok)).toBe(ok);
  });

  it('labels follow the rank', () => {
    expect(autoLabelIn(svc)).toBe('Top 3 values of ServiceName');
    expect(autoLabelIn({ ...svc, rankDir: 'asc' })).toBe('Bottom 3 values of ServiceName');
    expect(autoLabelIn({ ...svc, rankBy: 'alpha' })).toBe('First 3 values of ServiceName');
    expect(autoLabelIn({ ...svc, rankBy: 'alpha', rankDir: 'desc' })).toBe('Last 3 values of ServiceName');
    const m: TermsDim = { ...svc, rankBy: 'metric', rankMetric: 'm1' };
    expect(autoLabelIn(m, [count, median])).toBe('Top 3 values of ServiceName by Median of SeverityNumber');
    expect(autoLabelIn(m)).toBe('Top 3 values of ServiceName');
  });

  it('shaping: synthetic Other / (missing) never merge with real values of the same text', () => {
    const t: TermsDim = { ...svc, other: true, missing: true };
    const state: LensState = { chartType: 'bar', buckets: [t], metrics: [count] };
    const rows = [
      { b0: 'Other', k0: 0, m0: 5 },
      { b0: '(missing)', k0: 0, m0: 4 },
      { b0: 'payments', k0: 0, m0: 3 },
      { b0: '', k0: 1, m0: 2 },
      { b0: '', k0: 2, m0: 1 },
    ];
    const r = shapeLensRows(state, rows);
    expect(r.xs).toHaveLength(5);
    expect(r.xLabels).toEqual(['Other (value)', '(missing) (value)', 'payments', 'Other', '(missing)']);
    expect(r.xSynthetic).toEqual([false, false, false, true, true]);
    expect(r.table.rows.map((x) => x[0])).toEqual([
      'Other (value)',
      '(missing) (value)',
      'payments',
      'Other',
      '(missing)',
    ]);
    // Without the options the same text is just a value.
    const plain = shapeLensRows({ ...state, buckets: [svc] }, [{ b0: 'Other', m0: 1 }]);
    expect(plain.xLabels).toEqual(['Other']);
    expect(plain.xSynthetic).toEqual([false]);
  });

  it('shaping a breakdown: the real "Other" keeps its value for click-to-filter, the synthetic one has none', () => {
    const state: LensState = {
      chartType: 'bar',
      buckets: [
        { ...svc, id: 'x' },
        { ...svc, id: 'y', other: true },
      ],
      metrics: [count],
    };
    const r = shapeLensRows(state, [
      { b0: 'a', b1: 'Other', k1: 0, m0: 2 },
      { b0: 'a', b1: '', k1: 1, m0: 7 },
    ]);
    const real = r.series.find((x) => !x.synthetic)!;
    const other = r.series.find((x) => x.synthetic)!;
    expect(real.breakdown).toBe('Other');
    expect(real.name).toBe('Other (value)');
    expect(other.name).toBe('Other');
    expect(other.points.get('a')).toBe(7);
  });

  it('values that start with the internal marker characters are escaped and restored', () => {
    const t: TermsDim = { ...svc, other: true };
    const bs = String.fromCharCode(0);
    const r = shapeLensRows({ chartType: 'bar', buckets: [t], metrics: [count] }, [
      { b0: bs + 'other', k0: 0, m0: 1 },
      { b0: '', k0: 1, m0: 2 },
    ]);
    expect(new Set(r.xs).size).toBe(2);
    expect(realKey(String(r.xs[0]))).toBe(bs + 'other');
    expect(r.xSynthetic).toEqual([false, true]);
  });

  it('helpers', () => {
    expect(parseLines('a\r\n\nb')).toEqual(['a', 'b']);
    expect(withTermsOptions(svc, { rankBy: 'count', include: [] })).toEqual(svc);
  });
});

describe('top values editor UI', () => {
  beforeAll(() => {
    // jsdom has no canvas; the Combobox measures text with it.
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });

  function Harness({ initial, metrics = [count, median] }: { initial: TermsDim; metrics?: MetricDim[] }) {
    const [d, setD] = useState<BucketDim>(initial);
    return (
      <>
        <DimensionEditor
          dim={d}
          group="Horizontal axis"
          fields={[]}
          metrics={metrics}
          onChange={(x) => setD(x as BucketDim)}
          onRemove={() => {}}
          onClose={() => {}}
        />
        <pre data-testid="out">{JSON.stringify(d)}</pre>
      </>
    );
  }
  const out = () => JSON.parse(screen.getByTestId('out').textContent!);

  it('toggles Other / missing / regex and edits include & exclude on blur', () => {
    render(<Harness initial={svc} />);
    fireEvent.click(screen.getByLabelText('Group remaining values as Other'));
    fireEvent.click(screen.getByLabelText('Include documents without this field'));
    fireEvent.click(screen.getByLabelText('Use regular expression'));
    expect(out()).toMatchObject({ other: true, missing: true, regex: true });
    const inc = screen.getByLabelText('Include values');
    fireEvent.change(inc, { target: { value: 'a\nb' } });
    fireEvent.blur(inc);
    expect(out().include).toEqual(['a', 'b']);
    const exc = screen.getByLabelText('Exclude values');
    fireEvent.change(exc, { target: { value: 'z' } });
    fireEvent.blur(exc);
    expect(out().exclude).toEqual(['z']);
  });

  it('rank by and direction', () => {
    render(<Harness initial={svc} />);
    fireEvent.click(screen.getByLabelText('Alphabetical'));
    expect(out().rankBy).toBe('alpha');
    expect(screen.getByLabelText('Ascending')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Descending'));
    expect(out().rankDir).toBe('desc');
    fireEvent.click(screen.getByLabelText('Custom metric'));
    expect(out()).toMatchObject({ rankBy: 'metric', rankMetric: 'm0' });
    expect(screen.getByRole('combobox', { name: 'Rank metric' })).toBeInTheDocument();
  });

  it('Custom metric is disabled while there is no metric', () => {
    render(<Harness initial={svc} metrics={[]} />);
    expect(screen.getByLabelText('Custom metric')).toBeDisabled();
  });

  it('shows why a regex / list cannot be applied and keeps the text', () => {
    render(<Harness initial={{ ...svc, regex: true }} />);
    const inc = screen.getByLabelText('Include values');
    fireEvent.change(inc, { target: { value: 'a)|(.*' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/Unbalanced/);
    fireEvent.blur(inc);
    expect(out().include).toBeUndefined();
    expect(inc).toHaveValue('a)|(.*');
    fireEvent.change(inc, {
      target: { value: Array.from({ length: 51 }, (_, i) => `v${i}`).join(String.fromCharCode(10)) },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Max 50 values');
  });
});
