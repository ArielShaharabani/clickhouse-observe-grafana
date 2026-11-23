/**
 * "Open panel" (R6-PANELS): pick a dashboard and one of its panels (rows included) and edit it in
 * Visualize, through the same import as the panel menu's "Edit in Visualize". Reading only. Panels
 * that cannot be converted stay selectable and say why (opening them gives an empty chart with the
 * original query shown; saving then warns before replacing anything).
 */
import React, { useContext, useEffect, useId, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { Alert, Button, Combobox, Field, Modal, Spinner, useStyles2 } from '@grafana/ui';
import { DataViewContext } from '../components/App/App';
import { PLUGIN_BASE_URL } from '../constants';
import { getDashboard, searchDashboards } from '../data/dashboards';
import { errMsg } from '../errMsg';
import { importPanel } from './panelImport';
import { assertClassicDashboard, listDashboardPanels, PanelListItem } from './panelImportLoad';
import { IMPORT_PARAM, isDashboardUid, isTimeParam } from './panelSource';

interface Props {
  isOpen: boolean;
  onDismiss: () => void;
  /** The page already shows a chart: opening a panel replaces it. */
  hasChart: boolean;
}

export function OpenPanelModal({ isOpen, onDismiss, hasChart }: Props) {
  const styles = useStyles2(getStyles);
  const ids = useId();
  const { views } = useContext(DataViewContext);
  const [options, setOptions] = useState<Array<{ label: string; value: string }> | null>(null);
  const [loadError, setLoadError] = useState('');
  const [uid, setUid] = useState<string | undefined>();
  const [panels, setPanels] = useState<{ uid: string; items: PanelListItem[]; from?: string; to?: string } | null>(null);
  const [panelError, setPanelError] = useState('');
  const [panelId, setPanelId] = useState<number | undefined>();

  // Reset each time the modal opens.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setUid(undefined);
      setPanels(null);
      setPanelError('');
      setPanelId(undefined);
      setLoadError('');
    }
  }

  useEffect(() => {
    if (!isOpen || options !== null || loadError) {
      return;
    }
    let cancelled = false;
    searchDashboards().then(
      (hits) =>
        !cancelled &&
        setOptions(
          hits
            .filter((h) => isDashboardUid(h.uid))
            .map((h) => ({ label: h.folderTitle ? `${h.folderTitle} / ${h.title}` : h.title, value: h.uid }))
        ),
      (e) => !cancelled && setLoadError(errMsg(e))
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, options, loadError]);

  useEffect(() => {
    if (!uid) {
      return;
    }
    let cancelled = false;
    getDashboard(uid).then(
      ({ dashboard }) => {
        if (cancelled) {
          return;
        }
        try {
          assertClassicDashboard(dashboard);
          const t = (dashboard.time ?? {}) as Record<string, unknown>;
          setPanels({
            uid,
            items: listDashboardPanels(dashboard),
            from: isTimeParam(t.from) ? t.from : undefined,
            to: isTimeParam(t.to) ? t.to : undefined,
          });
        } catch (e) {
          setPanelError(errMsg(e));
        }
      },
      (e) => !cancelled && setPanelError(errMsg(e))
    );
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const rows = useMemo(
    () =>
      (panels?.items ?? []).map((it) => {
        // A library panel reference has no model here: it is read when opened.
        const lib = it.type === 'library panel';
        const r = lib ? undefined : importPanel(it.panel, views);
        return { it, reason: r?.kind === 'unsupported' ? r.reason : undefined, partial: r?.kind === 'partial' };
      }),
    [panels, views]
  );

  const current = uid && panels?.uid === uid ? panels : null;
  const open = () => {
    if (!uid || panelId === undefined || !current) {
      return;
    }
    const sp = new URLSearchParams({ dash: uid, panel: String(panelId), [IMPORT_PARAM]: Date.now().toString(36) });
    if (current.from && current.to) {
      sp.set('from', current.from);
      sp.set('to', current.to);
      sp.set('dfrom', current.from);
      sp.set('dto', current.to);
    }
    onDismiss();
    locationService.push(`${PLUGIN_BASE_URL}/visualize?${sp.toString()}`);
  };

  return (
    <Modal title="Open panel" isOpen={isOpen} onDismiss={onDismiss}>
      {hasChart && <p className={styles.hint}>The panel opens in a new tab; the chart you are editing stays in its own.</p>}
      <Field label="Dashboard" htmlFor={`${ids}-dash`}>
        {loadError ? (
          <Alert title="Failed to load dashboards" severity="error">
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
            value={uid ?? null}
            onChange={(o) => {
              setUid(o?.value);
              setPanels(null);
              setPanelId(undefined);
              setPanelError('');
            }}
            placeholder="Select dashboard…"
          />
        )}
      </Field>
      {panelError && (
        <Alert title="Could not read the dashboard" severity="error">
          {panelError}
        </Alert>
      )}
      {uid && !current && !panelError && <Spinner size="sm" />}
      {current && rows.length === 0 && <p className={styles.hint}>This dashboard has no panels.</p>}
      {current && rows.length > 0 && (
        <div role="radiogroup" aria-label="Panels" className={styles.list}>
          {rows.map(({ it, reason, partial }) => (
            <label key={it.id} className={styles.row}>
              <input
                type="radio"
                name={`${ids}-panel`}
                checked={panelId === it.id}
                onChange={() => setPanelId(it.id)}
                aria-label={`${it.title} (${it.type})`}
              />
              <span className={reason ? styles.grayed : undefined}>
                {it.title} <span className={styles.type}>({it.type})</span>
                {it.row && <span className={styles.type}> in {it.row}</span>}
                {reason && <span className={styles.reason}> Can&apos;t be converted: {reason}</span>}
                {!reason && partial && <span className={styles.reason}> Some settings are not carried over</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDismiss}>
          Cancel
        </Button>
        <Button variant="primary" onClick={open} disabled={!current || panelId === undefined}>
          Open
        </Button>
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  hint: css`
    color: ${theme.colors.text.secondary};
  `,
  list: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    max-height: 40vh;
    overflow: auto;
    margin-bottom: ${theme.spacing(1)};
  `,
  row: css`
    display: flex;
    gap: ${theme.spacing(1)};
    align-items: flex-start;
    cursor: pointer;
  `,
  grayed: css`
    color: ${theme.colors.text.disabled};
  `,
  type: css`
    color: ${theme.colors.text.secondary};
  `,
  reason: css`
    display: block;
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(2)};
  `,
});
