/**
 * Config page: manage shared data views (admin-only).
 * Views are stored in jsonData.dataViews[] and visible to all users of this plugin.
 * Users can also create personal (per-browser) views from the Discover header.
 */

import React, { ChangeEvent, useMemo, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Input, Select, Switch, useStyles2 } from '@grafana/ui';
import { EditLinksSection } from './EditLinksSection';
import { applyOtelPreset } from '../../sql/schema';
import { DEFAULT_QUERY_TIMEOUT_SECONDS } from '../../sql/settings';
import { errMsg } from '../../errMsg';
import {
  AiProviderConfig,
  AppJsonData,
  DataView,
  DEFAULT_SOURCE_CONFIG,
  EMPTY_COLUMN_MAPPING,
} from '../../types';
import { migrateLegacyConfig } from '../../data/dataViews';
import { cleanDefaultTimeRange } from '../../utils/defaultTimeRange';
import { ColumnMappingForm } from '../ColumnMappingForm';
import { epochGuesser, TimeFieldSelect, useTableColumns } from '../DataViewPicker/TimeFieldSelect';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppJsonData>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // On first load, migrate legacy sourceConfig → dataViews if needed.
  const [views, setViews] = useState<DataView[]>(() => migrateLegacyConfig(jsonData ?? {}));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');

  const [ai, setAi] = useState<AiProviderConfig>(
    () => jsonData?.ai ?? { enabled: false, baseUrl: '', model: '', token: '' }
  );
  // Default time range (Kibana's timepicker:timeDefaults): saved only when it parses, else unset.
  const [timeFrom, setTimeFrom] = useState(() => jsonData?.defaultTimeRange?.from ?? 'now-1h');
  const [timeTo, setTimeTo] = useState(() => jsonData?.defaultTimeRange?.to ?? 'now');
  const cleanedTime = cleanDefaultTimeRange({ from: timeFrom, to: timeTo });
  const timeValid = cleanedTime.from === timeFrom.trim() && cleanedTime.to === timeTo.trim();

  function patchAi(patch: Partial<AiProviderConfig>) {
    setAi((prev) => ({ ...prev, ...patch }));
  }

  // Datasource list is read synchronously from getDataSourceSrv() (no fetch), so it's
  // lazy-initialized here instead of populated from an effect.
  const [dsOptions] = useState<Array<{ label: string; value: string }>>(() => {
    try {
      const list = getDataSourceSrv().getList();
      const ch = list.filter((ds) => (ds.type ?? '').toLowerCase().includes('clickhouse'));
      return ch.map((ds) => ({ label: ds.name, value: ds.uid ?? ds.name }));
    } catch {
      return [];
    }
  });

  function patchView(id: string, patch: Partial<DataView>) {
    setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function addView() {
    const newView: DataView = {
      ...DEFAULT_SOURCE_CONFIG,
      id: `shared_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      name: 'New view',
      origin: 'shared',
      createdAt: new Date().toISOString(),
    };
    setViews((prev) => [...prev, newView]);
    setEditingId(newView.id);
  }

  function deleteView(id: string) {
    setViews((prev) => prev.filter((v) => v.id !== id));
    if (editingId === id) {
      setEditingId(null);
    }
  }

  const onSave = async () => {
    setSaveStatus('saving');
    setSaveError('');
    try {
      await updatePlugin(plugin.meta.id, {
        enabled,
        pinned,
        jsonData: { ...jsonData, dataViews: views, ai, defaultTimeRange: timeValid ? cleanedTime : undefined },
      });
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
      window.location.reload();
    } catch (err) {
      setSaveError(errMsg(err));
      setSaveStatus('error');
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.viewListHeader}>
        <h3 className={styles.sectionTitle}>Shared Data Views</h3>
        <Button variant="secondary" size="sm" icon="plus" onClick={addView}>
          Add view
        </Button>
      </div>

      {views.length === 0 && (
        <div className={styles.empty}>
          No data views configured. Click &ldquo;Add view&rdquo; to create one, or users can create
          personal views from the Discover header.
        </div>
      )}

      <div className={styles.viewList}>
        {views.map((v) => (
          <div key={v.id} className={`${styles.viewCard} ${editingId === v.id ? styles.viewCardActive : ''}`}>
            <div className={styles.viewCardHeader}>
              <span className={styles.viewCardName}>{v.name || '(unnamed)'}</span>
              <span className={styles.viewCardSub}>{v.database}.{v.logsTable}</span>
              <div className={styles.viewCardActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditingId(editingId === v.id ? null : v.id)}
                >
                  {editingId === v.id ? 'Collapse' : 'Edit'}
                </Button>
                <Button size="sm" variant="destructive" fill="text" onClick={() => deleteView(v.id)}>
                  Delete
                </Button>
              </div>
            </div>

            {editingId === v.id && (
              <div className={styles.viewEditor}>
                <Field label="Name">
                  <Input
                    width={30}
                    value={v.name}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      patchView(v.id, { name: e.target.value })
                    }
                    placeholder="My logs view"
                  />
                </Field>

                <Field label="ClickHouse datasource">
                  <Select
                    width={30}
                    value={v.datasourceUid}
                    options={dsOptions}
                    onChange={(opt) => patchView(v.id, { datasourceUid: opt.value ?? '' })}
                    placeholder="Select datasource…"
                  />
                </Field>

                <Field label="Database">
                  <Input
                    width={30}
                    value={v.database}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      patchView(v.id, { database: e.target.value.trim() })
                    }
                    placeholder="default"
                  />
                </Field>

                <Field label="Logs table">
                  <Input
                    width={30}
                    value={v.logsTable}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      patchView(v.id, { logsTable: e.target.value.trim() })
                    }
                    placeholder="otel_logs"
                  />
                </Field>

                <Field
                  label="Sequential consistency"
                  description="Makes each replica catch up before answering, so a load-balanced cluster can't return stale rows. Costs one Keeper round-trip per query. Turn off for single-node."
                >
                  <Switch
                    value={v.sequentialConsistency ?? true}
                    onChange={(e) => patchView(v.id, { sequentialConsistency: e.currentTarget.checked })}
                  />
                </Field>

                <Field
                  label="Query timeout (seconds)"
                  description={`Every query for this view is capped at this many seconds (ClickHouse max_execution_time, throw-on-timeout). Defaults to ${DEFAULT_QUERY_TIMEOUT_SECONDS}s — deliberately below a typical reverse-proxy's own hard timeout (e.g. a 30s OpenShift Route) so ClickHouse's own failure wins the race instead of the proxy killing the connection and Grafana surfacing an opaque 502/504.`}
                >
                  <Input
                    width={15}
                    type="number"
                    value={v.queryTimeoutSeconds ?? DEFAULT_QUERY_TIMEOUT_SECONDS}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                      const n = Number(e.target.value);
                      patchView(v.id, { queryTimeoutSeconds: Number.isFinite(n) && n > 0 ? n : undefined });
                    }}
                  />
                </Field>

                <Field
                  label="Additional query SETTINGS"
                  description="Appended to every query for this view. Comma-separated. Overrides the defaults above (including the query timeout above), except timeout_overflow_mode / read_overflow_mode / result_overflow_mode / group_by_overflow_mode, which every query builder in this plugin deliberately pins to a loud-failure mode — a 'break'/'any' override there is ignored rather than silently truncating results."
                >
                  <Input
                    width={50}
                    value={v.extraQuerySettings ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      patchView(v.id, { extraQuerySettings: e.target.value })
                    }
                    placeholder="max_replica_delay_for_distributed_queries = 30"
                  />
                </Field>

                <Field
                  label="Cluster name (for diagnostics)"
                  description="Only used by the Inspect drawer's optional server-side enrichment tier (off by default — see the toggle in the drawer). When set, its system.query_log lookup reads via clusterAllReplicas(<name>, system.query_log) so it finds a query's stats regardless of which replica answered. Leave blank for a single node or a non-distributed setup."
                >
                  <Input
                    width={30}
                    value={v.clusterName ?? ''}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => patchView(v.id, { clusterName: e.target.value.trim() })}
                    placeholder="my_cluster"
                  />
                </Field>

                <SharedViewColumns
                  view={v}
                  onPatch={(patch) => patchView(v.id, patch)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <FieldSet label="Default time range">
        <div className={styles.empty}>
          The range Discover and Visualize open on when a link carries none. Use time expressions
          (<code>now-1h</code>, <code>now</code>) or absolute dates (<code>2026-01-01T00:00:00Z</code>).
        </div>
        <Field label="From" invalid={!timeValid} error={!timeValid ? 'Not a valid range; the last hour is used' : undefined}>
          <Input width={30} value={timeFrom} onChange={(e: ChangeEvent<HTMLInputElement>) => setTimeFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input width={30} value={timeTo} onChange={(e: ChangeEvent<HTMLInputElement>) => setTimeTo(e.target.value)} />
        </Field>
      </FieldSet>

      <FieldSet label="AI Assistant">
        <div className={styles.empty} style={{ marginBottom: 12 }}>
          Optional &ldquo;Guess with AI&rdquo; assist for column mapping. Points at any OpenAI-compatible
          `/chat/completions` endpoint — hosted or self-hosted (e.g. Ollama). The token below is
          stored in plain settings (not encrypted secret storage) and is readable by any browser
          user of this plugin — fine for local/self-hosted models, not for a sensitive API key.
        </div>
        <Field label="Enable AI column guessing">
          <Switch value={ai.enabled} onChange={(e) => patchAi({ enabled: e.currentTarget.checked })} />
        </Field>
        <Field label="API base URL" description="OpenAI-compatible base URL, e.g. http://localhost:11434/v1">
          <Input
            width={40}
            value={ai.baseUrl}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchAi({ baseUrl: e.target.value.trim() })}
            placeholder="http://localhost:11434/v1"
          />
        </Field>
        <Field label="Model" description="Model name as understood by that endpoint, e.g. qwen2.5:1.5b">
          <Input
            width={40}
            value={ai.model}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchAi({ model: e.target.value.trim() })}
            placeholder="qwen2.5:1.5b"
          />
        </Field>
        <Field label="API token (optional)" description="Leave blank for endpoints with no auth (e.g. local Ollama).">
          <Input
            width={40}
            type="password"
            value={ai.token ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) => patchAi({ token: e.target.value })}
            placeholder="sk-…"
          />
        </Field>
      </FieldSet>

      <EditLinksSection />

      {saveStatus === 'error' && (
        <Alert title="Save failed" severity="error">
          {saveError}
        </Alert>
      )}
      {saveStatus === 'saved' && (
        <Alert title="Configuration saved" severity="success">
          Reloading…
        </Alert>
      )}

      <div className={styles.footer}>
        <Button onClick={onSave} disabled={saveStatus === 'saving'} icon="save">
          {saveStatus === 'saving' ? 'Saving…' : 'Save configuration'}
        </Button>
      </div>
    </div>
  );
};

export default AppConfig;

/**
 * Column mapping of a shared view (PLAN #16d): same pickers as "Create data view" — the time field
 * (with epoch / text conversion) and every other mapping chosen from the table's real columns.
 * Falls back to typed names while the columns can't be listed (no datasource / unknown table).
 */
function SharedViewColumns({ view, onPatch }: { view: DataView; onPatch: (patch: Partial<DataView>) => void }) {
  const styles = useStyles2(getStyles);
  const { columns, loading, error } = useTableColumns(view.datasourceUid, view.database, view.logsTable, true);
  const columnOptions = useMemo(
    () => (columns.length > 0 ? columns.map((c) => ({ label: c.name, value: c.name, description: c.type })) : undefined),
    [columns]
  );
  return (
    <FieldSet label="Column Mapping">
      <div className={styles.columnsStatus} data-testid="shared-view-columns-status">
        {loading
          ? 'Loading table columns…'
          : error
            ? `Could not list the table's columns (${error}); type column names instead.`
            : columns.length > 0
              ? `${columns.length} columns in ${view.database}.${view.logsTable}.`
              : 'Pick a datasource, database and table to choose columns from a list.'}
      </div>
      <TimeFieldSelect
        columns={columns}
        timestamp={view.columns.timestamp}
        format={view.timestampFormat}
        onChange={(timestamp, format) =>
          onPatch({
            columns: { ...view.columns, timestamp },
            timestampFormat: timestamp && format !== 'native' ? format : undefined,
          })
        }
        guessEpoch={epochGuesser(view, view.logsTable)}
        allowCustomValue
        width={40}
      />
      <ColumnMappingForm
        value={view.columns}
        onChange={(updated) => onPatch({ columns: updated })}
        columnOptions={columnOptions}
        omitKeys={['timestamp']}
        bare
        onApplyOtelPreset={() => {
          const preset = applyOtelPreset(view);
          onPatch({ logsTable: preset.logsTable, isOtel: true, columns: preset.columns, timestampFormat: undefined });
        }}
        onClearMapping={() =>
          onPatch({ isOtel: false, columns: { ...EMPTY_COLUMN_MAPPING }, timestampFormat: undefined })
        }
      />
    </FieldSet>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  page: css`
    max-width: 780px;
    padding: ${theme.spacing(2)};
  `,
  sectionTitle: css`
    margin: 0;
    font-size: ${theme.typography.h5.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.primary};
  `,
  viewListHeader: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${theme.spacing(1.5)};
  `,
  empty: css`
    padding: ${theme.spacing(2)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    border: 1px dashed ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    margin-bottom: ${theme.spacing(2)};
  `,
  viewList: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(2)};
  `,
  viewCard: css`
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    overflow: hidden;
  `,
  viewCardActive: css`
    border-color: ${theme.colors.primary.border};
  `,
  viewCardHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(1)} ${theme.spacing(1.5)};
    background: ${theme.colors.background.secondary};
  `,
  viewCardName: css`
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.primary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  viewCardSub: css`
    color: ${theme.colors.text.disabled};
    font-size: 0.78em;
    flex: 1;
  `,
  viewCardActions: css`
    display: flex;
    gap: ${theme.spacing(0.5)};
    margin-left: auto;
  `,
  viewEditor: css`
    padding: ${theme.spacing(2)};
    background: ${theme.colors.background.primary};
  `,
  columnsStatus: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    margin-bottom: ${theme.spacing(1.5)};
  `,
  footer: css`
    margin-top: ${theme.spacing(3)};
    padding-top: ${theme.spacing(2)};
    border-top: 1px solid ${theme.colors.border.weak};
  `,
});

async function updatePlugin(pluginId: string, data: Partial<PluginMeta<AppJsonData>>) {
  const response = getBackendSrv().fetch({
    url: `/api/plugins/${pluginId}/settings`,
    method: 'POST',
    data,
  });
  return lastValueFrom(response);
}
