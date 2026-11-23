/**
 * Matched-term highlighting for result cells (spec DISC-SEARCH-02, docs/spec/10-discover.md):
 * terms that the active KQL query and filters match on are highlighted in the grid, so users see
 * *why* a row matched. Pure — no React.
 *
 * Highlights follow the SQL that decided the match (src/sql/kql/toSql.ts):
 * - fields resolve through `resolveField` (Map keys, JSON paths, aliases), field-name wildcards
 *   expand against discovered fields, and an unresolvable `field:value` (e.g. `http://x`) is a
 *   body search on its raw text — exactly as toSql treats them;
 * - a wildcard value is one ordered pattern (`pay*d` → `pay.*?d`), not separate fragments;
 * - a quoted phrase matches on word boundaries, like toSql's phrase match;
 * - negated, exists and range terms are never highlighted.
 */
import { parseKql } from './_parser';
import { KqlNode } from './ast';
import { WILDCARD_STAR } from './_lexer';
import { FieldIndex, resolveField } from '../fields';
import { FilterPill, SelectedColumn, SourceConfig } from '../../types';

export interface HighlightTerm {
  /** SQL expressions of the columns the term applies to; null = the log body column. */
  sqlExprs: string[] | null;
  /** Regex source (case-insensitive) for the matched text. */
  pattern: string;
}

export interface HighlightContext {
  config: SourceConfig;
  fieldIndex?: FieldIndex;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WORD = 'A-Za-z0-9_';
/** Shortest literal text worth highlighting — single characters would mark nearly every cell. */
const MIN_LITERAL = 2;
/** Most literal fragments one wildcard value may highlight as a single ordered pattern. */
const MAX_PATTERN_PARTS = 2;
/** Longest cell text scanned for highlights (the rest stays plain), bounding regex work per cell. */
export const MAX_HIGHLIGHT_CHARS = 5000;

function valuePattern(value: string, isWildcard: boolean, isPhrase: boolean): string | null {
  const parts = (isWildcard ? value.split(WILDCARD_STAR) : [value]).filter((p) => p.length > 0);
  if (parts.join('').trim().length < MIN_LITERAL) {
    return null;
  }
  // Lazy gaps backtrack polynomially (n^gaps on a cell that almost matches) and the query can come
  // from a shared link: past one gap, mark only the longest literal fragment, not one ordered pattern.
  const used = parts.length > MAX_PATTERN_PARTS ? [parts.reduce((a, b) => (b.length > a.length ? b : a))] : parts;
  const core = used.map(escapeRe).join('.*?');
  return isPhrase ? `(?<![${WORD}])${core}(?![${WORD}])` : core;
}

function wildcardFields(field: string, index: FieldIndex): string[] {
  const re = new RegExp('^' + field.split(WILDCARD_STAR).map(escapeRe).join('.*') + '$', 'i');
  const exprs = new Set<string>();
  for (const f of index.byName.values()) {
    if (re.test(f.name) || re.test(f.displayName)) {
      exprs.add(f.sqlExpr);
    }
  }
  return [...exprs];
}

function fromAst(node: KqlNode, ctx: HighlightContext, out: HighlightTerm[]): void {
  switch (node.type) {
    case 'and':
    case 'or':
      fromAst(node.left, ctx, out);
      fromAst(node.right, ctx, out);
      return;
    case 'not':
    case 'range':
      return;
    case 'is': {
      if (node.isExists) {
        return;
      }
      const pattern = valuePattern(node.value, node.isWildcard, node.isPhrase);
      if (node.field === null) {
        if (pattern) {
          out.push({ sqlExprs: null, pattern });
        }
        return;
      }
      if (node.field.includes(WILDCARD_STAR) && ctx.fieldIndex) {
        if (pattern) {
          out.push({ sqlExprs: wildcardFields(node.field, ctx.fieldIndex), pattern });
        }
        return;
      }
      const resolved = resolveField(node.field, ctx.config, ctx.fieldIndex);
      if (!resolved && node.raw) {
        // toSql searches the body for the raw `field:value` text when the field doesn't resolve.
        const rawPattern = valuePattern(node.raw, false, false);
        if (rawPattern) {
          out.push({ sqlExprs: null, pattern: rawPattern });
        }
        return;
      }
      if (pattern) {
        out.push({ sqlExprs: [resolved?.sqlExpr ?? node.field], pattern });
      }
    }
  }
}

/**
 * Highlight terms for the committed search and the enabled positive filters. Raw-SQL mode → none
 * (neither the KQL search nor the filters produced the rows). Never throws.
 */
export function extractHighlightTerms(
  search: string,
  filters: FilterPill[],
  ctx: HighlightContext,
  useRawSql = false
): HighlightTerm[] {
  if (useRawSql) {
    return [];
  }
  const out: HighlightTerm[] = [];
  if (search.trim()) {
    try {
      fromAst(parseKql(search), ctx, out);
    } catch {
      // Unparsable query: no highlights rather than an error in the grid.
    }
  }
  const add = (field: string, value: string) => {
    const pattern = value.trim() ? valuePattern(value, false, false) : null;
    if (pattern) {
      const expr = resolveField(field, ctx.config, ctx.fieldIndex)?.sqlExpr ?? field;
      out.push({ sqlExprs: [expr], pattern });
    }
  };
  for (const f of filters) {
    if (f.disabled) {
      continue;
    }
    if (f.op === '=' || f.op === 'contains') {
      add(f.field, f.value);
    } else if (f.op === 'one_of') {
      for (const v of f.values ?? []) {
        add(f.field, v);
      }
    }
  }
  return out;
}

/** One compiled matcher for a column (null = nothing to highlight). Compile once per column. */
export function compileColumnHighlighter(terms: HighlightTerm[], col: SelectedColumn, bodyExpr: string): RegExp | null {
  const colExpr = col.sqlExpr.toLowerCase();
  const isBody = !!bodyExpr && colExpr === bodyExpr.toLowerCase();
  const patterns = terms
    .filter((t) => (t.sqlExprs === null ? isBody : t.sqlExprs.some((e) => e.toLowerCase() === colExpr)))
    .map((t) => t.pattern);
  const unique = [...new Set(patterns)].sort((a, b) => b.length - a.length);
  return unique.length > 0 ? new RegExp(unique.join('|'), 'gi') : null;
}

export interface HighlightRun {
  text: string;
  match: boolean;
}

/** Split `text` into runs, marking every match of `matcher`. */
export function splitHighlights(text: string, matcher: RegExp | null): HighlightRun[] {
  if (!text || !matcher) {
    return [{ text, match: false }];
  }
  const runs: HighlightRun[] = [];
  let last = 0;
  for (const m of text.slice(0, MAX_HIGHLIGHT_CHARS).matchAll(new RegExp(matcher.source, matcher.flags))) {
    const start = m.index ?? 0;
    if (m[0].length === 0) {
      continue;
    }
    if (start > last) {
      runs.push({ text: text.slice(last, start), match: false });
    }
    runs.push({ text: m[0], match: true });
    last = start + m[0].length;
  }
  if (last < text.length) {
    runs.push({ text: text.slice(last), match: false });
  }
  return runs.length > 0 ? runs : [{ text, match: false }];
}
