/**
 * Volume-histogram panel for LogsExplorer's results pane: interval/breakdown pickers, the chart
 * itself (or an empty/loading placeholder), and the "N rows / interval: X" meta line.
 * Split out of LogsExplorer.tsx purely to keep that page's file size down — no behavior change,
 * same props the inline block already closed over. Renders nothing when `hasTime` is false (no
 * timestamp column mapped — same gate the inline block used at its call site).
 *
 * Panel is framed with a top/bottom rule (not a boxed card), generously padded, with the meta
 * caption centered under the chart rather than crammed into the toolbar row.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange, TimeZone } from '@grafana/data';
import { formatInZone, useTimeZoneSettings } from '../utils/timeZone';
import { Button, Icon, IconButton, LinkButton, useStyles2 } from '@grafana/ui';
import { BreakdownSel, FilterPill, IntervalMode, VolumeDataPoint } from '../types';
import { VolumeHistogram, ResolvedInterval, HistogramColorMode, isCalendarUnit } from './VolumeHistogram';
import { IntervalPicker } from './HistogramControls/IntervalPicker';
import { BreakdownPicker } from './HistogramControls/BreakdownPicker';

export type VolumeStatus = 'pending' | 'done' | 'error';

interface LogsHistogramPanelProps {
  hasTime: boolean;
  hasSeverity: boolean;
  intervalMode: IntervalMode;
  onIntervalModeChange: (mode: IntervalMode) => void;
  timeRange: TimeRange;
  breakdown: BreakdownSel;
  onBreakdownChange: (b: BreakdownSel) => void;
  volumeData: VolumeDataPoint[];
  volLoading: boolean;
  /** How the last histogram query ended ('pending' before the first answer). */
  volStatus?: VolumeStatus;
  /** The document list has rows for this search. */
  hasRows?: boolean;
  onRetry?: () => void;
  totalEvents: number;
  resolvedInterval: ResolvedInterval;
  onSelectRange: (fromMs: number, toMs: number) => void;
  /** Field the breakdown splits on, as a filter target (undefined = no filtering from the chart). */
  breakdownTarget?: { field: string };
  onAddFilter: (pill: FilterPill) => void;
  /** Collapses the chart down to just the toolbar row (interval/breakdown pickers stay reachable)
   *  without unmounting them, so the query state they hold isn't lost while collapsed. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** "Edit visualization" link to the Visualize page (DISC-CHART-03); absent = no button. */
  editVisualizationUrl?: string;
  /** The search does not parse: the bars and count belong to the previous search, so hide them
   *  (Kibana clears the chart too) instead of showing a stale answer under the error. */
  invalidQuery?: boolean;
  /** Why a breakdown from the link was not applied (round 2 #17); shown until dismissed. */
  breakdownNotice?: string;
  onDismissBreakdownNotice?: () => void;
}

function colorModeFor(breakdown: BreakdownSel): HistogramColorMode {
  if (breakdown.kind === 'field') {
    return 'breakdown';
  }
  if (breakdown.kind === 'severity') {
    return 'severity';
  }
  return 'single';
}

export const HISTOGRAM_DEFAULT_HEIGHT = 104;
export const HISTOGRAM_MIN_HEIGHT = 80;
/** Share of the viewport the chart may take, so the table below stays usable. */
const HISTOGRAM_MAX_SHARE = 0.6;
const HISTOGRAM_KEY_STEP = 8;
export const HISTOGRAM_HEIGHT_KEY = 'clickhouse-observe.logsExplorer.histogramHeight';

export function maxHistogramHeight(viewportHeight: number): number {
  return Math.max(HISTOGRAM_MIN_HEIGHT, Math.floor(viewportHeight * HISTOGRAM_MAX_SHARE));
}

/** Keeps a chart height within [min, ~60% of the viewport]; non-finite input gives the default. */
export function clampHistogramHeight(height: number, viewportHeight: number): number {
  if (!Number.isFinite(height)) {
    height = HISTOGRAM_DEFAULT_HEIGHT;
  }
  return Math.round(Math.min(maxHistogramHeight(viewportHeight), Math.max(HISTOGRAM_MIN_HEIGHT, height)));
}

function readStoredHeight(): number {
  try {
    const raw = Number(window.localStorage.getItem(HISTOGRAM_HEIGHT_KEY));
    return raw > 0 ? raw : HISTOGRAM_DEFAULT_HEIGHT;
  } catch {
    return HISTOGRAM_DEFAULT_HEIGHT;
  }
}

function storeHeight(height: number | null) {
  try {
    if (height === null) {
      window.localStorage.removeItem(HISTOGRAM_HEIGHT_KEY);
    } else {
      window.localStorage.setItem(HISTOGRAM_HEIGHT_KEY, String(height));
    }
  } catch {
    // storage unavailable: the height just isn't remembered
  }
}

const CAPTION_FORMAT = 'MMM D, YYYY @ HH:mm:ss.SSS';

/** "Jan 1, 2026 @ 00:00:00.000 - Jan 8, 2026 @ 00:00:00.000" (DISC-CHART-01 caption). */
export function formatRangeCaption(range: TimeRange, tz?: TimeZone): string {
  return `${formatInZone(range.from.valueOf(), CAPTION_FORMAT, tz)} - ${formatInZone(range.to.valueOf(), CAPTION_FORMAT, tz)}`;
}

export function LogsHistogramPanel({
  hasTime,
  hasSeverity,
  intervalMode,
  onIntervalModeChange,
  timeRange,
  breakdown,
  onBreakdownChange,
  volumeData,
  volLoading,
  volStatus = 'done',
  hasRows = false,
  onRetry,
  totalEvents,
  resolvedInterval,
  onSelectRange,
  breakdownTarget,
  onAddFilter,
  collapsed,
  invalidQuery = false,
  breakdownNotice,
  onDismissBreakdownNotice,
  onToggleCollapsed,
  editVisualizationUrl,
}: LogsHistogramPanelProps) {
  const styles = useStyles2(getStyles);
  const [storedHeight, setStoredHeight] = useState(readStoredHeight);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const drag = useRef<{ startY: number; startHeight: number } | null>(null);
  // Clamped again at render so a smaller window never leaves the chart taller than the cap.
  const chartHeight = clampHistogramHeight(storedHeight, viewportHeight);

  useEffect(() => {
    const onResize = () => setViewportHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const commitHeight = useCallback(
    (h: number) => {
      const next = clampHistogramHeight(h, window.innerHeight);
      setStoredHeight(next);
      return next;
    },
    [setStoredHeight]
  );

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startY: e.clientY, startHeight: chartHeight };
  };
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      commitHeight(drag.current.startHeight + (e.clientY - drag.current.startY));
    }
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return;
    }
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    storeHeight(chartHeight);
  };
  const onHandleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? HISTOGRAM_KEY_STEP * 4 : HISTOGRAM_KEY_STEP;
    let next: number | null = null;
    if (e.key === 'ArrowUp') {
      next = chartHeight - step;
    } else if (e.key === 'ArrowDown') {
      next = chartHeight + step;
    } else if (e.key === 'Home') {
      next = HISTOGRAM_MIN_HEIGHT;
    } else if (e.key === 'End') {
      next = window.innerHeight;
    }
    if (next !== null) {
      e.preventDefault();
      storeHeight(commitHeight(next));
    }
  };
  const resetHeight = () => {
    setStoredHeight(HISTOGRAM_DEFAULT_HEIGHT);
    storeHeight(null);
  };
  const { timeZone } = useTimeZoneSettings();

  if (!hasTime) {
    return null;
  }
  const hasBars = volumeData.length > 0 && totalEvents > 0;
  // Nothing matched: no chart (Kibana hides it too); the results area says so. It stays hidden while
  // an empty search refreshes.
  if (volStatus === 'done' && !hasBars && !hasRows && !invalidQuery) {
    return null;
  }

  return (
    <div className={styles.histogramPanel}>
      <div className={styles.histogramHeader}>
        <IconButton
          name={collapsed ? 'angle-down' : 'angle-up'}
          size="sm"
          tooltip={collapsed ? 'Show histogram' : 'Hide histogram'}
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
        />
        <IntervalPicker value={intervalMode} onChange={onIntervalModeChange} timeRange={timeRange} />
        <BreakdownPicker value={breakdown} onChange={onBreakdownChange} hasSeverity={hasSeverity} />
        {editVisualizationUrl && (
          <LinkButton
            href={editVisualizationUrl}
            icon="pen"
            size="sm"
            variant="secondary"
            fill="text"
            tooltip="Edit visualization"
            aria-label="Edit visualization"
          />
        )}
      </div>
      {breakdownNotice && (
        <div className={styles.breakdownNotice} role="status" data-testid="breakdown-notice">
          <Icon name="exclamation-triangle" size="sm" />
          <span>{breakdownNotice}</span>
          {onDismissBreakdownNotice && (
            <IconButton
              name="times"
              size="sm"
              aria-label="Dismiss breakdown notice"
              onClick={onDismissBreakdownNotice}
            />
          )}
        </div>
      )}
      {!collapsed && invalidQuery ? (
        <div className={styles.histogramEmpty} role="status" data-testid="histogram-invalid-query">
          No chart: the search has an error
        </div>
      ) : (
        !collapsed &&
        (hasBars ? (
          <>
            <VolumeHistogram
              data={volumeData}
              timeRange={timeRange}
              height={chartHeight}
              loading={volLoading}
              onSelectRange={onSelectRange}
              breakdownTarget={breakdownTarget}
              onAddFilter={onAddFilter}
              colorMode={colorModeFor(breakdown)}
              bucketMs={resolvedInterval.intervalMs}
              calendarBuckets={isCalendarUnit(resolvedInterval.unit)}
            />
            {/* SHARED-A11Y-01: the new hit count is spoken after each search. */}
            <span className={styles.histogramMeta} role="status">
              {totalEvents.toLocaleString()} rows (count) &middot; {formatRangeCaption(timeRange, timeZone)} (interval:{' '}
              {resolvedInterval.label})
              {resolvedInterval.scaledTo && (
                // Kibana's warning when a chosen interval is too fine for the range.
                <span
                  className={styles.scaledNotice}
                  data-testid="histogram-interval-scaled"
                  title={`The chosen interval would create too many buckets for this time range, so it was scaled to ${resolvedInterval.scaledTo}.`}
                >
                  <Icon name="exclamation-triangle" size="sm" /> Scaled to {resolvedInterval.scaledTo}
                </span>
              )}
            </span>
          </>
        ) : (
          <div className={styles.histogramEmpty} style={{ height: chartHeight }}>
            {volLoading || volStatus === 'pending' ? (
              'Loading…'
            ) : (
              <span role="status">
                The histogram could not be loaded
                {onRetry && (
                  <Button size="sm" variant="secondary" fill="text" onClick={onRetry}>
                    Retry
                  </Button>
                )}
              </span>
            )}
          </div>
        ))
      )}
      {!collapsed && !invalidQuery && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize histogram"
          aria-valuenow={chartHeight}
          aria-valuemin={HISTOGRAM_MIN_HEIGHT}
          aria-valuemax={maxHistogramHeight(viewportHeight)}
          tabIndex={0}
          data-testid="histogram-resize-handle"
          className={styles.resizeHandle}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onHandleKeyDown}
          onDoubleClick={resetHeight}
        >
          <span className={styles.resizeGrip} />
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  histogramPanel: css`
    display: flex;
    flex-direction: column;
    padding: ${theme.spacing(1)};
    border-top: 1px solid ${theme.colors.border.weak};
    border-bottom: 1px solid ${theme.colors.border.weak};
  `,
  histogramEmpty: css`
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${theme.colors.text.disabled};
    font-size: ${theme.typography.body.fontSize};
  `,
  resizeHandle: css`
    display: flex;
    align-items: center;
    justify-content: center;
    height: 10px;
    margin: ${theme.spacing(0.5)} 0 -${theme.spacing(0.5)};
    cursor: row-resize;
    touch-action: none;
    &:hover > span,
    &:focus-visible > span {
      background: ${theme.colors.primary.main};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.primary.main};
      outline-offset: -2px;
    }
  `,
  resizeGrip: css`
    width: 40px;
    height: 3px;
    border-radius: 2px;
    background: ${theme.colors.border.medium};
  `,
  histogramHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding-bottom: ${theme.spacing(0.5)};
  `,
  breakdownNotice: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    color: ${theme.colors.warning.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  scaledNotice: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    margin-left: ${theme.spacing(1)};
    color: ${theme.colors.warning.text};
  `,
  histogramMeta: css`
    margin-top: ${theme.spacing(0.5)};
    font-size: 12px;
    line-height: 16px;
    text-align: center;
    padding: 0 ${theme.spacing(1)};
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
});
