/**
 * SHARED-PERF-01 loading cue: a thin indeterminate bar under a page's toolbar while its queries
 * run, plus a "Still running · 4s" chip once a query is slow. With `onCancel`, the chip offers
 * Cancel, which stops this tab waiting for the response. It does not kill the query on
 * ClickHouse (see RunQueryOptions.signal in data/runQuery.ts), and the tooltip says so.
 *
 * The root is zero-height (with a negative top margin that cancels the parent's flex gap), so
 * showing or hiding the cue never shifts the layout.
 */
import React, { useEffect, useState } from 'react';
import { css, keyframes } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Icon, useStyles2 } from '@grafana/ui';

/** Default delay before the "Still running" chip appears. */
export const SLOW_QUERY_MS = 2000;

/** "4s", "1m 05s". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export interface QueryProgressProps {
  /** True while any of the page's queries is running. */
  active: boolean;
  /** Stops waiting for the running queries. Omit to show no Cancel button. */
  onCancel?: () => void;
  /** Delay before the "Still running" chip appears. */
  slowAfterMs?: number;
}

export function QueryProgress({ active, onCancel, slowAfterMs = SLOW_QUERY_MS }: QueryProgressProps) {
  const styles = useStyles2(getStyles);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [cancelled, setCancelled] = useState(false);

  useEffect(() => {
    if (!active) {
      setStartedAt(null);
      return;
    }
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    setCancelled(false);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  const elapsed = startedAt === null ? 0 : now - startedAt;
  const slow = active && startedAt !== null && elapsed >= slowAfterMs;

  return (
    <div className={styles.root}>
      {active && (
        <div className={styles.bar} role="progressbar" aria-label="Loading results" data-testid="query-progress-bar">
          <div className={styles.barFill} />
        </div>
      )}
      {slow && (
        <div className={styles.chip} role="status" data-testid="query-progress-slow">
          <Icon name="fa fa-spinner" size="sm" />
          <span>Still running · {formatElapsed(elapsed)}</span>
          {onCancel && (
            <Button
              size="sm"
              variant="secondary"
              fill="text"
              tooltip="Stop waiting for this query. ClickHouse may still finish it in the background."
              onClick={() => {
                setCancelled(true);
                onCancel();
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      )}
      {!active && cancelled && (
        <div className={styles.chip} role="status" data-testid="query-progress-cancelled">
          <Icon name="info-circle" size="sm" />
          <span>Query cancelled. Results are not up to date; refresh to run it again.</span>
          <Button size="sm" variant="secondary" fill="text" icon="times" aria-label="Dismiss" onClick={() => setCancelled(false)} />
        </div>
      )}
    </div>
  );
}

const slide = keyframes`
  0% { left: -35%; right: 100%; }
  60% { left: 100%; right: -90%; }
  100% { left: 100%; right: -90%; }
`;

const getStyles = (theme: GrafanaTheme2) => ({
  root: css`
    position: relative;
    height: 0;
    margin-top: -${theme.spacing(1)};
    z-index: 3;
  `,
  bar: css`
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 2px;
    overflow: hidden;
    background: ${theme.colors.primary.transparent};
  `,
  barFill: css`
    position: absolute;
    top: 0;
    bottom: 0;
    background: ${theme.colors.primary.main};
    animation: ${slide} 1.6s ease-in-out infinite;
    @media (prefers-reduced-motion: reduce) {
      animation: none;
      left: 0;
      right: 0;
      opacity: 0.6;
    }
  `,
  chip: css`
    position: absolute;
    top: ${theme.spacing(0.5)};
    right: ${theme.spacing(1)};
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(0.25, 0.5, 0.25, 1)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    box-shadow: ${theme.shadows.z2};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
});
