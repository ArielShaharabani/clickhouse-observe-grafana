import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Icon, Input, useStyles2 } from '@grafana/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import { FieldModel, FieldType } from '../../sql/fieldModel';
import { SourceConfigContext } from '../App/App';
import { loadFieldUsage, popularFieldIds, recordFieldUse } from '../../state/fieldUsage';
import { FieldTypeFilter } from './FieldTypeFilter';
import { useFields } from '../FieldsContext';
import { FieldItem } from './FieldItem';
import { FilterPill, LogsQueryState, SelectedColumn, ColumnType } from '../../types';

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

interface FieldSidebarProps {
  queryState: LogsQueryState;
  timeRange: TimeRange;
  onToggleColumn: (col: SelectedColumn) => void;
  onAddFilter: (f: FilterPill) => void;
  onCollapse: () => void;
  /** Break the histogram down by a field (field stats popover action). */
  onSetBreakdown?: (field: FieldModel) => void;
}

type Group = 'selected' | 'popular' | 'available';

export function FieldSidebar({
  queryState,
  timeRange,
  onToggleColumn,
  onAddFilter,
  onCollapse,
  onSetBreakdown,
}: FieldSidebarProps) {
  const styles = useStyles2(getStyles);
  const { fields, loading, refresh } = useFields();
  const config = useContext(SourceConfigContext);
  const [nameFilter, setNameFilter] = useState('');
  // Type filter belongs to one table: switching data view to another table starts unfiltered.
  const usageTable = `${config.database}.${config.logsTable}`;
  const [typeFilterState, setTypeFilterState] = useState<{ table: string; types: Set<FieldType> }>(() => ({
    table: usageTable,
    types: new Set(),
  }));
  const typeFilter = useMemo(
    () => (typeFilterState.table === usageTable ? typeFilterState.types : new Set<FieldType>()),
    [typeFilterState, usageTable]
  );
  const setTypeFilter = useCallback((types: Set<FieldType>) => setTypeFilterState({ table: usageTable, types }), [usageTable]);
  const [collapsed, setCollapsed] = useState<Record<Group, boolean>>({ selected: false, popular: false, available: false });

  const selectedIds = useMemo(
    () => new Set(queryState.columns.map((c) => c.id)),
    [queryState.columns]
  );

  // Popular fields (DISC-SIDEBAR-01): fields used from this list before, per viewer and table.
  // In-memory counts per table are the source for this page view (storage only seeds them).
  const [usageByTable, setUsageByTable] = useState<Record<string, Record<string, number>>>({});
  const counts = useMemo(() => usageByTable[usageTable] ?? loadFieldUsage(usageTable), [usageByTable, usageTable]);
  const listable = useMemo(() => fields.filter((f) => !(f.source === 'column' && f.type === 'json')), [fields]);
  const listableIds = useMemo(() => new Set(listable.map((f) => f.id)), [listable]);
  // Only fields that are rows of this list count (not drilled Map keys), so Popular never fills
  // with ids it can't show.
  const noteUse = useCallback(
    (fieldId: string) => {
      if (listableIds.has(fieldId)) {
        setUsageByTable((u) => ({ ...u, [usageTable]: recordFieldUse(usageTable, fieldId, counts) }));
      }
    },
    [listableIds, usageTable, counts]
  );
  const onToggleFromList = useCallback(
    (field: FieldModel) => {
      if (!selectedIds.has(field.id)) {
        noteUse(field.id);
      }
      onToggleColumn(fieldToColumn(field));
    },
    [selectedIds, noteUse, onToggleColumn]
  );
  const onFilterFromList = useCallback(
    (pill: FilterPill) => {
      const f = listable.find((x) => x.sqlExpr === pill.field);
      if (f) {
        noteUse(f.id);
      }
      onAddFilter(pill);
    },
    [listable, noteUse, onAddFilter]
  );

  // Single flat, filterable list split into Selected / Popular / Available, no Empty group (a
  // filter-aware presence check needs a dedicated sample query; removed in the perf plan — see
  // DECISIONS D13).
  //
  // Map columns show as one row each: their keys are browsed on-demand via FieldKeysPopover,
  // opened by clicking the row in FieldItem, not flattened into the list here. JSON columns are
  // the opposite — every path is already a real field (FieldsContext Phase C), so the *container*
  // row is dropped from the list: it would only offer top-values over a whole JSON column, which
  // is expensive and unreadable. It stays in `fields` regardless, because LogDetailDrawer derives
  // its JSON-column list (and therefore its dotted-path row flattening, sql/schema.ts's
  // groupAttributes) from exactly those entries.
  const nameMatched = useMemo(() => {
    const lc = nameFilter.toLowerCase();
    return nameFilter
      ? listable.filter((f) => f.displayName.toLowerCase().includes(lc) || f.name.toLowerCase().includes(lc))
      : listable;
  }, [listable, nameFilter]);
  // Type counts reflect the name search, so the filter popover shows what's actually listable.
  const typeCounts = useMemo(() => {
    const c: Partial<Record<FieldType, number>> = {};
    for (const f of nameMatched) {
      c[f.type] = (c[f.type] ?? 0) + 1;
    }
    return c;
  }, [nameMatched]);
  const { selected, popular, unselected } = useMemo(() => {
    const filtered = typeFilter.size > 0 ? nameMatched.filter((f) => typeFilter.has(f.type)) : nameMatched;
    const byId = new Map(filtered.map((f) => [f.id, f]));
    const popularIds = popularFieldIds(counts, 5, (id) => byId.has(id) && !selectedIds.has(id));
    const popularSet = new Set(popularIds);
    return {
      selected: filtered.filter((f) => selectedIds.has(f.id)),
      popular: popularIds.map((id) => byId.get(id)!),
      unselected: filtered.filter((f) => !selectedIds.has(f.id) && !popularSet.has(f.id)),
    };
  }, [nameMatched, typeFilter, selectedIds, counts]);

  const groupHeader = (g: Group, label: string, n: number, info: string) => (
    <button
      type="button"
      className={styles.groupHeader}
      aria-expanded={!collapsed[g]}
      title={info}
      onClick={() => setCollapsed((c) => ({ ...c, [g]: !c[g] }))}
    >
      <Icon name={collapsed[g] ? 'angle-right' : 'angle-down'} size="sm" />
      <span className={styles.sectionLabel}>{label}</span>
      <span className={styles.countBadge} aria-label={`${n} fields`}>
        {n}
      </span>
    </button>
  );
  const itemProps = {
    queryState,
    timeRange,
    onToggleColumn: onToggleFromList,
    onAddFilter: onFilterFromList,
    onSetBreakdown,
  };

  // The unselected list is the one that scales with schema width — a table with hundreds of
  // columns, or Map/JSON columns that explode into thousands of discovered keys/paths, used to
  // render every one of them as a real DOM row with no windowing. Virtualize just this list
  // (react-virtual is already a dependency) — "Selected" stays plain since it's bounded by
  // however many columns the user has actually added to the grid.
  const listScrollRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: unselected.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 32,
    overscan: 12,
  });

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <span className={styles.title}>Fields</span>
        {loading && <Icon name="sync" size="xs" className={styles.spinner} />}
        <button className={styles.refreshBtn} onClick={refresh} title="Refresh field list">
          <Icon name="sync" size="xs" />
        </button>
        <button className={styles.refreshBtn} onClick={onCollapse} title="Collapse sidebar">
          <Icon name="angle-double-left" size="xs" />
        </button>
      </div>

      <div className={styles.searchRow}>
        <Input
          prefix={<Icon name="search" />}
          placeholder="Search field names"
          aria-label="Search field names"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.currentTarget.value)}
          className={styles.search}
        />
        <FieldTypeFilter counts={typeCounts} selected={typeFilter} onChange={setTypeFilter} />
      </div>

      {selected.length > 0 && (
        <section className={styles.section} aria-label="Selected fields">
          {groupHeader('selected', 'Selected fields', selected.length, 'Fields shown as table columns')}
          {!collapsed.selected && selected.map((f) => <FieldItem key={f.id} field={f} isSelected {...itemProps} />)}
        </section>
      )}

      {popular.length > 0 && (
        <section className={styles.section} aria-label="Popular fields">
          {groupHeader('popular', 'Popular fields', popular.length, 'Fields you use most often in this table')}
          {!collapsed.popular && popular.map((f) => <FieldItem key={f.id} field={f} isSelected={false} {...itemProps} />)}
        </section>
      )}

      <section className={styles.availableSection} aria-label="Available fields">
        {groupHeader('available', 'Available fields', unselected.length, 'All other fields in this table')}
        {!loading && fields.length === 0 && <div className={styles.empty}>No fields discovered yet</div>}
        {!loading && fields.length > 0 && selected.length + popular.length + unselected.length === 0 && (
          <div className={styles.empty}>No fields match</div>
        )}
        <div ref={listScrollRef} className={styles.availableScroll} hidden={collapsed.available}>
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const f = unselected[vRow.index];
              return (
                <div
                  key={f.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${vRow.start}px)`,
                  }}
                >
                  <FieldItem field={f} isSelected={false} {...itemProps} />
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  sidebar: css`
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1.25)};
    /* Was overflow-y: auto on the whole sidebar — the field list now scrolls itself (see
     * availableScroll) so the virtualizer's getScrollElement() has a bounded, measurable
     * viewport instead of an ever-growing one. */
    overflow: hidden;
    border-right: 1px solid ${theme.colors.border.weak};
    padding: ${theme.spacing(1)};
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  title: css`
    font-size: ${theme.typography.body.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  `,
  spinner: css`
    color: ${theme.colors.text.secondary};
    animation: spin 1s linear infinite;
    @keyframes spin { to { transform: rotate(360deg); } }
  `,
  refreshBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    color: ${theme.colors.text.secondary};
    border-radius: ${theme.shape.radius.default};
    display: flex;
    align-items: center;
    &:hover { color: ${theme.colors.text.primary}; background: ${theme.colors.action.hover}; }
  `,
  searchRow: css`
    display: flex;
    gap: ${theme.spacing(0.5)};
    align-items: center;
  `,
  groupHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    color: ${theme.colors.text.secondary};
    text-align: left;
    &:hover { color: ${theme.colors.text.primary}; }
  `,
  countBadge: css`
    margin-left: auto;
    font-size: ${theme.typography.bodySmall.fontSize};
    padding: 0 ${theme.spacing(0.75)};
    border-radius: ${theme.shape.radius.pill};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
  search: css`
    flex: 1;
    font-size: ${theme.typography.body.fontSize};
    & input {
      padding-top: ${theme.spacing(1.25)};
      padding-bottom: ${theme.spacing(1.25)};
    }
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: 1px;
  `,
  availableSection: css`
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    gap: 1px;
  `,
  availableScroll: css`
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  `,
  sectionLabel: css`
    font-size: 13px;
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0.5)} ${theme.spacing(0.5)} 2px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  empty: css`
    font-size: ${theme.typography.body.fontSize};
    color: ${theme.colors.text.disabled};
    padding: ${theme.spacing(1)} ${theme.spacing(0.5)};
  `,
});
