/**
 * LENS-CALC-01 (round 3 #22): Percentile rank — the share of a number field's values that are less
 * than or equal to a value (Kibana's `percentile_rank`, shown as a percent): quick function, formula
 * `percentile_rank(field, value=N)`, as a calculation's inner metric, and in saved dashboard panels.
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens } from '../compile';
import { DimensionEditor, toFormula } from '../DimensionEditor';
import { withOp, withRefOp } from '../dimensions';
import { formulaErrors, formulaToSql, percentileRankSql, quickToFormula } from '../formula';
import { formatOf, formatValue } from '../metricOptions';
import { buildLensPanel } from '../panelExport';
import { autoLabelIn, BucketDim, decodeLens, LensField, LensState, MetricDim, sanitizeLens } from '../state';
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

const date: BucketDim = { kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: '1d' };
const sev = { field: 'SeverityNumber', fieldLabel: 'SeverityNumber', numeric: true };
const rank: MetricDim = { kind: 'metric', id: 'm0', op: 'percentile_rank', rankValue: 9, ...sev };
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const line = (buckets: BucketDim[], metrics: MetricDim[]): LensState => ({ chartType: 'line', buckets, metrics });
const sqlOf = (s: LensState, mode: 'app' | 'dashboard' = 'app') => compileLens(s, config, conds, range, mode).sql;
const lf: LensField[] = [
  { id: 'SeverityNumber', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
  { id: 'ServiceName', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
];

describe('Percentile rank', () => {
  it('is labelled as Kibana does', () => {
    expect(autoLabelIn(rank)).toBe('Percentile rank (9) of SeverityNumber');
    expect(autoLabelIn({ ...rank, rankValue: undefined })).toBe('Percentile rank (0) of SeverityNumber');
    expect(
      autoLabelIn({
        kind: 'metric',
        id: 'm1',
        op: 'moving_average',
        window: 3,
        ref: { op: 'percentile_rank', ...sev, rankValue: 1.5 },
      })
    ).toBe('Moving average of Percentile rank (1.5) of SeverityNumber');
  });

  it('SQL: the share of values <= value, empty without values; same in app and saved panels', () => {
    expect(percentileRankSql('"x"', 9)).toBe('avgOrNull(toFloat64("x" <= 9))');
    expect(percentileRankSql('"x"', -2.5, 'c')).toBe('avgIfOrNull(toFloat64("x" <= -2.5), c)');
    const app = sqlOf(line([date], [rank]));
    expect(app).toContain('avgOrNull(toFloat64("SeverityNumber" <= 9)) AS m0');
    expect(sqlOf(line([date], [rank]), 'dashboard')).toContain('avgOrNull(toFloat64("SeverityNumber" <= 9)) AS m0');
    const f = sqlOf(line([date], [{ ...rank, filter: 'ServiceName : payments' }]));
    expect(f).toMatch(/avgIfOrNull\(toFloat64\("SeverityNumber" <= 9\), \(.*payments.*\)\) AS m0/);
  });

  it('a calculation can be computed on it (inner -OrNull aggregate, window outside)', () => {
    const m: MetricDim = {
      kind: 'metric',
      id: 'm0',
      op: 'differences',
      ref: { op: 'percentile_rank', ...sev, rankValue: 9 },
    };
    const sql = sqlOf(line([date], [m]));
    expect(sql).toContain('avgOrNull(toFloat64("SeverityNumber" <= 9)) AS a0');
    expect(sql).toContain('lagInFrame');
  });

  it('URL input: the value is a bounded number, never text', () => {
    const round = (m: unknown) => decodeLens(JSON.stringify({ chartType: 'line', buckets: [date], metrics: [m] }));
    expect(round(rank)?.metrics[0]).toMatchObject({ op: 'percentile_rank', rankValue: 9, field: 'SeverityNumber' });
    expect(round({ ...rank, rankValue: '1) OR 1=1 --' })?.metrics[0].rankValue).toBe(0);
    expect(round({ ...rank, rankValue: 1e300 })?.metrics[0].rankValue).toBe(0);
    expect(round({ ...rank, rankValue: undefined })?.metrics[0].rankValue).toBe(0);
    const ma = round({
      kind: 'metric',
      id: 'm1',
      op: 'moving_average',
      ref: { op: 'percentile_rank', ...sev, rankValue: 'x' },
    });
    expect(ma?.metrics[0].ref).toMatchObject({ op: 'percentile_rank', rankValue: 0 });
    // The field must be a discovered field, as for every quick function.
    const bad = line([date], [{ ...rank, field: 'x) FROM system.users --' }, count]);
    expect(sanitizeLens(bad, new Set(['Timestamp', 'SeverityNumber'])).metrics).toEqual([count]);
  });

  it('is shown as a percent with two decimals unless a format is chosen', () => {
    expect(formatOf(rank)).toEqual({ id: 'percent', decimals: 2 });
    expect(formatValue(0.43934, formatOf(rank), String)).toBe('43.93%');
    expect(formatOf({ ...rank, format: { id: 'number' } })).toEqual({ id: 'number' });
    expect(formatOf(count)).toBeUndefined();
    const panel = buildLensPanel({ chartType: 'metric', buckets: [], metrics: [rank] }, config, conds, range, {
      id: 1,
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    });
    expect(JSON.stringify(panel.fieldConfig)).toContain('percentunit');
    expect((panel.targets?.[0] as { rawSql: string }).rawSql).toContain('avgOrNull(toFloat64("SeverityNumber" <= 9))');
  });

  it('switching functions keeps the field and starts at value 0', () => {
    const m = withOp({ kind: 'metric', id: 'm0', op: 'median', ...sev }, 'percentile_rank', lf);
    expect(m).toMatchObject({ op: 'percentile_rank', field: 'SeverityNumber', rankValue: 0 });
    expect(withOp(count, 'percentile_rank', lf)?.field).toBe('SeverityNumber');
    expect(withOp(count, 'percentile_rank', [lf[1]])).toBeUndefined(); // number fields only
    const ma: MetricDim = { kind: 'metric', id: 'm0', op: 'moving_average', window: 5, ref: { op: 'count' } };
    expect(withRefOp(ma, 'percentile_rank', lf)?.ref).toEqual({
      op: 'percentile_rank',
      field: 'SeverityNumber',
      fieldLabel: 'SeverityNumber',
      numeric: true,
      rankValue: 0,
    });
  });
});

describe('Percentile rank formula', () => {
  const fields = { SeverityNumber: { expr: 'SeverityNumber', numeric: true }, Body: { expr: 'Body', numeric: false } };
  const errs = (f: string) => formulaErrors(f, fields).map((e) => e.message);

  it('accepts value=N (also negative and decimal), defaults to 0', () => {
    for (const f of [
      'percentile_rank(SeverityNumber, value=9)',
      'percentile_rank(SeverityNumber)',
      'percentile_rank(SeverityNumber, value=-3)',
      "percentile_rank(SeverityNumber, value=2.5, kql='ServiceName : payments')",
      '1 - percentile_rank(SeverityNumber, value=9)',
    ]) {
      expect([f, errs(f)]).toEqual([f, []]);
    }
    expect(formulaToSql('percentile_rank(SeverityNumber, value=9)', fields, { config })).toBe(
      'avgOrNull(toFloat64("SeverityNumber" <= 9))'
    );
    expect(formulaToSql('percentile_rank(SeverityNumber, value=-3)', fields, { config })).toBe(
      'avgOrNull(toFloat64("SeverityNumber" <= -3))'
    );
    expect(formulaToSql('percentile_rank(SeverityNumber)', fields, { config })).toBe(
      'avgOrNull(toFloat64("SeverityNumber" <= 0))'
    );
  });

  it('rejects misuse with a clear message', () => {
    expect(errs('percentile_rank(Body, value=1)')).toEqual([
      'percentile_rank needs a number field; Body is not a number',
    ]);
    expect(errs("percentile_rank(SeverityNumber, value='1')")).toEqual(['value must be a number']);
    expect(errs('percentile_rank(SeverityNumber, value=1e300)')).toEqual(['value must be a number']);
    expect(errs('percentile_rank(SeverityNumber, percentile=5)')).toEqual([
      'percentile_rank has no argument percentile',
    ]);
  });

  it('a quick Percentile rank converts to the same formula', () => {
    expect(quickToFormula('percentile_rank', 'SeverityNumber', undefined, 9)).toBe(
      'percentile_rank(SeverityNumber, value=9)'
    );
    expect(toFormula(rank, lf).formula).toBe('percentile_rank(SeverityNumber, value=9)');
    const ma: MetricDim = {
      kind: 'metric',
      id: 'm0',
      op: 'moving_average',
      window: 2,
      ref: { op: 'percentile_rank', ...sev, rankValue: 4 },
    };
    expect(toFormula(ma, lf).formula).toBe('moving_average(percentile_rank(SeverityNumber, value=4), window=2)');
  });
});

describe('Percentile rank in the dimension editor', () => {
  // Grafana's Combobox measures text on a canvas, which jsdom does not implement.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  function Harness({ start }: { start: MetricDim }) {
    const [d, setD] = useState<MetricDim>(start);
    return (
      <>
        <DimensionEditor
          dim={d}
          group="Vertical axis"
          fields={lf}
          chart={{ ...line([date], []), metrics: [d] }}
          metrics={[d]}
          timeField="Timestamp"
          onChange={(x) => setD(x as MetricDim)}
          onRemove={() => {}}
          onClose={() => {}}
        />
        <pre data-testid="out">{JSON.stringify(d)}</pre>
      </>
    );
  }
  const out = () => JSON.parse(screen.getByTestId('out').textContent!);

  it('is a quick function with a value input that accepts decimals', () => {
    render(<Harness start={count} />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Quick function' })).getByRole('button', { name: 'Percentile rank' })
    );
    expect(out()).toMatchObject({ op: 'percentile_rank', field: 'SeverityNumber', rankValue: 0 });
    expect(screen.getByRole('note', { name: 'About this function' })).toHaveTextContent(
      'less than or equal to the given value'
    );
    const v = screen.getByLabelText('Percentile ranks value');
    fireEvent.change(v, { target: { value: '9.5' } });
    fireEvent.blur(v);
    expect(out().rankValue).toBe(9.5);
    fireEvent.change(v, { target: { value: 'abc' } });
    fireEvent.blur(v);
    expect(out().rankValue).toBe(9.5);
  });

  it('as the inner metric of a calculation it has its own value input', () => {
    const ma: MetricDim = {
      kind: 'metric',
      id: 'm0',
      op: 'moving_average',
      window: 5,
      ref: { op: 'percentile_rank', ...sev, rankValue: 1 },
    };
    render(<Harness start={ma} />);
    const v = screen.getByLabelText('Percentile ranks value');
    fireEvent.change(v, { target: { value: '-4' } });
    fireEvent.blur(v);
    expect(out().ref.rankValue).toBe(-4);
  });
});
