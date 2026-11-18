/**
 * Table metric column options (LENS-CHART-01): Summary row and Color by value. Shown in the metric
 * editor only when the chart is a Table.
 */
import React, { useId } from 'react';
import { Combobox, Field, RadioButtonGroup } from '@grafana/ui';
import { MetricDim, TABLE_SUMMARIES, TableSummary } from './state';
import { SUMMARY_LABELS } from './tableChart';

type ColorBy = 'none' | 'cell' | 'text';

const SUMMARY_OPTIONS: Array<{ label: string; value: TableSummary | 'none' }> = [
  { label: 'None', value: 'none' },
  ...TABLE_SUMMARIES.map((s) => ({ label: SUMMARY_LABELS[s], value: s })),
];

const COLOR_OPTIONS: Array<{ label: string; value: ColorBy }> = [
  { label: 'None', value: 'none' },
  { label: 'Cell', value: 'cell' },
  { label: 'Text', value: 'text' },
];

/** The metric with one Table option changed (undefined / 'none' removes it). */
export function withTableOptions(
  m: MetricDim,
  patch: { summary?: TableSummary | 'none'; colorBy?: ColorBy }
): MetricDim {
  const out: MetricDim = { ...m };
  if (patch.summary !== undefined) {
    delete out.summary;
    if (patch.summary !== 'none') {
      out.summary = patch.summary;
    }
  }
  if (patch.colorBy !== undefined) {
    delete out.colorBy;
    if (patch.colorBy !== 'none') {
      out.colorBy = patch.colorBy;
    }
  }
  return out;
}

export function TableMetricOptions({ dim, onChange }: { dim: MetricDim; onChange: (d: MetricDim) => void }) {
  const summaryId = useId();
  return (
    <div role="group" aria-label="Table column">
      <Field label="Summary row" htmlFor={summaryId}>
        <Combobox<TableSummary | 'none'>
          id={summaryId}
          aria-label="Summary row"
          options={SUMMARY_OPTIONS}
          value={dim.summary ?? 'none'}
          onChange={(o) => onChange(withTableOptions(dim, { summary: o.value }))}
        />
      </Field>
      <Field label="Color by value">
        <RadioButtonGroup<ColorBy>
          aria-label="Color by value"
          options={COLOR_OPTIONS}
          value={dim.colorBy ?? 'none'}
          onChange={(v) => onChange(withTableOptions(dim, { colorBy: v }))}
        />
      </Field>
    </div>
  );
}
