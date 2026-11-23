/** A trailing `.:T` typed-subcolumn suffix, as typedSubcolumnSuffix() writes it. Anchored at the end so a
 *  quoted path segment holding `.:` (`Payload."a.:b"`) is never cut. */
export const TYPED_SUFFIX_RE = /\.:(?:[A-Za-z][A-Za-z0-9]*|`[A-Za-z0-9()]+`)$/;

/** The bare dotted path of a JSON field expression (drops a `.:T` typed-subcolumn suffix). */
export function stripTypedSubcolumn(sqlExpr: string): string {
  return sqlExpr.replace(TYPED_SUFFIX_RE, '');
}

const QUOTED = /"((?:[^"\\]|""|\\[\s\S])*)"/g;

/**
 * How a JSON path expression is shown: `P."a:b".:String` is `P.a:b`, as in the field list. Segments
 * that are not plain identifiers are quoted in the SQL, and a typed path ends in its type; neither
 * is part of the name. Anything that is not such a path (a Map accessor, a column) is returned as is.
 */
export function pathLabel(expr: string): string {
  const outside = expr.replace(QUOTED, '').replace(/`[^`]*`/g, '');
  if (!/[".]/.test(expr) || /[^A-Za-z0-9_.:]/.test(outside)) {
    return expr;
  }
  return stripTypedSubcolumn(expr).replace(QUOTED, (_m, seg: string) =>
    seg.replace(/""|\\([\s\S])/g, (e: string, ch?: string) => (e === '""' ? '"' : (ch ?? '')))
  );
}
