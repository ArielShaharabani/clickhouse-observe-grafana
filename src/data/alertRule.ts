/**
 * DISC-SESSION-01 "Create alert rule": opens Grafana's new-alert-rule form prefilled (the same
 * `?defaults=` hand-off Grafana's own "New alert rule" panel action uses) with
 *   A — the ClickHouse count of documents matching the current Discover query (alertQuery.ts),
 *   B — a threshold expression `A > 0`, the rule's condition.
 * The evaluation window defaults to the current time range's length (clamped to 1 min .. 7 days),
 * the user edits everything else (folder, interval, threshold, notifications) in Grafana.
 */
import { TimeRange } from '@grafana/data';
import { LogsQueryState, SourceConfig } from '../types';
import { FieldIndex } from '../sql/fields';
import { buildAlertCountQuery } from '../sql/alertQuery';
import { chDatasourceRef, FORMAT_TABLE } from './panelExport';

export const ALERT_NEW_PATH = '/alerting/new/alerting';
const MIN_WINDOW_S = 60;
const MAX_WINDOW_S = 7 * 24 * 3600;

export function alertWindowSeconds(timeRange: TimeRange): number {
  const s = Math.round((timeRange.to.valueOf() - timeRange.from.valueOf()) / 1000);
  if (!Number.isFinite(s) || s <= 0) {
    return 600;
  }
  return Math.min(MAX_WINDOW_S, Math.max(MIN_WINDOW_S, s));
}

export interface AlertRuleInput {
  config: SourceConfig;
  state: LogsQueryState;
  timeRange: TimeRange;
  index?: FieldIndex;
  /** Shown as the rule title (the view name, plus the query when there is one). */
  viewName?: string;
}

/** Rule-form defaults Grafana accepts in `?defaults=`; null when the view has no time field. */
export function buildAlertRuleDefaults(input: AlertRuleInput): Record<string, unknown> | null {
  const rawSql = buildAlertCountQuery(input.config, input.state, input.index);
  if (!rawSql) {
    return null;
  }
  const ds = chDatasourceRef(input.config.datasourceUid);
  const window = alertWindowSeconds(input.timeRange);
  const q = input.state.search.trim();
  const title = `${input.viewName || 'Logs'}${q ? `: ${q}` : ''}`.slice(0, 190);
  return {
    type: 'grafana-alerting',
    title,
    condition: 'B',
    queries: [
      {
        refId: 'A',
        queryType: '',
        datasourceUid: ds.uid,
        relativeTimeRange: { from: window, to: 0 },
        model: { refId: 'A', datasource: ds, editorType: 'sql', format: FORMAT_TABLE, rawSql },
      },
      {
        refId: 'B',
        queryType: '',
        datasourceUid: '__expr__',
        relativeTimeRange: { from: 0, to: 0 },
        model: {
          refId: 'B',
          type: 'threshold',
          expression: 'A',
          datasource: { type: '__expr__', uid: '__expr__' },
          conditions: [{ type: 'query', evaluator: { type: 'gt', params: [0] } }],
        },
      },
    ],
  };
}

export function buildAlertRuleUrl(input: AlertRuleInput, returnTo?: string): string | null {
  const defaults = buildAlertRuleDefaults(input);
  if (!defaults) {
    return null;
  }
  const sp = new URLSearchParams({ defaults: JSON.stringify(defaults) });
  if (returnTo) {
    sp.set('returnTo', returnTo);
  }
  return `${ALERT_NEW_PATH}?${sp.toString()}`;
}
