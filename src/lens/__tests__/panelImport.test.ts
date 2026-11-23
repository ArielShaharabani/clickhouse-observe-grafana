import { DEFAULT_SOURCE_CONFIG, DataView, OTEL_COLUMN_MAPPING } from '../../types';
import { finishImport, importPanel, importParams, lossList, PanelImport } from '../panelImport';
import { readSelect, SqlReadError, tokenize } from '../sqlRead';
import { LensField } from '../state';

const view: DataView = {
  ...DEFAULT_SOURCE_CONFIG,
  columns: OTEL_COLUMN_MAPPING,
  id: 'v1',
  name: 'logs',
  origin: 'shared',
  createdAt: '',
  datasourceUid: 'ds1',
  database: 'default',
  logsTable: 'otel_logs',
};
const other: DataView = { ...view, id: 'v2', database: 'other' };
const ds = { type: 'grafana-clickhouse-datasource', uid: 'ds1' };
const ts = OTEL_COLUMN_MAPPING.timestamp;

const sqlPanel = (rawSql: string, extra: Record<string, unknown> = {}, type = 'timeseries') => ({
  id: 3,
  type,
  title: 'T',
  datasource: ds,
  targets: [{ refId: 'A', datasource: ds, editorType: 'sql', rawSql }],
  ...extra,
});
const imp = (rawSql: string, extra: Record<string, unknown> = {}, type = 'timeseries', views = [view]) =>
  importPanel(sqlPanel(rawSql, extra, type), views);

const TS_SQL = `SELECT $__timeInterval(${ts}) AS time, count() AS c FROM default.otel_logs WHERE $__timeFilter(${ts}) GROUP BY time ORDER BY time`;

describe('sqlRead', () => {
  it('tokenizes strings, quoted identifiers, macros and comments', () => {
    const t = tokenize("SELECT `a b`, 'it''s' -- c\n, $__timeFilter(x) /* y */");
    expect(t.map((x) => x.k)).toEqual(['id', 'id', 'p', 'str', 'p', 'macro', 'p', 'id', 'p']);
  });
  it('reads one select', () => {
    const q = readSelect("SELECT a, count() AS c FROM db.t WHERE a = 'x' AND b IN (1,2) GROUP BY a ORDER BY c DESC LIMIT 5");
    expect(q.database).toBe('db');
    expect(q.table).toBe('t');
    expect(q.limit).toBe(5);
    expect(q.orderBy[0].dir).toBe('desc');
  });
  it.each([
    ['WITH x AS (SELECT 1) SELECT * FROM x', 'common table'],
    ['SELECT a FROM (SELECT 1) t', 'subquery'],
    ['SELECT a FROM t JOIN u ON 1', 'join'],
    ['SELECT a FROM t UNION ALL SELECT a FROM u', 'UNION'],
    ['SELECT a FROM t HAVING c > 1', 'HAVING'],
    ['SELECT row_number() OVER (ORDER BY a) FROM t', 'Window'],
    ["SELECT 'abc FROM t", 'Unterminated'],
    ['SELECT a FROM t WHERE a = ${var}', 'template variable'],
    ['SELECT a FROM t WHERE a = $var', 'template variable'],
    ['SELECT a FROM t WHERE a IN ($x)', 'template variable'],
    ['SELECT CASE WHEN 1 THEN 2 END FROM t', 'CASE'],
    ['SELECT a FROM t, u', 'join'],
    ['SELECT a FROM t FINAL', 'FINAL'],
    ['SELECT a FROM t LIMIT 5 OFFSET 2', 'offset'],
    ['SELECT a FROM t ORDER BY a WITH FILL', 'ORDER BY modifiers'],
    ['SELECT DISTINCT a FROM t', 'DISTINCT'],
    ['SELECT a FROM t;DROP TABLE x', 'cannot be read'],
    ['', 'Only a SELECT'],
  ])('rejects %s', (sql, why) => {
    expect(() => readSelect(sql)).toThrow(SqlReadError);
    expect(() => readSelect(sql)).toThrow(new RegExp(why, 'i'));
  });
  it('bounds length and nesting', () => {
    expect(() => readSelect(`SELECT ${'('.repeat(100)}1${')'.repeat(100)} FROM t`)).toThrow(SqlReadError);
    expect(() => readSelect(`SELECT ${'a,'.repeat(20000)}a FROM t`)).toThrow(SqlReadError);
  });
});

describe('importPanel: supported', () => {
  it('a time series of count() is fully converted', () => {
    const r = imp(TS_SQL);
    expect(r.kind).toBe('ok');
    expect(r.view?.id).toBe('v1');
    expect(r.lens?.chartType).toBe('line');
    expect(r.lens?.buckets[0]).toMatchObject({ kind: 'date_histogram', field: ts, interval: 'auto' });
    expect(r.lens?.metrics[0]).toMatchObject({ op: 'count', name: 'c' });
    expect(r.notes).toEqual([]);
    expect(r.title).toBe('T');
  });

  it('maps timeseries styles to line / area / bar and stacking', () => {
    const c = (custom: Record<string, unknown>) => imp(TS_SQL, { fieldConfig: { defaults: { custom }, overrides: [] } }).lens;
    expect(c({ drawStyle: 'bars', stacking: { mode: 'normal', group: 'A' } })).toMatchObject({ chartType: 'bar', subType: 'stacked' });
    expect(c({ drawStyle: 'line', fillOpacity: 40 })).toMatchObject({ chartType: 'area' });
    expect(c({ drawStyle: 'line' })?.chartType).toBe('line');
    expect(c({ drawStyle: 'bars', stacking: { mode: 'percent', group: 'A' } })?.subType).toBe('percentage');
  });

  it('terms, metrics, order and limit: top values ranked by the metric', () => {
    const r = imp(
      `SELECT ServiceName AS svc, sum(Duration) AS total, uniq(TraceId), quantile(0.95)(Duration) AS p95, avg(Duration) FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY svc ORDER BY total DESC LIMIT 7`,
      {},
      'table'
    );
    expect(r.kind).toBe('ok');
    const b = r.lens!.buckets[0];
    expect(b).toMatchObject({ kind: 'terms', field: 'ServiceName', size: 7, rankBy: 'metric', rankDir: 'desc' });
    expect(r.lens!.metrics.map((m) => m.op)).toEqual(['sum', 'unique', 'percentile', 'avg']);
    expect(r.lens!.metrics[2].percentile).toBe(95);
    expect((b as { rankMetric?: string }).rankMetric).toBe(r.lens!.metrics[0].id);
  });

  it('reads Map keys, JSON paths and quoted identifiers as fields', () => {
    const r = imp(
      `SELECT LogAttributes['http.method'] AS m, Payload.user.id, \`My Col\`, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY m, Payload.user.id, \`My Col\` LIMIT 5`,
      {},
      'table'
    );
    expect(r.lens?.buckets.map((b) => b.field)).toEqual(["LogAttributes['http.method']", 'Payload.user.id', 'My Col']);
  });

  it('count(DISTINCT x), median, stddevPop, quantiles', () => {
    const r = imp(
      `SELECT count(DISTINCT TraceId), median(Duration), stddevPop(Duration), quantiles(0.5, 0.9)(Duration) FROM otel_logs WHERE $__timeFilter(${ts})`,
      {},
      'table'
    );
    expect(r.lens?.metrics.map((m) => m.op)).toEqual(['unique', 'median', 'std_dev', 'percentile', 'percentile']);
    expect(r.kind).toBe('partial');
    expect(r.notes.join(' ')).toMatch(/separate percentile/);
  });

  it('date buckets of exported panels in a zone', () => {
    const off = "timeZoneOffset(toDateTime($__fromTime, 'Asia/Kolkata'))";
    const rest = `AS t, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY t`;
    const a = imp(`SELECT toStartOfInterval(toDateTime(${ts}) + ${off}, INTERVAL $__interval_s second) - ${off} ${rest}`);
    expect(a.lens?.buckets[0]).toMatchObject({ kind: 'date_histogram', interval: 'auto' });
    const b = imp(
      `SELECT toDateTime(toStartOfInterval(toDateTime(${ts}), INTERVAL 1 MONTH, 'Asia/Kolkata'), 'Asia/Kolkata') ${rest}`
    );
    expect(b.lens?.buckets[0]).toMatchObject({ kind: 'date_histogram', interval: '1M' });
  });

  it('toStartOfInterval / toStartOf* intervals', () => {
    const a = imp(`SELECT toStartOfInterval(${ts}, INTERVAL 5 minute) AS t, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY t`);
    expect(a.lens?.buckets[0]).toMatchObject({ interval: '5m' });
    const b = imp(`SELECT toStartOfHour(${ts}) t, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY t`);
    expect(b.lens?.buckets[0]).toMatchObject({ interval: '1h' });
    const c = imp(
      `SELECT toStartOfInterval(${ts}, INTERVAL $__interval_s SECOND) t, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY t`
    );
    expect(c.lens?.buckets[0]).toMatchObject({ interval: 'auto' });
  });

  it('WHERE: simple predicates become filter pills', () => {
    const r = imp(
      `SELECT count() FROM otel_logs WHERE $__timeFilter(${ts}) AND ServiceName = 'a' AND SeverityText != 'x' AND ServiceName IN ('a','b') AND Body ILIKE '%err%' AND Duration >= 5 AND Duration < 9 AND Duration BETWEEN 1 AND 2 AND TraceId IS NOT NULL AND SpanId IS NULL AND Body NOT ILIKE '%z%' AND ServiceName NOT IN ('q')`,
      {},
      'stat'
    );
    expect(r.kind).toBe('ok');
    expect(r.filters.map((f) => f.op)).toEqual([
      '=',
      '!=',
      'one_of',
      'contains',
      'gte',
      'lt',
      'between',
      'exists',
      'not_exists',
      'not_contains',
      'not_one_of',
    ]);
    expect(r.filters[2].values).toEqual(['a', 'b']);
    expect(r.filters[6].values).toEqual(['1', '2']);
    expect(r.lens?.chartType).toBe('metric');
  });

  it('LIKE (case sensitive) is carried as contains with a note', () => {
    const r = imp(`SELECT count() FROM otel_logs WHERE $__timeFilter(${ts}) AND Body LIKE '%err%'`, {}, 'stat');
    expect(r.kind).toBe('partial');
    expect(r.filters[0].op).toBe('contains');
    expect(r.notes.join()).toMatch(/case sensitive/);
  });

  it('chart types by panel type', () => {
    const q = `SELECT ServiceName, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY ServiceName LIMIT 5`;
    expect(imp(q, {}, 'piechart').lens?.chartType).toBe('pie');
    expect(imp(q, { options: { pieType: 'donut' } }, 'piechart').lens?.chartType).toBe('donut');
    expect(imp(q, {}, 'barchart').lens?.chartType).toBe('bar');
    expect(imp(q, {}, 'table').lens?.chartType).toBe('table');
    expect(imp(q, {}, 'stat').lens?.chartType).toBe('metric');
    expect(imp(q, { fieldConfig: { defaults: { min: 0, max: 50 } } }, 'gauge').lens).toMatchObject({
      chartType: 'gauge',
      gauge: { max: 50 },
    });
    expect(imp(q, {}, 'bargauge').lens?.gauge?.shape).toBe('bar');
  });

  it('unit, decimals and legend carry over', () => {
    const r = imp(TS_SQL, {
      fieldConfig: { defaults: { unit: 'bytes', decimals: 1 }, overrides: [] },
      options: { legend: { showLegend: false, displayMode: 'list', placement: 'bottom', calcs: [] } },
    });
    expect(r.kind).toBe('ok');
    expect(r.lens?.metrics[0].format).toEqual({ id: 'bytes', decimals: 1 });
    expect(r.lens?.style?.legend?.visibility).toBe('hide');
  });

  it('matches the data view by data source and database.table', () => {
    const q = `SELECT count() FROM other.otel_logs WHERE $__timeFilter(${ts})`;
    expect(imp(q, {}, 'stat', [view, other]).view?.id).toBe('v2');
    expect(imp(`SELECT count() FROM otel_logs WHERE $__timeFilter(${ts})`, {}, 'stat', [view, other]).reason).toMatch(
      /several databases/
    );
  });

  it('a builder-mode aggregate target', () => {
    const r = importPanel(
      {
        type: 'timeseries',
        title: 'B',
        datasource: ds,
        targets: [
          {
            refId: 'A',
            datasource: ds,
            editorType: 'builder',
            builderOptions: {
              database: 'default',
              table: 'otel_logs',
              mode: 'trend',
              columns: [{ name: ts, hint: 'time' }],
              aggregates: [{ aggregateType: 'count', column: '', alias: 'n' }],
              filters: [
                { key: ts, operator: 'WITH IN DASHBOARD TIME RANGE', type: 'datetime' },
                { key: 'ServiceName', operator: '=', value: 'a', condition: 'AND' },
              ],
            },
          },
        ],
      },
      [view]
    );
    expect(r.kind).toBe('ok');
    expect(r.lens?.buckets[0].kind).toBe('date_histogram');
    expect(r.filters).toHaveLength(1);
    expect(r.originalQuery).toContain('otel_logs');
  });

  it('Discover volume panel: search, filters and view', () => {
    const r = importPanel(
      {
        type: 'timeseries',
        title: 'Volume',
        datasource: ds,
        targets: [
          {
            refId: 'A',
            observeDiscover: new URLSearchParams({
              q: 'error',
              ds: 'v1',
              filters: '[{"id":"a","field":"ServiceName","op":"=","value":"x"}]',
              bd: 'severity',
            }).toString(),
          },
        ],
      },
      [view]
    );
    expect(r.kind).toBe('ok');
    expect(r.search).toBe('error');
    expect(r.filters).toHaveLength(1);
    expect(r.lens?.chartType).toBe('bar');
    expect(r.lens?.buckets).toHaveLength(2);
  });

  it('a Discover logs table is unsupported but keeps the search', () => {
    const r = importPanel(
      { type: 'table', title: 'L', datasource: ds, targets: [{ refId: 'A', observeDiscover: 'q=err&ds=v1' }] },
      [view]
    );
    expect(r.kind).toBe('unsupported');
    expect(r.search).toBe('err');
    expect(r.view?.id).toBe('v1');
  });

  it('a panel saved from Visualize keeps its state', () => {
    const lens = JSON.stringify({ chartType: 'bar', buckets: [], metrics: [{ kind: 'metric', id: 'm', op: 'count' }] });
    const r = importPanel(
      {
        type: 'stat',
        title: 'V',
        datasource: ds,
        targets: [{ refId: 'A', observeVisualize: new URLSearchParams({ lens, ds: 'v1' }).toString() }],
      },
      [view]
    );
    expect(r.kind).toBe('ok');
    expect(r.lens?.metrics).toHaveLength(1);
  });
});

describe('importPanel: partial (never silent)', () => {
  const notesOf = (r: PanelImport) => r.notes.join(' | ');
  it('no time filter, no LIMIT and an unreadable condition are reported', () => {
    const r = imp(`SELECT ServiceName, count() FROM otel_logs WHERE position(Body, 'x') > 0 GROUP BY ServiceName`, {}, 'table');
    expect(r.kind).toBe('partial');
    expect(notesOf(r)).toMatch(/Condition not carried over: position/);
    expect(notesOf(r)).toMatch(/no time filter/);
    expect(notesOf(r)).toMatch(/No LIMIT/);
  });
  it('a metric that cannot be converted is reported', () => {
    const r = imp(
      `SELECT ServiceName, count() AS c, sumIf(Duration, Duration > 1) AS s FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY ServiceName LIMIT 3`,
      {},
      'table'
    );
    expect(r.kind).toBe('partial');
    expect(notesOf(r)).toMatch(/sumIf/);
    expect(r.lens?.metrics).toHaveLength(1);
  });
  it('quantile levels that are not whole percentiles are not rounded silently', () => {
    const r = imp(`SELECT quantile(0.999)(Duration) AS p, count() FROM otel_logs WHERE $__timeFilter(${ts})`, {}, 'table');
    expect(notesOf(r)).toMatch(/0\.999/);
    expect(r.lens?.metrics.map((m) => m.op)).toEqual(['count']);
  });
  it('panel settings that Visualize does not carry are listed', () => {
    const r = imp(TS_SQL, {
      fieldConfig: {
        defaults: {
          thresholds: {
            mode: 'absolute',
            steps: [
              { color: 'green', value: null },
              { color: 'red', value: 10 },
            ],
          },
          custom: { lineWidth: 4, axisLabel: 'x' },
        },
        overrides: [{ matcher: { id: 'byName', options: 'c' }, properties: [] }],
      },
      transformations: [{ id: 'organize', options: {} }],
      links: [{ title: 'a', url: 'b' }],
      repeat: 'host',
      interval: '1m',
    });
    expect(r.kind).toBe('partial');
    const n = notesOf(r);
    expect(n).toMatch(/Thresholds/);
    expect(n).toMatch(/Custom option "lineWidth"/);
    expect(n).toMatch(/Custom option "axisLabel"/);
    expect(n).toMatch(/Field overrides/);
    expect(n).toMatch(/Transformations \(organize\)/);
    expect(n).toMatch(/"links"/);
    expect(n).toMatch(/"repeat"/);
    expect(n).toMatch(/"interval"/);
  });
  it('Grafana default settings do not count as loss', () => {
    const r = imp(TS_SQL, {
      pluginVersion: '11.0.0',
      fieldConfig: {
        defaults: {
          color: { mode: 'palette-classic' },
          custom: {
            axisBorderShow: false,
            lineWidth: 1,
            fillOpacity: 0,
            gradientMode: 'none',
            hideFrom: { legend: false, tooltip: false, viz: false },
            showPoints: 'auto',
          },
          mappings: [],
          thresholds: {
            mode: 'absolute',
            steps: [
              { color: 'green', value: null },
              { color: 'red', value: 80 },
            ],
          },
        },
        overrides: [],
      },
      options: {
        legend: { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] },
        tooltip: { mode: 'single', sort: 'none' },
      },
    });
    expect(r.kind).toBe('ok');
  });
  it('a library panel is reported', () => {
    const r = imp(TS_SQL, { libraryPanel: { uid: 'x', name: 'n' } });
    expect(r.kind).toBe('partial');
    expect(r.library).toBe(true);
    expect(notesOf(r)).toMatch(/Library panel/);
  });
  it('a unit with no equivalent is reported', () => {
    expect(notesOf(imp(TS_SQL, { fieldConfig: { defaults: { unit: 'celsius' }, overrides: [] } }))).toMatch(/Unit "celsius"/);
  });
  it('lossList: nothing for ok, the notes for partial, the reason for unsupported', () => {
    expect(lossList(imp(TS_SQL))).toEqual([]);
    expect(lossList(imp(TS_SQL, { links: [{ title: 'a' }] })).length).toBeGreaterThan(0);
    expect(lossList(imp(`SELECT a FROM x JOIN y ON 1`)).join()).toMatch(/join/i);
  });
});

describe('importPanel: unsupported', () => {
  it.each([
    ['text panel', { type: 'text', title: 'x', options: { content: 'hi' } }, /not supported/],
    ['row', { type: 'row', title: 'x' }, /not supported/],
    [
      'other data source',
      sqlPanel(TS_SQL, {
        datasource: { type: 'prometheus', uid: 'p' },
        targets: [{ refId: 'A', datasource: { type: 'prometheus', uid: 'p' }, expr: 'up' }],
      }),
      /another data source/,
    ],
    [
      'variable data source',
      sqlPanel(TS_SQL, {
        targets: [{ refId: 'A', datasource: { type: 'grafana-clickhouse-datasource', uid: '${ds}' }, rawSql: TS_SQL }],
      }),
      /variable/,
    ],
    [
      'several targets',
      sqlPanel(TS_SQL, {
        targets: [
          { refId: 'A', datasource: ds, rawSql: TS_SQL },
          { refId: 'B', datasource: ds, rawSql: TS_SQL },
        ],
      }),
      /several queries/,
    ],
    ['hidden target', sqlPanel(TS_SQL, { targets: [{ refId: 'A', datasource: ds, rawSql: TS_SQL, hide: true }] }), /hidden/],
    [
      'unknown table',
      sqlPanel(`SELECT count() FROM default.nope WHERE $__timeFilter(${ts})`),
      /No data view for the table default\.nope/,
    ],
    [
      'unknown data source',
      sqlPanel(TS_SQL, {
        targets: [{ refId: 'A', datasource: { type: 'grafana-clickhouse-datasource', uid: 'zzz' }, rawSql: TS_SQL }],
      }),
      /No data view uses/,
    ],
    ['no query', { type: 'stat', title: 'x', datasource: ds, targets: [] }, /no query/],
    ['library reference without model', { id: 1, title: 'x', libraryPanel: { uid: 'u', name: 'n' } }, /no type/],
    [
      'unknown panel type',
      { type: 'nodeGraph', title: 'x', datasource: ds, targets: [{ refId: 'A', rawSql: TS_SQL }] },
      /not supported/,
    ],
  ])('%s', (_n, panel, re) => {
    const r = importPanel(panel, [view]);
    expect(r.kind).toBe('unsupported');
    expect(r.reason).toMatch(re);
    expect(r.lens).toBeUndefined();
    expect(lossList(r).length).toBeGreaterThan(0);
  });

  it.each([
    ['join', 'SELECT a, count() FROM default.otel_logs a JOIN default.t b ON 1 GROUP BY a'],
    ['subquery', 'SELECT count() FROM (SELECT * FROM default.otel_logs)'],
    ['CTE', 'WITH x AS (SELECT 1) SELECT count() FROM default.otel_logs'],
    ['UNION', 'SELECT count() FROM default.otel_logs UNION ALL SELECT count() FROM default.otel_logs'],
    ['window', 'SELECT sum(x) OVER (PARTITION BY y) FROM default.otel_logs'],
    ['HAVING', 'SELECT ServiceName, count() c FROM default.otel_logs GROUP BY ServiceName HAVING c > 5'],
    [
      'OR',
      `SELECT count() FROM default.otel_logs WHERE $__timeFilter(${ts}) AND (ServiceName = 'a' OR ServiceName = 'b')`,
    ],
    ['template variable', `SELECT count() FROM default.otel_logs WHERE ServiceName = '$svc' AND x = $svc`],
    ['rows, not an aggregation', `SELECT Timestamp, Body FROM default.otel_logs LIMIT 10`],
    ['group by not selected', `SELECT count() FROM default.otel_logs GROUP BY ServiceName`],
    ['selected not grouped', `SELECT ServiceName, count() FROM default.otel_logs`],
    ['unparsable', 'SELEC nonsense ((('],
    ['too long', `SELECT ${'x,'.repeat(15000)}count() FROM default.otel_logs`],
  ])('SQL %s', (_n, sql) => {
    const r = imp(sql, {}, 'table');
    expect(r.kind).toBe('unsupported');
    expect(r.reason).toBeTruthy();
  });

  it('keeps the original query for display', () => {
    const sql = 'SELECT a FROM default.otel_logs JOIN y ON 1';
    expect(imp(sql, {}, 'table').originalQuery).toBe(sql);
  });

  it('a time series without a date bucket', () => {
    expect(
      imp(`SELECT ServiceName, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY ServiceName`).kind
    ).toBe('unsupported');
  });
});

describe('importPanel: hostile input', () => {
  it.each([
    null,
    undefined,
    5,
    'x',
    [],
    {},
    { type: 'stat', targets: 'x' },
    { type: 'stat', targets: [null] },
    { type: 'stat', targets: [{ rawSql: 5 }], datasource: ds },
  ])('does not throw on %j', (p) => {
    expect(importPanel(p, [view]).kind).toBe('unsupported');
  });
  it('a hostile column name is only a field string, dropped by finishImport when it does not exist', () => {
    const r = imp(
      `SELECT \`x'; DROP TABLE t; --\` AS a, count() FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY a LIMIT 3`,
      {},
      'table'
    );
    const fin = finishImport(
      r.lens!,
      [{ id: 'c:ServiceName', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' } as LensField],
      ts
    );
    expect(fin.lens.buckets.map((b) => b.field)).not.toContain("x'; DROP TABLE t; --");
    expect(fin.notes.join()).toMatch(/does not exist/);
  });
  it('proto pollution keys and huge values are inert', () => {
    const r = importPanel(
      JSON.parse(
        `{"__proto__":{"polluted":1},"type":"stat","title":"${'x'.repeat(5000)}","datasource":{"type":"grafana-clickhouse-datasource","uid":"ds1"},"targets":[{"rawSql":"SELECT count() FROM otel_logs WHERE $__timeFilter(${ts})"}]}`
      ),
      [view]
    );
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    expect(r.title.length).toBeLessThanOrEqual(200);
  });
  it('filter values are plain text and ids are ours', () => {
    const r = imp(
      `SELECT count() FROM otel_logs WHERE $__timeFilter(${ts}) AND ServiceName = 'x' AND Body = 'a'' OR 1=1 --'`,
      {},
      'stat'
    );
    for (const f of r.filters) {
      expect(f.id).toMatch(/^imp/);
      expect(typeof f.value).toBe('string');
    }
  });
});

describe('finishImport / importParams', () => {
  const fields: LensField[] = [
    { id: 'c:ServiceName', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
    { id: 'c:Duration', sqlExpr: 'Duration', label: 'Duration', type: 'number' },
  ];
  it('sets numeric from the field and drops unknown ones with a note', () => {
    const r = imp(
      `SELECT ServiceName, nope, sum(Duration) s, sum(Missing) m FROM otel_logs WHERE $__timeFilter(${ts}) GROUP BY ServiceName, nope LIMIT 3`,
      {},
      'table'
    );
    const fin = finishImport(r.lens!, fields, ts);
    expect(fin.lens.buckets.map((b) => b.field)).toEqual(['ServiceName']);
    expect(fin.lens.metrics).toHaveLength(1);
    expect(fin.lens.metrics[0]).toMatchObject({ field: 'Duration', numeric: true });
    expect(fin.notes).toHaveLength(2);
  });
  it('no metric left gives an empty chart', () => {
    const r = imp(`SELECT sum(Missing) FROM otel_logs WHERE $__timeFilter(${ts})`, {}, 'stat');
    expect(finishImport(r.lens!, fields, ts).notes.join()).toMatch(/No metric/);
  });
  it('importParams carries the chart, search, filters and view; no time', () => {
    const r = imp(`SELECT count() FROM otel_logs WHERE $__timeFilter(${ts}) AND ServiceName = 'a'`, {}, 'stat');
    const sp = importParams(r);
    expect([...sp.keys()].sort()).toEqual(['ds', 'filters', 'lens']);
  });
});
