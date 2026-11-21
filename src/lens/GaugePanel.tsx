/**
 * Gauge options (R3-CHARTS), under the gauge's dimension groups: shape (arc / horizontal bar),
 * minimum, maximum (unless a "Maximum value" metric sets it) and colour bands. Every change goes
 * through `cleanGauge`, the same check a URL or saved chart gets.
 */
import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';
import { cleanGauge, GaugeOptions } from './state';
import { NumberBox, Radio } from './StylePanel';

interface Props {
  gauge: GaugeOptions | undefined;
  /** A "Maximum value" metric is set: it is the maximum, the typed one doesn't apply. */
  hasMaxMetric: boolean;
  onChange: (gauge: GaugeOptions | undefined) => void;
}

export function GaugePanel({ gauge, hasMaxMetric, onChange }: Props) {
  const styles = useStyles2(getStyles);
  const set = (patch: Partial<GaugeOptions>) => onChange(cleanGauge({ ...gauge, ...patch }));
  const min = gauge?.min ?? 0;
  return (
    <section className={styles.section} aria-label="Gauge options">
      <h4 className={styles.title}>Appearance</h4>
      <Radio<'arc' | 'bar'>
        label="Shape"
        value={gauge?.shape ?? 'arc'}
        options={[
          { label: 'Arc', value: 'arc' },
          { label: 'Horizontal bar', value: 'bar' },
        ]}
        onChange={(v) => set({ shape: v === 'bar' ? 'bar' : undefined })}
      />
      <div className={styles.row}>
        <NumberBox
          key={`min-${gauge?.min ?? ''}`}
          label="Minimum"
          value={gauge?.min ?? 0}
          onApply={(v) => set({ min: v })}
          validate={(v) =>
            v !== undefined && gauge?.max !== undefined && v >= gauge.max ? 'Must be below the maximum' : undefined
          }
        />
        {hasMaxMetric ? (
          <div className={styles.note}>Maximum: the Maximum value metric</div>
        ) : (
          <NumberBox
            key={`max-${gauge?.max ?? ''}`}
            label="Maximum"
            value={gauge?.max}
            onApply={(v) => set({ max: v })}
            validate={(v) => (v !== undefined && v <= min ? 'Must be above the minimum' : undefined)}
          />
        )}
      </div>
      {!hasMaxMetric && gauge?.max === undefined && (
        <div className={styles.note}>Empty maximum: a round number above the largest value.</div>
      )}
      <Radio<'none' | 'low' | 'high'>
        label="Color bands"
        value={gauge?.bands ?? 'none'}
        options={[
          { label: 'None', value: 'none' },
          {
            label: 'Low is good',
            value: 'low',
            description: 'Green, then amber from 70 % and red from 90 % of the range',
          },
          {
            label: 'High is good',
            value: 'high',
            description: 'Red, then amber from 70 % and green from 90 % of the range',
          },
        ]}
        onChange={(v) => set({ bands: v === 'none' ? undefined : v })}
      />
    </section>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  section: css`
    border-top: 1px solid ${theme.colors.border.weak};
    padding-top: ${theme.spacing(1)};
    margin-top: ${theme.spacing(1)};
  `,
  title: css`
    font-size: ${theme.typography.h6.fontSize};
    margin-bottom: ${theme.spacing(1)};
  `,
  row: css`
    display: flex;
    gap: ${theme.spacing(1)};
    flex-wrap: wrap;
    align-items: flex-start;
  `,
  note: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-bottom: ${theme.spacing(1)};
  `,
});
