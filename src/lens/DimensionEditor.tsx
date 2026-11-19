/**
 * Dimension editor flyout (spec LENS-DIM-02): replaces the dimension groups while open, titled by
 * the group (e.g. "Vertical axis"). Metric: Quick function grid, Field, Percentile, Name. Top
 * values: Field, Number of values, Name. Date histogram (LENS-DIM-05): Field, Customize time
 * interval / Minimum interval, Include empty rows, Drop partial intervals, Bind to global time picker.
 */
import React, { useId, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { usePopoverDialog } from '../components/a11y/dialog';
import { dateTime, GrafanaTheme2 } from '@grafana/data';
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  IconButton,
  InlineSwitch,
  Input,
  RadioButtonGroup,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import {
  bucketFields,
  compatibleFields,
  dateFields,
  QUICK_FUNCTIONS,
  withBucketField,
  withDateOptions,
  withMetricField,
  withName,
  parseLines,
  withOp,
  withSize,
  withTermsOptions,
} from './dimensions';
import {
  autoLabelIn,
  BucketDim,
  clampPercentile,
  DateHistogramDim,
  LensField,
  LensState,
  listError,
  MetricDim,
  opName,
  rankDirOf,
  TermsRankBy,
} from './state';
import { uniqueMetricLabels } from './compile';
import { BucketFunctions, FiltersEditor, RangeEditor } from './BucketEditors';
import { FormulaEditor, formulaFieldsOf, formulaMetric } from './FormulaEditor';
import { MetricAdvanced } from './MetricAdvanced';
import { TableMetricOptions } from './TableMetricOptions';
import { formulaErrors, quickToFormula } from './formula';
import {
  describeInterval,
  formatInterval,
  INTERVAL_PRESETS,
  intervalError,
  LENS_MAX_BUCKETS,
  parseInterval,
  resolveLensInterval,
} from './interval';

interface Props {
  dim: BucketDim | MetricDim;
  group: string;
  fields: LensField[];
  /** The chart's metrics (candidates for Custom metric ranking). */
  metrics?: MetricDim[];
  /** Time picker range (epoch ms): the effective date histogram interval shown in the editor. */
  timeRange?: { from: number; to: number };
  /** The data view's time field (Bind to global time picker only applies to other date fields). */
  timeField?: string;
  /** The whole chart (metric Advanced / Appearance options depend on it). */
  chart?: LensState;
  onChange: (d: BucketDim | MetricDim) => void;
  onRemove: () => void;
  onClose: () => void;
  /** Where focus goes when the editor closes (the dimension's button in the list). */
  returnFocus?: () => HTMLElement | null | undefined;
}

export function DimensionEditor({
  dim,
  group,
  fields,
  metrics = [],
  timeRange,
  timeField,
  chart,
  onChange,
  onRemove,
  onClose,
  returnFocus,
}: Props) {
  const styles = useStyles2(getStyles);
  // SHARED-A11Y-01: Escape inside the editor closes it; focus moves in and back to the dimension.
  const panelRef = useRef<HTMLDivElement>(null);
  const { dialogProps, hint } = usePopoverDialog(panelRef, { onClose, returnFocus, escapeFromPage: false });
  const fieldId = useId();
  const fnLabelId = useId();
  const rankMetricId = useId();
  const metricLabels = uniqueMetricLabels(metrics);
  const fieldOptions = (list: LensField[]) => list.map((f) => ({ label: f.label, value: f.sqlExpr }));

  return (
    <div ref={panelRef} className={styles.panel} {...dialogProps} aria-label={`Edit ${group}`}>
      {hint}
      <div className={styles.header}>
        <span className={styles.title}>{group}</span>
        <IconButton name="times" tooltip="Close editor" onClick={onClose} />
      </div>

      {dim.kind !== 'metric' && <BucketFunctions dim={dim} fields={fields} onChange={onChange} />}

      {dim.kind === 'metric' && (
        <RadioButtonGroup<'quick' | 'formula'>
          aria-label="Metric mode"
          size="sm"
          fullWidth
          options={[
            { label: 'Quick function', value: 'quick' },
            { label: 'Formula', value: 'formula' },
          ]}
          value={dim.op === 'formula' ? 'formula' : 'quick'}
          onChange={(v) => {
            if (v === 'formula' && dim.op !== 'formula') {
              onChange(toFormula(dim, fields));
            } else if (v === 'quick' && dim.op === 'formula') {
              const next = withOp(dim, 'count', fields);
              if (next) {
                onChange(next);
              }
            }
          }}
        />
      )}

      {dim.kind === 'metric' && dim.op === 'formula' && (
        <FormulaEditor key={dim.id} dim={dim} fields={fields} onChange={onChange} />
      )}

      {dim.kind === 'metric' && dim.op !== 'formula' && (
        <>
          <div className={styles.label} id={fnLabelId}>
            Quick function
          </div>
          <div className={styles.grid} role="group" aria-labelledby={fnLabelId}>
            {QUICK_FUNCTIONS.map((op) => {
              const next = withOp(dim, op, fields);
              return (
                <button
                  key={op}
                  type="button"
                  className={cx(styles.fn, dim.op === op && styles.fnActive)}
                  aria-pressed={dim.op === op}
                  disabled={!next}
                  title={next ? undefined : 'No compatible field in this data view'}
                  onClick={() => next && dim.op !== op && onChange(next)}
                >
                  {opName(op)}
                </button>
              );
            })}
          </div>
          {dim.op !== 'count' && (
            <Field label="Field" htmlFor={fieldId}>
              <Combobox
                id={fieldId}
                options={fieldOptions(withCurrent(compatibleFields(dim.op, fields), dim.field, fields))}
                value={dim.field}
                onChange={(o) => {
                  const f = fields.find((x) => x.sqlExpr === o?.value);
                  if (f) {
                    onChange(withMetricField(dim, f));
                  }
                }}
              />
            </Field>
          )}
          {dim.op === 'percentile' && (
            <Field label="Percentile">
              <NumberInput
                key={`pct-${clampPercentile(dim.percentile)}`}
                label="Percentile"
                min={1}
                max={99}
                value={clampPercentile(dim.percentile)}
                onCommit={(n) => onChange({ ...dim, percentile: clampPercentile(n) })}
              />
            </Field>
          )}
        </>
      )}

      {dim.kind === 'range' && <RangeEditor key={dim.id} dim={dim} fields={fields} onChange={onChange} />}
      {dim.kind === 'filters' && <FiltersEditor key={dim.id} dim={dim} onChange={onChange} />}
      {dim.kind === 'metric' && <MetricAdvanced dim={dim} chart={chart} onChange={onChange} />}
      {dim.kind === 'metric' && chart?.chartType === 'table' && <TableMetricOptions dim={dim} onChange={onChange} />}

      {dim.kind === 'terms' && (
        <>
          <Field label="Field" htmlFor={fieldId}>
            <Combobox
              id={fieldId}
              options={fieldOptions(bucketFields(fields))}
              value={dim.field}
              onChange={(o) => {
                const f = fields.find((x) => x.sqlExpr === o?.value);
                if (f) {
                  onChange(withBucketField(dim, f));
                }
              }}
            />
          </Field>
          <Field label="Number of values">
            <NumberInput
              key={`size-${dim.size}`}
              label="Number of values"
              min={1}
              max={100}
              value={dim.size}
              onCommit={(n) => onChange(withSize(dim, n))}
            />
          </Field>
          <Field label="Rank by">
            <RadioButtonGroup<TermsRankBy>
              aria-label="Rank by"
              size="sm"
              options={[
                { label: 'Count of records', value: 'count' },
                { label: 'Alphabetical', value: 'alpha' },
                {
                  label: 'Custom metric',
                  value: 'metric',
                  description: metrics.length ? undefined : 'Add a metric first',
                },
              ]}
              value={dim.rankBy ?? 'count'}
              disabledOptions={metrics.length === 0 ? ['metric'] : []}
              onChange={(v) =>
                onChange(
                  withTermsOptions(dim, {
                    rankBy: v,
                    rankDir: undefined,
                    rankMetric: v === 'metric' ? (dim.rankMetric ?? metrics[0]?.id) : undefined,
                  })
                )
              }
            />
          </Field>
          {dim.rankBy === 'metric' && (
            <Field label="Rank metric" htmlFor={rankMetricId}>
              <Combobox
                id={rankMetricId}
                options={metricLabels.map((l, i) => ({ label: l, value: metrics[i].id }))}
                value={dim.rankMetric}
                onChange={(o) => o && onChange(withTermsOptions(dim, { rankMetric: o.value }))}
              />
            </Field>
          )}
          <Field label="Rank direction">
            <RadioButtonGroup<'asc' | 'desc'>
              aria-label="Rank direction"
              size="sm"
              options={[
                { label: 'Descending', value: 'desc' },
                { label: 'Ascending', value: 'asc' },
              ]}
              value={rankDirOf(dim)}
              onChange={(v) => onChange(withTermsOptions(dim, { rankDir: v }))}
            />
          </Field>
          <div className={styles.label}>Advanced</div>
          <Checkbox
            label="Group remaining values as Other"
            value={!!dim.other}
            onChange={(e) => onChange(withTermsOptions(dim, { other: e.currentTarget.checked }))}
          />
          <Checkbox
            label="Include documents without this field"
            value={!!dim.missing}
            onChange={(e) => onChange(withTermsOptions(dim, { missing: e.currentTarget.checked }))}
          />
          <Checkbox
            label="Use regular expression"
            value={!!dim.regex}
            onChange={(e) => onChange(withTermsOptions(dim, { regex: e.currentTarget.checked }))}
          />
          <Field label="Include values" description="One per line">
            <LinesInput
              regex={!!dim.regex}
              key={`inc-${(dim.include ?? []).join('\n')}`}
              label="Include values"
              value={dim.include ?? []}
              onCommit={(l) => onChange(withTermsOptions(dim, { include: l }))}
            />
          </Field>
          <Field label="Exclude values" description="One per line">
            <LinesInput
              regex={!!dim.regex}
              key={`exc-${(dim.exclude ?? []).join('\n')}`}
              label="Exclude values"
              value={dim.exclude ?? []}
              onCommit={(l) => onChange(withTermsOptions(dim, { exclude: l }))}
            />
          </Field>
        </>
      )}

      {dim.kind === 'date_histogram' && (
        <DateHistogramEditor
          dim={dim}
          fields={fields}
          timeRange={timeRange}
          timeField={timeField}
          onChange={onChange}
        />
      )}

      <Field label="Name">
        <Input
          aria-label="Name"
          placeholder={autoLabelIn(dim, metrics)}
          value={dim.name ?? ''}
          onChange={(e) => onChange(withName(dim, e.currentTarget.value))}
        />
      </Field>

      <div className={styles.footer}>
        <Button variant="destructive" fill="text" size="sm" icon="trash-alt" onClick={onRemove}>
          Remove dimension
        </Button>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * Date histogram options (LENS-DIM-05). The interval is a minimum: over a wide range it is scaled up
 * to stay under LENS_MAX_BUCKETS, and the editor says so.
 */
function DateHistogramEditor({
  dim,
  fields,
  timeRange,
  timeField,
  onChange,
}: {
  dim: DateHistogramDim;
  fields: LensField[];
  timeRange?: { from: number; to: number };
  timeField?: string;
  onChange: (d: BucketDim) => void;
}) {
  const styles = useStyles2(getStyles);
  const fieldId = useId();
  const intervalId = useId();
  const switchId = useId();
  const custom = dim.interval !== 'auto';
  const [error, setError] = useState<string | null>(null);
  const options = withCurrentDate(dateFields(fields), dim, fields);
  const presets = INTERVAL_PRESETS.some((p) => p.value === dim.interval)
    ? INTERVAL_PRESETS
    : custom
      ? [{ label: dim.interval, value: dim.interval }, ...INTERVAL_PRESETS]
      : INTERVAL_PRESETS;
  const resolved = timeRange
    ? resolveLensInterval(dim.interval, { from: dateTime(timeRange.from), to: dateTime(timeRange.to) })
    : undefined;
  return (
    <>
      <Field label="Field" htmlFor={fieldId}>
        <Combobox
          id={fieldId}
          options={options.map((f) => ({ label: f.label, value: f.sqlExpr }))}
          value={dim.field}
          onChange={(o) => {
            const f = fields.find((x) => x.sqlExpr === o?.value);
            if (f) {
              onChange(withBucketField(dim, f));
            }
          }}
        />
      </Field>
      <InlineSwitch
        id={switchId}
        label="Customize time interval"
        aria-label="Customize time interval"
        showLabel
        transparent
        value={custom}
        onChange={(e) => {
          setError(null);
          const on = e.currentTarget.checked;
          onChange(withDateOptions(dim, { interval: on ? (custom ? dim.interval : '1h') : 'auto' }));
        }}
      />
      {custom && (
        <Field
          label="Minimum interval"
          htmlFor={intervalId}
          description="Pick a unit or type a number and unit (5m, 3h, 2w, 1M)"
          invalid={!!error}
          error={error}
        >
          <Combobox
            id={intervalId}
            createCustomValue
            customValueDescription="Use this interval"
            options={presets}
            value={dim.interval}
            invalid={!!error}
            onChange={(o) => {
              const text = String(o?.value ?? '').trim();
              const e = intervalError(text);
              setError(e);
              const iv = parseInterval(text);
              if (!e && iv) {
                onChange(withDateOptions(dim, { interval: formatInterval(iv) }));
              }
            }}
          />
        </Field>
      )}
      {resolved && (
        <div className={styles.note} role="status">
          {resolved.requested
            ? resolved.scaled
              ? `Interval scaled to ${describeInterval(resolved)} to stay under ${LENS_MAX_BUCKETS} buckets`
              : `Bucket size: ${describeInterval(resolved)}`
            : `Auto: ${describeInterval(resolved)} buckets (about 60 over the time range)`}
        </div>
      )}
      <div className={styles.label}>Advanced</div>
      <Checkbox
        label="Include empty rows"
        value={dim.emptyRows !== false}
        onChange={(e) => onChange(withDateOptions(dim, { emptyRows: e.currentTarget.checked ? undefined : false }))}
      />
      <Checkbox
        label="Drop partial intervals"
        value={!!dim.dropPartial}
        onChange={(e) => onChange(withDateOptions(dim, { dropPartial: e.currentTarget.checked ? true : undefined }))}
      />
      {timeField !== undefined && dim.field !== timeField && (
        <Checkbox
          label="Bind to global time picker"
          description="Fill empty rows over the whole time range (off: only between the first and last value)"
          value={!dim.unbound}
          onChange={(e) => onChange(withDateOptions(dim, { unbound: e.currentTarget.checked ? undefined : true }))}
        />
      )}
    </>
  );
}

/** Keeps the histogram's current field selectable even when it is not a discovered date field. */
function withCurrentDate(list: LensField[], dim: DateHistogramDim, all: LensField[]): LensField[] {
  if (list.some((f) => f.sqlExpr === dim.field)) {
    return list;
  }
  const f = all.find((x) => x.sqlExpr === dim.field) ?? {
    id: dim.field,
    sqlExpr: dim.field,
    label: dim.label,
    type: 'time' as const,
  };
  return [f, ...list];
}

/**
 * One value per line; applied on blur (applying per keystroke would re-run the query each time).
 * Text that cannot be applied (too many / too long values, invalid regular expression) stays in the
 * box with a message under it instead of being cut or dropped.
 */
function LinesInput({
  label,
  value,
  regex,
  onCommit,
}: {
  label: string;
  value: string[];
  regex: boolean;
  onCommit: (l: string[]) => void;
}) {
  const [draft, setDraft] = useState(value.join('\n'));
  const lines = parseLines(draft);
  const error = listError(lines, regex);
  return (
    <>
      <TextArea
        aria-label={label}
        aria-invalid={!!error}
        rows={2}
        value={draft}
        invalid={!!error}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (!error && lines.join('\n') !== value.join('\n')) {
            onCommit(lines);
          }
        }}
      />
      {error && (
        <div role="alert" style={{ color: 'var(--error-text, #d44)' }}>
          {error}
        </div>
      )}
    </>
  );
}

/**
 * Switching to Formula converts the quick function (spec LENS-DIM-03: `median(event.duration)`);
 * a function whose field the data view no longer offers starts from `count()`.
 */
function toFormula(dim: MetricDim, fields: LensField[]): MetricDim {
  const all = formulaFieldsOf(fields);
  const label = fields.find((f) => f.sqlExpr === dim.field)?.label ?? dim.fieldLabel;
  const text = quickToFormula(dim.op, label, dim.percentile);
  const ok = formulaErrors(text, all).length === 0 ? text : 'count()';
  return formulaMetric(dim, ok, all);
}

/** Keeps a field set elsewhere (e.g. a shared link) selectable even if the function's list excludes it. */
function withCurrent(list: LensField[], current: string | undefined, all: LensField[]): LensField[] {
  if (!current || list.some((f) => f.sqlExpr === current)) {
    return list;
  }
  const f = all.find((x) => x.sqlExpr === current);
  return f ? [f, ...list] : list;
}

/**
 * Number box that lets the user type freely (clear it, type "50") and applies the clamped value on
 * blur or Enter — clamping every keystroke turned "" into 1 and "1"+"50" into 99.
 */
function NumberInput({
  label,
  min,
  max,
  value,
  onCommit,
}: {
  label: string;
  min: number;
  max: number;
  value: number;
  onCommit: (n: number) => void;
}) {
  // Remounted (key) when the committed value changes, so the draft starts from it.
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const n = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(n)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(n)));
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };
  return (
    <Input
      aria-label={label}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit();
        }
      }}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  panel: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  title: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: ${theme.typography.h5.fontSize};
  `,
  label: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  grid: css`
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: ${theme.spacing(0.5)};
  `,
  fn: css`
    padding: ${theme.spacing(0.5, 1)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.primary};
    text-align: left;
    cursor: pointer;
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `,
  fnActive: css`
    border-color: ${theme.colors.primary.main};
    background: ${theme.colors.primary.transparent};
  `,
  note: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  footer: css`
    display: flex;
    justify-content: space-between;
    margin-top: ${theme.spacing(1)};
  `,
});
