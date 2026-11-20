import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Pagination, Select, Spinner, useStyles2 } from '@grafana/ui';

interface PaginationBarProps {
  page: number; // 0-based
  pageSize: number;
  pageSizeOptions: number[];
  totalLoaded: number;
  /** Matching documents (the histogram's count); undefined when unknown (raw SQL, no time field). */
  total?: number;
  /** Fetch every remaining row; offered only when provided. */
  onLoadAll?: () => void;
  hasMore: boolean;
  fetchingMore: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/** "200 of 1,207 loaded" when the total is known and not all loaded; "200 rows loaded+" when unknown. */
export function loadedLabel(loaded: number, hasMore: boolean, total?: number): string {
  if (total !== undefined && total > loaded) {
    return `${loaded.toLocaleString()} of ${total.toLocaleString()} loaded`;
  }
  return `${loaded.toLocaleString()} rows loaded${total === undefined && hasMore ? '+' : ''}`;
}

export function PaginationBar({
  page,
  pageSize,
  pageSizeOptions,
  totalLoaded,
  total,
  onLoadAll,
  hasMore,
  fetchingMore,
  onPageChange,
  onPageSizeChange,
}: PaginationBarProps) {
  const styles = useStyles2(getStyles);

  const knownPages = Math.max(1, Math.ceil(totalLoaded / pageSize));
  // Show one extra page when more rows may exist so the user can navigate forward.
  const numberOfPages = hasMore ? knownPages + 1 : knownPages;

  const sizeOptions: Array<SelectableValue<number>> = pageSizeOptions.map((n) => ({
    label: String(n),
    value: n,
  }));

  return (
    <div className={styles.bar}>
      <div className={styles.left}>
        <span className={styles.label}>Rows per page</span>
        <Select
          aria-label="Rows per page"
          value={pageSize}
          options={sizeOptions}
          onChange={(v) => v.value != null && onPageSizeChange(v.value)}
          width={8}
          menuPlacement="top"
        />
        {fetchingMore && <Spinner size="sm" />}
      </div>
      <div className={styles.right}>
        <span className={styles.info}>
          {loadedLabel(totalLoaded, hasMore, total)}
        </span>
        {onLoadAll && total !== undefined && total > totalLoaded && (
          <Button size="sm" variant="secondary" fill="text" onClick={onLoadAll} disabled={fetchingMore}>
            Load all {total.toLocaleString()}
          </Button>
        )}
        <Pagination
          currentPage={page + 1}
          numberOfPages={numberOfPages}
          onNavigate={(p) => onPageChange(p - 1)}
          hideWhenSinglePage
        />
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  bar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.spacing(0.5)} ${theme.spacing(1)};
    border-top: 1px solid ${theme.colors.border.weak};
    background: ${theme.colors.background.primary};
    flex-shrink: 0;
    gap: ${theme.spacing(2)};
  `,
  left: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  label: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
  `,
  right: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(2)};
  `,
  info: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  `,
});
