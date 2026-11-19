/**
 * PARITY-DASHBOARDS (Kibana comparison): Save and return from a dashboard panel, the return
 * context's validation, split-series legend names and gap filling in saved Lens panels.
 */
import { dateTime } from '@grafana/data';
import { compileLens, fillsEmptyBuckets } from '../compile';
import { buildLensPanel } from '../panelExport';
import { saveAndReturn, ReturnTarget } from '../SaveLensModal';
import {
  dashboardReturnPath,
  editInVisualizePath,
  isDashboardUid,
  isPanelId,
  panelSourceOf,
  readDashboardReturn,
  VISUALIZE_SOURCE_KEY,
} from '../panelSource';
import { dashboardFillSql } from '../interval';
import { encodeLens, LensState } from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { findDashboardPanel, PanelNotFoundError, replacePanelInDashboard } from '../../data/panelExport';
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
const range = { from: dateTime(Date.UTC(2026, 0, 1)), to: dateTime(Date.UTC(2026, 0, 8)), raw: { from: 'now-7d', to: 'now' } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];
const date = { kind: 'date_histogram' as const, id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' as const };
const service = { kind: 'terms' as const, id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const count = { kind: 'metric' as const, id: 'm0', op: 'count' as const };
const avg = { kind: 'metric' as const, id: 'm1', op: 'avg' as const, field: 'SeverityNumber', numeric: true };
const line = (buckets: LensState['buckets'], metrics: LensState['metrics'] = [count]): LensState => ({
  chartType: 'line',
  buckets,
  metrics,
});
const opts = { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } };

describe('Save and return: return context from the panel menu link', () => {
  const source = panelSourceOf({ lens: encodeLens(line([date])) });
  const target = { refId: 'A', [VISUALIZE_SOURCE_KEY]: source };
  const params = (p?: string) => new URLSearchParams(p?.split('?')[1] ?? '');

  it('carries the dashboard uid, panel id and dashboard time when valid', () => {
    const sp = params(
      editInVisualizePath({
        targets: [target],
        timeRange: { from: 'now-6h', to: 'now' },
        id: 7,
        dashboard: { uid: 'abc-DEF_1' },
      })
    );
    expect(sp.get('dash')).toBe('abc-DEF_1');
    expect(sp.get('panel')).toBe('7');
    expect([sp.get('dfrom'), sp.get('dto')]).toEqual(['now-6h', 'now']);
    expect(readDashboardReturn(sp)).toEqual({ uid: 'abc-DEF_1', panelId: 7, from: 'now-6h', to: 'now' });
  });

  it('drops a malformed uid or panel id (no Save and return then)', () => {
    for (const [uid, id] of [
      ['../admin', 7],
      ['a'.repeat(41), 7],
      ['ok', 0],
      ['ok', 1.5],
      ['ok', '7'],
      [42, 7],
    ] as Array<[unknown, unknown]>) {
      const sp = params(editInVisualizePath({ targets: [target], id, dashboard: { uid } }));
      expect(sp.has('dash')).toBe(false);
      expect(sp.get('lens')).toBeTruthy();
    }
    expect(readDashboardReturn(new URLSearchParams('dash=a/b&panel=1'))).toBeUndefined();
    expect(readDashboardReturn(new URLSearchParams('dash=ab&panel=-1'))).toBeUndefined();
    expect(readDashboardReturn(new URLSearchParams('dash=ab&panel=1e3'))).toBeUndefined();
    expect(readDashboardReturn(new URLSearchParams('dash=ab&panel=12345678901'))).toBeUndefined();
    // A hostile time string is dropped, the rest stays usable.
    expect(readDashboardReturn(new URLSearchParams('dash=ab&panel=3&dfrom=<x>&dto=now'))).toEqual({
      uid: 'ab',
      panelId: 3,
    });
    expect(isDashboardUid('x'.repeat(40))).toBe(true);
    expect(isPanelId(2 ** 31)).toBe(false);
  });

  it('returns to the dashboard path, with its time range when known', () => {
    expect(dashboardReturnPath({ uid: 'u1', panelId: 2, from: 'now-6h', to: 'now' })).toBe('/d/u1?from=now-6h&to=now');
    expect(dashboardReturnPath({ uid: 'u1', panelId: 2 })).toBe('/d/u1');
  });
});

describe('Save and return: replacing the panel in place', () => {
  const existing = {
    title: 'Ops',
    version: 4,
    time: { from: 'now-6h', to: 'now' },
    panels: [
      { id: 1, type: 'text', title: 'Notes', gridPos: { x: 0, y: 0, w: 24, h: 3 } },
      { id: 2, type: 'barchart', title: 'Errors by service', gridPos: { x: 0, y: 3, w: 8, h: 9 } },
      {
        id: 3,
        type: 'row',
        title: 'More',
        collapsed: true,
        gridPos: { x: 0, y: 12, w: 24, h: 1 },
        panels: [{ id: 4, type: 'stat', title: 'Inside', gridPos: { x: 0, y: 13, w: 6, h: 4 } }],
      },
    ],
  };

  it('keeps the id and grid position, replaces only that panel, keeps everything else', () => {
    const panel = buildLensPanel(line([date]), config, conds, range, { ...opts, title: 'Errors by service' });
    const out = replacePanelInDashboard(existing, 2, panel);
    const panels = out.panels as Array<Record<string, unknown>>;
    expect(panels).toHaveLength(3);
    expect(panels[1]).toMatchObject({ id: 2, type: 'timeseries', title: 'Errors by service', gridPos: { x: 0, y: 3, w: 8, h: 9 } });
    expect(panels[0]).toBe(existing.panels[0]);
    expect(out.version).toBe(4);
    expect(out.time).toEqual(existing.time);
  });

  it('finds panels inside collapsed rows, never a row itself', () => {
    const panel = buildLensPanel(line([date]), config, conds, range, opts);
    const out = replacePanelInDashboard(existing, 4, panel);
    const row = (out.panels as Array<{ panels?: Array<Record<string, unknown>> }>)[2];
    expect(row.panels?.[0]).toMatchObject({ id: 4, type: 'timeseries', gridPos: { x: 0, y: 13, w: 6, h: 4 } });
    expect(() => replacePanelInDashboard(existing, 3, panel)).toThrow(PanelNotFoundError);
    expect(() => replacePanelInDashboard(existing, 99, panel)).toThrow(PanelNotFoundError);
    expect(() => replacePanelInDashboard({ panels: 'nope' }, 1, panel)).toThrow(PanelNotFoundError);
    expect(findDashboardPanel(existing, 4)?.title).toBe('Inside');
    expect(findDashboardPanel(existing, 3)).toBeUndefined();
  });

  it('saves without overwrite (optimistic lock on the loaded version) and returns with the time', async () => {
    api.saveDashboard.mockResolvedValue({ uid: 'u1', url: '/d/u1/ops' });
    const target: ReturnTarget = {
      uid: 'u1',
      panelId: 2,
      from: 'now-6h',
      to: 'now',
      dashboard: existing,
      folderUid: 'f1',
      dashboardTitle: 'Ops',
      panelTitle: 'Errors by service',
      panelDescription: '',
    };
    const panel = buildLensPanel(line([date]), config, conds, range, { ...opts, title: 'Errors by service' });
    await expect(saveAndReturn(target, panel)).resolves.toBe('/d/u1?from=now-6h&to=now');
    const [saved, saveOpts] = api.saveDashboard.mock.calls[0];
    expect(saveOpts).toEqual({ folderUid: 'f1', overwrite: false });
    expect(saved.version).toBe(4);
    expect((saved.panels as unknown[]).length).toBe(3);
  });
});

describe('Saved Lens panels: split series names and empty buckets', () => {
  it('names split series by breakdown value, not "m0 <value>"', () => {
    const p = buildLensPanel(line([date, service]), config, conds, range, opts);
    expect(p.transformations?.[0]).toEqual({
      id: 'organize',
      options: { renameByName: { b0: 'Timestamp' }, excludeByName: {}, indexByName: {} },
    });
    expect(p.fieldConfig?.overrides).toEqual([
      {
        matcher: { id: 'byName', options: 'm0' },
        properties: [{ id: 'displayName', value: '${__field.labels.b1}' }],
      },
    ]);
    expect((p.fieldConfig?.defaults.custom as Record<string, unknown>).spanNulls).toBe(false);
  });

  it('several metrics: "value · metric", appearance overrides match the alias', () => {
    const colored = { ...count, color: '#ff0000', axis: 'right' as const };
    const p = buildLensPanel(line([date, service], [colored, avg]), config, conds, range, opts);
    const overrides = p.fieldConfig?.overrides as Array<{ matcher: { id: string; options: string }; properties: unknown[] }>;
    expect(overrides[0].properties).toEqual([
      { id: 'displayName', value: '${__field.labels.b1} · Count of records' },
    ]);
    expect(overrides[1].matcher).toEqual({ id: 'byName', options: 'm1' });
    expect(overrides.some((o) => o.matcher.options === 'm0' && o.properties.some((x) => (x as { id: string }).id === 'custom.axisPlacement'))).toBe(true);
  });

  it('no breakdown: the metric is renamed as before', () => {
    const p = buildLensPanel(line([date]), config, conds, range, opts);
    expect(p.transformations).toEqual([
      { id: 'organize', options: { renameByName: { b0: 'Timestamp', m0: 'Count of records' }, excludeByName: {}, indexByName: {} } },
    ]);
    expect(p.fieldConfig?.overrides).toEqual([]);
  });

  it('count charts fill empty buckets in the dashboard SQL, per breakdown value', () => {
    const { sql } = compileLens(line([date, service]), config, conds, range, 'dashboard');
    expect(sql).toMatch(
      /ORDER BY b1, (k1, )?b0 WITH FILL FROM toStartOfInterval\(\$__fromTime, INTERVAL \$__interval_s second\) TO \$__toTime STEP \$__interval_s/
    );
    const single = compileLens(line([date]), config, conds, range, 'dashboard').sql;
    expect(single).toContain('ORDER BY b0 WITH FILL FROM');
    // In-app SQL is filled client-side (shapeLensRows), unchanged.
    expect(compileLens(line([date]), config, conds, range, 'app').sql).not.toContain('WITH FILL');
  });

  it('no fill with Include empty rows off or a non-count metric; unbound fills between data', () => {
    expect(fillsEmptyBuckets(line([{ ...date, emptyRows: false }]))).toBe(false);
    expect(fillsEmptyBuckets(line([date], [avg]))).toBe(false);
    expect(fillsEmptyBuckets(line([service, date]))).toBe(false);
    expect(compileLens(line([date], [avg]), config, conds, range, 'dashboard').sql).not.toContain('WITH FILL');
    const unbound = compileLens(line([{ ...date, unbound: true }]), config, conds, range, 'dashboard').sql;
    expect(unbound).toContain('ORDER BY b0 WITH FILL STEP $__interval_s');
  });

  it('custom intervals step like their buckets', () => {
    expect(dashboardFillSql({ n: 5, unit: 'm' })).toBe(
      'WITH FILL FROM toStartOfInterval($__fromTime, INTERVAL greatest(300, $__interval_s) second) TO $__toTime STEP greatest(300, $__interval_s)'
    );
    expect(dashboardFillSql({ n: 1, unit: 'M' })).toBe(
      'WITH FILL FROM toStartOfInterval($__fromTime, INTERVAL 1 MONTH) TO $__toTime STEP INTERVAL 1 MONTH'
    );
    expect(dashboardFillSql({ n: 2, unit: 'w' }, false)).toBe('WITH FILL STEP INTERVAL 2 WEEK');
  });
});
