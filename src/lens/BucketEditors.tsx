/**
 * Bucket editor parts (spec LENS-DIM-05): the Functions grid shared by every bucket dimension, and
 * the Intervals and Filters panels. Inputs are applied on blur / Enter (applying per keystroke
 * would re-run the query each time); text that cannot be applied stays in the box with a message.
 */
import React, { useId, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Combobox, Field, IconButton, InlineSwitch, Input, Slider, useStyles2 } from '@grafana/ui';
import { parseKql } from '../sql/kql';
import {
  BUCKET_FUNCTIONS,
  numberFields,
  withBucketField,
  withBucketFunction,
  withFilterList,
  withRangeOptions,
} from './dimensions';
import {
  ALL_RECORDS,
  BucketDim,
  DEFAULT_GRANULARITY,
  FilterSpec,
  FiltersDim,
  LensField,
  MAX_FILTER_QUERY,
  MAX_FILTERS,
  MAX_RANGES,
  RangeDim,
  RangeSpec,
} from './state';

/** Functions grid of a bucket dimension; a function with no compatible field is disabled. */
export function BucketFunctions({
  dim,
  fields,
  onChange,
}: {
  dim: BucketDim;
  fields: LensField[];
  onChange: (d: BucketDim) => void;
}) {
  const styles = useStyles2(getStyles);
  const labelId = useId();
  return (
    <>
      <div className={styles.label} id={labelId}>
        Functions
      </div>
      <div className={styles.grid} role="group" aria-labelledby={labelId}>
        {BUCKET_FUNCTIONS.map(({ kind, label }) => {
          const next = withBucketFunction(dim, kind, fields);
          return (
            <button
              key={kind}
              type="button"
              className={cx(styles.fn, dim.kind === kind && styles.fnActive)}
              aria-pressed={dim.kind === kind}
              disabled={!next}
              title={next ? undefined : 'No compatible field in this data view'}
              onClick={() => next && dim.kind !== kind && onChange(next)}
            >
              {label}
            </button>
          );
        })}
      </div>
    </>
  );
}

/** Why a typed bound cannot be used, or null ('' = open end). */
const boundError = (t: string): string | null =>
  t.trim() === '' || Number.isFinite(Number(t)) ? null : 'Not a number';
const toBound = (t: string): number | undefined => (t.trim() === '' ? undefined : Number(t));

/** Intervals (number fields): automatic granularity or custom ranges. */
export function RangeEditor({
  dim,
  fields,
  onChange,
}: {
  dim: RangeDim;
  fields: LensField[];
  onChange: (d: BucketDim) => void;
}) {
  const styles = useStyles2(getStyles);
  const fieldId = useId();
  const options = numberFields(fields);
  const custom = !!dim.ranges;
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
        label="Create custom ranges"
        aria-label="Create custom ranges"
        showLabel
        transparent
        value={custom}
        onChange={(e) =>
          onChange(withRangeOptions(dim, { ranges: e.currentTarget.checked ? [{ from: 0, to: 1000 }] : undefined }))
        }
      />
      {!custom && (
        <>
          <Field label="Granularity" description="Coarse ← → fine (bucket width from the data's range)">
            <Slider
              min={1}
              max={7}
              step={1}
              value={dim.granularity ?? DEFAULT_GRANULARITY}
              inputId="lens-intervals-granularity"
              ariaLabelForHandle="Granularity"
              onAfterChange={(v) => v !== undefined && onChange(withRangeOptions(dim, { granularity: v }))}
            />
          </Field>
          <div className={styles.label}>Advanced</div>
          <Checkbox
            label="Include empty rows"
            value={dim.emptyRows !== false}
            onChange={(e) =>
              onChange(withRangeOptions(dim, { emptyRows: e.currentTarget.checked ? undefined : false }))
            }
          />
        </>
      )}
      {custom && (
        <div className={styles.rows} role="list" aria-label="Ranges">
          {dim.ranges!.map((r, k) => (
            <RangeRow
              key={`${k}-${r.from}-${r.to}-${r.label ?? ''}`}
              index={k}
              value={r}
              onCommit={(next) =>
                onChange(withRangeOptions(dim, { ranges: dim.ranges!.map((x, j) => (j === k ? next : x)) }))
              }
              onRemove={() => onChange(withRangeOptions(dim, { ranges: dim.ranges!.filter((_, j) => j !== k) }))}
            />
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            disabled={dim.ranges!.length >= MAX_RANGES}
            onClick={() => {
              const last = dim.ranges![dim.ranges!.length - 1];
              const from = last?.to ?? last?.from ?? 0;
              onChange(withRangeOptions(dim, { ranges: [...dim.ranges!, { from }] }));
            }}
          >
            Add range
          </Button>
        </div>
      )}
    </>
  );
}

function RangeRow({
  index,
  value,
  onCommit,
  onRemove,
}: {
  index: number;
  value: RangeSpec;
  onCommit: (r: RangeSpec) => void;
  onRemove: () => void;
}) {
  const styles = useStyles2(getStyles);
  const [from, setFrom] = useState(value.from === undefined ? '' : String(value.from));
  const [to, setTo] = useState(value.to === undefined ? '' : String(value.to));
  const [label, setLabel] = useState(value.label ?? '');
  const error = boundError(from) ?? boundError(to);
  const commit = () => {
    if (error) {
      return;
    }
    const next: RangeSpec = { from: toBound(from), to: toBound(to), label: label.trim() ? label : undefined };
    if (next.from !== value.from || next.to !== value.to || next.label !== value.label) {
      onCommit(next);
    }
  };
  const n = index + 1;
  return (
    <div role="listitem" className={styles.row}>
      <div className={styles.rowInputs}>
        <Input
          aria-label={`Range ${n} from`}
          placeholder="-∞"
          value={from}
          invalid={!!boundError(from)}
          onChange={(e) => setFrom(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span className={styles.arrow}>≤ x &lt;</span>
        <Input
          aria-label={`Range ${n} to`}
          placeholder="+∞"
          value={to}
          invalid={!!boundError(to)}
          onChange={(e) => setTo(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <IconButton name="times" tooltip={`Remove range ${n}`} onClick={onRemove} />
      </div>
      <Input
        aria-label={`Range ${n} label`}
        placeholder="Custom label"
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
    </div>
  );
}

/** Why a KQL query cannot be applied, or null. */
export function kqlError(q: string): string | null {
  if (q.length > MAX_FILTER_QUERY) {
    return `Max ${MAX_FILTER_QUERY} characters`;
  }
  if (!q.trim()) {
    return null;
  }
  try {
    parseKql(q);
    return null;
  } catch (e) {
    return `Invalid KQL: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`;
  }
}

/** Filters: one bucket per KQL query (same syntax and compiler as the search bar). */
export function FiltersEditor({ dim, onChange }: { dim: FiltersDim; onChange: (d: BucketDim) => void }) {
  const styles = useStyles2(getStyles);
  const set = (filters: FilterSpec[]) => onChange(withFilterList(dim, filters));
  return (
    <div className={styles.rows} role="list" aria-label="Filters">
      {dim.filters.map((f, k) => (
        <FilterRow
          key={`${k}-${f.query}-${f.label ?? ''}`}
          index={k}
          value={f}
          onCommit={(next) => set(dim.filters.map((x, j) => (j === k ? next : x)))}
          onRemove={dim.filters.length > 1 ? () => set(dim.filters.filter((_, j) => j !== k)) : undefined}
        />
      ))}
      <Button
        size="sm"
        variant="secondary"
        icon="plus"
        disabled={dim.filters.length >= MAX_FILTERS}
        onClick={() => set([...dim.filters, { query: '' }])}
      >
        Add a filter
      </Button>
    </div>
  );
}

function FilterRow({
  index,
  value,
  onCommit,
  onRemove,
}: {
  index: number;
  value: FilterSpec;
  onCommit: (f: FilterSpec) => void;
  onRemove?: () => void;
}) {
  const styles = useStyles2(getStyles);
  const [query, setQuery] = useState(value.query);
  const [label, setLabel] = useState(value.label ?? '');
  const error = kqlError(query);
  const commit = () => {
    if (error) {
      return;
    }
    const next: FilterSpec = { query, label: label.trim() ? label : undefined };
    if (next.query !== value.query || next.label !== value.label) {
      onCommit(next);
    }
  };
  const n = index + 1;
  return (
    <div role="listitem" className={styles.row}>
      <div className={styles.rowInputs}>
        <Input
          aria-label={`Filter ${n} query`}
          placeholder={`KQL — empty: ${ALL_RECORDS}`}
          value={query}
          invalid={!!error}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        {onRemove && <IconButton name="times" tooltip={`Remove filter ${n}`} onClick={onRemove} />}
      </div>
      <Input
        aria-label={`Filter ${n} label`}
        placeholder="Custom label"
        value={label}
        onChange={(e) => setLabel(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
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
  rows: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
  row: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    padding: ${theme.spacing(0.5)};
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
  `,
  rowInputs: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  arrow: css`
    white-space: nowrap;
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  error: css`
    color: ${theme.colors.error.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});
