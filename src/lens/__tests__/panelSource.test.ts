import { dateTime } from '@grafana/data';
import { editInVisualizePath, MAX_SOURCE_LEN, panelSourceOf, VISUALIZE_SOURCE_KEY } from '../panelSource';
import { buildLensPanel } from '../panelExport';
import { encodeLens, LensState } from '../state';
import { DEFAULT_SOURCE_CONFIG } from '../../types';

const lens: LensState = {
  chartType: 'bar',
  buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 5 }],
  metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
};
const source = panelSourceOf({
  lens: encodeLens(lens),
  search: 'SeverityText:error',
  filters: '[{"field":"ServiceName","op":"=","value":"auth"}]',
  viewId: 'spec-fixture',
});
const target = (v: unknown) => ({ refId: 'A', [VISUALIZE_SOURCE_KEY]: v });
const params = (path: string | undefined) => new URLSearchParams(path?.split('?')[1] ?? '');

describe('Edit in Visualize (panel source)', () => {
  it('the exported panel target carries the source; panels without it have none', () => {
    const tr = { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } };
    const opts = { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } };
    const withSrc = buildLensPanel(lens, DEFAULT_SOURCE_CONFIG, [], tr, { ...opts, source });
    expect(withSrc.targets[0][VISUALIZE_SOURCE_KEY]).toBe(source);
    expect(buildLensPanel(lens, DEFAULT_SOURCE_CONFIG, [], tr, opts).targets[0]).not.toHaveProperty(VISUALIZE_SOURCE_KEY);
  });

  it('builds the Visualize path with the chart, query, filters, view and the dashboard time', () => {
    const p = editInVisualizePath({ targets: [target(source)], timeRange: { from: 'now-7d', to: 'now' } });
    expect(p).toMatch(/^\/a\/[^/]+\/visualize\?/);
    const sp = params(p);
    expect(JSON.parse(sp.get('lens')!)).toEqual(lens);
    expect(sp.get('q')).toBe('SeverityText:error');
    expect(sp.get('filters')).toContain('auth');
    expect(sp.get('ds')).toBe('spec-fixture');
    expect([sp.get('from'), sp.get('to')]).toEqual(['now-7d', 'now']);
    const abs = params(editInVisualizePath({ targets: [target(source)], timeRange: { from: dateTime(5), to: dateTime(9) } }));
    expect([abs.get('from'), abs.get('to')]).toEqual(['5', '9']);
  });

  it('is hidden on panels that did not come from Visualize', () => {
    expect(editInVisualizePath({ targets: [{ refId: 'A' }] })).toBeUndefined();
    expect(editInVisualizePath({ targets: [] })).toBeUndefined();
    expect(editInVisualizePath({})).toBeUndefined();
    expect(editInVisualizePath({ targets: [target(42)] })).toBeUndefined();
    expect(editInVisualizePath({ targets: [target('q=x')] })).toBeUndefined(); // no chart
  });

  it('untrusted stored values: only known parameters pass, oversize is refused, nothing escapes the path', () => {
    const hostile = `${source}&_tab=x&cols=%5B%5D&redirect=https%3A%2F%2Fevil.example&from=0&to=1`;
    const sp = params(editInVisualizePath({ targets: [target(hostile)] }));
    expect([...sp.keys()].sort()).toEqual(['ds', 'filters', 'lens', 'q']);
    expect(editInVisualizePath({ targets: [target(`lens=${'x'.repeat(MAX_SOURCE_LEN)}`)] })).toBeUndefined();
    const odd = editInVisualizePath({ targets: [target('lens=%2F%2Fevil.example%3F&ds=..%2F..%2Fadmin')] });
    expect(odd).toMatch(/^\/a\/[^/]+\/visualize\?lens=/);
    expect(odd).not.toContain('/admin');
  });
});
