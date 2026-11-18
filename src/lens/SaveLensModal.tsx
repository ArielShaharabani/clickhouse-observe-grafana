/**
 * "Save Lens visualization" (spec LENS-SAVE-01): title, description, add to an existing / new /
 * no dashboard, and optionally to the panel library. "Save and go to dashboard" opens the result.
 */
import React, { useEffect, useId, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2, TimeRange } from '@grafana/data';
import { getAppEvents, locationService } from '@grafana/runtime';
import { Alert, Button, Combobox, Field, Input, Modal, RadioButtonGroup, Spinner, Switch, TextArea, useStyles2 } from '@grafana/ui';
import { errMsg } from '../errMsg';
import { appendPanelsToDashboard, buildNewDashboard, ExportedPanel } from '../data/panelExport';
import { createLibraryPanel, deleteLibraryPanel, getDashboard, saveDashboard, searchDashboards } from '../data/dashboards';
import { LensPanel } from './panelExport';

export type SaveDestination = 'existing' | 'new' | 'none';

export interface SaveLensRequest {
  panel: LensPanel;
  destination: SaveDestination;
  dashboardUid?: string;
  /** Title of a new dashboard (default: the panel title). */
  dashboardTitle?: string;
  library: boolean;
  timeRange: TimeRange;
}

/** Time of a new dashboard: the range the chart was built on, relative strings kept. */
function dashboardTime(r: TimeRange): { from: string; to: string } {
  const raw = (v: unknown, d: { toISOString: () => string }) => (typeof v === 'string' ? v : d.toISOString());
  return { from: raw(r.raw.from, r.from), to: raw(r.raw.to, r.to) };
}

/**
 * Saves the panel: to the library first (when asked), then onto the dashboard — as a reference
 * to the library panel when one was created. If the dashboard save fails, the library panel just
 * created is deleted again, so a retry doesn't hit "name already exists". Returns the dashboard URL.
 */
export async function saveLens(req: SaveLensRequest): Promise<{ url?: string }> {
  const { panel, destination } = req;
  const { id, gridPos, ...model } = panel;
  const ref = req.library ? await createLibraryPanel(panel.title, model) : undefined;
  if (destination === 'none') {
    return {};
  }
  const onDashboard = (ref ? { id, gridPos, title: panel.title, libraryPanel: ref } : panel) as ExportedPanel;
  try {
    if (destination === 'new') {
      const title = req.dashboardTitle?.trim() || panel.title;
      const dash = { ...buildNewDashboard([onDashboard], title), time: dashboardTime(req.timeRange) };
      return { url: (await saveDashboard(dash)).url };
    }
    const existing = await getDashboard(req.dashboardUid as string);
    const merged = appendPanelsToDashboard(existing.dashboard, [onDashboard]);
    return { url: (await saveDashboard(merged, { folderUid: existing.meta.folderUid, overwrite: true })).url };
  } catch (e) {
    if (ref) {
      await deleteLibraryPanel(ref.uid).catch(() => undefined);
    }
    throw e;
  }
}

interface Props {
  isOpen: boolean;
  onDismiss: () => void;
  defaultTitle: string;
  /** Builds the panel with the chosen title / description. */
  buildPanel: (title: string, description: string) => LensPanel;
  timeRange: TimeRange;
  canSaveDashboards: boolean;
}

export function SaveLensModal({ isOpen, onDismiss, defaultTitle, buildPanel, timeRange, canSaveDashboards }: Props) {
  const styles = useStyles2(getStyles);
  const ids = useId();
  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [destination, setDestination] = useState<SaveDestination>('new');
  const [dashboardUid, setDashboardUid] = useState<string | undefined>();
  const [library, setLibrary] = useState(false);
  const [dashboardTitle, setDashboardTitle] = useState(defaultTitle);
  const [titleEdited, setTitleEdited] = useState(false);
  const [options, setOptions] = useState<Array<{ label: string; value: string }> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset each time the modal opens (state adjusted during render, as in AddToDashboardModal).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTitle(defaultTitle);
      setDescription('');
      setDestination(canSaveDashboards ? 'new' : 'none');
      setDashboardUid(undefined);
      setLibrary(false);
      setDashboardTitle(defaultTitle);
      setTitleEdited(false);
      setOptions(null);
      setLoadError('');
      setError('');
    }
  }

  useEffect(() => {
    if (!isOpen || destination !== 'existing' || options !== null || loadError) {
      return;
    }
    let cancelled = false;
    searchDashboards().then(
      (hits) =>
        !cancelled &&
        setOptions(hits.map((h) => ({ label: h.folderTitle ? `${h.folderTitle} / ${h.title}` : h.title, value: h.uid }))),
      (e) => !cancelled && setLoadError(errMsg(e))
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, destination, options, loadError]);

  const toDashboard = destination !== 'none';
  const canSave =
    !saving &&
    Boolean(title.trim()) &&
    (toDashboard
      ? canSaveDashboards && (destination === 'new' ? Boolean(dashboardTitle.trim()) : Boolean(dashboardUid))
      : library);

  const onSave = async () => {
    setSaving(true);
    setError('');
    try {
      const { url } = await saveLens({
        panel: buildPanel(title.trim(), description),
        destination,
        dashboardUid,
        dashboardTitle,
        library,
        timeRange,
      });
      onDismiss();
      if (url) {
        locationService.push(url);
      } else {
        getAppEvents().publish({ type: AppEvents.alertSuccess.name, payload: [`Saved "${title.trim()}" to the panel library`] });
      }
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Save Lens visualization" isOpen={isOpen} onDismiss={onDismiss}>
      {error && (
        <Alert title="Save failed" severity="error" className={styles.alert}>
          {error}
        </Alert>
      )}
      <Field label="Title" required htmlFor={`${ids}-title`}>
        <Input
          id={`${ids}-title`}
          value={title}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setTitle(v);
            if (!titleEdited) {
              setDashboardTitle(v);
            }
          }}
          autoFocus
        />
      </Field>
      <Field label="Description" description="Optional" htmlFor={`${ids}-desc`}>
        <TextArea id={`${ids}-desc`} value={description} rows={2} onChange={(e) => setDescription(e.currentTarget.value)} />
      </Field>
      <Field
        label="Add to dashboard"
        description={canSaveDashboards ? undefined : 'You do not have permission to save dashboards.'}
      >
        <RadioButtonGroup
          value={destination}
          onChange={(v) => setDestination(v as SaveDestination)}
          options={[
            { label: 'Existing', value: 'existing', disabled: !canSaveDashboards },
            { label: 'New', value: 'new', disabled: !canSaveDashboards },
            { label: 'None', value: 'none' },
          ]}
        />
      </Field>
      {destination === 'new' && (
        <Field label="Dashboard title" required htmlFor={`${ids}-dtitle`}>
          <Input
            id={`${ids}-dtitle`}
            value={dashboardTitle}
            onChange={(e) => {
              setDashboardTitle(e.currentTarget.value);
              setTitleEdited(true);
            }}
          />
        </Field>
      )}
      {destination === 'existing' && (
        <Field label="Select dashboard" required htmlFor={`${ids}-dash`}>
          {loadError ? (
            <Alert title="Failed to load dashboards" severity="error" className={styles.alert}>
              {loadError}{' '}
              <Button size="sm" variant="secondary" fill="text" onClick={() => setLoadError('')}>
                Retry
              </Button>
            </Alert>
          ) : options === null ? (
            <Spinner size="sm" />
          ) : (
            <Combobox
              id={`${ids}-dash`}
              options={options}
              value={dashboardUid ?? null}
              onChange={(o) => setDashboardUid(o?.value)}
              placeholder="Select dashboard…"
            />
          )}
        </Field>
      )}
      <Field label="Add to library" description="Save as a library panel that other dashboards can reuse" htmlFor={`${ids}-lib`}>
        <Switch id={`${ids}-lib`} value={library} onChange={(e) => setLibrary(e.currentTarget.checked)} />
      </Field>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDismiss} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onSave} disabled={!canSave}>
          {saving ? <Spinner size="sm" inline /> : toDashboard ? 'Save and go to dashboard' : 'Save to library'}
        </Button>
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  alert: css`
    margin-bottom: ${theme.spacing(2)};
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(2)};
  `,
});
