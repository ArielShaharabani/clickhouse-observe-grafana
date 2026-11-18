/**
 * Dimension editor flyout (spec LENS-DIM-02): replaces the dimension groups while open, titled by
 * the group (e.g. "Vertical axis"). Metric: Quick function grid, Field, Percentile, Name. Top
 * values: Field, Number of values, Name. Date histogram: Name (interval stays Auto).
 */
import React, { useId, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  Button,
  Checkbox,
  Combobox,
  Field,
  IconButton,
  Input,
  RadioButtonGroup,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import {
  bucketFields,
  compatibleFields,
  QUICK_FUNCTIONS,
  withBucketField,
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
  LensField,
  listError,
  MetricDim,
  opName,
  rankDirOf,
  TermsRankBy,
} from './state';
import { uniqueMetricLabels } from './compile';
import { FormulaEditor, formulaFieldsOf, formulaMetric } from './FormulaEditor';
import { formulaErrors, quickToFormula } from './formula';

interface Props {
  dim: BucketDim | MetricDim;
  group: string;
  fields: LensField[];
  /** The chart's metrics (candidates for Custom metric ranking). */
  metrics?: MetricDim[];
  onChange: (d: BucketDim | MetricDim) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function DimensionEditor({ dim, group, fields, metrics = [], onChange, onRemove, onClose }: Props) {
  const styles = useStyles2(getStyles);
  const fieldId = useId();
  const fnLabelId = useId();
  const rankMetricId = useId();
  const metricLabels = uniqueMetricLabels(metrics);
  const fieldOptions = (list: LensField[]) => list.map((f) => ({ label: f.label, value: f.sqlExpr }));

  return (
    <div className={styles.panel} role="dialog" aria-label={`Edit ${group}`}>
      <div className={styles.header}>
        <span className={styles.title}>{group}</span>
        <IconButton name="times" tooltip="Close editor" onClick={onClose} />
      </div>

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

      {dim.kind === 'terms' && (
        <>
          <div className={styles.label}>Top values</div>
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
        <>
          <div className={styles.label}>Date histogram</div>
          <div className={styles.note}>{dim.label} · interval Auto (about 60 buckets over the time range)</div>
        </>
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
