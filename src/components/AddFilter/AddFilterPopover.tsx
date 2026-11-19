/**
 * "Add filter" button + popup for the Logs Explorer toolbar.
 *
 * Opens a panel with:
 *   Field selector → Operator selector → Value input (with live autocomplete)
 *   → optional Custom label → Cancel / Add filter
 *
 * Calls onAddFilter(pill) on submit; the pill is built with makeFilter so
 * multi-value (one_of / not_one_of) and custom label are preserved.
 */

import React, { useCallback, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Icon, Portal, useStyles2 } from '@grafana/ui';
import { FilterPill } from '../../types';
import { FieldValue } from '../../sql/kql/_values';
import { FilterEditForm } from './FilterEditForm';
import { usePopoverDialog } from '../a11y/dialog';

interface AddFilterPopoverProps {
  /** Page-supplied value lookup (bound to the page's own table/filters). */
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  onAddFilter: (pill: FilterPill) => void;
}

export function AddFilterPopover({ loadValues, onAddFilter }: AddFilterPopoverProps) {
  const styles = useStyles2(getStyles);

  const anchorRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const openPopover = useCallback(() => {
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const PANEL_W = 760;
      const left = Math.min(rect.left, window.innerWidth - PANEL_W - 8);
      setPopoverPos({ top: rect.bottom + 6, left: Math.max(8, left) });
    }
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  return (
    <div ref={anchorRef} className={styles.wrapper}>
      <button
        className={styles.triggerBtn}
        onClick={openPopover}
        title="Add a structured filter"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <Icon name="plus-circle" size="sm" />
        Add filter
      </button>

      {isOpen && (
        <Portal>
          {/* Click-outside backdrop */}
          <div className={styles.backdrop} onClick={close} />

          <FilterPanel className={styles.panel} pos={popoverPos} label="Add filter" onClose={close}>
            <div className={styles.panelHeader}>
              <span className={styles.panelTitle}>Add filter</span>
            </div>

            <FilterEditForm
              loadValues={loadValues}
              onSubmit={(pill) => {
                onAddFilter(pill);
                close();
              }}
              onCancel={close}
            />
          </FilterPanel>
        </Portal>
      )}
    </div>
  );
}

/**
 * The positioned filter panel (Add filter, Edit filter) as a dialog (SHARED-A11Y-01): announced
 * with the dialog hint, Escape closes it, focus moves in and goes back to the opener.
 */
export function FilterPanel({
  className,
  pos,
  label,
  onClose,
  returnFocus,
  children,
}: {
  className: string;
  pos: { top: number; left: number };
  label: string;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null | undefined;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps, hint } = usePopoverDialog(ref, { onClose, returnFocus });
  return (
    <div
      ref={ref}
      {...dialogProps}
      aria-label={label}
      className={className}
      style={{ top: pos.top, left: pos.left, outline: 'none' }}
      onClick={(e) => e.stopPropagation()}
    >
      {hint}
      {children}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    position: relative;
    display: inline-flex;
    align-items: center;
  `,
  triggerBtn: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.75)};
    padding: ${theme.spacing(0.5)} ${theme.spacing(1)} ${theme.spacing(0.5)} ${theme.spacing(0.5)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.body.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    cursor: pointer;
    white-space: nowrap;
    height: 32px;
    &:hover {
      background: ${theme.colors.action.hover};
      border-color: ${theme.colors.border.strong};
    }
  `,
  backdrop: css`
    position: fixed;
    inset: 0;
    z-index: 9999;
  `,
  panel: css`
    position: fixed;
    z-index: 10000;
    width: 760px;
    max-width: calc(100vw - 16px);
    padding: ${theme.spacing(2)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
  `,
  panelHeader: css`
    margin-bottom: ${theme.spacing(1.5)};
  `,
  panelTitle: css`
    font-size: ${theme.typography.h5.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.primary};
  `,
});
