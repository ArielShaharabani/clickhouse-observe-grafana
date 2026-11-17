import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, useStyles2 } from '@grafana/ui';
import { ActionHost, fieldLabelFor, ValueContext, valueActions } from '../actions/registry';

/**
 * Re-indents valid JSON text without parsing its values, so big integers (UInt64 IDs) and
 * duplicate keys show exactly as stored. Assumes `text` is valid JSON.
 */
function indentJson(text: string): string {
  let out = '';
  let depth = 0;
  let inString = false;
  const nl = () => '\n' + '  '.repeat(depth);
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += text[++i] ?? '';
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (/\s/.test(ch)) {
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '{' || ch === '[') {
      const close = ch === '{' ? '}' : ']';
      const rest = text.slice(i + 1).trimStart();
      if (rest.startsWith(close)) {
        out += ch + close;
        i = text.length - rest.length;
      } else {
        depth++;
        out += ch + nl();
      }
    } else if (ch === '}' || ch === ']') {
      depth--;
      out += nl() + ch;
    } else if (ch === ',') {
      out += ',' + nl();
    } else if (ch === ':') {
      out += ': ';
    } else {
      out += ch;
    }
  }
  return out;
}

/** Full value for the Expand popover: objects and JSON text pretty-printed, everything else as is. */
export function expandedText(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }
  if (typeof raw === 'object') {
    return JSON.stringify(raw, null, 2);
  }
  const s = String(raw);
  const t = s.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t); // validity check only — the text itself is re-indented, never re-serialized
      return indentJson(t);
    } catch {
      return s;
    }
  }
  return s;
}

const BUTTON_TEXT: Record<string, string> = { filterFor: 'Filter for', filterOut: 'Filter out', copy: 'Copy value' };

interface Props {
  ctx: ValueContext;
  raw: unknown;
  host: ActionHost;
  /** `refocusGrid` false when closed by a click elsewhere (focus goes where the user clicked). */
  onClose: (refocusGrid?: boolean) => void;
}

/**
 * Expand popover for one grid cell (spec DISC-TABLE-02): the full value plus Filter for /
 * Filter out / Copy value (from the action registry) and a close button. Escape closes it.
 */
export function CellExpandPopover({ ctx, raw, host, onClose }: Props) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const [flipUp, setFlipUp] = useState(false);
  // Open upward when there's no room below inside the grid's scroll area.
  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest('[role="grid"]');
    if (el && scroller && el.getBoundingClientRect().bottom > scroller.getBoundingClientRect().bottom) {
      setFlipUp(true);
    }
  }, []);
  // Latest onClose without re-running the mount effect (the grid re-renders on every hover, and
  // re-running would steal focus back each time).
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    ref.current?.focus();
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onCloseRef.current(false);
      }
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, []);
  const name = ctx.fieldLabel ?? fieldLabelFor(ctx.field);
  const actions = valueActions(ctx, host);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Value of ${name}`}
      tabIndex={-1}
      className={cx(styles.popover, flipUp && styles.up)}
      onKeyDown={(e) => {
        // Keep keys inside the dialog from driving grid navigation.
        e.stopPropagation();
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className={styles.header}>
        <span className={styles.name}>{name}</span>
        <IconButton name="times" size="sm" tooltip="Close" onClick={() => onClose()} />
      </div>
      <pre className={styles.value} data-testid="cell-expand-value">
        {expandedText(raw) || '(empty)'}
      </pre>
      <div className={styles.actions}>
        {actions.map((a) => (
          <Button key={a.id} size="sm" variant="secondary" icon={a.icon} aria-label={a.ariaLabel} onClick={a.run}>
            {BUTTON_TEXT[a.id] ?? a.tooltip}
          </Button>
        ))}
      </div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  popover: css`
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 6;
    width: min(480px, 70vw);
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    font-family: ${theme.typography.fontFamily};
    cursor: auto;
    outline: none;
  `,
  up: css`
    top: auto;
    bottom: 100%;
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${theme.spacing(0.5)};
  `,
  name: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-family: ${theme.typography.fontFamilyMonospace};
    overflow: hidden;
    text-overflow: ellipsis;
  `,
  value: css`
    max-height: 300px;
    overflow: auto;
    margin: 0 0 ${theme.spacing(1)};
    white-space: pre-wrap;
    word-break: break-word;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  actions: css`
    display: flex;
    gap: ${theme.spacing(1)};
    flex-wrap: wrap;
  `,
});
