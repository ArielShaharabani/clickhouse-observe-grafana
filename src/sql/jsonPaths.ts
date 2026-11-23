/**
 * Field models for the paths of a native JSON column (FieldsContext Phase C).
 *
 * A *declared* path (`JSON(user.id UInt32)`) is a typed subcolumn already, so it is read bare
 * (`Payload.user.id`). A *dynamic* path read bare is a `Dynamic` value, which ClickHouse refuses
 * in GROUP BY and in numeric aggregates, and which `toFloat64` turns into 0 when the path is
 * missing. When the bounded type sample (buildJsonPathTypesSampleQuery) saw exactly one type for
 * such a path, and that type is a plain scalar or an array of one, the path is read as the typed
 * subcolumn `Payload.request.duration_ms.:Int64` instead: Nullable(T), NULL when missing, and
 * usable in GROUP BY and aggregates. A row whose value has another type reads NULL there, so scalar
 * filters compare the bare path's text instead (sql/fieldPredicates.ts). Anything else (mixed types, dates, decimals, not in the
 * sample) stays bare and typed 'string', which every consumer stringifies first.
 */
import { FieldModel, inferFieldType } from './fieldModel';
import { TYPED_SUFFIX_RE } from './pathLabel';
import { quoteDottedPath } from './queryBuilder';

/** Scalar types a dynamic path may be read as (exact spelling `distinctJSONPathsAndTypes` reports). */
const SCALAR_TYPE_RE = /^(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Bool|String)$/;
/** `Array(T)` / `Array(Nullable(T))` of one of the scalars above, nested arrays allowed. */
const ARRAY_TYPE_RE = /^Array\((?:Nullable\()?(?:U?Int(?:8|16|32|64|128|256)|Float(?:32|64)|Bool|String|Array\(.*\))\)?\)$/;

/** Whether `t` is a type a dynamic path can be read as (`.:T`). Also bounds what reaches the SQL. */
export function isTypedSubcolumnType(t: string): boolean {
  if (SCALAR_TYPE_RE.test(t)) {
    return true;
  }
  // Only identifier characters and parentheses: nothing that could leave the backtick quoting.
  return /^[A-Za-z0-9()]+$/.test(t) && ARRAY_TYPE_RE.test(t);
}

/** The `.:T` suffix of a typed Dynamic subcolumn (backticked when T has parentheses). */
export function typedSubcolumnSuffix(t: string): string {
  return /^[A-Za-z][A-Za-z0-9]*$/.test(t) ? `.:${t}` : `.:\`${t}\``;
}

/**
 * Parses buildJsonPathTypesSampleQuery's cell (`{"path": ["Int64", ...]}`) into path → types.
 * Malformed input yields an empty map.
 */
export function parseJsonPathTypes(cell: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!cell) {
    return out;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cell);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return out;
  }
  for (const [path, types] of Object.entries(parsed as Record<string, unknown>)) {
    if (path && Array.isArray(types)) {
      out.set(path, types.map((t) => String(t)).filter((t) => t && t !== 'None'));
    }
  }
  return out;
}

/** One JSON path as a field. `declaredType` from the column's JSON(...) type, `observed` from the sample. */
export function jsonPathField(column: string, path: string, declaredType?: string, observed?: string[]): FieldModel {
  const base = {
    id: `json:${column}:${path}`,
    name: path,
    displayName: `${column}.${path}`,
    source: 'json' as const,
    jsonColumn: column,
    jsonPath: path,
  };
  const bare = quoteDottedPath(column, path);
  if (declaredType) {
    return { ...base, sqlExpr: bare, type: inferFieldType(declaredType), rawType: declaredType };
  }
  const types = observed ?? [];
  if (types.length === 1 && isTypedSubcolumnType(types[0])) {
    const t = types[0];
    return { ...base, sqlExpr: `${bare}${typedSubcolumnSuffix(t)}`, type: inferFieldType(t), rawType: t };
  }
  // Mixed or unknown: stays a Dynamic value; 'string' so no consumer aggregates it as a number.
  return {
    ...base,
    sqlExpr: bare,
    type: 'string',
    rawType: types.length > 0 ? `Dynamic(${types.join(', ')})` : 'Dynamic',
  };
}

/** Whether `sqlExpr` ends in a scalar (non-array) `.:T` typed-subcolumn suffix. */
export function hasScalarTypedSubcolumn(sqlExpr: string): boolean {
  const m = TYPED_SUFFIX_RE.exec(sqlExpr);
  return m !== null && !m[0].startsWith('.:`');
}

export { stripTypedSubcolumn } from './pathLabel';
