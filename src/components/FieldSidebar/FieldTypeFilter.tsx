import React from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, Checkbox, Icon, IconName, Toggletip, useStyles2 } from '@grafana/ui';
import { FieldType } from '../../sql/fieldModel';
import { FIELD_TYPE_ICONS } from './fieldIcons';

/** Display names for field types in the type filter (spec DISC-SIDEBAR-01). */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  time: 'Date',
  number: 'Number',
  string: 'String',
  boolean: 'Boolean',
  map: 'Map',
  json: 'JSON',
  tuple: 'Tuple',
  array: 'Array',
  unknown: 'Other',
};

interface Props {
  /** Count of listed fields per type (only types present are offered). */
  counts: Partial<Record<FieldType, number>>;
  selected: ReadonlySet<FieldType>;
  onChange: (next: Set<FieldType>) => void;
}

/** "Filter by field type" button + popover with per-type counts; the button shows the active count. */
export function FieldTypeFilter({ counts, selected, onChange }: Props) {
  const styles = useStyles2(getStyles);
  const types = (Object.keys(FIELD_TYPE_LABELS) as FieldType[]).filter((t) => (counts[t] ?? 0) > 0 || selected.has(t));
  const toggle = (t: FieldType) => {
    const next = new Set(selected);
    if (next.has(t)) {
      next.delete(t);
    } else {
      next.add(t);
    }
    onChange(next);
  };
  const content = (
    <div className={styles.body} role="group" aria-label="Filter by field type">
      <div className={styles.title}>Filter by field type</div>
      {types.map((t) => (
        <label key={t} className={styles.row}>
          <Checkbox value={selected.has(t)} onChange={() => toggle(t)} aria-label={`${FIELD_TYPE_LABELS[t]} fields`} />
          <Icon name={(FIELD_TYPE_ICONS[t] ?? 'question-circle') as IconName} size="sm" />
          <span className={styles.name}>{FIELD_TYPE_LABELS[t]}</span>
          <span className={styles.count}>{counts[t] ?? 0}</span>
        </label>
      ))}
      {selected.size > 0 && (
        <Button size="sm" variant="secondary" fill="text" onClick={() => onChange(new Set())}>
          Clear type filter
        </Button>
      )}
    </div>
  );
  return (
    <Toggletip content={content} placement="bottom-start" closeButton={false}>
      <Button
        size="sm"
        variant={selected.size > 0 ? 'primary' : 'secondary'}
        fill={selected.size > 0 ? 'solid' : 'outline'}
        icon="filter"
        aria-label={selected.size > 0 ? `Filter by field type (${selected.size} active)` : 'Filter by field type'}
      >
        {selected.size > 0 ? String(selected.size) : ''}
      </Button>
    </Toggletip>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    min-width: 200px;
  `,
  title: css`
    font-weight: ${theme.typography.fontWeightMedium};
    margin-bottom: ${theme.spacing(0.5)};
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    cursor: pointer;
  `,
  name: css`
    flex: 1;
  `,
  count: css`
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
});
