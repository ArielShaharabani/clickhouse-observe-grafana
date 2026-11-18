import {
  buildWhereConditions,
  looksLikeTrustedExpr,
  quoteDottedPath,
  quoteIdentifier,
  quoteIdentPart,
  tableRef,
} from '../queryBuilder';
import { DEFAULT_LOGS_QUERY_STATE, FilterOp, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'test',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};

// ClickHouse reads `\` as an escape inside "quoted" identifiers, so a field name ending in `\"`
// used to close the identifier early: `"x\""` + `) OR (1 AS `x\x22`) --` ran as SQL from a link.
const PAYLOAD = 'x\\")) OR (1 AS `x\\x22`) --';
const QUOTED_PAYLOAD = '"x\\\\"")) OR (1 AS `x\\\\x22`) --"';

/** True when the text between the outer quotes has no unescaped `"` or `\`. */
function staysOneIdentifier(q: string): boolean {
  const inner = q.slice(1, -1);
  return q.startsWith('"') && q.endsWith('"') && !/["\\]/.test(inner.replace(/\\\\/g, '').replace(/""/g, ''));
}

describe('identifier quoting (backslash escape)', () => {
  it('escapes backslashes before doubling quotes', () => {
    expect(quoteIdentPart('a\\b')).toBe('"a\\\\b"');
    expect(quoteIdentPart('a"b')).toBe('"a""b"');
    expect(quoteIdentPart('x\\"')).toBe('"x\\\\"""');
  });

  it('the shared-link payload stays one identifier', () => {
    expect(quoteIdentifier(PAYLOAD)).toBe(QUOTED_PAYLOAD);
    expect(staysOneIdentifier(QUOTED_PAYLOAD)).toBe(true);
  });

  it('a quoted segment with a lone backslash before a quote is not trusted as a Map accessor or path', () => {
    expect(looksLikeTrustedExpr('"x\\"[\'k\']')).toBe(false);
    expect(looksLikeTrustedExpr('"a\\"."b"')).toBe(false);
    // What the code itself produces still passes through.
    expect(looksLikeTrustedExpr(`${quoteIdentPart('we"ird\\')}['k']`)).toBe(true);
    expect(looksLikeTrustedExpr(quoteDottedPath('Payload', 'user-id.x'))).toBe(true);
  });

  it('filter pills from the URL with the payload as field keep it quoted', () => {
    const ops: FilterOp[] = ['exists', '=', '!=', 'one_of'];
    for (const op of ops) {
      const clause = buildWhereConditions(config, {
        ...DEFAULT_LOGS_QUERY_STATE,
        filters: [{ id: 'a', field: PAYLOAD, op, value: '1', values: ['1'] }],
      }).join(' AND ');
      expect(clause).toContain(QUOTED_PAYLOAD);
    }
  });

  it('table references escape database and table names', () => {
    expect(tableRef({ ...config, database: 'd\\"' }, 't')).toBe('"d\\\\"""."t"');
  });
});
