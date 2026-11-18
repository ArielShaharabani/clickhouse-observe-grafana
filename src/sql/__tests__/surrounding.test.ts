import {
  buildContextAnchorLookupQuery,
  buildSurroundingDocsQuery,
  contextIdExpr,
  CORE_ALIAS,
  isContextAnchor,
  MAX_CONTEXT_SIZE,
  SurroundingDocsOpts,
} from '../queryBuilder';
import { DEFAULT_SOURCE_CONFIG, FilterPill, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

// DISC-DOC-02: SQL for the surrounding-documents searches (spec: two searches sorted asc/desc
// with search_after from the anchor's sort values, size N).

const cfg: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, spanAttributes: '' },
};
const ANCHOR = { ns: '1767603630000000000', id: '15918698468527039780' };
const ID = 'cityHash64(Timestamp, Body, SeverityText, TraceId, ServiceName)';
const opts = (o: Partial<SurroundingDocsOpts>): SurroundingDocsOpts => ({
  direction: 'older',
  size: 5,
  columns: [],
  filters: [],
  ...o,
});

describe('buildSurroundingDocsQuery', () => {
  it('older: rows before the anchor in (timestamp, row id) order, descending, size N', () => {
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({ direction: 'older', size: 5 }));
    expect(sql).toContain('Timestamp <= fromUnixTimestamp64Nano(1767603630000000000)');
    expect(sql).toContain(`(Timestamp, ${ID}) < (fromUnixTimestamp64Nano(1767603630000000000), 15918698468527039780)`);
    expect(sql).toContain(`ORDER BY Timestamp DESC, ${ID} DESC`);
    expect(sql).toContain('LIMIT 5');
    // coarse partition bound for pruning
    expect(sql).toContain('TimestampTime <= fromUnixTimestamp64Nano(1767603630000000000) + INTERVAL 1 SECOND');
  });

  it('newer: rows after the anchor, ascending (closest first)', () => {
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({ direction: 'newer', size: 7 }));
    expect(sql).toContain('Timestamp >= fromUnixTimestamp64Nano(1767603630000000000)');
    expect(sql).toContain(`(Timestamp, ${ID}) > (fromUnixTimestamp64Nano(1767603630000000000), 15918698468527039780)`);
    expect(sql).toContain(`ORDER BY Timestamp ASC, ${ID} ASC`);
    expect(sql).toContain('LIMIT 7');
    expect(sql).toContain('TimestampTime >= fromUnixTimestamp64Nano(1767603630000000000) - INTERVAL 1 SECOND');
  });

  it('anchor: exact (timestamp, row id) match, one row', () => {
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({ direction: 'anchor' }));
    expect(sql).toContain('Timestamp = fromUnixTimestamp64Nano(1767603630000000000)');
    expect(sql).toContain(`${ID} = 15918698468527039780`);
    expect(sql).toContain('LIMIT 1');
    expect(sql).not.toContain('ORDER BY');
  });

  it('selects the grid core aliases plus the row anchor values as strings (64-bit safe)', () => {
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({}));
    expect(sql).toContain(`Timestamp AS ${CORE_ALIAS.timestamp}`);
    expect(sql).toContain(`Body AS ${CORE_ALIAS.body}`);
    expect(sql).toContain('toString(toUnixTimestamp64Nano(toDateTime64(Timestamp, 9))) AS __ctxNs');
    expect(sql).toContain(`toString(${ID}) AS __ctxId`);
  });

  it('is not bound to the time picker and never applies a search query', () => {
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({}));
    expect(sql).not.toContain('$__fromTime');
    expect(sql).not.toContain('$__toTime');
  });

  it('applies enabled filters and skips disabled ones', () => {
    const filters: FilterPill[] = [
      { id: 'a', field: 'ServiceName', op: '=', value: 'payments' },
      { id: 'b', field: 'SeverityText', op: '=', value: 'error', disabled: true },
    ];
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({ filters }));
    expect(sql).toContain("'payments'");
    expect(sql).not.toContain("'error'");
  });

  it('the anchor ignores filters (fetched by id, like Kibana)', () => {
    const filters: FilterPill[] = [{ id: 'a', field: 'ServiceName', op: '=', value: 'payments' }];
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ direction: 'anchor', filters }))).not.toContain("'payments'");
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ direction: 'newer', filters }))).toContain("'payments'");
  });

  it('selects extra columns under their keys', () => {
    const sql = buildSurroundingDocsQuery(
      cfg,
      ANCHOR,
      opts({
        columns: [
          {
            id: 'map:LogAttributes:http.status_code',
            key: 'fld_x',
            sqlExpr: "LogAttributes['http.status_code']",
            displayName: 'x',
            type: 'exact',
            isCore: false,
          },
        ],
      })
    );
    expect(sql).toContain("LogAttributes['http.status_code'] AS fld_x");
  });

  it('clamps the size to 1..MAX_CONTEXT_SIZE', () => {
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ size: 0 }))).toContain('LIMIT 1');
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ size: NaN }))).toContain('LIMIT 1');
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ size: 2.7 }))).toContain('LIMIT 2');
    expect(buildSurroundingDocsQuery(cfg, ANCHOR, opts({ size: 1e9 }))).toContain(`LIMIT ${MAX_CONTEXT_SIZE}`);
  });

  it('skips the partition bound when pruning is off', () => {
    const off = { ...cfg, columns: { ...cfg.columns, partitionTimestamp: '-' } };
    expect(buildSurroundingDocsQuery(off, ANCHOR, opts({}))).not.toContain('TimestampTime');
  });

  it('row id uses only the mapped core columns', () => {
    const narrow = { ...cfg, columns: { ...cfg.columns, traceId: '', severity: '' } };
    expect(contextIdExpr(narrow)).toBe('cityHash64(Timestamp, Body, ServiceName)');
    expect(contextIdExpr({ ...cfg, columns: { ...cfg.columns, timestamp: '' } })).toBe('');
  });
});

describe('surrounding documents: hostile anchors (URL input)', () => {
  const hostile: unknown[] = [
    { ns: '1; DROP TABLE spec_logs', id: '1' },
    { ns: '1', id: '1) OR (1=1' },
    { ns: '1', id: "1' --" },
    { ns: '-1', id: '1' },
    { ns: '1e18', id: '1' },
    { ns: '0x10', id: '1' },
    { ns: '01', id: '1' },
    { ns: ' 1', id: '1' },
    { ns: '1', id: '' },
    { ns: '9223372036854775808', id: '1' }, // Int64 max + 1
    { ns: '1', id: '18446744073709551616' }, // UInt64 max + 1
    { ns: 1, id: 1 },
    { ns: '1' },
    null,
    'x',
  ];
  it.each(hostile.map((h) => [JSON.stringify(h), h]))('rejects %s', (_label, h) => {
    expect(isContextAnchor(h)).toBe(false);
    expect(buildSurroundingDocsQuery(cfg, h as never, opts({}))).toBe('');
  });

  it('accepts the bounds', () => {
    expect(isContextAnchor({ ns: '9223372036854775807', id: '18446744073709551615' })).toBe(true);
    expect(isContextAnchor({ ns: '0', id: '0' })).toBe(true);
  });

  it('hostile filter values stay quoted literals', () => {
    const filters: FilterPill[] = [{ id: 'a', field: 'Body', op: '=', value: "x' OR 1=1 --\\" }];
    const sql = buildSurroundingDocsQuery(cfg, ANCHOR, opts({ filters }));
    // `=` on a text column is a contains match (existing filter semantics).
    expect(sql).toContain("Body ILIKE '%x\\' OR 1=1 --\\\\%'");
  });

  it('returns no query without a mapped timestamp', () => {
    expect(buildSurroundingDocsQuery({ ...cfg, columns: { ...cfg.columns, timestamp: '' } }, ANCHOR, opts({}))).toBe(
      ''
    );
  });
});

describe('buildContextAnchorLookupQuery', () => {
  const row = {
    [CORE_ALIAS.timestamp]: 1767603630000,
    [CORE_ALIAS.body]: "Order 22364 created'; DROP TABLE x --\\",
    [CORE_ALIAS.severity]: 'info',
    [CORE_ALIAS.serviceName]: 'payments',
  };

  it('point lookup by the row (1 ms window + core equality), anchor values as strings', () => {
    const sql = buildContextAnchorLookupQuery(cfg, row);
    expect(sql).toContain('SELECT toString(toUnixTimestamp64Nano(toDateTime64(Timestamp, 9))) AS __ctxNs');
    expect(sql).toContain(`toString(${ID}) AS __ctxId`);
    expect(sql).toContain('Timestamp >= fromUnixTimestamp64Milli(1767603630000)');
    expect(sql).toContain('Timestamp < fromUnixTimestamp64Milli(1767603630001)');
    expect(sql).toContain("SeverityText = 'info'");
    expect(sql).toContain('LIMIT 1');
  });

  it('quotes hostile row values', () => {
    const sql = buildContextAnchorLookupQuery(cfg, row);
    expect(sql).toContain("Body = 'Order 22364 created\\'; DROP TABLE x --\\\\'");
  });

  it('returns no query for an unparseable timestamp or no timestamp column', () => {
    expect(buildContextAnchorLookupQuery(cfg, { ...row, [CORE_ALIAS.timestamp]: 'nope' })).toBe('');
    expect(buildContextAnchorLookupQuery({ ...cfg, columns: { ...cfg.columns, timestamp: '' } }, row)).toBe('');
  });
});
