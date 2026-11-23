/**
 * Custom-drawn XY chart for Lens bar / line / area (spec LENS-INTERACT-01; blueprint "Lens
 * rendering decision": PanelRenderer has no one-click "point clicked" callback, so the XY types are
 * drawn here). One click on a bar segment or point reports {x, series}; dragging across a time axis
 * reports a time range (also when the drag starts on a bar); legend items toggle visibility and offer
 * Filter for / Filter out and a series colour. Hovering (or focusing a mark) shows a crosshair
 * tooltip with every series at that X (Kibana parity).
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { formatInZone, useTimeZoneSettings } from '../../utils/timeZone';
import { IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import { LensResult } from '../compile';
import { moveMenuFocus, usePopoverDialog } from '../../components/a11y/dialog';
import { ChartType, MetricDim, XySubType } from '../state';
import { formatOf, formatValue } from '../metricOptions';
import {
  AxisScale,
  axisOf,
  axisTitle,
  legendOf,
  legendVisible,
  LensStyle,
  scalePos,
  seriesColorOf,
  tickRotation,
  TICK_COUNT,
  valueDomain,
  valueTicks,
} from '../style';
import { dashArray, ResolvedEvent, ResolvedLine } from '../layers';
import { assignColorSlots, SESSION_COLOR_SLOTS, seriesColorKey } from './seriesColors';
import { fitTimeTicks, timeTicks, tooltipTime } from './timeTicks';
import { truncateLabel } from './labels';
import { formatAxisNumber, formatNumber } from '../../utils/axisNumber';

export { formatAxisNumber, formatNumber };

export interface XySelection {
  xIndex: number;
  seriesIndex: number;
  clientX: number;
  clientY: number;
}

interface Props {
  chartType: Extract<ChartType, 'bar' | 'line' | 'area'>;
  subType?: XySubType;
  result: LensResult;
  /** Width of one time bucket (ms) — for the brush's right edge. */
  bucketMs?: number;
  onSelect?: (sel: XySelection) => void;
  onBrush?: (from: number, to: number) => void;
  /** Legend ⋮ actions; omitted → no menu (also omitted when the breakdown can't be filtered). */
  onLegendFilter?: (seriesIndex: number, mode: 'for' | 'out') => void;
  /** The chart's metrics: per-metric value format, series colour and axis side (LENS-DIM-02). */
  metrics?: MetricDim[];
  /** Style / Legend settings (LENS-STYLE-01). */
  style?: LensStyle;
  /** Automatic axis titles (Style → Axis title Auto). */
  axisTitles?: { left: string; bottom: string; right: string };
  /** Reference lines and annotation events to draw (LENS-LAYER-01, resolved by `resolveLayers`). */
  layers?: { lines: ResolvedLine[]; events: ResolvedEvent[] };
  /** The query's time range (ms): buckets it covers only in part are shaded. */
  timeRange?: { from: number; to: number };
  /** Legend ⋮ → colour: a `#rrggbb`, or undefined to go back to the automatic colour. */
  onSeriesColor?: (seriesName: string, color: string | undefined) => void;
}

/** A series' value at x: missing → 0 for counts, null (gap) otherwise. */
function pointValue(s: LensResult['series'][number], x: string | number): number | null {
  const v = s.points.get(x);
  return v === undefined ? (s.zeroFill ? 0 : null) : v;
}

const M = { top: 8, right: 8, bottom: 28, left: 52 };

/** Width (px) of a horizontal bar chart's category axis: its longest label, 48 px to 35 % of the chart (max 260). */
export function catAxisWidth(result: LensResult, width: number): number {
  const longest = result.xs.reduce<number>((n, _x, xi) => Math.max(n, xText(result, xi, 0).length), 0);
  return Math.round(Math.max(48, Math.min(longest * 6.6 + 14, Math.max(48, width * 0.35), 260)));
}
const HEIGHT_MIN = 200;

const fmt = formatNumber;

/**
 * A brushed range in whole seconds, rounded outward and at least 1 s wide: the datasource's
 * `$__fromTime` / `$__toTime` macros work in seconds, so milliseconds would be truncated in SQL.
 * (Same rule as the Discover histogram's `brushRange`; to be de-duplicated when both land.)
 */
export function brushSeconds(from: number, to: number): [number, number] {
  const a = Math.floor(Math.min(from, to) / 1000) * 1000;
  const b = Math.max(a + 1000, Math.ceil(Math.max(from, to) / 1000) * 1000);
  return [a, b];
}

/** Text of X position `xi`: the display label of a category (Other / (missing) included), else the time. */
export function xText(result: LensResult, xi: number, spanMs: number): string {
  return result.xIsTime
    ? xLabel(result.xs[xi], true, spanMs)
    : xLabel(result.xLabels?.[xi] ?? result.xs[xi], false, spanMs);
}

export function xLabel(x: string | number, isTime: boolean, spanMs: number): string {
  if (!isTime) {
    return String(x) === '' ? '(empty)' : String(x);
  }
  return formatInZone(Number(x), spanMs > 2 * 86_400_000 ? 'MM-DD HH:mm' : 'HH:mm');
}

/**
 * Stacked geometry per x: for each visible series, [y0, y1] in value units (percentage mode
 * normalises each x to 100). Exported for tests.
 */
export function stackValues(
  result: LensResult,
  visible: boolean[],
  mode: 'stacked' | 'percentage' | 'none'
): { spans: Array<Array<[number, number] | null>>; max: number; min: number } {
  const spans: Array<Array<[number, number] | null>> = result.series.map(() => []);
  let max = 0;
  let min = 0;
  result.xs.forEach((x, xi) => {
    const vals = result.series.map((s, si) => (visible[si] ? pointValue(s, x) : null));
    const total = vals.reduce<number>((a, b) => a + Math.abs(b ?? 0), 0);
    // Positive values stack upwards from 0, negative ones downwards.
    let up = 0;
    let down = 0;
    result.series.forEach((_s, si) => {
      const raw = vals[si];
      if (raw === null) {
        spans[si][xi] = null;
        return;
      }
      const v = mode === 'percentage' ? (total > 0 ? (raw / total) * 100 : 0) : raw;
      if (mode === 'none') {
        spans[si][xi] = [0, v];
        max = Math.max(max, v);
        min = Math.min(min, v);
      } else if (v >= 0) {
        spans[si][xi] = [up, up + v];
        up += v;
      } else {
        spans[si][xi] = [down, down + v];
        down += v;
      }
    });
    if (mode !== 'none') {
      max = Math.max(max, up);
      min = Math.min(min, down);
    }
  });
  return { spans, max: mode === 'percentage' ? 100 : max, min: mode === 'percentage' ? Math.max(-100, min) : min };
}

export function XyChart({
  chartType,
  subType,
  result,
  bucketMs,
  onSelect,
  onBrush,
  onLegendFilter,
  metrics,
  style,
  axisTitles,
  layers,
  timeRange,
  onSeriesColor,
}: Props) {
  const styles = useStyles2(getStyles);
  const { timeZone } = useTimeZoneSettings(); // axis, tooltip and annotation times follow the chosen zone
  const theme = useTheme2();
  const clipId = `lens-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  // Keyed by series name, so a re-query that reorders series can't retarget an open menu.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null);
  // Removes an in-flight brush's window listeners (also on unmount mid-drag).
  const stopBrush = useRef<(() => void) | null>(null);
  useEffect(() => () => stopBrush.current?.(), []);
  // A drag that brushed ends with a click on whatever is under the pointer: swallow that one click.
  const suppressClick = useRef(false);
  // Crosshair tooltip: the hovered (or focused) X position and series, and where to show it.
  const [hover, setHover] = useState<{ xi: number; si: number | null; px: number; py: number } | null>(null);

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

  const palette = theme.visualization.palette;
  const metricOf = (si: number): MetricDim | undefined => metrics?.[result.series[si]?.metricIndex];
  const hasBreakdown = result.series.some((s) => s.breakdown !== undefined);
  // Colours: a legend choice, else the metric's own colour (a series that is the metric itself),
  // else a breakdown value's stable colour (by value, not position), else the metric's position.
  const slots = hasBreakdown
    ? assignColorSlots(result.series.map(seriesColorKey), palette.length, undefined, SESSION_COLOR_SLOTS)
    : [];
  const colors = result.series.map((s, i) => {
    const picked = seriesColorOf(style, s.name);
    if (picked) {
      return picked;
    }
    const own = metricOf(i)?.color;
    if (own && s.breakdown === undefined) {
      return own;
    }
    return theme.visualization.getColorByName(palette[(hasBreakdown ? slots[i] : i) % palette.length]);
  });
  const color = (i: number) => colors[i];
  const fmtOf = (si: number, v: number) => formatValue(v, formatOf(metricOf(si)), fmt);
  const axisFmtOf = (si: number, v: number) => formatValue(v, formatOf(metricOf(si)), formatAxisNumber);
  const visible = result.series.map((s) => !hidden.has(s.name));
  // Line has no stacking (as in Kibana): a sub-type kept from Bar / Area doesn't change it.
  const mode: 'stacked' | 'percentage' | 'none' =
    chartType === 'line'
      ? 'none'
      : subType === 'percentage'
        ? 'percentage'
        : subType === 'unstacked'
          ? 'none'
          : 'stacked';
  // Horizontal bars (Style → Bar orientation): categories run down the left, values along the bottom.
  const horizontal = chartType === 'bar' && style?.orientation === 'horizontal';
  // Axis side: a right axis for metrics set to Right (unstacked vertical charts; stacks share one axis).
  const side = (si: number): 'left' | 'right' =>
    mode === 'none' && !horizontal && metricOf(si)?.axis === 'right' ? 'right' : 'left';
  const sides = result.series.map((_s, si) => side(si));
  const hasRight = sides.some((sd, si) => sd === 'right' && visible[si]);
  const hasLeft = sides.some((sd, si) => sd === 'left' && visible[si]);
  const stacked = {
    left: stackValues(
      result,
      visible.map((v, i) => v && sides[i] !== 'right'),
      mode
    ),
    right: stackValues(
      result,
      visible.map((v, i) => v && sides[i] === 'right'),
      mode
    ),
  };
  const spans = result.series.map((_s, si) => stacked[sides[si]].spans[si]);
  const firstOn = (sd: 'left' | 'right') => sides.findIndex((x, i) => x === sd && visible[i]);

  // Axis settings ("left" / "right" are the value axes, "bottom" the category axis, by role).
  const ax = { left: axisOf(style, 'left'), right: axisOf(style, 'right'), bottom: axisOf(style, 'bottom') };
  const titles = {
    left: axisTitle(style, 'left', axisTitles?.left ?? ''),
    right: hasRight ? axisTitle(style, 'right', axisTitles?.right ?? '') : '',
    bottom: axisTitle(style, 'bottom', axisTitles?.bottom ?? ''),
  };
  const percent = mode === 'percentage';
  // Reference lines sit on their value axis (on the left one when nothing is drawn on the right) and
  // widen its domain so they stay visible, as in Kibana.
  const refLines = layers?.lines ?? [];
  const lineSide = (l: ResolvedLine): 'left' | 'right' => (l.axis === 'right' && hasRight ? 'right' : 'left');
  const extent = (sd: 'left' | 'right', min: number, max: number): [number, number] => {
    const vals = refLines.filter((l) => lineSide(l) === sd).map((l) => l.value);
    return percent || vals.length === 0 ? [min, max] : [Math.min(min, ...vals), Math.max(max, ...vals)];
  };
  const leftScale = percent ? 'linear' : ax.left.scale;
  const rightScale = percent ? 'linear' : ax.right.scale;

  // Margins grow for tick labels, rotated labels and titles.
  const catRot = tickRotation(ax.bottom.orientation);
  const valRot = tickRotation(ax.left.orientation);
  const TITLE = 18;
  // A time axis (vertical charts) has round-time ticks with the date on a second row.
  const timeAxis = result.xIsTime && !horizontal && result.xs.length > 0;
  // Horizontal bars: the category axis is as wide as its longest label, up to 35 % of the chart
  // (longer labels are cut with an ellipsis; the tooltip and the tick's title carry the full text).
  const catTicksDepth = !ax.bottom.ticks
    ? 8
    : horizontal
      ? catAxisWidth(result, size.w)
      : catRot === 0
        ? timeAxis
          ? 40
          : 28
        : catRot === -45
          ? 56
          : 76;
  const valTicksDepth = !ax.left.ticks ? 8 : horizontal ? (valRot === 0 ? 28 : 56) : 52;
  const m = horizontal
    ? {
        top: M.top,
        right: M.right + 8,
        left: catTicksDepth + (titles.bottom ? TITLE : 0),
        bottom: valTicksDepth + (titles.left ? TITLE : 0),
      }
    : {
        top: M.top,
        left: valTicksDepth + (titles.left ? TITLE : 0),
        right: hasRight ? (ax.right.ticks ? 52 : 8) + (titles.right ? TITLE : 0) : M.right,
        bottom: catTicksDepth + (titles.bottom ? TITLE : 0),
      };

  const W = Math.max(size.w, 0);
  const H = Math.max(size.h, HEIGHT_MIN);
  const plotW = Math.max(1, W - m.left - m.right);
  const plotH = Math.max(1, H - m.top - m.bottom);
  // Value axes: nice bounds and ticks (0–140 by 20, 0–500 by 100); whole numbers only for counts.
  const valueLen = horizontal ? plotW : plotH;
  const allInts = (sd: 'left' | 'right') =>
    result.series.every((s, si) => sides[si] !== sd || [...s.points.values()].every((v) => Number.isInteger(v)));
  const tickOpts = (sd: 'left' | 'right') => ({
    count: Math.max(2, Math.min(TICK_COUNT, Math.floor(valueLen / (horizontal ? 90 : 50)))),
    integer: !percent && allInts(sd),
  });
  const [lo, hi] = valueDomain(
    ...extent('left', stacked.left.min, stacked.left.max),
    ax.left,
    percent,
    tickOpts('left')
  );
  const [loR, hiR] = valueDomain(
    ...extent('right', stacked.right.min, stacked.right.max),
    ax.right,
    percent,
    tickOpts('right')
  );
  // Value → pixel along the value axis (y for vertical charts, x for horizontal bars).
  const vPos = (v: number, a: number, b: number, sc: AxisScale) =>
    horizontal ? m.left + scalePos(v, a, b, sc) * plotW : m.top + plotH - scalePos(v, a, b, sc) * plotH;
  const y = (v: number) => vPos(v, lo, hi, leftScale);
  const yR = (v: number) => vPos(v, loR, hiR, rightScale);
  const ys = (si: number) => (sides[si] === 'right' ? yR : y);
  const leftFmt = (v: number) =>
    percent ? `${Math.round(v)}%` : firstOn('left') >= 0 ? axisFmtOf(firstOn('left'), v) : formatAxisNumber(v);
  const n = Math.max(1, result.xs.length);
  const catLen = horizontal ? plotH : plotW;
  const band = catLen / n;
  // Category centre along the category axis (x for vertical charts, y for horizontal bars).
  const cx0 = (xi: number) => (horizontal ? m.top + band * xi + band / 2 : m.left + band * xi + band / 2);
  const spanMs =
    result.xIsTime && result.xs.length > 1 ? Number(result.xs[result.xs.length - 1]) - Number(result.xs[0]) : 0;
  const labelEvery = Math.max(
    1,
    Math.ceil(n / Math.max(2, Math.floor(catLen / (horizontal || catRot !== 0 ? 18 : 90))))
  );

  const select = (e: React.MouseEvent | React.KeyboardEvent, xIndex: number, seriesIndex: number) => {
    e.stopPropagation();
    if (suppressClick.current) {
      // The click that ends a brush drag is not a click on a mark.
      suppressClick.current = false;
      return;
    }
    const r = (e.currentTarget as Element).getBoundingClientRect();
    onSelect?.({
      xIndex,
      seriesIndex,
      clientX: 'clientX' in e ? e.clientX : r.left + r.width / 2,
      clientY: 'clientY' in e ? e.clientY : r.top,
    });
  };
  const itemLabel = (xi: number, si: number) =>
    `${xText(result, xi, spanMs)} · ${result.series[si].name}: ${fmtOf(si, pointValue(result.series[si], result.xs[xi]) ?? 0)}`;

  // Brush (time X on a vertical chart only): drag across the plot — from empty space or from a bar —
  // to pick a range. A press without movement stays a click (the mark's filter chooser).
  const brushable = result.xIsTime && !!onBrush && !horizontal;
  const pxToTime = (px: number) => {
    const t0 = Number(result.xs[0]);
    const tEnd = Number(result.xs[result.xs.length - 1]) + (bucketMs ?? 0);
    return t0 + ((px - m.left) / plotW) * (tEnd - t0);
  };
  const onDown = (e: React.MouseEvent<SVGSVGElement>) => {
    suppressClick.current = false;
    if (!brushable || !onBrush || e.button !== 0) {
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - box.left;
    const yy = e.clientY - box.top;
    if (x < m.left || x > m.left + plotW || yy < m.top || yy > m.top + plotH) {
      return;
    }
    const clamp = (cx: number) => Math.min(m.left + plotW, Math.max(m.left, cx - box.left));
    let dragging = false;
    const move = (ev: MouseEvent) => {
      const x1 = clamp(ev.clientX);
      if (!dragging && Math.abs(x1 - x) > 4) {
        dragging = true;
        setHover(null);
      }
      if (dragging) {
        setBrush({ x0: x, x1 });
      }
    };
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      stopBrush.current = null;
    };
    const up = (ev: MouseEvent) => {
      stop();
      const x1 = clamp(ev.clientX);
      setBrush(null);
      if (dragging && Math.abs(x1 - x) > 4) {
        suppressClick.current = true;
        // Only the click that ends this drag is swallowed.
        setTimeout(() => (suppressClick.current = false), 0);
        onBrush(...brushSeconds(pxToTime(Math.min(x, x1)), pxToTime(Math.max(x, x1))));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    stopBrush.current = stop;
  };

  const visibleIdx = result.series.map((_s, i) => i).filter((i) => visible[i]);
  const grouped = chartType === 'bar' && mode === 'none';
  const barW = band * 0.7;

  /** The series under a pointer at X position `xi`: the bar segment containing it, or the nearest line point. */
  const seriesAt = (xi: number, along: number, across: number): number | null => {
    let best: number | null = null;
    let bestD = Infinity;
    for (const si of visibleIdx) {
      const sp = spans[si][xi];
      if (!sp) {
        continue;
      }
      if (chartType === 'bar') {
        const gi = visibleIdx.indexOf(si);
        const w = grouped ? barW / visibleIdx.length : barW;
        const start = cx0(xi) - barW / 2 + (grouped ? gi * w : 0);
        const a = ys(si)(sp[0]);
        const b = ys(si)(sp[1]);
        if (along >= start && along <= start + w && across >= Math.min(a, b) - 1 && across <= Math.max(a, b) + 1) {
          return si;
        }
      } else {
        const d = Math.abs(ys(si)(sp[1]) - across);
        if (d < bestD && d <= 24) {
          best = si;
          bestD = d;
        }
      }
    }
    return best;
  };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (brush || result.xs.length === 0) {
      return;
    }
    const box = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - box.left;
    const py = e.clientY - box.top;
    if (px < m.left || px > m.left + plotW || py < m.top || py > m.top + plotH) {
      setHover(null);
      return;
    }
    const along = horizontal ? py : px;
    const across = horizontal ? px : py;
    const xi = Math.max(0, Math.min(n - 1, Math.floor((along - (horizontal ? m.top : m.left)) / band)));
    const si = seriesAt(xi, along, across);
    setHover((h) => (h && h.xi === xi && h.si === si && h.px === px && h.py === py ? h : { xi, si, px, py }));
  };
  /** A click on the plot (not on a mark) of a line / area chart filters by the series under the pointer. */
  const onPlotClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (chartType !== 'bar' && hover && hover.si !== null && onSelect) {
      onSelect({ xIndex: hover.xi, seriesIndex: hover.si, clientX: e.clientX, clientY: e.clientY });
    }
  };
  /** Keyboard focus on a mark shows the same tooltip as hovering it. */
  const focusMark = (xi: number, si: number, px: number, py: number) => setHover({ xi, si, px, py });
  const showValues = chartType === 'bar' && style?.barValues === 'show';

  // Legend (Style → Legend): visibility, outside side / inside corner, list or grid.
  const lg = legendOf(style);
  const showLegend = legendVisible(style, result.series.length, hasBreakdown);
  const inside = lg.position === 'inside';
  const sideLegend = !inside && (lg.alignment === 'left' || lg.alignment === 'right');

  const valueTickVals = valueTicks(lo, hi, leftScale);
  const rightTickVals = valueTicks(loR, hiR, rightScale);
  const catTick = (xi: number) =>
    horizontal ? truncateLabel(xText(result, xi, spanMs), catTicksDepth) : xText(result, xi, spanMs).slice(0, 14);

  const legendEl = showLegend ? (
    <div
      className={cx(
        styles.legend,
        sideLegend && styles.legendSide,
        lg.layout === 'grid' && (sideLegend ? styles.legendGridSide : styles.legendGrid),
        inside && styles.legendInside
      )}
      style={
        inside
          ? {
              top: lg.alignment.startsWith('top') ? m.top + 4 : undefined,
              bottom: lg.alignment.startsWith('bottom') ? m.bottom + 4 : undefined,
              left: lg.alignment.endsWith('left') ? m.left + 4 : undefined,
              right: lg.alignment.endsWith('right') ? m.right + 4 : undefined,
            }
          : undefined
      }
      role="list"
      aria-label="Legend"
      data-legend-position={inside ? 'inside' : 'outside'}
      data-legend-alignment={lg.alignment}
      data-legend-layout={lg.layout}
    >
      {result.series.map((s, si) => (
        <div key={s.name} role="listitem" className={styles.legendItem}>
          <button
            type="button"
            className={cx(styles.legendBtn, !visible[si] && styles.legendHidden)}
            aria-pressed={visible[si]}
            title={visible[si] ? 'Click to hide' : 'Click to show'}
            onClick={() =>
              setHidden((h) => {
                const next = new Set(h);
                if (next.has(s.name)) {
                  next.delete(s.name);
                } else {
                  next.add(s.name);
                }
                return next;
              })
            }
          >
            <span className={styles.swatch} style={{ background: color(si) }} />
            {s.name || '(empty)'}
          </button>
          {((onLegendFilter && s.breakdown !== undefined) || onSeriesColor) && (
            <IconButton
              name="ellipsis-v"
              size="sm"
              tooltip={`Legend actions for ${s.name || '(empty)'}`}
              aria-haspopup="menu"
              aria-expanded={menuFor === s.name}
              onClick={() => setMenuFor(menuFor === s.name ? null : s.name)}
            />
          )}
          {menuFor === s.name && (onLegendFilter || onSeriesColor) && (
            <LegendMenu
              className={cx(styles.menu, (lg.alignment.startsWith('top') || inside) && styles.menuDown)}
              label={`Actions for ${s.name}`}
              onClose={() => setMenuFor(null)}
            >
              <div className={styles.menuTitle}>{(s.breakdown ?? s.name) || '(empty)'}</div>
              {onLegendFilter &&
                s.breakdown !== undefined &&
                (['for', 'out'] as const).map((mo) => (
                  <button
                    key={mo}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuFor(null);
                      onLegendFilter?.(si, mo);
                    }}
                  >
                    {mo === 'for' ? 'Filter for' : 'Filter out'}
                  </button>
                ))}
              {onSeriesColor && (
                <div role="group" aria-label="Series color" className={styles.colorGroup}>
                  <div className={styles.colorTitle}>Color</div>
                  <div className={styles.colorGrid}>
                    {LEGEND_COLORS.map((name) => {
                      const hex = theme.visualization.getColorByName(name);
                      return (
                        <button
                          key={name}
                          type="button"
                          role="menuitemradio"
                          aria-checked={hex.toLowerCase() === colors[si].toLowerCase()}
                          aria-label={`Color ${name}`}
                          title={name}
                          className={styles.colorSwatch}
                          style={{ background: hex }}
                          onClick={() => {
                            setMenuFor(null);
                            onSeriesColor(s.name, toHex(hex));
                          }}
                        />
                      );
                    })}
                  </div>
                  {seriesColorOf(style, s.name) && (
                    <button
                      type="button"
                      role="menuitem"
                      className={styles.menuItem}
                      onClick={() => {
                        setMenuFor(null);
                        onSeriesColor(s.name, undefined);
                      }}
                    >
                      Reset color
                    </button>
                  )}
                </div>
              )}
            </LegendMenu>
          )}
        </div>
      ))}
    </div>
  ) : null;

  /** A value label for a bar segment, when it fits ("Show, if able"). */
  const barValue = (si: number, xi: number, x0: number, y0: number, w: number, h: number, sp: [number, number]) => {
    if (!showValues) {
      return null;
    }
    const v = pointValue(result.series[si], result.xs[xi]) ?? 0;
    const text = percent ? `${+(sp[1] - sp[0]).toFixed(1)}%` : fmtOf(si, v);
    const tw = text.length * 6.5 + 4;
    const fits = horizontal ? w >= tw && h >= 12 : w >= tw && h >= 14;
    if (!fits) {
      return null;
    }
    return (
      <text
        key={`v-${si}-${xi}`}
        x={x0 + w / 2}
        y={y0 + h / 2 + 4}
        textAnchor="middle"
        className={styles.barValue}
        pointerEvents="none"
        data-testid="lens-bar-value"
      >
        {text}
      </text>
    );
  };

  const rotated = (x: number, yy: number, deg: number) => (deg ? `rotate(${deg} ${x} ${yy})` : undefined);

  // Annotation events: on a time X axis of a vertical chart, at their time within the buckets.
  const step =
    bucketMs ?? (result.xs.length > 1 ? (Number(result.xs[result.xs.length - 1]) - Number(result.xs[0])) / (n - 1) : 0);
  const timePos = (t: number) => m.left + (step > 0 ? ((t - Number(result.xs[0])) / step) * band : band / 2);
  const inPlot = (px: number) => px >= m.left - 0.5 && px <= m.left + plotW + 0.5;
  const events = timeAxis ? (layers?.events ?? []) : [];
  const fmtTime = (t: number) => formatInZone(t, 'YYYY-MM-DD HH:mm:ss', timeZone);
  // Round-time ticks over the drawn time span (bucket starts sit on the band's left edge).
  const tEnd = result.xs.length > 0 ? Number(result.xs[result.xs.length - 1]) + (step > 0 ? step : 0) : 0;
  const timeTickVals = timeAxis
    ? fitTimeTicks(
        timeTicks(Number(result.xs[0]), tEnd, Math.max(2, Math.floor(plotW / (catRot === 0 ? 80 : 28))), timeZone),
        (t) => m.left + (step > 0 ? ((t - Number(result.xs[0])) / step) * band : band / 2),
        // Labels start at the tick (left-anchored): a tick too close to the right edge would be clipped.
        catRot === 0 ? Math.max(0, W - 4) : Infinity
      )
    : [];
  // Partial edge buckets: the time range starts after the first bucket's start / ends before the last one's end.
  const partial: Array<{ xi: number; x: number; w: number }> = [];
  if (timeAxis && timeRange && step > 0) {
    const last = result.xs.length - 1;
    if (Number(result.xs[0]) < timeRange.from) {
      partial.push({ xi: 0, x: m.left, w: band });
    }
    if (Number(result.xs[last]) + step > timeRange.to && (last > 0 || partial.length === 0)) {
      partial.push({ xi: last, x: m.left + band * last, w: band });
    }
  }

  // Partial edge buckets in which every plotted series is 0 (Line / Area only).
  const partialEmpty = new Set<number>(
    chartType === 'bar'
      ? []
      : partial
          .map((p) => p.xi)
          .filter((xi) => spans.every((sp, si) => !visible[si] || !sp[xi] || sp[xi]![0] === sp[xi]![1]))
  );

  /** The crosshair tooltip: the X value, then every visible series' value there, the hovered one highlighted. */
  const MAX_TOOLTIP_ROWS = 20;
  const tooltipEl = (h: { xi: number; si: number | null; px: number; py: number }) => {
    const x = result.xs[h.xi];
    if (x === undefined) {
      return null;
    }
    const header = result.xIsTime ? tooltipTime(Number(x), step, timeZone) : xText(result, h.xi, spanMs);
    const rows = visibleIdx
      .map((si) => ({ si, v: pointValue(result.series[si], x), sp: spans[si][h.xi] }))
      .filter((r) => r.v !== null);
    const shown = rows.slice(0, MAX_TOOLTIP_ROWS);
    const flip = h.px > W / 2;
    return (
      <div
        role="tooltip"
        data-testid="lens-tooltip"
        className={styles.tooltip}
        style={{
          top: Math.max(0, Math.min(h.py - 12, H - 40 - shown.length * 22)),
          ...(flip ? { right: W - h.px + 14 } : { left: h.px + 14 }),
        }}
      >
        <div className={styles.tooltipHeader}>{header}</div>
        {shown.map(({ si, v, sp }) => (
          <div
            key={si}
            className={cx(styles.tooltipRow, h.si === si && styles.tooltipRowOn)}
            data-testid="lens-tooltip-row"
            data-highlighted={h.si === si ? 'true' : undefined}
          >
            <span className={styles.tooltipSwatch} style={{ background: color(si) }} />
            <span className={styles.tooltipName}>{result.series[si].name || '(empty)'}</span>
            <span className={styles.tooltipValue}>
              {percent && sp ? `${formatNumber(+(sp[1] - sp[0]).toFixed(2))}%` : fmtOf(si, v ?? 0)}
            </span>
          </div>
        ))}
        {rows.length > shown.length && (
          <div className={styles.tooltipMore}>+{formatNumber(rows.length - shown.length)} more</div>
        )}
      </div>
    );
  };

  const refLineEls = refLines.map((l) => {
    const p = (lineSide(l) === 'right' ? yR : y)(l.value);
    if (!(horizontal ? p >= m.left - 0.5 && p <= m.left + plotW + 0.5 : p >= m.top - 0.5 && p <= m.top + plotH + 0.5)) {
      return null;
    }
    const valueText = percent ? `${l.value}` : fmt(l.value);
    const name = `Reference line: ${l.text} (${valueText})`;
    const fill =
      l.fill === 'none'
        ? null
        : horizontal
          ? l.fill === 'above'
            ? { x: p, y: m.top, width: m.left + plotW - p, height: plotH }
            : { x: m.left, y: m.top, width: p - m.left, height: plotH }
          : l.fill === 'above'
            ? { x: m.left, y: m.top, width: plotW, height: p - m.top }
            : { x: m.left, y: p, width: plotW, height: m.top + plotH - p };
    return (
      <g
        key={`rl-${l.id}`}
        role="img"
        aria-label={name}
        data-testid="lens-reference-line"
        data-value={l.value}
        data-axis={lineSide(l)}
        pointerEvents="none"
      >
        <title>{name}</title>
        {fill && <rect {...fill} fill={l.color} opacity={0.12} data-testid="lens-reference-fill" />}
        {horizontal ? (
          <line
            x1={p}
            x2={p}
            y1={m.top}
            y2={m.top + plotH}
            stroke={l.color}
            strokeWidth={2}
            strokeDasharray={dashArray(l.lineStyle)}
          />
        ) : (
          <line
            x1={m.left}
            x2={m.left + plotW}
            y1={p}
            y2={p}
            stroke={l.color}
            strokeWidth={2}
            strokeDasharray={dashArray(l.lineStyle)}
          />
        )}
        {l.label && (
          <text
            x={horizontal ? p + 4 : m.left + plotW - 4}
            y={horizontal ? m.top + 12 : p - 4}
            textAnchor={horizontal ? 'start' : 'end'}
            fill={l.color}
            className={styles.refLabel}
            data-testid="lens-reference-label"
          >
            {l.label}
          </text>
        )}
      </g>
    );
  });

  const eventEls = events.map((e) => {
    const x0 = timePos(e.time);
    const x1 = e.end !== undefined ? timePos(e.end) : undefined;
    const a = x1 === undefined ? x0 : Math.max(m.left, Math.min(x0, x1));
    const b = x1 === undefined ? x0 : Math.min(m.left + plotW, Math.max(x0, x1));
    if (x1 === undefined ? !inPlot(x0) : b < a) {
      return null;
    }
    const name = `Annotation: ${e.text} at ${fmtTime(e.time)}${e.end !== undefined ? ` to ${fmtTime(e.end)}` : ''}`;
    return (
      <g key={`an-${e.key}`} role="img" aria-label={name} data-testid="lens-annotation" data-time={e.time}>
        <title>{name}</title>
        {x1 !== undefined ? (
          <rect
            x={a}
            y={m.top}
            width={Math.max(1, b - a)}
            height={plotH}
            fill={e.color}
            opacity={0.12}
            pointerEvents="none"
          />
        ) : (
          <line
            x1={x0}
            x2={x0}
            y1={m.top}
            y2={m.top + plotH}
            stroke={e.color}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            pointerEvents="none"
          />
        )}
        <path d={`M${a - 5},${m.top} L${a + 5},${m.top} L${a},${m.top + 7} Z`} fill={e.color} />
      </g>
    );
  });

  return (
    <div
      className={cx(styles.wrap, sideLegend && styles.wrapRow)}
      data-testid="lens-xy"
      data-orientation={horizontal ? 'horizontal' : 'vertical'}
    >
      {!inside && (lg.alignment === 'top' || lg.alignment === 'left') && legendEl}
      <div ref={boxRef} className={styles.plot}>
        {W > 0 && (
          <svg
            width={W}
            height={H}
            role="group"
            aria-label={`${chartType} chart`}
            onMouseDown={onDown}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={onPlotClick}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={m.left} y={m.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            {/* Value axis: gridlines and tick labels. */}
            {valueTickVals.map((v, k) => {
              const p = y(v);
              return (
                <g key={`v${k}`}>
                  {ax.left.gridlines &&
                    (horizontal ? (
                      <line x1={p} x2={p} y1={m.top} y2={m.top + plotH} className={styles.grid} />
                    ) : (
                      <line x1={m.left} x2={m.left + plotW} y1={p} y2={p} className={styles.grid} />
                    ))}
                  {ax.left.ticks &&
                    (hasLeft || !hasRight || horizontal) &&
                    (horizontal ? (
                      <text
                        x={p}
                        y={m.top + plotH + 16}
                        textAnchor={valRot ? 'end' : 'middle'}
                        transform={rotated(p, m.top + plotH + 16, valRot)}
                        className={styles.tick}
                        data-testid="lens-value-tick"
                      >
                        {leftFmt(v)}
                      </text>
                    ) : (
                      <text
                        x={m.left - 6}
                        y={p + 4}
                        textAnchor="end"
                        transform={rotated(m.left - 6, p + 4, valRot)}
                        className={styles.tick}
                        data-testid="lens-value-tick"
                      >
                        {leftFmt(v)}
                      </text>
                    ))}
                </g>
              );
            })}
            {hasRight &&
              rightTickVals.map((v, k) => (
                <g key={`r${k}`}>
                  {ax.right.gridlines && !ax.left.gridlines && (
                    <line x1={m.left} x2={m.left + plotW} y1={yR(v)} y2={yR(v)} className={styles.grid} />
                  )}
                  {ax.right.ticks && (
                    <text
                      x={m.left + plotW + 6}
                      y={yR(v) + 4}
                      textAnchor="start"
                      transform={rotated(m.left + plotW + 6, yR(v) + 4, tickRotation(ax.right.orientation))}
                      className={styles.tick}
                      data-testid="lens-right-tick"
                    >
                      {percent ? `${Math.round(v)}%` : fmtOf(firstOn('right'), v)}
                    </text>
                  )}
                </g>
              ))}
            {/* Category axis: optional gridlines and labels (round times with the date below on a time axis). */}
            {timeAxis &&
              timeTickVals.map((tk) => {
                const p = timePos(tk.t);
                if (!inPlot(p)) {
                  return null;
                }
                return (
                  <g key={`t${tk.t}`}>
                    {ax.bottom.gridlines && (
                      <line x1={p} x2={p} y1={m.top} y2={m.top + plotH} className={styles.grid} />
                    )}
                    {ax.bottom.ticks && (
                      <>
                        <line x1={p} x2={p} y1={m.top + plotH} y2={m.top + plotH + 4} className={styles.axisLine} />
                        <text
                          x={p + (catRot ? 0 : 3)}
                          y={m.top + plotH + 15}
                          textAnchor={catRot ? 'end' : 'start'}
                          transform={rotated(p, m.top + plotH + 15, catRot)}
                          className={styles.tick}
                          data-testid="lens-category-tick"
                          data-time={tk.t}
                        >
                          {tk.label}
                        </text>
                        {tk.sub && catRot === 0 && (
                          <text
                            x={p + 3}
                            y={m.top + plotH + 29}
                            textAnchor="start"
                            className={styles.tickSub}
                            data-testid="lens-category-subtick"
                          >
                            {tk.sub}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            {result.xs.map((_x, xi) => {
              if (timeAxis) {
                return null;
              }
              if (xi % labelEvery !== 0) {
                return null;
              }
              const c = cx0(xi);
              return (
                <g key={`c${xi}`}>
                  {ax.bottom.gridlines &&
                    (horizontal ? (
                      <line x1={m.left} x2={m.left + plotW} y1={c} y2={c} className={styles.grid} />
                    ) : (
                      <line x1={c} x2={c} y1={m.top} y2={m.top + plotH} className={styles.grid} />
                    ))}
                  {ax.bottom.ticks &&
                    (horizontal ? (
                      <text
                        x={m.left - 6}
                        y={c + 4}
                        textAnchor="end"
                        transform={rotated(m.left - 6, c + 4, catRot)}
                        className={styles.tick}
                        data-testid="lens-category-tick"
                      >
                        <title>{xText(result, xi, spanMs)}</title>
                        {catTick(xi)}
                      </text>
                    ) : (
                      <text
                        x={c}
                        y={m.top + plotH + 16}
                        textAnchor={catRot ? 'end' : 'middle'}
                        transform={rotated(c, m.top + plotH + 16, catRot)}
                        className={styles.tick}
                        data-testid="lens-category-tick"
                      >
                        {catTick(xi)}
                      </text>
                    ))}
                </g>
              );
            })}
            {/* Axis titles. */}
            {titles.left &&
              (horizontal ? (
                <text
                  x={m.left + plotW / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className={styles.axisTitle}
                  data-testid="lens-axis-title-left"
                >
                  {titles.left}
                </text>
              ) : (
                <text
                  x={12}
                  y={m.top + plotH / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${m.top + plotH / 2})`}
                  className={styles.axisTitle}
                  data-testid="lens-axis-title-left"
                >
                  {titles.left}
                </text>
              ))}
            {titles.bottom &&
              (horizontal ? (
                <text
                  x={12}
                  y={m.top + plotH / 2}
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${m.top + plotH / 2})`}
                  className={styles.axisTitle}
                  data-testid="lens-axis-title-bottom"
                >
                  {titles.bottom}
                </text>
              ) : (
                <text
                  x={m.left + plotW / 2}
                  y={H - 4}
                  textAnchor="middle"
                  className={styles.axisTitle}
                  data-testid="lens-axis-title-bottom"
                >
                  {titles.bottom}
                </text>
              ))}
            {titles.right && (
              <text
                x={W - 6}
                y={m.top + plotH / 2}
                textAnchor="middle"
                transform={`rotate(90 ${W - 6} ${m.top + plotH / 2})`}
                className={styles.axisTitle}
                data-testid="lens-axis-title-right"
              >
                {titles.right}
              </text>
            )}
            <rect
              x={m.left}
              y={m.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              className={brushable ? styles.brushable : undefined}
              data-testid="lens-plot-area"
            />
            {/* Buckets the time range covers only in part (Kibana shades them). */}
            {partial.map((p) => (
              <rect
                key={`p${p.xi}`}
                x={p.x}
                y={m.top}
                width={p.w}
                height={plotH}
                className={styles.partial}
                pointerEvents="none"
                data-testid="lens-partial-bucket"
              />
            ))}
            {/* Hovered X: a shaded band for bars, a crosshair for lines. */}
            {hover &&
              (chartType === 'bar' ? (
                horizontal ? (
                  <rect
                    x={m.left}
                    y={m.top + band * hover.xi}
                    width={plotW}
                    height={band}
                    className={styles.hoverBand}
                    pointerEvents="none"
                  />
                ) : (
                  <rect
                    x={m.left + band * hover.xi}
                    y={m.top}
                    width={band}
                    height={plotH}
                    className={styles.hoverBand}
                    pointerEvents="none"
                  />
                )
              ) : (
                <line
                  x1={cx0(hover.xi)}
                  x2={cx0(hover.xi)}
                  y1={m.top}
                  y2={m.top + plotH}
                  className={styles.crosshair}
                  pointerEvents="none"
                  data-testid="lens-crosshair"
                />
              ))}

            <g clipPath={`url(#${clipId})`}>
              {chartType === 'bar' &&
                result.series.map((s, si) =>
                  visible[si]
                    ? result.xs.map((x, xi) => {
                        const sp = spans[si][xi];
                        if (!sp || sp[1] === sp[0]) {
                          return null;
                        }
                        const gi = visibleIdx.indexOf(si);
                        const w = grouped ? barW / visibleIdx.length : barW;
                        const along = cx0(xi) - barW / 2 + (grouped ? gi * w : 0);
                        const a = ys(si)(sp[0]);
                        const b = ys(si)(sp[1]);
                        const rect = horizontal
                          ? {
                              x: Math.min(a, b),
                              y: along,
                              width: Math.max(1, Math.abs(a - b)),
                              height: Math.max(1, w - 1),
                            }
                          : {
                              x: along,
                              y: Math.min(a, b),
                              width: Math.max(1, w - 1),
                              height: Math.max(1, Math.abs(a - b)),
                            };
                        return (
                          <React.Fragment key={`${si}-${xi}`}>
                            <rect
                              {...rect}
                              fill={color(si)}
                              role="button"
                              tabIndex={0}
                              aria-label={itemLabel(xi, si)}
                              className={styles.mark}
                              onClick={(e) => select(e, xi, si)}
                              onKeyDown={(e) => e.key === 'Enter' && select(e, xi, si)}
                              onFocus={() => focusMark(xi, si, rect.x + rect.width / 2, rect.y)}
                              onBlur={() => setHover(null)}
                            />
                            {barValue(si, xi, rect.x, rect.y, rect.width, rect.height, sp)}
                          </React.Fragment>
                        );
                      })
                    : null
                )}

              {(chartType === 'line' || chartType === 'area') &&
                result.series.map((s, si) => {
                  if (!visible[si]) {
                    return null;
                  }
                  // Gaps (no data) break the line; each unbroken run is its own path segment.
                  const pts = result.xs.map((_x, xi) => {
                    const sp = spans[si][xi];
                    // A partial edge bucket with nothing in it (a zero-filled sliver) is not drawn as a drop
                    // to 0 (Kibana); one with data is plotted at its real value (shaded as partial).
                    if (sp && partialEmpty.has(xi)) {
                      return null;
                    }
                    return sp ? ([cx0(xi), ys(si)(sp[1]), ys(si)(sp[0])] as const) : null;
                  });
                  const runs: Array<Array<readonly [number, number, number]>> = [];
                  pts.forEach((p, i) => {
                    if (!p) {
                      return;
                    }
                    if (i === 0 || !pts[i - 1]) {
                      runs.push([]);
                    }
                    runs[runs.length - 1].push(p);
                  });
                  const line = runs
                    .map((r) => r.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' '))
                    .join(' ');
                  const area = runs
                    .map(
                      (r) =>
                        `${r.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ')} ${[...r]
                          .reverse()
                          .map(([px, , py0]) => `L${px},${py0}`)
                          .join(' ')} Z`
                    )
                    .join(' ');
                  return (
                    <g key={si}>
                      {chartType === 'area' && <path d={area} fill={color(si)} opacity={0.35} pointerEvents="none" />}
                      <path d={line} fill="none" stroke={color(si)} strokeWidth={2} pointerEvents="none" />
                      {/* Plain lines (Kibana): a point shows on hover / focus, or when it has no neighbour to join. */}
                      {pts.map((p, xi) => {
                        if (!p) {
                          return null;
                        }
                        const shown = hover?.xi === xi || (!pts[xi - 1] && !pts[xi + 1]);
                        return (
                          <circle
                            key={xi}
                            cx={p[0]}
                            cy={p[1]}
                            r={hover?.xi === xi ? 4 : 3}
                            fill={color(si)}
                            stroke={hover?.xi === xi ? theme.colors.background.primary : undefined}
                            opacity={shown ? 1 : 0}
                            role="button"
                            tabIndex={0}
                            aria-label={itemLabel(xi, si)}
                            className={styles.point}
                            data-point-visible={shown ? 'true' : 'false'}
                            onClick={(e) => select(e, xi, si)}
                            onKeyDown={(e) => e.key === 'Enter' && select(e, xi, si)}
                            onFocus={() => focusMark(xi, si, p[0], p[1])}
                            onBlur={() => setHover(null)}
                          />
                        );
                      })}
                    </g>
                  );
                })}
              {refLineEls}
              {eventEls}
            </g>

            {brush && (
              <rect
                x={Math.min(brush.x0, brush.x1)}
                y={m.top}
                width={Math.abs(brush.x1 - brush.x0)}
                height={plotH}
                className={styles.brush}
                pointerEvents="none"
              />
            )}
          </svg>
        )}
        {hover && !brush && tooltipEl(hover)}
        {inside && legendEl}
      </div>
      {!inside && (lg.alignment === 'bottom' || lg.alignment === 'right') && legendEl}
    </div>
  );
}

/** Colours offered in the legend menu (Grafana palette names, resolved through the theme). */
export const LEGEND_COLORS = [
  'green',
  'yellow',
  'blue',
  'orange',
  'red',
  'purple',
  'dark-green',
  'dark-yellow',
  'dark-blue',
  'dark-orange',
  'dark-red',
  'dark-purple',
  'super-light-blue',
  'light-orange',
  'light-red',
  'text',
];

/** A theme colour (`#rgb`, `#rrggbb`, `rgb(…)`) as `#rrggbb` for the stored choice; black if unknown. */
export function toHex(c: string): string {
  const v = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(v)) {
    return v;
  }
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) {
    return `#${rgb
      .slice(1, 4)
      .map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0'))
      .join('')}`;
  }
  if (/^#[0-9a-f]{8}$/.test(v)) {
    return v.slice(0, 7);
  }
  return '#000000';
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  `,
  wrapRow: css`
    flex-direction: row;
  `,
  plot: css`
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: ${HEIGHT_MIN}px;
  `,
  axisTitle: css`
    fill: ${theme.colors.text.primary};
    font-size: 12px;
  `,
  barValue: css`
    fill: ${theme.colors.text.maxContrast};
    font-size: 11px;
    paint-order: stroke;
    stroke: ${theme.colors.background.primary};
    stroke-width: 2px;
  `,
  refLabel: css`
    font-size: 11px;
    paint-order: stroke;
    stroke: ${theme.colors.background.primary};
    stroke-width: 3px;
  `,
  grid: css`
    stroke: ${theme.colors.border.weak};
  `,
  tick: css`
    fill: ${theme.colors.text.secondary};
    font-size: 11px;
  `,
  tickSub: css`
    fill: ${theme.colors.text.secondary};
    font-size: 10px;
  `,
  axisLine: css`
    stroke: ${theme.colors.border.medium};
  `,
  partial: css`
    fill: ${theme.colors.text.disabled};
    opacity: 0.18;
  `,
  hoverBand: css`
    fill: ${theme.colors.text.primary};
    opacity: 0.06;
  `,
  crosshair: css`
    stroke: ${theme.colors.text.secondary};
    stroke-dasharray: 3 3;
  `,
  point: css`
    cursor: pointer;
    &:focus {
      outline: none;
      opacity: 1;
      stroke: ${theme.colors.text.primary};
    }
  `,
  tooltip: css`
    position: absolute;
    z-index: 3;
    pointer-events: none;
    min-width: 160px;
    max-width: 320px;
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
  tooltipRowOn: css`
    background: ${theme.colors.action.hover};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  tooltipSwatch: css`
    width: 4px;
    align-self: stretch;
    min-height: 14px;
    border-radius: 1px;
  `,
  tooltipName: css`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  tooltipValue: css`
    font-variant-numeric: tabular-nums;
  `,
  tooltipMore: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0.25, 1)};
  `,
  brushable: css`
    cursor: crosshair;
  `,
  brush: css`
    fill: ${theme.colors.primary.transparent};
    stroke: ${theme.colors.primary.border};
  `,
  mark: css`
    cursor: pointer;
    &:hover,
    &:focus {
      opacity: 0.8;
      outline: none;
      stroke: ${theme.colors.text.primary};
    }
  `,
  legend: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5, 1.5)};
    padding-top: ${theme.spacing(0.5)};
  `,
  legendSide: css`
    flex-direction: column;
    flex-wrap: nowrap;
    max-width: 30%;
    overflow-y: auto;
    padding: ${theme.spacing(0, 1)};
  `,
  legendGrid: css`
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  `,
  legendGridSide: css`
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  `,
  legendInside: css`
    position: absolute;
    z-index: 2;
    max-width: 50%;
    padding: ${theme.spacing(0.5, 1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
  `,
  legendItem: css`
    position: relative;
    display: flex;
    align-items: center;
  `,
  legendBtn: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    background: none;
    border: none;
    padding: 0;
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
    cursor: pointer;
  `,
  legendHidden: css`
    opacity: 0.45;
    text-decoration: line-through;
  `,
  swatch: css`
    width: 10px;
    height: 10px;
    border-radius: 2px;
  `,
  menu: css`
    position: absolute;
    bottom: 100%;
    left: 0;
    z-index: 10;
    min-width: 140px;
    padding: ${theme.spacing(0.5)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    display: flex;
    flex-direction: column;
  `,
  menuDown: css`
    bottom: auto;
    top: 100%;
  `,
  colorGroup: css`
    border-top: 1px solid ${theme.colors.border.weak};
    margin-top: ${theme.spacing(0.5)};
    padding-top: ${theme.spacing(0.5)};
  `,
  colorTitle: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0, 0.5, 0.5)};
  `,
  colorGrid: css`
    display: grid;
    grid-template-columns: repeat(8, 16px);
    gap: ${theme.spacing(0.5)};
    padding: ${theme.spacing(0, 0.5, 0.5)};
  `,
  colorSwatch: css`
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid ${theme.colors.border.medium};
    border-radius: 2px;
    cursor: pointer;
    &[aria-checked='true'],
    &:focus-visible {
      outline: 2px solid ${theme.colors.text.primary};
      outline-offset: 1px;
    }
  `,
  menuTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
    padding: ${theme.spacing(0.5)};
  `,
  menuItem: css`
    background: none;
    border: none;
    text-align: left;
    padding: ${theme.spacing(0.5)};
    color: ${theme.colors.text.primary};
    cursor: pointer;
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
});

/**
 * Legend ⋮ menu (SHARED-A11Y-01): focus starts on the first item, Up / Down / Home / End move,
 * Escape or Tab closes it and focus goes back to the ⋮ button.
 */
function LegendMenu({
  className,
  label,
  onClose,
  children,
}: {
  className: string;
  label: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps } = usePopoverDialog(ref, { onClose, autoFocus: false });
  useEffect(() => {
    ref.current
      ?.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')
      ?.focus({ preventScroll: true });
  }, []);
  // A press outside the legend entry (its ⋮ button toggles the menu itself) closes it.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const entry = ref.current?.parentElement;
      if (entry && e.target instanceof Node && !entry.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className={className}
      role="menu"
      tabIndex={-1}
      aria-label={label}
      onKeyDown={(e) => {
        if (ref.current && moveMenuFocus(ref.current, e.key)) {
          e.preventDefault();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          onClose();
        } else {
          dialogProps.onKeyDown(e);
        }
      }}
    >
      {children}
    </div>
  );
}
