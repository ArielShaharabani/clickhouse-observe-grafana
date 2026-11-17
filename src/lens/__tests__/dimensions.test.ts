import { addBucket, addMetric, compatibleFields, replaceDim, withName, withOp, withSize } from '../dimensions';
import { autoLabel, decodeLens, dimLabel, encodeLens, LensField, LensState, MetricDim, RECORDS_FIELD } from '../state';
import { compileLens } from '../compile';
import { dateTime } from '@grafana/data';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const f = (sqlExpr: string, type: LensField['type']): LensField => ({ id: sqlExpr, sqlExpr, label: sqlExpr, type });
const FIELDS = [RECORDS_FIELD, f('Timestamp', 'time'), f('SeverityNumber', 'number'), f('TraceFlags', 'number'), f('ServiceName', 'string')];
const median: MetricDim = { kind: 'metric', id: 'm1', op: 'median', field: 'TraceFlags', fieldLabel: 'TraceFlags', numeric: true };
const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };

describe('LENS-DIM-02 metric editor rules', () => {
  it('compatible fields per function', () => {
    expect(compatibleFields('count', FIELDS)).toEqual([]);
    expect(compatibleFields('sum', FIELDS).map((x) => x.sqlExpr)).toEqual(['SeverityNumber', 'TraceFlags']);
    expect(compatibleFields('unique', FIELDS).map((x) => x.sqlExpr)).toEqual(['Timestamp', 'SeverityNumber', 'TraceFlags', 'ServiceName']);
  });

  it('changing function keeps the field where compatible', () => {
    expect(withOp(median, 'max', FIELDS)).toMatchObject({ op: 'max', field: 'TraceFlags' });
    expect(withOp(median, 'unique', FIELDS)).toMatchObject({ op: 'unique', field: 'TraceFlags' });
    const u = withOp({ ...median, op: 'unique', field: 'ServiceName', fieldLabel: 'ServiceName', numeric: false }, 'avg', FIELDS);
    expect(u).toMatchObject({ op: 'avg', field: 'SeverityNumber' }); // not numeric → first number field
    expect(withOp(median, 'count', FIELDS)).toEqual({ kind: 'metric', id: 'm1', op: 'count', name: undefined });
    expect(withOp(median, 'sum', [RECORDS_FIELD])).toBeUndefined();
  });

  it('the label follows the function until the user names it', () => {
    const p = withOp(median, 'percentile', FIELDS)!;
    expect(dimLabel(p)).toBe('95th percentile of TraceFlags');
    const named = withName(p, 'p95 flags');
    expect(dimLabel(withOp(named, 'max', FIELDS)!)).toBe('p95 flags');
    expect(dimLabel(withName(named, '  '))).toBe(autoLabel(p));
  });

  it('top values size is clamped to 1–100', () => {
    const b = { kind: 'terms' as const, id: 'b', field: 'ServiceName', label: 'ServiceName', size: 9 };
    expect(withSize(b, 0)).toMatchObject({ size: 1 });
    expect(withSize(b, 500)).toMatchObject({ size: 100 });
  });

  it('add metric / bucket and replace by id', () => {
    const base: LensState = { chartType: 'bar', subType: 'stacked', buckets: [], metrics: [median] };
    const { state, id } = addMetric(base, ctx);
    expect(state.metrics.map((m) => m.op)).toEqual(['median', 'count']);
    const added = addBucket(state, f('ServiceName', 'string'), ctx);
    expect(added.state.buckets.find((b) => b.id === added.id)).toMatchObject({ kind: 'terms', field: 'ServiceName' });
    const replaced = replaceDim(state, { ...state.metrics[1], name: 'all' });
    expect(replaced.metrics.find((m) => m.id === id)!.name).toBe('all');
  });
});

describe('percentile in SQL and the URL (untrusted)', () => {
  const config: SourceConfig = { datasourceUid: 'ds', database: 'default', logsTable: 'spec_logs', isOtel: true, sequentialConsistency: false, columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' } };
  const from = dateTime(Date.UTC(2026, 0, 1));
  const range = { from, to: from, raw: { from, to: from } };

  it('compiles to quantile(p/100) of the quoted field', () => {
    const sql = compileLens({ chartType: 'metric', buckets: [], metrics: [withOp(median, 'percentile', FIELDS)!] }, config, [], range).sql;
    expect(sql).toContain('quantile(0.95)("TraceFlags") AS m0');
  });

  it('decodeLens drops a metric with a non-numeric or out-of-range percentile, and over-long names', () => {
    const bad = (extra: object) => encodeLens({ chartType: 'metric', buckets: [], metrics: [{ ...median, op: 'percentile', ...extra } as MetricDim] });
    expect(decodeLens(bad({ percentile: '1) FROM system.users --' }))!.metrics).toHaveLength(0);
    expect(decodeLens(bad({ percentile: 500 }))!.metrics).toHaveLength(0);
    expect(decodeLens(bad({ name: 'x'.repeat(500) }))!.metrics).toHaveLength(0);
    expect(decodeLens(bad({ percentile: 99 }))!.metrics).toHaveLength(1);
  });
});
