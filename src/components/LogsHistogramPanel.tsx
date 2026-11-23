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
import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange, TimeZone } from '@grafana/data';
import { formatInZone, useTimeZoneSettings } from '../utils/timeZone';
import { Icon, IconButton, LinkButton, useStyles2 } from '@grafana/ui';
import { BreakdownSel, FilterPill, IntervalMode, VolumeDataPoint } from '../types';
import { VolumeHistogram, ResolvedInterval, HistogramColorMode, isCalendarUnit } from './VolumeHistogram';
import { IntervalPicker } from './HistogramControls/IntervalPicker';
import { BreakdownPicker } from './HistogramControls/BreakdownPicker';

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
  const { timeZone } = useTimeZoneSettings();

  if (!hasTime) {
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
        (volumeData.length > 0 && (totalEvents > 0 || volLoading) ? (
          <>
            <VolumeHistogram
              data={volumeData}
              timeRange={timeRange}
              height={104}
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
          <div className={styles.histogramEmpty}>{volLoading ? 'Loading…' : 'No events in selected time range'}</div>
        ))
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
    height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: ${theme.colors.text.disabled};
    font-size: ${theme.typography.body.fontSize};
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
