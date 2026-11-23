/**
 * Layers on the Visualize dimension panel (spec LENS-LAYER-01, XY charts): `+ Add layer` →
 * `Select layer type` (Visualization / Annotations / Reference lines), one card per extra layer
 * with its lines or annotations and the layer actions (Duplicate layer, Clear layer, Remove layer),
 * and an item editor that replaces the panel (← Back), like the Style panel. Every change goes
 * through `cleanLayers`, the check a URL or saved chart gets, so the UI can't store anything the
 * decoder would drop. Labels render as text.
 */
import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, GrafanaTheme2 } from '@grafana/data';
import { Button, Combobox, Dropdown, Field, IconButton, Input, Menu, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { parseKql } from '../sql/kql';
import { compatibleFields } from './dimensions';
import {
  addLayer,
  Annotation,
  annotationText,
  cleanLayers,
  clearLayer,
  DEFAULT_ANNOTATION_COLOR,
  DEFAULT_LINE_COLOR,
  duplicateLayer,
  ExtraLayer,
  LAYER_LABELS,
  LayerKind,
  lineText,
  MAX_LAYER_ITEMS,
  MAX_LAYERS,
  newLayerId,
  REF_OPS,
  RefOp,
  refOpName,
  ReferenceLine,
  removeItem,
  removeLayer,
  upsertItem,
} from './layers';
import { LensField, MAX_FILTER_QUERY, MAX_NAME } from './state';

/** The line / annotation being edited. */
export interface LayerItemRef {
  layerId: string;
  itemId: string;
}

const tidy = (list: ExtraLayer[]): ExtraLayer[] => cleanLayers(list) ?? [];

interface SectionProps {
  layers: ExtraLayer[];
  /** The chart has a time X axis (annotations need one). */
  timeAxis: boolean;
  /** Value of a new static reference line (e.g. the data's maximum). */
  suggestedValue: number;
  /** Time of a new manual annotation (the middle of the time range). */
  suggestedTime: number;
  onChange: (layers: ExtraLayer[]) => void;
  onEdit: (ref: LayerItemRef) => void;
}

/** Layer cards and `+ Add layer`, below the data layer's dimension groups. */
export function LayersSection({ layers, timeAxis, suggestedValue, suggestedTime, onChange, onEdit }: SectionProps) {
  const styles = useStyles2(getStyles);
  const [adding, setAdding] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const full = layers.length >= MAX_LAYERS;

  const addItem = (layer: ExtraLayer) => {
    const item: ReferenceLine | Annotation =
      layer.kind === 'referenceLine'
        ? { id: newLayerId('rl'), value: suggestedValue }
        : { id: newLayerId('an'), type: 'manual', time: suggestedTime };
    onChange(tidy(upsertItem(layers, layer.id, item)));
    onEdit({ layerId: layer.id, itemId: item.id });
  };
  const pick = (kind: LayerKind) => {
    onChange(tidy(addLayer(layers, kind)));
  };

  return (
    <div className={styles.layers}>
      {layers.map((layer) => {
        const title = LAYER_LABELS[layer.kind];
        const items: Array<{ id: string; text: string }> =
          layer.kind === 'referenceLine'
            ? layer.lines.map((l) => ({ id: l.id, text: lineText(l) }))
            : layer.annotations.map((a) => ({ id: a.id, text: annotationText(a) }));
        return (
          <div
            key={layer.id}
            className={styles.card}
            role="group"
            aria-label={`${title} layer`}
            data-testid="lens-layer"
          >
            <div className={styles.cardHeader}>
              <span className={styles.cardTitle}>{title}</span>
              <Dropdown
                placement="bottom-end"
                onVisibleChange={(open) => setMenuFor(open ? layer.id : null)}
                overlay={
                  <Menu ariaLabel={`${title} layer actions`}>
                    {(
                      [
                        ['Duplicate layer', () => duplicateLayer(layers, layer.id), full],
                        ['Clear layer', () => clearLayer(layers, layer.id), items.length === 0],
                        ['Remove layer', () => removeLayer(layers, layer.id), false],
                      ] as Array<[string, () => ExtraLayer[], boolean]>
                    ).map(([text, run, disabled]) => (
                      <Menu.Item
                        key={text}
                        label={text}
                        disabled={disabled}
                        onClick={() => onChange(tidy(run()))}
                      />
                    ))}
                  </Menu>
                }
              >
                <IconButton
                  name="ellipsis-v"
                  size="sm"
                  // aria-label, not tooltip: a hover tooltip stays up over the opened menu and covers its first item.
                  aria-label={`Layer actions for ${title}`}
                  aria-expanded={menuFor === layer.id}
                />
              </Dropdown>
            </div>
            {layer.kind === 'annotations' && !timeAxis && (
              <div className={styles.note}>
                Annotations show on charts with a date histogram on the horizontal axis.
              </div>
            )}
            {items.map((it) => (
              <div key={it.id} className={styles.item}>
                <button
                  type="button"
                  className={styles.itemLabel}
                  aria-label={`Edit ${it.text}`}
                  onClick={() => onEdit({ layerId: layer.id, itemId: it.id })}
                >
                  {it.text}
                </button>
                <IconButton
                  name="times"
                  size="sm"
                  tooltip={`Remove ${it.text}`}
                  onClick={() => onChange(tidy(removeItem(layers, layer.id, it.id)))}
                />
              </div>
            ))}
            {items.length < MAX_LAYER_ITEMS && (
              <button type="button" className={styles.slot} onClick={() => addItem(layer)}>
                {layer.kind === 'referenceLine' ? '+ Add reference line' : '+ Add annotation'}
              </button>
            )}
          </div>
        );
      })}
      <div className={styles.addWrap}>
        <Dropdown
          placement="bottom-start"
          onVisibleChange={setAdding}
          overlay={
            <Menu ariaLabel="Select layer type">
              <Menu.Group label="Select layer type">
                <Menu.Item label="Visualization" description="Not available yet" disabled />
                <Menu.Item
                  label="Annotations"
                  description={timeAxis ? undefined : 'Needs a time axis'}
                  disabled={!timeAxis}
                  onClick={() => pick('annotations')}
                />
                <Menu.Item label="Reference lines" onClick={() => pick('referenceLine')} />
              </Menu.Group>
            </Menu>
          }
        >
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            aria-expanded={adding}
            disabled={full}
            title={full ? `At most ${MAX_LAYERS} layers` : undefined}
          >
            Add layer
          </Button>
        </Dropdown>
      </div>
    </div>
  );
}

function Radio<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (v: T) => void;
}) {
  return (
    <Field label={props.label}>
      <div role="radiogroup" aria-label={props.label}>
        <RadioButtonGroup size="sm" value={props.value} options={props.options} onChange={props.onChange} />
      </div>
    </Field>
  );
}

/** Text box applied on blur / Enter when `parse` accepts it; otherwise the error shows and nothing is applied. */
function CommitBox(props: {
  label: string;
  initial: string;
  parse: (text: string) => { ok: true } | { ok: false; error: string };
  onApply: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  const [text, setText] = useState(props.initial);
  const r = props.parse(text);
  const apply = () => r.ok && text !== props.initial && props.onApply(text);
  return (
    <Field label={props.label} invalid={!r.ok} error={r.ok ? undefined : r.error}>
      <Input
        aria-label={props.label}
        value={text}
        placeholder={props.placeholder}
        maxLength={props.maxLength}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
    </Field>
  );
}

const TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
const TIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

/** "2026-01-05 09:00[:00]" (browser time zone) → epoch ms, or undefined. */
export function parseAnnotationTime(text: string): number | undefined {
  const t = text.trim();
  if (!TIME_RE.test(t)) {
    return undefined;
  }
  const d = dateTime(t, t.length === 10 ? 'YYYY-MM-DD' : t.length === 16 ? 'YYYY-MM-DD HH:mm' : TIME_FORMAT);
  return d.isValid() ? d.valueOf() : undefined;
}

const fmtTime = (ms: number) => dateTime(ms).format(TIME_FORMAT);
const numberOk = (t: string) =>
  t.trim() !== '' && Number.isFinite(Number(t))
    ? ({ ok: true } as const)
    : ({ ok: false, error: 'Enter a number' } as const);
const timeOk = (t: string) =>
  parseAnnotationTime(t) !== undefined
    ? ({ ok: true } as const)
    : ({ ok: false, error: `Use ${TIME_FORMAT}` } as const);
/** KQL is checked with the search bar's parser before it is stored (it compiles the same way). */
export function kqlError(q: string): string | undefined {
  if (q.length > MAX_FILTER_QUERY) {
    return `Max ${MAX_FILTER_QUERY} characters`;
  }
  try {
    parseKql(q);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid query';
  }
}

interface EditorProps {
  layers: ExtraLayer[];
  target: LayerItemRef;
  fields: LensField[];
  /** A right value axis exists (a metric is on the right); horizontal bars have one value axis. */
  canUseRightAxis: boolean;
  /** Time of a manual annotation switched from a query one (the middle of the time range). */
  suggestedTime: number;
  onChange: (layers: ExtraLayer[]) => void;
  onBack: () => void;
}

/** Editor of one reference line or annotation (replaces the dimension panel; ← Back returns). */
export function LayerItemEditor({
  layers,
  target,
  fields,
  canUseRightAxis,
  suggestedTime,
  onChange,
  onBack,
}: EditorProps) {
  const styles = useStyles2(getStyles);
  const ids = useId();
  const layer = layers.find((l) => l.id === target.layerId);
  const item =
    layer?.kind === 'referenceLine'
      ? layer.lines.find((l) => l.id === target.itemId)
      : layer?.annotations.find((a) => a.id === target.itemId);
  if (!layer || !item) {
    return null;
  }
  const save = (next: ReferenceLine | Annotation) => onChange(tidy(upsertItem(layers, layer.id, next)));
  const isLine = layer.kind === 'referenceLine';
  const heading = isLine ? 'Reference line' : 'Annotation';

  const common = (
    <>
      <Field label="Label">
        <Input
          aria-label="Label"
          value={item.label ?? ''}
          maxLength={MAX_NAME}
          placeholder={isLine ? 'No label' : 'Event'}
          onChange={(e) => save({ ...item, label: e.currentTarget.value || undefined })}
        />
      </Field>
      <Field label="Color">
        <input
          type="color"
          aria-label="Color"
          className={styles.color}
          value={item.color ?? (isLine ? DEFAULT_LINE_COLOR : DEFAULT_ANNOTATION_COLOR)}
          onChange={(e) => save({ ...item, color: e.currentTarget.value })}
        />
      </Field>
    </>
  );

  let body: React.ReactNode;
  if (isLine) {
    const l = item as ReferenceLine;
    const computed = l.computed;
    const op: RefOp = computed?.op ?? 'avg';
    const opFields = compatibleFields(op, fields);
    const setOp = (nextOp: RefOp) => {
      if (nextOp === 'count') {
        save({ ...l, computed: { op: 'count' } });
        return;
      }
      const ok = compatibleFields(nextOp, fields);
      const keep = ok.find((f) => f.sqlExpr === computed?.field) ?? ok[0];
      // No field the function can use: fall back to a count, which needs none.
      save({
        ...l,
        computed: keep
          ? { op: nextOp, field: keep.sqlExpr, fieldLabel: keep.label, numeric: keep.type === 'number' }
          : { op: 'count' },
      });
    };
    body = (
      <>
        <Radio
          label="Value"
          value={computed ? 'computed' : 'static'}
          options={[
            { label: 'Static value', value: 'static' },
            { label: 'Computed', value: 'computed' },
          ]}
          onChange={(v) => (v === 'static' ? save({ ...l, computed: undefined }) : setOp(op))}
        />
        {!computed ? (
          <CommitBox
            key={`v-${l.id}-${l.value}`}
            label="Reference line value"
            initial={String(l.value)}
            parse={numberOk}
            onApply={(t) => save({ ...l, value: Number(t) })}
          />
        ) : (
          <>
            <Field label="Function" htmlFor={`${ids}-op`} description="Over the chart's query, filters and time range">
              <Combobox
                id={`${ids}-op`}
                options={REF_OPS.map((o) => ({ label: refOpName(o), value: o }))}
                value={op}
                onChange={(o) => o && setOp(o.value as RefOp)}
              />
            </Field>
            {op !== 'count' && (
              <Field label="Field" htmlFor={`${ids}-field`}>
                <Combobox
                  id={`${ids}-field`}
                  options={opFields.map((f) => ({ label: f.label, value: f.sqlExpr }))}
                  value={computed.field ?? null}
                  onChange={(o) => {
                    const f = opFields.find((x) => x.sqlExpr === o?.value);
                    if (f) {
                      save({
                        ...l,
                        computed: { op, field: f.sqlExpr, fieldLabel: f.label, numeric: f.type === 'number' },
                      });
                    }
                  }}
                />
              </Field>
            )}
          </>
        )}
        {common}
        {canUseRightAxis && (
          <Radio
            label="Axis side"
            value={l.axis ?? 'left'}
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Right', value: 'right' },
            ]}
            onChange={(v) => save({ ...l, axis: v === 'right' ? 'right' : undefined })}
          />
        )}
        <Radio
          label="Line style"
          value={l.lineStyle ?? 'solid'}
          options={[
            { label: 'Solid', value: 'solid' },
            { label: 'Dashed', value: 'dashed' },
            { label: 'Dotted', value: 'dotted' },
          ]}
          onChange={(v) => save({ ...l, lineStyle: v === 'solid' ? undefined : v })}
        />
        <Radio
          label="Fill"
          value={l.fill ?? 'none'}
          options={[
            { label: 'None', value: 'none' },
            { label: 'Above', value: 'above' },
            { label: 'Below', value: 'below' },
          ]}
          onChange={(v) => save({ ...l, fill: v === 'none' ? undefined : v })}
        />
      </>
    );
  } else {
    const a = item as Annotation;
    body = (
      <>
        <Radio
          label="Type"
          value={a.type}
          options={[
            { label: 'Static date', value: 'manual' },
            { label: 'Query', value: 'query' },
          ]}
          onChange={(v) =>
            v === a.type
              ? undefined
              : save(
                  v === 'query'
                    ? { id: a.id, type: 'query', query: '', label: a.label, color: a.color }
                    : { id: a.id, type: 'manual', time: suggestedTime, label: a.label, color: a.color }
                )
          }
        />
        {a.type === 'manual' ? (
          <>
            <CommitBox
              key={`t-${a.id}-${a.time}`}
              label="Annotation date"
              initial={fmtTime(a.time)}
              parse={timeOk}
              onApply={(t) => {
                const time = parseAnnotationTime(t) as number;
                save({ ...a, time, end: a.end !== undefined && a.end > time ? a.end : undefined });
              }}
            />
            <CommitBox
              key={`e-${a.id}-${a.end ?? ''}`}
              label="End date (range, optional)"
              initial={a.end !== undefined ? fmtTime(a.end) : ''}
              placeholder="No end: a point in time"
              parse={(t) =>
                t.trim() === ''
                  ? { ok: true }
                  : parseAnnotationTime(t) === undefined
                    ? { ok: false, error: `Use ${TIME_FORMAT}` }
                    : (parseAnnotationTime(t) as number) <= a.time
                      ? { ok: false, error: 'The end must be after the start' }
                      : { ok: true }
              }
              onApply={(t) => save({ ...a, end: t.trim() === '' ? undefined : parseAnnotationTime(t) })}
            />
          </>
        ) : (
          <CommitBox
            key={`q-${a.id}`}
            label="Query (KQL)"
            initial={a.query}
            placeholder="e.g. http.status_code : 503 (empty: every document)"
            maxLength={MAX_FILTER_QUERY}
            parse={(t) => {
              const e = kqlError(t);
              return e ? { ok: false, error: e } : { ok: true };
            }}
            onApply={(t) => save({ ...a, query: t })}
          />
        )}
        {a.type === 'query' && (
          <div className={styles.note}>
            Marks the newest matching documents (up to 100) in the time range; the chart&apos;s own query and filters
            don&apos;t apply.
          </div>
        )}
        {common}
      </>
    );
  }

  return (
    <div className={styles.panel} role="region" aria-label={`${heading} settings`}>
      <div className={styles.header}>
        <Button size="sm" variant="secondary" fill="text" icon="arrow-left" onClick={onBack}>
          Back
        </Button>
        <span className={styles.cardTitle}>{heading}</span>
      </div>
      {body}
      <Button
        size="sm"
        variant="destructive"
        fill="outline"
        icon="trash-alt"
        onClick={() => {
          onChange(tidy(removeItem(layers, layer.id, item.id)));
          onBack();
        }}
      >
        {`Remove ${heading.toLowerCase()}`}
      </Button>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  layers: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(1)};
  `,
  card: css`
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(1)};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  cardHeader: css`
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  cardTitle: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  item: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  itemLabel: css`
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: ${theme.colors.background.secondary};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(0.5, 1)};
    color: ${theme.colors.text.primary};
    cursor: pointer;
  `,
  slot: css`
    border: 1px dashed ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: none;
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0.5, 1)};
    text-align: left;
    cursor: pointer;
  `,
  note: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  addWrap: css`
    display: flex;
  `,
  panel: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
  header: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  color: css`
    width: 48px;
    height: 28px;
    padding: 0;
    border: 1px solid ${theme.colors.border.medium};
    background: none;
  `,
});
