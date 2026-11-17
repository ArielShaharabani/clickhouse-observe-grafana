/**
 * One-menu chart type switcher (spec LENS-TYPE-01): a button showing the current type opens a
 * searchable list ("Search visualizations"); arrows move, Enter picks, Esc closes. Picking a type
 * remaps the dimensions (`switchChart`) — no query editor, no field re-selection.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, IconName } from '@grafana/data';
import { Button, Icon, Input, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { CHART_LABELS, ChartType, XySubType } from './state';

export const CHART_ICONS: Record<ChartType, IconName> = {
  line: 'chart-line',
  area: 'chart-line',
  bar: 'graph-bar',
  metric: 'calculator-alt',
  table: 'table',
  pie: 'circle',
};

/** One-line descriptions, as in the spec's type list. */
export const CHART_DESCRIPTIONS: Record<ChartType, string> = {
  bar: 'Compare categories or groups of data with bars',
  line: 'Reveal variations in data over time',
  area: 'Compare distributions of cumulative data trends',
  metric: 'Present individual key metrics or KPIs',
  table: 'Organize data in structured rows and columns',
  pie: 'Display parts of a whole in a circular format',
};

const ORDER: ChartType[] = ['bar', 'line', 'area', 'metric', 'table', 'pie'];

/** Types matching a search (name or description, case-insensitive), in menu order. */
export function filterChartTypes(query: string): ChartType[] {
  const q = query.trim().toLowerCase();
  return q ? ORDER.filter((t) => CHART_LABELS[t].toLowerCase().includes(q) || CHART_DESCRIPTIONS[t].toLowerCase().includes(q)) : ORDER;
}

const SUB_TYPES: Array<{ label: string; value: XySubType }> = [
  { label: 'Stacked', value: 'stacked' },
  { label: 'Percentage', value: 'percentage' },
  { label: 'Unstacked', value: 'unstacked' },
];

interface Props {
  value: ChartType;
  subType?: XySubType;
  onChange: (type: ChartType) => void;
  onSubTypeChange: (sub: XySubType) => void;
}

export function ChartTypeSwitcher({ value, subType, onChange, onSubTypeChange }: Props) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => filterChartTypes(query), [query]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const openMenu = () => {
    setQuery('');
    setActive(Math.max(0, ORDER.indexOf(value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const pick = (t: ChartType) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (t !== value) {
      onChange(t);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const t = options[Math.min(active, options.length - 1)];
      if (t) {
        pick(t);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const optionId = (t: ChartType) => `lens-chart-type-${t}`;
  const activeType = options[Math.min(active, options.length - 1)];
  const showSubType = value === 'bar' || value === 'area';

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chart type: ${CHART_LABELS[value]}`}
        onClick={() => (open ? close() : openMenu())}
      >
        <Icon name={CHART_ICONS[value]} />
        <span className={styles.triggerLabel}>{CHART_LABELS[value]}</span>
        <Icon name="angle-down" />
      </button>
      {showSubType && (
        <RadioButtonGroup<XySubType>
          size="sm"
          options={SUB_TYPES}
          value={subType ?? 'stacked'}
          onChange={onSubTypeChange}
          className={styles.subType}
        />
      )}
      {open && (
        <div className={styles.popover}>
          <Input
            autoFocus
            prefix={<Icon name="search" />}
            placeholder="Search visualizations"
            aria-label="Search visualizations"
            role="combobox"
            aria-expanded
            aria-controls="lens-chart-type-list"
            aria-activedescendant={activeType ? optionId(activeType) : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.currentTarget.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <div id="lens-chart-type-list" role="listbox" aria-label="Visualizations" className={styles.list}>
            {options.length === 0 && <div className={styles.none}>No visualization matches</div>}
            {options.map((t) => (
              <div
                key={t}
                id={optionId(t)}
                role="option"
                aria-selected={t === value}
                className={cx(styles.option, t === activeType && styles.optionActive)}
                onMouseEnter={() => setActive(options.indexOf(t))}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(t)}
              >
                <Icon name={CHART_ICONS[t]} size="lg" />
                <div className={styles.optionText}>
                  <span className={styles.optionName}>{CHART_LABELS[t]}</span>
                  <span className={styles.optionDesc}>{CHART_DESCRIPTIONS[t]}</span>
                </div>
                {t === value && <Icon name="check" aria-hidden />}
              </div>
            ))}
          </div>
          <Button size="sm" variant="secondary" fill="text" onClick={close} className={styles.closeBtn}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    position: relative;
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  trigger: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    width: 100%;
    padding: ${theme.spacing(0.75, 1)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.primary};
    cursor: pointer;
    &:hover {
      border-color: ${theme.colors.primary.border};
    }
  `,
  triggerLabel: css`
    flex: 1;
    text-align: left;
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  subType: css`
    width: 100%;
  `,
  popover: css`
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: 20;
    margin-top: ${theme.spacing(0.5)};
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  list: css`
    max-height: 360px;
    overflow-y: auto;
  `,
  none: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(1)};
  `,
  option: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(0.75)};
    border-radius: ${theme.shape.radius.default};
    cursor: pointer;
  `,
  optionActive: css`
    background: ${theme.colors.action.hover};
  `,
  optionText: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  `,
  optionName: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  optionDesc: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  closeBtn: css`
    align-self: flex-end;
  `,
});
