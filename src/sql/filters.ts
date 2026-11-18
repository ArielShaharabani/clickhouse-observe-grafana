/**
 * Filter pill state management.
 * Adapted from grafana/clickhouse-datasource src/data/adHocFilter.ts (Apache-2.0).
 */

import { FilterPill, FilterOp } from '../types';

/** Every operator a pill may carry; anything else in a link is dropped (see sanitizeFilterPills). */
export const FILTER_OPS: readonly FilterOp[] = [
  '=', '!=', 'contains', 'not_contains', 'one_of', 'not_one_of', 'exists', 'not_exists',
  'gte', 'lt', 'between', 'not_between',
];

/**
 * Keeps only well-formed pills from untrusted input (a URL): `op` must be a known FilterOp, `field`
 * a string, `value` a string (a missing one becomes ''), `values` an array of strings when present,
 * `label` a string when present. A missing id is generated. Anything else is dropped.
 */
export function sanitizeFilterPills(raw: unknown[]): FilterPill[] {
  const out: FilterPill[] = [];
  for (const p of raw) {
    if (typeof p !== 'object' || p === null) {
      continue;
    }
    const r = p as Record<string, unknown>;
    if (typeof r.op !== 'string' || !(FILTER_OPS as readonly string[]).includes(r.op) || typeof r.field !== 'string') {
      continue;
    }
    if (r.value !== undefined && typeof r.value !== 'string') {
      continue;
    }
    if (r.values !== undefined && !(Array.isArray(r.values) && r.values.every((v) => typeof v === 'string'))) {
      continue;
    }
    if (r.label !== undefined && typeof r.label !== 'string') {
      continue;
    }
    out.push({
      ...(r as unknown as FilterPill),
      id: typeof r.id === 'string' && r.id ? r.id : nextId(),
      value: (r.value as string | undefined) ?? '',
    });
  }
  return out;
}

let _idCounter = 0;
/** Fresh unique pill id. */
export function nextId(): string {
  return `f${Date.now()}_${_idCounter++}`;
}

/**
 * True when two pills are functionally identical — same field, op, and value(s). Used to dedupe a
 * true re-add of the exact same pill (a no-op), NOT to decide whether a *different* value on the
 * same field+op should replace the existing pill. Two `!=` (or `contains`/`not_contains`) pills on
 * one field with different values are meant to coexist (AND semantics: `x != 'a' AND x != 'b'`) —
 * comparing field+op alone (the previous behavior) silently dropped the first one whenever a
 * second "Filter out"/"Filter contains" action targeted the same field with a new value.
 * `values` (one_of/not_one_of) compared order-insensitively — the same set typed/clicked in a
 * different order is still the same filter.
 */
export function samePill(
  a: Pick<FilterPill, 'field' | 'op' | 'value' | 'values'>,
  b: Pick<FilterPill, 'field' | 'op' | 'value' | 'values'>
): boolean {
  if (a.field !== b.field || a.op !== b.op) {
    return false;
  }
  if (a.op === 'between' || a.op === 'not_between') {
    // A range is an ordered pair: [1, 5] and [5, 1] are different filters.
    const av = a.values ?? [];
    const bv = b.values ?? [];
    return av.length === bv.length && av.every((v, i) => v === bv[i]);
  }
  if (a.values || b.values) {
    const av = [...(a.values ?? [])].sort();
    const bv = [...(b.values ?? [])].sort();
    return av.length === bv.length && av.every((v, i) => v === bv[i]);
  }
  return a.value === b.value;
}

const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?)?Z?$/;

/** A finite decimal number literal ("5", "-1.5", "1e3"). */
export function isNumericBound(v: string): boolean {
  return NUMBER_RE.test(v.trim());
}

/** An ISO-like date or date-time ("2026-01-05", "2026-01-05 09:00:00", "2026-01-05T09:00:00.5Z"). */
export function isDateBound(v: string): boolean {
  const t = v.trim();
  return DATE_RE.test(t) && !Number.isNaN(Date.parse(t.replace(' ', 'T')));
}

export function addFilter(
  filters: FilterPill[],
  field: string,
  value: string,
  op: FilterOp = '='
): FilterPill[] {
  // Dedupe an exact re-add of the same field+op+value only — see samePill's doc comment for why
  // field+op alone is wrong here.
  const deduplicated = filters.filter((f) => !samePill(f, { field, op, value }));
  return [...deduplicated, { id: nextId(), field, value, op }];
}

export function removeFilter(filters: FilterPill[], id: string): FilterPill[] {
  return filters.filter((f) => f.id !== id);
}

export function toggleFilter(
  filters: FilterPill[],
  field: string,
  value: string,
  include: boolean
): FilterPill[] {
  const op: FilterOp = include ? '=' : '!=';
  return addFilter(filters, field, value, op);
}

/** Create a FilterPill from a field+value+op with a generated id. */
export function makeFilter(
  field: string,
  value: string,
  op: FilterOp = '=',
  extras?: { values?: string[]; label?: string }
): FilterPill {
  return { id: nextId(), field, value, op, ...extras };
}

/**
 * Add a fully-constructed pill to the filter list, deduping an exact re-add (same field+op+value,
 * or same field+op+values set for one_of/not_one_of) — see samePill's doc comment. A different
 * value on the same field+op appends as a second pill rather than replacing the first.
 * Preserves `values` and `label` on the incoming pill — use this instead of
 * `addFilter` when the pill may carry multi-value or custom-label data.
 */
export function addFilterPill(filters: FilterPill[], pill: FilterPill): FilterPill[] {
  const deduplicated = filters.filter((f) => !samePill(f, pill));
  return [...deduplicated, pill];
}

/** Replace one pill by id with a patched copy (edit-save). No-op if the id isn't found. */
export function updateFilter(filters: FilterPill[], id: string, patch: Partial<FilterPill>): FilterPill[] {
  return filters.map((f) => (f.id === id ? { ...f, ...patch, id: f.id } : f));
}

/** Toggle a pill's `disabled` flag in place (id-preserving). */
export function toggleDisabled(filters: FilterPill[], id: string): FilterPill[] {
  return filters.map((f) => (f.id === id ? { ...f, disabled: !f.disabled } : f));
}

const NEGATED_OP: Record<FilterOp, FilterOp> = {
  '=': '!=',
  '!=': '=',
  contains: 'not_contains',
  not_contains: 'contains',
  one_of: 'not_one_of',
  not_one_of: 'one_of',
  exists: 'not_exists',
  not_exists: 'exists',
  gte: 'lt',
  lt: 'gte',
  between: 'not_between',
  not_between: 'between',
};

/** Flip a pill's polarity (Exclude results / Include results in the pill menu). */
export function negateFilter(pill: FilterPill): FilterPill {
  return { ...pill, op: NEGATED_OP[pill.op] };
}

/** Human-readable label for a filter pill. */
export function filterLabel(f: FilterPill): string {
  // Custom label takes priority
  if (f.label) {
    return f.label;
  }
  if (f.op === 'exists') {
    return `${f.field} exists`;
  }
  if (f.op === 'not_exists') {
    return `${f.field} does not exist`;
  }
  if (f.op === 'one_of' || f.op === 'not_one_of') {
    const vals = (f.values ?? [f.value]).filter(Boolean).join(', ');
    return f.op === 'one_of'
      ? `${f.field} is one of [${vals}]`
      : `${f.field} is not one of [${vals}]`;
  }
  if (f.op === 'between' || f.op === 'not_between') {
    const [lo = '', hi = ''] = f.values ?? [];
    return `${f.field} ${f.op === 'between' ? 'is between' : 'is not between'} ${lo} and ${hi}`;
  }
  if (f.value === '' && f.op === '=') {
    return `${f.field} is empty`;
  }
  const opSymbol: Record<FilterOp, string> = {
    '=': '=',
    '!=': '≠',
    contains: '~',
    not_contains: '!~',
    one_of: 'in',
    not_one_of: 'not in',
    exists: 'exists',
    not_exists: '!exists',
    gte: '≥',
    lt: '<',
    between: 'between',
    not_between: 'not between',
  };
  return `${f.field} ${opSymbol[f.op]} ${f.value}`;
}
