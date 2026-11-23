import { dateTime } from '@grafana/data';
import { autoAxisTitles } from '../render/styleConfig';
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

describe('R8 E9', () => {
  it('a bar or area without a sub-type is stacked in the panel (as in Visualize); unstacked stays grouped', () => {
    const mode = (s: LensState) => (panel(s).fieldConfig!.defaults.custom as any).stacking.mode;
    expect(mode({ chartType: 'bar', buckets: [date, svc], metrics: [count] })).toBe('normal');
    expect(mode({ chartType: 'area', buckets: [date, svc], metrics: [count] })).toBe('normal');
    expect(mode({ chartType: 'bar', subType: 'unstacked', buckets: [date, svc], metrics: [count] })).toBe('none');
    expect(mode({ chartType: 'line', buckets: [date, svc], metrics: [count] })).toBe('none');
  });
});

describe('R8 E10', () => {
  it('stacked bar panels print no values (Grafana puts them on the next segment); grouped ones do', () => {
    const show = (subType: LensState['subType']) =>
      (panel({ chartType: 'bar', subType, buckets: [svc, lvl], metrics: [count], style: { barValues: 'show' } }).options as any).showValue;
    expect(show('stacked')).toBe('never');
    expect(show('percentage')).toBe('never');
    expect(show('unstacked')).toBe('auto');
  });
});

describe('R8 M3', () => {
  it('table colour by value scales each column on its own min and max', () => {
    const p = panel({
      chartType: 'table',
      buckets: [svc],
      metrics: [
        { ...count, colorBy: 'cell' },
        { ...avg, colorBy: 'text' },
      ],
    });
    const ov = p.fieldConfig!.overrides as any[];
    expect(ov).toHaveLength(2);
    for (const o of ov) {
      expect(o.properties).toContainEqual({ id: 'fieldMinMax', value: true });
    }
  });
});

describe('R8 M9 axes', () => {
  const right = { ...avg, axis: 'right' as const };
  it('stacked charts: one axis, titled with every metric, no right axis in the panel', () => {
    const s: LensState = { chartType: 'bar', subType: 'stacked', buckets: [date], metrics: [count, right] };
    const p = panel(s);
    expect((p.fieldConfig!.overrides as any[]).some((o) => JSON.stringify(o).includes('axisPlacement'))).toBe(false);
    expect(autoAxisTitles(s)).toMatchObject({ left: 'Count of records, Average of SeverityNumber', right: '' });
  });
  it('unstacked charts keep the right axis', () => {
    const s: LensState = { chartType: 'bar', subType: 'unstacked', buckets: [date], metrics: [count, right] };
    expect(autoAxisTitles(s)).toMatchObject({ left: 'Count of records', right: 'Average of SeverityNumber' });
    expect(JSON.stringify(panel(s).fieldConfig!.overrides)).toContain('axisPlacement');
  });
});

describe('R8 E11', () => {
  it('panels without a value format group thousands and show NaN as "-"', () => {
    const d = panel({ chartType: 'metric', buckets: [svc], metrics: [count] }).fieldConfig!.defaults as any;
    expect(d.unit).toBe('locale');
    expect(d.mappings[0]).toMatchObject({ type: 'special', options: { match: 'null+nan', result: { text: '-' } } });
    const fmt = panel({ chartType: 'metric', buckets: [svc], metrics: [{ ...count, format: { id: 'percent' } } as any] });
    expect((fmt.fieldConfig!.defaults as any).unit).not.toBe('locale');
  });

  it('a Metric chart’s Maximum value metric is not a tile', () => {
    const p = panel({ chartType: 'metric', buckets: [svc], metrics: [count, { ...avg, role: 'max' }] });
    expect((p.transformations![0].options as any).excludeByName).toMatchObject({ m1: true });
    expect(JSON.stringify(p.fieldConfig!.overrides)).not.toContain('displayName');
  });
});
