/**
 * Visualize's query row (R3-QUERYBAR): the same Add filter / query menu / KQL search bar Discover
 * composes (pages/LogsExplorer.tsx), over the shared search context in the URL. Typing changes
 * nothing until the bar submits (Enter / Search); an unparseable query is reported through
 * `onInvalidQuery` and never reaches `onSearch`.
 */
import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { AddFilterPopover } from '../components/AddFilter/AddFilterPopover';
import { LoadedQuery, QueryMenu } from '../components/QueryMenu/QueryMenu';
import { SearchBar } from '../components/SearchBar';
import { FieldValue } from '../sql/kql/_values';
import { KeysResult } from '../sql/keys';
import { FilterPill } from '../types';

/** The URL params after a submitted query: `q` set (or dropped when blank); the same object when nothing changed. */
export function withQuery(prev: URLSearchParams, next: string): URLSearchParams {
  const sp = new URLSearchParams(prev);
  if (next.trim()) {
    sp.set('q', next);
  } else {
    sp.delete('q');
  }
  return sp.toString() === prev.toString() ? prev : sp;
}

interface Props {
  search: string;
  filters: FilterPill[];
  timeRange: TimeRange;
  dataViewId?: string;
  pinTable: string;
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  loadMapKeys: (mapColumn: string) => Promise<KeysResult>;
  /** A valid query was submitted. */
  onSearch: (query: string) => void;
  onInvalidQuery: (message: string | null) => void;
  onFiltersChange: (filters: FilterPill[]) => void;
  onAddFilter: (pill: FilterPill) => void;
  onClearAll: () => void;
  onLoadQuery: (loaded: LoadedQuery) => void;
}

export function QueryRow(p: Props) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.row} data-testid="lens-query-row">
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
