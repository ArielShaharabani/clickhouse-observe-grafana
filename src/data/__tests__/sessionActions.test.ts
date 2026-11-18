/**
 * DISC-SESSION-01: CSV export (quoting + formula-injection guard), share links (codec params only,
 * absolute toggle), unsaved-changes detection, alert rule defaults (count query, `$` escaping).
 */
import { dateTime, TimeRange } from '@grafana/data';
import { csvCellText, csvEscape, csvFileName, rowsToCsv } from '../csvExport';
import { buildShareUrl, hasUnsavedChanges, isRelativeRange } from '../shareLink';
import { alertWindowSeconds, buildAlertRuleDefaults, buildAlertRuleUrl } from '../alertRule';
import { buildAlertCountQuery, escapeDollarInLiterals } from '../../sql/alertQuery';
import {
  DEFAULT_LOGS_QUERY_STATE,
  FilterPill,
  OTEL_COLUMN_MAPPING,
  SavedSearch,
  SelectedColumn,
  SourceConfig,
} from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds-uid-1',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: OTEL_COLUMN_MAPPING,
};

function range(from: string | number, to: string | number): TimeRange {
  const f = typeof from === 'number' ? dateTime(from) : dateTime(1_700_000_000_000);
  const t = typeof to === 'number' ? dateTime(to) : dateTime(1_700_000_900_000);
  return { from: f, to: t, raw: { from: typeof from === 'number' ? f : from, to: typeof to === 'number' ? t : to } };
}

describe('csvExport', () => {
  it('guards spreadsheet formulas', () => {
    for (const v of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) {
      expect(csvEscape(v).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
    expect(csvEscape('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"');
    expect(csvEscape('plain')).toBe('plain');
  });

  it('quotes commas, quotes, newlines and edge whitespace (RFC 4180)', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
    expect(csvEscape(' padded ')).toBe('" padded "');
  });

  it('formats cells by column type', () => {
    expect(csvCellText({ type: 'time' }, 0)).toBe('1970-01-01T00:00:00.000Z');
    expect(csvCellText({ type: 'time' }, '2026-01-01 00:00:00')).toBe('2026-01-01 00:00:00');
    expect(csvCellText({ type: 'map' }, { a: 1 })).toBe('{"a":1}');
    expect(csvCellText({ type: 'text' }, null)).toBe('');
    expect(csvCellText({ type: 'number' }, 42)).toBe('42');
  });

  it('builds header + rows with CRLF endings in column order', () => {
    const cols: Array<Pick<SelectedColumn, 'key' | 'displayName' | 'type'>> = [
      { key: 'b', displayName: 'Body', type: 'text' },
      { key: 'n', displayName: 'Count', type: 'number' },
    ];
    const csv = rowsToCsv(cols, [
      { b: '=evil()', n: 1 },
      { b: 'ok, fine', n: 2 },
    ]);
    expect(csv).toBe('Body,Count\r\n\'=evil(),1\r\n"ok, fine",2\r\n');
  });

  it('makes a filesystem-safe file name', () => {
    expect(csvFileName('OTel demo / logs', new Date('2026-11-18T10:20:30Z'))).toBe(
      'discover-OTel-demo-logs-2026-11-18T10-20-30.csv'
    );
    expect(csvFileName(undefined, new Date('2026-11-18T10:20:30Z'))).toBe('discover-logs-2026-11-18T10-20-30.csv');
  });
});

describe('shareLink', () => {
  const href =
    'http://grafana.local/a/plugin/explore?q=error&filters=%5B%5D&from=now-15m&to=now&ds=v1&traceId=abc&evil=%3Cscript%3E';

  it('keeps only codec parameters and the relative range by default', () => {
    const url = new URL(buildShareUrl(href, range('now-15m', 'now'), false));
    expect(url.pathname).toBe('/a/plugin/explore');
    expect(url.searchParams.get('q')).toBe('error');
    expect(url.searchParams.get('from')).toBe('now-15m');
    expect(url.searchParams.get('ds')).toBe('v1');
    expect(url.searchParams.has('traceId')).toBe(false);
    expect(url.searchParams.has('evil')).toBe(false);
  });

  it('pins the shown range as epoch ms when absolute', () => {
    const tr = range('now-15m', 'now');
    const url = new URL(buildShareUrl(href, tr, true));
    expect(url.searchParams.get('from')).toBe(String(tr.from.valueOf()));
    expect(url.searchParams.get('to')).toBe(String(tr.to.valueOf()));
  });

  it('detects relative ranges', () => {
    expect(isRelativeRange(range('now-1h', 'now'))).toBe(true);
    expect(isRelativeRange(range(1, 2))).toBe(false);
  });

  it('flags unsaved changes unless a saved search of the view matches', () => {
    const pill: FilterPill = { id: 'x', field: 'ServiceName', op: '=', value: 'cart' };
    const state = { search: 'error', filters: [pill], columns: [], sort: undefined };
    const saved: SavedSearch = {
      id: 's1',
      name: 'errors',
      search: 'error',
      filters: [{ ...pill, id: 'other-id' }],
      columns: [],
      createdAt: '',
      dataViewId: 'v1',
    };
    expect(hasUnsavedChanges(state, [saved], 'v1')).toBe(false);
    expect(hasUnsavedChanges({ ...state, search: 'warn' }, [saved], 'v1')).toBe(true);
    expect(hasUnsavedChanges(state, [saved], 'v2')).toBe(true);
    expect(hasUnsavedChanges(state, [], 'v1')).toBe(true);
  });
});

describe('alert rule from search', () => {
  it('escapes $ only inside string literals', () => {
    expect(escapeDollarInLiterals("SELECT 1 WHERE a = '$__fromTime' AND t >= $__fromTime")).toBe(
      "SELECT 1 WHERE a = '\\x24__fromTime' AND t >= $__fromTime"
    );
    expect(escapeDollarInLiterals("x = 'it\\'s $5' AND y = 'a''$'")).toBe("x = 'it\\'s \\x245' AND y = 'a''\\x24'");
  });

  it('counts the current search in the rule window, keeping macros outside literals', () => {
    const state = { ...DEFAULT_LOGS_QUERY_STATE, search: '"$__toTime"' };
    const sql = buildAlertCountQuery(config, state);
    expect(sql).toMatch(/^SELECT count\(\) AS value/);
    expect(sql).toContain('$__fromTime');
    expect(sql).toContain('$__toTime');
    expect(sql).toContain('\\x24__toTime');
    expect(sql).not.toMatch(/'[^']*\$__toTime[^']*'/);
  });

  it('returns nothing for a view without a time field', () => {
    const noTime = { ...config, columns: { ...config.columns, timestamp: '' } };
    expect(buildAlertCountQuery(noTime, DEFAULT_LOGS_QUERY_STATE)).toBe('');
    expect(
      buildAlertRuleUrl({ config: noTime, state: DEFAULT_LOGS_QUERY_STATE, timeRange: range('now-1h', 'now') })
    ).toBeNull();
  });

  it('prefills a threshold rule on the count, window = time range length', () => {
    const state = { ...DEFAULT_LOGS_QUERY_STATE, search: 'error' };
    const d = buildAlertRuleDefaults({ config, state, timeRange: range(0, 900_000), viewName: 'OTel' }) as any;
    expect(d.type).toBe('grafana-alerting');
    expect(d.title).toBe('OTel: error');
    expect(d.condition).toBe('B');
    expect(d.queries[0].datasourceUid).toBe('ds-uid-1');
    expect(d.queries[0].relativeTimeRange).toEqual({ from: 900, to: 0 });
    expect(d.queries[0].model.rawSql).toContain('count()');
    expect(d.queries[1].model).toMatchObject({ type: 'threshold', expression: 'A' });
    const url = buildAlertRuleUrl({ config, state, timeRange: range(0, 900_000) }, '/a/x?q=1')!;
    expect(url.startsWith('/alerting/new/alerting?')).toBe(true);
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(JSON.parse(sp.get('defaults')!).queries).toHaveLength(2);
    expect(sp.get('returnTo')).toBe('/a/x?q=1');
  });

  it('clamps the window', () => {
    expect(alertWindowSeconds(range(0, 1000))).toBe(60);
    expect(alertWindowSeconds(range(0, 30 * 24 * 3600 * 1000))).toBe(7 * 24 * 3600);
  });
});
