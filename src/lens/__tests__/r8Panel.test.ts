import { dateTime } from '@grafana/data';
import { buildLensPanel } from '../panelExport';
import { LensState } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const range = { from: dateTime(Date.UTC(2026, 0, 1)), to: dateTime(Date.UTC(2026, 0, 8)), raw: { from: '', to: '' } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];
const date = { kind: 'date_histogram' as const, id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' as const };
const svc = { kind: 'terms' as const, id: 'bs', field: 'ServiceName', label: 'ServiceName', size: 9 };
const lvl = { kind: 'terms' as const, id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 3 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };
const avg = { kind: 'metric' as const, id: 'm1', op: 'avg' as const, field: 'SeverityNumber' };
const panel = (s: LensState) => buildLensPanel(s, config, conds, range, { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } });

describe('R8 panel export', () => {
  it('E2: a heat map over time moves each cell to its bucket end', () => {
    const auto = panel({ chartType: 'heatmap', buckets: [date, svc], metrics: [count] });
    const first = auto.transformations![0];
    expect(first.id).toBe('calculateField');
    expect(JSON.stringify(first.options)).toContain('__interval_ms');
    const custom = panel({ chartType: 'heatmap', buckets: [{ ...date, interval: '6h' }, svc], metrics: [count] });
    expect(JSON.stringify(custom.transformations![0].options)).toContain('"fixed":"21600000"');
    const month = panel({ chartType: 'heatmap', buckets: [{ ...date, interval: '1M' }, svc], metrics: [count] });
    expect(month.transformations![0].id).toBe('groupingToMatrix');
  });
});

describe('R8 E4', () => {
  it('pie and stat panels by category read every row, not Grafana’s default 25', () => {
    for (const chartType of ['pie', 'donut', 'metric'] as const) {
      const p = panel({ chartType, buckets: [svc], metrics: [count] });
      expect((p.options as any).reduceOptions.limit).toBe(10000);
    }
    expect((panel({ chartType: 'metric', buckets: [], metrics: [count] }).options as any).reduceOptions.limit).toBeUndefined();
  });
});

describe('R8 E5', () => {
  it('heat map hides only empty cells: negative values and zeros pass the value filter', () => {
    const p = panel({ chartType: 'heatmap', buckets: [date, svc], metrics: [count] });
    expect((p.options as any).filterValues.le).toBeLessThan(-1e100);
  });
});

describe('R8 E6', () => {
  it('time bars start at their bucket start and fill it', () => {
    const p = panel({ chartType: 'bar', subType: 'stacked', buckets: [date], metrics: [count] });
    expect((p.fieldConfig!.defaults.custom as any)).toMatchObject({ barAlignment: 1, barWidthFactor: 1 });
    const line = panel({ chartType: 'line', buckets: [date], metrics: [count] });
    expect((line.fieldConfig!.defaults.custom as any).barAlignment).toBeUndefined();
  });
});
