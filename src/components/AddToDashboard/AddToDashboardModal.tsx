/**
 * "Add to dashboard" modal — exports the current logs table + volume histogram as real
 * Grafana panels onto a new or existing dashboard. Mirrors the Modal/Field/Select/Alert
 * pattern used by CreateDataViewModal and SavedSearchMenu's save modal.
 *
 * PARITY-DASHBOARDS: the panels can be titled; a new dashboard opens on Discover's time range (an
 * existing one keeps its own, as Kibana only stores time when asked); a title already used by
 * another dashboard is flagged before saving and Grafana's name conflict is explained; the logs
 * table keeps Discover's columns and can be reopened in Discover from the panel menu.
 */
import React, { useEffect, useId, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, SelectableValue, TimeRange } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  RadioButtonGroup,
  Select,
  Spinner,
  useStyles2,
} from '@grafana/ui';
import { BreakdownSel, LogsQueryState, SourceConfig } from '../../types';
import { errMsg } from '../../errMsg';
import { ViewCapabilities } from '../../sql/capabilities';
import { resolveVolumeBreakdown } from '../../sql/queryBuilder';
import {
  appendPanelsToDashboard,
  buildHistogramPanel,
  buildNewDashboard,
  buildTablePanel,
  dashboardTime,
  ExportedPanel,
} from '../../data/panelExport';
import {
  dashboardSaveError,
  findDashboardsByTitle,
  getDashboard,
  saveDashboard,
  searchDashboards,
} from '../../data/dashboards';
import { discoverSourceOf } from '../../data/discoverSource';
import { useFields } from '../FieldsContext';
import { buildFieldIndex } from '../../sql/fields';

interface AddToDashboardModalProps {
  isOpen: boolean;
  onDismiss: () => void;
  config: SourceConfig;
  /** Query state with effective (default-derived) columns already merged in. */
  queryState: LogsQueryState;
  breakdown: BreakdownSel;
  caps: ViewCapabilities;
  /** Discover's time range: a new dashboard opens on it. */
  timeRange: TimeRange;
}

const DEFAULT_DASHBOARD_TITLE = 'Logs Explorer export';
const DEFAULT_TABLE_TITLE = 'Logs';
const DEFAULT_HISTOGRAM_TITLE = 'Log volume';

type Destination = 'new' | 'existing';

export function AddToDashboardModal({
  isOpen,
  onDismiss,
  config,
  queryState,
  breakdown,
  caps,
  timeRange,
}: AddToDashboardModalProps) {
  const styles = useStyles2(getStyles);
  const ids = useId();
  const { fields } = useFields();
  const fieldIndex = useMemo(() => buildFieldIndex(fields), [fields]);

  const [includeTable, setIncludeTable] = useState(true);
  const [includeHistogram, setIncludeHistogram] = useState(caps.hasTime);
  const [destination, setDestination] = useState<Destination>('new');
  const [newTitle, setNewTitle] = useState(DEFAULT_DASHBOARD_TITLE);
  const [tableTitle, setTableTitle] = useState(DEFAULT_TABLE_TITLE);
  const [histogramTitle, setHistogramTitle] = useState(DEFAULT_HISTOGRAM_TITLE);
  // Titles already used by other dashboards (case-insensitive), checked as the title is typed.
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);
  const [existingUid, setExistingUid] = useState<string | undefined>(undefined);
  // null = not fetched yet (also doubles as the "loading" signal for the existing-dashboard picker).
  const [dashboardOptions, setDashboardOptions] = useState<Array<SelectableValue<string>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset transient state each time the modal transitions from closed to open.
  // Adjusted during render (not in an effect) per React's "adjusting state on prop change" pattern —
  // avoids the extra render an effect-based reset would cause.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setIncludeTable(true);
      setIncludeHistogram(caps.hasTime);
      setDestination('new');
      setNewTitle(DEFAULT_DASHBOARD_TITLE);
      setTableTitle(DEFAULT_TABLE_TITLE);
      setHistogramTitle(DEFAULT_HISTOGRAM_TITLE);
      setDuplicateOf(null);
      setExistingUid(undefined);
      setDashboardOptions(null);
      setError('');
    }
  }

  // Populate the existing-dashboard picker lazily, only when that destination is chosen.
  useEffect(() => {
    if (!isOpen || destination !== 'existing' || dashboardOptions !== null) {
      return;
    }
    let cancelled = false;
    searchDashboards()
      .then((hits) => {
        if (cancelled) {
          return;
        }
        setDashboardOptions(
          hits.map((h) => ({ label: h.folderTitle ? `${h.folderTitle} / ${h.title}` : h.title, value: h.uid }))
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setError(`Failed to load dashboards: ${errMsg(e)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, destination, dashboardOptions]);

  // Duplicate-title warning for a new dashboard (Grafana refuses the same title in one folder).
  useEffect(() => {
    const t = newTitle.trim();
    if (!isOpen || destination !== 'new' || !t) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      findDashboardsByTitle(t).then(
        (hits) => !cancelled && setDuplicateOf(hits.length > 0 ? t : null),
        () => !cancelled && setDuplicateOf(null)
      );
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isOpen, destination, newTitle]);
  const duplicate = destination === 'new' && duplicateOf !== null && duplicateOf === newTitle.trim();

  const loadingDashboards = destination === 'existing' && dashboardOptions === null;

  const canSave =
    (includeTable || includeHistogram) &&
    (!includeTable || Boolean(tableTitle.trim())) &&
    (!includeHistogram || Boolean(histogramTitle.trim())) &&
    (destination === 'new' ? Boolean(newTitle.trim()) : Boolean(existingUid)) &&
    !saving;

  function buildPanels(): ExportedPanel[] {
    const panels: ExportedPanel[] = [];
    let id = 1;
    let y = 0;
    if (includeTable) {
      // Discover's search as URL parameters (the address bar is kept in sync with the page), so the
      // panel menu's "Open in Discover" can restore it.
      const source = discoverSourceOf(new URLSearchParams(window.location.search));
      panels.push(
        buildTablePanel(
          config,
          queryState,
          { id: id++, title: tableTitle, gridPos: { x: 0, y, w: 24, h: 12 }, source },
          fieldIndex
        )
      );
      y += 12;
    }
    if (includeHistogram) {
      const volBreakdown = resolveVolumeBreakdown(breakdown, config);
      panels.push(
        buildHistogramPanel(
          config,
          queryState,
          volBreakdown,
          { id: id++, title: histogramTitle, gridPos: { x: 0, y, w: 24, h: 8 } },
          fieldIndex
        )
      );
    }
    return panels;
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const panels = buildPanels();
      if (destination === 'new') {
        // Grafana can save the same title twice in the General folder (new dashboards go there), so
        // refuse it here, as the warning under the title announces.
        const same = await findDashboardsByTitle(newTitle.trim()).catch(() => []);
        if (same.some((h) => !h.folderTitle)) {
          throw Object.assign(new Error('name-exists'), { data: { status: 'name-exists' } });
        }
      }
      const result =
        destination === 'new'
          ? await saveDashboard(buildNewDashboard(panels, newTitle.trim(), dashboardTime(timeRange)))
          : await (async () => {
              const existing = await getDashboard(existingUid as string);
              const merged = appendPanelsToDashboard(existing.dashboard, panels);
              return saveDashboard(merged, { folderUid: existing.meta.folderUid, overwrite: true });
            })();
      onDismiss();
      locationService.push(result.url);
    } catch (e) {
      setError(dashboardSaveError(e, newTitle.trim()));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add to dashboard" isOpen={isOpen} onDismiss={onDismiss}>
      {error && (
        <Alert title="Error" severity="error" className={styles.alert}>
          {error}
        </Alert>
      )}

      <Field label="Panels to add">
        <div className={styles.checkboxes}>
          <div className={styles.panelRow}>
            <Checkbox
              label="Logs table"
              value={includeTable}
              onChange={(e) => setIncludeTable(e.currentTarget.checked)}
            />
            <Input
              className={styles.panelTitle}
              aria-label="Logs table panel title"
              value={tableTitle}
              disabled={!includeTable}
              onChange={(e) => setTableTitle(e.currentTarget.value)}
            />
          </div>
          {caps.hasTime && (
            <div className={styles.panelRow}>
              <Checkbox
                label="Volume histogram"
                value={includeHistogram}
                onChange={(e) => setIncludeHistogram(e.currentTarget.checked)}
              />
              <Input
                className={styles.panelTitle}
                aria-label="Volume histogram panel title"
                value={histogramTitle}
                disabled={!includeHistogram}
                onChange={(e) => setHistogramTitle(e.currentTarget.value)}
              />
            </div>
          )}
        </div>
      </Field>

      <Field label="Destination">
        <RadioButtonGroup
          value={destination}
          onChange={(v) => setDestination(v as Destination)}
          options={[
            { label: 'New dashboard', value: 'new' },
            { label: 'Existing dashboard', value: 'existing' },
          ]}
        />
      </Field>

      {destination === 'new' ? (
        <Field
          label="Dashboard title"
          required
          htmlFor={`${ids}-dtitle`}
          description="The new dashboard opens on Discover's current time range."
          invalid={duplicate}
          error={duplicate ? 'A dashboard with this title already exists. Choose another title or add to the existing dashboard.' : undefined}
        >
          <Input id={`${ids}-dtitle`} value={newTitle} onChange={(e) => setNewTitle(e.currentTarget.value)} autoFocus />
        </Field>
      ) : (
        <Field label="Dashboard" required>
          {loadingDashboards ? (
            <Spinner size="sm" />
          ) : (
            <Select
              width={40}
              value={existingUid}
              options={dashboardOptions ?? []}
              onChange={(opt) => setExistingUid(opt.value)}
              placeholder="Select dashboard…"
            />
          )}
        </Field>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onDismiss} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} disabled={!canSave}>
          {saving ? <Spinner size="sm" inline /> : 'Add to dashboard'}
        </Button>
      </div>
    </Modal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  alert: css`
    margin-bottom: ${theme.spacing(2)};
  `,
  checkboxes: css`
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: ${theme.spacing(1)};
  `,
  // Checkbox on the left (its label next to the box, not centred), panel title input on the right.
  panelRow: css`
    display: grid;
    grid-template-columns: 180px 1fr;
    align-items: center;
    justify-items: start;
    gap: ${theme.spacing(1)};
  `,
  panelTitle: css`
    width: 100%;
  `,
  actions: css`
    display: flex;
    justify-content: flex-end;
    gap: ${theme.spacing(1)};
    margin-top: ${theme.spacing(2)};
  `,
});
