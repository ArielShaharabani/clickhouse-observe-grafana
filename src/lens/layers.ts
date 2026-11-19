/**
 * Visualize layers beyond the data layer (spec LENS-LAYER-01, XY charts only):
 *
 * - **Reference lines**: a static value, or a value computed over the chart's data (an aggregate
 *   of a field with the chart's query, filters and time range), drawn across the plot on the left
 *   or right value axis, with an optional label, colour, line style and fill above / below.
 * - **Annotations**: manual time markers (a point or a range) and query markers (a KQL query
 *   against the data view, each matching document's time is an event), drawn on time charts.
 *
 * Layers are display-only for the chart query (`queryShape` drops them); computed lines and query
 * annotations run their own small queries (`compile.ts`: `compileReferenceValues`,
 * `compileAnnotationQuery`). Everything here comes from the URL, a draft or a saved chart, so
 * `cleanLayers` keeps only known keys with known values (finite numbers, capped strings, enum
 * values); the editors build every change through it too.
 */
import type { MetricOp } from './state';

/** Same caps as a dimension name and a Filters query (state.ts; not imported to avoid a cycle). */
const MAX_NAME = 120;
const MAX_FILTER_QUERY = 1000;

export type LayerKind = 'referenceLine' | 'annotations';
export type LineStyle = 'solid' | 'dashed' | 'dotted';
export type LineFill = 'none' | 'above' | 'below';

/** Aggregates a computed reference line can use (Kibana's quick functions for reference lines). */
export type RefOp = Extract<MetricOp, 'count' | 'avg' | 'sum' | 'min' | 'max' | 'median' | 'unique'>;
export const REF_OPS: readonly RefOp[] = ['count', 'avg', 'sum', 'min', 'max', 'median', 'unique'];

/** A computed reference value: an aggregate over the chart's data (count needs no field). */
export interface RefComputed {
  op: RefOp;
  /** SQL expression of the field (checked against the discovered fields before compiling). */
  field?: string;
  fieldLabel?: string;
  numeric?: boolean;
}

export interface ReferenceLine {
  id: string;
  /** Static value; ignored when `computed` is set. */
  value: number;
  computed?: RefComputed;
  label?: string;
  /** `#rrggbb`. */
  color?: string;
  /** Value axis; default left. */
  axis?: 'right';
  /** Default solid. */
  lineStyle?: Exclude<LineStyle, 'solid'>;
  /** Default none. */
  fill?: Exclude<LineFill, 'none'>;
}

export interface ManualAnnotation {
  id: string;
  type: 'manual';
  /** Epoch ms. */
  time: number;
  /** Range end (epoch ms, after `time`); absent = a point in time. */
  end?: number;
  label?: string;
  color?: string;
}

export interface QueryAnnotation {
  id: string;
  type: 'query';
  /** KQL, compiled by the search bar's compiler. */
  query: string;
  label?: string;
  color?: string;
}

export type Annotation = ManualAnnotation | QueryAnnotation;

export interface ReferenceLineLayer {
  kind: 'referenceLine';
  id: string;
  lines: ReferenceLine[];
}

export interface AnnotationLayer {
  kind: 'annotations';
  id: string;
  annotations: Annotation[];
}

export type ExtraLayer = ReferenceLineLayer | AnnotationLayer;

export const MAX_LAYERS = 5;
export const MAX_LAYER_ITEMS = 10;
/** Events drawn per query annotation (newest first). */
export const MAX_QUERY_EVENTS = 100;
const MAX_ID = 64;
/** 1970 … 2200: anything else is not a time this chart can show. */
const MAX_TIME = 7_258_118_400_000;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[A-Za-z0-9_-]+$/;

export const LAYER_LABELS: Record<LayerKind, string> = {
  referenceLine: 'Reference lines',
  annotations: 'Annotations',
};
export const DEFAULT_LINE_COLOR = '#e02f44';
export const DEFAULT_ANNOTATION_COLOR = '#8f3bb8';

const obj = (x: unknown): Record<string, unknown> | undefined =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : undefined;
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const label = (x: unknown): string | undefined =>
  typeof x === 'string' && x.trim() ? x.slice(0, MAX_NAME) : undefined;
const color = (x: unknown): string | undefined => (typeof x === 'string' && COLOR.test(x) ? x : undefined);
const time = (x: unknown): number | undefined => (finite(x) && x >= 0 && x <= MAX_TIME ? Math.round(x) : undefined);

/** Ids are only compared (React keys, editor selection); a bad or repeated one gets a fresh id. */
function idOf(x: unknown, seen: Set<string>, fallback: string): string {
  let id = typeof x === 'string' && x.length <= MAX_ID && ID.test(x) && !seen.has(x) ? x : fallback;
  for (let n = 1; seen.has(id); n++) {
    id = `${fallback}_${n}`;
  }
  seen.add(id);
  return id;
}

function cleanComputed(x: unknown): RefComputed | undefined {
  const c = obj(x);
  if (!c || !REF_OPS.includes(c.op as RefOp)) {
    return undefined;
  }
  if (c.op === 'count') {
    return { op: 'count' };
  }
  if (typeof c.field !== 'string' || !c.field || c.field.length > 1000) {
    return undefined;
  }
  const out: RefComputed = { op: c.op as RefOp, field: c.field };
  if (typeof c.fieldLabel === 'string' && c.fieldLabel.length <= 500) {
    out.fieldLabel = c.fieldLabel;
  }
  if (c.numeric === true) {
    out.numeric = true;
  }
  return out;
}

function cleanLine(x: unknown, seen: Set<string>, i: number): ReferenceLine | undefined {
  const l = obj(x);
  if (!l) {
    return undefined;
  }
  const computed = cleanComputed(l.computed);
  if (!computed && !finite(l.value)) {
    return undefined;
  }
  const out: ReferenceLine = { id: idOf(l.id, seen, `rl${i}`), value: finite(l.value) ? l.value : 0 };
  if (computed) {
    out.computed = computed;
  }
  const lb = label(l.label);
  if (lb) {
    out.label = lb;
  }
  const c = color(l.color);
  if (c) {
    out.color = c;
  }
  if (l.axis === 'right') {
    out.axis = 'right';
  }
  if (l.lineStyle === 'dashed' || l.lineStyle === 'dotted') {
    out.lineStyle = l.lineStyle;
  }
  if (l.fill === 'above' || l.fill === 'below') {
    out.fill = l.fill;
  }
  return out;
}

function cleanAnnotation(x: unknown, seen: Set<string>, i: number): Annotation | undefined {
  const a = obj(x);
  if (!a) {
    return undefined;
  }
  let out: Annotation;
  if (a.type === 'manual') {
    const t = time(a.time);
    if (t === undefined) {
      return undefined;
    }
    out = { id: idOf(a.id, seen, `an${i}`), type: 'manual', time: t };
    const end = time(a.end);
    if (end !== undefined && end > t) {
      out.end = end;
    }
  } else if (a.type === 'query') {
    if (typeof a.query !== 'string' || a.query.length > MAX_FILTER_QUERY) {
      return undefined;
    }
    out = { id: idOf(a.id, seen, `an${i}`), type: 'query', query: a.query };
  } else {
    return undefined;
  }
  const lb = label(a.label);
  if (lb) {
    out.label = lb;
  }
  const c = color(a.color);
  if (c) {
    out.color = c;
  }
  return out;
}

/** Untrusted input (URL / draft / saved chart) → well-formed layers, or undefined when there are none. */
export function cleanLayers(x: unknown): ExtraLayer[] | undefined {
  if (!Array.isArray(x)) {
    return undefined;
  }
  const seen = new Set<string>();
  const out: ExtraLayer[] = [];
  for (const [i, raw] of x.slice(0, MAX_LAYERS).entries()) {
    const l = obj(raw);
    if (l?.kind === 'referenceLine' && Array.isArray(l.lines)) {
      const id = idOf(l.id, seen, `layer${i}`);
      const lines = (l.lines as unknown[])
        .slice(0, MAX_LAYER_ITEMS)
        .map((v, k) => cleanLine(v, seen, k))
        .filter((v): v is ReferenceLine => !!v);
      out.push({ kind: 'referenceLine', id, lines });
    } else if (l?.kind === 'annotations' && Array.isArray(l.annotations)) {
      const id = idOf(l.id, seen, `layer${i}`);
      const annotations = (l.annotations as unknown[])
        .slice(0, MAX_LAYER_ITEMS)
        .map((v, k) => cleanAnnotation(v, seen, k))
        .filter((v): v is Annotation => !!v);
      out.push({ kind: 'annotations', id, annotations });
    }
  }
  return out.length > 0 ? out : undefined;
}

let seq = 0;
/** Fresh id for a layer or item (only compared, never trusted). */
export function newLayerId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

/** Adds an empty layer of `kind` (no-op at the cap). */
export function addLayer(layers: ExtraLayer[] | undefined, kind: LayerKind): ExtraLayer[] {
  const list = layers ?? [];
  if (list.length >= MAX_LAYERS) {
    return list;
  }
  const id = newLayerId('layer');
  return [...list, kind === 'referenceLine' ? { kind, id, lines: [] } : { kind, id, annotations: [] }];
}

/** Clear layer: keeps the layer, drops its lines / annotations. */
export function clearLayer(layers: ExtraLayer[], id: string): ExtraLayer[] {
  return layers.map((l) =>
    l.id !== id ? l : l.kind === 'referenceLine' ? { ...l, lines: [] } : { ...l, annotations: [] }
  );
}

/** Duplicate layer: a copy (fresh ids) right after the original (no-op at the cap). */
export function duplicateLayer(layers: ExtraLayer[], id: string): ExtraLayer[] {
  const i = layers.findIndex((l) => l.id === id);
  if (i < 0 || layers.length >= MAX_LAYERS) {
    return layers;
  }
  const src = layers[i];
  const copy: ExtraLayer =
    src.kind === 'referenceLine'
      ? { ...src, id: newLayerId('layer'), lines: src.lines.map((x) => ({ ...x, id: newLayerId('rl') })) }
      : { ...src, id: newLayerId('layer'), annotations: src.annotations.map((x) => ({ ...x, id: newLayerId('an') })) };
  return [...layers.slice(0, i + 1), copy, ...layers.slice(i + 1)];
}

export function removeLayer(layers: ExtraLayer[], id: string): ExtraLayer[] {
  return layers.filter((l) => l.id !== id);
}

/** Replaces (or appends, when new) one line / annotation of a layer. */
export function upsertItem(layers: ExtraLayer[], layerId: string, item: ReferenceLine | Annotation): ExtraLayer[] {
  return layers.map((l) => {
    if (l.id !== layerId) {
      return l;
    }
    if (l.kind === 'referenceLine') {
      const it = item as ReferenceLine;
      const has = l.lines.some((x) => x.id === it.id);
      if (!has && l.lines.length >= MAX_LAYER_ITEMS) {
        return l;
      }
      return { ...l, lines: has ? l.lines.map((x) => (x.id === it.id ? it : x)) : [...l.lines, it] };
    }
    const it = item as Annotation;
    const has = l.annotations.some((x) => x.id === it.id);
    if (!has && l.annotations.length >= MAX_LAYER_ITEMS) {
      return l;
    }
    return { ...l, annotations: has ? l.annotations.map((x) => (x.id === it.id ? it : x)) : [...l.annotations, it] };
  });
}

export function removeItem(layers: ExtraLayer[], layerId: string, itemId: string): ExtraLayer[] {
  return layers.map((l) =>
    l.id !== layerId
      ? l
      : l.kind === 'referenceLine'
        ? { ...l, lines: l.lines.filter((x) => x.id !== itemId) }
        : { ...l, annotations: l.annotations.filter((x) => x.id !== itemId) }
  );
}

/** Every reference line with a computed value, in layer order (one query computes them all). */
export function computedLines(layers: ExtraLayer[] | undefined): Array<ReferenceLine & { computed: RefComputed }> {
  return (layers ?? []).flatMap((l) =>
    l.kind === 'referenceLine'
      ? l.lines.filter((x): x is ReferenceLine & { computed: RefComputed } => !!x.computed)
      : []
  );
}

/** Every query annotation, in layer order. */
export function queryAnnotations(layers: ExtraLayer[] | undefined): QueryAnnotation[] {
  return (layers ?? []).flatMap((l) =>
    l.kind === 'annotations' ? l.annotations.filter((x): x is QueryAnnotation => x.type === 'query') : []
  );
}

const OP_TEXT: Record<RefOp, string> = {
  count: 'Count of records',
  avg: 'Average',
  sum: 'Sum',
  min: 'Minimum',
  max: 'Maximum',
  median: 'Median',
  unique: 'Unique count',
};
export const refOpName = (op: RefOp): string => (op === 'count' ? 'Count' : OP_TEXT[op]);

/** Display text of a line: its label, else "Static value: 100" / "Average of bytes". */
export function lineText(l: ReferenceLine): string {
  if (l.label) {
    return l.label;
  }
  if (l.computed) {
    return l.computed.op === 'count'
      ? OP_TEXT.count
      : `${OP_TEXT[l.computed.op]} of ${l.computed.fieldLabel ?? l.computed.field}`;
  }
  return `Static value: ${l.value}`;
}

/** Display text of an annotation: its label, else the query or "Event". */
export function annotationText(a: Annotation): string {
  return a.label ?? (a.type === 'query' ? a.query.trim() || 'All documents' : 'Event');
}

/** Values / events fetched for the layers (computed lines by id, query annotation times by id). */
export interface LayerData {
  values: Record<string, number | null>;
  events: Record<string, number[]>;
}

export interface ResolvedLine {
  id: string;
  value: number;
  text: string;
  /** Label drawn on the chart (only an explicit label, as in Kibana). */
  label?: string;
  color: string;
  axis: 'left' | 'right';
  lineStyle: LineStyle;
  fill: LineFill;
}

export interface ResolvedEvent {
  key: string;
  time: number;
  end?: number;
  text: string;
  color: string;
}

/**
 * What the chart draws: reference lines with a value (computed ones only once their value is in)
 * and annotation events (manual ones as stored, query ones from the fetched times).
 */
export function resolveLayers(
  layers: ExtraLayer[] | undefined,
  data?: LayerData
): { lines: ResolvedLine[]; events: ResolvedEvent[] } {
  const lines: ResolvedLine[] = [];
  const events: ResolvedEvent[] = [];
  for (const layer of layers ?? []) {
    if (layer.kind === 'referenceLine') {
      for (const l of layer.lines) {
        const v = l.computed ? data?.values[l.id] : l.value;
        if (v === undefined || v === null || !Number.isFinite(v)) {
          continue;
        }
        lines.push({
          id: l.id,
          value: v,
          text: lineText(l),
          label: l.label,
          color: l.color ?? DEFAULT_LINE_COLOR,
          axis: l.axis ?? 'left',
          lineStyle: l.lineStyle ?? 'solid',
          fill: l.fill ?? 'none',
        });
      }
    } else {
      for (const a of layer.annotations) {
        const c = a.color ?? DEFAULT_ANNOTATION_COLOR;
        if (a.type === 'manual') {
          events.push({ key: a.id, time: a.time, end: a.end, text: annotationText(a), color: c });
        } else {
          (data?.events[a.id] ?? [])
            .slice(0, MAX_QUERY_EVENTS)
            .forEach((t, k) => events.push({ key: `${a.id}:${k}`, time: t, text: annotationText(a), color: c }));
        }
      }
    }
  }
  return { lines, events };
}

/**
 * Keeps only computed lines whose field is a discovered field (same rule as a dimension's field:
 * the URL must never carry its own SQL). Static lines and annotations need no field.
 */
export function sanitizeLayers(
  layers: ExtraLayer[] | undefined,
  allowed: ReadonlySet<string>
): ExtraLayer[] | undefined {
  if (!layers) {
    return undefined;
  }
  let changed = false;
  const out = layers.map((l) => {
    if (l.kind !== 'referenceLine') {
      return l;
    }
    const lines = l.lines.filter(
      (x) =>
        !x.computed || x.computed.op === 'count' || (x.computed.field !== undefined && allowed.has(x.computed.field))
    );
    if (lines.length === l.lines.length) {
      return l;
    }
    changed = true;
    return { ...l, lines };
  });
  return changed ? out : layers;
}

/** Dashed / dotted SVG pattern of a line style. */
export const dashArray = (s: LineStyle): string | undefined =>
  s === 'dashed' ? '6 4' : s === 'dotted' ? '2 3' : undefined;
