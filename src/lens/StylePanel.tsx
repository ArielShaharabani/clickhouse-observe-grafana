/**
 * Style and Legend settings views for XY charts (spec LENS-STYLE-01). Toolbar buttons above the
 * dimension panel swap it for one of these views; "← Back" returns. Every change goes through
 * `cleanStyle`, the same check a URL or saved chart gets, so the panel can't store anything the
 * decoder would drop.
 */
import React, { useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Field, Input, RadioButtonGroup, Switch, useStyles2 } from '@grafana/ui';
import { ChartType } from './state';
import {
  AxisName,
  axisOf,
  AxisStyle,
  cleanStyle,
  INSIDE_ALIGNMENTS,
  legendOf,
  LegendStyle,
  LensStyle,
  MAX_AXIS_TITLE,
  OUTSIDE_ALIGNMENTS,
} from './style';

export type StyleView = 'style' | 'legend';

interface ToolbarProps {
  onOpen: (view: StyleView) => void;
}

/** The two toolbar buttons (XY charts). */
export function StyleToolbar({ onOpen }: ToolbarProps) {
  const styles = useStyles2(getStyles);
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Chart settings">
      <Button size="sm" variant="secondary" icon="palette" onClick={() => onOpen('style')}>
        Style
      </Button>
      <Button size="sm" variant="secondary" icon="list-ul" onClick={() => onOpen('legend')}>
        Legend
      </Button>
    </div>
  );
}

interface Props {
  view: StyleView;
  chartType: ChartType;
  style: LensStyle | undefined;
  /** Some metric sits on the right axis (LENS-DIM-02 axis side). */
  hasRightAxis: boolean;
  onChange: (style: LensStyle | undefined) => void;
  onBack: () => void;
}

function Radio<T extends string>(props: {
  label: string;
  value: T;
  options: Array<{ label: string; value: T; description?: string }>;
  onChange: (v: T) => void;
  disabledOptions?: T[];
}) {
  return (
    <Field label={props.label}>
      <div role="radiogroup" aria-label={props.label}>
        <RadioButtonGroup
          size="sm"
          value={props.value}
          options={props.options}
          disabledOptions={props.disabledOptions}
          onChange={props.onChange}
        />
      </div>
    </Field>
  );
}

/** A number box applied on blur / Enter when it parses; invalid text shows an error and isn't applied. */
function NumberBox(props: {
  label: string;
  value?: number;
  onApply: (v: number | undefined) => void;
  /** Error for a parsed value (e.g. the bounds' order), or undefined when it can be applied. */
  validate?: (v: number | undefined) => string | undefined;
}) {
  const [text, setText] = useState(props.value === undefined ? '' : String(props.value));
  const parsed = text.trim() === '' ? undefined : Number(text);
  const error =
    parsed !== undefined && !Number.isFinite(parsed) ? 'Enter a number' : (props.validate?.(parsed) ?? undefined);
  const apply = () => !error && props.onApply(parsed);
  return (
    <Field label={props.label} invalid={!!error} error={error}>
      <Input
        aria-label={props.label}
        value={text}
        width={14}
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === 'Enter' && apply()}
      />
    </Field>
  );
}

export function StylePanel({ view, chartType, style, hasRightAxis, onChange, onBack }: Props) {
  const styles = useStyles2(getStyles);
  const set = (patch: Partial<LensStyle>) => onChange(cleanStyle({ ...style, ...patch }));
  const setAxis = (axis: AxisName, patch: Partial<AxisStyle>) => set({ [axis]: { ...style?.[axis], ...patch } });
  const setLegend = (patch: Partial<LegendStyle>) => set({ legend: { ...style?.legend, ...patch } });
  const isBar = chartType === 'bar';
  const horizontal = isBar && style?.orientation === 'horizontal';
  // Axes are stored by role (value axis "left", category axis "bottom"); horizontal bars draw the
  // value axis at the bottom and the categories on the left, so the headings follow the drawing.
  const heading = (axis: AxisName) =>
    axis === 'right' ? 'Right axis' : (axis === 'left') !== horizontal ? 'Left axis' : 'Bottom axis';

  const axisSection = (axis: AxisName) => {
    const a = axisOf(style, axis);
    const valueAxis = axis !== 'bottom';
    const ORDER = 'The lower bound must be below the upper bound';
    return (
      <section key={axis} className={styles.section} aria-label={heading(axis)}>
        <h4 className={styles.sectionTitle}>{heading(axis)}</h4>
        <Radio
          label="Axis title"
          value={a.title}
          options={[
            { label: 'None', value: 'none' },
            { label: 'Auto', value: 'auto' },
            { label: 'Custom', value: 'custom' },
          ]}
          onChange={(v) => setAxis(axis, { title: v })}
        />
        {a.title === 'custom' && (
          <Field label="Custom axis title">
            <Input
              aria-label={`${heading(axis)} title`}
              value={a.titleText ?? ''}
              maxLength={MAX_AXIS_TITLE}
              onChange={(e) => setAxis(axis, { titleText: e.currentTarget.value })}
            />
          </Field>
        )}
        <div className={styles.switchRow}>
          <Field label="Gridlines" horizontal>
            <Switch
              aria-label={`${heading(axis)} gridlines`}
              value={a.gridlines}
              onChange={(e) => setAxis(axis, { gridlines: e.currentTarget.checked })}
            />
          </Field>
          <Field label="Tick labels" horizontal>
            <Switch
              aria-label={`${heading(axis)} tick labels`}
              value={a.ticks}
              onChange={(e) => setAxis(axis, { ticks: e.currentTarget.checked })}
            />
          </Field>
        </div>
        {a.ticks && (
          <Radio
            label="Orientation"
            value={a.orientation}
            options={[
              { label: 'Horizontal', value: 'horizontal' },
              { label: 'Vertical', value: 'vertical' },
              { label: 'Angled', value: 'angled' },
            ]}
            onChange={(v) => setAxis(axis, { orientation: v })}
          />
        )}
        {valueAxis && (
          <>
            <Radio
              label="Axis scale"
              value={a.scale}
              options={[
                { label: 'Linear', value: 'linear' },
                { label: 'Logarithmic', value: 'log' },
                { label: 'Square root', value: 'sqrt' },
              ]}
              onChange={(v) => setAxis(axis, { scale: v })}
            />
            <Radio
              label="Bounds"
              value={a.bounds}
              options={[
                { label: 'Full', value: 'full', description: 'Include zero' },
                { label: 'Data', value: 'data', description: 'Fit the data (line and area charts)' },
                { label: 'Custom', value: 'custom' },
              ]}
              // As in Kibana, bars always start at zero: no data bounds for bar charts.
              disabledOptions={isBar ? ['data'] : []}
              onChange={(v) => setAxis(axis, { bounds: v })}
            />
            {a.bounds === 'custom' && (
              <div className={styles.switchRow}>
                <NumberBox
                  key={`min:${a.min}`}
                  label="Lower bound"
                  value={a.min}
                  validate={(v) => (v !== undefined && a.max !== undefined && v >= a.max ? ORDER : undefined)}
                  onApply={(v) => setAxis(axis, { min: v })}
                />
                <NumberBox
                  key={`max:${a.max}`}
                  label="Upper bound"
                  value={a.max}
                  validate={(v) => (v !== undefined && a.min !== undefined && v <= a.min ? ORDER : undefined)}
                  onApply={(v) => setAxis(axis, { max: v })}
                />
              </div>
            )}
            {a.bounds !== 'custom' && (
              <Field label="Round to nice values" horizontal>
                <Switch
                  aria-label={`${heading(axis)} round to nice values`}
                  value={a.nice}
                  onChange={(e) => setAxis(axis, { nice: e.currentTarget.checked })}
                />
              </Field>
            )}
          </>
        )}
      </section>
    );
  };

  const lg = legendOf(style);
  return (
    <div className={styles.panel} role="region" aria-label={view === 'style' ? 'Style settings' : 'Legend settings'}>
      <div className={styles.header}>
        <Button size="sm" variant="secondary" fill="text" icon="arrow-left" onClick={onBack}>
          Back
        </Button>
        <span className={styles.title}>{view === 'style' ? 'Style' : 'Legend'}</span>
      </div>
      {view === 'style' ? (
        <>
          {isBar && (
            <section className={styles.section} aria-label="Appearance">
              <h4 className={styles.sectionTitle}>Appearance</h4>
              <Radio
                label="Bar orientation"
                value={style?.orientation ?? 'vertical'}
                options={[
                  { label: 'Vertical', value: 'vertical' },
                  { label: 'Horizontal', value: 'horizontal' },
                ]}
                onChange={(v) => set({ orientation: v })}
              />
            </section>
          )}
          {isBar && (
            <section className={styles.section} aria-label="Titles and text">
              <h4 className={styles.sectionTitle}>Titles and text</h4>
              <Radio
                label="Bar values"
                value={style?.barValues ?? 'hide'}
                options={[
                  { label: 'Hide', value: 'hide' },
                  {
                    label: 'Show, if able',
                    value: 'show',
                    description: 'Values can only be shown if space is available',
                  },
                ]}
                onChange={(v) => set({ barValues: v })}
              />
            </section>
          )}
          {(horizontal ? (['bottom', 'left'] as AxisName[]) : (['left', 'bottom'] as AxisName[])).map(axisSection)}
          {hasRightAxis && !horizontal && axisSection('right')}
        </>
      ) : (
        <section className={styles.section} aria-label="Legend">
          <Radio
            label="Visibility"
            value={lg.visibility}
            options={[
              { label: 'Auto', value: 'auto', description: 'Hidden for a single series without a breakdown' },
              { label: 'Show', value: 'show' },
              { label: 'Hide', value: 'hide' },
            ]}
            onChange={(v) => setLegend({ visibility: v })}
          />
          {lg.visibility !== 'hide' && (
            <>
              <Radio
                label="Position"
                value={lg.position}
                options={[
                  { label: 'Outside', value: 'outside' },
                  { label: 'Inside', value: 'inside' },
                ]}
                onChange={(v) =>
                  setLegend({ position: v, alignment: v === 'inside' ? INSIDE_ALIGNMENTS[0] : OUTSIDE_ALIGNMENTS[3] })
                }
              />
              <Radio
                label="Alignment"
                value={lg.alignment}
                options={(lg.position === 'inside' ? INSIDE_ALIGNMENTS : OUTSIDE_ALIGNMENTS).map((a) => ({
                  label: alignmentLabel(a),
                  value: a,
                }))}
                onChange={(v) => setLegend({ alignment: v })}
              />
              <Radio
                label="Layout"
                value={lg.layout}
                options={[
                  { label: 'List', value: 'list' },
                  { label: 'Grid', value: 'grid' },
                ]}
                onChange={(v) => setLegend({ layout: v })}
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

const alignmentLabel = (a: string) =>
  a
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');

const getStyles = (theme: GrafanaTheme2) => ({
  toolbar: css`
    display: flex;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(1)};
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
  title: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  section: css`
    border-top: 1px solid ${theme.colors.border.weak};
    padding-top: ${theme.spacing(1)};
  `,
  sectionTitle: css`
    font-size: ${theme.typography.h6.fontSize};
    margin-bottom: ${theme.spacing(1)};
  `,
  switchRow: css`
    display: flex;
    gap: ${theme.spacing(2)};
    flex-wrap: wrap;
  `,
});
