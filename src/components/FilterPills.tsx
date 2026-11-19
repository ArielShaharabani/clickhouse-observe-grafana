import React, { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2, Icon, Portal } from '@grafana/ui';
import { FilterOp, FilterPill } from '../types';
import {
  filterLabel,
  groupWithNext,
  negateFilter,
  removeFilter,
  removeFromGroup,
  setGroupOp,
  toggleDisabled,
  updateFilter,
} from '../sql/filters';
import { applicableActions, applyToAll, applyToAllPins, ApplyToAllAction } from '../state/queryMenu';
import { FieldValue } from '../sql/kql/_values';
import { FilterEditForm } from './AddFilter/FilterEditForm';
import { FilterPanel } from './AddFilter/AddFilterPopover';
import { moveMenuFocus, usePopoverDialog } from './a11y/dialog';
import { pinFilterInStore, replacePinInStore, unpinFilterInStore } from '../state/sharedSearch';

const NEGATED_OPS: ReadonlySet<FilterOp> = new Set(['!=', 'not_contains', 'not_one_of', 'not_exists', 'not_between']);

interface FilterPillsProps {
  filters: FilterPill[];
  onChange: (filters: FilterPill[]) => void;
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  /** `database.table` of the current view, recorded with a new pin (see state/sharedSearch.ts). */
  pinTable: string;
}

/** Splits a pill's text into a leading "NOT" badge (the convention for negated exists/one_of
 *  filters — "NOT field is one of [...]" rather than filterLabel's "field is not one of [...]"),
 *  a bold field-name part, and the remaining plain text. filterLabel() itself stays unchanged
 *  (tests, tooltips, and AddFilterPopover's chip all depend on its exact wording) — this is a
 *  presentation-only transform local to how pills render. */
function pillText(f: FilterPill): { notPrefix: boolean; fieldPart: string | null; rest: string } {
  if (f.label) {
    return { notPrefix: false, fieldPart: null, rest: f.label };
  }
  if (f.op === 'not_exists') {
    return { notPrefix: true, fieldPart: f.field, rest: ' exists' };
  }
  if (f.op === 'not_one_of') {
    const vals = (f.values ?? [f.value]).filter(Boolean).join(', ');
    return { notPrefix: true, fieldPart: f.field, rest: ` is one of [${vals}]` };
  }
  if (f.op === 'not_between') {
    const [lo = '', hi = ''] = f.values ?? [];
    return { notPrefix: true, fieldPart: f.field, rest: ` is between ${lo} and ${hi}` };
  }
  const label = filterLabel(f);
  const spaceIdx = label.indexOf(' ');
  return {
    notPrefix: false,
    fieldPart: spaceIdx > 0 ? label.slice(0, spaceIdx) : null,
    rest: spaceIdx > 0 ? label.slice(spaceIdx) : label,
  };
}

interface OpenMenu {
  id: string;
  rect: DOMRect;
}

export function FilterPills({ filters, onChange, loadValues, pinTable }: FilterPillsProps) {
  const styles = useStyles2(getStyles);
  // Pinned store transitions (DISC-FILTER-01 / SHARED-STATE-01) happen only on explicit actions
  // on a pinned pill: pin, unpin, edit or exclude (condition replaced), delete. Disable and
  // "Clear all" change this page only.
  const replaceIfPinned = (before: FilterPill, after: FilterPill) => {
    if (before.pinned) {
      replacePinInStore(before, after, pinTable);
    }
  };
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [editing, setEditing] = useState<OpenMenu | null>(null);
  const [bulkMenu, setBulkMenu] = useState<DOMRect | null>(null);
  const bulkButton = useRef<HTMLButtonElement>(null);
  // Pill buttons by filter id: focus goes back to the pill when its menu or editor closes.
  const pillButtons = useRef(new Map<string, HTMLButtonElement>());
  const pillButton = (id: string) => pillButtons.current.get(id) ?? null;

  if (filters.length === 0) {
    return null;
  }

  const onRemove = (id: string) => {
    const pill = filters.find((f) => f.id === id);
    if (pill?.pinned) {
      unpinFilterInStore(pill);
    }
    onChange(removeFilter(filters, id));
  };

  const applyBulk = (action: ApplyToAllAction) => {
    const next = applyToAll(filters, action);
    applyToAllPins(filters, next, action, pinTable);
    onChange(next);
  };
  const removeAll = () => {
    filters.forEach((f) => f.pinned && unpinFilterInStore(f));
    onChange([]);
  };

  // A group is a run of adjacent pills with the same group id (the helpers in sql/filters.ts keep
  // members adjacent); anything else renders as before.
  const groupSize = (g: string | undefined) => (g ? filters.filter((x) => x.group === g).length : 0);
  const pillNodes = filters.map((f, idx) => {
        const { notPrefix, fieldPart, rest } = pillText(f);
        const negated = NEGATED_OPS.has(f.op);
        const grouped = groupSize(f.group) > 1;
        const firstInGroup = grouped && filters[idx - 1]?.group !== f.group;
        const lastOfGroup = f.group ? filters.map((x) => x.group).lastIndexOf(f.group) : idx;
        return (
          <React.Fragment key={f.id}>
          {grouped && !firstInGroup && (
            <span className={styles.groupOp} aria-hidden="true">
              {f.groupOp === 'or' ? 'OR' : 'AND'}
            </span>
          )}
          <span
            data-group={grouped ? f.group : undefined}
            data-group-op={grouped ? (f.groupOp === 'or' ? 'or' : 'and') : undefined}
            className={cx(
              styles.pill,
              f.pinned && styles.pillPinned,
              negated && styles.pillNegated,
              f.disabled && styles.pillDisabled,
              grouped && styles.pillGrouped
            )}
            title={filterLabel(f)}
          >
            <button
              ref={(el) => {
                if (el) {
                  pillButtons.current.set(f.id, el);
                } else {
                  pillButtons.current.delete(f.id);
                }
              }}
              className={styles.pillBody}
              aria-haspopup="menu"
              aria-label={`Filter actions: ${filterLabel(f)}${f.pinned ? ' (pinned)' : ''}${f.disabled ? ' (disabled)' : ''}`}
              onClick={(e) => setMenu({ id: f.id, rect: e.currentTarget.getBoundingClientRect() })}
            >
              {f.pinned && <Icon name="gf-pin" size="xs" className={styles.pinIcon} aria-label="Pinned" />}
              {notPrefix && <span className={styles.notPart}>NOT </span>}
              {fieldPart && (
                <span className={negated ? undefined : styles.fieldPart}>{fieldPart}</span>
              )}
              {rest}
            </button>
            <button
              className={styles.removeBtn}
              onClick={() => onRemove(f.id)}
              aria-label={`Remove filter ${filterLabel(f)}`}
            >
              <Icon name="times" size="xs" />
            </button>

            {menu?.id === f.id && (
              <FilterPillMenu
                anchorRect={menu.rect}
                pill={f}
                onClose={() => setMenu(null)}
                returnFocus={() => pillButton(f.id)}
                onEdit={() => {
                  setEditing(menu);
                  setMenu(null);
                }}
                onToggleNegate={() => {
                  replaceIfPinned(f, { ...f, ...negateFilter(f) });
                  onChange(updateFilter(filters, f.id, negateFilter(f)));
                  setMenu(null);
                }}
                onToggleDisabled={() => {
                  onChange(toggleDisabled(filters, f.id));
                  setMenu(null);
                }}
                onTogglePin={() => {
                  if (f.pinned) {
                    unpinFilterInStore(f);
                  } else {
                    pinFilterInStore(f, pinTable);
                  }
                  onChange(updateFilter(filters, f.id, { pinned: !f.pinned }));
                  setMenu(null);
                }}
                onDelete={() => {
                  onRemove(f.id);
                  setMenu(null);
                }}
                canGroupWithNext={lastOfGroup < filters.length - 1}
                onGroupWithNext={() => {
                  onChange(groupWithNext(filters, f.id));
                  setMenu(null);
                }}
                groupOp={grouped ? (f.groupOp === 'or' ? 'or' : 'and') : undefined}
                onToggleGroupOp={() => {
                  onChange(setGroupOp(filters, f.group!, f.groupOp === 'or' ? 'and' : 'or'));
                  setMenu(null);
                }}
                onRemoveFromGroup={() => {
                  onChange(removeFromGroup(filters, f.id));
                  setMenu(null);
                }}
              />
            )}

            {editing?.id === f.id && (
              <FilterPillEditPopover
                anchorRect={editing.rect}
                pill={f}
                loadValues={loadValues}
                onCancel={() => setEditing(null)}
                returnFocus={() => pillButton(f.id)}
                onSubmit={(patched) => {
                  replaceIfPinned(f, { ...f, ...patched });
                  onChange(updateFilter(filters, f.id, patched));
                  setEditing(null);
                }}
              />
            )}
          </span>
          </React.Fragment>
        );
      });

  return (
    <div className={styles.container} data-testid="filter-pills">
      {pillNodes}
      <button
        ref={bulkButton}
        type="button"
        className={styles.clearAll}
        aria-haspopup="menu"
        aria-label="All filters actions"
        title="Actions for all filters"
        onClick={(e) => setBulkMenu(e.currentTarget.getBoundingClientRect())}
      >
        <Icon name="ellipsis-v" size="sm" />
      </button>
      {bulkMenu && (
        <BulkMenu
          anchorRect={bulkMenu}
          actions={applicableActions(filters)}
          onAction={(a) => {
            applyBulk(a);
            setBulkMenu(null);
          }}
          onRemoveAll={() => {
            removeAll();
            setBulkMenu(null);
          }}
          onClose={() => setBulkMenu(null)}
          returnFocus={() => bulkButton.current}
        />
      )}
      {filters.length > 1 && (
        <button className={styles.clearAll} onClick={() => onChange([])}>
          Clear all
        </button>
      )}
    </div>
  );
}

const BULK_LABEL: Record<ApplyToAllAction, string> = {
  enable: 'Enable all',
  disable: 'Disable all',
  pin: 'Pin all',
  unpin: 'Unpin all',
  invert: 'Invert inclusion',
};

/** Bulk actions over every filter (Kibana's filter-bar menu); same actions as the query menu's
 *  "Apply to all", plus Remove all. */
function BulkMenu({
  anchorRect,
  actions,
  onAction,
  onRemoveAll,
  onClose,
  returnFocus,
}: {
  anchorRect: DOMRect;
  actions: ApplyToAllAction[];
  onAction: (a: ApplyToAllAction) => void;
  onRemoveAll: () => void;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps } = usePopoverDialog(ref, { onClose, returnFocus, autoFocus: false });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);
  const height = (actions.length + 1) * 32 + 8;
  const flipUp = anchorRect.bottom + 6 + height > window.innerHeight;
  const pos = {
    top: flipUp ? Math.max(8, anchorRect.top - 6 - height) : anchorRect.bottom + 6,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 220 - 8)),
  };
  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={ref}
        className={styles.menu}
        role="menu"
        tabIndex={-1}
        aria-label="All filters actions"
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
        {actions.map((a) => (
          <button key={a} type="button" role="menuitem" className={styles.menuItem} onClick={() => onAction(a)}>
            {BULK_LABEL[a]}
          </button>
        ))}
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onRemoveAll}>
          <Icon name="trash-alt" size="sm" />
          Remove all
        </button>
      </div>
    </Portal>
  );
}

// ── Context menu ─────────────────────────────────────────────────────────────

interface FilterPillMenuProps {
  /** Bounding rect of the pill button, captured at click time — see FilterPills' onClick. Reading
   *  the rect synchronously up front (rather than chasing a ref in a layout effect after mount)
   *  sidesteps React re-attaching callback refs mid-commit, which previously left this popover
   *  reading an unset ref and rendering at the viewport origin (0,0). */
  anchorRect: DOMRect;
  pill: FilterPill;
  onClose: () => void;
  onEdit: () => void;
  onToggleNegate: () => void;
  onToggleDisabled: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  /** Group (OR / AND) actions. */
  canGroupWithNext: boolean;
  onGroupWithNext: () => void;
  /** Set when the pill is in a group: the group's current operator. */
  groupOp?: 'or' | 'and';
  onToggleGroupOp: () => void;
  onRemoveFromGroup: () => void;
  /** The pill button, focused again when the menu closes. */
  returnFocus: () => HTMLElement | null;
}

const MENU_HEIGHT_ESTIMATE = 300;

function FilterPillMenu({
  anchorRect,
  pill,
  onClose,
  returnFocus,
  onEdit,
  onToggleNegate,
  onToggleDisabled,
  onTogglePin,
  onDelete,
  canGroupWithNext,
  onGroupWithNext,
  groupOp,
  onToggleGroupOp,
  onRemoveFromGroup,
}: FilterPillMenuProps) {
  const styles = useStyles2(getStyles);
  const negated = NEGATED_OPS.has(pill.op);
  const flipUp = anchorRect.bottom + 6 + MENU_HEIGHT_ESTIMATE > window.innerHeight;
  const pos = {
    top: flipUp ? Math.max(8, anchorRect.top - 6 - MENU_HEIGHT_ESTIMATE) : anchorRect.bottom + 6,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 220 - 8)),
  };

  // SHARED-A11Y-01: Escape closes, focus starts on the first item and returns to the pill.
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps } = usePopoverDialog(ref, { onClose, returnFocus, autoFocus: false });
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
  }, []);

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={ref}
        className={styles.menu}
        role="menu"
        tabIndex={-1}
        aria-label="Filter actions"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (ref.current && moveMenuFocus(ref.current, e.key)) {
            e.preventDefault();
          } else if (e.key === 'Tab') {
            // A menu is not a tab stop: close it and go back to the pill.
            e.preventDefault();
            onClose();
          } else {
            dialogProps.onKeyDown(e);
          }
        }}
      >
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onTogglePin}>
          <Icon name="gf-pin" size="sm" />
          {pill.pinned ? 'Unpin' : 'Pin across pages'}
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onEdit}>
          <Icon name="pen" size="sm" />
          Edit filter
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onToggleNegate}>
          <Icon name="minus-circle" size="sm" />
          {negated ? 'Include results' : 'Exclude results'}
        </button>
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onToggleDisabled}>
          <Icon name="eye-slash" size="sm" />
          {pill.disabled ? 'Re-enable' : 'Temporarily disable'}
        </button>
        {canGroupWithNext && (
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onGroupWithNext}>
            <Icon name="link" size="sm" />
            Group with next filter (OR)
          </button>
        )}
        {groupOp && (
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onToggleGroupOp}>
            <Icon name="exchange-alt" size="sm" />
            {groupOp === 'or' ? 'Match all in group (AND)' : 'Match any in group (OR)'}
          </button>
        )}
        {groupOp && (
          <button type="button" role="menuitem" className={styles.menuItem} onClick={onRemoveFromGroup}>
            <Icon name="times" size="sm" />
            Remove from group
          </button>
        )}
        <button type="button" role="menuitem" className={styles.menuItem} onClick={onDelete}>
          <Icon name="trash-alt" size="sm" />
          Delete
        </button>
      </div>
    </Portal>
  );
}

// ── Edit popover ──────────────────────────────────────────────────────────────

interface FilterPillEditPopoverProps {
  /** Same anchorRect pattern as FilterPillMenu — see its doc comment for why. */
  anchorRect: DOMRect;
  pill: FilterPill;
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  onCancel: () => void;
  onSubmit: (pill: FilterPill) => void;
  returnFocus: () => HTMLElement | null;
}

const EDIT_PANEL_W = 760;

function FilterPillEditPopover({ anchorRect, pill, loadValues, onCancel, onSubmit, returnFocus }: FilterPillEditPopoverProps) {
  const styles = useStyles2(getStyles);
  const pos = {
    top: anchorRect.bottom + 6,
    left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - EDIT_PANEL_W - 8)),
  };

  return (
    <Portal>
      <div className={styles.backdrop} onClick={onCancel} />
      <FilterPanel className={styles.editPanel} pos={pos} label="Edit filter" onClose={onCancel} returnFocus={returnFocus}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>Edit filter</span>
        </div>
        <FilterEditForm initial={pill} loadValues={loadValues} onSubmit={onSubmit} onCancel={onCancel} />
      </FilterPanel>
    </Portal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const getStyles = (theme: GrafanaTheme2) => ({
  pillPinned: css({
    borderStyle: 'solid',
    borderColor: theme.colors.primary.border,
  }),
  pillGrouped: css({
    borderStyle: 'dashed',
    borderColor: theme.colors.info.border,
  }),
  groupOp: css({
    fontSize: theme.typography.bodySmall.fontSize,
    fontWeight: theme.typography.fontWeightMedium,
    color: theme.colors.info.text,
  }),
  pinIcon: css({
    marginRight: theme.spacing(0.5),
    color: theme.colors.primary.text,
  }),
  container: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
    align-items: center;
  `,
  /** Kibana Discover filter-pill look: thin neutral border, subtle fill, no bold/color-coded
   *  border — polarity/disabled state is conveyed by the label text, not the chip chrome. */
  pill: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: 4px;
    background: ${theme.colors.background.secondary};
    padding: ${theme.spacing(0.5)} ${theme.spacing(0.75)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.primary};
    max-width: 320px;
    &:hover { background: ${theme.colors.action.hover}; }
  `,
  pillNegated: css`
    color: ${theme.colors.error.text};
  `,
  pillDisabled: css`
    opacity: 0.6;
    text-decoration: line-through;
  `,
  pillBody: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0;
    color: inherit;
    text-decoration: inherit;
    font-size: inherit;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
  `,
  notPart: css`
    font-weight: ${theme.typography.fontWeightBold};
  `,
  fieldPart: css`
    color: ${theme.colors.text.link};
  `,
  removeBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px;
    border-radius: ${theme.shape.radius.default};
    display: flex;
    align-items: center;
    color: ${theme.colors.text.secondary};
    flex-shrink: 0;
    &:hover {
      color: ${theme.colors.text.primary};
      background: ${theme.colors.action.focus};
    }
  `,
  clearAll: css`
    background: transparent;
    border: none;
    cursor: pointer;
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    padding: ${theme.spacing(0.25)} ${theme.spacing(0.5)};
    &:hover {
      color: ${theme.colors.text.primary};
      text-decoration: underline;
    }
  `,
  backdrop: css`
    position: fixed;
    inset: 0;
    z-index: 9999;
  `,
  menu: css`
    position: fixed;
    z-index: 10000;
    min-width: 220px;
    padding: ${theme.spacing(0.5)} 0;
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z2};
  `,
  menuItem: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    width: 100%;
    padding: ${theme.spacing(0.75)} ${theme.spacing(1.5)};
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
    &:hover { background: ${theme.colors.action.hover}; }
  `,
  editPanel: css`
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
