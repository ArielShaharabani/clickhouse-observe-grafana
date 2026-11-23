/**
 * Metric chart (LENS-CHART-01, docs/spec/20-lens.md): a grid of tiles — one per "Break down by"
 * value, or a single tile — with the label top-left and the big value bottom-right, an optional
 * Secondary metric line, and a progress bar when a Maximum value metric is set. A tile without a
 * value shows a dash.
 */
import React from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { LensResult, uniqueMetricLabels } from '../compile';
import { formatOf, formatValue } from '../metricOptions';
import { formatNumber } from '../../utils/axisNumber';
import { LensState, MetricDim } from '../state';

export const EMPTY_TILE = '–';

export interface MetricTile {
  /** Breakdown value, or the primary metric's name without a breakdown. */
  title: string;
  value: string;
  /** The metric's name under the breakdown value (tiles per value only). */
  subtitle?: string;
  secondary?: { label: string; value: string };
  /** 0–100 when a Maximum value is set and the tile has both values. */
  percent?: number;
}

/** Formats a metric value with its Value format (LENS-DIM-02), else as a plain number. */
export function formatMetricValue(m: MetricDim | undefined, v: number | undefined): string {
  if (v === undefined || v === null || !Number.isFinite(v)) {
    return EMPTY_TILE;
  }
  // The same formatter as the bars, pie and heat map, so one format reads the same everywhere.
  return formatValue(v, formatOf(m), formatNumber);
}

/** The tiles of a Metric chart, from the shaped result. Pure (tested without rendering). */
export function metricTiles(state: LensState, result: LensResult): MetricTile[] {
  const labels = uniqueMetricLabels(state.metrics);
  const values = state.metrics.map((m, i) => ({ m, i })).filter(({ m }) => m.role !== 'max');
  const primary = values[0];
  const secondary = values[1];
  const maxIdx = state.metrics.findIndex((m) => m.role === 'max');
  const valueOf = (metricIndex: number, x: string | number): number | undefined => {
    const s = result.series.find((se) => se.metricIndex === metricIndex);
    return s?.points.get(x);
  };
  const broken = state.buckets.length > 0;
  const xs = broken ? result.xs : result.xs.length > 0 ? [result.xs[0]] : [''];
  return xs.map((x, k) => {
    const pv = primary ? valueOf(primary.i, x) : undefined;
    const tile: MetricTile = {
      title: broken ? (result.xLabels[k] ?? String(x)) || '(empty)' : primary ? labels[primary.i] : '',
      value: formatMetricValue(primary?.m, pv),
    };
    if (broken && primary) {
      tile.subtitle = labels[primary.i];
    }
    if (secondary) {
      tile.secondary = {
        label: labels[secondary.i],
        value: formatMetricValue(secondary.m, valueOf(secondary.i, x)),
      };
    }
    if (maxIdx >= 0 && pv !== undefined) {
      const max = valueOf(maxIdx, x);
      if (max !== undefined && Number.isFinite(max) && max > 0) {
        tile.percent = Math.max(0, Math.min(100, (pv / max) * 100));
      }
    }
    return tile;
  });
}

export function MetricTiles({ state, result }: { state: LensState; result: LensResult }) {
  const styles = useStyles2(getStyles);
  const tiles = metricTiles(state, result);
  const primary = state.metrics.find((m) => m.role !== 'max');
  return (
    <div
      className={cx(styles.grid, tiles.length === 1 && styles.single)}
      role="list"
      aria-label="Metric tiles"
    >
      {tiles.map((t, i) => (
        <div
          key={i}
          role="listitem"
          aria-label={`${t.title}: ${t.value}`}
          className={styles.tile}
          style={primary?.color ? { borderColor: primary.color } : undefined}
        >
          <div className={styles.title} title={t.title}>
            {t.title}
          </div>
          {t.subtitle && (
            <div className={styles.subtitle} title={t.subtitle}>
              {t.subtitle}
            </div>
          )}
          {t.secondary && (
            <div className={styles.secondary}>
              {t.secondary.label} <strong>{t.secondary.value}</strong>
            </div>
          )}
          <div className={styles.value} style={primary?.color ? { color: primary.color } : undefined}>
            {t.value}
          </div>
          {t.percent !== undefined && (
            <div
              className={styles.track}
              role="progressbar"
              aria-valuenow={Math.round(t.percent)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className={styles.bar}
                style={{ width: `${t.percent}%`, ...(primary?.color ? { background: primary.color } : {}) }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  // Three columns of tiles up to 140 px tall that shrink (down to 110 px) so every row fits the
  // chart area, as Kibana's; only more rows than that scroll. A single tile is centred at a
  // Kibana-like size, not stretched.
  grid: css`
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    grid-auto-rows: minmax(110px, 140px);
    align-content: start;
    gap: ${theme.spacing(1)};
    width: 100%;
    height: 100%;
    overflow: auto;
  `,
  single: css`
    grid-template-columns: minmax(0, 320px);
    grid-auto-rows: 160px;
    justify-content: center;
    align-content: center;
  `,
  subtitle: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tile: css`
    position: relative;
    display: flex;
    flex-direction: column;
    padding: ${theme.spacing(1.5)};
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    min-width: 0;
  `,
  title: css`
    font-weight: ${theme.typography.fontWeightMedium};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  secondary: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  value: css`
    margin-top: auto;
    text-align: right;
    font-size: 2rem;
    font-weight: ${theme.typography.fontWeightMedium};
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  track: css`
    height: 6px;
    margin-top: ${theme.spacing(1)};
    background: ${theme.colors.background.canvas};
    border-radius: 3px;
    overflow: hidden;
  `,
  bar: css`
    height: 100%;
    background: ${theme.colors.primary.main};
  `,
});
