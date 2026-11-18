/**
 * DISC-SESSION-01: Discover's Share button and ⋮ overflow menu (spec 10-discover.md "Save, share,
 * export, overflow"). Saving lives in the Saved searches menu next to it.
 *
 * - Share → modal "Share this Discover session": `Use absolute time range` toggle, an unsaved-changes
 *   warning, and Copy link (shareLink.ts — codec parameters only).
 * - ⋮ → New session, Export tab results (CSV), Inspect (the diagnostics drawer), Create alert rule.
 */
import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { AppEvents, GrafanaTheme2, TimeRange } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { Alert, Button, ClipboardButton, Dropdown, Field, Input, Menu, Modal, Switch, useStyles2 } from '@grafana/ui';
import { LogsQueryState, SourceConfig } from '../../types';
import { FieldIndex } from '../../sql/fields';
import { buildLogsQuery } from '../../sql/queryBuilder';
import { runQueryRows } from '../../data/runQuery';
import { loadSavedSearches } from '../../data/savedSearches';
import { buildShareUrl, hasUnsavedChanges, isRelativeRange } from '../../data/shareLink';
import { CSV_EXPORT_LIMIT, csvFileName, downloadCsv, rowsToCsv } from '../../data/csvExport';
import { buildAlertRuleUrl } from '../../data/alertRule';
import { canCreateAlertRules } from '../../utils/permissions';

export interface SessionActionsProps {
  config: SourceConfig;
  /** Current query state with the grid's effective columns. */
  queryState: LogsQueryState;
  /** The user's own column choice (`[]` = view defaults), as Saved searches store it — used for the
   *  unsaved-changes check. Defaults to `queryState.columns`. */
  rawColumns?: LogsQueryState['columns'];
  timeRange: TimeRange;
  index?: FieldIndex;
  viewId?: string;
  viewName?: string;
  onOpenDiagnostics: () => void;
}

function notify(type: 'success' | 'error', text: string) {
  getAppEvents().publish({
    type: type === 'success' ? AppEvents.alertSuccess.name : AppEvents.alertError.name,
    payload: [text],
  });
}

export function SessionActions({
  config,
  queryState,
  rawColumns,
  timeRange,
  index,
  viewId,
  viewName,
  onOpenDiagnostics,
}: SessionActionsProps) {
  const styles = useStyles2(getStyles);
  const [shareOpen, setShareOpen] = useState(false);
  const [absolute, setAbsolute] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canAlert = useMemo(() => canCreateAlertRules(), []);

  const hasTime = Boolean(config.columns.timestamp);
  const relative = isRelativeRange(timeRange);
  const shareUrl = shareOpen ? buildShareUrl(window.location.href, timeRange, absolute) : '';
  const unsaved = shareOpen
    ? hasUnsavedChanges({ ...queryState, columns: rawColumns ?? queryState.columns }, loadSavedSearches(), viewId)
    : false;

  const exportCsv = async () => {
    if (queryState.useRawSql) {
      return;
    }
    setExporting(true);
    try {
      const sql = buildLogsQuery(
        config,
        queryState,
        { limit: CSV_EXPORT_LIMIT, offset: 0 },
        { projection: 'grid' },
        index
      );
      const rows = await runQueryRows({
        datasourceUid: config.datasourceUid,
        sql,
        timeRange,
        op: 'export',
        refId: 'export',
      });
      downloadCsv(csvFileName(viewName), rowsToCsv(queryState.columns, rows));
      notify(
        'success',
        rows.length >= CSV_EXPORT_LIMIT
          ? `Exported the first ${CSV_EXPORT_LIMIT.toLocaleString()} documents (export limit)`
          : `Exported ${rows.length.toLocaleString()} documents`
      );
    } catch (err) {
      notify('error', `CSV export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExporting(false);
    }
  };

  const createAlert = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    const url = buildAlertRuleUrl({ config, state: queryState, timeRange, index, viewName }, returnTo);
    if (url) {
      window.open(url, '_blank', 'noopener');
    }
  };

  const newSession = () => {
    const qs = viewId ? `?ds=${encodeURIComponent(viewId)}` : '';
    window.location.assign(`${window.location.pathname}${qs}`);
  };

  const menu = (
    <Menu>
      <Menu.Item label="New session" icon="file-blank" onClick={newSession} />
      <Menu.Item
        label={exporting ? 'Exporting…' : 'Export tab results (CSV)'}
        icon="download-alt"
        disabled={exporting || queryState.useRawSql}
        description={
          queryState.useRawSql
            ? 'Available in the query builder'
            : `Up to ${CSV_EXPORT_LIMIT.toLocaleString()} documents`
        }
        onClick={exportCsv}
      />
      <Menu.Item label="Inspect" icon="stopwatch" onClick={onOpenDiagnostics} />
      <Menu.Divider />
      <Menu.Item
        label="Create alert rule"
        icon="bell"
        disabled={!canAlert || !hasTime || queryState.useRawSql}
        description={
          !canAlert
            ? 'You do not have permission to create alert rules'
            : !hasTime
              ? 'This data view has no time field'
              : queryState.useRawSql
                ? 'Available in the query builder'
                : 'Alert when the current search matches documents'
        }
        onClick={createAlert}
      />
    </Menu>
  );

  return (
    <>
      <Button variant="secondary" size="sm" icon="share-alt" onClick={() => setShareOpen(true)}>
        Share
      </Button>
      <Dropdown overlay={menu} placement="bottom-end">
        <Button
          variant="secondary"
          size="sm"
          icon="ellipsis-v"
          aria-label="More Discover actions"
          tooltip="More actions"
        />
      </Dropdown>

      <Modal title="Share this Discover session" isOpen={shareOpen} onDismiss={() => setShareOpen(false)}>
        <div className={styles.body}>
          <Field
            label="Use absolute time range"
            description={
              relative
                ? 'Off: the link keeps the relative range (e.g. "Last 15 minutes"), so it shows the latest data whenever it is opened. On: the link pins the exact range shown now.'
                : 'The current range is already absolute.'
            }
          >
            <Switch
              id="share-absolute-time"
              value={absolute || !relative}
              disabled={!relative}
              onChange={(e) => setAbsolute(e.currentTarget.checked)}
            />
          </Field>
          {unsaved && (
            <Alert severity="warning" title="You have unsaved changes">
              The link shares the current search, filters, columns and time range. Save the search to keep it in Saved
              searches.
            </Alert>
          )}
          <Field label="Link">
            <Input
              readOnly
              value={shareUrl}
              aria-label="Share link"
              addonAfter={
                <ClipboardButton
                  variant="primary"
                  icon="copy"
                  getText={() => shareUrl}
                  onClipboardCopy={() => notify('success', 'Link copied')}
                >
                  Copy link
                </ClipboardButton>
              }
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  body: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
  `,
});
