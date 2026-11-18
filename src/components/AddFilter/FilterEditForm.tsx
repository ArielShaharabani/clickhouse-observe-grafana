/**
 * Field / operator / value / custom-label form shared by "Add filter" and "Edit filter"
 * (DISC-FILTER-02). Renders the form body only — caller owns the Portal, backdrop, positioning,
 * and title.
 *
 * Every value the user picks or types ends up on the FilterPill as plain data; it only reaches SQL
 * through buildFilterClause (sql/queryBuilder.ts), which quotes it.
 */

import React, { useEffect, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2, SelectableValue } from '@grafana/data';
import { Button, Select, Input, useStyles2 } from '@grafana/ui';
import { FilterPill, FilterOp } from '../../types';
import { FieldType } from '../../sql/fieldModel';
import { filterLabel, makeFilter } from '../../sql/filters';
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

/** Operators offered for a field type: ranges only where ordering is meaningful (numbers, times,
 *  Map values and fields of unknown type); substring match not on numbers/times (ILIKE needs a
 *  string). */
export function operatorsFor(type: FieldType | undefined): OpDef[] {
  const ordered = type === undefined || type === 'number' || type === 'time' || type === 'unknown' || type === 'map';
  const textual = type !== 'number' && type !== 'time';
  return OPERATORS.filter((o) => (RANGE_OPS.has(o.value) ? ordered : TEXT_OPS.has(o.value) ? textual : true));
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

  const [valueOptions, setValueOptions] = useState<Array<SelectableValue<string>>>([]);
  const [loadingValues, setLoadingValues] = useState(false);

  const fieldOptions: Array<SelectableValue<string>> = fields.map((f) => ({
    label: f.displayName,
    value: f.sqlExpr,
    description: f.sqlExpr !== f.displayName ? `${f.type} · ${f.sqlExpr}` : f.type,
  }));
  const selectedField = fields.find((f) => f.sqlExpr === selectedFieldExpr);
  const availableOps = operatorsFor(selectedField?.type);
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

  const isValid = isFilterComplete(selectedFieldExpr, selectedOp, singleValue, multiValues, pairValues);
  const currentOp = selectedOp ? opDef(selectedOp) : null;

  const buildPill = (): FilterPill | null => {
    if (!selectedFieldExpr || !selectedOp || !currentOp) {
      return null;
    }
    const label = customLabel.trim() || undefined;

    let pill: FilterPill;
    if (!currentOp.hasValue) {
      pill = makeFilter(selectedFieldExpr, '', selectedOp, { label });
    } else if (currentOp.isPair) {
      pill = makeFilter(selectedFieldExpr, '', selectedOp, {
        values: [pairValues[0].trim(), pairValues[1].trim()],
        label,
      });
    } else if (currentOp.isMulti) {
      pill = makeFilter(selectedFieldExpr, '', selectedOp, { values: multiValues, label });
    } else {
      pill = makeFilter(selectedFieldExpr, singleValue, selectedOp, { label });
    }
    if (initial) {
      pill = { ...pill, id: initial.id, disabled: initial.disabled, pinned: initial.pinned };
    }
    return pill;
  };

  const handleSubmit = () => {
    const pill = isValid ? buildPill() : null;
    if (pill) {
      onSubmit(pill);
    }
  };

  const preview = isValid ? buildPill() : null;

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
              const nextType = fields.find((f) => f.sqlExpr === opt.value)?.type;
              if (selectedOp && !operatorsFor(nextType).some((o) => o.value === selectedOp)) {
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
                  <Select
                    key={i}
                    aria-label={i === 0 ? 'From' : 'To'}
                    allowCustomValue
                    options={valueOptions}
                    isLoading={loadingValues}
                    value={pairValues[i] ? { label: pairValues[i], value: pairValues[i] } : null}
                    onChange={(opt) => {
                      const v = (opt as SelectableValue<string>).value ?? '';
                      setPairValues((p) => (i === 0 ? [v, p[1]] : [p[0], v]));
                    }}
                    placeholder={i === 0 ? 'From…' : 'To…'}
                    disabled={!selectedFieldExpr}
                    menuShouldPortal
                  />
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

      {preview && (
        <div className={styles.preview} data-testid="filter-preview">
          <span className={styles.optional}>Preview</span> {filterLabel({ ...preview, label: undefined })}
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
