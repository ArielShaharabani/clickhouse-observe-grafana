/**
 * LENS-INSPECT-01 Inspector (docs/spec/20-lens.md): a right drawer with `View: Data | Requests`.
 * Data = the chart's table (sortable headers, ⊕/⊖ on top-values cells through the shared action
 * registry, 20 rows per page, Download CSV formatted / raw). Requests = Visualize's chart query as
 * recorded by the diagnostics tracer (the same spans as Discover's Diagnostics drawer): statistics,
 * the SQL request and the response rows.
 */
import React, { useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2 } from '@grafana/data';
import {
  Button,
  ClipboardButton,
  Drawer,
  Dropdown,
  Icon,
  Menu,
  Pagination,
  RadioButtonGroup,
  Tab,
  TabsBar,
  useStyles2,
} from '@grafana/ui';
import { ActionIconButton } from '../actions/ActionIconButton';
import { copyToClipboard, valueActions } from '../actions/registry';
import { useDiagnostics } from '../diag/DiagContext';
import { formatDurationMs } from '../diag/formatDuration';
import { formatBytes, formatCount } from '../components/Diagnostics/formatNumbers';
import { Span } from '../diag/types';
import { FilterPill } from '../types';
import { LensResult, truncatedNote } from './compile';
import {
  cellFilterValue,
  csvFileName,
  formatCell,
  inspectorTable,
  InspectorSort,
  lensRequests,
  sortRows,
  spanWallTime,
  toCsv,
} from './inspectorData';
import { LensState } from './state';
import { saveFile } from '../utils/download';
import { useTimeZoneSettings } from '../utils/timeZone';

export const INSPECTOR_PAGE_SIZE = 20;
/** Response JSON shows at most this many rows (the Data view has them all). */
const RESPONSE_ROWS = 100;

export interface LensInspectorProps {
  lens: LensState;
  data?: LensResult;
  /** Chart title (CSV file name). */
  title: string;
  dataView?: { id: string; name: string } | null;
  /** `database.table` the chart reads. */
  tableName: string;
  addFilter: (pill: FilterPill) => void;
  /** The shown chart's SQL (macro form), to find its request. */
  chartSql?: string;
  onClose: () => void;
}

type View = 'data' | 'requests';

export function LensInspector(props: LensInspectorProps) {
  const styles = useStyles2(getStyles);
  const [view, setView] = useState<View>('data');
  return (
    <Drawer title="Inspector" onClose={props.onClose} size="md">
      <div className={styles.viewRow}>
        <span className={styles.viewLabel}>View</span>
        <RadioButtonGroup<View>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { label: 'Data', value: 'data' },
            { label: 'Requests', value: 'requests' },
          ]}
        />
      </div>
      {view === 'data' ? <DataView {...props} /> : <RequestsView {...props} />}
    </Drawer>
  );
}

function download(text: string, fileName: string) {
  saveFile(fileName, [text], 'text/csv;charset=utf-8');
}

function DataView({ lens, data, title, addFilter }: LensInspectorProps) {
  const styles = useStyles2(getStyles);
  useTimeZoneSettings(); // date cells format in the chosen zone
  const table = useMemo(() => inspectorTable(lens, data), [lens, data]);
  const [sort, setSort] = useState<InspectorSort | null>(null);
  const [page, setPage] = useState(1);
  const sorted = useMemo(() => sortRows(table.rows, sort), [table.rows, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / INSPECTOR_PAGE_SIZE));
  const current = Math.min(page, pages);
  const shown = sorted.slice((current - 1) * INSPECTOR_PAGE_SIZE, current * INSPECTOR_PAGE_SIZE);

  if (!data || table.columns.length === 0) {
    return <div className={styles.empty}>No data to show yet.</div>;
  }
  const toggleSort = (col: number) =>
    setSort((s) => (s?.col !== col ? { col, dir: 'asc' } : s.dir === 'asc' ? { col, dir: 'desc' } : null));
  const host = { addFilter, copyText: copyToClipboard };

  return (
    <div>
      <div className={styles.dataBar}>
        <span className={styles.muted}>
          {formatCount(sorted.length)} row{sorted.length === 1 ? '' : 's'}
        </span>
        {data.truncated && (
          <span role="alert" data-testid="lens-inspector-truncated">
            <Icon name="exclamation-triangle" size="sm" /> {truncatedNote(data)}
          </span>
        )}
        <Dropdown
          overlay={
            <Menu>
              <Menu.Item
                label="Formatted CSV"
                description="Values as shown in the table"
                onClick={() => download(toCsv(table, true), csvFileName(title, true))}
              />
              <Menu.Item
                label="Raw CSV"
                description="Values as returned by ClickHouse"
                onClick={() => download(toCsv(table, false), csvFileName(title, false))}
              />
            </Menu>
          }
        >
          <Button size="sm" variant="secondary" icon="download-alt">
            Download CSV <Icon name="angle-down" />
          </Button>
        </Dropdown>
      </div>
      <table className={styles.table} aria-label="Inspector data">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th
                key={i}
                aria-sort={sort?.col === i ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                className={c.role === 'metric' ? styles.numeric : undefined}
              >
                <button type="button" className={styles.sortButton} onClick={() => toggleSort(i)}>
                  {c.label}
                  {sort?.col === i && <Icon name={sort.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size="sm" />}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, r) => (
            <tr key={r}>
              {row.map((cell, i) => {
                const col = table.columns[i];
                if (!col) {
                  return null;
                }
                const value = col.role === 'bucket' ? cellFilterValue(col.bucket, cell) : null;
                const field = col.bucket?.kind === 'terms' ? col.bucket.field : undefined;
                const actions =
                  value !== null && field
                    ? valueActions({ field, fieldLabel: col.label, value }, host, ['filterFor', 'filterOut'])
                    : [];
                return (
                  <td key={i} className={col.role === 'metric' ? styles.numeric : undefined}>
                    <span className={styles.cell}>
                      <span>{formatCell(col, cell)}</span>
                      {actions.length > 0 && (
                        <span className={styles.cellActions}>
                          {actions.map((a) => (
                            <ActionIconButton key={a.id} action={a} size="xs" />
                          ))}
                        </span>
                      )}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {pages > 1 && (
        <div className={styles.pager}>
          <span className={styles.muted}>Rows per page: {INSPECTOR_PAGE_SIZE}</span>
          <Pagination currentPage={current} numberOfPages={pages} onNavigate={setPage} />
        </div>
      )}
    </div>
  );
}

type RequestTab = 'stats' | 'request' | 'response';

// ClickHouse's own statistics are listed only when the response has them.
const SERVER_STATS = new Set(['Rows read', 'Bytes read', 'Query time (ClickHouse)', 'Memory usage']);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

function RequestsView({ data, dataView, tableName, chartSql }: LensInspectorProps) {
  const styles = useStyles2(getStyles);
  const { roots } = useDiagnostics();
  const requests = lensRequests(roots);
  // This chart's own request: its rows may have come from the cache after another chart ran.
  const own = chartSql?.trimEnd();
  const latest: Span | undefined =
    (own && [...requests].reverse().find((r) => str(r.attrs.sql)?.startsWith(own))) || requests[requests.length - 1];
  const [tab, setTab] = useState<RequestTab>('stats');

  if (!latest) {
    return <div className={styles.empty}>No request has been made yet.</div>;
  }
  const a = latest.attrs;
  const durationMs = latest.endMs !== null ? latest.endMs - latest.startMs : undefined;
  const sql = str(a.sql) ?? '';
  const executedSql = str(a.executedSql);
  const stats = [
    // Rows the query returned (ClickHouse has no "matching documents" count in the response).
    ['Result rows', num(a.rowCount) !== undefined ? formatCount(a.rowCount) : '-'],
    ['Rows read', num(a.serverReadRows) !== undefined ? formatCount(a.serverReadRows) : '-'],
    ['Bytes read', num(a.serverReadBytes) !== undefined ? formatBytes(a.serverReadBytes) : '-'],
    ['Data view', dataView?.name ?? '-'],
    ['Data view ID', dataView?.id ?? '-'],
    ['Table', tableName],
    ['Query time', durationMs !== undefined ? formatDurationMs(durationMs) : 'running…'],
    [
      'Query time (ClickHouse)',
      num(a.serverDurationMs) !== undefined ? formatDurationMs(a.serverDurationMs as number) : '-',
    ],
    ['Memory usage', num(a.serverMemoryUsage) !== undefined ? formatBytes(a.serverMemoryUsage) : '-'],
    ['Request timestamp', spanWallTime(latest.startMs).toISOString()],
    ['Status', latest.status],
  ].filter(([k, v]) => v !== '-' || !SERVER_STATS.has(k));
  // Exactly what ran, so the copied text runs as it is.
  const requestText = executedSql ?? sql;
  const responseJson = JSON.stringify(
    data
      ? {
          columns: data.table.columns,
          rows: data.table.rows.slice(0, RESPONSE_ROWS),
          ...(data.table.rows.length > RESPONSE_ROWS
            ? { truncatedTo: RESPONSE_ROWS, total: data.table.rows.length }
            : {}),
        }
      : { error: latest.error ?? null },
    null,
    2
  );

  return (
    <div>
      <div className={styles.reqHeader}>
        {requests.length === 1 ? '1 request was made' : `${requests.length} requests were made`}
        {requests.length > 1 && <span className={styles.muted}> · showing the latest</span>}
      </div>
      <div className={styles.reqName}>
        <Icon name={latest.status === 'error' ? 'exclamation-triangle' : 'database'} />
        <span>Data</span>
        {durationMs !== undefined && <span className={styles.muted}>{formatDurationMs(durationMs)}</span>}
        {str(a.serverQueryId) && <span className={styles.muted}>query id {String(a.serverQueryId)}</span>}
      </div>
      {latest.error && <div className={styles.error}>{latest.error}</div>}
      <TabsBar>
        <Tab label="Statistics" active={tab === 'stats'} onChangeTab={() => setTab('stats')} />
        <Tab label="Request" active={tab === 'request'} onChangeTab={() => setTab('request')} />
        <Tab label="Response" active={tab === 'response'} onChangeTab={() => setTab('response')} />
      </TabsBar>
      <div className={styles.tabBody}>
        {tab === 'stats' && (
          <table className={styles.table} aria-label="Request statistics">
            <tbody>
              {stats.map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {tab === 'request' && <JsonBlock text={requestText} label="request" />}
        {tab === 'response' && <JsonBlock text={responseJson} label="response" />}
      </div>
    </div>
  );
}

function JsonBlock({ text, label }: { text: string; label: string }) {
  const styles = useStyles2(getStyles);
  return (
    <div>
      <ClipboardButton size="sm" variant="secondary" icon="copy" getText={() => text}>
        Copy {label}
      </ClipboardButton>
      <pre className={styles.pre} aria-label={`Inspector ${label}`}>
        {text}
      </pre>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  viewRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(2)};
  `,
  viewLabel: css`
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  dataBar: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: ${theme.spacing(1)};
  `,
  muted: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  empty: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(2, 0)};
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    font-size: ${theme.typography.bodySmall.fontSize};
    th,
    td {
      text-align: left;
      padding: ${theme.spacing(0.5, 1)};
      border-bottom: 1px solid ${theme.colors.border.weak};
    }
    th {
      font-weight: ${theme.typography.fontWeightMedium};
    }
    tbody tr:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  numeric: css`
    text-align: right !important;
  `,
  sortButton: css`
    all: unset;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
  `,
  cell: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    &:hover > span:last-child,
    &:focus-within > span:last-child {
      opacity: 1;
    }
  `,
  cellActions: css`
    display: inline-flex;
    opacity: 0;
  `,
  pager: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: ${theme.spacing(1)};
  `,
  reqHeader: css`
    margin-bottom: ${theme.spacing(1)};
  `,
  reqName: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    margin-bottom: ${theme.spacing(1)};
  `,
  error: css`
    color: ${theme.colors.error.text};
    margin-bottom: ${theme.spacing(1)};
    white-space: pre-wrap;
  `,
  tabBody: css`
    padding-top: ${theme.spacing(1)};
  `,
  pre: css`
    margin-top: ${theme.spacing(1)};
    max-height: 60vh;
    overflow: auto;
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
});
