/**
 * Metric dimension "Advanced" and "Appearance" sections (spec LENS-DIM-02, PLAN 16g).
 *
 * Advanced (collapsible): Filter by (KQL for this metric), Time shift, Reduced time range,
 * Normalize by unit. Appearance: Value format, Series colour, Axis side. Text inputs apply on blur
 * or Enter and only when valid (each change re-runs the query); invalid text stays in the box with a
 * message under it.
 */
import React, { useId, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Combobox, Field, Input, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { parseKql } from '../sql/kql';
import {
  AxisSide,
  DURATION_UNITS,
  DurationUnit,
  NORMALIZE_LABEL,
  NORMALIZE_UNITS,
  NormalizeUnit,
  parseSpan,
  patternError,
  REDUCED_PRESETS,
  SHIFT_PRESETS,
  spanError,
  spanText,
  VALUE_FORMAT_LABEL,
  VALUE_FORMATS,
  ValueFormat,
  ValueFormatId,
  MAX_FILTER,
} from './metricOptions';
import { LensState, MetricDim } from './state';

interface Props {
  dim: MetricDim;
  /** The chart the metric belongs to (decides which options apply). */
  chart?: LensState;
  /** False when the data view has no time field: Time shift and Reduced time range are hidden. */
  hasTime?: boolean;
  onChange: (m: MetricDim) => void;
}

/** Sets one option; undefined / '' removes it. */
function withOption<K extends keyof MetricDim>(m: MetricDim, key: K, value: MetricDim[K] | undefined): MetricDim {
  const next = { ...m };
  if (value === undefined || value === '') {
    delete next[key];
  } else {
    next[key] = value;
  }
  return next;
}

function kqlError(q: string): string | null {
  if (!q.trim()) {
    return null;
  }
  if (q.length > MAX_FILTER) {
    return `Max ${MAX_FILTER} characters`;
  }
  try {
    parseKql(q);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid KQL';
  }
}

export function MetricAdvanced({ dim, chart, hasTime = true, onChange }: Props) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(Boolean(dim.filter || dim.shift || dim.reducedRange || dim.normalize));
  const formatId = useId();
  const hasDateHistogram = chart?.buckets.some((b) => b.kind === 'date_histogram') ?? false;
  const xy = !chart || chart.chartType === 'line' || chart.chartType === 'area' || chart.chartType === 'bar';
  const breakdown = (chart?.buckets.length ?? 0) > 1 || chart?.chartType === 'pie' || chart?.chartType === 'donut';
  const formula = dim.op === 'formula';
  const counterRate = dim.op === 'counter_rate';

  return (
    <>
      <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? '▾' : '▸'} Advanced
      </button>
      {open && (
        <div className={styles.section} role="group" aria-label="Advanced">
          {formula ? (
            <div className={styles.note}>
              Formulas take their own filter and time options as arguments, e.g. count(kql=&apos;…&apos;).
            </div>
          ) : (
            <>
              <Field label="Filter by" description="KQL applied to this metric only">
                <TextOption
                  key={`f-${dim.filter ?? ''}`}
                  label="Filter by"
                  placeholder="(empty)"
                  value={dim.filter ?? ''}
                  error={kqlError}
                  onCommit={(v) => onChange(withOption(dim, 'filter', v.trim() ? v : undefined))}
                />
              </Field>
              {hasTime && (
                <>
                  <Field label="Time shift" description="Compare with an earlier period">
                    <SpanOption
                      label="Time shift"
                      value={dim.shift}
                      presets={SHIFT_PRESETS}
                      onCommit={(v) => onChange(withOption(dim, 'shift', v))}
                    />
                  </Field>
                  <Field
                    label="Reduced time range"
                    description={
                      hasDateHistogram
                        ? 'Not available with a date histogram'
                        : 'Only the last part of the time range counts'
                    }
                  >
                    <SpanOption
                      label="Reduced time range"
                      value={dim.reducedRange}
                      presets={REDUCED_PRESETS}
                      disabled={hasDateHistogram}
                      onCommit={(v) => onChange(withOption(dim, 'reducedRange', v))}
                    />
                  </Field>
                </>
              )}
            </>
          )}
          <Field
            label="Normalize by unit"
            description={
              !hasDateHistogram
                ? 'Needs a date histogram'
                : counterRate
                  ? 'A counter rate is always per unit of time (per second by default)'
                  : 'Value per unit of time in each bucket'
            }
          >
            <RadioButtonGroup<NormalizeUnit | 'none'>
              aria-label="Normalize by unit"
              size="sm"
              disabled={!hasDateHistogram}
              options={[
                ...(counterRate ? [] : [{ label: 'None', value: 'none' as const }]),
                ...NORMALIZE_UNITS.map((u) => ({ label: NORMALIZE_LABEL[u], value: u })),
              ]}
              value={dim.normalize ?? (counterRate ? 's' : 'none')}
              onChange={(v) => onChange(withOption(dim, 'normalize', v === 'none' ? undefined : v))}
            />
          </Field>
        </div>
      )}

      <div className={styles.label}>Appearance</div>
      <Field label="Value format" htmlFor={formatId}>
        <Combobox<ValueFormatId | 'default'>
          id={formatId}
          options={[
            { label: VALUE_FORMAT_LABEL.default, value: 'default' },
            ...VALUE_FORMATS.map((f) => ({ label: VALUE_FORMAT_LABEL[f], value: f })),
          ]}
          value={dim.format?.id ?? 'default'}
          onChange={(o) => {
            const id = o?.value;
            if (!id || id === 'default') {
              onChange(withOption(dim, 'format', undefined));
            } else if (id !== dim.format?.id) {
              onChange(withOption(dim, 'format', id === 'custom' ? { id, pattern: '0,0.00' } : { id }));
            }
          }}
        />
      </Field>
      {dim.format && <FormatDetails format={dim.format} onChange={(f) => onChange(withOption(dim, 'format', f))} />}

      <Field
        label="Series color"
        description={breakdown ? 'Not used with a breakdown (each value has its own color)' : undefined}
      >
        <div className={styles.row}>
          <input
            type="color"
            aria-label="Series color"
            className={styles.color}
            value={dim.color ?? '#7eb26d'}
            disabled={breakdown}
            onChange={(e) => onChange(withOption(dim, 'color', e.currentTarget.value.toLowerCase()))}
          />
          {dim.color && (
            <Button
              size="sm"
              variant="secondary"
              fill="text"
              onClick={() => onChange(withOption(dim, 'color', undefined))}
            >
              Auto
            </Button>
          )}
        </div>
      </Field>

      {xy && (
        <Field label="Axis side">
          <RadioButtonGroup<AxisSide>
            aria-label="Axis side"
            size="sm"
            options={[
              { label: 'Left', value: 'left' },
              { label: 'Auto', value: 'auto' },
              { label: 'Right', value: 'right' },
            ]}
            value={dim.axis ?? 'auto'}
            onChange={(v) => onChange(withOption(dim, 'axis', v === 'auto' ? undefined : v))}
          />
        </Field>
      )}
    </>
  );
}

function FormatDetails({ format, onChange }: { format: ValueFormat; onChange: (f: ValueFormat) => void }) {
  if (format.id === 'duration') {
    return (
      <Field label="Input unit">
        <RadioButtonGroup<DurationUnit>
          aria-label="Duration input unit"
          size="sm"
          options={DURATION_UNITS.map((u) => ({ label: u, value: u }))}
          value={format.durationUnit ?? 'ms'}
          onChange={(u) => onChange({ ...format, durationUnit: u })}
        />
      </Field>
    );
  }
  if (format.id === 'custom') {
    return (
      <Field label="Format pattern" description="e.g. 0,0.00 · 0.0a · $0,0 · 0.0%">
        <TextOption
          key={`p-${format.pattern ?? ''}`}
          label="Format pattern"
          value={format.pattern ?? ''}
          error={(p) => (p.trim() ? patternError(p) : 'Enter a pattern')}
          onCommit={(p) => onChange({ ...format, pattern: p })}
        />
      </Field>
    );
  }
  return (
    <Field label="Decimals">
      <TextOption
        key={`d-${format.decimals ?? ''}`}
        label="Decimals"
        placeholder="auto"
        value={format.decimals === undefined ? '' : String(format.decimals)}
        error={(v) => (v.trim() === '' || /^(10|[0-9])$/.test(v.trim()) ? null : 'A whole number from 0 to 10')}
        onCommit={(v) => onChange(v.trim() === '' ? { id: format.id } : { ...format, decimals: Number(v.trim()) })}
      />
    </Field>
  );
}

/** A time span option: typed `3h` or a preset; empty = none. */
function SpanOption({
  label,
  value,
  presets,
  disabled,
  onCommit,
}: {
  label: string;
  value?: string;
  presets: readonly string[];
  disabled?: boolean;
  onCommit: (v: string | undefined) => void;
}) {
  const styles = useStyles2(getStyles);
  return (
    <>
      <TextOption
        key={`s-${value ?? ''}`}
        label={label}
        placeholder="None"
        value={value ?? ''}
        disabled={disabled}
        error={spanError}
        onCommit={(v) => {
          const sp = parseSpan(v);
          onCommit(sp ? spanText(sp) : undefined);
        }}
      />
      <div className={styles.presets}>
        {presets.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={value === p ? 'primary' : 'secondary'}
            fill="outline"
            disabled={disabled}
            aria-label={`${label} ${p}`}
            onClick={() => onCommit(value === p ? undefined : p)}
          >
            {p}
          </Button>
        ))}
      </div>
    </>
  );
}

/** Free text applied on blur / Enter when `error` returns null. */
function TextOption({
  label,
  value,
  placeholder,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  error: (v: string) => string | null;
  onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const msg = error(draft);
  const commit = () => {
    if (!msg && draft !== value) {
      onCommit(draft);
    }
  };
  return (
    <>
      <Input
        aria-label={label}
        aria-invalid={!!msg}
        invalid={!!msg}
        placeholder={placeholder}
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
          }
        }}
      />
      {msg && (
        <div role="alert" style={{ color: 'var(--error-text, #d44)' }}>
          {msg}
        </div>
      )}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  toggle: css`
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: ${theme.colors.text.link};
    font-size: ${theme.typography.bodySmall.fontSize};
    cursor: pointer;
  `,
  section: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    padding-left: ${theme.spacing(1)};
    border-left: 2px solid ${theme.colors.border.weak};
  `,
  label: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  note: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  presets: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
    margin-top: ${theme.spacing(0.5)};
  `,
  row: css`
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
    cursor: pointer;
  `,
});
