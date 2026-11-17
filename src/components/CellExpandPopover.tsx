import React, { useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Button, IconButton, useStyles2 } from '@grafana/ui';
import { ActionHost, fieldLabelFor, ValueContext, valueActions } from '../actions/registry';

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
      return JSON.stringify(JSON.parse(t), null, 2);
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
  onClose: () => void;
}

/**
 * Expand popover for one grid cell (spec DISC-TABLE-02): the full value plus Filter for /
 * Filter out / Copy value (from the action registry) and a close button. Escape closes it.
 */
export function CellExpandPopover({ ctx, raw, host, onClose }: Props) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const name = ctx.fieldLabel ?? fieldLabelFor(ctx.field);
  const actions = valueActions(ctx, host);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Value of ${name}`}
      tabIndex={-1}
      className={styles.popover}
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
        <IconButton name="times" size="sm" tooltip="Close" onClick={onClose} />
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
