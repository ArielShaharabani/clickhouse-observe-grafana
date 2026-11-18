import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens } from '../compile';
import { DimensionEditor } from '../DimensionEditor';
import { parseLines, withTermsOptions } from '../dimensions';
import { buildLensPanel } from '../panelExport';
import {
  BucketDim,
  decodeLens,
  encodeLens,
  isSyntheticValue,
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

  it('Other: every eligible row stays, non-top values collapse', () => {
    const sql = sqlOf({ ...svc, other: true });
    expect(sql).toContain(
      `if(toString("ServiceName") GLOBAL IN (SELECT v FROM top0), toString("ServiceName"), 'Other') AS b0`
    );
    expect(sql).not.toContain('GLOBAL IN (SELECT v FROM top0)\n');
    expect(sql).toMatch(/WHERE .*toString\("ServiceName"\) IS NOT NULL\nGROUP BY b0/);
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

  it('missing values become "(missing)" and are eligible', () => {
    const sql = sqlOf({ ...svc, missing: true });
    expect(sql).toContain(`ifNull(toString("ServiceName"), '(missing)') AS v`);
    expect(sql).toContain('(toString("ServiceName") IS NULL OR (toString("ServiceName") IS NOT NULL))');
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

  it('hostile values stay inside a string literal', () => {
    const evil = "x') OR 1=1; DROP TABLE t --";
    const sql = sqlOf({ ...svc, include: [evil, "\\' --"], exclude: ['a\\'], regex: false });
    expect(sql).toContain(`IN ('x\\') OR 1=1; DROP TABLE t --', '\\\\\\' --')`);
    expect(sql).toContain(`IN ('a\\\\')`);
    const re = sqlOf({ ...svc, regex: true, include: [evil] });
    expect(re).toContain(`'^(?:x\\') OR 1=1; DROP TABLE t --)\\x24'`);
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
    expect(raw).toContain(`'Other') AS b0`);
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

  it('click-to-filter ignores the synthetic values only when their option is on', () => {
    expect(isSyntheticValue({ ...svc, other: true }, 'Other')).toBe(true);
    expect(isSyntheticValue(svc, 'Other')).toBe(false);
    expect(isSyntheticValue({ ...svc, missing: true }, '(missing)')).toBe(true);
    expect(isSyntheticValue({ ...svc, other: true }, 'payments')).toBe(false);
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
});
