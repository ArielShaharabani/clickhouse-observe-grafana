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
import { FilterPill, FilterOp } from '../../types';
import { FieldModel } from '../../sql/fieldModel';
import { filterLabel, isDateBound, isNumericBound, nextId } from '../../sql/filters';
import { FieldValue } from '../../sql/kql/_values';
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

interface FilterEditFormProps {
  /** Existing pill to prefill (edit); omit for a blank "Add filter" form. */
  initial?: FilterPill;
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  onSubmit: (pill: FilterPill) => void;
  onCancel: () => void;
}

export function FilterEditForm({ initial, loadValues, onSubmit, onCancel }: FilterEditFormProps) {
  const styles = useStyles2(getStyles);
  const { fields } = useFields();

  const [selectedFieldExpr, setSelectedFieldExpr] = useState<string | null>(initial?.field ?? null);
  const [selectedOp, setSelectedOp] = useState<FilterOp | null>(initial?.op ?? null);
  const [singleValue, setSingleValue] = useState(initial?.value ?? '');
  const [multiValues, setMultiValues] = useState<string[]>(
    initial && opDef(initial.op).isMulti ? (initial.values ?? []) : []
  );
  const [pairValues, setPairValues] = useState<[string, string]>([
    initial && opDef(initial.op).isPair ? (initial.values?.[0] ?? '') : '',
    initial && opDef(initial.op).isPair ? (initial.values?.[1] ?? '') : '',
  ]);
  const [customLabel, setCustomLabel] = useState(initial?.label ?? '');

  const rangeId = useId();
  const [valueOptions, setValueOptions] = useState<Array<SelectableValue<string>>>([]);
  const [loadingValues, setLoadingValues] = useState(false);

  const fieldOptions: Array<SelectableValue<string>> = fields.map((f) => ({
    label: f.displayName,
    value: f.sqlExpr,
    description: f.sqlExpr !== f.displayName ? `${f.type} · ${f.sqlExpr}` : f.type,
  }));
  const selectedField = fields.find((f) => f.sqlExpr === selectedFieldExpr);
  const availableOps = operatorsFor(selectedField);
  // An edited pill's own operator stays selectable even if its field type wouldn't normally offer it.
  const opOptions: Array<SelectableValue<FilterOp>> = (
    initial && !availableOps.some((o) => o.value === initial.op) ? [...availableOps, opDef(initial.op)] : availableOps
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
    loadValues(selectedFieldExpr).then((vals) => {
      if (!cancelled) {
        setValueOptions(vals.map((v) => ({ label: v.value, value: v.value })));
        setLoadingValues(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [selectedFieldExpr, selectedOp, loadValues]);

  const rangeError = validateRange(selectedField, selectedOp, singleValue, pairValues);
  const isValid = isFilterComplete(selectedFieldExpr, selectedOp, singleValue, multiValues, pairValues) && !rangeError;
  const currentOp = selectedOp ? opDef(selectedOp) : null;

  /** The pill as drafted, without an id (building the preview must not consume ids). */
  const buildDraft = (): Omit<FilterPill, 'id'> | null => {
    if (!selectedFieldExpr || !selectedOp || !currentOp) {
      return null;
    }
    const label = customLabel.trim() || undefined;
    const base = { field: selectedFieldExpr, op: selectedOp, ...(label ? { label } : {}) };
    if (!currentOp.hasValue) {
      return { ...base, value: '' };
    }
    if (currentOp.isPair) {
      return { ...base, value: '', values: [pairValues[0].trim(), pairValues[1].trim()] };
    }
    if (currentOp.isMulti) {
      return { ...base, value: '', values: multiValues };
    }
    return { ...base, value: singleValue };
  };

  const handleSubmit = () => {
    const draft = isValid ? buildDraft() : null;
    if (!draft) {
      return;
    }
    onSubmit(
      initial
        ? { ...draft, id: initial.id, disabled: initial.disabled, pinned: initial.pinned, group: initial.group, groupOp: initial.groupOp }
        : { ...draft, id: nextId() }
    );
  };

  const previewDraft = isValid ? buildDraft() : null;
  const preview = previewDraft ? { ...previewDraft, id: 'preview', label: undefined } : null;

  const resetValues = () => {
    setSingleValue('');
    setMultiValues([]);
    setPairValues(['', '']);
  };

  return (
    <>
      {/* Field / Operator / Value — one row, wide enough that none of the three obscures
          the others (they used to stack full-width in a much narrower panel). */}
      <div className={styles.fieldOpValueRow}>
        <div className={cx(styles.row, styles.rowInline)}>
          <label className={styles.label}>Field</label>
          <Select
            aria-label="Field"
            options={fieldOptions}
            value={selectedFieldExpr}
            onChange={(opt) => {
              setSelectedFieldExpr(opt.value ?? null);
              resetValues();
              const nextField = fields.find((f) => f.sqlExpr === opt.value);
              if (selectedOp && !operatorsFor(nextField).some((o) => o.value === selectedOp)) {
                setSelectedOp(null);
              }
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
            aria-label="Operator"
            options={opOptions}
            value={selectedOp}
            placeholder="Select operator"
            onChange={(opt) => {
              setSelectedOp((opt.value as FilterOp) ?? null);
              resetValues();
            }}
            isClearable={false}
            menuShouldPortal
          />
        </div>

        {/* Value input — disabled until an operator is picked, hidden for exists */}
        {!currentOp && (
          <div className={cx(styles.row, styles.rowInline, styles.rowValue)}>
            <label className={styles.label}>Value</label>
            <Input disabled placeholder="Please select operator first..." aria-label="Value" />
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
                      value={pairValues[i] || null}
                      onChange={(opt) => {
                        const v = opt?.value ?? '';
                        setPairValues((p) => (i === 0 ? [v, p[1]] : [p[0], v]));
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
                aria-label="Value"
                isMulti
                allowCustomValue
                options={valueOptions}
                isLoading={loadingValues}
                value={multiValues.map((v) => ({ label: v, value: v }))}
                onChange={(opts) => {
                  setMultiValues((opts as Array<SelectableValue<string>>).map((o) => o.value ?? ''));
                }}
                placeholder={selectedFieldExpr ? 'Select or type values…' : 'Select a field first'}
                disabled={!selectedFieldExpr}
                menuShouldPortal
              />
            ) : (
              <Select
                aria-label="Value"
                allowCustomValue
                options={valueOptions}
                isLoading={loadingValues}
                value={singleValue ? { label: singleValue, value: singleValue } : null}
                onChange={(opt) => setSingleValue((opt as SelectableValue<string>).value ?? '')}
                placeholder={selectedFieldExpr ? 'Select or type a value…' : 'Select a field first'}
                disabled={!selectedFieldExpr}
                menuShouldPortal
              />
            )}
          </div>
        )}
      </div>

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

      {rangeError && (
        <div className={styles.error} role="alert" data-testid="filter-error">
          {rangeError}
        </div>
      )}

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
