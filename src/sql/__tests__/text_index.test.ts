import { buildSearchClause as rawClause } from '../queryBuilder';
import { buildFieldIndex } from '../fields';
import { buildSkipIndicesQuery, parseTextIndexes } from '../textIndex';
import { SourceConfig, OTEL_COLUMN_MAPPING } from '../../types';

const config: SourceConfig = {
  datasourceUid: 't',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};

// Resolved field names come back double-quoted ("Body"); equivalent SQL, so compare without.
const buildSearchClause = (...a: Parameters<typeof rawClause>) => rawClause(...a).replace(/"/g, '');

const ngramLower = parseTextIndexes([{ name: 'i', type: 'ngrambf_v1', type_full: 'ngrambf_v1(3, 32768, 3, 0)', expr: 'lower(Body)' }]);
const idx = buildFieldIndex([], ngramLower);

describe('parseTextIndexes', () => {
  it('parses ngrambf_v1 size, tokenbf_v1 and text; ignores other types', () => {
    const out = parseTextIndexes([
      { type: 'ngrambf_v1', type_full: 'ngrambf_v1(4, 1024, 2, 0)', expr: '`Body`' },
      { type: 'tokenbf_v1', type_full: 'tokenbf_v1(1, 2, 3)', expr: 'Body' },
      { type: 'text', expr: 'Body' },
      { type: 'minmax', expr: 'Timestamp' },
    ]);
    expect(out).toEqual([
      { kind: 'ngrambf_v1', expr: 'Body', ngram: 4 },
      { kind: 'tokenbf_v1', expr: 'Body' },
      { kind: 'text', expr: 'Body' },
    ]);
  });
  it('queries system.data_skipping_indices read-only', () => {
    expect(buildSkipIndicesQuery(config, 'otel_logs')).toContain("FROM system.data_skipping_indices");
  });
});

describe('index-aware wildcard compile', () => {
  it('without an index keeps ILIKE', () => {
    expect(buildSearchClause('Body : *Timeout*', config)).toBe("Body ILIKE '%Timeout%'");
    expect(buildSearchClause('Body : *Timeout*', config, buildFieldIndex([]))).toBe("Body ILIKE '%Timeout%'");
  });
  it('ngrambf on lower(Body): *term*, term*, *term use lower() LIKE', () => {
    expect(buildSearchClause('Body : *Timeout*', config, idx)).toBe("lower(Body) LIKE '%timeout%'");
    expect(buildSearchClause('*Timeout*', config, idx)).toBe("lower(Body) LIKE '%timeout%'");
    expect(buildSearchClause('Timeout*', config, idx)).toBe("lower(Body) LIKE 'timeout%'");
    expect(buildSearchClause('*Timeout', config, idx)).toBe("lower(Body) LIKE '%timeout'");
  });
  it('keeps escaping of LIKE metacharacters and quotes (same pattern literal as ILIKE, lower-cased)', () => {
    for (const q of ['*a_b%c*', "*it's*"]) {
      const plain = buildSearchClause(q, config);
      const fast = buildSearchClause(q, config, idx);
      expect(fast).toBe(plain.replace(/^Body ILIKE (.*)$/, (_m, lit: string) => `lower(Body) LIKE ${lit.toLowerCase()}`));
    }
  });
  it('keeps ILIKE for needles shorter than the n-gram size, inner wildcards, non-ASCII', () => {
    expect(buildSearchClause('*ab*', config, idx)).toBe("Body ILIKE '%ab%'");
    expect(buildSearchClause('*time*out*', config, idx)).toBe("Body ILIKE '%time%out%'");
    expect(buildSearchClause('*héllo*', config, idx)).toBe("Body ILIKE '%héllo%'");
  });
  it('index on the plain column (case-sensitive) or tokenbf is not used', () => {
    const plain = buildFieldIndex([], parseTextIndexes([{ type: 'ngrambf_v1', type_full: 'ngrambf_v1(3,1,1,0)', expr: 'Body' }]));
    expect(buildSearchClause('*Timeout*', config, plain)).toBe("Body ILIKE '%Timeout%'");
    const tok = buildFieldIndex([], parseTextIndexes([{ type: 'tokenbf_v1', type_full: 'tokenbf_v1(1,1,1)', expr: 'lower(Body)' }]));
    expect(buildSearchClause('*Timeout*', config, tok)).toBe("Body ILIKE '%Timeout%'");
  });
});
