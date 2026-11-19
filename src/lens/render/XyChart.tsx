/**
 * Custom-drawn XY chart for Lens bar / line / area (spec LENS-INTERACT-01; blueprint "Lens
 * rendering decision": PanelRenderer has no one-click "point clicked" callback, so the XY types are
 * drawn here). One click on a bar segment or point reports {x, series}; dragging across a time axis
 * reports a time range; legend items toggle visibility and offer Filter for / Filter out.
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { dateTime, GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import { LensResult } from '../compile';
import { ChartType, MetricDim, XySubType } from '../state';
import { formatValue } from '../metricOptions';
import {
  AxisScale,
  axisOf,
  axisTitle,
  legendOf,
  legendVisible,
  LensStyle,
  scalePos,
  tickRotation,
  valueDomain,
  valueTicks,
} from '../style';
import { dashArray, ResolvedEvent, ResolvedLine } from '../layers';

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
}

/** A series' value at x: missing → 0 for counts, null (gap) otherwise. */
function pointValue(s: LensResult['series'][number], x: string | number): number | null {
  const v = s.points.get(x);
  return v === undefined ? (s.zeroFill ? 0 : null) : v;
}

const M = { top: 8, right: 8, bottom: 28, left: 52 };
const HEIGHT_MIN = 200;

const fmt = (v: number) =>
  Math.abs(v) >= 1e6
    ? `${+(v / 1e6).toFixed(2)}M`
    : Math.abs(v) >= 1e3
      ? `${+(v / 1e3).toFixed(1)}K`
      : `${+v.toFixed(2)}`;

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
  const d = dateTime(Number(x));
  return spanMs > 2 * 86_400_000 ? d.format('MM-DD HH:mm') : d.format('HH:mm');
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
}: Props) {
  const styles = useStyles2(getStyles);
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
  // A metric's own colour applies when the series is the metric itself (no breakdown value).
  const color = (i: number) => {
    const own = metricOf(i)?.color;
    return own && result.series[i]?.breakdown === undefined
      ? own
      : theme.visualization.getColorByName(palette[i % palette.length]);
  };
  const fmtOf = (si: number, v: number) => formatValue(v, metricOf(si)?.format, fmt);
  const visible = result.series.map((s) => !hidden.has(s.name));
  const mode: 'stacked' | 'percentage' | 'none' =
    subType === 'percentage' ? 'percentage' : chartType === 'line' || subType === 'unstacked' ? 'none' : 'stacked';
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
  const [lo, hi] = valueDomain(...extent('left', stacked.left.min, stacked.left.max), ax.left, percent);
  const [loR, hiR] = valueDomain(...extent('right', stacked.right.min, stacked.right.max), ax.right, percent);
  const leftScale = percent ? 'linear' : ax.left.scale;
  const rightScale = percent ? 'linear' : ax.right.scale;

  // Margins grow for tick labels, rotated labels and titles.
  const catRot = tickRotation(ax.bottom.orientation);
  const valRot = tickRotation(ax.left.orientation);
  const TITLE = 18;
  const catTicksDepth = !ax.bottom.ticks ? 8 : horizontal ? 96 : catRot === 0 ? 28 : catRot === -45 ? 56 : 76;
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
  // Value → pixel along the value axis (y for vertical charts, x for horizontal bars).
  const vPos = (v: number, a: number, b: number, sc: AxisScale) =>
    horizontal ? m.left + scalePos(v, a, b, sc) * plotW : m.top + plotH - scalePos(v, a, b, sc) * plotH;
  const y = (v: number) => vPos(v, lo, hi, leftScale);
  const yR = (v: number) => vPos(v, loR, hiR, rightScale);
  const ys = (si: number) => (sides[si] === 'right' ? yR : y);
  const leftFmt = (v: number) =>
    percent ? `${Math.round(v)}%` : firstOn('left') >= 0 ? fmtOf(firstOn('left'), v) : fmt(v);
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

  // Brush (time X on a vertical chart only): drag across the plot to pick a range.
  const brushable = result.xIsTime && !!onBrush && !horizontal;
  const pxToTime = (px: number) => {
    const t0 = Number(result.xs[0]);
    const tEnd = Number(result.xs[result.xs.length - 1]) + (bucketMs ?? 0);
    return t0 + ((px - m.left) / plotW) * (tEnd - t0);
  };
  const onDown = (e: React.MouseEvent<SVGRectElement>) => {
    if (!brushable || !onBrush || e.button !== 0) {
      return;
    }
    const left = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect().left;
    const x = e.clientX - left;
    setBrush({ x0: x, x1: x });
    const move = (ev: MouseEvent) =>
      setBrush((b) => (b ? { ...b, x1: Math.min(m.left + plotW, Math.max(m.left, ev.clientX - left)) } : b));
    const stop = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      stopBrush.current = null;
    };
    const up = (ev: MouseEvent) => {
      stop();
      const x1 = Math.min(m.left + plotW, Math.max(m.left, ev.clientX - left));
      setBrush(null);
      if (Math.abs(x1 - x) > 4) {
        onBrush(Math.round(pxToTime(Math.min(x, x1))), Math.round(pxToTime(Math.max(x, x1))));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    stopBrush.current = stop;
  };

  const visibleIdx = result.series.map((_s, i) => i).filter((i) => visible[i]);
  const grouped = chartType === 'bar' && mode === 'none';
  const barW = band * 0.7;
  const showValues = chartType === 'bar' && style?.barValues === 'show';

  // Legend (Style → Legend): visibility, outside side / inside corner, list or grid.
  const lg = legendOf(style);
  const hasBreakdown = result.series.some((s) => s.breakdown !== undefined);
  const showLegend = legendVisible(style, result.series.length, hasBreakdown);
  const inside = lg.position === 'inside';
  const sideLegend = !inside && (lg.alignment === 'left' || lg.alignment === 'right');

  const valueTickVals = valueTicks(lo, hi, leftScale);
  const rightTickVals = valueTicks(loR, hiR, rightScale);
  const catTick = (xi: number) => xText(result, xi, spanMs).slice(0, horizontal ? 16 : 14);

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
          {onLegendFilter && s.breakdown !== undefined && (
            <IconButton
              name="ellipsis-v"
              size="sm"
              tooltip={`Legend actions for ${s.name || '(empty)'}`}
              onClick={() => setMenuFor(menuFor === s.name ? null : s.name)}
            />
          )}
          {menuFor === s.name && onLegendFilter && (
            <div
              className={cx(styles.menu, (lg.alignment.startsWith('top') || inside) && styles.menuDown)}
              role="menu"
              aria-label={`Actions for ${s.name}`}
            >
              <div className={styles.menuTitle}>{s.breakdown || '(empty)'}</div>
              {(['for', 'out'] as const).map((mo) => (
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
            </div>
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
  const events = result.xIsTime && !horizontal && result.xs.length > 0 ? (layers?.events ?? []) : [];
  const fmtTime = (t: number) => dateTime(t).format('YYYY-MM-DD HH:mm:ss');

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
          <svg width={W} height={H} role="group" aria-label={`${chartType} chart`}>
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
            {/* Category axis: optional gridlines and labels. */}
            {result.xs.map((_x, xi) => {
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
              onMouseDown={onDown}
              data-testid="lens-plot-area"
            />

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
                            >
                              <title>{itemLabel(xi, si)}</title>
                            </rect>
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
                      {pts.map((p, xi) =>
                        p ? (
                          <circle
                            key={xi}
                            cx={p[0]}
                            cy={p[1]}
                            r={n > 80 ? 2 : 3}
                            fill={color(si)}
                            role="button"
                            tabIndex={0}
                            aria-label={itemLabel(xi, si)}
                            className={styles.mark}
                            onClick={(e) => select(e, xi, si)}
                            onKeyDown={(e) => e.key === 'Enter' && select(e, xi, si)}
                          >
                            <title>{itemLabel(xi, si)}</title>
                          </circle>
                        ) : null
                      )}
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
        {inside && legendEl}
      </div>
      {!inside && (lg.alignment === 'bottom' || lg.alignment === 'right') && legendEl}
    </div>
  );
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
