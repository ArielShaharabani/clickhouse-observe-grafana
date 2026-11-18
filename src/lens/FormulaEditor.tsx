/**
 * Formula editor (spec LENS-DIM-03): text box with function / field autocomplete (full signature +
 * description), auto-closed brackets and quotes, an inline error list with a footer badge
 * (`⚠ 1 error`), a function reference, word-wrap and expand toggles. The formula is applied on
 * blur or Ctrl+Enter, and only when it has no errors.
 *
 * Deferred: Monaco (red squiggles at the error position) — a plain text box with positioned
 * messages keeps the bundle and the tests light.
 */
import { metricOptionsOf } from './metricOptions';
import React, { useId, useMemo, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { IconButton, useStyles2 } from '@grafana/ui';
import {
  fieldToken,
  FORMULA_FUNCTIONS,
  formulaErrors,
  formulaFieldNames,
  FormulaFields,
  fnSignature,
  MAX_FORMULA_LEN,
  parseFormula,
} from './formula';
import { LensField, MetricDim } from './state';
import { isLensField } from './suggest';

interface Props {
  dim: MetricDim;
  fields: LensField[];
  onChange: (d: MetricDim) => void;
}

/** Fields a formula can name: every scalar field of the data view, by its label. */
export function formulaFieldsOf(fields: LensField[]): FormulaFields {
  const out: FormulaFields = {};
  for (const f of fields) {
    if (f.type !== 'records' && isLensField(f) && !(f.label in out)) {
      out[f.label] = { expr: f.sqlExpr, numeric: f.type === 'number' };
    }
  }
  return out;
}

/** The formula metric for `text`, keeping only the fields it uses (what sanitizeLens checks). */
export function formulaMetric(dim: MetricDim, text: string, all: FormulaFields): MetricDim {
  const used: FormulaFields = {};
  for (const n of formulaFieldNames(parseFormula(text))) {
    if (all[n]) {
      used[n] = all[n];
    }
  }
  return {
    kind: 'metric',
    id: dim.id,
    op: 'formula',
    formula: text,
    formulaFields: used,
    name: dim.name,
    ...metricOptionsOf(dim),
  };
}

interface Suggestion {
  label: string;
  insert: string;
  detail: string;
  kind: 'function' | 'field';
}

const WORD_BEFORE = /(`[^`]*|[A-Za-z_@][A-Za-z0-9_.@]*)$/;

/** Suggestions for the word ending at `cursor` (functions and fields matching its prefix). */
export function formulaSuggestions(text: string, cursor: number, fieldNames: string[]): Suggestion[] {
  const before = text.slice(0, cursor);
  const m = WORD_BEFORE.exec(before);
  if (!m) {
    return [];
  }
  // Inside a quoted string (e.g. a KQL filter) there is nothing to suggest.
  const quotes = (before.slice(0, m.index).match(/'/g) ?? []).length;
  if (quotes % 2 === 1) {
    return [];
  }
  const word = m[1].replace(/^`/, '').toLowerCase();
  const fns = m[1].startsWith('`')
    ? []
    : FORMULA_FUNCTIONS.filter((f) => f.name.startsWith(word)).map<Suggestion>((f) => ({
        label: fnSignature(f),
        insert: `${f.name}(`,
        detail: f.description,
        kind: 'function',
      }));
  const flds = fieldNames
    .filter((n) => n.toLowerCase().includes(word))
    .slice(0, 20)
    .map<Suggestion>((n) => ({ label: n, insert: fieldToken(n), detail: 'Field', kind: 'field' }));
  return [...fns, ...flds].slice(0, 10);
}

const PAIRS: Record<string, string> = { '(': ')', "'": "'" };

export function FormulaEditor({ dim, fields, onChange }: Props) {
  const styles = useStyles2(getStyles);
  const all = useMemo(() => formulaFieldsOf(fields), [fields]);
  const names = useMemo(() => Object.keys(all), [all]);
  const [draft, setDraft] = useState(dim.formula ?? '');
  const [cursor, setCursor] = useState(draft.length);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [wrap, setWrap] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showRef, setShowRef] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const listId = useId();

  const errors = useMemo(() => formulaErrors(draft, all), [draft, all]);
  const suggestions = open ? formulaSuggestions(draft, cursor, names) : [];

  const commit = () => {
    if (errors.length === 0 && draft !== dim.formula) {
      onChange(formulaMetric(dim, draft, all));
    }
  };

  const setText = (text: string, pos: number) => {
    setDraft(text);
    setCursor(pos);
    requestAnimationFrame(() => {
      ref.current?.setSelectionRange(pos, pos);
    });
  };

  const accept = (s: Suggestion) => {
    const m = WORD_BEFORE.exec(draft.slice(0, cursor));
    const start = m ? cursor - m[1].length : cursor;
    // A function gets its closing bracket right away (auto-close).
    const insert = s.kind === 'function' ? `${s.insert})` : s.insert;
    const text = draft.slice(0, start) + insert + draft.slice(cursor);
    setText(text, start + (s.kind === 'function' ? insert.length - 1 : insert.length));
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      commit();
      return;
    }
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((a) => (a + d + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        accept(suggestions[Math.min(active, suggestions.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    const { selectionStart: s, selectionEnd: end, value } = el;
    // Typing the closing character right before the same auto-inserted one just steps over it.
    if ((e.key === ')' || e.key === "'") && s === end && value[s] === e.key) {
      e.preventDefault();
      setText(value, s + 1);
      return;
    }
    if (PAIRS[e.key] && s === end && value.length < MAX_FORMULA_LEN) {
      e.preventDefault();
      setText(value.slice(0, s) + e.key + PAIRS[e.key] + value.slice(end), s + 1);
      setOpen(e.key === '(');
      return;
    }
  };

  const errorLabel = `${errors.length} error${errors.length === 1 ? '' : 's'}`;

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar}>
        <IconButton
          name="wrap-text"
          size="sm"
          tooltip={wrap ? 'Turn off word wrap' : 'Turn on word wrap'}
          aria-pressed={wrap}
          onClick={() => setWrap((w) => !w)}
        />
        <IconButton
          name={expanded ? 'compress-arrows' : 'expand-arrows'}
          size="sm"
          tooltip={expanded ? 'Collapse' : 'Expand'}
          aria-pressed={expanded}
          onClick={() => setExpanded((x) => !x)}
        />
        <IconButton
          name="book"
          size="sm"
          tooltip="Function reference"
          aria-pressed={showRef}
          onClick={() => setShowRef((x) => !x)}
        />
      </div>
      <div className={styles.inputWrap}>
        <textarea
          ref={ref}
          aria-label="Formula"
          aria-invalid={errors.length > 0}
          aria-autocomplete="list"
          aria-controls={suggestions.length ? listId : undefined}
          spellCheck={false}
          maxLength={MAX_FORMULA_LEN}
          wrap={wrap ? 'soft' : 'off'}
          rows={expanded ? 10 : 4}
          className={cx(styles.input, errors.length > 0 && styles.invalid)}
          value={draft}
          onChange={(e) => {
            setDraft(e.currentTarget.value);
            setCursor(e.currentTarget.selectionStart);
            setOpen(true);
            setActive(0);
          }}
          onSelect={(e) => setCursor(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setOpen(false);
            commit();
          }}
        />
        {suggestions.length > 0 && (
          <ul id={listId} role="listbox" aria-label="Formula suggestions" className={styles.list}>
            {suggestions.map((s, i) => (
              <li
                key={`${s.kind}-${s.label}`}
                role="option"
                aria-selected={i === active}
                className={cx(styles.option, i === active && styles.optionActive)}
                // mousedown, not click: the textarea's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  accept(s);
                }}
              >
                <code>{s.label}</code>
                {i === active && <div className={styles.detail}>{s.detail}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className={styles.footer}>
        {errors.length > 0 ? (
          <span className={styles.badge} role="status">
            ⚠ {errorLabel}
          </span>
        ) : (
          <span className={styles.hint}>Ctrl+Enter or leave the box to apply</span>
        )}
      </div>
      {errors.length > 0 && (
        <ul className={styles.errors} aria-label="Formula errors">
          {errors.map((e, i) => (
            <li key={i}>
              {e.message}
              {e.pos > 0 && <span className={styles.hint}> (at character {e.pos + 1})</span>}
            </li>
          ))}
        </ul>
      )}
      {showRef && (
        <div className={styles.reference} aria-label="Function reference" role="region">
          {FORMULA_FUNCTIONS.map((f) => (
            <div key={f.name}>
              <code>{fnSignature(f)}</code>
              <div className={styles.hint}>{f.description}</div>
            </div>
          ))}
          <div className={styles.hint}>
            Example: <code>count(kql=&apos;SeverityText : ERROR&apos;) / count()</code>
          </div>
        </div>
      )}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  toolbar: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(0.5)};
  `,
  inputWrap: css`
    position: relative;
  `,
  input: css`
    width: 100%;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
    padding: ${theme.spacing(0.5, 1)};
    background: ${theme.components.input.background};
    color: ${theme.colors.text.primary};
    border: 1px solid ${theme.components.input.borderColor};
    border-radius: ${theme.shape.radius.default};
    resize: vertical;
  `,
  invalid: css`
    border-color: ${theme.colors.error.border};
  `,
  list: css`
    position: absolute;
    z-index: 2;
    left: 0;
    right: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    max-height: 240px;
    overflow: auto;
    background: ${theme.colors.background.elevated};
    border: 1px solid ${theme.colors.border.medium};
    box-shadow: ${theme.shadows.z3};
  `,
  option: css`
    padding: ${theme.spacing(0.5, 1)};
    cursor: pointer;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  optionActive: css`
    background: ${theme.colors.action.hover};
  `,
  detail: css`
    color: ${theme.colors.text.secondary};
  `,
  footer: css`
    display: flex;
    justify-content: flex-end;
  `,
  badge: css`
    color: ${theme.colors.error.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  hint: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  errors: css`
    margin: 0;
    padding-left: ${theme.spacing(2)};
    color: ${theme.colors.error.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  reference: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    max-height: 300px;
    overflow: auto;
    padding: ${theme.spacing(1)};
    border: 1px solid ${theme.colors.border.weak};
  `,
});
