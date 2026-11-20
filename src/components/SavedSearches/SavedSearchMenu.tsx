import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Button, Checkbox, ConfirmModal, Field, Icon, Input, Modal, useStyles2 } from '@grafana/ui';
import { SavedSearch, LogsQueryState } from '../../types';
import {
  deleteSearch,
  deleteSharedSearch,
  loadLocalSearches,
  loadSharedSearches,
  parseTags,
  savedSearchTimeRange,
  saveSearch,
  saveSharedSearch,
} from '../../data/savedSearches';

interface SavedSearchMenuProps {
  queryState: LogsQueryState;
  timeRange: TimeRange;
  onLoad: (search: SavedSearch, newTimeRange?: TimeRange) => void;
  /** A search was just saved (shared or browser-only): it becomes the open saved search. */
  onSaved?: (search: SavedSearch) => void;
  /** Active data view ID; used to scope saved searches. Undefined = show all (legacy). */
  activeDataViewId?: string;
}

export function SavedSearchMenu({ queryState, timeRange, onLoad, onSaved, activeDataViewId }: SavedSearchMenuProps) {
  const styles = useStyles2(getStyles);
  const [open, setOpen] = useState(false);
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveTags, setSaveTags] = useState('');
  const [saveNote, setSaveNote] = useState('');
  // Default on: a saved search has always carried its time range (Kibana defaults to off).
  const [storeTime, setStoreTime] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Re-reads localStorage (an external source, not React state) each time the menu opens,
  // so saved/deleted searches from other tabs/components show up on next open.
  // Shared searches (Grafana dashboards) and browser-only ones are re-read each time the menu opens.
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const visible = (all: SavedSearch[]) =>
      activeDataViewId ? all.filter((s) => !s.dataViewId || s.dataViewId === activeDataViewId) : all;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearches(visible(loadLocalSearches()));
    loadSharedSearches().then((shared) => {
      if (!cancelled) {
        setSearches(visible([...shared, ...loadLocalSearches()]));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeDataViewId]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleSave() {
    const name = saveName.trim();
    if (!name || saving) {
      return;
    }
    const entry = {
      name,
      description: saveDescription.trim() || undefined,
      tags: parseTags(saveTags),
      search: queryState.search,
      filters: queryState.filters,
      columns: queryState.columns,
      sort: queryState.sort,
      ...(storeTime
        ? {
            timeRange: {
              from: typeof timeRange.raw.from === 'string' ? timeRange.raw.from : String(timeRange.from.valueOf()),
              to: typeof timeRange.raw.to === 'string' ? timeRange.raw.to : String(timeRange.to.valueOf()),
            },
          }
        : {}),
    };
    setSaving(true);
    try {
      const saved = await saveSharedSearch(entry, activeDataViewId);
      onSaved?.(saved);
      setSaveNote('');
      closeSave();
    } catch {
      // The viewer cannot create dashboards: keep it in this browser and say so.
      onSaved?.(saveSearch(entry, activeDataViewId));
      setSaveNote('You cannot create dashboards, so the search was saved in this browser only.');
      closeSave(true);
    } finally {
      setSaving(false);
    }
  }

  function closeSave(keepNote = false) {
    setSaveName('');
    setSaveDescription('');
    setSaveTags('');
    setStoreTime(true);
    if (!keepNote) {
      setSaveNote('');
    }
    setSaveModalOpen(false);
  }

  function handleLoad(s: SavedSearch) {
    onLoad(s, savedSearchTimeRange(s));
    setOpen(false);
  }

  async function handleDelete(id: string) {
    const target = searches.find((s) => s.id === id);
    try {
      if (target?.sharedUid) {
        await deleteSharedSearch(target.sharedUid);
      } else {
        deleteSearch(id);
      }
      setSearches((prev) => prev.filter((s) => s.id !== id));
      setDeleteError('');
    } catch {
      setDeleteError('Could not delete the shared search (you may lack permission).');
    }
    setDeleteId(null);
  }

  return (
    <div className={styles.wrapper} ref={menuRef}>
      {/* A menu, not a status: secondary style, a folder icon, a caret and the full name. No
          tooltip — the label says it all, and a tooltip would cover the open menu's "Save current". */}
      <Button
        variant="secondary"
        size="sm"
        icon="folder-open"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        Saved searches <Icon name={open ? 'angle-up' : 'angle-down'} />
      </Button>

      {open && (
        <div className={styles.dropdown}>
          <div className={styles.dropdownHeader}>
            <span className={styles.dropdownTitle}>Saved searches</span>
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={() => {
                setSaveModalOpen(true);
                setOpen(false);
              }}
            >
              Save current
            </Button>
          </div>
          {deleteError && <div className={styles.empty}>{deleteError}</div>}
          {saveNote && <div className={styles.empty}>{saveNote}</div>}
          {searches.length === 0 && (
            <div className={styles.empty}>No saved searches yet</div>
          )}
          {searches.map((s) => (
            <div key={s.id} className={styles.item}>
              <button className={styles.itemName} onClick={() => handleLoad(s)}>
                <Icon name="search" size="sm" />
                <span title={s.description}>
                  {s.name}
                  {s.sharedUid ? '' : ' (this browser)'}
                  {s.tags?.length ? <span className={styles.tags}> {s.tags.map((t) => `#${t}`).join(' ')}</span> : null}
                </span>
              </button>
              <button
                className={styles.deleteBtn}
                title="Delete"
                aria-label={`Delete saved search ${s.name}`}
                onClick={() => setDeleteId(s.id)}
              >
                <Icon name="trash-alt" size="xs" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal
        title="Save search"
        isOpen={saveModalOpen}
        onDismiss={() => closeSave()}
      >
        <div className={styles.saveForm}>
          <div className={styles.hint}>
            Saved for everyone who can view dashboards (stored as a tagged Grafana dashboard).
          </div>
          <Input
            placeholder="Search name"
            aria-label="Search name"
            value={saveName}
            onChange={(e) => setSaveName(e.currentTarget.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') { handleSave(); } }}
          />
          <Field label="Description">
            <Input
              value={saveDescription}
              maxLength={1000}
              onChange={(e) => setSaveDescription(e.currentTarget.value)}
              aria-label="Search description"
            />
          </Field>
          <Field label="Tags" description="Comma separated">
            <Input value={saveTags} onChange={(e) => setSaveTags(e.currentTarget.value)} aria-label="Search tags" />
          </Field>
          <Checkbox
            label="Store time range"
            description="Opening the search then sets this time range; otherwise it keeps the current one."
            value={storeTime}
            onChange={(e) => setStoreTime(e.currentTarget.checked)}
          />
          <div className={styles.saveActions}>
            <Button variant="secondary" onClick={() => closeSave()}>Cancel</Button>
            <Button variant="primary" disabled={!saveName.trim() || saving} onClick={handleSave}>Save</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={deleteId !== null}
        title="Delete saved search"
        body="This cannot be undone."
        confirmText="Delete"

        onConfirm={() => { if (deleteId) { handleDelete(deleteId); } }}
        onDismiss={() => setDeleteId(null)}
      />
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrapper: css`
    position: relative;
  `,
  dropdown: css`
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 260px;
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z2};
    z-index: 100;
    overflow: hidden;
  `,
  dropdownHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: ${theme.spacing(1)} ${theme.spacing(1.5)};
    border-bottom: 1px solid ${theme.colors.border.weak};
  `,
  dropdownTitle: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.secondary};
  `,
  empty: css`
    padding: ${theme.spacing(2)};
    text-align: center;
    color: ${theme.colors.text.disabled};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  item: css`
    display: flex;
    align-items: center;
    border-bottom: 1px solid ${theme.colors.border.weak};
    &:last-child { border-bottom: none; }
    &:hover { background: ${theme.colors.action.hover}; }
  `,
  itemName: css`
    flex: 1;
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(0.75)} ${theme.spacing(1.5)};
    background: transparent;
    border: none;
    cursor: pointer;
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
    text-align: left;
  `,
  deleteBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: ${theme.spacing(0.75)};
    color: ${theme.colors.text.disabled};
    &:hover { color: ${theme.colors.error.text}; }
  `,
  hint: css`
    margin: 0;
  `,
  tags: css`
    color: ${theme.colors.text.secondary};
  `,
  saveForm: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(2)};
  `,
  saveActions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
  `,
});
