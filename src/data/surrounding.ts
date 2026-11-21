/**
 * Surrounding documents (DISC-DOC-02): route, URL helpers and the anchor lookup.
 *
 * Route: `context/<dataViewId>/<ns>_<id>` (spec: `#/context/<dataViewId>/<docId>`), where the
 * document id is the ContextAnchor pair (see sql/queryBuilder.ts). The query string carries the
 * shared search context like every other page: `filters` (all disabled on entry — spec: "existing
 * filters are carried over but automatically disabled"), `cols`, `from` / `to`, plus `ret`, the
 * Discover query string the breadcrumb returns to. The search query itself is dropped.
 */
import { TimeRange } from '@grafana/data';
import { prefixRoute } from '../utils/utils.routing';
import { buildContextAnchorLookupQuery, CONTEXT_ALIAS, ContextAnchor, isContextAnchor } from '../sql/queryBuilder';
import { FilterPill, SelectedColumn, SourceConfig } from '../types';
import { FieldModel } from '../sql/fieldModel';
import { defaultColumns, sanitizeColumns } from './columns';
import { encodeLogsState } from './urlState';
import { runQueryRows } from './runQuery';

/** Path segment for an anchor: `<ns>_<id>`. */
export function formatAnchorParam(anchor: ContextAnchor): string {
  return `${anchor.ns}_${anchor.id}`;
}

/** Parses `<ns>_<id>`; null when malformed (the value is untrusted URL input). */
export function parseAnchorParam(raw: string | undefined | null): ContextAnchor | null {
  if (!raw) {
    return null;
  }
  const parts = raw.split('_');
  if (parts.length !== 2) {
    return null;
  }
  const anchor = { ns: parts[0], id: parts[1] };
  return isContextAnchor(anchor) ? anchor : null;
}

export interface ContextUrlInput {
  viewId: string;
  anchor: ContextAnchor;
  filters: FilterPill[];
  columns: SelectedColumn[];
  timeRange: TimeRange;
  /** Discover query string to return to (the breadcrumb). */
  ret: string;
  /** Disable every filter (entry from Discover). A re-anchor inside the page keeps them as they are. */
  disableFilters?: boolean;
}

/** In-app URL of the surrounding-documents page. */
export function buildContextUrl(input: ContextUrlInput): string {
  const filters = input.disableFilters ? input.filters.map((f) => ({ ...f, disabled: true })) : input.filters;
  const sp = encodeLogsState({ search: '', filters, columns: input.columns, timeRange: input.timeRange });
  if (input.ret) {
    sp.set('ret', input.ret);
  }
  return `${prefixRoute('context')}/${encodeURIComponent(input.viewId)}/${formatAnchorParam(input.anchor)}?${sp.toString()}`;
}

export interface SingleDocUrlInput {
  viewId: string;
  anchor: ContextAnchor;
  timeRange: TimeRange;
  /** Discover query string to return to (the breadcrumb). */
  ret: string;
}

/**
 * "View single document" permalink (PARITY-GRID): `doc/<dataViewId>/<ns>_<id>` — the document's
 * stable identity is the same ContextAnchor as surrounding documents (epoch-ns timestamp + row-id
 * hash of the mapped core columns), so the link keeps working regardless of time range, sort or
 * paging. The query string carries `ret` (which holds the time range) or, without it, `from` / `to`.
 */
export function buildSingleDocUrl(input: SingleDocUrlInput): string {
  // The time range travels inside `ret` (the Discover query string carries from / to); only a link
  // whose return context has no range carries its own from / to. Old links with both still decode.
  const retHasRange = input.ret ? new URLSearchParams(input.ret).has('from') : false;
  const sp = retHasRange
    ? new URLSearchParams({ ret: input.ret })
    : encodeLogsState({ search: '', filters: [], columns: [], timeRange: input.timeRange });
  if (!retHasRange && input.ret) {
    sp.set('ret', input.ret);
  }
  return `${prefixRoute('doc')}/${encodeURIComponent(input.viewId)}/${formatAnchorParam(input.anchor)}?${sp.toString()}`;
}

/**
 * Discover URL for the breadcrumb. `ret` is untrusted: it is re-serialized as query parameters
 * only, always under this app's `logs` route, so it can't point anywhere else.
 */
export function discoverReturnUrl(ret: string | null): string {
  const sp = new URLSearchParams(ret ?? '');
  const qs = sp.toString();
  return `${prefixRoute('logs')}${qs ? `?${qs}` : ''}`;
}

/** Looks up the ContextAnchor of a grid row; null when it can't be resolved. */
export async function resolveContextAnchor(
  config: SourceConfig,
  row: Record<string, unknown>,
  timeRange: TimeRange
): Promise<ContextAnchor | null> {
  const own = { ns: row[CONTEXT_ALIAS.ns], id: row[CONTEXT_ALIAS.id] };
  if (isContextAnchor(own)) {
    // Rows of the surrounding-documents page already carry their anchor.
    return own;
  }
  const sql = buildContextAnchorLookupQuery(config, row);
  if (!sql) {
    return null;
  }
  const rows = await runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange, op: 'context' });
  const found = rows[0] ? { ns: String(rows[0][CONTEXT_ALIAS.ns]), id: String(rows[0][CONTEXT_ALIAS.id]) } : null;
  return isContextAnchor(found) ? found : null;
}

/**
 * Grid columns for the surrounding-documents page ("Columns are kept"). URL columns are untrusted:
 * rebuilt by the shared sanitizer in strict mode (they must name a discovered field or a key of a
 * discovered Map column). Nothing left means the view's default columns.
 */
export function contextColumns(
  urlColumns: SelectedColumn[] | undefined,
  fields: FieldModel[],
  config: SourceConfig
): SelectedColumn[] {
  const cols = sanitizeColumns(urlColumns, config, fields);
  return cols.length > 0 ? cols : defaultColumns(config);
}
