/**
 * Dimension editor flyout (spec LENS-DIM-02): replaces the dimension groups while open, titled by
 * the group (e.g. "Vertical axis"). Metric: Quick function grid, Field, Percentile, Name. Top
 * values: Field, Number of values, Name. Date histogram: Name (interval stays Auto).
 */
import React, { useId } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Combobox, Field, IconButton, Input, useStyles2 } from '@grafana/ui';
import {
  bucketFields,
  compatibleFields,
  QUICK_FUNCTIONS,
  withBucketField,
  withMetricField,
  withName,
  withOp,
  withSize,
} from './dimensions';
import { autoLabel, BucketDim, clampPercentile, LensField, MetricDim, opName } from './state';

interface Props {
  dim: BucketDim | MetricDim;
  group: string;
  fields: LensField[];
  onChange: (d: BucketDim | MetricDim) => void;
  onRemove: () => void;
  onClose: () => void;
}

export function DimensionEditor({ dim, group, fields, onChange, onRemove, onClose }: Props) {
  const styles = useStyles2(getStyles);
  const fieldId = useId();
  const fieldOptions = (list: LensField[]) => list.map((f) => ({ label: f.label, value: f.sqlExpr }));

  return (
    <div className={styles.panel} role="dialog" aria-label={`Edit ${group}`}>
      <div className={styles.header}>
        <span className={styles.title}>{group}</span>
        <IconButton name="times" tooltip="Close editor" onClick={onClose} />
      </div>

      {dim.kind === 'metric' && (
        <>
          <div className={styles.label} id="lens-quick-functions">
            Quick function
          </div>
          <div className={styles.grid} role="group" aria-labelledby="lens-quick-functions">
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
                options={fieldOptions(compatibleFields(dim.op, fields))}
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
              <Input
                aria-label="Percentile"
                type="number"
                min={1}
                max={99}
                value={clampPercentile(dim.percentile)}
                onChange={(e) => onChange({ ...dim, percentile: clampPercentile(e.currentTarget.value) })}
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
            <Input
              aria-label="Number of values"
              type="number"
              min={1}
              max={100}
              value={dim.size}
              onChange={(e) => onChange(withSize(dim, Number(e.currentTarget.value)))}
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
          placeholder={autoLabel(dim)}
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
