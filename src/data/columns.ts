/**
 * Grid column helpers shared by Discover (LogsExplorer, field sidebar, drawer) and the Lens →
 * Discover hand-off. No React / page imports, so any module can use them without import cycles.
 */
import { FieldModel } from '../sql/fieldModel';
import { CORE_ALIAS } from '../sql/queryBuilder';
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
