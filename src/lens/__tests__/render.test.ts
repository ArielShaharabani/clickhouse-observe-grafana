import { panelSpec } from '../render/LensChart';
import { dimensionGroups } from '../LensPage';
import { shapeLensRows } from '../compile';
import { LensState } from '../state';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

const date = {
  kind: 'date_histogram' as const,
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto' as const,
};
const svc = { kind: 'terms' as const, id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };

describe('LensChart panel mapping', () => {
  const rowsTime = [{ b0: '2026-01-01 00:00:00', b1: 'auth', m0: 3 }];
  it.each<[LensState, string]>([
    [{ chartType: 'line', buckets: [date, svc], metrics: [count], subType: 'stacked' }, 'timeseries'],
    [{ chartType: 'bar', buckets: [svc], metrics: [count], subType: 'stacked' }, 'barchart'],
    [{ chartType: 'metric', buckets: [], metrics: [count] }, 'stat'],
    [{ chartType: 'table', buckets: [svc], metrics: [count] }, 'table'],
    [{ chartType: 'pie', buckets: [svc], metrics: [count] }, 'piechart'],
  ])('%#', (state, pluginId) => {
    const rows = state.buckets[0]?.kind === 'date_histogram' ? rowsTime : [{ b0: 'auth', m0: 3 }];
    expect(panelSpec(state, shapeLensRows(state, rows)).pluginId).toBe(pluginId);
  });

  it('bars over time draw as bars, stacked; line is never stacked; percentage stacks to percent', () => {
    const r = shapeLensRows({ chartType: 'bar', buckets: [date], metrics: [count] }, [
      { b0: '2026-01-01 00:00:00', m0: 1 },
    ]);
    const custom = (s: LensState) => (panelSpec(s, r).fieldConfig.defaults as any).custom;
    expect(custom({ chartType: 'bar', buckets: [date], metrics: [count], subType: 'stacked' })).toMatchObject({
      drawStyle: 'bars',
      stacking: { mode: 'normal' },
    });
    expect(custom({ chartType: 'line', buckets: [date], metrics: [count], subType: 'stacked' }).stacking.mode).toBe(
      'none'
    );
    expect(custom({ chartType: 'area', buckets: [date], metrics: [count], subType: 'percentage' }).stacking.mode).toBe(
      'percent'
    );
  });
});

describe('dimension groups per chart (LENS-DIM-01 names)', () => {
  it('XY / table / metric / pie', () => {
    const names = (s: LensState) => dimensionGroups(s).map((g) => `${g.name}:${g.dims.length}`);
    expect(names({ chartType: 'bar', buckets: [svc], metrics: [count] })).toEqual([
      'Horizontal axis:1',
      'Vertical axis:1',
      'Breakdown:0',
    ]);
    expect(names({ chartType: 'table', buckets: [svc, date], metrics: [count] })).toEqual(['Rows:2', 'Metrics:1']);
    expect(names({ chartType: 'metric', buckets: [svc], metrics: [count] })).toEqual([
      'Primary metric:1',
      'Secondary metric:0',
      'Break down by:1',
    ]);
    expect(names({ chartType: 'pie', buckets: [svc], metrics: [count] })).toEqual(['Slice by:1', 'Size by:1']);
  });
});
