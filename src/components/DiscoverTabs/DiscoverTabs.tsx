/**
 * Discover session tab strip (DISC-NAV-01): one tab per exploration, `+` for a new one, a ⋮ menu
 * per tab (Rename, Duplicate, Move left / right, Close) and a ⌄ menu listing opened and recently
 * closed tabs. Tabs drag-reorder; Move left / right are the keyboard way to do the same.
 * Presentational: all state lives in the parent (DiscoverTabsHost).
 */
import React, { useEffect, useRef, useState } from 'react';
import { css, cx } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { Dropdown, IconButton, Input, Menu, useStyles2 } from '@grafana/ui';
import { DiscoverTabsState, MAX_TABS, MAX_TITLE_LENGTH, relativeTime } from '../../state/discoverTabs';

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
}

export function DiscoverTabs(props: DiscoverTabsProps) {
  const { state, onSelect, onAdd, onDuplicate, onRename, onClose, onMove, onRestore, onClearClosed } = props;
  const styles = useStyles2(getStyles);
  const [editing, setEditing] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const atMax = state.tabs.length >= MAX_TABS;
  const canClose = state.tabs.length > 1;

  const tabMenu = (id: string, index: number) => () => (
    <Menu>
      <Menu.Item label="Rename" icon="pen" onClick={() => setEditing(id)} />
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

  const listMenu = () => (
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
    <div className={styles.strip} role="tablist" aria-label="Discover tabs">
      {state.tabs.map((t, i) => {
        const active = t.id === state.activeId;
        return (
          <div
            key={t.id}
            className={cx(styles.tab, active && styles.active, dragId === t.id && styles.dragging)}
            draggable={editing !== t.id}
            onDragStart={(e) => {
              setDragId(t.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== t.id) {
                e.preventDefault();
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId && dragId !== t.id) {
                onMove(dragId, i);
              }
              setDragId(null);
            }}
            onDragEnd={() => setDragId(null)}
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
            <Dropdown overlay={tabMenu(t.id, i)} placement="bottom-start">
              <IconButton name="ellipsis-v" size="sm" aria-label={`Tab actions: ${t.title}`} />
            </Dropdown>
            {canClose && (
              <IconButton name="times" size="sm" aria-label={`Close tab: ${t.title}`} onClick={() => onClose(t.id)} />
            )}
          </div>
        );
      })}
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
    ref.current?.select();
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
      autoFocus
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
    minHeight: theme.spacing(4),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
    marginBottom: theme.spacing(1),
    overflowX: 'auto',
    flexShrink: 0,
  }),
  tab: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    maxWidth: 240,
    padding: theme.spacing(0.25, 0.5, 0.25, 1),
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
  dragging: css({ opacity: 0.5 }),
  tabButton: css({
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
  spacer: css({ flex: 1 }),
});
