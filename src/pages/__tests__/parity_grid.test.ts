/**
 * PARITY-GRID (Kibana comparison): pure logic behind the grid / document panel fixes — document
 * navigation across loaded rows, column widths (reducer + URL sanitizer), no duplicate Body
 * column, explicit header-menu sort, ISO time in the JSON view, and the single-document permalink.
 */
import { dateTime } from '@grafana/data';
import { docNavTargets, knownTotal, LOAD_MORE_CHUNK, pageOfIndex } from '../_docNav';
import { logsQueryReducer } from '../_logsQueryReducer';
import { discoverWithFilter } from '../SingleDocView';
import { clampColumnWidth, defaultColumns, sanitizeColumns, stripColumnWidths } from '../../data/columns';
import { buildSingleDocUrl, parseAnchorParam } from '../../data/surrounding';
import { decodeLogsState, encodeLogsState } from '../../data/urlState';
import { buildDocumentByAnchorQuery, CORE_ALIAS } from '../../sql/queryBuilder';
import { toIsoTimestamp, withIsoTimestamps } from '../../utils/isoTime';
import {
  DEFAULT_LOGS_QUERY_STATE,
  DEFAULT_SOURCE_CONFIG,
  LogsQueryState,
  OTEL_COLUMN_MAPPING,
  SelectedColumn,
  SourceConfig,
} from '../../types';

const cfg: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  logsTable: 'spec_logs',
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, spanAttributes: '' },
};
const col = (id: string, over: Partial<SelectedColumn> = {}): SelectedColumn => ({
  id,
  key: `fld_${id}`,
  sqlExpr: id,
  displayName: id,
  type: 'string',
  isCore: false,
  ...over,
});
const base: LogsQueryState = { ...DEFAULT_LOGS_QUERY_STATE };
const ANCHOR = { ns: '1767603630000000000', id: '15918698468527039780' };
const timeRange = {
  from: dateTime(1767225600000),
  to: dateTime(1767916800000),
  raw: { from: dateTime(1767225600000), to: dateTime(1767916800000) },
};

describe('R2-GRID total and load-more', () => {
  it('labels the open document against the known total', () => {
    expect(docNavTargets(0, 200, true, 1207).label).toBe('1 of 1,207');
    expect(docNavTargets(0, 200, true).label).toBe('1 of 200');
    // A total below the loaded rows is stale: fall back to the loaded count.
    expect(docNavTargets(0, 200, true, 150).label).toBe('1 of 200');
  });
  it('knownTotal trusts the histogram count only when it is usable', () => {
    const ok = { hasHistogram: true, rawSql: false, volLoading: false, histogramCount: 1207, loaded: 200 };
    expect(knownTotal(ok)).toBe(1207);
    expect(knownTotal({ ...ok, hasHistogram: false })).toBeUndefined();
    expect(knownTotal({ ...ok, rawSql: true })).toBeUndefined();
    expect(knownTotal({ ...ok, volLoading: true })).toBeUndefined();
    expect(knownTotal({ ...ok, histogramCount: 0 })).toBeUndefined();
    expect(knownTotal({ ...ok, histogramCount: 150 })).toBeUndefined();
  });
  it('load-more fetches a bigger chunk', () => {
    expect(LOAD_MORE_CHUNK).toBe(200);
  });
});

describe('document navigation across every loaded row', () => {
  it('pages past the grid page: 50 of 200 still has a next document', () => {
    const t = docNavTargets(49, 200, false);
    expect(t).toEqual({ prev: 48, next: 50, first: 0, last: 199, label: '50 of 200' });
  });
  it('offers "next" past the last loaded row only when more can be fetched', () => {
    expect(docNavTargets(199, 200, true).next).toBe(200);
    expect(docNavTargets(199, 200, false).next).toBeNull();
    expect(docNavTargets(199, 200, true).last).toBeNull();
  });
  it('first document has no prev / first', () => {
    expect(docNavTargets(0, 3, false)).toMatchObject({ prev: null, first: null, next: 1, last: 2, label: '1 of 3' });
  });
  it('a document outside the loaded rows has no navigation', () => {
    expect(docNavTargets(-1, 3, true)).toEqual({ prev: null, next: null, first: null, last: null });
  });
  it('maps a row index to its grid page', () => {
    expect(pageOfIndex(0, 50)).toBe(0);
    expect(pageOfIndex(50, 50)).toBe(1);
    expect(pageOfIndex(499, 50)).toBe(9);
  });
});

describe('column widths', () => {
  it('SET_COLUMN_WIDTH sets, clamps and resets a width', () => {
    const cols = [col('a'), col('b')];
    const set = logsQueryReducer(base, { type: 'SET_COLUMN_WIDTH', id: 'b', width: 333.4, columns: cols });
    expect(set.columns[1].width).toBe(333);
    const huge = logsQueryReducer(base, { type: 'SET_COLUMN_WIDTH', id: 'b', width: 99999, columns: cols });
    expect(huge.columns[1].width).toBe(1200);
    const reset = logsQueryReducer(base, { type: 'SET_COLUMN_WIDTH', id: 'b', width: undefined, columns: set.columns });
    expect(reset.columns[1]).not.toHaveProperty('width');
    expect(logsQueryReducer(base, { type: 'SET_COLUMN_WIDTH', id: 'zz', width: 100, columns: cols })).toBe(base);
  });
  it('clampColumnWidth accepts only finite numbers', () => {
    expect(clampColumnWidth(10)).toBe(60);
    expect(clampColumnWidth('300')).toBeUndefined();
    expect(clampColumnWidth(NaN)).toBeUndefined();
    expect(clampColumnWidth(Infinity)).toBeUndefined();
  });
  it('sanitizeColumns keeps a clamped width and nothing else from an untrusted entry', () => {
    const fromUrl = [
      { ...defaultColumns(cfg)[0], width: 250 },
      { ...defaultColumns(cfg)[1], width: '1e9; DROP' },
      { ...defaultColumns(cfg)[2], width: 5 },
    ];
    const out = sanitizeColumns(fromUrl, cfg);
    expect(out.map((c) => c.width)).toEqual([250, undefined, 60]);
  });
  it('widths survive a URL round trip', () => {
    const cols = [{ ...defaultColumns(cfg)[0], width: 222 }];
    const sp = encodeLogsState({ search: '', filters: [], columns: cols, timeRange });
    expect(sanitizeColumns(decodeLogsState(sp).columns, cfg)[0].width).toBe(222);
  });
  it('stripColumnWidths drops only the width (queries never see it)', () => {
    const stripped = stripColumnWidths([col('a', { width: 100 }), col('b')]);
    expect(stripped[0]).toEqual(col('a'));
    expect(stripped[1]).toEqual(col('b'));
  });
});

describe('header menu sort and duplicate columns', () => {
  it('SET_SORT with an explicit direction uses it; without one it toggles', () => {
    const asc = logsQueryReducer(base, { type: 'SET_SORT', col: 'fld_a', dir: 'asc' });
    expect(asc.sort).toEqual({ col: 'fld_a', dir: 'asc' });
    expect(logsQueryReducer(asc, { type: 'SET_SORT', col: 'fld_a', dir: 'asc' }).sort?.dir).toBe('asc');
    expect(logsQueryReducer(base, { type: 'SET_SORT', col: 'fld_a' }).sort?.dir).toBe('desc');
  });
  it('does not add the Body field while the core Message column already shows Body', () => {
    const cols = defaultColumns(cfg);
    const body = col('col:Body', { sqlExpr: cfg.columns.body });
    expect(logsQueryReducer(base, { type: 'ADD_COLUMN', col: body, columns: cols })).toBe(base);
  });
  it('still adds the raw time column next to the core Time column (converted time fields)', () => {
    const cols = defaultColumns(cfg);
    const ts = col('col:Timestamp', { sqlExpr: cfg.columns.timestamp });
    expect(logsQueryReducer(base, { type: 'ADD_COLUMN', col: ts, columns: cols }).columns).toHaveLength(cols.length + 1);
  });
});

describe('ISO time in the document JSON', () => {
  it('converts epoch ms and ClickHouse DateTime text, keeping sub-ms precision', () => {
    expect(toIsoTimestamp(1767603630123)).toBe('2026-01-05T09:00:30.123Z');
    expect(toIsoTimestamp('2026-01-05 09:00:30.123456789')).toBe('2026-01-05T09:00:30.123456789Z');
    expect(toIsoTimestamp('2026-01-05 09:00:30')).toBe('2026-01-05T09:00:30Z');
    expect(toIsoTimestamp('not a time')).toBe('not a time');
  });
  it('rewrites only the named time keys', () => {
    const row = { Timestamp: 0, Count: 5, [CORE_ALIAS.timestamp]: 1000 };
    expect(withIsoTimestamps(row, ['Timestamp', CORE_ALIAS.timestamp, undefined])).toEqual({
      Timestamp: '1970-01-01T00:00:00.000Z',
      Count: 5,
      [CORE_ALIAS.timestamp]: '1970-01-01T00:00:01.000Z',
    });
  });
});

describe('single-document permalink', () => {
  it('builds doc/<view>/<ns>_<id> with time and the return context', () => {
    const url = buildSingleDocUrl({ viewId: 'spec fixture', anchor: ANCHOR, timeRange, ret: 'q=a' });
    const [path, qs] = url.split('?');
    expect(path.endsWith(`/doc/spec%20fixture/${ANCHOR.ns}_${ANCHOR.id}`)).toBe(true);
    const sp = new URLSearchParams(qs);
    expect(sp.get('ret')).toBe('q=a');
    expect(sp.get('from')).toBeTruthy();
    expect(parseAnchorParam(path.split('/').pop())).toEqual(ANCHOR);
  });
  it('the lookup selects the whole row by the validated anchor only', () => {
    const sql = buildDocumentByAnchorQuery(cfg, ANCHOR);
    expect(sql).toContain('SELECT *');
    expect(sql).toContain(`fromUnixTimestamp64Nano(${ANCHOR.ns})`);
    expect(sql).toContain(`= ${ANCHOR.id}`);
    expect(sql).toContain('LIMIT 1');
  });
  it('refuses malformed anchors and views without time', () => {
    expect(buildDocumentByAnchorQuery(cfg, { ns: '1; DROP TABLE x', id: '1' })).toBe('');
    expect(buildDocumentByAnchorQuery(cfg, { ns: '1', id: '-1' })).toBe('');
    expect(buildDocumentByAnchorQuery({ ...cfg, columns: { ...cfg.columns, timestamp: '' } }, ANCHOR)).toBe('');
  });
  it('a filter from the single document returns to Discover with it (sanitized)', () => {
    const ret = new URLSearchParams({ q: 'x', filters: '[{"bogus":true}]' }).toString();
    const url = discoverWithFilter(ret, { id: 'f', field: 'ServiceName', op: '=', value: 'payments' });
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(url.split('?')[0].endsWith('/logs')).toBe(true);
    expect(sp.get('q')).toBe('x');
    expect(JSON.parse(sp.get('filters')!)).toEqual([expect.objectContaining({ field: 'ServiceName', value: 'payments' })]);
  });
});
