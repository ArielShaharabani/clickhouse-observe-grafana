/**
 * Pie / Donut (round 3 #18): custom-drawn so slice labels read like Kibana's — "name 43.93%" with
 * up to two decimals, inside the slice (the donut's ring) when they fit there, otherwise outside
 * with a leader line, never on top of each other. Grafana's piechart has one panel-wide label
 * switch, whole-number percents and no collision handling, so small neighbouring slices overlapped
 * and donut labels spilled over the ring. Saved dashboard panels still use Grafana's piechart.
 *
 * One click (or Enter on a focused slice) filters on the slice's value, like the other charts.
 */
import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { MetricDim } from '../state';
import { formatOf, formatValue } from '../metricOptions';
import { formatNumber } from '../../utils/axisNumber';
import { XySelection } from './XyChart';

/** Label font (px), its line height, and the width of a character at that size (an estimate). */
const FONT = 12;
const LINE_H = 15;
const CHAR_W = 6.9;
/** Donut hole, as a share of the radius. */
export const DONUT_HOLE = 0.55;

/** "43.93%": a share of the total with at most two decimals (Kibana's default percent display). */
export function pctText(share: number): string {
  return `${Number((share * 100).toFixed(2))}%`;
}

const textW = (s: string) => s.length * CHAR_W;

export interface PieLabel {
  /** Lines of text (one, or name / percent on two lines inside a slice). */
  lines: string[];
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
  inside: boolean;
  /** Outside labels: leader line points (slice edge → elbow → label). */
  line?: Array<[number, number]>;
}

export interface PieSlice {
  index: number;
  /** Angles in radians, clockwise from 12 o'clock. */
  start: number;
  end: number;
  share: number;
  path: string;
  label?: PieLabel;
}

export interface PieLayout {
  cx: number;
  cy: number;
  r: number;
  inner: number;
  slices: PieSlice[];
}

const pt = (cx: number, cy: number, r: number, a: number): [number, number] => [
  cx + r * Math.sin(a),
  cy - r * Math.cos(a),
];

function arcPath(cx: number, cy: number, r: number, inner: number, s: number, e: number): string {
  const f = (n: number) => Number(n.toFixed(2));
  if (e - s >= 2 * Math.PI - 1e-9) {
    // A full circle: two half arcs (one arc from a point to itself draws nothing).
    const ring = (rr: number, sweep: 0 | 1) =>
      `M ${f(cx)} ${f(cy - rr)} A ${f(rr)} ${f(rr)} 0 1 ${sweep} ${f(cx)} ${f(cy + rr)} A ${f(rr)} ${f(rr)} 0 1 ${sweep} ${f(cx)} ${f(cy - rr)} Z`;
    return inner > 0 ? `${ring(r, 1)} ${ring(inner, 0)}` : ring(r, 1);
  }
  const large = e - s > Math.PI ? 1 : 0;
  const [x0, y0] = pt(cx, cy, r, s);
  const [x1, y1] = pt(cx, cy, r, e);
  if (inner <= 0) {
    return `M ${f(cx)} ${f(cy)} L ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x1)} ${f(y1)} Z`;
  }
  const [x2, y2] = pt(cx, cy, inner, e);
  const [x3, y3] = pt(cx, cy, inner, s);
  return `M ${f(x0)} ${f(y0)} A ${f(r)} ${f(r)} 0 ${large} 1 ${f(x1)} ${f(y1)} L ${f(x2)} ${f(y2)} A ${f(inner)} ${f(inner)} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

/** Whether a w × h box centred on (dx, dy) — relative to the centre — lies inside the slice. */
function boxFits(
  dx: number,
  dy: number,
  w: number,
  h: number,
  r: number,
  inner: number,
  s: number,
  e: number
): boolean {
  const full = e - s >= 2 * Math.PI - 1e-9;
  for (const [ox, oy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [-w / 2, h / 2],
    [w / 2, h / 2],
    [0, -h / 2],
    [0, h / 2],
  ]) {
    const x = dx + ox;
    const y = dy + oy;
    const d = Math.hypot(x, y);
    if (d > r - 3 || d < inner + 3) {
      return false;
    }
    if (!full) {
      let a = Math.atan2(x, -y);
      if (a < 0) {
        a += 2 * Math.PI;
      }
      // Keep a little room from the slice's edges.
      const pad = 2 / Math.max(d, 1);
      if (a < s + pad || a > e - pad) {
        return false;
      }
    }
  }
  return true;
}

/** An inside placement for the label, or undefined when it does not fit in the slice. */
function insideLabel(
  cx: number,
  cy: number,
  r: number,
  inner: number,
  s: number,
  e: number,
  name: string,
  pct: string
): PieLabel | undefined {
  const mid = (s + e) / 2;
  const fracs = inner > 0 ? [(inner + r) / 2 / r] : [0.62, 0.5, 0.72, 0.4, 0.8];
  const one = `${name} ${pct}`;
  for (const lines of [[one], [name, pct]]) {
    const w = Math.max(...lines.map(textW));
    const h = lines.length * LINE_H;
    for (const fr of fracs) {
      const [px, py] = pt(0, 0, r * fr, mid);
      if (boxFits(px, py, w, h, r, inner, s, e)) {
        return { lines, x: cx + px, y: cy + py, anchor: 'middle', inside: true };
      }
    }
  }
  return undefined;
}

/** Cuts a name so "name pct" takes at most `px`. */
function fitName(name: string, pct: string, px: number): string {
  const max = Math.floor(px / CHAR_W) - pct.length - 1;
  if (name.length <= max) {
    return name;
  }
  return max <= 1 ? '…' : `${name.slice(0, max - 1)}…`;
}

/**
 * Slices and label positions for a w × h box. Labels go inside the slice when they fit; the others
 * go outside, left or right of the pie, spread vertically so they never overlap (the pie shrinks to
 * leave room for them). When there is not enough height for every outside label, the smallest
 * slices lose theirs (the legend and the tooltip still give the numbers).
 */
export function pieLayout(values: number[], names: string[], w: number, h: number, donut: boolean): PieLayout {
  const vals = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, v) => a + v, 0);
  const cx = w / 2;
  const cy = h / 2;
  const angles: Array<{ i: number; s: number; e: number; share: number }> = [];
  let a = 0;
  vals.forEach((v, i) => {
    const share = total > 0 ? v / total : 0;
    if (share > 0) {
      angles.push({ i, s: a, e: a + share * 2 * Math.PI, share });
      a += share * 2 * Math.PI;
    }
  });
  const pctOf = (share: number) => pctText(share);

  const placeInside = (r: number) => {
    const inner = donut ? r * DONUT_HOLE : 0;
    return angles.map((g) => insideLabel(cx, cy, r, inner, g.s, g.e, names[g.i] ?? '', pctOf(g.share)));
  };
  let r = Math.max(4, Math.min(w, h) / 2 - 6);
  let inside = placeInside(r);
  if (inside.some((l) => !l)) {
    // Room on both sides for the outside labels (centred pie), at most 30 % of the width each.
    const widest = Math.max(
      ...angles.filter((_, k) => !inside[k]).map((g) => textW(`${names[g.i] ?? ''} ${pctOf(g.share)}`))
    );
    const margin = Math.min(widest + 26, w * 0.3);
    r = Math.max(4, Math.min(w / 2 - margin, h / 2 - LINE_H));
    inside = placeInside(r);
  }
  const inner = donut ? r * DONUT_HOLE : 0;
  const labelRoom = Math.max(20, w / 2 - r - 26);

  const slices: PieSlice[] = angles.map((g, k) => ({
    index: g.i,
    start: g.s,
    end: g.e,
    share: g.share,
    path: arcPath(cx, cy, r, inner, g.s, g.e),
    label: inside[k],
  }));

  // Outside labels, per side, spread top to bottom without overlap.
  const outside = slices.filter((s) => !s.label);
  for (const right of [true, false]) {
    let side = outside.filter((s) => Math.sin((s.start + s.end) / 2) >= 0 === right);
    const fit = Math.max(0, Math.floor((h - 4) / LINE_H));
    if (side.length > fit) {
      const keep = new Set([...side].sort((x, y) => y.share - x.share).slice(0, fit));
      side = side.filter((s) => keep.has(s));
    }
    const want = side.map((s) => ({ s, y: pt(cx, cy, r + 12, (s.start + s.end) / 2)[1] })).sort((p, q) => p.y - q.y);
    const top = LINE_H / 2 + 2;
    const bottom = h - LINE_H / 2 - 2;
    for (let k = 0; k < want.length; k++) {
      want[k].y = Math.max(want[k].y, top, k > 0 ? want[k - 1].y + LINE_H : -Infinity);
    }
    for (let k = want.length - 1; k >= 0; k--) {
      want[k].y = Math.min(want[k].y, bottom, k < want.length - 1 ? want[k + 1].y - LINE_H : Infinity);
    }
    for (const { s, y } of want) {
      const mid = (s.start + s.end) / 2;
      const name = names[s.index] ?? '';
      const pct = pctOf(s.share);
      const edge = pt(cx, cy, r, mid);
      const elbow = pt(cx, cy, r + 10, mid);
      const lx = right ? cx + r + 18 : cx - r - 18;
      s.label = {
        lines: [`${fitName(name, pct, labelRoom)} ${pct}`],
        x: lx,
        y,
        anchor: right ? 'start' : 'end',
        inside: false,
        line: [edge, [elbow[0], y], [right ? lx - 3 : lx + 3, y]],
      };
    }
  }
  return { cx, cy, r, inner, slices };
}

interface Props {
  names: string[];
  values: number[];
  colors: string[];
  donut: boolean;
  metric?: MetricDim;
  metricLabel?: string;
  onSelect?: (sel: XySelection) => void;
}

const LEGEND_MIN_W = 420;

export function PieChart({ names, values, colors, donut, metric, metricLabel, onSelect }: Props) {
  const styles = useStyles2(getStyles);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
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
  const fmt = (v: number) => formatValue(v, formatOf(metric), formatNumber);
  const total = values.reduce((a, v) => a + (Number.isFinite(v) && v > 0 ? v : 0), 0);
  const share = (v: number) => (total > 0 && v > 0 ? v / total : 0);
  const legendRight = size.w >= LEGEND_MIN_W;
  const legendW = legendRight ? Math.min(300, Math.max(160, size.w * 0.32)) : size.w;
  const legendH = legendRight ? 0 : Math.min(size.h * 0.4, names.length * 22 + 8);
  const pw = Math.max(0, legendRight ? size.w - legendW : size.w);
  const ph = Math.max(0, size.h - legendH);
  const layout = pw > 40 && ph > 40 ? pieLayout(values, names, pw, ph, donut) : null;
  const sliceText = (i: number) => `${names[i]}: ${fmt(values[i])} (${pctText(share(values[i]))})`;
  const select = (i: number, clientX: number, clientY: number) =>
    onSelect?.({ xIndex: i, seriesIndex: 0, clientX, clientY });

  return (
    <div
      ref={boxRef}
      className={cx(styles.wrap, legendRight ? styles.row : styles.col)}
      data-testid="lens-pie"
      data-pie-type={donut ? 'donut' : 'pie'}
    >
      <div className={styles.plot} style={{ width: pw, height: ph }}>
        {layout && (
          <svg width={pw} height={ph} role="group" aria-label={metricLabel ?? 'Pie chart'}>
            {layout.slices.map((s) => (
              <path
                key={`s${s.index}`}
                d={s.path}
                fill={colors[s.index]}
                className={cx(styles.slice, hover?.i === s.index && styles.sliceHover, onSelect && styles.clickable)}
                role={onSelect ? 'button' : 'img'}
                tabIndex={onSelect ? 0 : undefined}
                aria-label={sliceText(s.index)}
                data-testid="lens-pie-slice"
                onMouseMove={(e) => {
                  const r = boxRef.current?.getBoundingClientRect();
                  setHover({ i: s.index, x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) });
                }}
                onMouseLeave={() => setHover(null)}
                onClick={(e) => select(s.index, e.clientX, e.clientY)}
                onKeyDown={(e) => {
                  if (onSelect && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    const r = (e.currentTarget as SVGPathElement).getBoundingClientRect();
                    select(s.index, r.left + r.width / 2, r.top + r.height / 2);
                  }
                }}
              />
            ))}
            {layout.slices.map(
              (s) =>
                s.label && (
                  <g key={`l${s.index}`} aria-hidden data-testid="lens-pie-label" data-inside={s.label.inside}>
                    {s.label.line && (
                      <polyline
                        points={s.label.line.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}
                        className={styles.leader}
                      />
                    )}
                    <text
                      x={s.label.x}
                      y={s.label.y - ((s.label.lines.length - 1) * LINE_H) / 2}
                      textAnchor={s.label.anchor}
                      dominantBaseline="central"
                      className={s.label.inside ? styles.insideLabel : styles.outsideLabel}
                    >
                      {s.label.lines.map((t, k) => (
                        <tspan key={k} x={s.label!.x} dy={k === 0 ? 0 : LINE_H}>
                          {t}
                        </tspan>
                      ))}
                    </text>
                  </g>
                )
            )}
          </svg>
        )}
      </div>
      <ul
        className={styles.legend}
        style={legendRight ? { width: legendW, maxHeight: size.h } : { maxHeight: legendH }}
        aria-label="Legend"
        data-testid="lens-pie-legend"
      >
        {names.map((n, i) => (
          <li key={`${i}:${n}`} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: colors[i] }} aria-hidden />
            <span className={styles.legendName} title={n}>
              {n}
            </span>
            <span className={styles.legendValue}>{fmt(values[i])}</span>
            <span className={styles.legendValue}>{pctText(share(values[i]))}</span>
          </li>
        ))}
      </ul>
      {hover && (
        <div
          role="tooltip"
          data-testid="lens-tooltip"
          className={styles.tooltip}
          style={{
            top: Math.max(0, Math.min(hover.y + 12, size.h - 60)),
            ...(hover.x > size.w / 2 ? { right: size.w - hover.x + 12 } : { left: hover.x + 12 }),
          }}
        >
          <div className={styles.tooltipRow}>
            <span className={styles.swatch} style={{ background: colors[hover.i] }} aria-hidden />
            <span className={styles.tooltipName}>{names[hover.i]}</span>
            <span className={styles.tooltipValue}>{fmt(values[hover.i])}</span>
            <span className={styles.tooltipValue}>{pctText(share(values[hover.i]))}</span>
          </div>
          {metricLabel && <div className={styles.tooltipMetric}>{metricLabel}</div>}
        </div>
      )}
    </div>
  );
}

const cx = (...c: Array<string | false | undefined>) => c.filter(Boolean).join(' ');

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 0;
    display: flex;
    overflow: hidden;
  `,
  row: css`
    flex-direction: row;
  `,
  col: css`
    flex-direction: column;
  `,
  plot: css`
    flex: none;
  `,
  slice: css`
    stroke: ${theme.colors.background.primary};
    stroke-width: 1px;
    outline: none;
    &:focus-visible {
      stroke: ${theme.colors.primary.border};
      stroke-width: 2px;
    }
  `,
  sliceHover: css`
    opacity: 0.85;
  `,
  clickable: css`
    cursor: pointer;
  `,
  leader: css`
    fill: none;
    stroke: ${theme.colors.text.secondary};
    stroke-width: 1px;
  `,
  insideLabel: css`
    fill: #fff;
    font-size: ${FONT}px;
    font-weight: ${theme.typography.fontWeightMedium};
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 2px;
    pointer-events: none;
  `,
  outsideLabel: css`
    fill: ${theme.colors.text.primary};
    font-size: ${FONT}px;
    pointer-events: none;
  `,
  legend: css`
    list-style: none;
    margin: 0;
    padding: ${theme.spacing(1)};
    overflow: auto;
    flex: none;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  legendItem: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: 2px 0;
  `,
  legendName: css`
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  legendValue: css`
    font-variant-numeric: tabular-nums;
    color: ${theme.colors.text.secondary};
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
    flex: none;
  `,
});
