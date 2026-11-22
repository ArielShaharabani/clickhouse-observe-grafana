/**
 * The query bar Discover and Visualize share (R5-QUERYBAR): data view picker + schema button,
 * Add filter, query menu and the KQL search bar on one wrapping row, with optional trailing
 * controls (Discover puts its time range there). One component so both pages look the same.
 */
import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
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
  /** Controls after the search bar (page specific). */
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
          value={p.search}
          onChange={p.onSearch}
          onSearch={() => {}}
          onInvalidQuery={p.onInvalidQuery}
          loadValues={p.loadValues}
          loadMapKeys={p.loadMapKeys}
        />
      </div>
      {p.children}
    </div>
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
  searchWrap: css`
    flex: 1 1 260px;
    min-width: 200px;
  `,
});
