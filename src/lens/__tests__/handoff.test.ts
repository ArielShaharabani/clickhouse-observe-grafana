import { dateTime } from '@grafana/data';
import { decodeLogsState } from '../../data/urlState';
import { FieldModel } from '../../sql/fieldModel';
import { makeFilter } from '../../sql/filters';
import { fieldToColumn } from '../../components/FieldSidebar/FieldSidebar';
import { discoverColumnFields, discoverUrl, lensForField, lensForHistogram, visualizeUrl } from '../handoff';
import { decodeLens, dimLabel, LensState } from '../state';

const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };
const field = (name: string, type: FieldModel['type']): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});
const SERVICE = field('ServiceName', 'string');
const LEVEL = field('SeverityText', 'string');
const NUM = field('SeverityNumber', 'number');
const MAP = field('LogAttributes', 'map');

const range = {
  from: dateTime(Date.UTC(2026, 0, 1)),
  to: dateTime(Date.UTC(2026, 0, 8)),
  raw: { from: 'now-7d', to: 'now' },
};
const hctx = {
  search: 'ServiceName:payments',
  filters: [makeFilter('SeverityText', 'error', '=')],
  timeRange: range,
  viewId: 'otel',
};
const shape = (s: LensState) => ({
  chart: s.chartType,
  sub: s.subType,
  x: s.buckets[0] && dimLabel(s.buckets[0]),
  breakdown: s.buckets[1] && dimLabel(s.buckets[1]),
  y: s.metrics.map(dimLabel),
});
const params = (url: string) => new URLSearchParams(url.slice(url.indexOf('?') + 1));

describe('Discover → Lens: field popover Visualize', () => {
  it('builds what Visualize builds for the first field', () => {
    expect(shape(lensForField(SERVICE, ctx)!)).toEqual({
      chart: 'bar',
      sub: 'stacked',
      x: 'Top 9 values of ServiceName',
      breakdown: undefined,
      y: ['Count of records'],
    });
    expect(shape(lensForField(NUM, ctx)!).y).toEqual(['Median of SeverityNumber']);
  });

  it('has no chart for container fields', () => {
    expect(lensForField(MAP, ctx)).toBeUndefined();
  });

  it('URL keeps query, filters, time and data view, and carries the lens', () => {
    const lens = lensForField(SERVICE, ctx)!;
    const url = visualizeUrl(hctx, lens);
    expect(url).toMatch(/\/visualize\?/);
    const sp = params(url);
    const st = decodeLogsState(sp);
    expect(st.search).toBe('ServiceName:payments');
    expect(st.filters).toEqual(hctx.filters);
    expect(sp.get('from')).toBe('now-7d');
    expect(sp.get('ds')).toBe('otel');
    expect(sp.get('cols')).toBeNull();
    expect(decodeLens(sp.get('lens'))).toEqual(lens);
  });
});

describe('Discover → Lens: histogram Edit visualization (DISC-CHART-03)', () => {
  it('Bar, time horizontally, Count of records vertically', () => {
    expect(shape(lensForHistogram(ctx)!)).toEqual({
      chart: 'bar',
      sub: 'stacked',
      x: 'Timestamp',
      breakdown: undefined,
      y: ['Count of records'],
    });
  });

  it('carries the breakdown as the series split', () => {
    expect(shape(lensForHistogram(ctx, { field: 'SeverityText', label: 'SeverityText' })!)).toEqual({
      chart: 'bar',
      sub: 'stacked',
      x: 'Timestamp',
      breakdown: 'Top 9 values of SeverityText',
      y: ['Count of records'],
    });
  });

  it('needs a time field', () => {
    expect(lensForHistogram({})).toBeUndefined();
  });
});

describe('Lens → Discover: Explore in Discover (LENS-INTERACT-02)', () => {
  const lens = lensForHistogram(ctx, { field: 'SeverityText', label: 'SeverityText' })!;
  const twoTerms: LensState = {
    chartType: 'bar',
    subType: 'stacked',
    buckets: [
      { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 },
      { kind: 'terms', id: 'b2', field: 'SeverityText', label: 'SeverityText', size: 3 },
    ],
    metrics: [{ kind: 'metric', id: 'm', op: 'count', field: '', fieldLabel: 'Records', numeric: false }],
  };

  it('columns are the top-values fields in bucket order; time buckets are skipped', () => {
    expect(discoverColumnFields(lens, [SERVICE, LEVEL])).toEqual([LEVEL]);
    expect(discoverColumnFields(twoTerms, [LEVEL, SERVICE])).toEqual([SERVICE, LEVEL]);
  });

  it('skips bucket fields the data view does not have', () => {
    expect(discoverColumnFields(twoTerms, [LEVEL])).toEqual([LEVEL]);
  });

  it('URL keeps the search context and sets cols', () => {
    const url = discoverUrl(hctx, discoverColumnFields(twoTerms, [SERVICE, LEVEL]).map(fieldToColumn));
    expect(url).toMatch(/\/logs\?/);
    const st = decodeLogsState(params(url));
    expect(st.search).toBe('ServiceName:payments');
    expect(st.filters).toHaveLength(1);
    expect(st.viewId).toBe('otel');
    expect(st.columns?.map((c) => c.sqlExpr)).toEqual(['ServiceName', 'SeverityText']);
  });
});
