/**
 * The query bar Discover and Visualize share (R5-QUERYBAR): data view picker + schema button,
 * Add filter, query menu and the KQL search bar on one wrapping row, with optional trailing
 * controls (Discover puts its time range there). One component so both pages look the same.
 */
import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Icon, RefreshPicker, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { shiftTimeRange, zoomOutTimeRange } from '../utils/timeRangeNav';
import { TimeShorthandInput } from './TimeShorthandInput';
import { AddFilterPopover } from './AddFilter/AddFilterPopover';
import { DataViewPicker } from './DataViewPicker/DataViewPicker';
import { LoadedQuery, QueryMenu } from './QueryMenu/QueryMenu';
import { SchemaButton } from './SchemaButton';
import { SearchBar } from './SearchBar';
import { FieldValue } from '../sql/kql/_values';
import { KeysResult } from '../sql/keys';
import { FilterPill } from '../types';

export interface QueryBarProps {
  search: string;
  filters: FilterPill[];
  timeRange: TimeRange;
  dataViewId?: string;
  pinTable: string;
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  loadMapKeys: (mapColumn: string) => Promise<KeysResult>;
  /** The search text changed (the page decides when that reaches the URL / query). */
  onSearch: (query: string) => void;
  onInvalidQuery: (message: string | null) => void;
  onFiltersChange: (filters: FilterPill[]) => void;
  onAddFilter: (pill: FilterPill) => void;
  onClearAll: () => void;
  onLoadQuery: (loaded: LoadedQuery) => void;
  /** Fixed slot right after the search bar: the page's "Explore in ..." link (same place on both pages). */
  explore?: React.ReactNode;
  /** Fixed slot after `explore`: the shared <QueryTimeControls>. */
  time?: React.ReactNode;
  /** Any other trailing controls (page specific). */
  children?: React.ReactNode;
  'data-testid'?: string;
}

export function QueryBar(p: QueryBarProps) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.row} data-testid={p['data-testid']}>
      <DataViewPicker />
      <SchemaButton />
      <AddFilterPopover loadValues={p.loadValues} onAddFilter={p.onAddFilter} />
      <QueryMenu
        query={p.search}
        filters={p.filters}
        timeRange={p.timeRange}
        dataViewId={p.dataViewId}
        pinTable={p.pinTable}
        onFiltersChange={p.onFiltersChange}
        onClearAll={p.onClearAll}
        onLoadQuery={p.onLoadQuery}
      />
      <div className={styles.searchWrap}>
        <SearchBar
          // A draft (or its syntax error) belongs to the view it was typed on.
          key={p.dataViewId}
          value={p.search}
          onChange={p.onSearch}
          onSearch={() => {}}
          onInvalidQuery={p.onInvalidQuery}
          loadValues={p.loadValues}
          loadMapKeys={p.loadMapKeys}
        />
      </div>
      {p.explore}
      {p.time}
      {p.children}
    </div>
  );
}

interface QueryTimeControlsProps {
  timeRange: TimeRange;
  onTimeChange: (range: TimeRange) => void;
  onRefresh: () => void;
  refreshInterval: string;
  onIntervalChanged: (interval: string) => void;
  loading?: boolean;
}

/**
 * The time range group both pages show in the QueryBar's `time` slot: shorthand input, range
 * picker and refresh picker. Grouped so they wrap together when the row runs out of width.
 */
export function QueryTimeControls(p: QueryTimeControlsProps) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.timeGroup}>
      <TimeShorthandInput range={p.timeRange} onApply={p.onTimeChange} />
      <TimeRangePicker
        value={p.timeRange}
        onChange={p.onTimeChange}
        onChangeTimeZone={() => {}}
        onChangeFiscalYearStartMonth={() => {}}
        onMoveBackward={() => p.onTimeChange(shiftTimeRange(p.timeRange, -1))}
        onMoveForward={() => p.onTimeChange(shiftTimeRange(p.timeRange, 1))}
        onZoom={() => p.onTimeChange(zoomOutTimeRange(p.timeRange))}
        timeZone="browser"
        fiscalYearStartMonth={0}
      />
      <RefreshPicker
        onRefresh={p.onRefresh}
        onIntervalChanged={p.onIntervalChanged}
        value={p.refreshInterval}
        isLoading={p.loading}
        tooltip="Refresh"
        isOnCanvas
      />
    </div>
  );
}

/** The action row under the query bar / filter pills (left: query tools, right: save / share). */
export function QueryActionsRow(p: { left?: React.ReactNode; right?: React.ReactNode }) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.actions}>
      <div className={styles.actionsLeft}>{p.left}</div>
      <div className={styles.actionsRight}>{p.right}</div>
    </div>
  );
}

/** A text-style toggle button for the left side of the action row (same look as Discover's). */
export function QueryActionToggle({
  icon,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ComponentProps<typeof Icon>['name'] }) {
  const styles = useStyles2(getStyles);
  return (
    <button type="button" className={styles.toggle} {...rest}>
      <Icon name={icon} size="xs" />
      {children}
    </button>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  row: css`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: ${theme.spacing(1)};
    row-gap: ${theme.spacing(0.5)};
  `,
  timeGroup: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    flex-shrink: 0;
  `,
  actions: css`
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    row-gap: ${theme.spacing(0.5)};
  `,
  actionsLeft: css`
    display: flex;
    gap: ${theme.spacing(2)};
    align-items: center;
  `,
  actionsRight: css`
    display: flex;
    gap: ${theme.spacing(1)};
    align-items: center;
  `,
  toggle: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    background: transparent;
    border: none;
    cursor: pointer;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.body.fontSize};
    text-align: left;
    padding: 0;
    &:hover {
      color: ${theme.colors.text.primary};
    }
  `,
  searchWrap: css`
    flex: 1 1 260px;
    min-width: 200px;
  `,
});
