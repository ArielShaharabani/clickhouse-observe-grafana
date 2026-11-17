/**
 * Custom-drawn XY chart for Lens bar / line / area (spec LENS-INTERACT-01; blueprint "Lens
 * rendering decision": PanelRenderer has no one-click "point clicked" callback, so the XY types are
 * drawn here). One click on a bar segment or point reports {x, series}; dragging across a time axis
 * reports a time range; legend items toggle visibility and offer Filter for / Filter out.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { dateTime, GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2, useTheme2 } from '@grafana/ui';
import { LensResult } from '../compile';
import { ChartType, XySubType } from '../state';

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
  /** Legend ⋮ actions; omitted → no menu. */
  onLegendFilter?: (seriesIndex: number, mode: 'for' | 'out') => void;
}

const M = { top: 8, right: 8, bottom: 28, left: 52 };
const HEIGHT_MIN = 200;

function niceMax(v: number): number {
  if (v <= 0) {
    return 1;
  }
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

const fmt = (v: number) =>
  Math.abs(v) >= 1e6
    ? `${+(v / 1e6).toFixed(2)}M`
    : Math.abs(v) >= 1e3
      ? `${+(v / 1e3).toFixed(1)}K`
      : `${+v.toFixed(2)}`;

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
): { spans: Array<Array<[number, number] | null>>; max: number } {
  const spans: Array<Array<[number, number] | null>> = result.series.map(() => []);
  let max = 0;
  result.xs.forEach((x, xi) => {
    const vals = result.series.map((s, si) => (visible[si] ? (s.points.get(x) ?? 0) : 0));
    const total = vals.reduce((a, b) => a + b, 0);
    let acc = 0;
    result.series.forEach((_s, si) => {
      if (!visible[si]) {
        spans[si][xi] = null;
        return;
      }
      const raw = vals[si];
      const v = mode === 'percentage' ? (total > 0 ? (raw / total) * 100 : 0) : raw;
      if (mode === 'none') {
        spans[si][xi] = [0, v];
        max = Math.max(max, v);
      } else {
        spans[si][xi] = [acc, acc + v];
        acc += v;
      }
    });
    if (mode !== 'none') {
      max = Math.max(max, acc);
    }
  });
  return { spans, max: mode === 'percentage' ? 100 : max };
}

export function XyChart({ chartType, subType, result, bucketMs, onSelect, onBrush, onLegendFilter }: Props) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [brush, setBrush] = useState<{ x0: number; x1: number } | null>(null);

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
  const color = (i: number) => theme.visualization.getColorByName(palette[i % palette.length]);
  const visible = result.series.map((s) => !hidden.has(s.name));
  const mode: 'stacked' | 'percentage' | 'none' =
    subType === 'percentage' ? 'percentage' : chartType === 'line' || subType === 'unstacked' ? 'none' : 'stacked';
  const { spans, max } = useMemo(
    () =>
      stackValues(
        result,
        result.series.map((s) => !hidden.has(s.name)),
        mode
      ),
    [result, hidden, mode]
  );

  const W = Math.max(size.w, 0);
  const H = Math.max(size.h, HEIGHT_MIN);
  const plotW = Math.max(1, W - M.left - M.right);
  const plotH = Math.max(1, H - M.top - M.bottom);
  const yMax = niceMax(max);
  const y = (v: number) => M.top + plotH - (v / yMax) * plotH;
  const n = Math.max(1, result.xs.length);
  const band = plotW / n;
  const cx0 = (xi: number) => M.left + band * xi + band / 2;
  const spanMs =
    result.xIsTime && result.xs.length > 1 ? Number(result.xs[result.xs.length - 1]) - Number(result.xs[0]) : 0;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 90))));

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
    `${xLabel(result.xs[xi], result.xIsTime, spanMs)} · ${result.series[si].name}: ${fmt(result.series[si].points.get(result.xs[xi]) ?? 0)}`;

  // Brush (time X only): drag across the plot to pick a range.
  const pxToTime = (px: number) => {
    const t0 = Number(result.xs[0]);
    const tEnd = Number(result.xs[result.xs.length - 1]) + (bucketMs ?? 0);
    return t0 + ((px - M.left) / plotW) * (tEnd - t0);
  };
  const onDown = (e: React.MouseEvent<SVGRectElement>) => {
    if (!result.xIsTime || !onBrush || e.button !== 0) {
      return;
    }
    const left = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect().left;
    const x = e.clientX - left;
    setBrush({ x0: x, x1: x });
    const move = (ev: MouseEvent) =>
      setBrush((b) => (b ? { ...b, x1: Math.min(M.left + plotW, Math.max(M.left, ev.clientX - left)) } : b));
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const x1 = Math.min(M.left + plotW, Math.max(M.left, ev.clientX - left));
      setBrush(null);
      if (Math.abs(x1 - x) > 4) {
        onBrush(Math.round(pxToTime(Math.min(x, x1))), Math.round(pxToTime(Math.max(x, x1))));
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const visibleIdx = result.series.map((_s, i) => i).filter((i) => visible[i]);
  const grouped = chartType === 'bar' && mode === 'none';
  const barW = band * 0.7;

  return (
    <div className={styles.wrap} data-testid="lens-xy">
      <div ref={boxRef} className={styles.plot}>
        {W > 0 && (
          <svg width={W} height={H} role="img" aria-label={`${chartType} chart`}>
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={M.left} x2={M.left + plotW} y1={y(yMax * f)} y2={y(yMax * f)} className={styles.grid} />
                <text x={M.left - 6} y={y(yMax * f) + 4} textAnchor="end" className={styles.tick}>
                  {mode === 'percentage' ? `${Math.round(yMax * f)}%` : fmt(yMax * f)}
                </text>
              </g>
            ))}
            {result.xs.map((x, xi) =>
              xi % labelEvery === 0 ? (
                <text key={xi} x={cx0(xi)} y={H - 8} textAnchor="middle" className={styles.tick}>
                  {xLabel(x, result.xIsTime, spanMs).slice(0, 14)}
                </text>
              ) : null
            )}
            <rect
              x={M.left}
              y={M.top}
              width={plotW}
              height={plotH}
              fill="transparent"
              className={result.xIsTime && onBrush ? styles.brushable : undefined}
              onMouseDown={onDown}
              data-testid="lens-plot-area"
            />

            {chartType === 'bar' &&
              result.series.map((s, si) =>
                visible[si]
                  ? result.xs.map((x, xi) => {
                      const sp = spans[si][xi];
                      if (!sp || sp[1] - sp[0] <= 0) {
                        return null;
                      }
                      const gi = visibleIdx.indexOf(si);
                      const w = grouped ? barW / visibleIdx.length : barW;
                      const left = cx0(xi) - barW / 2 + (grouped ? gi * w : 0);
                      return (
                        <rect
                          key={`${si}-${xi}`}
                          x={left}
                          width={Math.max(1, w - 1)}
                          y={y(sp[1])}
                          height={Math.max(1, y(sp[0]) - y(sp[1]))}
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
                      );
                    })
                  : null
              )}

            {(chartType === 'line' || chartType === 'area') &&
              result.series.map((s, si) => {
                if (!visible[si]) {
                  return null;
                }
                const top = result.xs.map((_x, xi) => [cx0(xi), y(spans[si][xi]?.[1] ?? 0)] as const);
                const bottom = result.xs.map((_x, xi) => [cx0(xi), y(spans[si][xi]?.[0] ?? 0)] as const);
                const line = top.map(([px, py], i) => `${i ? 'L' : 'M'}${px},${py}`).join(' ');
                const area = `${line} ${[...bottom]
                  .reverse()
                  .map(([px, py]) => `L${px},${py}`)
                  .join(' ')} Z`;
                return (
                  <g key={si}>
                    {chartType === 'area' && <path d={area} fill={color(si)} opacity={0.35} pointerEvents="none" />}
                    <path d={line} fill="none" stroke={color(si)} strokeWidth={2} pointerEvents="none" />
                    {top.map(([px, py], xi) => (
                      <circle
                        key={xi}
                        cx={px}
                        cy={py}
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
                    ))}
                  </g>
                );
              })}

            {brush && (
              <rect
                x={Math.min(brush.x0, brush.x1)}
                y={M.top}
                width={Math.abs(brush.x1 - brush.x0)}
                height={plotH}
                className={styles.brush}
                pointerEvents="none"
              />
            )}
          </svg>
        )}
      </div>

      <div className={styles.legend} role="list" aria-label="Legend">
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
                onClick={() => setMenuFor(menuFor === si ? null : si)}
              />
            )}
            {menuFor === si && (
              <div className={styles.menu} role="menu" aria-label={`Actions for ${s.name}`}>
                <div className={styles.menuTitle}>{s.breakdown || '(empty)'}</div>
                {(['for', 'out'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => {
                      setMenuFor(null);
                      onLegendFilter?.(si, m);
                    }}
                  >
                    {m === 'for' ? 'Filter for' : 'Filter out'}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
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
  plot: css`
    flex: 1;
    min-height: ${HEIGHT_MIN}px;
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
