/** The queries behind what Discover shows now, as executed (Inspect SQL). */
import { flattenSpanTree } from './spanTree';
import { Span } from './types';

export interface ExecutedQuery {
  id: string;
  label: string;
  sql: string;
}

const STATUS: Partial<Record<Span['status'], string>> = { running: 'running', error: 'failed', cancelled: 'cancelled' };

function describe(s: Span): string {
  const parts = [STATUS[s.status]];
  if (s.status === 'ok' && typeof s.attrs.rowCount === 'number') {
    parts.push(`${s.attrs.rowCount} row${s.attrs.rowCount === 1 ? '' : 's'}`);
  }
  if (s.endMs != null) {
    parts.push(`${Math.round(s.endMs - s.startMs)} ms`);
  }
  const text = parts.filter(Boolean).join(', ');
  return text ? ` (${text})` : '';
}

/**
 * The latest document search (every time window it tried; the last one gave the rows shown), what
 * was loaded after it, and the latest histogram query.
 */
export function executedQueries(roots: readonly Span[]): ExecutedQuery[] {
  const spans = roots
    .flatMap((r) => flattenSpanTree(r).map((x) => x.span))
    .filter((s) => typeof s.attrs.executedSql === 'string')
    .sort((a, b) => a.startMs - b.startMs);
  const last = (kind: Span['kind']) => spans.filter((s) => s.kind === kind).pop();
  const logs = last('logs');
  const group = (s: Span) => (s.attrs.group ? spans.filter((x) => x.attrs.group === s.attrs.group) : [s]);
  const list = (items: Span[], name: string): ExecutedQuery[] =>
    items.map((s, i) => ({
      id: s.id,
      label: `${name}${items.length > 1 ? `, step ${i + 1} of ${items.length}` : ''}${describe(s)}`,
      sql: s.attrs.executedSql as string,
    }));
  const more = logs ? spans.filter((s) => s.kind === 'loadMore' && s.startMs > logs.startMs) : [];
  const volume = last('volume');
  return [
    ...(logs ? list(group(logs), 'Documents') : []),
    ...list(more, 'More documents'),
    ...(volume ? list([volume], 'Histogram') : []),
  ];
}
