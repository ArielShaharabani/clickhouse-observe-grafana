/**
 * Query menu (DISC-SEARCH-03): the ⋮ button left of the query input. Apply to all (enable /
 * disable / pin / unpin / invert every filter), Clear all (query + filters), Load query, Save query
 * (query + optional filters + optional time range) and Manage saved queries. There is no query
 * language switch: queries are always KQL (Lucene is not implemented).
 */

import React, { useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, GrafanaTheme2, TimeRange } from '@grafana/data';
import {
  Button,
  ConfirmModal,
  Dropdown,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  Switch,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { FilterPill } from '../../types';
import { resolveRange } from '../../utils/timeZone';
import {
  addSavedQuery,
  deleteSavedQuery,
  loadSavedQueries,
  SavedQuery,
  SavedQueryInput,
  savedQueryNameTaken,
  updateSavedQuery,
} from '../../data/savedQueries';
import { applicableActions, applyToAll, applyToAllPins, ApplyToAllAction } from '../../state/queryMenu';

export interface LoadedQuery {
  query: string;
  /** Undefined = the saved query did not include filters (keep the current ones). */
  filters?: FilterPill[];
  timeRange?: TimeRange;
}

interface QueryMenuProps {
  query: string;
  filters: FilterPill[];
  timeRange: TimeRange;
  /** Active data view id: saved queries are scoped to it (plus view-less ones). */
  dataViewId?: string;
  /** `database.table` of the active view, for pins (D7). */
  pinTable: string;
  onFiltersChange: (filters: FilterPill[]) => void;
  /** Clear the query and every filter on this page. */
  onClearAll: () => void;
  onLoadQuery: (loaded: LoadedQuery) => void;
}

const APPLY_LABEL: Record<ApplyToAllAction, string> = {
  enable: 'Enable all',
  disable: 'Disable all',
  pin: 'Pin all',
  unpin: 'Unpin all',
  invert: 'Invert inclusion',
};

const APPLY_ICON: Record<ApplyToAllAction, 'eye' | 'eye-slash' | 'gf-pin' | 'times' | 'exchange-alt'> = {
  enable: 'eye',
  disable: 'eye-slash',
  pin: 'gf-pin',
  unpin: 'times',
  invert: 'exchange-alt',
};

/** Raw bound as stored: relative strings as-is, absolute ones as epoch milliseconds. */
function rawBound(raw: unknown, resolved: { valueOf(): number }): string {
  return typeof raw === 'string' ? raw : String(resolved.valueOf());
}

/** Stored bounds → TimeRange; undefined when they don't parse. */
export function toTimeRange(t: { from: string; to: string }): TimeRange | undefined {
  try {
    const toRaw = (v: string) => (v.startsWith('now') ? v : dateTime(Number(v)));
    const range = resolveRange({ from: toRaw(t.from), to: toRaw(t.to) });
    return range.from.isValid() && range.to.isValid() ? range : undefined;
  } catch {
    return undefined;
  }
}

type SaveMode = { kind: 'new' } | { kind: 'update'; target: SavedQuery };

export function QueryMenu({
  query,
  filters,
  timeRange,
  dataViewId,
  pinTable,
  onFiltersChange,
  onClearAll,
  onLoadQuery,
}: QueryMenuProps) {
  const styles = useStyles2(getStyles);
  // The saved query last loaded on this page: "Save changes" updates it, "Save as new" forks it.
  const [loaded, setLoaded] = useState<SavedQuery | null>(null);
  const [saveMode, setSaveMode] = useState<SaveMode | null>(null);
  const [manageOpen, setManageOpen] = useState(false);
  // Re-read on every menu open (storage is shared with other tabs).
  const [saved, setSaved] = useState<SavedQuery[]>([]);

  const refresh = () => setSaved(loadSavedQueries(dataViewId));

  const apply = (action: ApplyToAllAction) => {
    const next = applyToAll(filters, action);
    applyToAllPins(filters, next, action, pinTable);
    onFiltersChange(next);
  };

  const load = (q: SavedQuery) => {
    setLoaded(q);
    onLoadQuery({
      query: q.query,
      filters: q.filters,
      timeRange: q.timeRange ? toTimeRange(q.timeRange) : undefined,
    });
  };

  const menu = () => {
    const actions = applicableActions(filters);
    return (
      <Menu ariaLabel="Query menu">
        {actions.length > 0 && (
          <Menu.Item
            label="Apply to all"
            icon="filter"
            childItems={actions.map((a) => (
              <Menu.Item key={a} label={APPLY_LABEL[a]} icon={APPLY_ICON[a]} onClick={() => apply(a)} />
            ))}
          />
        )}
        <Menu.Item
          label="Clear all"
          icon="trash-alt"
          disabled={!query && filters.length === 0}
          onClick={() => {
            setLoaded(null);
            onClearAll();
          }}
        />
        <Menu.Divider />
        <Menu.Item
          label="Load query"
          icon="folder-open"
          disabled={saved.length === 0}
          childItems={saved.map((q) => (
            <Menu.Item
              key={q.id}
              label={q.name}
              description={q.description}
              active={loaded?.id === q.id}
              onClick={() => load(q)}
            />
          ))}
        />
        {loaded && saved.some((q) => q.id === loaded.id) && (
          <Menu.Item
            label={`Save changes to "${loaded.name}"`}
            icon="save"
            onClick={() => setSaveMode({ kind: 'update', target: loaded })}
          />
        )}
        <Menu.Item
          label={loaded ? 'Save as new query' : 'Save query'}
          icon="save"
          disabled={!query && filters.length === 0}
          onClick={() => setSaveMode({ kind: 'new' })}
        />
        <Menu.Item
          label="Manage saved queries"
          icon="cog"
          disabled={saved.length === 0}
          onClick={() => setManageOpen(true)}
        />
      </Menu>
    );
  };

  return (
    <>
      <Dropdown
        overlay={menu}
        placement="bottom-start"
        onVisibleChange={(visible) => {
          if (visible) {
            refresh();
          }
        }}
      >
        <IconButton
          name="ellipsis-v"
          size="lg"
          tooltip="Query menu"
          aria-label="Query menu"
          className={styles.trigger}
        />
      </Dropdown>

      {saveMode && (
        <SaveQueryModal
          mode={saveMode}
          dataViewId={dataViewId}
          hasFilters={filters.length > 0}
          onDismiss={() => setSaveMode(null)}
          onSave={(meta) => {
            const input: SavedQueryInput = {
              name: meta.name,
              ...(meta.description ? { description: meta.description } : {}),
              query,
              ...(meta.includeFilters ? { filters } : {}),
              ...(meta.includeTime
                ? {
                    timeRange: {
                      from: rawBound(timeRange.raw.from, timeRange.from),
                      to: rawBound(timeRange.raw.to, timeRange.to),
                    },
                  }
                : {}),
              ...(dataViewId ? { dataViewId } : {}),
            };
            if (saveMode.kind === 'update') {
              if (updateSavedQuery(saveMode.target.id, input)) {
                setLoaded({ ...saveMode.target, ...input });
              }
            } else {
              const entry = addSavedQuery(input);
              if (entry) {
                setLoaded(entry);
              }
            }
            setSaveMode(null);
          }}
        />
      )}

      {manageOpen && (
        <ManageSavedQueriesModal
          dataViewId={dataViewId}
          onDismiss={() => setManageOpen(false)}
          onDeleted={(id) => {
            if (loaded?.id === id) {
              setLoaded(null);
            }
          }}
        />
      )}
    </>
  );
}

interface SaveMeta {
  name: string;
  description: string;
  includeFilters: boolean;
  includeTime: boolean;
}

function SaveQueryModal({
  mode,
  dataViewId,
  hasFilters,
  onDismiss,
  onSave,
}: {
  mode: SaveMode;
  dataViewId?: string;
  hasFilters: boolean;
  onDismiss: () => void;
  onSave: (meta: SaveMeta) => void;
}) {
  const styles = useStyles2(getStyles);
  const target = mode.kind === 'update' ? mode.target : null;
  const [name, setName] = useState(target?.name ?? '');
  const [description, setDescription] = useState(target?.description ?? '');
  const [includeFilters, setIncludeFilters] = useState(target ? target.filters !== undefined : hasFilters);
  const [includeTime, setIncludeTime] = useState(target ? target.timeRange !== undefined : false);
  const trimmed = name.trim();
  const conflict = trimmed !== '' && savedQueryNameTaken(trimmed, dataViewId, target?.id);
  const canSave = trimmed !== '' && !conflict;

  return (
    <Modal title={target ? `Save changes to "${target.name}"` : 'Save query'} isOpen onDismiss={onDismiss}>
      <div className={styles.form}>
        <Field
          label="Name"
          invalid={conflict}
          error={conflict ? 'Name conflicts with an existing saved query' : undefined}
        >
          <Input
            aria-label="Saved query name"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && canSave) {
                onSave({ name: trimmed, description: description.trim(), includeFilters, includeTime });
              }
            }}
          />
        </Field>
        <Field label="Description">
          <TextArea
            aria-label="Saved query description"
            value={description}
            maxLength={1000}
            rows={2}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </Field>
        <Field label="Include filters" horizontal>
          <Switch
            aria-label="Include filters"
            value={includeFilters}
            onChange={(e) => setIncludeFilters(e.currentTarget.checked)}
          />
        </Field>
        <Field label="Include time filter" horizontal>
          <Switch
            aria-label="Include time filter"
            value={includeTime}
            onChange={(e) => setIncludeTime(e.currentTarget.checked)}
          />
        </Field>
        <Modal.ButtonRow>
          <Button variant="secondary" fill="outline" onClick={onDismiss}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() => onSave({ name: trimmed, description: description.trim(), includeFilters, includeTime })}
          >
            Save
          </Button>
        </Modal.ButtonRow>
      </div>
    </Modal>
  );
}

function ManageSavedQueriesModal({
  dataViewId,
  onDismiss,
  onDeleted,
}: {
  dataViewId?: string;
  onDismiss: () => void;
  onDeleted: (id: string) => void;
}) {
  const styles = useStyles2(getStyles);
  const [queries, setQueries] = useState<SavedQuery[]>(() => loadSavedQueries(dataViewId));
  const [deleting, setDeleting] = useState<SavedQuery | null>(null);

  return (
    <Modal title="Saved queries" isOpen onDismiss={onDismiss}>
      {queries.length === 0 ? (
        <div className={styles.empty}>No saved queries</div>
      ) : (
        <ul className={styles.list} aria-label="Saved queries">
          {queries.map((q) => (
            <li key={q.id} className={styles.row}>
              <div className={styles.rowText}>
                <div className={styles.rowName}>{q.name}</div>
                <div className={styles.rowMeta}>
                  {q.query || '(empty query)'}
                  {q.filters ? ` · ${q.filters.length} filter${q.filters.length === 1 ? '' : 's'}` : ''}
                  {q.timeRange ? ' · time range' : ''}
                </div>
              </div>
              <IconButton
                name="trash-alt"
                aria-label={`Delete ${q.name}`}
                tooltip="Delete"
                onClick={() => setDeleting(q)}
              />
            </li>
          ))}
        </ul>
      )}
      <ConfirmModal
        isOpen={deleting !== null}
        title="Delete saved query"
        body={deleting ? `Delete "${deleting.name}"? This cannot be undone.` : ''}
        confirmText="Delete"
        onConfirm={() => {
          if (deleting) {
            deleteSavedQuery(deleting.id);
            onDeleted(deleting.id);
            setQueries(loadSavedQueries(dataViewId));
          }
          setDeleting(null);
        }}
        onDismiss={() => setDeleting(null)}
      />
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  trigger: css({ margin: theme.spacing(0, 0.5) }),
  form: css({ display: 'flex', flexDirection: 'column' }),
  empty: css({ color: theme.colors.text.secondary, padding: theme.spacing(2), textAlign: 'center' }),
  list: css({ listStyle: 'none', margin: 0, padding: 0 }),
  row: css({
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1, 0),
    borderBottom: `1px solid ${theme.colors.border.weak}`,
  }),
  rowText: css({ flex: 1, minWidth: 0 }),
  rowName: css({ fontWeight: theme.typography.fontWeightMedium }),
  rowMeta: css({
    color: theme.colors.text.secondary,
    fontSize: theme.typography.bodySmall.fontSize,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }),
});
