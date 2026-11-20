/**
 * Text skip indexes on a logs table (ngrambf_v1 / tokenbf_v1 / text), read from
 * system.data_skipping_indices. Read-only: the plugin never creates indexes.
 *
 * Only one form is currently compiled against an index: `lower(<col>) LIKE '<lowercased pattern>'`
 * when an `ngrambf_v1` index is defined on exactly `lower(<col>)`. That is row-for-row identical to
 * the existing `<col> ILIKE '<pattern>'` (both fold ASCII case) while letting ClickHouse use the
 * n-gram filter to skip granules. Why not the other forms:
 *   - hasToken / tokenbf_v1 / text index match whole tokens, but KQL `*Timeout*` is a substring
 *     match ("timeouts", "ReadTimeoutError" must match too), so hasToken would drop rows;
 *   - an index on the plain column accelerates case-sensitive LIKE only, not ILIKE, and rewriting
 *     to LIKE would change which rows match.
 * tokenbf_v1 / text indexes are still parsed so callers and docs can report what was found.
 */
import { SourceConfig } from '../types';
import { quoteString } from './queryBuilder';
import { configSettingsFragments, withSettings } from './settings';

export type TextIndexKind = 'ngrambf_v1' | 'tokenbf_v1' | 'text';

export interface TextIndexInfo {
  kind: TextIndexKind;
  /** The indexed expression, normalised (no backticks / whitespace), original case. */
  expr: string;
  /** n-gram size for ngrambf_v1. */
  ngram?: number;
}

export function buildSkipIndicesQuery(config: SourceConfig, table: string): string {
  return withSettings(
    [
      `SELECT name, type, type_full, expr`,
      `FROM system.data_skipping_indices`,
      `WHERE database = ${quoteString(config.database)} AND table = ${quoteString(table)}`,
    ],
    configSettingsFragments(config)
  );
}

export function normalizeIndexExpr(expr: string): string {
  return expr.replace(/[`"\s]/g, '');
}

/** Rows of buildSkipIndicesQuery -> the text indexes among them. */
export function parseTextIndexes(rows: Array<Record<string, unknown>>): TextIndexInfo[] {
  const out: TextIndexInfo[] = [];
  for (const r of rows) {
    const type = String(r['type'] ?? '').toLowerCase();
    const expr = normalizeIndexExpr(String(r['expr'] ?? ''));
    if (!expr) {
      continue;
    }
    if (type === 'ngrambf_v1') {
      const n = Number(/\(\s*(\d+)/.exec(String(r['type_full'] ?? ''))?.[1]);
      out.push({ kind: 'ngrambf_v1', expr, ngram: Number.isFinite(n) && n > 0 ? n : 3 });
    } else if (type === 'tokenbf_v1') {
      out.push({ kind: 'tokenbf_v1', expr });
    } else if (type === 'text' || type === 'full_text' || type === 'inverted') {
      out.push({ kind: 'text', expr });
    }
  }
  return out;
}

/** An ngrambf_v1 index defined on exactly `lower(<columnSql>)`, or undefined. */
export function findLowerNgramIndex(indexes: TextIndexInfo[] | undefined, columnSql: string): TextIndexInfo | undefined {
  if (!indexes?.length) {
    return undefined;
  }
  const want = `lower(${normalizeIndexExpr(columnSql)})`.toLowerCase();
  return indexes.find((i) => i.kind === 'ngrambf_v1' && i.expr.toLowerCase() === want);
}

/**
 * Index-aware form of `<col> ILIKE '<likePattern>'` (pattern already LIKE-escaped, unquoted), or
 * null to keep the plain ILIKE. Applies only to `%lit%`, `lit%`, `%lit` with one ASCII literal of
 * at least the index's n-gram size (shorter needles cannot use the filter anyway).
 */
export function indexedIlike(columnSql: string, likePattern: string, indexes: TextIndexInfo[] | undefined): string | null {
  const idx = findLowerNgramIndex(indexes, columnSql);
  if (!idx) {
    return null;
  }
  const core = likePattern.replace(/^%+/, '').replace(/(?<!\\)%+$/, '');
  // An unescaped % or _ inside means several literals / single-char wildcards: keep ILIKE.
  if (/(^|[^\\])(\\\\)*[%_]/.test(core) || !/^[ -~]+$/.test(core)) {
    return null;
  }
  const literalLen = core.replace(/\\(.)/g, '$1').length;
  if (literalLen < (idx.ngram ?? 3)) {
    return null;
  }
  const lowered = likePattern.replace(/[A-Z]/g, (ch) => ch.toLowerCase());
  return `lower(${columnSql}) LIKE ${quoteString(lowered)}`;
}
