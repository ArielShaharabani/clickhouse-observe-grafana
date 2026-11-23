/**
 * Discover session tab strip (DISC-NAV-01): one tab per exploration, `+` for a new one, a ⋮ menu
 * per tab (Rename, Duplicate, Move left / right, Close) and a ⌄ menu listing opened and recently
 * closed tabs. Tabs are sized like browser tabs (wide when few, shrinking as more open; the strip
 * scrolls only once every tab is at its minimum). Tabs drag-reorder with pointer events (grab
 * anywhere on a tab; the landing index is the dragged tab's centre against its neighbours'
 * midpoints, see tabDropIndex); Move left / right are the keyboard way to do the same.
 * Presentational: all state lives in the parent (DiscoverTabsHost).
 */
import React, { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Dropdown, IconButton, Input, Menu, useStyles2 } from '@grafana/ui';
import { DiscoverTabsState, MAX_TABS, MAX_TITLE_LENGTH, relativeTime } from '../../state/discoverTabs';
import { tabDropIndex, tabShift, TabSpan } from './tabDropIndex';

/** Horizontal pointer travel before a press on a tab becomes a drag (so click / double-click still work). */
const DRAG_THRESHOLD_PX = 5;
const TAB_PREFERRED_WIDTH = 220;
const TAB_GAP = 4;
const EDGE_SCROLL_ZONE_PX = 40;
const EDGE_SCROLL_STEP_PX = 14;

interface DragSession {
  id: string;
  index: number;
  pointerId: number;
  /** The pressed tab: it takes the pointer capture, even if a fast move reaches a neighbour first. */
  el: HTMLElement;
  startX: number;
  startScroll: number;
  /** Tab extents in the scroller's content coordinates, measured when the press began. */
  spans: TabSpan[];
  /** Width of one tab plus the gap: how far neighbours slide to make room. */
  slot: number;
  active: boolean;
  clientX: number;
  /** Landing index as of the last pointer move. */
  target: number;
}

interface DragView {
  id: string;
  index: number;
  target: number;
  dx: number;
  slot: number;
}

export interface DiscoverTabsProps {
  state: DiscoverTabsState;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onClose: (id: string) => void;
  onMove: (id: string, to: number) => void;
  onRestore: (id: string) => void;
  onClearClosed: () => void;
  /** Name of the tab list. */
  label?: string;
}

export function DiscoverTabs(props: DiscoverTabsProps) {
  const { state, onSelect, onAdd, onDuplicate, onRename, onClose, onMove, onRestore, onClearClosed, label = 'Discover tabs' } = props;
  const styles = useStyles2(getStyles);
  const [editing, setEditing] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragView | null>(null);
  const session = useRef<DragSession | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const suppressClick = useRef(false);
  const edgeRaf = useRef(0);
  const atMax = state.tabs.length >= MAX_TABS;
  const canClose = state.tabs.length > 1;

  // Keep the active tab in view when it changes or tabs are added (the strip may be scrolled).
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state.activeId, state.tabs.length]);

  /** Recomputes the dragged tab's offset and landing index from the pointer and scroll position. */
  const updateDrag = () => {
    const d = session.current;
    const sc = scroller.current;
    if (!d || !d.active || !sc) {
      return;
    }
    const dx = d.clientX - d.startX + (sc.scrollLeft - d.startScroll);
    d.target = tabDropIndex(d.index, dx, d.spans);
    setDrag({ id: d.id, index: d.index, target: d.target, dx, slot: d.slot });
  };

  const edgeScrollTick = () => {
    const d = session.current;
    const sc = scroller.current;
    if (!d || !d.active || !sc) {
      edgeRaf.current = 0;
      return;
    }
    const rect = sc.getBoundingClientRect();
    let step = 0;
    if (d.clientX < rect.left + EDGE_SCROLL_ZONE_PX) {
      step = -EDGE_SCROLL_STEP_PX;
    } else if (d.clientX > rect.right - EDGE_SCROLL_ZONE_PX) {
      step = EDGE_SCROLL_STEP_PX;
    }
    if (step !== 0) {
      const before = sc.scrollLeft;
      sc.scrollLeft += step;
      if (sc.scrollLeft !== before) {
        updateDrag();
      }
    }
    edgeRaf.current = requestAnimationFrame(edgeScrollTick);
  };

  // The handler is a new function every render: remove the one that was actually added.
  const keyListener = useRef<((e: KeyboardEvent) => void) | null>(null);
  const dropKeyListener = () => {
    if (keyListener.current) {
      window.removeEventListener('keydown', keyListener.current, true);
      keyListener.current = null;
    }
  };

  const onWindowKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && session.current) {
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
    }
  };

  const endDrag = (commit: boolean) => {
    const d = session.current;
    session.current = null;
    cancelAnimationFrame(edgeRaf.current);
    edgeRaf.current = 0;
    dropKeyListener();
    if (d?.active) {
      // The click that follows the pointer-up belongs to the drag, not to a select.
      suppressClick.current = true;
      setTimeout(() => {
        suppressClick.current = false;
      }, 0);
      if (commit && d.target !== d.index) {
        onMove(d.id, d.target);
      }
    }
    setDrag(null);
  };

  const onTabPointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string, index: number) => {
    const el = e.target as HTMLElement;
    if (e.button !== 0 || editing === id || el.closest('[data-tab-nodrag], input')) {
      return;
    }
    const sc = scroller.current;
    if (!sc) {
      return;
    }
    const origin = sc.getBoundingClientRect().left - sc.scrollLeft;
    const tabEls = Array.from(sc.querySelectorAll<HTMLElement>('[data-testid="discover-tab"]'));
    const spans = tabEls.map((t) => {
      const b = t.getBoundingClientRect();
      return { left: b.left - origin, right: b.right - origin };
    });
    const own = spans[index];
    const next = spans[index + 1];
    const prev = spans[index - 1];
    const gap = next ? next.left - own.right : prev ? own.left - prev.right : 0;
    session.current = {
      id,
      index,
      pointerId: e.pointerId,
      el: e.currentTarget,
      startX: e.clientX,
      startScroll: sc.scrollLeft,
      spans,
      slot: own.right - own.left + gap,
      active: false,
      clientX: e.clientX,
      target: index,
    };
  };

  const onTabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = session.current;
    if (!d || e.pointerId !== d.pointerId) {
      return;
    }
    d.clientX = e.clientX;
    if (!d.active) {
      // Vertical movement is ignored: only horizontal travel starts (and steers) a drag.
      if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD_PX) {
        return;
      }
      d.active = true;
      d.el.setPointerCapture?.(e.pointerId);
      keyListener.current = onWindowKey;
      window.addEventListener('keydown', onWindowKey, true);
      edgeRaf.current = requestAnimationFrame(edgeScrollTick);
    }
    updateDrag();
  };

  const onTabPointerEnd = (e: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const d = session.current;
    if (!d || e.pointerId !== d.pointerId) {
      return;
    }
    if (d.active) {
      d.el.releasePointerCapture?.(e.pointerId);
    }
    endDrag(commit);
  };

  // Drop the listener / frame if the strip unmounts mid-drag.
  useEffect(
    () => () => {
      cancelAnimationFrame(edgeRaf.current);
      dropKeyListener();
    },
    []
  );

  const tabMenu = (id: string, index: number) => (
    <Menu>
      {/* Open the editor after the menu has closed: closing returns focus to the ⋮ button, which
          would otherwise blur (and so commit) the freshly focused input at once. */}
      <Menu.Item label="Rename" icon="pen" onClick={() => setTimeout(() => setEditing(id), 0)} />
      <Menu.Item label="Duplicate" icon="copy" disabled={atMax} onClick={() => onDuplicate(id)} />
      <Menu.Item label="Move left" icon="arrow-left" disabled={index === 0} onClick={() => onMove(id, index - 1)} />
      <Menu.Item
        label="Move right"
        icon="arrow-right"
        disabled={index === state.tabs.length - 1}
        onClick={() => onMove(id, index + 1)}
      />
      <Menu.Divider />
      <Menu.Item label="Close" icon="times" disabled={!canClose} onClick={() => onClose(id)} />
    </Menu>
  );

  const listMenu = (
    <Menu>
      <Menu.Group label="Opened tabs">
        {state.tabs.map((t) => (
          <Menu.Item
            key={t.id}
            label={t.title}
            icon={t.id === state.activeId ? 'check' : undefined}
            onClick={() => onSelect(t.id)}
          />
        ))}
      </Menu.Group>
      <Menu.Divider />
      <Menu.Group label="Recently closed">
        {state.closed.length === 0 ? (
          <Menu.Item label="No recently closed tabs" disabled />
        ) : (
          state.closed.map((c) => (
            <Menu.Item
              key={c.tab.id}
              label={c.tab.title}
              description={relativeTime(c.closedAt)}
              icon="history"
              disabled={atMax}
              onClick={() => onRestore(c.tab.id)}
            />
          ))
        )}
      </Menu.Group>
      {state.closed.length > 0 && (
        <>
          <Menu.Divider />
          <Menu.Item label="Clear recently closed" icon="trash-alt" onClick={onClearClosed} />
        </>
      )}
    </Menu>
  );

  return (
    <div className={styles.strip}>
      <div
        className={styles.scroller}
        role="tablist"
        aria-label={label}
        ref={scroller}
        // Natural width = every tab at its preferred size; it shrinks (tabs with it) down to the
        // tabs' minimum, then scrolls. Explicit because the tabs' size containment hides their
        // preferred width from the flex algorithm.
        style={{ width: state.tabs.length * (TAB_PREFERRED_WIDTH + TAB_GAP) - TAB_GAP }}
      >
        {state.tabs.map((t, i) => {
          const active = t.id === state.activeId;
          const dragging = drag?.id === t.id;
          const shift = drag && !dragging ? tabShift(i, drag.index, drag.target, drag.slot) : 0;
          const transform = dragging ? drag.dx : shift;
          return (
            <div
              key={t.id}
              className={cx(
                styles.tab,
                active && styles.active,
                dragging && styles.dragging,
                drag && !dragging && styles.shifting
              )}
              style={transform ? { transform: `translateX(${transform}px)` } : undefined}
              onPointerDown={(e) => onTabPointerDown(e, t.id, i)}
              onPointerMove={onTabPointerMove}
              onPointerUp={(e) => onTabPointerEnd(e, true)}
              onPointerCancel={(e) => onTabPointerEnd(e, false)}
              onClickCapture={(e) => {
                if (suppressClick.current) {
                  e.stopPropagation();
                  e.preventDefault();
                }
              }}
              data-testid="discover-tab"
            >
              {editing === t.id ? (
                <TitleEditor
                  initial={t.title}
                  onDone={(title) => {
                    setEditing(null);
                    if (title !== null) {
                      onRename(t.id, title);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={styles.tabButton}
                  title={t.title}
                  onClick={() => !active && onSelect(t.id)}
                  onDoubleClick={() => setEditing(t.id)}
                >
                  {t.title}
                </button>
              )}
              <div className={cx(styles.actions, active && styles.actionsActive)} data-tab-nodrag>
                <Dropdown overlay={tabMenu(t.id, i)} placement="bottom-start">
                  <IconButton name="ellipsis-v" size="sm" aria-label={`Tab actions: ${t.title}`} />
                </Dropdown>
                {canClose && (
                  <IconButton
                    name="times"
                    size="sm"
                    aria-label={`Close tab: ${t.title}`}
                    onClick={() => onClose(t.id)}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <IconButton
        name="plus"
        aria-label="New tab"
        tooltip={atMax ? `At most ${MAX_TABS} tabs` : 'New tab'}
        disabled={atMax}
        onClick={onAdd}
      />
      <div className={styles.spacer} />
      <Dropdown overlay={listMenu} placement="bottom-end">
        <IconButton name="angle-down" aria-label="All tabs" tooltip="All tabs" />
      </Dropdown>
    </div>
  );
}

/** Inline rename: Enter / blur commit, Escape cancels (null). */
function TitleEditor({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    // Focus a frame later so a menu restoring focus to its trigger can't steal it back.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);
  const finish = (title: string | null) => {
    if (!done.current) {
      done.current = true;
      onDone(title);
    }
  };
  return (
    <Input
      ref={ref}
      width={20}
      value={value}
      maxLength={MAX_TITLE_LENGTH}
      aria-label="Tab name"
      onChange={(e) => setValue(e.currentTarget.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          finish(value);
        } else if (e.key === 'Escape') {
          finish(null);
        }
      }}
    />
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  strip: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.5),
    minHeight: 36,
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    marginBottom: theme.spacing(1),
    flexShrink: 0,
  }),
  /** Holds the tabs only: it scrolls once every tab is at its minimum width, while + and ⌄ stay put. */
  scroller: css({
    display: 'flex',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: TAB_GAP,
    flex: '0 1 auto',
    minWidth: 0,
    overflowX: 'auto',
    scrollbarWidth: 'thin',
  }),
  tab: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    flex: `1 1 ${TAB_PREFERRED_WIDTH}px`,
    minWidth: 96,
    maxWidth: 240,
    height: 36,
    boxSizing: 'border-box',
    containerType: 'inline-size',
    userSelect: 'none',
    padding: theme.spacing(0.25, 0.5, 0.25, 1.5),
    borderRadius: `${theme.shape.radius.default} ${theme.shape.radius.default} 0 0`,
    border: `1px solid transparent`,
    borderBottom: 'none',
    color: theme.colors.text.secondary,
    '&:hover': { background: theme.colors.action.hover },
  }),
  active: css({
    color: theme.colors.text.primary,
    background: theme.colors.background.primary,
    borderColor: theme.colors.border.weak,
    boxShadow: `inset 0 2px 0 ${theme.colors.primary.main}`,
  }),
  dragging: css({
    position: 'relative',
    zIndex: 2,
    cursor: 'grabbing',
    background: theme.colors.background.secondary,
    boxShadow: theme.shadows.z2,
  }),
  shifting: css({
    transition: 'transform 120ms ease',
    '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
  }),
  tabButton: css({
    flex: 1,
    minWidth: 0,
    textAlign: 'left',
    background: 'none',
    border: 'none',
    padding: 0,
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
  /** ⋮ and ×. On a narrow inactive tab they collapse to zero width until the tab is hovered or
   *  focused (still in the DOM and tabbable, so keyboard users reach them). */
  actions: css({
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    '@container (max-width: 150px)': {
      width: 0,
      overflow: 'hidden',
      opacity: 0,
    },
    '[data-testid="discover-tab"]:hover &, [data-testid="discover-tab"]:focus-within &': {
      width: 'auto',
      overflow: 'visible',
      opacity: 1,
    },
  }),
  actionsActive: css({
    '@container (max-width: 150px)': { width: 'auto', overflow: 'visible', opacity: 1 },
  }),
  spacer: css({ flex: 1 }),
});
