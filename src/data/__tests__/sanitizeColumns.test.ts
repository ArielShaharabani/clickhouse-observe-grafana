import { defaultColumns, sanitizeColumns } from '../columns';
import { FieldModel } from '../../sql/fieldModel';
import { buildLogsQuery, CORE_ALIAS } from '../../sql/queryBuilder';
import {
  DEFAULT_LOGS_QUERY_STATE,
  DEFAULT_SOURCE_CONFIG,
  OTEL_COLUMN_MAPPING,
  SelectedColumn,
  SourceConfig,
} from '../../types';

// SEC-URL-COLS: columns restored from a URL (`cols`) or a saved search are untrusted — their
// sqlExpr and key used to reach SQL verbatim (`${col.sqlExpr} AS ${col.key}`).

const cfg: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  logsTable: 'spec_logs',
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, spanAttributes: '' },
};
const col = (over: Partial<SelectedColumn>): SelectedColumn => ({
  id: 'x',
  key: 'fld_x',
  sqlExpr: 'x',
  displayName: 'x',
  type: 'string',
  isCore: false,
  ...over,
});
const fields: FieldModel[] = [
  {
    id: 'col:LogAttributes',
    name: 'LogAttributes',
    displayName: 'LogAttributes',
    sqlExpr: 'LogAttributes',
    type: 'map',
    source: 'column',
  },
  {
    id: 'json:Payload:user.id',
    name: 'user.id',
    displayName: 'user.id',
    sqlExpr: 'Payload.user.id',
    type: 'number',
    source: 'json',
  },
];

describe('sanitizeColumns: hostile values', () => {
  it.each([
    '1) FROM system.users --',
    'x FROM system.users --',
    '(SELECT password FROM system.users)',
    'evil()',
    "LogAttributes['k'] , (SELECT 1)",
    "LogAttributes['k\\']",
    'a; DROP TABLE spec_logs',
    '`x`',
    '',
  ])('drops sqlExpr %p', (sqlExpr) => {
    expect(sanitizeColumns([col({ sqlExpr })], cfg)).toEqual([]);
  });

  it.each(['fld x', 'fld`x', 'x` FROM system.users --', 'a,b', '1abc', ''])(
    'regenerates the key %p from the id',
    (key) => {
      const [c] = sanitizeColumns(
        [col({ id: 'map:LogAttributes:http.method', key, sqlExpr: "LogAttributes['http.method']" })],
        cfg
      );
      expect(c.key).toBe('fld_map_LogAttributes_http_method');
      expect(c.key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    }
  );

  it('a core column takes its sqlExpr and key from the view mapping, not the URL', () => {
    const [c] = sanitizeColumns(
      [col({ id: 'body', isCore: true, key: 'x` FROM system.users --', sqlExpr: '(SELECT 1)' })],
      cfg
    );
    expect(c).toEqual(defaultColumns(cfg).find((d) => d.id === 'body'));
    expect(c.key).toBe(CORE_ALIAS.body);
  });

  it('drops an unknown core id, non-objects, missing ids; non-arrays give []', () => {
    expect(sanitizeColumns([col({ id: 'nope', isCore: true }), null, 5, 'x', { key: 'k' }], cfg)).toEqual([]);
    expect(sanitizeColumns('[]', cfg)).toEqual([]);
    expect(sanitizeColumns({ length: 1, 0: col({}) }, cfg)).toEqual([]);
  });

  it('keeps plain column references with a checked type', () => {
    const out = sanitizeColumns(
      [
        col({ id: 'a', sqlExpr: 'ScopeName', type: 'bogus' as never }),
        col({ id: 'b', sqlExpr: 'Payload.user.id', type: 'number' }),
        col({ id: 'c', sqlExpr: "LogAttributes['duration_ms']", type: 'exact', displayName: '<b>x</b>' }),
      ],
      cfg
    );
    expect(out.map((c) => [c.sqlExpr, c.type, c.key])).toEqual([
      ['ScopeName', 'unknown', 'fld_a'],
      ['Payload.user.id', 'number', 'fld_b'],
      ["LogAttributes['duration_ms']", 'exact', 'fld_c'],
    ]);
    // display names are only rendered as text
    expect(out[2].displayName).toBe('<b>x</b>');
  });

  it('drops duplicates by id and by generated key', () => {
    const out = sanitizeColumns(
      [col({ id: 'a.b', sqlExpr: 'A' }), col({ id: 'a_b', sqlExpr: 'B' }), col({ id: 'a.b', sqlExpr: 'C' })],
      cfg
    );
    expect(out).toHaveLength(1);
  });

  it('strict mode (fields given) only keeps columns naming something discovered', () => {
    const out = sanitizeColumns(
      [
        col({ id: 'json:Payload:user.id', sqlExpr: 'evil()' }), // by field id → field's own expression
        col({ id: 'k', sqlExpr: "LogAttributes['http.method']" }), // key of a discovered Map column
        col({ id: 'u', sqlExpr: 'Unknown' }),
        col({ id: 'm', sqlExpr: "Missing['k']" }),
      ],
      cfg,
      fields
    );
    expect(out.map((c) => c.sqlExpr)).toEqual(['Payload.user.id', "LogAttributes['http.method']"]);
  });

  it("uses the view's pinned columns by id", () => {
    const pinned = col({ id: 'pin', key: 'fld_pin', sqlExpr: 'ScopeName' });
    const out = sanitizeColumns([col({ id: 'pin', sqlExpr: 'evil()' })], { ...cfg, pinnedColumns: [pinned] });
    expect(out).toEqual([pinned]);
  });
});

describe('buildLogsQuery defence in depth', () => {
  const q = (columns: SelectedColumn[], sort?: { col: string; dir: string }) =>
    buildLogsQuery(
      cfg,
      { ...DEFAULT_LOGS_QUERY_STATE, columns, sort: sort as never },
      { limit: 10, offset: 0 },
      { projection: 'grid' }
    );

  it('never emits an unsafe alias or expression', () => {
    const sql = q([
      col({ key: 'x` FROM system.users --', sqlExpr: 'ScopeName' }),
      col({ key: 'fld ok', sqlExpr: 'ScopeName' }),
      col({ key: 'fld_ok', sqlExpr: '1) FROM system.users --' }),
      col({ key: 'fld_good', sqlExpr: 'ScopeName' }),
    ]);
    expect(sql).not.toContain('system.users');
    expect(sql).not.toContain('fld ok');
    expect(sql).toContain('ScopeName AS fld_good');
  });

  it('ignores an unsafe sort column and direction', () => {
    const sql = q([], { col: '__body, (SELECT 1)', dir: 'desc' });
    expect(sql).toContain(`ORDER BY ${CORE_ALIAS.timestamp} DESC`);
    expect(sql).not.toContain('SELECT 1');
    expect(q([], { col: CORE_ALIAS.body, dir: 'asc; DROP TABLE x' })).toContain(`ORDER BY ${CORE_ALIAS.body} DESC`);
    expect(q([], { col: CORE_ALIAS.body, dir: 'asc' })).toContain(`ORDER BY ${CORE_ALIAS.body} ASC`);
  });
});
