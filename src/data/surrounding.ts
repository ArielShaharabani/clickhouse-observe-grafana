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
import {
  buildContextAnchorLookupQuery,
  CONTEXT_ALIAS,
  ContextAnchor,
  isContextAnchor,
  looksLikeMapAccessor,
} from '../sql/queryBuilder';
import { FilterPill, SelectedColumn, SourceConfig } from '../types';
import { FieldModel } from '../sql/fieldModel';
import { defaultColumns, fieldToColumn, makeColumnKey } from './columns';
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
 * A Map key column (`LogAttributes['http.status_code']`): Map keys are discovered on demand, so
 * they are not in `fields`. Trusted only when the expression is a strictly well-formed accessor
 * (looksLikeMapAccessor: escaped key literal, nothing else) on a discovered Map column; the key
 * and type are rebuilt, never taken from the URL.
 */
function mapKeyColumn(col: SelectedColumn, fields: FieldModel[]): SelectedColumn | undefined {
  const expr = col.sqlExpr;
  if (typeof expr !== 'string' || !looksLikeMapAccessor(expr)) {
    return undefined;
  }
  const root = expr.slice(0, expr.indexOf('['));
  if (!fields.some((f) => f.type === 'map' && f.sqlExpr === root)) {
    return undefined;
  }
  return {
    id: col.id,
    key: makeColumnKey(col.id),
    sqlExpr: expr,
    displayName: typeof col.displayName === 'string' && col.displayName ? col.displayName : expr,
    type: 'exact',
    isCore: false,
  };
}

/**
 * Grid columns for the surrounding-documents page ("Columns are kept"). URL columns are untrusted —
 * a column's `sqlExpr` would otherwise reach SQL verbatim — so every column is rebuilt from a
 * trusted source: core columns from the view's mapping, others from discovered fields by id or
 * as a validated Map key accessor (mapKeyColumn).
 * Unknown entries are dropped; nothing left means the view's default columns.
 */
export function contextColumns(
  urlColumns: SelectedColumn[] | undefined,
  fields: FieldModel[],
  config: SourceConfig
): SelectedColumn[] {
  const defaults = defaultColumns(config);
  if (!Array.isArray(urlColumns) || urlColumns.length === 0) {
    return defaults;
  }
  const out: SelectedColumn[] = [];
  for (const col of urlColumns) {
    if (!col || typeof col.id !== 'string') {
      continue;
    }
    const trusted = col.isCore
      ? defaults.find((d) => d.isCore && d.id === col.id)
      : (() => {
          const field = fields.find((f) => f.id === col.id);
          return field ? fieldToColumn(field) : mapKeyColumn(col, fields);
        })();
    if (trusted && !out.some((c) => c.id === trusted.id)) {
      out.push(trusted);
    }
  }
  return out.length > 0 ? out : defaults;
}
