/**
 * Matched-term highlighting for result cells (spec DISC-SEARCH-02, docs/spec/10-discover.md):
 * terms that the active KQL query and filters match on are highlighted in the grid, so users see
 * *why* a row matched. Pure — no React.
 */
import { parseKql } from './_parser';
import { KqlNode } from './ast';
import { WILDCARD_STAR } from './_lexer';
import { FilterPill, SelectedColumn } from '../../types';

export interface HighlightTerm {
  /** Field the term applies to; null = bare term (matched against the log body). */
  field: string | null;
  text: string;
}

function fromAst(node: KqlNode, out: HighlightTerm[]): void {
  switch (node.type) {
    case 'and':
    case 'or':
      fromAst(node.left, out);
      fromAst(node.right, out);
      return;
    case 'not':
      // A negated term never appears in matching rows — nothing to highlight.
      return;
    case 'range':
      return;
    case 'is': {
      if (node.isExists) {
        return;
      }
      // The lexer marks an unescaped * with a private-use sentinel (an escaped \* stays a literal *).
      const parts = node.isWildcard ? node.value.split(WILDCARD_STAR) : [node.value];
      for (const text of parts) {
        if (text.trim()) {
          out.push({ field: node.field, text });
        }
      }
    }
  }
}

/** Highlight terms from the search and the enabled positive filters. Never throws. */
export function extractHighlightTerms(search: string, filters: FilterPill[]): HighlightTerm[] {
  const out: HighlightTerm[] = [];
  if (search.trim()) {
    try {
      fromAst(parseKql(search), out);
    } catch {
      // Unparsable query: no highlights rather than an error in the grid.
    }
  }
  for (const f of filters) {
    if (f.disabled) {
      continue;
    }
    if ((f.op === '=' || f.op === 'contains') && f.value) {
      out.push({ field: f.field, text: f.value });
    } else if (f.op === 'one_of') {
      for (const v of f.values ?? []) {
        out.push({ field: f.field, text: v });
      }
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase();

/** Terms that apply to `col`: its own field's terms, plus bare terms on the body column. */
export function termsForColumn(terms: HighlightTerm[], col: SelectedColumn, bodyExpr: string): string[] {
  const names = new Set([col.sqlExpr, col.displayName, col.key].map(norm));
  const isBody = !!bodyExpr && col.sqlExpr === bodyExpr;
  return terms
    .filter((t) => (t.field === null ? isBody : names.has(norm(t.field))))
    .map((t) => t.text);
}

export interface HighlightRun {
  text: string;
  match: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Split `text` into runs, marking case-insensitive occurrences of any term (longest first). */
export function splitHighlights(text: string, terms: string[]): HighlightRun[] {
  const usable = [...new Set(terms.filter((t) => t.length > 0))].sort((a, b) => b.length - a.length);
  if (!text || usable.length === 0) {
    return [{ text, match: false }];
  }
  const re = new RegExp(usable.map(escapeRe).join('|'), 'gi');
  const runs: HighlightRun[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
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
