/**
 * Field names a KQL query refers to that don't exist in the data view (Kibana warns about these;
 * without it `nosuchfield : x` silently becomes a body text search). Pure: walks the parsed AST
 * and asks the same `resolveField` the SQL compiler uses, so the warning and the generated SQL
 * can never disagree about what a name means.
 */
import { SourceConfig } from '../../types';
import { FieldIndex, resolveField } from '../fields';
import { KqlNode } from './ast';
import { parseKql } from './_parser';
import { WILDCARD_RE } from './_lexer';

const MAX_REPORTED = 5;

function collect(node: KqlNode, out: Set<string>, config: SourceConfig, index: FieldIndex) {
  switch (node.type) {
    case 'and':
    case 'or':
      collect(node.left, out, config, index);
      collect(node.right, out, config, index);
      return;
    case 'not':
      collect(node.operand, out, config, index);
      return;
    case 'is':
    case 'range': {
      const field = node.field;
      // Bare terms have no field; a wildcard field name matches discovered fields by pattern.
      if (!field || field.includes('*') || WILDCARD_RE.test(field)) {
        return;
      }
      if (resolveField(field, config, index) === null) {
        out.add(field);
      }
      return;
    }
  }
}

/** Unknown field names in `query` (first occurrence order, at most a handful). Empty when the
 *  query doesn't parse or no fields have been discovered yet (nothing to compare against). */
export function unknownKqlFields(query: string, config: SourceConfig, index: FieldIndex): string[] {
  if (!query.trim() || index.bySqlExpr.size === 0) {
    return [];
  }
  let ast: KqlNode | null | undefined;
  try {
    ast = parseKql(query);
  } catch {
    return [];
  }
  if (!ast) {
    return [];
  }
  const out = new Set<string>();
  collect(ast, out, config, index);
  return [...out].slice(0, MAX_REPORTED);
}
