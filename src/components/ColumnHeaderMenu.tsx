/**
 * Column header menu of the results grid (PARITY-GRID, Kibana's header actions): sort ascending /
 * descending, move left / right, remove, copy the field name, reset a resized width. Opened by
 * the header's name button; a menu in a Portal (the grid scrolls), Escape / outside click / Tab
 * close it and focus goes back to the header button.
 */
import React, { useEffect, useRef } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, IconName, Portal, useStyles2 } from '@grafana/ui';
import { moveMenuFocus, usePopoverDialog } from './a11y/dialog';

export interface ColumnMenuItem {
  id: string;
  label: string;
  icon: IconName;
  run: () => void;
  /** Shown checked (the current sort). */
  active?: boolean;
}

interface ColumnHeaderMenuProps {
  columnName: string;
  anchorRect: DOMRect;
  items: ColumnMenuItem[];
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}

const MENU_W = 220;

export function ColumnHeaderMenu({ columnName, anchorRect, items, onClose, returnFocus }: ColumnHeaderMenuProps) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps } = usePopoverDialog(ref, { onClose, returnFocus, autoFocus: false });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  const pos = {
    top: anchorRect.bottom + 4,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - MENU_W - 8)),
  };
  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={ref}
        className={styles.menu}
        role="menu"
        tabIndex={-1}
        aria-label={`Column actions: ${columnName}`}
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (ref.current && moveMenuFocus(ref.current, e.key)) {
            e.preventDefault();
          } else if (e.key === 'Tab') {
            e.preventDefault();
            onClose();
          } else {
            dialogProps.onKeyDown(e);
          }
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className={styles.menuItem}
            aria-current={item.active || undefined}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <Icon name={item.icon} size="sm" />
            <span className={styles.label}>{item.label}</span>
            {item.active && <Icon name="check" size="sm" />}
          </button>
        ))}
      </div>
    </Portal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css`
    position: fixed;
    inset: 0;
    z-index: 1049;
  `,
  menu: css`
    position: fixed;
    z-index: 1050;
    width: ${MENU_W}px;
    padding: ${theme.spacing(0.5)} 0;
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    outline: none;
  `,
  menuItem: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    width: 100%;
    padding: ${theme.spacing(0.75)} ${theme.spacing(1.5)};
    background: transparent;
    border: none;
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.body.fontSize};
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      background: ${theme.colors.action.hover};
      outline: none;
    }
  `,
  label: css`
    flex: 1;
  `,
});
