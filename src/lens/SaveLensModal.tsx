/**
 * "Save Lens visualization" (spec LENS-SAVE-01): title, description, add to an existing / new /
 * no dashboard, and optionally to the panel library. "Save and go to dashboard" opens the result.
 *
 * Opened from a dashboard panel (Edit in Visualize, `returnTo` set): Kibana's "Save and return".
 * The dialog starts with the panel's own title / description and replaces that panel in place
 * (same id and position) on its dashboard, then goes back to it with the time range the user had
 * there. "Save as new" switches to the usual destinations.
 */
import React, { useEffect, useId, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2, TimeRange } from '@grafana/data';
import { getAppEvents, locationService } from '@grafana/runtime';
import {
  Alert,
  Button,
  Checkbox,
  Combobox,
  Field,
  Input,
  Modal,
  RadioButtonGroup,
  Spinner,
  Switch,
  TextArea,
  useStyles2,
} from '@grafana/ui';
import { errMsg } from '../errMsg';
import {
  appendPanelsToDashboard,
  buildNewDashboard,
  dashboardTime,
  ExportedPanel,
  replacePanelInDashboard,
} from '../data/panelExport';
import {
  createLibraryPanel,
  dashboardSaveError,
  deleteLibraryPanel,
  getDashboard,
  saveDashboard,
  searchDashboards,
} from '../data/dashboards';
import { LensPanel } from './panelExport';
import { dashboardReturnPath, DashboardReturn } from './panelSource';

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

/** The dashboard panel being edited, as loaded when Visualize opened (Save and return). */
export interface ReturnTarget extends DashboardReturn {
  /** The dashboard JSON as loaded; its `version` is the optimistic lock for the save. */
  dashboard: Record<string, unknown>;
  folderUid?: string;
  dashboardTitle: string;
  panelTitle: string;
  panelDescription: string;
  /** The panel carries its Visualize state (it was saved from here). */
  madeInVisualize?: boolean;
}

/**
 * Save and return: the panel replaces panel `panelId` (same id, same grid position) on the
 * dashboard as it was loaded. The save is not an overwrite: Grafana compares the loaded `version`
 * and refuses with `version-mismatch` if someone saved the dashboard in between. Returns the path
 * back to the dashboard with its time range.
 */
export async function saveAndReturn(target: ReturnTarget, panel: LensPanel): Promise<string> {
  const merged = replacePanelInDashboard(target.dashboard, target.panelId, panel as ExportedPanel);
  await saveDashboard(merged, { folderUid: target.folderUid, overwrite: false });
  return dashboardReturnPath(target);
}

/** The message for a failed Save and return. */
export function returnSaveError(e: unknown): string {
  return e instanceof Error && e.name === 'PanelNotFoundError' ? e.message : dashboardSaveError(e);
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
  /** Opened from a dashboard panel: Save and return replaces it. */
  returnTo?: ReturnTarget;
  /** Start on Save as new (the toolbar's "Save as new") instead of Save and return. */
  startAsNew?: boolean;
  /** Shown when the dialog opens (the toolbar's one-click Save and return failed). */
  initialError?: string;
  /** What replacing the original panel loses (R6-PANELS): shown with a required checkbox. */
  confirmLoss?: string[];
  /** Save as new starts on "Existing dashboard" with the panel's own dashboard. */
  preferSameDashboard?: boolean;
}

export function SaveLensModal({
  isOpen,
  onDismiss,
  defaultTitle,
  buildPanel,
  timeRange,
  canSaveDashboards,
  returnTo,
  startAsNew,
  initialError,
  confirmLoss,
  preferSameDashboard,
}: Props) {
  const styles = useStyles2(getStyles);
  const ids = useId();
  const [title, setTitle] = useState(returnTo?.panelTitle || defaultTitle);
  const [description, setDescription] = useState(returnTo?.panelDescription ?? '');
  const [destination, setDestination] = useState<SaveDestination>('new');
  const [dashboardUid, setDashboardUid] = useState<string | undefined>();
  const [library, setLibrary] = useState(false);
  const [dashboardTitle, setDashboardTitle] = useState(returnTo?.panelTitle || defaultTitle);
  const [titleEdited, setTitleEdited] = useState(false);
  const [options, setOptions] = useState<Array<{ label: string; value: string }> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [asNew, setAsNew] = useState(!returnTo || Boolean(startAsNew));
  const [understood, setUnderstood] = useState(false);

  // Reset each time the modal opens (state adjusted during render, as in AddToDashboardModal).
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      // From a dashboard panel, the dialog keeps the panel's own title (not a generated one).
      const start = returnTo?.panelTitle || defaultTitle;
      setAsNew(!returnTo || Boolean(startAsNew));
      setTitle(start);
      setDescription(returnTo?.panelDescription ?? '');
      const same = Boolean(preferSameDashboard && returnTo && startAsNew && canSaveDashboards);
      setUnderstood(false);
      setDestination(same ? 'existing' : canSaveDashboards ? 'new' : 'none');
      setDashboardUid(same ? returnTo?.uid : undefined);
      setLibrary(false);
      setDashboardTitle(start);
      setTitleEdited(false);
      setOptions(null);
      setLoadError('');
      setError(initialError ?? '');
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
        setOptions(
          hits.map((h) => ({ label: h.folderTitle ? `${h.folderTitle} / ${h.title}` : h.title, value: h.uid }))
        ),
      (e) => !cancelled && setLoadError(errMsg(e))
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, destination, options, loadError]);

  const toDashboard = destination !== 'none';
  const replacing = Boolean(returnTo) && !asNew;
  const needsConfirm = Boolean(confirmLoss && confirmLoss.length > 0);
  const canReturn = !saving && Boolean(title.trim()) && canSaveDashboards && (!needsConfirm || understood);
  const canSave =
    !saving &&
    Boolean(title.trim()) &&
    (toDashboard
      ? canSaveDashboards && (destination === 'new' ? Boolean(dashboardTitle.trim()) : Boolean(dashboardUid))
      : library);

  const onSaveAndReturn = async () => {
    if (!returnTo) {
      return;
    }
    setSaving(true);
    setError('');
    try {
      const path = await saveAndReturn(returnTo, buildPanel(title.trim(), description));
      onDismiss();
      locationService.push(path);
    } catch (e) {
      setError(returnSaveError(e));
    } finally {
      setSaving(false);
    }
  };

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
        getAppEvents().publish({
          type: AppEvents.alertSuccess.name,
          payload: [`Saved "${title.trim()}" to the panel library`],
        });
      }
    } catch (e) {
      setError(dashboardSaveError(e, destination === 'new' ? dashboardTitle.trim() || title.trim() : undefined));
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
        <TextArea
          id={`${ids}-desc`}
          value={description}
          rows={2}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </Field>
      {replacing && returnTo && (
        <Alert title="Save and return" severity="info" className={styles.alert}>
          Replaces this panel on the dashboard &quot;{returnTo.dashboardTitle}&quot; (same place and size), then goes
          back to the dashboard.
        </Alert>
      )}
      {replacing && needsConfirm && (
        <Alert title="This replaces the original panel with a different one" severity="warning" className={styles.alert}>
          <ul>
            {confirmLoss?.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <Checkbox
            label="Replace the original panel anyway"
            value={understood}
            onChange={(e) => setUnderstood(e.currentTarget.checked)}
          />
        </Alert>
      )}
      {!replacing && (
        <>
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
      <Field
        label="Add to library"
        description="Save as a library panel that other dashboards can reuse"
        htmlFor={`${ids}-lib`}
      >
        <Switch id={`${ids}-lib`} value={library} onChange={(e) => setLibrary(e.currentTarget.checked)} />
      </Field>
        </>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDismiss} disabled={saving}>
          Cancel
        </Button>
        {returnTo && (
          <Button variant="secondary" onClick={() => setAsNew((v) => !v)} disabled={saving}>
            {replacing ? 'Save as new' : 'Back to Save and return'}
          </Button>
        )}
        {replacing ? (
          <Button variant="primary" onClick={onSaveAndReturn} disabled={!canReturn}>
            {saving ? <Spinner size="sm" inline /> : 'Save and return'}
          </Button>
        ) : (
          <Button variant="primary" onClick={onSave} disabled={!canSave}>
            {saving ? <Spinner size="sm" inline /> : toDashboard ? 'Save and go to dashboard' : 'Save to library'}
          </Button>
        )}
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
