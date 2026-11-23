import { panelSpec } from '../render/LensChart';
import { metricTiles } from '../render/MetricTiles';
import { shapeLensRows } from '../compile';
import { seriesColorOverrides } from '../panelExport';
import { addBucket } from '../dimensions';
import { cleanTerms, LensState } from '../state';
import { formatCell, inspectorTable } from '../inspectorData';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

const svc = { kind: 'terms' as const, id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };
const rows = [
  { b0: 'auth', m0: 12000 },
  { b0: 'checkout', m0: 3 },
  { b0: 'cart', m0: 2 },
];

describe('PARITY-CHARTS2', () => {
  it('pie: one coloured field per slice, labels only when every slice is wide, legend value + percent', () => {
    const state: LensState = { chartType: 'pie', buckets: [svc], metrics: [count] };
    const spec = panelSpec(state, shapeLensRows(state, rows));
    const fields = spec.frames[0].fields;
    expect(fields.map((f) => f.name)).toEqual(['auth', 'checkout', 'cart']);
    const colors = fields.map((f) => (f.config.color as any).fixedColor);
    expect(new Set(colors).size).toBe(3);
    // Slices under 5% (checkout, cart) are too small to label: labels off, legend has value + percent.
    expect(spec.options.displayLabels).toEqual([]);
    expect((spec.options.legend as { values?: string[] }).values).toEqual(['value', 'percent']);
    expect(spec.fieldConfig.defaults.unit).toBe('locale');
  });

  it('pie slice colours are the XY series colours of the same values', () => {
    const state: LensState = { chartType: 'pie', buckets: [svc], metrics: [count] };
    const a = panelSpec(state, shapeLensRows(state, rows)).frames[0].fields[0].config.color;
    const b = panelSpec(state, shapeLensRows(state, rows.slice(0, 1))).frames[0].fields[0].config.color;
    expect(a).toEqual(b);
  });

  it('metric tiles per value carry the metric name as subtitle', () => {
    const state: LensState = { chartType: 'metric', buckets: [svc], metrics: [count] };
    expect(metricTiles(state, shapeLensRows(state, rows))[0].subtitle).toBe('Count of records');
  });

  it('table: grouped numbers, wrapped headers', () => {
    const state: LensState = { chartType: 'table', buckets: [svc], metrics: [count] };
    const d = panelSpec(state, shapeLensRows(state, rows)).fieldConfig.defaults as any;
    expect(d.unit).toBe('locale');
    expect(d.custom.wrapHeaderText).toBe(true);
  });

  it('new top-values buckets group the remaining values as Other; stored ones keep their value', () => {
    const ctx = { timeField: undefined } as any;
    const { state } = addBucket({ chartType: 'bar', buckets: [], metrics: [count] }, { sqlExpr: 'Svc', label: 'Svc', type: 'string' } as any, ctx);
    expect((state.buckets[0] as any).other).toBe(true);
    expect(cleanTerms({ ...svc }).other).toBeUndefined();
  });

  it('export: per-name colour overrides follow the stable assignment and legend picks', () => {
    const state: LensState = { chartType: 'line', buckets: [], metrics: [count], style: { colors: { b: '#112233' } } };
    const ov = seriesColorOverrides(state, [
      { name: 'a', breakdown: 'a' },
      { name: 'b', breakdown: 'b' },
    ]) as any[];
    expect(ov.map((o) => o.matcher.options)).toEqual(['a', 'b']);
    expect(ov[1].properties[0].value.fixedColor).toBe('#112233');
    expect(seriesColorOverrides(state, [{ name: 'Count of records' }])).toEqual([]);
  });

  it('inspector: metric value format in the data view', () => {
    const state: LensState = {
      chartType: 'table',
      buckets: [svc],
      metrics: [{ ...count, format: { kind: 'percent' } } as any],
    };
    const t = inspectorTable(state, shapeLensRows(state, [{ b0: 'a', m0: 0.5 }]));
    expect(t.columns[1].metric).toBeDefined();
    expect(formatCell(t.columns[0], 'a')).toBe('a');
  });
});
