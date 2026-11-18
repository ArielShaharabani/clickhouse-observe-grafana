/**
 * Grid column helpers shared by Discover (LogsExplorer, field sidebar, drawer) and the Lens →
 * Discover hand-off. No React / page imports, so any module can use them without import cycles.
 */
import { FieldModel } from '../sql/fieldModel';
import { CORE_ALIAS, isSafeColumnExpr, looksLikeMapAccessor } from '../sql/queryBuilder';
import { ColumnType, SelectedColumn, SourceConfig } from '../types';

/** Sanitize a field id into a SQL-safe alias. Shared with LogDetailDrawer's "add as column" action. */
export function makeColumnKey(id: string): string {
  return 'fld_' + id.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').slice(0, 40);
}

export function fieldToColumn(field: FieldModel): SelectedColumn {
  return {
    id: field.id,
    key: makeColumnKey(field.id),
    sqlExpr: field.sqlExpr,
    displayName: field.displayName,
    type: field.type as ColumnType,
    isCore: false,
  };
}

export function defaultColumns(config: SourceConfig): SelectedColumn[] {
  const c = config.columns;
  // Only include columns for which a mapping exists. Empty mapping = column not present in this view.
  // `id` stays a stable plain name (used for React keys/reorder, unrelated to SQL); `key` must
  // match the __-prefixed alias buildLogsQuery actually emits (see CORE_ALIAS).
  const cols: Array<{ id: string; key: string; sqlExpr: string; displayName: string; type: ColumnType }> = [
    { id: 'timestamp', key: CORE_ALIAS.timestamp, sqlExpr: c.timestamp, displayName: 'Time', type: 'time' },
    { id: 'severity', key: CORE_ALIAS.severity, sqlExpr: c.severity, displayName: 'Level', type: 'level' },
    { id: 'serviceName', key: CORE_ALIAS.serviceName, sqlExpr: c.serviceName, displayName: 'Service', type: 'exact' },
    { id: 'body', key: CORE_ALIAS.body, sqlExpr: c.body, displayName: 'Message', type: 'text' },
  ];
  const core = cols
    .filter((col) => Boolean(col.sqlExpr))
    .map((col) => ({ ...col, isCore: true }));
  // "Pinned columns" — a per-view saved set of extra (non-core) columns appended after the fixed
  // core set (see SourceConfig.pinnedColumns). Core is never replaced or reordered by this; a
  // pinned entry that happens to duplicate a mapped core column's sqlExpr (e.g. someone pinned
  // ServiceName by hand) is dropped so it doesn't render twice.
  const coreExprs = new Set(core.map((col) => col.sqlExpr));
  const pinned = (config.pinnedColumns ?? []).filter((col) => !coreExprs.has(col.sqlExpr));
  return [...core, ...pinned];
}

const COLUMN_TYPES: readonly ColumnType[] = [
  'time',
  'level',
  'text',
  'number',
  'string',
  'exact',
  'map',
  'json',
  'tuple',
  'array',
  'unknown',
];

/**
 * Rebuilds columns restored from an untrusted source (URL `cols`, saved searches) so nothing but
 * trusted SQL reaches a query. Each column is resolved by id:
 * - core → the view's own core column (mapping);
 * - a discovered field (when `fields` is given) → fieldToColumn;
 * - a pinned column of the view config → that entry;
 * - otherwise its expression must be a plain column reference (isSafeColumnExpr: identifier, Map
 *   accessor or dotted path), and with `fields` given it must also name something discovered
 *   (a field's expression, or a key of a discovered Map column — Map keys are found on demand).
 * The SELECT alias is always regenerated from the id (makeColumnKey), the type checked, and the
 * display name kept only as text. Anything that does not resolve is dropped, as are duplicates.
 * Returns [] when nothing survives (callers then use the view's default columns).
 */
export function sanitizeColumns(raw: unknown, config: SourceConfig, fields?: FieldModel[]): SelectedColumn[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const defaults = defaultColumns(config);
  const out: SelectedColumn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const col = item as Partial<SelectedColumn>;
    if (typeof col.id !== 'string' || !col.id) {
      continue;
    }
    let trusted: SelectedColumn | undefined;
    if (col.isCore) {
      trusted = defaults.find((d) => d.isCore && d.id === col.id);
    } else {
      const field = fields?.find((f) => f.id === col.id);
      trusted = field
        ? fieldToColumn(field)
        : ((config.pinnedColumns ?? []).find((p) => p.id === col.id) ?? exprColumn(col, fields));
    }
    if (trusted && !out.some((c) => c.id === trusted!.id || c.key === trusted!.key)) {
      out.push(trusted);
    }
  }
  return out;
}

function exprColumn(col: Partial<SelectedColumn>, fields?: FieldModel[]): SelectedColumn | undefined {
  const expr = col.sqlExpr;
  if (!isSafeColumnExpr(expr)) {
    return undefined;
  }
  if (fields) {
    const known =
      fields.some((f) => f.sqlExpr === expr) ||
      (looksLikeMapAccessor(expr) &&
        fields.some((f) => f.type === 'map' && f.sqlExpr === expr.slice(0, expr.indexOf('['))));
    if (!known) {
      return undefined;
    }
  }
  const id = col.id as string;
  return {
    id,
    key: makeColumnKey(id),
    sqlExpr: expr,
    displayName: typeof col.displayName === 'string' && col.displayName ? col.displayName : expr,
    type: COLUMN_TYPES.includes(col.type as ColumnType) ? (col.type as ColumnType) : 'unknown',
    isCore: false,
  };
}
