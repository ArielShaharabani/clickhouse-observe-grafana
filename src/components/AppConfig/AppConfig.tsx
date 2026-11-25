/**
 * Config page: manage shared data views (admin-only).
 * Views are stored in jsonData.dataViews[] and visible to all users of this plugin.
 * Users can also create personal (per-browser) views from the Discover header.
 */

import React, { ChangeEvent, useState } from 'react';
import { lastValueFrom } from 'rxjs';
import { css } from '@emotion/css';
import { AppPluginMeta, GrafanaTheme2, PluginConfigPageProps, PluginMeta } from '@grafana/data';
import { getBackendSrv } from '@grafana/runtime';
import { Alert, Button, Field, FieldSet, Input, Switch, useStyles2 } from '@grafana/ui';
import { EditLinksSection } from './EditLinksSection';
import { errMsg } from '../../errMsg';
import {
  AiProviderConfig,
  AppJsonData,
  DataView,
} from '../../types';
import { migrateLegacyConfig } from '../../data/dataViews';
import { cleanDefaultTimeRange } from '../../utils/defaultTimeRange';
import { AiConfigContext } from '../App/App';
import { CreateDataViewModal, DataViewValues } from '../DataViewPicker/CreateDataViewModal';

export interface AppConfigProps extends PluginConfigPageProps<AppPluginMeta<AppJsonData>> {}

const AppConfig = ({ plugin }: AppConfigProps) => {
  const styles = useStyles2(getStyles);
  const { enabled, pinned, jsonData } = plugin.meta;

  // On first load, migrate legacy sourceConfig → dataViews if needed.
  const [views, setViews] = useState<DataView[]>(() => migrateLegacyConfig(jsonData ?? {}));
  // The view open in the dialog ('new' = being created).
  const [editing, setEditing] = useState<DataView | 'new' | null>(null);
  const [unsaved, setUnsaved] = useState(false);
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

  function submitView(values: DataViewValues) {
    setUnsaved(true);
    if (editing && editing !== 'new') {
      const { id } = editing;
      setViews((prev) => prev.map((v) => (v.id === id ? { ...v, ...values } : v)));
      return;
    }
    setViews((prev) => [
      ...prev,
      {
        ...values,
        id: `shared_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
        origin: 'shared',
        createdAt: new Date().toISOString(),
      },
    ]);
  }

  function deleteView(id: string) {
    setViews((prev) => prev.filter((v) => v.id !== id));
    setUnsaved(true);
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
        <Button variant="secondary" size="sm" icon="plus" onClick={() => setEditing('new')}>
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
          <div key={v.id} className={styles.viewCard}>
            <div className={styles.viewCardHeader}>
              <span className={styles.viewCardName}>{v.name || '(unnamed)'}</span>
              <span className={styles.viewCardSub}>{v.database}.{v.logsTable}</span>
              <div className={styles.viewCardActions}>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(v)}
                >
                  Edit
                </Button>
                <Button size="sm" variant="destructive" fill="text" onClick={() => deleteView(v.id)}>
                  Delete
                </Button>
              </div>
            </div>

          </div>
        ))}
      </div>

      <AiConfigContext.Provider value={ai}>
        <CreateDataViewModal
          isOpen={editing !== null}
          editingView={editing && editing !== 'new' ? editing : undefined}
          onSubmit={submitView}
          submitLabel="Apply"
          onDismiss={() => setEditing(null)}
        />
      </AiConfigContext.Provider>

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
        {unsaved && saveStatus === 'idle' && (
          <span className={styles.unsaved} role="status">
            Data view changes are not saved yet
          </span>
        )}
      </div>
    </div>
  );
};

export default AppConfig;

const getStyles = (theme: GrafanaTheme2) => ({
  unsaved: css`
    margin-left: ${theme.spacing(1.5)};
    color: ${theme.colors.warning.text};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
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
