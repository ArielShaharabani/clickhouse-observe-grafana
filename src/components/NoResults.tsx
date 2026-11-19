/**
 * Discover's empty and failed result states (Kibana parity): "No results match your search
 * criteria" with tips and a "Search entire time range" button, and — after a failed or invalid
 * query — the error in place of the results, so stale rows never look current.
 */
import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, useStyles2 } from '@grafana/ui';
import { errMsg } from '../errMsg';

interface NoResultsProps {
  /** Set when the last query failed or the typed query is invalid: shown instead of the tips. */
  error?: string | null;
  /** Looks up the data's min / max time and applies it; absent when the view has no time field.
   *  Resolves false when there is no data to find. */
  onSearchEntireRange?: () => Promise<boolean>;
  /** Run the current query again (error state). */
  onRetry?: () => void;
}

export function NoResults({ error, onSearchEntireRange, onRetry }: NoResultsProps) {
  const styles = useStyles2(getStyles);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (error) {
    return (
      <div className={styles.box} data-testid="results-error" role="alert">
        <Icon name="exclamation-circle" size="xxl" className={styles.errorIcon} />
        <h3 className={styles.title}>Unable to retrieve search results</h3>
        <pre className={styles.errorText}>{error}</pre>
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Run query again
          </Button>
        )}
      </div>
    );
  }

  const search = async () => {
    if (!onSearchEntireRange) {
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const found = await onSearchEntireRange();
      if (!found && mounted.current) {
        setNote('This data view has no documents.');
      }
    } catch (e) {
      if (mounted.current) {
        setNote(errMsg(e));
      }
    } finally {
      if (mounted.current) {
        setBusy(false);
      }
    }
  };

  return (
    <div className={styles.box} data-testid="no-results">
      <Icon name="search" size="xxl" className={styles.icon} />
      <h3 className={styles.title}>No results match your search criteria</h3>
      <div className={styles.tips}>
        <div>Try:</div>
        <ul>
          <li>Searching for different terms or a wider range of values</li>
          <li>Removing or disabling filters</li>
          <li>Checking the spelling of field names in the query</li>
          {onSearchEntireRange && <li>Extending the time range</li>}
        </ul>
      </div>
      {onSearchEntireRange && (
        <Button size="sm" variant="secondary" icon="calendar-alt" disabled={busy} onClick={search}>
          {busy ? 'Looking up the time range…' : 'Search entire time range'}
        </Button>
      )}
      {note && (
        <div className={styles.note} role="status">
          {note}
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  box: css`
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: ${theme.spacing(1)};
    max-width: 560px;
    color: ${theme.colors.text.secondary};
  `,
  icon: css`
    color: ${theme.colors.text.disabled};
  `,
  errorIcon: css`
    color: ${theme.colors.error.text};
  `,
  title: css`
    margin: 0;
    color: ${theme.colors.text.primary};
  `,
  tips: css`
    text-align: left;
    & ul {
      margin: ${theme.spacing(0.5, 0, 0, 2.5)};
    }
  `,
  errorText: css`
    max-width: 100%;
    margin: 0;
    padding: ${theme.spacing(1)};
    text-align: left;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: ${theme.colors.error.transparent};
    border: 1px solid ${theme.colors.error.border};
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.error.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  note: css`
    color: ${theme.colors.warning.text};
  `,
});
