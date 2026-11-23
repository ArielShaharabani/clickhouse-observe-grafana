import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens, shapeLensRows } from '../compile';
import { DimensionEditor } from '../DimensionEditor';
import { kqlError } from '../BucketEditors';
import { withBucketFunction, withFilterList, withRangeOptions } from '../dimensions';
import { buildLensPanel } from '../panelExport';
import { switchChart } from '../suggest';
import {
  autoLabelIn,
  BucketDim,
  decodeLens,
  encodeLens,
  FiltersDim,
  LensField,
  LensState,
  MetricDim,
  RangeDim,
  rangeLabel,
  sanitizeLens,
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

const sev: RangeDim = { kind: 'range', id: 'b0', field: 'SeverityNumber', label: 'SeverityNumber', numeric: true };
const filt = (filters: FiltersDim['filters']): FiltersDim => ({
  kind: 'filters',
  id: 'b0',
  field: '',
  label: 'Filters',
  filters,
});
const lensOf = (b: BucketDim): LensState => ({ chartType: 'bar', buckets: [b], metrics: [count] });
const sqlOf = (b: BucketDim, mode: 'app' | 'dashboard' = 'app') =>
  compileLens(lensOf(b), config, conds, range, mode).sql;

describe('Intervals SQL (LENS-DIM-05)', () => {
  it('automatic: power-of-ten width from the data span, by granularity', () => {
    const sql = sqlOf(sev);
    expect(sql).toContain(
      'rng0 AS (SELECT if(max(v) > min(v), exp10(ceil(log10((max(v) - min(v)) / 50))), 1) AS w FROM (SELECT toFloat64("SeverityNumber") AS v FROM'
    );
    expect(sql).toContain('floor(toFloat64("SeverityNumber") / (SELECT w FROM rng0)) * (SELECT w FROM rng0) AS b0');
    expect(sql).toContain('any((SELECT w FROM rng0)) AS w0');
    expect(sql).toMatch(/ORDER BY b0/);
    expect(sqlOf({ ...sev, granularity: 1 })).toContain('/ 5)');
    expect(sqlOf({ ...sev, numeric: undefined })).toContain('toFloat64OrNull(toString("SeverityNumber"))');
  });

  it('custom ranges: first match wins, open ends, rows outside every range dropped', () => {
    const sql = sqlOf({ ...sev, ranges: [{ to: 9 }, { from: 9, to: 17 }, { from: 17 }] });
    expect(sql).toContain(
      'arrayJoin(arrayFilter(__r -> __r >= 0, [if(toFloat64("SeverityNumber") IS NOT NULL AND toFloat64("SeverityNumber") < 9, 0, -1), if(toFloat64("SeverityNumber") IS NOT NULL AND toFloat64("SeverityNumber") >= 9 AND toFloat64("SeverityNumber") < 17, 1, -1), if(toFloat64("SeverityNumber") IS NOT NULL AND toFloat64("SeverityNumber") >= 17, 2, -1)])) AS b0'
    );
    expect(sql).toContain(' < 9) OR (toFloat64("SeverityNumber") IS NOT NULL');
    expect(sqlOf({ ...sev, ranges: [] })).toContain('WHERE Timestamp >= $__fromTime AND Timestamp <= $__toTime AND 0');
  });

  it('saved panels get the range labels as literals ($ written as \\x24)', () => {
    const sql = sqlOf({ ...sev, ranges: [{ from: 0, to: 9, label: "low' OR 1=1 $__timeFilter" }] }, 'dashboard');
    expect(sql).toContain('transform(arrayJoin(');
    expect(sql).toContain("['low\\' OR 1=1 \\x24__timeFilter']");
    expect(sql).not.toContain('$__timeFilter');
  });
});

describe('Filters SQL', () => {
  it('one bucket per KQL query; a document can be in several', () => {
    const sql = sqlOf(filt([{ query: 'SeverityText : error' }, { query: '', label: 'Everything' }]));
    expect(sql).toMatch(
      /arrayJoin\(arrayFilter\(__f -> __f >= 0, \[if\(\(.*SeverityText.*\), 0, -1\), if\(1, 1, -1\)\]\)\) AS b0/
    );
    expect(sql).toMatch(/AND \(\(.*SeverityText.*\) OR 1\)/);
  });

  it('values are escaped by the KQL compiler; an invalid query matches nothing', () => {
    const sql = sqlOf(filt([{ query: `ServiceName : "x' OR 1=1 --"` }, { query: 'SeverityText : (' }]));
    expect(sql).not.toMatch(/'x' OR 1=1/);
    expect(sql).toContain("x\\' OR 1=1 --");
    expect(sql).toContain('if(0, 1, -1)');
  });

  it('saved panels: label literals and no macro text from queries', () => {
    const sql = sqlOf(filt([{ query: 'Body : "$__timeFilter"', label: 'macro $x' }]), 'dashboard');
    expect(sql).not.toContain('$__timeFilter');
    expect(sql).toContain("['macro \\x24x']");
  });
});

describe('URL / saved state', () => {
  it('round-trips and cleans untrusted input', () => {
    const r: RangeDim = { ...sev, ranges: [{ from: 1, to: 2, label: 'a' }], granularity: 6, emptyRows: false };
    expect(decodeLens(encodeLens(lensOf(r)))?.buckets[0]).toEqual(r);
    const raw = JSON.stringify({
      chartType: 'bar',
      metrics: [count],
      buckets: [
        { ...sev, ranges: [{ from: '1); DROP', to: 1e309, label: 5 }, null], granularity: 99, sql: 'x' },
        {
          kind: 'filters',
          id: 'b1',
          field: '',
          label: 'Filters',
          filters: [{ query: 'a:b', label: 'ok', x: 1 }, { query: 7 }],
        },
        { kind: 'filters', id: 'b2', field: 'Body', label: 'Filters', filters: [] },
      ],
    });
    const [a, b, c] = decodeLens(raw)!.buckets;
    expect(a).toEqual({ ...sev, ranges: [{}] });
    expect(b).toEqual({
      kind: 'filters',
      id: 'b1',
      field: '',
      label: 'Filters',
      filters: [{ query: 'a:b', label: 'ok' }],
    });
    expect(c).toBeUndefined();
  });

  it('sanitize keeps Filters (no field) and drops Intervals on unknown fields', () => {
    const s: LensState = {
      chartType: 'table',
      buckets: [filt([{ query: '' }]), { ...sev, id: 'b1' }],
      metrics: [count],
    };
    expect(sanitizeLens(s, new Set(['Timestamp'])).buckets.map((b) => b.kind)).toEqual(['filters']);
  });
});

describe('shaping', () => {
  it('automatic intervals: labels from the width, empty widths filled', () => {
    const r = shapeLensRows(lensOf(sev), [
      { b0: 0, w0: 10, m0: 4 },
      { b0: 30, w0: 10, m0: 1 },
    ]);
    expect(r.xs).toEqual(['0', '10', '20', '30']);
    expect(r.xLabels).toEqual(['0 – 10', '10 – 20', '20 – 30', '30 – 40']);
    expect(
      shapeLensRows(lensOf({ ...sev, emptyRows: false }), [
        { b0: 0, w0: 10, m0: 4 },
        { b0: 30, w0: 10, m0: 1 },
      ]).xs
    ).toEqual(['0', '30']);
  });

  it('custom ranges and filters: labels by index, table shows labels', () => {
    const r = shapeLensRows(lensOf({ ...sev, ranges: [{ to: 9 }, { from: 9, to: 17, label: 'mid' }] }), [
      { b0: 0, m0: 2 },
      { b0: 1, m0: 3 },
    ]);
    expect(r.xLabels).toEqual(['< 9', 'mid']);
    expect(r.table.rows).toEqual([
      ['< 9', 2],
      ['mid', 3],
    ]);
    const f = shapeLensRows(lensOf(filt([{ query: 'a : b' }, { query: '' }])), [
      { b0: 0, m0: 1 },
      { b0: 1, m0: 5 },
    ]);
    expect(f.xLabels).toEqual(['a : b', 'All records']);
  });

  it('as a breakdown: one series per bucket', () => {
    const date = { kind: 'date_histogram' as const, id: 'd', field: 'Timestamp', label: 'Timestamp', interval: 'auto' };
    const s: LensState = {
      chartType: 'bar',
      buckets: [date, filt([{ query: 'x' }, { query: 'y', label: 'Why' }])],
      metrics: [count],
    };
    const r = shapeLensRows(s, [
      { b0: 0, b1: 0, m0: 1 },
      { b0: 0, b1: 1, m0: 2 },
    ]);
    expect(r.series.map((x) => x.name)).toEqual(['x', 'Why']);
  });
});

describe('functions and labels', () => {
  const fields: LensField[] = [
    { id: 'ts', sqlExpr: 'Timestamp', label: 'Timestamp', type: 'time' },
    { id: 'n', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
    { id: 's', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
  ];
  it('switching keeps a compatible field, else the first one', () => {
    const terms = { kind: 'terms' as const, id: 'b0', field: 'SeverityNumber', label: 'SeverityNumber', size: 9 };
    expect(withBucketFunction(terms, 'range', fields)).toEqual({ ...sev, id: 'b0' });
    expect(withBucketFunction(terms, 'date_histogram', fields)).toMatchObject({ field: 'Timestamp', interval: 'auto' });
    expect(withBucketFunction(sev, 'filters', fields)).toEqual(filt([{ query: '' }]));
    expect(withBucketFunction(sev, 'range', [fields[0]])).toBe(sev);
    expect(withBucketFunction(terms, 'range', [fields[2]])).toBeUndefined();
  });

  it('labels', () => {
    expect(autoLabelIn(sev)).toBe('SeverityNumber');
    expect(autoLabelIn({ ...sev, ranges: [] })).toBe('SeverityNumber ranges');
    expect(autoLabelIn(filt([{ query: 'a : b' }]))).toBe('a : b');
    expect(autoLabelIn(filt([{ query: 'a' }, { query: 'b' }]))).toBe('Filters');
    expect(rangeLabel({ from: 1 })).toBe('≥ 1');
  });

  it('metric and pie keep an Intervals / Filters breakdown', () => {
    const s = switchChart(lensOf(filt([{ query: '' }])), 'pie', {});
    expect(s.buckets[0].kind).toBe('filters');
  });

  it('helpers normalise', () => {
    expect(withRangeOptions(sev, { granularity: 4 })).toEqual(sev);
    expect(withFilterList(filt([]), [{ query: 'a', label: '  ' }])).toEqual(filt([{ query: 'a' }]));
    expect(kqlError('SeverityText : (')).toMatch(/^Invalid KQL/);
    expect(kqlError('')).toBeNull();
  });

  it('a saved panel with a Filters breakdown partitions by it', () => {
    const date = { kind: 'date_histogram' as const, id: 'd', field: 'Timestamp', label: 'Timestamp', interval: 'auto' };
    const panel = buildLensPanel(
      { chartType: 'bar', buckets: [date, filt([{ query: 'x' }])], metrics: [count] },
      config,
      conds,
      range,
      { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } }
    );
    expect(JSON.stringify(panel)).toContain('partitionByValues');
  });
});

describe('bucket editor', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const fields: LensField[] = [
    { id: 'ts', sqlExpr: 'Timestamp', label: 'Timestamp', type: 'time' },
    { id: 'n', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
    { id: 's', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
  ];
  function Harness({ initial, onState }: { initial: BucketDim; onState: (d: BucketDim) => void }) {
    const [dim, setDim] = useState<BucketDim>(initial);
    return (
      <DimensionEditor
        dim={dim}
        group="Horizontal axis"
        fields={fields}
        onChange={(d) => {
          setDim(d as BucketDim);
          onState(d as BucketDim);
        }}
        onRemove={() => {}}
        onClose={() => {}}
      />
    );
  }

  it('Functions grid switches to Intervals, custom ranges are edited on blur', () => {
    let last: BucketDim | undefined;
    render(
      <Harness
        initial={{ kind: 'terms', id: 'b0', field: 'SeverityNumber', label: 'SeverityNumber', size: 9 }}
        onState={(d) => (last = d)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Intervals' }));
    expect(last).toMatchObject({ kind: 'range', field: 'SeverityNumber' });
    expect(screen.getByRole('button', { name: 'Intervals' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('switch', { name: 'Create custom ranges' }));
    expect(last).toMatchObject({ ranges: [{ from: 0, to: 1000 }] });
    const to = screen.getByRole('textbox', { name: 'Range 1 to' });
    fireEvent.change(to, { target: { value: 'abc' } });
    fireEvent.blur(to);
    expect(screen.getByRole('alert').textContent).toBe('Not a number');
    expect(last).toMatchObject({ ranges: [{ from: 0, to: 1000 }] });
    fireEvent.change(to, { target: { value: '9' } });
    fireEvent.blur(to);
    expect(last).toMatchObject({ ranges: [{ from: 0, to: 9 }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add range' }));
    expect(last).toMatchObject({ ranges: [{ from: 0, to: 9 }, { from: 9 }] });
  });

  it('Filters: invalid KQL stays in the box with a message; valid queries apply', () => {
    let last: BucketDim | undefined;
    render(<Harness initial={filt([{ query: '' }])} onState={(d) => (last = d)} />);
    const q = screen.getByRole('textbox', { name: 'Filter 1 query' });
    fireEvent.change(q, { target: { value: 'SeverityText : (' } });
    fireEvent.blur(q);
    expect(screen.getByRole('alert').textContent).toMatch(/^Invalid KQL/);
    expect(last).toBeUndefined();
    fireEvent.change(q, { target: { value: 'SeverityText : error' } });
    fireEvent.blur(q);
    expect(last).toMatchObject({ filters: [{ query: 'SeverityText : error' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Add a filter' }));
    expect(last).toMatchObject({ filters: [{ query: 'SeverityText : error' }, { query: '' }] });
  });

  it('Date histogram is disabled without a date field', () => {
    render(
      <DimensionEditor
        dim={sev}
        group="Horizontal axis"
        fields={[fields[1]]}
        onChange={() => {}}
        onRemove={() => {}}
        onClose={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Date histogram' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Filters' })).toHaveProperty('disabled', false);
  });
});
