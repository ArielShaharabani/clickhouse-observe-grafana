/**
 * One-menu chart type switcher (spec LENS-TYPE-01): a button showing the current type opens a
 * searchable list ("Search visualizations"); arrows move, Enter picks, Esc closes. Picking a type
 * remaps the dimensions (`switchChart`) — no query editor, no field re-selection.
 */
import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, IconName } from '@grafana/data';
import { Button, Icon, Input, Portal, RadioButtonGroup, useStyles2 } from '@grafana/ui';
import { XySubType } from './state';
import { ChartKind, KIND_LABELS } from './suggest';

export const CHART_ICONS: Record<ChartKind, IconName> = {
  line: 'chart-line',
  area: 'chart-line',
  bar: 'graph-bar',
  bar_horizontal: 'horizontal-align-left',
  metric: 'calculator-alt',
  table: 'table',
  pie: 'circle',
  donut: 'circle-mono',
  heatmap: 'apps',
  gauge: 'tachometer-fast',
};

/** One-line descriptions, as in the spec's type list. */
export const CHART_DESCRIPTIONS: Record<ChartKind, string> = {
  bar: 'Compare categories or groups of data with bars',
  bar_horizontal: 'Compare top values with long labels, largest on top',
  line: 'Reveal variations in data over time',
  area: 'Compare distributions of cumulative data trends',
  metric: 'Present individual key metrics or KPIs',
  table: 'Organize data in structured rows and columns',
  pie: 'Display parts of a whole in a circular format',
  donut: 'Display parts of a whole in a ring',
  heatmap: 'Spot which value lights up when, as colored cells',
  gauge: 'Show a value against a range or a target',
};

const ORDER: ChartKind[] = ['bar', 'bar_horizontal', 'line', 'area', 'metric', 'table', 'pie', 'donut', 'heatmap', 'gauge'];

/** Types matching a search (name or description, case-insensitive), in menu order. */
export function filterChartTypes(query: string): ChartKind[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return ORDER;
  }
  return ORDER.filter(
    (t) => KIND_LABELS[t].toLowerCase().includes(q) || CHART_DESCRIPTIONS[t].toLowerCase().includes(q)
  );
}

const SUB_TYPES: Array<{ label: string; value: XySubType }> = [
  { label: 'Stacked', value: 'stacked' },
  { label: 'Percentage', value: 'percentage' },
  { label: 'Unstacked', value: 'unstacked' },
];

interface Props {
  value: ChartKind;
  subType?: XySubType;
  onChange: (type: ChartKind) => void;
  onSubTypeChange: (sub: XySubType) => void;
}

export function ChartTypeSwitcher({ value, subType, onChange, onSubTypeChange }: Props) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const options = useMemo(() => filterChartTypes(query), [query]);
  // The active option, clamped once (an empty match list has none).
  const activeIndex = options.length === 0 ? -1 : Math.max(0, Math.min(active, options.length - 1));
  const activeType = activeIndex >= 0 ? options[activeIndex] : undefined;
  // The menu renders in a portal (the dimension column scrolls and would clip it), placed under
  // the trigger in viewport coordinates.
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Portal children mount after the click that opened the menu, so autoFocus doesn't stick: move
  // focus to the search box once the menu is in the DOM.
  useEffect(() => {
    if (!open) {
      return;
    }
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const inside = (n: Node | null) => !!n && (!!wrapRef.current?.contains(n) || !!popRef.current?.contains(n));
    const onDown = (e: MouseEvent) => {
      if (!inside(e.target as Node)) {
        setOpen(false);
      }
    };
    // Keyboard users leave with Tab: close when focus moves outside the trigger and the menu.
    const onFocusIn = (e: FocusEvent) => {
      if (!inside(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  const openMenu = () => {
    // Measured here (not in an effect) so the menu and its autofocused search mount in one render.
    const r = buttonRef.current?.getBoundingClientRect();
    setPos(r ? { top: r.bottom + 4, left: r.left, width: Math.max(r.width, 280) } : { top: 0, left: 0, width: 280 });
    setQuery('');
    setActive(Math.max(0, ORDER.indexOf(value)));
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  const pick = (t: ChartKind) => {
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
      if (activeType) {
        pick(activeType);
      }
    } else if (e.key === 'Escape') {
      // Don't let Grafana's global Esc binding (exit kiosk, close drawers…) fire too.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  const listId = `${uid}-list`;
  const optionId = (t: ChartKind) => `${uid}-${t}`;
  // Line has no stacking (Kibana): no sub-type control; the stored sub-type is kept for Bar / Area.
  const showSubType = value === 'bar' || value === 'bar_horizontal' || value === 'area';

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Chart type: ${KIND_LABELS[value]}`}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (open && e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
      >
        <Icon name={CHART_ICONS[value]} />
        <span className={styles.triggerLabel}>{KIND_LABELS[value]}</span>
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
      {open && pos && (
        <Portal>
          <div ref={popRef} className={styles.popover} style={{ top: pos.top, left: pos.left, width: pos.width }}>
            <Input
              autoFocus
              ref={inputRef}
              prefix={<Icon name="search" />}
              placeholder="Search visualizations"
              aria-label="Search visualizations"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={activeType ? optionId(activeType) : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
            <div id={listId} role="listbox" aria-label="Visualizations" className={styles.list}>
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
                    <span className={styles.optionName}>{KIND_LABELS[t]}</span>
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
        </Portal>
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
    position: fixed;
    z-index: ${theme.zIndex.portal};
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
