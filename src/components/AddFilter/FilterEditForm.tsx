/**
 * Field / operator / value / custom-label form shared by "Add filter" and "Edit filter"
 * (DISC-FILTER-02). Renders the form body only — caller owns the Portal, backdrop, positioning,
 * and title.
 *
 * Every value the user picks or types ends up on the FilterPill as plain data; it only reaches SQL
 * through buildFilterClause (sql/queryBuilder.ts), which quotes it.
 */

import React, { useEffect, useId, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Combobox, Select, Input, useStyles2 } from '@grafana/ui';
import { FilterPill, FilterOp, FilterCondition, FilterCondGroup } from '../../types';
import { FieldModel } from '../../sql/fieldModel';
import {
  TreeGroup,
  addCondition,
  canAddCondition,
  filterLabel,
  isCondGroup,
  isDateBound,
  isNumericBound,
  isTreeGroup,
  nextId,
  removeCondition,
  soleCondition,
} from '../../sql/filters';
import { FieldValue } from '../../sql/kql/_values';
import { normalizeValuePrefix } from '../../sql/fullScan';
import { useFields } from '../FieldsContext';

interface OpDef {
  label: string;
  value: FilterOp;
  hasValue: boolean;
  isMulti: boolean;
  /** Two inputs (low / high) stored as `values: [low, high]`. */
  isPair?: boolean;
}

/** Spec order (DISC-FILTER-02): is, is not, is one of, is not one of, >=, <, between, not between,
 *  exists; then the plugin's extras (does not exist, contains, does not contain). */
export const OPERATORS: OpDef[] = [
  { label: 'is', value: '=', hasValue: true, isMulti: false },
  { label: 'is not', value: '!=', hasValue: true, isMulti: false },
  { label: 'is one of', value: 'one_of', hasValue: true, isMulti: true },
  { label: 'is not one of', value: 'not_one_of', hasValue: true, isMulti: true },
  { label: 'greater or equal', value: 'gte', hasValue: true, isMulti: false },
  { label: 'less than', value: 'lt', hasValue: true, isMulti: false },
  { label: 'is between', value: 'between', hasValue: true, isMulti: false, isPair: true },
  { label: 'is not between', value: 'not_between', hasValue: true, isMulti: false, isPair: true },
  { label: 'exists', value: 'exists', hasValue: false, isMulti: false },
  { label: 'does not exist', value: 'not_exists', hasValue: false, isMulti: false },
  { label: 'contains', value: 'contains', hasValue: true, isMulti: false },
  { label: 'does not contain', value: 'not_contains', hasValue: true, isMulti: false },
];

const RANGE_OPS: ReadonlySet<FilterOp> = new Set(['gte', 'lt', 'between', 'not_between']);
const TEXT_OPS: ReadonlySet<FilterOp> = new Set(['contains', 'not_contains']);

/** Operators offered for a field: ranges only where ordering is meaningful — numbers, times,
 *  unknown scalars and Map *keys* (never a whole Map / JSON / Tuple / Array column, which no
 *  comparison can apply to); substring match not on numbers/times (ILIKE needs a string). */
export function operatorsFor(field: Pick<FieldModel, 'type' | 'source'> | undefined): OpDef[] {
  const type = field?.type;
  const ordered =
    !field || field.source === 'map' || type === 'number' || type === 'time' || type === 'unknown';
  const textual = type !== 'number' && type !== 'time';
  return OPERATORS.filter((o) => (RANGE_OPS.has(o.value) ? ordered : TEXT_OPS.has(o.value) ? textual : true));
}

/**
 * Validates range bounds against the field: number fields and Map keys need numbers (the SQL
 * compares Map values numerically), time fields need dates, other scalars either. Returns a
 * message, or null when fine / not yet filled in. `low <= high` is required for between.
 */
export function validateRange(
  field: Pick<FieldModel, 'type' | 'source'> | undefined,
  op: FilterOp | null,
  single: string,
  pair: [string, string]
): string | null {
  if (!op || !RANGE_OPS.has(op)) {
    return null;
  }
  const isPair = opDef(op).isPair;
  const bounds = (isPair ? pair : [single]).map((v) => v.trim());
  const numericOnly = field?.source === 'map' || field?.type === 'number';
  const dateOnly = field?.type === 'time' && field.source !== 'map';
  for (const b of bounds) {
    if (b === '') {
      continue;
    }
    if (numericOnly && !isNumericBound(b)) {
      return `"${b}" is not a number`;
    }
    if (dateOnly && !isDateBound(b)) {
      return `"${b}" is not a date (use YYYY-MM-DD or YYYY-MM-DD hh:mm:ss)`;
    }
    if (!numericOnly && !dateOnly && !isNumericBound(b) && !isDateBound(b)) {
      return `"${b}" is not a number or a date`;
    }
  }
  if (isPair && bounds[0] !== '' && bounds[1] !== '') {
    const num = isNumericBound(bounds[0]) && isNumericBound(bounds[1]);
    const lo = num ? Number(bounds[0]) : Date.parse(bounds[0].replace(' ', 'T'));
    const hi = num ? Number(bounds[1]) : Date.parse(bounds[1].replace(' ', 'T'));
    if (isNumericBound(bounds[0]) !== isNumericBound(bounds[1])) {
      return 'From and To must both be numbers or both be dates';
    }
    if (lo > hi) {
      return 'From must not be greater than To';
    }
  }
  return null;
}

export function opDef(op: FilterOp): OpDef {
  return OPERATORS.find((o) => o.value === op) ?? OPERATORS[0];
}

/** True when the draft has everything its operator needs. */
export function isFilterComplete(
  field: string | null,
  op: FilterOp | null,
  single: string,
  multi: string[],
  pair: [string, string]
): boolean {
  if (!field || !op) {
    return false;
  }
  const def = opDef(op);
  if (!def.hasValue) {
    return true;
  }
  if (def.isPair) {
    return pair[0].trim() !== '' && pair[1].trim() !== '';
  }
  if (def.isMulti) {
    return multi.length > 0;
  }
  if (RANGE_OPS.has(op)) {
    return single.trim() !== '';
  }
  return true;
}

/** A condition as drafted in the form (before it becomes a FilterCondition). */
export interface DraftCondition {
  key: string;
  field: string | null;
  op: FilterOp | null;
  single: string;
  multi: string[];
  pair: [string, string];
}

type DraftGroup = TreeGroup<DraftCondition>;

let draftKey = 0;
const blankDraft = (): DraftCondition => ({
  key: `c${draftKey++}`,
  field: null,
  op: null,
  single: '',
  multi: [],
  pair: ['', ''],
});

const draftFromCondition = (c: FilterCondition): DraftCondition => {
  const def = opDef(c.op);
  return {
    key: `c${draftKey++}`,
    field: c.field,
    op: c.op,
    single: def.hasValue && !def.isMulti && !def.isPair ? c.value : '',
    multi: def.isMulti ? (c.values ?? []) : [],
    pair: def.isPair ? [c.values?.[0] ?? '', c.values?.[1] ?? ''] : ['', ''],
  };
};

const draftFromGroup = (g: FilterCondGroup): DraftGroup => ({
  join: g.join,
  items: g.items.map((it) => (isCondGroup(it) ? draftFromGroup(it) : draftFromCondition(it))),
});

/** The stored condition for a drafted condition (range bounds trimmed); null while no field / op. */
export function conditionFromDraft(d: DraftCondition): FilterCondition | null {
  if (!d.field || !d.op) {
    return null;
  }
  const def = opDef(d.op);
  if (!def.hasValue) {
    return { field: d.field, op: d.op, value: '' };
  }
  if (def.isPair) {
    return { field: d.field, op: d.op, value: '', values: [d.pair[0].trim(), d.pair[1].trim()] };
  }
  if (def.isMulti) {
    return { field: d.field, op: d.op, value: '', values: d.multi };
  }
  return { field: d.field, op: d.op, value: d.single };
}

/** The pill fields for a drafted tree: a plain single-condition pill when it holds one condition,
 *  a compound pill otherwise; null while any condition is incomplete or invalid. */
export function pillFromDraftTree(
  root: DraftGroup,
  fieldFor: (expr: string) => Pick<FieldModel, 'type' | 'source'> | undefined
): Omit<FilterPill, 'id'> | null {
  const complete = (d: DraftCondition) =>
    isFilterComplete(d.field, d.op, d.single, d.multi, d.pair) &&
    !validateRange(fieldFor(d.field ?? ''), d.op, d.single, d.pair);
  const convert = (g: DraftGroup): FilterCondGroup | null => {
    const items: FilterCondGroup['items'] = [];
    for (const it of g.items) {
      const node = isTreeGroup(it) ? convert(it) : complete(it) ? conditionFromDraft(it) : null;
      if (!node) {
        return null;
      }
      items.push(node);
    }
    return { join: g.join, items };
  };
  const cond = convert(root);
  if (!cond) {
    return null;
  }
  const sole = soleCondition(cond as TreeGroup<FilterCondition>);
  if (sole) {
    return sole;
  }
  return { field: '', op: '=', value: '', cond };
}

interface ConditionRowProps {
  draft: DraftCondition;
  fields: FieldModel[];
  loadValues: (sqlExpr: string, prefix?: string) => Promise<FieldValue[]>;
  onChange: (d: DraftCondition) => void;
  /** An edited single pill's own operator stays selectable. */
  keepOp?: FilterOp;
  /** Row number suffix for accessible names ('' while there is a single condition). */
  label: string;
  canRemove: boolean;
  onRemove: () => void;
  canOr: boolean;
  canAnd: boolean;
  onAdd: (join: 'or' | 'and') => void;
}

function ConditionRow({
  draft,
  fields,
  loadValues,
  onChange,
  keepOp,
  label,
  canRemove,
  onRemove,
  canOr,
  canAnd,
  onAdd,
}: ConditionRowProps) {
  const styles = useStyles2(getStyles);
  const rangeId = useId();
  const [valueOptions, setValueOptions] = useState<Array<SelectableValue<string>>>([]);
  const [loadingValues, setLoadingValues] = useState(false);
  // Text typed in the value box, debounced into a full-range prefix lookup (R5-SAMPLING): values
  // outside the 500-row sample are still offered once 2+ characters are typed.
  const [typedValue, setTypedValue] = useState('');
  const [valuePrefix, setValuePrefix] = useState('');
  useEffect(() => {
    const next = normalizeValuePrefix(typedValue) ?? '';
    const t = setTimeout(() => setValuePrefix(next), 250);
    return () => clearTimeout(t);
  }, [typedValue]);
  const { field: selectedFieldExpr, op: selectedOp } = draft;
  const name = (base: string) => (label ? `${base} ${label}` : base);

  const fieldOptions: Array<SelectableValue<string>> = fields.map((f) => ({
    label: f.displayName,
    value: f.sqlExpr,
    description: f.sqlExpr !== f.displayName ? `${f.type} · ${f.sqlExpr}` : f.type,
  }));
  const selectedField = fields.find((f) => f.sqlExpr === selectedFieldExpr);
  const availableOps = operatorsFor(selectedField);
  const opOptions: Array<SelectableValue<FilterOp>> = (
    keepOp && !availableOps.some((o) => o.value === keepOp) ? [...availableOps, opDef(keepOp)] : availableOps
  ).map((o) => ({ label: o.label, value: o.value }));

  // Load distinct values when field or op changes (shared autocomplete service, scoped to the
  // page's time range, search and filters). This mirrors an async fetch (loadValues) into state,
  // so the reset-to-empty branch below is part of the same sync, not a render-time side effect.
  useEffect(() => {
    const op = selectedOp ? opDef(selectedOp) : null;
    if (!selectedFieldExpr || !op || !op.hasValue) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setValueOptions([]);
      return;
    }
    let cancelled = false;
    setLoadingValues(true);
    loadValues(selectedFieldExpr, valuePrefix || undefined).then((vals) => {
      if (!cancelled) {
        setValueOptions(vals.map((v) => ({ label: v.value, value: v.value })));
        setLoadingValues(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFieldExpr, selectedOp, loadValues, valuePrefix]);

  const rangeError = validateRange(selectedField, selectedOp, draft.single, draft.pair);
  const currentOp = selectedOp ? opDef(selectedOp) : null;
  const resetValues = { single: '', multi: [] as string[], pair: ['', ''] as [string, string] };

  return (
    <div className={styles.conditionRow} data-testid="filter-condition">
      {/* Field / Operator / Value — one row, wide enough that none of the three obscures
          the others. */}
      <div className={styles.fieldOpValueRow}>
        <div className={cx(styles.row, styles.rowInline)}>
          <label className={styles.label}>Field</label>
          <Select
            aria-label={name('Field')}
            options={fieldOptions}
            value={selectedFieldExpr}
            onChange={(opt) => {
              const nextField = fields.find((f) => f.sqlExpr === opt.value);
              const keepOpNow = selectedOp && operatorsFor(nextField).some((o) => o.value === selectedOp);
              onChange({ ...draft, ...resetValues, field: opt.value ?? null, op: keepOpNow ? selectedOp : null });
            }}
            placeholder="Select field"
            isClearable={false}
            isSearchable
            menuShouldPortal
          />
        </div>

        <div className={cx(styles.row, styles.rowInline)}>
          <label className={styles.label}>Operator</label>
          <Select
            aria-label={name('Operator')}
            options={opOptions}
            value={selectedOp}
            placeholder="Select operator"
            onChange={(opt) => onChange({ ...draft, ...resetValues, op: (opt.value as FilterOp) ?? null })}
            isClearable={false}
            menuShouldPortal
          />
        </div>

        {/* Value input — disabled until an operator is picked, hidden for exists */}
        {!currentOp && (
          <div className={cx(styles.row, styles.rowInline, styles.rowValue)}>
            <label className={styles.label}>Value</label>
            <Input disabled placeholder="Please select operator first..." aria-label={name('Value')} />
          </div>
        )}
        {currentOp?.hasValue && (
          <div className={cx(styles.row, styles.rowInline, styles.rowValue)}>
            <label className={styles.label}>Value</label>
            {currentOp.isPair ? (
              <div className={styles.pair}>
                {([0, 1] as const).map((i) => (
                  <div key={i} className={styles.pairItem}>
                    <label htmlFor={`${rangeId}-${i}`} className={styles.label}>
                      {i === 0 ? 'From' : 'To'}
                    </label>
                    <Combobox
                      id={`${rangeId}-${i}`}
                      createCustomValue
                      options={valueOptions.map((o) => ({ label: o.label, value: o.value ?? '' }))}
                      loading={loadingValues}
                      value={draft.pair[i] || null}
                      onChange={(opt) => {
                        const v = opt?.value ?? '';
                        onChange({ ...draft, pair: i === 0 ? [v, draft.pair[1]] : [draft.pair[0], v] });
                      }}
                      placeholder={i === 0 ? 'From…' : 'To…'}
                      disabled={!selectedFieldExpr}
                      invalid={!!rangeError}
                    />
                  </div>
                ))}
              </div>
            ) : currentOp.isMulti ? (
              <Select
                aria-label={name('Value')}
                isMulti
                allowCustomValue
                options={valueOptions}
                isLoading={loadingValues}
                onInputChange={(v: string) => setTypedValue(v)}
                value={draft.multi.map((v) => ({ label: v, value: v }))}
                onChange={(opts) =>
                  onChange({ ...draft, multi: (opts as Array<SelectableValue<string>>).map((o) => o.value ?? '') })
                }
                placeholder={selectedFieldExpr ? 'Select or type values…' : 'Select a field first'}
                disabled={!selectedFieldExpr}
                menuShouldPortal
              />
            ) : (
              <Select
                aria-label={name('Value')}
                allowCustomValue
                options={valueOptions}
                isLoading={loadingValues}
                onInputChange={(v: string) => setTypedValue(v)}
                value={draft.single ? { label: draft.single, value: draft.single } : null}
                onChange={(opt) => onChange({ ...draft, single: (opt as SelectableValue<string>).value ?? '' })}
                placeholder={selectedFieldExpr ? 'Select or type a value…' : 'Select a field first'}
                disabled={!selectedFieldExpr}
                menuShouldPortal
              />
            )}
          </div>
        )}
        <div className={styles.rowButtons}>
          <Button
            variant="secondary"
            size="sm"
            fill="text"
            icon="trash-alt"
            aria-label={name('Delete condition')}
            disabled={!canRemove}
            onClick={onRemove}
          />
          <Button
            variant="secondary"
            size="sm"
            fill="text"
            icon="plus"
            aria-label={name('Add OR condition')}
            disabled={!canOr}
            onClick={() => onAdd('or')}
          >
            OR
          </Button>
          <Button
            variant="secondary"
            size="sm"
            fill="text"
            icon="plus"
            aria-label={name('Add AND condition')}
            disabled={!canAnd}
            onClick={() => onAdd('and')}
          >
            AND
          </Button>
        </div>
      </div>
      {rangeError && (
        <div className={styles.error} role="alert" data-testid="filter-error">
          {rangeError}
        </div>
      )}
    </div>
  );
}

interface FilterEditFormProps {
  /** Existing pill to prefill (edit); omit for a blank "Add filter" form. */
  initial?: FilterPill;
  loadValues: (sqlExpr: string, prefix?: string) => Promise<FieldValue[]>;
  onSubmit: (pill: FilterPill) => void;
  onCancel: () => void;
}

export function FilterEditForm({ initial, loadValues, onSubmit, onCancel }: FilterEditFormProps) {
  const styles = useStyles2(getStyles);
  const { fields } = useFields();

  const [root, setRoot] = useState<DraftGroup>(() =>
    initial?.cond
      ? draftFromGroup(initial.cond)
      : { join: 'and', items: [initial ? draftFromCondition(initial) : blankDraft()] }
  );
  const [customLabel, setCustomLabel] = useState(initial?.label ?? '');

  const fieldFor = (expr: string) => fields.find((f) => f.sqlExpr === expr);
  const draft = pillFromDraftTree(root, fieldFor);
  const isValid = draft !== null;
  const total = countLeaves(root);

  const handleSubmit = () => {
    if (!draft) {
      return;
    }
    const label = customLabel.trim() || undefined;
    const pill = { ...draft, ...(label ? { label } : {}) };
    onSubmit(
      initial
        ? {
            ...pill,
            id: initial.id,
            disabled: initial.disabled,
            pinned: initial.pinned,
            group: initial.group,
            groupOp: initial.groupOp,
            ...(pill.cond && initial.negate ? { negate: true } : {}),
          }
        : { ...pill, id: nextId() }
    );
  };

  // The preview shows the combined filter without the custom label.
  const preview = draft ? { ...draft, id: 'preview', label: undefined } : null;

  const setAt = (path: number[], d: DraftCondition) => {
    const next = JSON.parse(JSON.stringify(root)) as DraftGroup;
    let g = next;
    for (const i of path.slice(0, -1)) {
      g = g.items[i] as DraftGroup;
    }
    g.items[path[path.length - 1]] = d;
    setRoot(next);
  };

  const renderGroup = (g: DraftGroup, path: number[]): React.ReactNode =>
    g.items.map((it, i) => {
      const p = [...path, i];
      const sep =
        i > 0 ? (
          <div className={styles.joinBadge} data-testid="filter-join">
            {g.join === 'or' ? 'OR' : 'AND'}
          </div>
        ) : null;
      if (isTreeGroup(it)) {
        return (
          <React.Fragment key={`g${p.join('.')}`}>
            {sep}
            <div className={styles.nested} data-testid="filter-condition-group">
              {renderGroup(it, p)}
            </div>
          </React.Fragment>
        );
      }
      return (
        <React.Fragment key={it.key}>
          {sep}
          <ConditionRow
            draft={it}
            fields={fields}
            loadValues={loadValues}
            onChange={(d) => setAt(p, d)}
            keepOp={initial && !initial.cond ? initial.op : undefined}
            label={total > 1 ? `#${p.map((x) => x + 1).join('.')}` : ''}
            canRemove={total > 1}
            onRemove={() => setRoot(removeCondition(root, p))}
            canOr={canAddCondition(root, p, 'or')}
            canAnd={canAddCondition(root, p, 'and')}
            onAdd={(join) => setRoot(addCondition(root, p, join, blankDraft()))}
          />
        </React.Fragment>
      );
    });

  return (
    <>
      {renderGroup(root, [])}

      {/* Custom label */}
      <div className={styles.row}>
        <label className={styles.label}>
          Custom label <span className={styles.optional}>(optional)</span>
        </label>
        <Input
          aria-label="Custom label"
          value={customLabel}
          onChange={(e) => setCustomLabel(e.currentTarget.value)}
          placeholder="Add a custom label here"
        />
      </div>

      {preview && (
        <div className={styles.preview} data-testid="filter-preview">
          <span className={styles.optional}>Preview</span> {filterLabel(preview)}
        </div>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!isValid}>
          {initial ? 'Update filter' : 'Add filter'}
        </Button>
      </div>
    </>
  );
}

function countLeaves<L>(g: TreeGroup<L>): number {
  return g.items.reduce((n: number, it) => n + (isTreeGroup(it) ? countLeaves(it) : 1), 0);
}

const getStyles = (theme: GrafanaTheme2) => ({
  fieldOpValueRow: css`
    display: flex;
    gap: ${theme.spacing(1.5)};
    align-items: flex-start;
    margin-bottom: ${theme.spacing(1.5)};
  `,
  row: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    margin-bottom: ${theme.spacing(1.5)};
  `,
  conditionRow: css`
    margin-bottom: ${theme.spacing(1)};
  `,
  rowButtons: css`
    display: flex;
    align-items: flex-end;
    align-self: flex-end;
    gap: ${theme.spacing(0.25)};
  `,
  joinBadge: css`
    margin: ${theme.spacing(0.5)} 0;
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightBold};
    color: ${theme.colors.primary.text};
  `,
  nested: css`
    margin: ${theme.spacing(0.5)} 0;
    padding: ${theme.spacing(1)} ${theme.spacing(1)} 0 ${theme.spacing(1.5)};
    border-left: 2px solid ${theme.colors.primary.border};
    background: ${theme.colors.background.secondary};
    border-radius: ${theme.shape.radius.default};
  `,
  rowInline: css`
    flex: 1;
    min-width: 0;
    margin-bottom: 0;
  `,
  /** Value needs more room than Field/Operator — it renders the longest placeholder text and,
   *  for "is one of", a row of selected-value pills. */
  rowValue: css`
    flex: 1.6;
  `,
  pair: css`
    display: flex;
    gap: ${theme.spacing(1)};
    & > * {
      flex: 1;
      min-width: 0;
    }
  `,
  pairItem: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  error: css`
    margin-bottom: ${theme.spacing(1)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.error.text};
  `,
  preview: css`
    margin-bottom: ${theme.spacing(1.5)};
    font-size: ${theme.typography.bodySmall.fontSize};
    font-family: ${theme.typography.fontFamilyMonospace};
    overflow-wrap: anywhere;
  `,
  label: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.secondary};
  `,
  optional: css`
    font-weight: ${theme.typography.fontWeightRegular};
    color: ${theme.colors.text.disabled};
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(0.5)};
  `,
});
