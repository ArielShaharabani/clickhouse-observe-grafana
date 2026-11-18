import { dateTime } from '@grafana/data';
import {
  buildContextUrl,
  contextColumns,
  discoverReturnUrl,
  formatAnchorParam,
  parseAnchorParam,
} from '../surrounding';
import { defaultColumns } from '../columns';
import { FieldModel } from '../../sql/fieldModel';
import { DEFAULT_SOURCE_CONFIG, FilterPill, OTEL_COLUMN_MAPPING, SelectedColumn, SourceConfig } from '../../types';

const cfg: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  logsTable: 'spec_logs',
  columns: { ...OTEL_COLUMN_MAPPING, spanAttributes: '' },
};
const ANCHOR = { ns: '1767603630000000000', id: '15918698468527039780' };
const timeRange = {
  from: dateTime(1767225600000),
  to: dateTime(1767916800000),
  raw: { from: dateTime(1767225600000), to: dateTime(1767916800000) },
};

describe('anchor path segment', () => {
  it('round-trips', () => {
    expect(parseAnchorParam(formatAnchorParam(ANCHOR))).toEqual(ANCHOR);
  });
  it.each(['', '1', '1_2_3', 'a_b', '1_2;DROP', '-1_2', '1_ 2', '%31_2'])('rejects %p', (raw) => {
    expect(parseAnchorParam(raw)).toBeNull();
  });
  it('rejects null / undefined', () => {
    expect(parseAnchorParam(undefined)).toBeNull();
    expect(parseAnchorParam(null)).toBeNull();
  });
});

describe('buildContextUrl', () => {
  const filters: FilterPill[] = [
    { id: 'a', field: 'ServiceName', op: '=', value: 'payments' },
    { id: 'b', field: 'SeverityText', op: '=', value: 'error', pinned: true },
  ];

  it('carries filters disabled, drops the query, keeps columns and the return URL', () => {
    const url = buildContextUrl({
      viewId: 'spec-fixture',
      anchor: ANCHOR,
      filters,
      columns: defaultColumns(cfg),
      timeRange,
      ret: 'q=hello&ds=spec-fixture',
      disableFilters: true,
    });
    expect(url.startsWith('/a/poortuna-clickhouse-observe-app/context/spec-fixture/1767603630000000000_15918698468527039780?')).toBe(true);
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(sp.get('q')).toBeNull();
    const carried = JSON.parse(sp.get('filters')!);
    expect(carried.map((f: FilterPill) => f.disabled)).toEqual([true, true]);
    expect(carried[1].pinned).toBe(true);
    expect(JSON.parse(sp.get('cols')!).length).toBe(4);
    expect(sp.get('ret')).toBe('q=hello&ds=spec-fixture');
    expect(sp.get('from')).toBe('1767225600000');
  });

  it('keeps filter state as-is on a re-anchor', () => {
    const url = buildContextUrl({ viewId: 'v', anchor: ANCHOR, filters, columns: [], timeRange, ret: '' });
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(JSON.parse(sp.get('filters')!).map((f: FilterPill) => !!f.disabled)).toEqual([false, false]);
    expect(sp.get('ret')).toBeNull();
  });

  it('encodes the view id', () => {
    const url = buildContextUrl({ viewId: 'a/b?c', anchor: ANCHOR, filters: [], columns: [], timeRange, ret: '' });
    expect(url).toContain('/context/a%2Fb%3Fc/');
  });
});

describe('discoverReturnUrl', () => {
  it('returns to Discover with the original query string', () => {
    expect(discoverReturnUrl('q=a&filters=%5B%5D')).toBe('/a/poortuna-clickhouse-observe-app/logs?q=a&filters=%5B%5D');
  });
  it('without ret goes to plain Discover', () => {
    expect(discoverReturnUrl(null)).toBe('/a/poortuna-clickhouse-observe-app/logs');
  });
  it.each(['//evil.example/x', 'https://evil.example', '/../../admin', 'javascript:alert(1)'])(
    'never leaves the logs route (%p)',
    (ret) => {
      const url = discoverReturnUrl(ret);
      expect(url.startsWith('/a/poortuna-clickhouse-observe-app/logs?')).toBe(true);
      expect(url.split('?')[0]).toBe('/a/poortuna-clickhouse-observe-app/logs');
    }
  );
});

describe('contextColumns (URL columns are untrusted)', () => {
  const fields: FieldModel[] = [
    {
      id: 'map:LogAttributes:http.status_code',
      name: 'http.status_code',
      displayName: 'http.status_code',
      sqlExpr: "LogAttributes['http.status_code']",
      type: 'string',
      source: 'map',
      mapColumn: 'LogAttributes',
    } as FieldModel,
  ];

  it('defaults when the URL has no columns', () => {
    expect(contextColumns(undefined, fields, cfg)).toEqual(defaultColumns(cfg));
    expect(contextColumns([], fields, cfg)).toEqual(defaultColumns(cfg));
  });

  it('rebuilds columns from trusted sources, ignoring the URL sqlExpr / key', () => {
    const hostile: SelectedColumn[] = [
      { id: 'timestamp', key: '__timestamp', sqlExpr: 'evil()', displayName: 'Time', type: 'time', isCore: true },
      {
        id: 'map:LogAttributes:http.status_code',
        key: 'x FROM system.users --',
        sqlExpr: '(SELECT password FROM system.users)',
        displayName: 'status',
        type: 'exact',
        isCore: false,
      },
    ];
    const cols = contextColumns(hostile, fields, cfg);
    expect(cols.map((c) => c.sqlExpr)).toEqual(['Timestamp', "LogAttributes['http.status_code']"]);
    expect(cols[1].key).toBe('fld_map_LogAttributes_http_status_code');
  });

  const withMap: FieldModel[] = [
    { id: 'col:LogAttributes', name: 'LogAttributes', displayName: 'LogAttributes', sqlExpr: 'LogAttributes', type: 'map', source: 'column' },
  ];
  const mapCol = (sqlExpr: string, extra: Partial<SelectedColumn> = {}): SelectedColumn => ({
    id: 'map:LogAttributes:http.method',
    key: 'evil key',
    sqlExpr,
    displayName: 'http.method',
    type: 'json',
    isCore: false,
    ...extra,
  });

  it('keeps a Map key column (keys are discovered on demand) with a rebuilt key and type', () => {
    const cols = contextColumns([mapCol("LogAttributes['http.method']")], withMap, cfg);
    expect(cols).toEqual([
      {
        id: 'map:LogAttributes:http.method',
        key: 'fld_map_LogAttributes_http_method',
        sqlExpr: "LogAttributes['http.method']",
        displayName: 'http.method',
        type: 'exact',
        isCore: false,
      },
    ]);
  });

  it.each([
    "LogAttributes['x'] FROM system.users --",
    "LogAttributes['x']) OR (1=1",
    "LogAttributes['x\\']",
    "Other['x']",
    "(SELECT 1)['x']",
    'LogAttributes',
  ])('drops a non-accessor or unknown Map root: %p', (expr) => {
    expect(contextColumns([mapCol(expr)], withMap, cfg)).toEqual(defaultColumns(cfg));
  });

  it('drops unknown columns and duplicates; falls back to defaults when none remain', () => {
    const junk = [
      { id: 'nope', key: 'k', sqlExpr: 'evil()', displayName: 'n', type: 'exact', isCore: false },
      { id: 'evilcore', key: 'k', sqlExpr: 'evil()', displayName: 'n', type: 'exact', isCore: true },
      null,
    ] as unknown as SelectedColumn[];
    expect(contextColumns(junk, fields, cfg)).toEqual(defaultColumns(cfg));
    const dup = [defaultColumns(cfg)[0], defaultColumns(cfg)[0]];
    expect(contextColumns(dup, fields, cfg)).toHaveLength(1);
  });
});
