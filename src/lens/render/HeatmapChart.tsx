/**
 * Heat map (R3-CHARTS): X = the first bucket (a date histogram or categories), Y = the breakdown's
 * values in rank order (the biggest on top, Other / (missing) last), cell colour = the one metric.
 * Custom-drawn like the XY charts so one click on a cell filters (PanelRenderer has no click
 * callback) and the Y axis reads as categories (Grafana's heatmap expects numeric buckets).
 *
 * A cell with no row in the result is empty (no fill, "No data" in the tooltip), distinct from a
 * real 0, which takes the lowest colour. Keyboard: the grid is one tab stop; arrows move between
 * cells, Enter / Space selects (the same filter chooser as a click).
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, useTheme2 } from '@grafana/ui';
import { LensResult } from '../compile';
import { MetricDim } from '../state';
import { formatValue } from '../metricOptions';
import { formatAxisNumber, formatNumber } from '../../utils/axisNumber';
import { fitTimeTicks, timeTicks, tooltipTime } from './timeTicks';
import { XySelection, xText } from './XyChart';
import { truncateLabel } from './labels';

export { truncateLabel };

/** Sequential ramps (low → high); the dark one runs dark → bright so hot cells stand out on both. */
export const HEATMAP_RAMP_LIGHT = ['#e6f0fb', '#a9cbf0', '#5b9be0', '#2563b8', '#0c3b7a'];
export const HEATMAP_RAMP_DARK = ['#1c2b42', '#21497f', '#2f73cc', '#6ea6f2', '#cfe3ff'];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** Colour of `t` in [0, 1] along a ramp (piecewise linear in RGB). */
export function rampColor(ramp: string[], t: number): string {
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const a = hex(ramp[i]);
  const b = hex(ramp[i + 1]);
  const f = x - i;
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

/** Value domain of the cells: from 0 (or a lower value) to the largest; a flat domain gets width 1. */
export function heatDomain(values: number[]): [number, number] {
  if (values.length === 0) {
    return [0, 1];
  }
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  return hi > lo ? [lo, hi] : [lo, lo + 1];
}

/** The cell's value, or null when the result has no row for it (an empty cell, not a 0). */
export function cellValue(result: LensResult, xi: number, si: number): number | null {
  const v = result.series[si]?.points.get(result.xs[xi]);
  return v === undefined ? null : v;
}

/** Longest label (px) a Y tick may take: about 7 px a character, between 40 px and 35 % of the width. */
export function yLabelWidth(labels: string[], width: number): number {
  const longest = labels.reduce((n, l) => Math.max(n, l.length), 0);
  return Math.round(Math.max(40, Math.min(longest * 6.6 + 8, width * 0.35, 240)));
}

interface Props {
  result: LensResult;
  metric?: MetricDim;
  /** Y axis title (the breakdown's label); empty without a breakdown. */
  yTitle?: string;
  bucketMs?: number;
  onSelect?: (sel: XySelection) => void;
}

const M = { top: 8, right: 12, bottom: 40 };
const LEGEND_H = 34;

export function HeatmapChart({ result, metric, yTitle, bucketMs, onSelect }: Props) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const ramp = theme.isDark ? HEATMAP_RAMP_DARK : HEATMAP_RAMP_LIGHT;
  const gradId = `lens-heat-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ xi: number; si: number } | null>(null);
  const [active, setActive] = useState<{ xi: number; si: number }>({ xi: 0, si: 0 });
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([e]) =>
      setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) })
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nx = result.xs.length;
  const ny = result.series.length;
  const fmt = (v: number) => formatValue(v, metric?.format, formatNumber);
  const axisFmt = (v: number) => formatValue(v, metric?.format, formatAxisNumber);
  const values: number[] = [];
  result.series.forEach((s) => s.points.forEach((v) => values.push(v)));
  const [lo, hi] = heatDomain(values);
  const colorOf = (v: number) => rampColor(ramp, (v - lo) / (hi - lo));
  const hasY = result.series.some((s) => s.breakdown !== undefined);
  const yLabels = result.series.map((s) => (hasY ? s.name || '(empty)' : s.name));

  const W = size.w;
  const H = Math.max(size.h, 200);
  const left = yLabelWidth(yLabels, W) + (yTitle ? 18 : 0);
  const plotW = Math.max(1, W - left - M.right);
  const plotH = Math.max(1, H - M.top - M.bottom - LEGEND_H);
  const cw = plotW / Math.max(1, nx);
  const ch = plotH / Math.max(1, ny);
  const gap = cw > 6 && ch > 6 ? 1 : 0;
  const spanMs = result.xIsTime && nx > 1 ? Number(result.xs[nx - 1]) - Number(result.xs[0]) : 0;
  const step = bucketMs ?? (nx > 1 ? spanMs / (nx - 1) : 0);
  const xPosOfTime = (t: number) => left + (step > 0 ? ((t - Number(result.xs[0])) / step) * cw : 0);
  const timeTickVals =
    result.xIsTime && nx > 0
      ? fitTimeTicks(
          timeTicks(Number(result.xs[0]), Number(result.xs[nx - 1]) + step, Math.max(2, Math.floor(plotW / 80))),
          xPosOfTime,
          Math.max(0, W - 4)
        )
      : [];
  // Category X: every k-th label so they don't overlap (about 70 px each), cut to the cell width.
  const catEvery = Math.max(1, Math.ceil(nx / Math.max(1, Math.floor(plotW / 70))));
  const xHeader = (xi: number) => (result.xIsTime ? tooltipTime(Number(result.xs[xi]), step) : xText(result, xi, 0));
  const cellLabel = (xi: number, si: number) => {
    const v = cellValue(result, xi, si);
    return `${xHeader(xi)} · ${yLabels[si]}: ${v === null ? 'No data' : fmt(v)}`;
  };

  const select = (xi: number, si: number, clientX: number, clientY: number) =>
    onSelect?.({ xIndex: xi, seriesIndex: si, clientX, clientY });
  const onKeyDown = (e: React.KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    if (moves[e.key]) {
      e.preventDefault();
      const [dx, dy] = moves[e.key];
      setActive((a) => ({
        xi: Math.max(0, Math.min(nx - 1, a.xi + dx)),
        si: Math.max(0, Math.min(ny - 1, a.si + dy)),
      }));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive((a) => ({ ...a, xi: e.key === 'Home' ? 0 : nx - 1 }));
    } else if ((e.key === 'Enter' || e.key === ' ') && cellValue(result, active.xi, active.si) !== null) {
      e.preventDefault();
      const r = boxRef.current?.getBoundingClientRect();
      select(active.xi, active.si, (r?.left ?? 0) + left + cw * (active.xi + 0.5), (r?.top ?? 0) + M.top + ch * active.si);
    }
  };
  const shown = hover ?? (focused ? active : null);

  const tooltip = shown && (
    <div
      role="tooltip"
      data-testid="lens-tooltip"
      className={styles.tooltip}
      style={{
        top: Math.max(0, Math.min(M.top + ch * shown.si + ch, H - 70)),
        ...(left + cw * shown.xi > W / 2
          ? { right: W - (left + cw * shown.xi) + 8 }
          : { left: left + cw * (shown.xi + 1) + 8 }),
      }}
    >
      <div className={styles.tooltipHeader}>{xHeader(shown.xi)}</div>
      <div className={styles.tooltipRow}>
        {(() => {
          const v = cellValue(result, shown.xi, shown.si);
          return (
            <>
              <span
                className={styles.swatch}
                style={{ background: v === null ? 'transparent' : colorOf(v) }}
                aria-hidden
              />
              <span className={styles.tooltipName}>{hasY ? yLabels[shown.si] : (metric ? yLabels[0] : '')}</span>
              <span className={styles.tooltipValue}>{v === null ? 'No data' : fmt(v)}</span>
            </>
          );
        })()}
      </div>
      {hasY && result.series[0] && <div className={styles.tooltipMetric}>{metricName(result)}</div>}
    </div>
  );

  // Legend: the colour ramp from the lowest to the highest value, plus the empty-cell swatch.
  const legendW = Math.min(260, Math.max(120, plotW * 0.4));
  const legendY = H - LEGEND_H + 6;

  return (
    <div ref={boxRef} className={styles.wrap} data-testid="lens-heatmap">
      {W > 0 && nx > 0 && ny > 0 && (
        <svg width={W} height={H} className={styles.svg}>
          <defs>
            <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
              {ramp.map((c, i) => (
                <stop key={c} offset={i / (ramp.length - 1)} stopColor={c} />
              ))}
            </linearGradient>
          </defs>
          {/* Y labels (rank order, the biggest on top), cut to the axis with the full text on hover. */}
          {yLabels.map((l, si) => (
            <text
              key={`y${si}`}
              x={left - 6}
              y={M.top + ch * si + ch / 2 + 4}
              textAnchor="end"
              className={styles.tick}
              data-testid="lens-heatmap-y"
            >
              <title>{l}</title>
              {ch >= 11 || si % Math.ceil(11 / Math.max(1, ch)) === 0
                ? truncateLabel(l, left - (yTitle ? 18 : 0))
                : ''}
            </text>
          ))}
          {yTitle && (
            <text
              transform={`translate(12 ${M.top + plotH / 2}) rotate(-90)`}
              textAnchor="middle"
              className={styles.axisTitle}
            >
              {truncateLabel(yTitle, plotH)}
            </text>
          )}
          {/* X labels. */}
          {result.xIsTime
            ? timeTickVals.map((tk) => (
                <g key={`t${tk.t}`}>
                  <line
                    x1={xPosOfTime(tk.t)}
                    x2={xPosOfTime(tk.t)}
                    y1={M.top + plotH}
                    y2={M.top + plotH + 4}
                    className={styles.axisLine}
                  />
                  <text x={xPosOfTime(tk.t) + 3} y={M.top + plotH + 16} className={styles.tick}>
                    {tk.label}
                  </text>
                  {tk.sub && (
                    <text x={xPosOfTime(tk.t) + 3} y={M.top + plotH + 29} className={styles.tickSub}>
                      {tk.sub}
                    </text>
                  )}
                </g>
              ))
            : result.xs.map((_x, xi) =>
                xi % catEvery === 0 ? (
                  <text
                    key={`x${xi}`}
                    x={left + cw * xi + cw / 2}
                    y={M.top + plotH + 16}
                    textAnchor="middle"
                    className={styles.tick}
                    data-testid="lens-heatmap-x"
                  >
                    <title>{xText(result, xi, 0)}</title>
                    {truncateLabel(xText(result, xi, 0), Math.max(cw * catEvery, 40))}
                  </text>
                ) : null
              )}
          {/* Cells: one grid, one tab stop (roving focus with the arrow keys). */}
          <g
            role="grid"
            aria-label={`Heat map: ${metricName(result)}`}
            tabIndex={0}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onMouseLeave={() => setHover(null)}
            className={styles.grid}
            aria-activedescendant={`${gradId}-c${active.si}-${active.xi}`}
          >
            <rect x={left} y={M.top} width={plotW} height={plotH} className={styles.plotBg} />
            {result.series.map((s, si) => (
              <g key={`r${si}`} role="row" aria-label={yLabels[si]}>
                {result.xs.map((_x, xi) => {
                  const v = cellValue(result, xi, si);
                  return (
                    <rect
                      key={xi}
                      id={`${gradId}-c${si}-${xi}`}
                      role="gridcell"
                      aria-label={cellLabel(xi, si)}
                      data-testid="lens-heatmap-cell"
                      data-value={v ?? ''}
                      x={left + cw * xi + gap / 2}
                      y={M.top + ch * si + gap / 2}
                      width={Math.max(0.5, cw - gap)}
                      height={Math.max(0.5, ch - gap)}
                      fill={v === null ? 'transparent' : colorOf(v)}
                      className={v === null ? styles.empty : styles.cell}
                      onMouseEnter={() => setHover({ xi, si })}
                      onClick={(e) => v !== null && select(xi, si, e.clientX, e.clientY)}
                    />
                  );
                })}
              </g>
            ))}
            {shown && (
              <rect
                x={left + cw * shown.xi}
                y={M.top + ch * shown.si}
                width={cw}
                height={ch}
                className={focused && !hover ? styles.focusRing : styles.hoverRing}
                pointerEvents="none"
              />
            )}
          </g>
          {/* Colour legend. */}
          <g data-testid="lens-heatmap-legend" aria-label={`Color scale from ${axisFmt(lo)} to ${axisFmt(hi)}`}>
            <text x={left} y={legendY + 10} className={styles.tick}>
              {axisFmt(lo)}
            </text>
            <rect
              x={left + 8 + axisFmt(lo).length * 6.6}
              y={legendY}
              width={legendW}
              height={12}
              rx={2}
              fill={`url(#${gradId})`}
            />
            <text x={left + 16 + axisFmt(lo).length * 6.6 + legendW} y={legendY + 10} className={styles.tick}>
              {axisFmt(hi)}
            </text>
            {values.length < nx * ny && (
              <>
                <rect
                  x={left + 40 + (axisFmt(lo).length + axisFmt(hi).length) * 6.6 + legendW}
                  y={legendY}
                  width={12}
                  height={12}
                  rx={2}
                  className={styles.emptySwatch}
                />
                <text
                  x={left + 58 + (axisFmt(lo).length + axisFmt(hi).length) * 6.6 + legendW}
                  y={legendY + 10}
                  className={styles.tick}
                >
                  No data
                </text>
              </>
            )}
          </g>
        </svg>
      )}
      {tooltip}
    </div>
  );
}

/** The metric's label (the series name without a breakdown, the part after " · " with several). */
function metricName(result: LensResult): string {
  const s = result.series[0];
  if (!s) {
    return '';
  }
  return s.breakdown === undefined ? s.name : (s.name.split(' · ')[1] ?? '');
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 200px;
  `,
  svg: css`
    display: block;
  `,
  grid: css`
    outline: none;
  `,
  plotBg: css`
    fill: none;
    stroke: ${theme.colors.border.weak};
  `,
  cell: css`
    cursor: pointer;
  `,
  empty: css`
    stroke: none;
  `,
  emptySwatch: css`
    fill: none;
    stroke: ${theme.colors.border.medium};
  `,
  hoverRing: css`
    fill: none;
    stroke: ${theme.colors.text.primary};
    stroke-width: 1.5px;
  `,
  focusRing: css`
    fill: none;
    stroke: ${theme.colors.primary.border};
    stroke-width: 2px;
  `,
  tick: css`
    fill: ${theme.colors.text.secondary};
    font-size: 11px;
  `,
  tickSub: css`
    fill: ${theme.colors.text.secondary};
    font-size: 10px;
  `,
  axisTitle: css`
    fill: ${theme.colors.text.primary};
    font-size: 12px;
  `,
  axisLine: css`
    stroke: ${theme.colors.border.medium};
  `,
  tooltip: css`
    position: absolute;
    z-index: 3;
    pointer-events: none;
    min-width: 160px;
    max-width: 360px;
    padding: ${theme.spacing(0.5, 0)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  tooltipHeader: css`
    font-weight: ${theme.typography.fontWeightMedium};
    padding: ${theme.spacing(0.25, 1)};
  `,
  tooltipRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(0.25, 1)};
  `,
  tooltipName: css`
    flex: 1;
    overflow-wrap: anywhere;
  `,
  tooltipValue: css`
    font-variant-numeric: tabular-nums;
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  tooltipMetric: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0, 1)};
  `,
  swatch: css`
    width: 10px;
    height: 10px;
    border-radius: 2px;
    border: 1px solid ${theme.colors.border.medium};
    flex: none;
  `,
});
