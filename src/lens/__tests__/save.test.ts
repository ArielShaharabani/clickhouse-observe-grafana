import { dateTime } from '@grafana/data';
import { compileLens } from '../compile';
import { buildLensPanel, columnNames, defaultPanelTitle } from '../panelExport';
import { saveLens } from '../SaveLensModal';
import { decodeLens, LensState, sanitizeLens } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import * as dashboards from '../../data/dashboards';

jest.mock('../../data/dashboards');
const api = dashboards as jest.Mocked<typeof dashboards>;

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
const range = { from, to, raw: { from: 'now-7d', to: 'now' } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];

const date = {
  kind: 'date_histogram' as const,
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto' as const,
};
const service = { kind: 'terms' as const, id: 'bs', field: 'ServiceName', label: 'ServiceName', size: 9 };
const level = { kind: 'terms' as const, id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 3 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };
const lens = (
  chartType: LensState['chartType'],
  buckets: LensState['buckets'],
  subType?: LensState['subType']
): LensState => ({
  chartType,
  subType,
  buckets,
  metrics: [count],
});
const panel = (s: LensState) =>
  buildLensPanel(s, config, conds, range, { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } });
const ids = (p: ReturnType<typeof panel>) => (p.transformations ?? []).map((t) => t.id);

describe('LENS-SAVE-01 dashboard SQL', () => {
  it('R4-DASH: a date-histogram panel asks for ~60 buckets (Visualize auto interval), others do not', () => {
    expect(panel(lens('bar', [date])).maxDataPoints).toBe(60);
    expect(panel(lens('bar', [service])).maxDataPoints).toBeUndefined();
  });

  it('date buckets use the $__timeInterval macro (follows the dashboard time), app mode unchanged', () => {
    const s = lens('bar', [date, level], 'stacked');
    const dash = compileLens(s, config, conds, range, 'dashboard').sql;
    expect(dash).toContain('$__timeInterval("Timestamp") AS b0');
    expect(dash).not.toContain('toStartOfInterval("Timestamp"');
    expect(compileLens(s, config, conds, range).sql).toContain('toStartOfInterval("Timestamp", INTERVAL');
  });

  it('expression time fields with parentheses or commas skip the macro', () => {
    const odd = { ...date, field: "LogAttributes['t(1),x']" };
    const sql = compileLens(lens('bar', [odd]), config, conds, range, 'dashboard').sql;
    expect(sql).not.toContain('$__timeInterval');
    expect(sql).toContain(
      "toStartOfInterval(toDateTime(LogAttributes['t(1),x']), INTERVAL $__interval_s second) AS b0"
    );
  });

  it('a hostile lens from the URL stays quoted in dashboard mode', () => {
    const raw = JSON.stringify({
      chartType: 'bar',
      buckets: [
        { kind: 'date_histogram', id: 'x', field: 'Timestamp) FROM system.users --', label: 'x', interval: 'auto' },
      ],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    });
    const safe = sanitizeLens(decodeLens(raw)!, new Set(['Timestamp']));
    expect(compileLens(safe, config, conds, range, 'dashboard').sql).not.toContain('system.users');
  });
});

describe('LENS-SAVE-01 panel per chart type', () => {
  it('time × count → timeseries bars, stacked, readable names', () => {
    const p = panel(lens('bar', [date], 'stacked'));
    expect(p.type).toBe('timeseries');
    expect(p.targets[0]).toEqual(
      expect.objectContaining({
        refId: 'A',
        format: 1,
        datasource: { type: 'grafana-clickhouse-datasource', uid: 'ds' },
      })
    );
    expect(p.fieldConfig?.defaults).toEqual(
      expect.objectContaining({
        custom: expect.objectContaining({ drawStyle: 'bars', stacking: { mode: 'normal', group: 'A' } }),
      })
    );
    expect(p.transformations?.[0].options).toEqual(
      expect.objectContaining({ renameByName: { b0: 'Timestamp', m0: 'Count of records' } })
    );
  });

  it('time × breakdown → one series per value', () => {
    const p = panel(lens('area', [date, level], 'percentage'));
    expect(p.type).toBe('timeseries');
    expect(ids(p)).toEqual(['organize', 'partitionByValues', 'prepareTimeSeries']);
    // X keeps its readable name; the split column stays b1 for the partition and the metric stays
    // m0, named per series from its b1 label (PARITY-DASHBOARDS: no "m0 checkout" legend).
    expect(p.transformations?.[0].options).toEqual(expect.objectContaining({ renameByName: { b0: 'Timestamp' } }));
    expect(p.fieldConfig?.overrides).toEqual([
      { matcher: { id: 'byName', options: 'm0' }, properties: [{ id: 'displayName', value: '$' + '{__field.labels.b1}' }] },
    ]);
    expect(p.transformations?.[1].options).toEqual({ fields: ['b1'], keepFields: false });
    expect((p.fieldConfig?.defaults as any).custom.stacking.mode).toBe('percent');
    expect((p.fieldConfig?.defaults as any).custom.fillOpacity).toBe(50);
  });

  it('category X → barchart; with a breakdown, values become columns', () => {
    expect(panel(lens('bar', [service], 'stacked'))).toEqual(
      expect.objectContaining({
        type: 'barchart',
        options: expect.objectContaining({ xField: 'Top 9 values of ServiceName', stacking: 'normal' }),
      })
    );
    const p = panel(lens('bar', [service, level], 'unstacked'));
    expect(ids(p)).toEqual(['groupingToMatrix', 'organize']);
    expect(p.transformations?.[0].options).toEqual({ columnField: 'b1', rowField: 'b0', valueField: 'm0' });
    expect(p.transformations?.[1].options).toEqual(
      expect.objectContaining({ renameByName: { 'b0\\b1': 'Top 9 values of ServiceName' } })
    );
    expect((p.options as any).stacking).toBe('none');
  });

  it('category X × breakdown with several metrics keeps every metric (partition + join on X)', () => {
    const avg = { kind: 'metric' as const, id: 'm1', op: 'avg' as const, field: 'SeverityNumber' };
    const p = panel({ ...lens('bar', [service, level], 'stacked'), metrics: [count, avg] });
    expect(ids(p)).toEqual(['organize', 'partitionByValues', 'joinByField', 'organize']);
    // E3: the join runs on the raw alias; the category column is named afterwards.
    expect(p.transformations?.[2].options).toEqual({ byField: 'b0', mode: 'outer' });
    expect((p.transformations?.[3].options as any).renameByName).toEqual({ b0: 'Top 9 values of ServiceName' });
  });

  it.each([
    ['metric', [], 'stat'],
    ['metric', [service], 'stat'],
    ['pie', [service], 'piechart'],
    ['table', [service, level], 'table'],
  ] as const)('%s with %#  → %s', (chart, buckets, type) => {
    const p = panel(lens(chart, [...buckets]));
    expect(p.type).toBe(type);
    expect(ids(p)).toEqual(['organize']);
  });

  it('title and description: the user’s, else a suggested title', () => {
    const s = lens('bar', [date, service], 'stacked');
    expect(defaultPanelTitle(s)).toBe('Count of records by ServiceName over time');
    expect(panel(s).title).toBe('Bar stacked');
    const named = buildLensPanel(s, config, conds, range, {
      id: 1,
      gridPos: { x: 0, y: 0, w: 1, h: 1 },
      title: ' Errors ',
      description: ' why ',
    });
    expect([named.title, named.description]).toEqual(['Errors', 'why']);
    expect(panel(s).description).toBeUndefined();
    expect(columnNames(s)).toEqual({ b0: 'Timestamp', b1: 'Top 9 values of ServiceName', m0: 'Count of records' });
  });
});

describe('saveLens', () => {
  const p = panel(lens('bar', [date], 'stacked'));
  beforeEach(() => {
    jest.resetAllMocks();
    api.saveDashboard.mockResolvedValue({ uid: 'd1', url: '/d/d1/x' });
    api.createLibraryPanel.mockResolvedValue({ uid: 'lib1', name: 'Bar stacked' });
    api.deleteLibraryPanel.mockResolvedValue();
    api.getDashboard.mockResolvedValue({
      dashboard: { title: 'Ops', panels: [{ id: 7, gridPos: { x: 0, y: 0, w: 24, h: 6 } }] },
      meta: { folderUid: 'f1' },
    });
  });

  it('new dashboard: the panel, titled after it, on the chart’s time range', async () => {
    expect(await saveLens({ panel: p, destination: 'new', library: false, timeRange: range })).toEqual({
      url: '/d/d1/x',
    });
    const [dash] = api.saveDashboard.mock.calls[0];
    expect(dash).toEqual(expect.objectContaining({ title: 'Bar stacked', time: { from: 'now-7d', to: 'now' } }));
    await saveLens({ panel: p, destination: 'new', dashboardTitle: ' Ops view ', library: false, timeRange: range });
    expect(api.saveDashboard.mock.calls[1][0]).toEqual(expect.objectContaining({ title: 'Ops view' }));
    expect((dash.panels as any[])[0]).toBe(p);
    expect(api.createLibraryPanel).not.toHaveBeenCalled();
  });

  it('existing dashboard: appended below, same folder, overwrite', async () => {
    await saveLens({ panel: p, destination: 'existing', dashboardUid: 'd0', library: false, timeRange: range });
    expect(api.getDashboard).toHaveBeenCalledWith('d0');
    const [dash, opts] = api.saveDashboard.mock.calls[0];
    expect((dash.panels as any[]).map((x) => [x.id, x.gridPos.y])).toEqual([
      [7, 0],
      [8, 6],
    ]);
    expect(opts).toEqual({ folderUid: 'f1', overwrite: true });
  });

  it('library + dashboard: the dashboard references the library panel', async () => {
    await saveLens({ panel: p, destination: 'new', library: true, timeRange: range });
    const [name, model] = api.createLibraryPanel.mock.calls[0];
    expect(name).toBe('Bar stacked');
    expect(model).not.toHaveProperty('gridPos');
    expect(model).toEqual(expect.objectContaining({ type: 'timeseries', targets: p.targets }));
    const [dash] = api.saveDashboard.mock.calls[0];
    expect((dash.panels as any[])[0]).toEqual({
      id: 1,
      gridPos: p.gridPos,
      title: 'Bar stacked',
      libraryPanel: { uid: 'lib1', name: 'Bar stacked' },
    });
  });

  it('a failed dashboard save deletes the library panel just created', async () => {
    api.saveDashboard.mockRejectedValue(new Error('name taken'));
    await expect(saveLens({ panel: p, destination: 'new', library: true, timeRange: range })).rejects.toThrow(
      'name taken'
    );
    expect(api.deleteLibraryPanel).toHaveBeenCalledWith('lib1');
  });

  it('library only: no dashboard is touched', async () => {
    expect(await saveLens({ panel: p, destination: 'none', library: true, timeRange: range })).toEqual({});
    expect(api.saveDashboard).not.toHaveBeenCalled();
  });
});
