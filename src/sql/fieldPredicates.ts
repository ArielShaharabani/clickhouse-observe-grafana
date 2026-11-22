/**
 * Per-field predicate shapes shared by the KQL compiler (kql/toSql.ts) and filter pills
 * (queryBuilder.ts buildFilterClause), so both read a field kind the same way. Every `expr`
 * arrives already quoted (quoteIdentifier) and every value already escaped by the caller.
 *
 *  - a whole JSON column (`jsonContainer`) is present when it holds any path; its text is never
 *    empty (`{}`), and it has no single value to compare;
 *  - a JSON array path is present when it has an element, and matches a value when any element does
 *    (`arr = 'x'` itself fails in ClickHouse), its text is never empty either (`[]`);
 *  - a JSON path is NULL where missing, so presence is NULL-safe (`NOT NULL` is NULL, not true);
 *  - a dynamic JSON path read as a typed subcolumn (`a.b.:Int64`, see jsonPaths.ts) is NULL on rows
 *    whose value has another type than the sampled one, and `typed = 'abc'` throws. Scalar filters
 *    therefore read the bare path as text (`toString(a.b)`), which keeps every row's value; the
 *    typed form stays for GROUP BY / aggregates (where Dynamic is refused) and for arrays.
 */
import type { ResolvedField } from './fields';
import { stripTypedSubcolumn, hasScalarTypedSubcolumn } from './jsonPaths';

export type PredicateField = Pick<ResolvedField, 'kind' | 'array' | 'jsonContainer'> | null | undefined;

/** The expression scalar filters read: the bare path of a typed scalar JSON subcolumn, else `expr`. */
function filterExpr(expr: string, f: PredicateField): string {
  return f?.kind === 'json' && !f.array && hasScalarTypedSubcolumn(expr) ? stripTypedSubcolumn(expr) : expr;
}

/** Whether filters on this field compare its text rather than its typed value. */
export function comparesAsText(expr: string, f: PredicateField): boolean {
  return filterExpr(expr, f) !== expr;
}

/** `field:*` / "exists". */
export function existsPredicate(expr: string, f: PredicateField): string {
  if (f?.jsonContainer) {
    return `notEmpty(JSONAllPaths(${expr}))`;
  }
  if (f?.array) {
    return `notEmpty(${expr})`;
  }
  if (f?.kind === 'json') {
    return `notEmpty(ifNull(toString(${filterExpr(expr, f)}), ''))`;
  }
  return `notEmpty(toString(${expr}))`;
}

/** "does not exist" — the exact complement of existsPredicate (never NULL). */
export function missingPredicate(expr: string, f: PredicateField): string {
  if (f?.jsonContainer) {
    return `empty(JSONAllPaths(${expr}))`;
  }
  if (f?.array) {
    return `empty(${expr})`;
  }
  if (f?.kind === 'json') {
    return `empty(ifNull(toString(${filterExpr(expr, f)}), ''))`;
  }
  return `empty(toString(${expr}))`;
}

/** Left side of an ILIKE: a JSON path can be numeric / boolean, which ILIKE refuses. */
export function likeLhs(expr: string, f: PredicateField): string {
  return f?.kind === 'json' ? `toString(${filterExpr(expr, f)})` : expr;
}

/** Left side of `= 'v'` / `IN (...)`: the text of a typed scalar JSON subcolumn, else `expr`. */
export function equalsLhs(expr: string, f: PredicateField): string {
  return comparesAsText(expr, f) ? `toString(${filterExpr(expr, f)})` : expr;
}

/** The expression `IS NULL` tests (the bare path: a typed subcolumn is NULL for other types too). */
export function nullLhs(expr: string, f: PredicateField): string {
  return filterExpr(expr, f);
}

/** Numeric reading of a Map value / JSON path: NULL when missing or not a number (never 0). */
export function numericLhs(expr: string, f: PredicateField): string {
  return `toFloat64OrNull(toString(${filterExpr(expr, f)}))`;
}

/** Any element of an array path matches: `toString(x) = 'v'`, or ILIKE for a LIKE pattern. */
export function anyElementPredicate(arrayExpr: string, quotedValue: string, like: boolean): string {
  return `arrayExists(x -> toString(x) ${like ? 'ILIKE' : '='} ${quotedValue}, ${arrayExpr})`;
}
