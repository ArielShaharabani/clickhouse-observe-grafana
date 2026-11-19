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
import React, { useEffect, useMemo, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { Button } from '@grafana/ui';
import { getDashboard } from '../data/dashboards';
import { findDashboardPanel } from '../data/panelExport';
import { buildShareUrl, isRelativeRange, VISUALIZE_SHAREABLE_PARAMS } from '../data/shareLink';
import { errMsg } from '../errMsg';
import { ShareLinkModal } from '../components/SessionActions/ShareLinkModal';
import { canCreateDashboards } from '../utils/permissions';
import { LensPanel } from './panelExport';
import { dashboardReturnPath, DashboardReturn, readDashboardReturn } from './panelSource';
import { ReturnTarget, SaveLensModal } from './SaveLensModal';

interface Props {
  /** Visualize's URL parameters (string form). */
  paramsKey: string;
  disabled: boolean;
  defaultTitle: string;
  buildPanel: (title: string, description: string) => LensPanel;
  timeRange: TimeRange;
}

const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

/** The loaded dashboard + panel for Save and return; an error message when it can't be used. */
export async function loadReturnTarget(ret: DashboardReturn): Promise<ReturnTarget> {
  const { dashboard, meta } = await getDashboard(ret.uid);
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
  };
}

export function SaveActions({ paramsKey, disabled, defaultTitle, buildPanel, timeRange }: Props) {
  const ret = useMemo(() => readDashboardReturn(new URLSearchParams(paramsKey)), [paramsKey]);
  const retKey = ret ? `${ret.uid}:${ret.panelId}` : '';
  const [target, setTarget] = useState<{ key: string; value?: ReturnTarget; error?: string } | null>(null);
  const [saveOpen, setSaveOpen] = useState<null | 'return' | 'new'>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const canSave = useMemo(() => canCreateDashboards(), []);

  useEffect(() => {
    if (!ret) {
      return;
    }
    let cancelled = false;
    loadReturnTarget(ret).then(
      (value) => !cancelled && setTarget({ key: retKey, value }),
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

  return (
    <>
      <Button size="sm" variant="secondary" icon="share-alt" onClick={() => setShareOpen(true)} disabled={disabled}>
        Share
      </Button>
      {ret ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            fill="outline"
            onClick={() => locationService.push(dashboardReturnPath(ret))}
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
            onClick={() => setSaveOpen('return')}
            disabled={disabled || !returnTarget || !canSave}
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
        startAsNew={saveOpen === 'new'}
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
