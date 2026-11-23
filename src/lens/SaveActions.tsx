/**
 * Visualize toolbar's Share and Save actions (LENS-SAVE-01 / -02, PARITY-DASHBOARDS).
 *
 * - Share: the same dialog as Discover (absolute time switch, short link) for the chart's link —
 *   the chart, query, filters, data view and time (`VISUALIZE_SHAREABLE_PARAMS`).
 * - Opened from a dashboard panel (Edit in Visualize; the URL names the dashboard and panel):
 *   Kibana's "Cancel" (back to the dashboard unchanged), "Save as new" and "Save and return"
 *   (replace that panel in place). The dashboard is loaded once on entry: its panel title fills
 *   the dialog and its version is the optimistic lock of the save.
 * - Otherwise a single Save opening the usual dialog.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { Button, ConfirmModal, Modal } from '@grafana/ui';
import { getDashboard } from '../data/dashboards';
import { findDashboardPanel } from '../data/panelExport';
import { buildShareUrl, isRelativeRange, VISUALIZE_SHAREABLE_PARAMS } from '../data/shareLink';
import { errMsg } from '../errMsg';
import { ShareLinkModal } from '../components/SessionActions/ShareLinkModal';
import { canCreateDashboards, canViewDashboards } from '../utils/permissions';
import { LensPanel } from './panelExport';
import { lossList, PanelImport } from './panelImport';
import { assertClassicDashboard } from './panelImportLoad';
import { OpenPanelModal } from './OpenPanelModal';
import { dashboardReturnPath, DashboardReturn, readDashboardReturn, VISUALIZE_SOURCE_KEY } from './panelSource';
import { returnSaveError, ReturnTarget, saveAndReturn, SaveLensModal } from './SaveLensModal';

interface Props {
  /** Visualize's URL parameters (string form). */
  paramsKey: string;
  disabled: boolean;
  defaultTitle: string;
  buildPanel: (title: string, description: string) => LensPanel;
  timeRange: TimeRange;
  /** The panel was converted by Edit in Visualize / Open panel: what was not carried over (R6-PANELS). */
  imported?: PanelImport;
  /** The page shows a chart (Open panel replaces it). */
  hasChart?: boolean;
  /** The dashboard panel's title, once loaded. */
  onTitle?: (title: string) => void;
  /** Leaving for the dashboard: the panel's editing session is over. */
  onLeave?: () => void;
}

/** Said in the replace warning once verified (e2e r6-panels): Grafana keeps the replaced version. */
const versionNote = 'Grafana also keeps the previous version of the dashboard in its version history.';

/** The chart's own state in Visualize's URL (the keys a dashboard panel stores; time is not part of it). */
const CHART_KEYS = ['lens', 'q', 'filters', 'ds'];
export const chartStateKey = (paramsKey: string): string => {
  const sp = new URLSearchParams(paramsKey);
  return CHART_KEYS.map((k) => `${k}=${sp.get(k) ?? ''}`).join('&');
};

const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The loaded dashboard + panel for Save and return; an error message when it can't be used. */
export async function loadReturnTarget(ret: DashboardReturn): Promise<ReturnTarget> {
  const { dashboard, meta } = await getDashboard(ret.uid);
  assertClassicDashboard(dashboard);
  const panel = findDashboardPanel(dashboard, ret.panelId);
  if (!panel) {
    throw new Error('The panel is no longer on the dashboard.');
  }
  return {
    ...ret,
    dashboard,
    folderUid: meta.folderUid,
    dashboardTitle: text(dashboard.title, 200) || ret.uid,
    panelTitle: text(panel.title, 200),
    panelDescription: text(panel.description, 2000),
    madeInVisualize: editsInVisualize(panel),
  };
}

/** The panel carries its Visualize state, so replacing it from Visualize is a round trip. */
function editsInVisualize(panel: Record<string, unknown>): boolean {
  return (
    Array.isArray(panel.targets) &&
    panel.targets.some((t) => typeof (t as Record<string, unknown> | null)?.[VISUALIZE_SOURCE_KEY] === 'string')
  );
}

/** Any other panel whose conversion isn't known (failed, or the link has no import marker) may lose everything. */
const UNKNOWN_LOSS = ['The original query and panel settings (they were not read into Visualize)'];

export function SaveActions({ paramsKey, disabled, defaultTitle, buildPanel, timeRange, imported, hasChart, onTitle, onLeave }: Props) {
  const ret = useMemo(() => readDashboardReturn(new URLSearchParams(paramsKey)), [paramsKey]);
  const retKey = ret ? `${ret.uid}:${ret.panelId}` : '';
  const [target, setTarget] = useState<{ key: string; value?: ReturnTarget; error?: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState<null | 'return' | 'new'>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [returning, setReturning] = useState(false);
  const [returnError, setReturnError] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [warnOpen, setWarnOpen] = useState(false);
  const [openPanel, setOpenPanel] = useState(false);
  const canView = useMemo(() => canViewDashboards(), []);
  const canSave = useMemo(() => canCreateDashboards(), []);
  // The chart as it was when the panel opened: Cancel only asks when it has changed since.
  const baseline = useRef<{ key: string; chart: string } | null>(null);
  const paramsRef = useRef(paramsKey);
  useEffect(() => {
    paramsRef.current = paramsKey;
  }, [paramsKey]);
  // Fallback baseline from the URL the panel opened with: when the dashboard can't be loaded (no
  // target, so no baseline below) Cancel must still ask about changes.
  const openedWith = useRef<{ key: string; chart: string } | null>(null);
  useEffect(() => {
    if (retKey && openedWith.current?.key !== retKey) {
      openedWith.current = { key: retKey, chart: chartStateKey(paramsRef.current) };
    }
  }, [retKey]);

  useEffect(() => {
    if (!ret) {
      return;
    }
    let cancelled = false;
    loadReturnTarget(ret).then(
      (value) => {
        if (!cancelled) {
          baseline.current = { key: retKey, chart: chartStateKey(paramsRef.current) };
          setTarget({ key: retKey, value });
          if (value.panelTitle.trim()) {
            onTitle?.(value.panelTitle);
          }
        }
      },
      (e) => !cancelled && setTarget({ key: retKey, error: errMsg(e) })
    );
    return () => {
      cancelled = true;
    };
    // Loaded once per dashboard panel; the time params changing must not reload it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retKey]);

  const loaded = target?.key === retKey ? target : null;
  const returnTarget = loaded?.value;
  // Replacing the panel loses what the chart does not carry over: every replace goes through the
  // warning. Fails safe: without an analysis, only a panel made in Visualize saves directly.
  const loss = useMemo(
    () => (imported ? lossList(imported) : returnTarget && !returnTarget.madeInVisualize ? UNKNOWN_LOSS : []),
    [imported, returnTarget]
  );
  const lossy = loss.length > 0;

  const onCancel = () => {
    if (!ret) {
      return;
    }
    const base =
      baseline.current?.key === retKey
        ? baseline.current.chart
        : openedWith.current?.key === retKey
          ? openedWith.current.chart
          : undefined;
    if (base !== undefined && base !== chartStateKey(paramsKey)) {
      setConfirmCancel(true);
    } else {
      onLeave?.();
      locationService.push(dashboardReturnPath(ret));
    }
  };

  // Save and return in one click: the panel keeps its title and description. A failure (someone
  // else saved the dashboard meanwhile, the panel is gone) opens the dialog with the reason.
  const onSaveAndReturn = async () => {
    if (!returnTarget || !canSave || returning) {
      return;
    }
    setReturning(true);
    try {
      const path = await saveAndReturn(
        returnTarget,
        buildPanel(returnTarget.panelTitle.trim() || defaultTitle, returnTarget.panelDescription)
      );
      onLeave?.();
      locationService.push(path);
    } catch (e) {
      setReturnError(returnSaveError(e));
      setSaveOpen('return');
    } finally {
      setReturning(false);
    }
  };

  const requestReturn = () => {
    if (lossy) {
      setWarnOpen(true);
    } else {
      void onSaveAndReturn();
    }
  };

  return (
    <>
      {canView && (
        <Button size="sm" variant="secondary" icon="folder-open" onClick={() => setOpenPanel(true)}>
          Open panel
        </Button>
      )}
      <Button size="sm" variant="secondary" icon="share-alt" onClick={() => setShareOpen(true)} disabled={disabled}>
        Share
      </Button>
      {ret ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            fill="outline"
            onClick={onCancel}
            tooltip="Back to the dashboard without saving"
          >
            Cancel
          </Button>
          <Button size="sm" variant="secondary" icon="save" onClick={() => setSaveOpen('new')} disabled={disabled}>
            Save as new
          </Button>
          <Button
            size="sm"
            icon="save"
            onClick={requestReturn}
            disabled={disabled || !returnTarget || !canSave || returning}
            tooltip={
              loaded?.error
                ? `Can't save back to the dashboard: ${loaded.error}`
                : !canSave
                  ? 'You do not have permission to save dashboards'
                  : 'Replace the panel on its dashboard and go back'
            }
          >
            Save and return
          </Button>
        </>
      ) : (
        <Button size="sm" icon="save" onClick={() => setSaveOpen('new')} disabled={disabled}>
          Save
        </Button>
      )}
      <SaveLensModal
        isOpen={saveOpen !== null}
        onDismiss={() => setSaveOpen(null)}
        defaultTitle={defaultTitle}
        buildPanel={buildPanel}
        timeRange={timeRange}
        canSaveDashboards={canSave}
        returnTo={returnTarget}
        onReturn={onLeave}
        startAsNew={saveOpen === 'new'}
        initialError={saveOpen === 'return' ? returnError : ''}
        confirmLoss={lossy ? loss : undefined}
        preferSameDashboard={lossy}
      />
      <OpenPanelModal isOpen={openPanel} onDismiss={() => setOpenPanel(false)} hasChart={Boolean(hasChart)} />
      <Modal
        title="Replace the original panel?"
        isOpen={warnOpen}
        onDismiss={() => setWarnOpen(false)}
        
      >
        <p>
          Visualize cannot carry everything from this panel over. Replacing it on the dashboard
          {returnTarget ? ` "${returnTarget.dashboardTitle}"` : ''} permanently removes from the panel:
        </p>
        <ul aria-label="What will be lost">
          {loss.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
        <p>
          Save as new panel adds the chart to the same dashboard and leaves the original panel as it is.
          {versionNote ? ` ${versionNote}` : ''}
        </p>
        <Modal.ButtonRow>
          <Button variant="secondary" fill="outline" onClick={() => setWarnOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              setWarnOpen(false);
              void onSaveAndReturn();
            }}
          >
            Replace anyway
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setWarnOpen(false);
              setSaveOpen('new');
            }}
          >
            Save as new panel
          </Button>
        </Modal.ButtonRow>
      </Modal>
      <ConfirmModal
        isOpen={confirmCancel}
        title="Leave with unsaved changes?"
        body="Your changes to this visualization will be lost."
        confirmText="Discard changes"
        onConfirm={() => {
          setConfirmCancel(false);
          if (ret) {
            onLeave?.();
            locationService.push(dashboardReturnPath(ret));
          }
        }}
        onDismiss={() => setConfirmCancel(false)}
      />
      <ShareLinkModal
        title="Share this visualization"
        isOpen={shareOpen}
        onDismiss={() => setShareOpen(false)}
        relative={isRelativeRange(timeRange)}
        buildUrl={(absolute) => buildShareUrl(window.location.href, timeRange, absolute, VISUALIZE_SHAREABLE_PARAMS)}
      />
    </>
  );
}
