/**
 * Translate a KQL AST node into a ClickHouse WHERE clause fragment.
 *
 * Reuses existing helpers from the parent sql/ package:
 *   resolveField                     (../fields)
 *   quoteString / quoteIdentifier / escapeLike (../queryBuilder)
 */

import { KqlNode, KqlIs, KqlRange } from './ast';
import { WILDCARD_STAR, WILDCARD_RE } from './_lexer';
import { SourceConfig } from '../../types';
import { resolveField, FieldIndex, FieldKind, ResolvedField } from '../fields';
import { FieldModel } from '../fieldModel';
import { quoteString, quoteIdentifier, escapeLike } from '../queryBuilder';
import { indexedIlike } from '../textIndex';

export function kqlToSql(node: KqlNode, config: SourceConfig, index?: FieldIndex): string {
  switch (node.type) {
    case 'and':
      return `(${kqlToSql(node.left, config, index)}) AND (${kqlToSql(node.right, config, index)})`;
    case 'or':
      return `(${kqlToSql(node.left, config, index)}) OR (${kqlToSql(node.right, config, index)})`;
    case 'not': {
      const inner = kqlToSql(node.operand, config, index);
      // '1=1' is a no-op sentinel (unresolvable field) — negating it would
      // wrongly turn "ignore this clause" into "exclude everything".
      return inner === '1=1' ? '1=1' : `NOT (${inner})`;
    }
    case 'is':
      return kqlIsToSql(node, config, index);
    case 'range':
      return kqlRangeToSql(node, config, index);
  }
}

// ── is ────────────────────────────────────────────────────────────────────────

function kqlIsToSql(node: KqlIs, config: SourceConfig, index?: FieldIndex): string {
  const bodyCol = config.columns.body;

  // ── Bare term (no field) → body search ──────────────────────────────────
  if (node.field === null) {
    if (!bodyCol) {
      return '1=1'; // body column not mapped — ignore bare terms rather than emit broken SQL
    }
    return bareTermSql(bodyCol, node.value, node.isWildcard, node.isPhrase, index);
  }

  // ── Field-name wildcard: data*: 5 / datastream.*: logs — matches KQL, which lets a wildcard
  // stand in for the field too. Only expandable against real discovered fields (`index`); without
  // one this falls through to the ordinary unresolved-field handling below.
  if (index && WILDCARD_RE.test(node.field)) {
    return fieldWildcardSql(node, node.field, config, index);
  }

  // ── Exists: field:* ──────────────────────────────────────────────────────
  if (node.isExists) {
    const resolved = resolveField(node.field, config, index);
    // Unresolved → direct column reference, same fallback kqlIsToSql/kqlRangeToSql use below.
    const expr = resolved?.sqlExpr ?? node.field;
    return existsSql(maybeQuote(expr), resolved);
  }

  // ── Named field ──────────────────────────────────────────────────────────
  const resolved = resolveField(node.field, config, index);

  if (resolved === null) {
    // Unknown field. With `index` present — real discovered columns were threaded through, so
    // "unresolved" genuinely means "not a column" — fall back to a plain-text body search over
    // the original `field:value` text instead of emitting a broken direct-column reference
    // (`"http" = '//x'` from typing `http://x` → ClickHouse "Unknown identifier" error).
    // Without an index (e.g. dashboard-panel export, which doesn't thread field discovery
    // through — see fields.ts:56-59) keep the historical direct-column fallback so that caller
    // doesn't silently regress into body-only search.
    if (index && node.raw !== undefined) {
      if (!bodyCol) {
        return '1=1';
      }
      return bareTermSql(bodyCol, node.raw, WILDCARD_RE.test(node.raw), false, index);
    }
    return valueSql(node, node.field, 'exact', index);
  }

  return valueSql(node, resolved.sqlExpr, resolved.kind, index, resolved);
}

/**
 * `field:*`. notEmpty(toString(expr)) works for String, Map, numeric and JSON paths (a missing
 * typed JSON subcolumn is NULL); an array is present when it has an element, and a whole JSON
 * column when it has any path (its text is never empty: `{}`).
 */
function existsSql(expr: string, resolved: ResolvedField | null | undefined): string {
  if (resolved?.jsonContainer) {
    return `notEmpty(JSONAllPaths(${expr}))`;
  }
  if (resolved?.array) {
    return `notEmpty(${expr})`;
  }
  if (resolved?.kind === 'json') {
    // NULL-safe, so `not field:*` matches the rows without the path (NOT NULL is NULL, not true).
    return `notEmpty(ifNull(toString(${expr}), ''))`;
  }
  return `notEmpty(toString(${expr}))`;
}

/**
 * Emit the SQL for a resolved (or direct-column-fallback) field + value, shared by the normal
 * path and field-wildcard expansion below — both need the same wildcard/phrase/typed-literal
 * handling per matched column.
 */
function valueSql(node: KqlIs, sqlExpr: string, kind: FieldKind, index?: FieldIndex, resolved?: ResolvedField): string {
  const val = node.value;

  // A whole JSON column has no single value to compare (`Payload: x` used to fail parsing 'x' as
  // JSON): like an object field in Kibana, a value query on it matches nothing.
  if (resolved?.jsonContainer) {
    return '0';
  }
  // A JSON path holding an array matches when any element does (Kibana's multi-value semantics);
  // `arr = 'x'` itself fails in ClickHouse ("Array does not start with '['").
  if (resolved?.array) {
    const el = node.isWildcard
      ? `toString(x) ILIKE ${quoteString(wildcardLike(val))}`
      : `toString(x) = ${quoteString(val)}`;
    return `arrayExists(x -> ${el}, ${maybeQuote(sqlExpr)})`;
  }

  // Wildcard — applies to all field kinds (text, exact, map).
  // Check before isPhrase so "err*" with quotes can't override.
  if (node.isWildcard) {
    // A JSON path can be numeric / boolean, which ILIKE refuses ("Illegal type UInt32").
    const lhs = kind === 'json' ? `toString(${maybeQuote(sqlExpr)})` : maybeQuote(sqlExpr);
    return ilikeSql(lhs, wildcardLike(val), index);
  }

  // Phrase — behavior is field-kind-dependent:
  //   text  → word-boundary match() (full-text semantics)
  //   exact / map → exact equality (keyword-field semantics, quotes = precision; quoted values
  //                 are never typed as true/false/null — QuotedString always stays a string)
  if (node.isPhrase) {
    if (kind === 'text') {
      return phraseMatch(maybeQuote(sqlExpr), val);
    }
    return `${maybeQuote(sqlExpr)} = ${quoteString(val)}`;
  }

  // Unquoted text column → substring contains (full-text behaviour).
  if (kind === 'text') {
    return ilikeSql(maybeQuote(sqlExpr), '%' + escapeLike(val) + '%', index);
  }

  // Unquoted exact / map / json column → equality, with true/false/null typed literals (the KQL
  // grammar's UnquotedLiteral converts these three exact-case sequences to typed nodes rather
  // than strings).
  return equalsSql(maybeQuote(sqlExpr), val);
}

function equalsSql(sqlExpr: string, value: string): string {
  if (value === 'true')  { return `${sqlExpr} = true`;  }
  if (value === 'false') { return `${sqlExpr} = false`; }
  if (value === 'null')  { return `${sqlExpr} IS NULL`; }
  return `${sqlExpr} = ${quoteString(value)}`;
}

/**
 * `data*: 5` / `datastream.*: logs` — the field position itself carries a wildcard sentinel.
 * Expand it against every discovered field (`index`) whose name/displayName/sqlExpr matches, and
 * OR the per-field clause together — mirrors Elasticsearch matching the value across every field
 * the wildcard covers. No matches → 1=0 (matches nothing; NOT of it correctly matches everything).
 */
function fieldWildcardSql(node: KqlIs, field: string, config: SourceConfig, index: FieldIndex): string {
  const pattern = wildcardFieldRegex(field);
  const matched = new Map<string, FieldModel>(); // dedupe by sqlExpr
  for (const f of index.byName.values()) {
    if (pattern.test(f.name) || pattern.test(f.displayName)) {
      matched.set(f.sqlExpr, f);
    }
  }
  if (matched.size === 0) {
    return '1=0';
  }
  const clauses = Array.from(matched.values()).map((f) => {
    const resolved = resolveField(f.sqlExpr, config, index);
    if (node.isExists) {
      return existsSql(maybeQuote(f.sqlExpr), resolved);
    }
    return valueSql(node, f.sqlExpr, resolved?.kind ?? 'exact', index, resolved ?? undefined);
  });
  return clauses.length === 1 ? clauses[0] : clauses.map((c) => `(${c})`).join(' OR ');
}

/** Convert a field name containing WILDCARD_STAR sentinels into a case-insensitive regex. */
function wildcardFieldRegex(fieldWithSentinel: string): RegExp {
  const escaped = fieldWithSentinel
    .split(WILDCARD_STAR)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + '$', 'i');
}

// ── range ─────────────────────────────────────────────────────────────────────

const OP_MAP: Record<string, string> = {
  gt: '>', gte: '>=', lt: '<', lte: '<=',
};

function kqlRangeToSql(node: KqlRange, config: SourceConfig, index?: FieldIndex): string {
  const resolved = resolveField(node.field, config, index);
  // Unknown field: use the field name as a direct column, same as kqlIsToSql.
  const { sqlExpr, kind } = resolved ?? { sqlExpr: node.field, kind: 'exact' as const };
  const op = OP_MAP[node.op];
  const numVal = Number(node.value);
  const isNumeric = Number.isFinite(numVal) && node.value.trim() !== '';
  const sqlVal = isNumeric ? String(numVal) : quoteString(node.value);
  // Map attribute values are always String in ClickHouse, and a JSON path's dynamic value isn't
  // guaranteed to compare correctly against a numeric literal either. For numeric range
  // comparisons on either kind, cast to Float64 so the comparison works correctly.
  // (e.g. LogAttributes['response_time_ms'] > 1000 would fail without cast.)
  // A JSON path goes through toFloat64OrNull(toString(...)): a missing path (NULL, or '' for a bare
  // Dynamic) or a non-numeric value then never matches — `toFloat64` read a missing Dynamic value
  // as 0 (so `< 100` matched every row without the path) and threw on text like 'dave'.
  const lhs = !isNumeric
    ? maybeQuote(sqlExpr)
    : kind === 'json'
      ? `toFloat64OrNull(toString(${maybeQuote(sqlExpr)}))`
      : kind === 'map'
        ? `toFloat64(${maybeQuote(sqlExpr)})`
        : maybeQuote(sqlExpr);
  return `${lhs} ${op} ${sqlVal}`;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function bareTermSql(bodyCol: string, value: string, isWildcard: boolean, isPhrase: boolean, index?: FieldIndex): string {
  if (isWildcard) {
    // Bare wildcard e.g. pay* → prefix/suffix/infix on body
    return ilikeSql(bodyCol, wildcardLike(value), index);
  }
  if (isPhrase) {
    return phraseMatch(bodyCol, value);
  }
  // No hasToken() here — it throws BAD_ARGUMENTS on any needle containing a separator character
  // (`-`, `.`, `:`, `/`, space — all common in log search terms like "req-59" or "1.2.3.4"), and is
  // redundant even when it doesn't throw: everything a case-sensitive whole-token hasToken() match
  // can find, the case-insensitive substring ILIKE below already finds too. See C3 in the audit plan.
  return ilikeSql(bodyCol, '%' + escapeLike(value) + '%', index);
}

/**
 * `col ILIKE 'pattern'`, or - when a text skip index on `lower(col)` was discovered - the
 * equivalent `lower(col) LIKE 'lowercased pattern'` the index can serve (see sql/textIndex.ts).
 * Escaping is unchanged: the pattern arrives already LIKE-escaped and is quoted the same way.
 */
function ilikeSql(col: string, likePattern: string, index?: FieldIndex): string {
  return indexedIlike(col, likePattern, index?.textIndexes) ?? `${col} ILIKE ${quoteString(likePattern)}`;
}

/**
 * Convert a wildcard IDENT value (containing sentinels) to an ILIKE pattern.
 * Escapes literal %, _, \ first, then substitutes the wildcard sentinel with %.
 */
function wildcardLike(value: string): string {
  return escapeLike(value).replace(new RegExp(WILDCARD_STAR, 'g'), '%');
}

/**
 * Generates a ClickHouse match() call with word-boundary assertions.
 * Uses [^a-zA-Z0-9_] instead of \W to avoid backslash-escaping ambiguity
 * in SQL string literals.
 * Prevents "req-59" from matching "req-592".
 *
 * The regex pattern is built in plain JS and passed through quoteString() — same as any other
 * SQL string literal — so a literal ' in the search text (e.g. Body:"it's fine") can't break out
 * of the string, and regex escapes survive ClickHouse's own string-literal unescaping (quoteString
 * doubles backslashes, so `\.` in the source pattern arrives as `\\.` in SQL, which ClickHouse
 * reads back as `\.` — a literal-dot escape for re2 — instead of collapsing to a bare `.`).
 */
function phraseMatch(col: string, value: string): string {
  const pattern = `(?i)(^|[^a-zA-Z0-9_])${escapeRe2(value)}([^a-zA-Z0-9_]|$)`;
  return `match(${col}, ${quoteString(pattern)})`;
}

/** Escape re2 metacharacters within a literal string segment. */
function escapeRe2(s: string): string {
  return s.replace(/[.+*?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Quote a SQL expression only if it doesn't already contain special characters
 * that indicate it's already a complex expression (map accessor, function call, etc.).
 */
function maybeQuote(expr: string): string {
  return quoteIdentifier(expr);
}
