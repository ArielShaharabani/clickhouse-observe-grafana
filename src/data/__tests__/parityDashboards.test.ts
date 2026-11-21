/**
 * PARITY-DASHBOARDS: Discover's exported panels (columns, names, Open in Discover, `$` escaping,
 * legend), dashboard time, save errors, short links.
 */
import { dateTime } from '@grafana/data';
import {
  buildHistogramPanel,
  buildNewDashboard,
  buildTablePanel,
  dashboardTime,
  escapeDollarInLiterals,
  EXPORT_TABLE_LIMIT,
  tableDescription,
} from '../panelExport';
import { DISCOVER_SOURCE_KEY, discoverSourceOf, MAX_DISCOVER_SOURCE_LEN, openInDiscoverPath } from '../discoverSource';
import { dashboardSaveError } from '../dashboards';
import { relativeGrafanaPath, shortenUrl, validShortUrl } from '../shortUrl';
import { buildShareUrl, VISUALIZE_SHAREABLE_PARAMS } from '../shareLink';
import { defaultColumns } from '../columns';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SelectedColumn, SourceConfig } from '../../types';

const mockPost = jest.fn();
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ post: mockPost, get: jest.fn() }),
  config: { appSubUrl: '' },
}));

const config: SourceConfig = {
  datasourceUid: 'ds-uid-1',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: OTEL_COLUMN_MAPPING,
};
const opts = { id: 1, gridPos: { x: 0, y: 0, w: 24, h: 12 } };

describe('Discover logs panel', () => {
  const columns = defaultColumns(config);
  const extra: SelectedColumn = {
    id: 'TraceFlags',
    key: 'c_TraceFlags',
    sqlExpr: 'TraceFlags',
    displayName: 'TraceFlags',
    type: 'exact',
    isCore: false,
  };

  it("keeps Discover's columns, in order, with Discover's names", () => {
    const state = { ...DEFAULT_LOGS_QUERY_STATE, columns: [...columns, extra] };
    const p = buildTablePanel(config, state, { ...opts, title: '  Payment errors ' });
    expect(p.title).toBe('Payment errors');
    expect(p.targets[0].rawSql).not.toMatch(/SELECT \*/);
    expect(p.targets[0].rawSql).toContain('AS __body');
    const organize = p.transformations?.[0];
    expect(organize?.id).toBe('organize');
    const o = organize?.options as {
      indexByName: Record<string, number>;
      renameByName: Record<string, string>;
      excludeByName: Record<string, boolean>;
    };
    const order = Object.entries(o.indexByName)
      .sort((a, b) => a[1] - b[1])
      .map(([k]) => o.renameByName[k]);
    expect(order).toEqual([...columns.map((c) => c.displayName), 'TraceFlags']);
    expect(order.slice(0, 4)).toEqual(['Time', 'Level', 'Service', 'Message']);
    // Core values Discover doesn't show are hidden.
    expect(o.excludeByName.__traceId).toBe(true);
    expect(o.excludeByName.__body).toBeUndefined();
    // Round 2 #3: no row-count footer (a capped query read as the total); pagination; the cap is
    // stated in the description and the query holds EXPORT_TABLE_LIMIT rows. The message wraps.
    expect(p.options?.footer).toBeUndefined();
    expect(p.options?.enablePagination).toBe(true);
    expect(p.description).toContain('1,000');
    expect(p.targets[0].rawSql).toContain(`LIMIT ${EXPORT_TABLE_LIMIT}`);
    expect(JSON.stringify(p.fieldConfig?.overrides)).toContain('"wrapText":true');
  });

  it('R4-DASH: a capped table says so with the true count, in its default title and description', () => {
    expect(tableDescription(1207)).toContain('1,207 documents matched');
    expect(tableDescription(1207)).toContain('newest 1,000');
    expect(tableDescription(undefined)).toContain('newest 1,000');
    const state = { ...DEFAULT_LOGS_QUERY_STATE, columns: defaultColumns(config) };
    const gp = { x: 0, y: 0, w: 24, h: 12 };
    expect(buildTablePanel(config, state, { id: 1, gridPos: gp, totalDocs: 1207 }).title).toBe('Logs (newest 1,000)');
    expect(buildTablePanel(config, state, { id: 1, gridPos: gp, totalDocs: 40 }).title).toBe('Logs');
    expect(buildTablePanel(config, state, { id: 1, gridPos: gp, title: 'Mine', totalDocs: 1207 }).title).toBe('Mine');
  });

  it('stores the Discover search for Open in Discover', () => {
    const source = discoverSourceOf(new URLSearchParams('q=error&from=now-1h&to=now&ds=v1&cols=%5B%5D&traceId=t'));
    expect(source).toBe('q=error&cols=%5B%5D&ds=v1');
    const p = buildTablePanel(config, { ...DEFAULT_LOGS_QUERY_STATE, columns }, { ...opts, source });
    expect(p.targets[0][DISCOVER_SOURCE_KEY]).toBe(source);
    expect(buildTablePanel(config, DEFAULT_LOGS_QUERY_STATE, opts).targets[0]).not.toHaveProperty(DISCOVER_SOURCE_KEY);
  });

  it('raw SQL mode / no columns: SELECT * with no column layout', () => {
    const p = buildTablePanel(config, DEFAULT_LOGS_QUERY_STATE, opts);
    expect(p.targets[0].rawSql).toMatch(/SELECT \*/);
    expect(p.transformations).toBeUndefined();
  });

  it('escapes $ inside literals so Grafana never interpolates a searched value', () => {
    const state = { ...DEFAULT_LOGS_QUERY_STATE, columns, search: '"$__toTime ${var}"' };
    const sql = buildTablePanel(config, state, opts).targets[0].rawSql;
    expect(sql).toContain('$__fromTime'); // our macros stay
    expect(sql).not.toMatch(/'[^']*\$[^']*'/);
    expect(sql).toContain('\\x24__toTime');
  });
});

describe('escapeDollarInLiterals', () => {
  it('only touches quoted text and keeps escapes intact', () => {
    expect(escapeDollarInLiterals("SELECT $__fromTime, '$a', \"$b\", `$c`")).toBe(
      "SELECT $__fromTime, '\\x24a', \"\\x24b\", `\\x24c`"
    );
    expect(escapeDollarInLiterals("x = 'it''s $1' AND $__toTime")).toBe("x = 'it''s \\x241' AND $__toTime");
    expect(escapeDollarInLiterals("x = 'a\\'$' AND y = '\\$'")).toBe("x = 'a\\'\\x24' AND y = '\\x24'");
  });
});

describe('Discover volume panel', () => {
  it('legend shows the level, not "count <level>"', () => {
    const p = buildHistogramPanel(config, DEFAULT_LOGS_QUERY_STATE, { kind: 'severity' } as never, opts);
    expect(p.fieldConfig?.overrides).toEqual([
      { matcher: { id: 'byName', options: 'count' }, properties: [{ id: 'displayName', value: '${__field.labels.level}' }] },
    ]);
    const none = buildHistogramPanel(config, DEFAULT_LOGS_QUERY_STATE, { kind: 'none' }, opts);
    expect(JSON.stringify(none.fieldConfig?.overrides)).toContain('"value":"Count"');
  });
});

describe('Open in Discover (panel menu)', () => {
  const target = (v: unknown) => ({ refId: 'A', [DISCOVER_SOURCE_KEY]: v });
  it('reopens Discover with the stored search and the dashboard time', () => {
    const path = openInDiscoverPath({
      targets: [target('q=error&filters=%5B%5D&ds=v1&evil=1&from=0&to=1')],
      timeRange: { from: 'now-6h', to: 'now' },
    });
    expect(path).toBe('/a/poortuna-clickhouse-observe-app/logs?q=error&filters=%5B%5D&ds=v1&from=now-6h&to=now');
  });
  it('is hidden for other panels and oversized / non-string values', () => {
    expect(openInDiscoverPath({ targets: [{ refId: 'A' }] })).toBeUndefined();
    expect(openInDiscoverPath({ targets: [target(5)] })).toBeUndefined();
    expect(openInDiscoverPath({ targets: [target('q='.padEnd(MAX_DISCOVER_SOURCE_LEN + 1, 'x'))] })).toBeUndefined();
    expect(openInDiscoverPath({ targets: [target('')] })).toBe('/a/poortuna-clickhouse-observe-app/logs');
  });
  it('drops a hostile time string', () => {
    const p = openInDiscoverPath({ targets: [target('q=a')], timeRange: { from: 'javascript:alert(1)<', to: 'now' } });
    expect(p).toBe('/a/poortuna-clickhouse-observe-app/logs?q=a');
  });
});

describe('New dashboards open on the page time range', () => {
  it('keeps relative strings, else ISO', () => {
    const rel = { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-7d', to: 'now' } };
    expect(dashboardTime(rel)).toEqual({ from: 'now-7d', to: 'now' });
    const abs = { from: dateTime(Date.UTC(2026, 0, 5, 8)), to: dateTime(Date.UTC(2026, 0, 5, 12)) };
    expect(dashboardTime({ ...abs, raw: abs })).toEqual({ from: '2026-01-05T08:00:00.000Z', to: '2026-01-05T12:00:00.000Z' });
    expect(buildNewDashboard([], 'X', { from: 'a', to: 'b' }).time).toEqual({ from: 'a', to: 'b' });
    expect(buildNewDashboard([], 'X').time).toEqual({ from: 'now-1h', to: 'now' });
  });
});

describe('dashboardSaveError', () => {
  it('explains version and name conflicts', () => {
    expect(dashboardSaveError({ status: 412, data: { status: 'version-mismatch' } })).toMatch(/changed this dashboard/);
    expect(dashboardSaveError({ status: 412, data: { status: 'name-exists' } }, 'Ops')).toMatch(/named "Ops" already exists/);
    expect(dashboardSaveError({ status: 404, data: {} })).toMatch(/no longer exists/);
    expect(dashboardSaveError({ status: 500, data: { message: 'boom' } })).toBe('boom');
    expect(dashboardSaveError(new Error('x'))).toBe('x');
  });
});

describe('short links', () => {
  const origin = 'http://grafana.local:3000';
  beforeEach(() => mockPost.mockReset());

  it('relative path under the root (and sub-path)', () => {
    expect(relativeGrafanaPath(`${origin}/a/app/logs?q=1`, origin)).toBe('a/app/logs?q=1');
    expect(relativeGrafanaPath(`${origin}/g/a/app/logs?q=1`, origin, '/g')).toBe('a/app/logs?q=1');
    expect(relativeGrafanaPath(`${origin}/other/a`, origin, '/g')).toBeUndefined();
    expect(relativeGrafanaPath('http://evil.example/a', origin)).toBeUndefined();
    expect(relativeGrafanaPath('not a url', origin)).toBeUndefined();
  });

  it('accepts only /goto/ responses, rebuilt on this origin', () => {
    expect(validShortUrl({ url: `${origin}/goto/abc_1?orgId=1` }, origin)).toBe(`${origin}/goto/abc_1`);
    expect(validShortUrl({ url: `${origin}/goto/../admin` }, origin)).toBeUndefined();
    expect(validShortUrl({ url: `${origin}/goto/abc_1` }, origin)).toBe(`${origin}/goto/abc_1`);
    expect(validShortUrl({ url: 'http://localhost:3000/goto/abc?orgId=1' }, origin)).toBe(`${origin}/goto/abc`);
    expect(validShortUrl({ url: `${origin}/goto/abc?orgId=2` }, origin)).toBe(`${origin}/goto/abc?orgId=2`);
    expect(validShortUrl({ url: 'http://evil.example/admin' }, origin)).toBeUndefined();
    expect(validShortUrl({ url: 'javascript:alert(1)' }, origin)).toBeUndefined();
    expect(validShortUrl({}, origin)).toBeUndefined();
  });

  it('posts the relative path and falls back to the full URL on error', async () => {
    const here = window.location.origin;
    mockPost.mockResolvedValueOnce({ uid: 'u', url: `${here}/goto/u` });
    await expect(shortenUrl(`${here}/a/app/logs?q=1`)).resolves.toBe(`${here}/goto/u`);
    expect(mockPost).toHaveBeenCalledWith('/api/short-urls', { path: 'a/app/logs?q=1' }, { showErrorAlert: false });
    mockPost.mockRejectedValueOnce(new Error('down'));
    await expect(shortenUrl(`${here}/a/app/logs?q=2`)).resolves.toBe(`${here}/a/app/logs?q=2`);
    await expect(shortenUrl('http://evil.example/x')).resolves.toBe('http://evil.example/x');
  });
});

describe('Visualize share link', () => {
  it('keeps the chart and the search context only', () => {
    const tr = { from: dateTime(5), to: dateTime(9), raw: { from: 'now-1h', to: 'now' } };
    const href = 'http://g/a/app/visualize?lens=L&q=x&ds=v&from=now-1h&to=now&dash=u&panel=2&dfrom=a&dto=b';
    const url = new URL(buildShareUrl(href, tr, true, VISUALIZE_SHAREABLE_PARAMS));
    expect([...url.searchParams.keys()]).toEqual(['lens', 'q', 'from', 'to', 'ds']);
    expect(url.searchParams.get('from')).toBe('5');
  });
});
