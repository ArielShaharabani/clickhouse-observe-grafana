/**
 * Surrounding documents (DISC-DOC-02): the documents logged just before and after one anchor
 * document, from every source. Route `context/<dataViewId>/<ns>_<id>` (see data/surrounding.ts).
 *
 * - The anchor row is highlighted; `Load [5] newer documents` sits above the grid and
 *   `Load [5] older documents` below it (the step is editable).
 * - The search query is dropped; filters arrive disabled (struck-through pills) and can be
 *   re-enabled; the grid keeps Discover's columns.
 * - Not bound to the time picker: neighbours are found by position, not by time range.
 */
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { AppEvents, getDefaultTimeRange, GrafanaTheme2, PageLayoutType, TimeRange } from '@grafana/data';
import { getAppEvents, locationService, PluginPage } from '@grafana/runtime';
import { Alert, Button, Input, LoadingPlaceholder, TextLink, useStyles2 } from '@grafana/ui';
import { DataViewContext, SourceConfigContext } from '../components/App/App';
import { FieldsContext, useFieldDiscovery } from '../components/FieldsContext';
import { FilterPills } from '../components/FilterPills';
import { LogsTable } from '../components/LogsTable';
import { LogDetailDrawer } from '../components/LogDetailDrawer';
import { useAutocompleteSources } from '../autocomplete/service';
import { decodeLogsState, encodeLogsState } from '../data/urlState';
import { runQueryRows } from '../data/runQuery';
import {
  buildContextUrl,
  contextColumns,
  discoverReturnUrl,
  parseAnchorParam,
  resolveContextAnchor,
} from '../data/surrounding';
import { buildFieldIndex, FieldIndex } from '../sql/fields';
import { FieldModel } from '../sql/fieldModel';
import { addFilterPill } from '../sql/filters';
import { buildLogDetailQuery, buildSurroundingDocsQuery, ContextAnchor, MAX_CONTEXT_SIZE } from '../sql/queryBuilder';
import { tableKey } from '../state/sharedSearch';
import { errMsg } from '../errMsg';
import { DEFAULT_LOGS_QUERY_STATE, FilterPill, LogRow, SelectedColumn, SourceConfig } from '../types';

/** Kibana's default number of surrounding documents per side, and of each "Load" step. */
export const DEFAULT_CONTEXT_STEP = 5;

type Direction = 'anchor' | 'newer' | 'older';

interface QueryResult {
  key: string;
  rows: LogRow[];
  error?: string;
}

const NO_ROWS: LogRow[] = [];
/** The anchor search ignores filters (see buildSurroundingDocsQuery). */
const NO_FILTERS: FilterPill[] = [];

/** Runs one of the three surrounding-documents searches; re-runs only when its own inputs change. */
function useContextSearch(
  enabled: boolean,
  config: SourceConfig,
  anchor: ContextAnchor,
  direction: Direction,
  size: number,
  columns: SelectedColumn[],
  filters: FilterPill[],
  index: FieldIndex,
  timeRange: TimeRange
): { rows: LogRow[]; loading: boolean; error?: string } {
  const [result, setResult] = useState<QueryResult | null>(null);
  const key = JSON.stringify([
    config.datasourceUid,
    config.database,
    config.logsTable,
    anchor,
    direction,
    size,
    columns.map((c) => c.id),
    filters,
  ]);
  // Read at run time only: a new index or time range alone must not re-run the search.
  const indexRef = useRef(index);
  const timeRangeRef = useRef(timeRange);
  useLayoutEffect(() => {
    indexRef.current = index;
    timeRangeRef.current = timeRange;
  });
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const sql = buildSurroundingDocsQuery(config, anchor, { direction, size, columns, filters }, indexRef.current);
    if (!sql) {
      return;
    }
    const abort = new AbortController();
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql,
      timeRange: timeRangeRef.current,
      op: 'context',
      signal: abort.signal,
    }).then(
      (rows) => setResult({ key, rows: rows as LogRow[] }),
      (e) => {
        if (!abort.signal.aborted) {
          setResult({ key, rows: [], error: errMsg(e) });
        }
      }
    );
    return () => abort.abort();
    // `key` covers every input that changes the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);
  const current = result?.key === key ? result : null;
  return { rows: current?.rows ?? NO_ROWS, loading: enabled && !current, error: current?.error };
}

/** "Load [N] newer/older documents" control plus a status line. */
function LoadMore({
  direction,
  step,
  onStepChange,
  onLoad,
  loaded,
  requested,
  loading,
}: {
  direction: 'newer' | 'older';
  step: number;
  onStepChange: (n: number) => void;
  onLoad: () => void;
  loaded: number;
  requested: number;
  loading: boolean;
}) {
  const styles = useStyles2(getStyles);
  const exhausted = !loading && loaded < requested;
  return (
    <div className={styles.loadMore} data-testid={`load-${direction}`}>
      <Button
        size="sm"
        variant="secondary"
        onClick={onLoad}
        disabled={loading || exhausted || requested >= MAX_CONTEXT_SIZE}
      >
        Load
      </Button>
      <Input
        type="number"
        width={8}
        min={1}
        max={MAX_CONTEXT_SIZE}
        value={step}
        aria-label={`Number of ${direction} documents to load`}
        onChange={(e) => onStepChange(Number(e.currentTarget.value))}
      />
      <span>{direction} documents</span>
      <span className={styles.status} data-testid={`${direction}-status`}>
        {loading
          ? 'Loading…'
          : `${loaded} ${direction} document${loaded === 1 ? '' : 's'}${exhausted ? ` · no more ${direction} documents` : ''}`}
      </span>
    </div>
  );
}

function clampStep(n: number): number {
  return Number.isFinite(n) ? Math.min(MAX_CONTEXT_SIZE, Math.max(1, Math.floor(n))) : DEFAULT_CONTEXT_STEP;
}

interface SurroundingGridProps {
  enabled: boolean;
  config: SourceConfig;
  anchor: ContextAnchor;
  columns: SelectedColumn[];
  filters: FilterPill[];
  fieldIndex: FieldIndex;
  fields: FieldModel[];
  fieldsLoading: boolean;
  fieldsError: string | null;
  timeRange: TimeRange;
  onAddFilter: (pill: FilterPill) => void;
  onReanchor: (row: LogRow) => void;
}

/**
 * Grid, load controls and detail panel for one anchor. Rendered with `key={anchor}`, so sizes,
 * steps and the selected row start fresh for every anchor.
 */
function SurroundingGrid({
  enabled,
  config,
  anchor,
  columns,
  filters,
  fieldIndex,
  fields,
  fieldsLoading,
  fieldsError,
  timeRange,
  onAddFilter,
  onReanchor,
}: SurroundingGridProps) {
  const styles = useStyles2(getStyles);
  // Requested neighbours per side and the editable "Load [N]" steps.
  const [newerSize, setNewerSize] = useState(DEFAULT_CONTEXT_STEP);
  const [olderSize, setOlderSize] = useState(DEFAULT_CONTEXT_STEP);
  const [newerStep, setNewerStep] = useState(DEFAULT_CONTEXT_STEP);
  const [olderStep, setOlderStep] = useState(DEFAULT_CONTEXT_STEP);

  const anchorQ = useContextSearch(enabled, config, anchor, 'anchor', 1, columns, NO_FILTERS, fieldIndex, timeRange);
  const newerQ = useContextSearch(enabled, config, anchor, 'newer', newerSize, columns, filters, fieldIndex, timeRange);
  const olderQ = useContextSearch(enabled, config, anchor, 'older', olderSize, columns, filters, fieldIndex, timeRange);

  const anchorRow = anchorQ.rows[0] ?? null;
  // Newest first, like Discover: newer rows arrive ascending (closest first), so reverse them.
  const rows = useMemo(
    () => [...[...newerQ.rows].reverse(), ...(anchorRow ? [anchorRow] : []), ...olderQ.rows],
    [newerQ.rows, anchorRow, olderQ.rows]
  );

  // Detail panel: the same drawer as Discover, hydrated with the row's full columns.
  const [selectedRow, setSelectedRow] = useState<LogRow | null>(null);
  const [hydrated, setHydrated] = useState<{ row: LogRow; full?: LogRow; error?: string } | null>(null);
  const detailSql = selectedRow ? buildLogDetailQuery(config, selectedRow) : '';
  const timeRangeRef = useRef(timeRange);
  useLayoutEffect(() => {
    timeRangeRef.current = timeRange;
  });
  useEffect(() => {
    if (!selectedRow || !detailSql) {
      return;
    }
    let cancelled = false;
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: detailSql,
      timeRange: timeRangeRef.current,
      op: 'detailRow',
    }).then(
      (r) => {
        if (!cancelled) {
          const full = r[0] as LogRow | undefined;
          setHydrated({ row: selectedRow, full, error: full ? undefined : 'Document not found.' });
        }
      },
      (e) => {
        if (!cancelled) {
          setHydrated({ row: selectedRow, error: errMsg(e) });
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [selectedRow, detailSql, config.datasourceUid]);
  const detail = !selectedRow
    ? null
    : !detailSql
      ? { row: selectedRow, full: selectedRow }
      : hydrated?.row === selectedRow
        ? hydrated
        : { row: selectedRow };

  const selectedIndex = selectedRow ? rows.indexOf(selectedRow) : -1;
  const error = anchorQ.error ?? newerQ.error ?? olderQ.error;

  if (error) {
    return <Alert title="Could not load surrounding documents">{error}</Alert>;
  }
  if (enabled && !anchorQ.loading && !anchorRow) {
    return (
      <Alert title="Failed to load the anchor document">
        The document was not found. It may have been deleted, or the link may be from another data view.
      </Alert>
    );
  }
  return (
    <div className={styles.split}>
      <div className={styles.gridColumn}>
        <LoadMore
          direction="newer"
          step={newerStep}
          onStepChange={setNewerStep}
          onLoad={() => setNewerSize((s) => Math.min(MAX_CONTEXT_SIZE, s + clampStep(newerStep)))}
          loaded={newerQ.rows.length}
          requested={newerSize}
          loading={newerQ.loading}
        />
        <div className={styles.grid}>
          <LogsTable
            rows={rows}
            loading={anchorQ.loading && rows.length === 0}
            columns={columns}
            anchorRow={anchorRow}
            selectedRow={selectedRow}
            onRowClick={(row) => setSelectedRow((cur) => (cur === row ? null : row))}
            onAddFilter={onAddFilter}
          />
        </div>
        <LoadMore
          direction="older"
          step={olderStep}
          onStepChange={setOlderStep}
          onLoad={() => setOlderSize((s) => Math.min(MAX_CONTEXT_SIZE, s + clampStep(olderStep)))}
          loaded={olderQ.rows.length}
          requested={olderSize}
          loading={olderQ.loading}
        />
      </div>
      {selectedRow && detail && (
        <div className={styles.drawer}>
          <LogDetailDrawer
            row={selectedRow}
            detailRow={detail.full}
            fieldsLoading={fieldsLoading}
            fieldsError={fieldsError}
            detailError={'error' in detail ? (detail.error ?? null) : null}
            config={config}
            fields={fields}
            columns={columns}
            onClose={() => setSelectedRow(null)}
            onAddFilter={onAddFilter}
            onPrev={selectedIndex > 0 ? () => setSelectedRow(rows[selectedIndex - 1]) : undefined}
            onNext={
              selectedIndex >= 0 && selectedIndex < rows.length - 1
                ? () => setSelectedRow(rows[selectedIndex + 1])
                : undefined
            }
            navLabel={selectedIndex >= 0 ? `${selectedIndex + 1} of ${rows.length}` : undefined}
            onViewSurrounding={selectedRow === anchorRow ? undefined : () => onReanchor(selectedRow)}
          />
        </div>
      )}
    </div>
  );
}

export function ContextView() {
  const styles = useStyles2(getStyles);
  const { viewId = '', anchor: anchorParam } = useParams();
  const anchor = useMemo(() => parseAnchorParam(anchorParam), [anchorParam]);
  const config = useContext(SourceConfigContext);
  const { views, activeView, setActiveViewId } = useContext(DataViewContext);
  const viewExists = views.some((v) => v.id === viewId);
  // The link names its data view: make it the active one (same as Discover's `ds` param).
  useEffect(() => {
    if (viewExists && activeView?.id !== viewId) {
      setActiveViewId(viewId);
    }
  }, [viewExists, activeView?.id, viewId, setActiveViewId]);
  const viewReady = viewExists && activeView?.id === viewId;

  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const urlState = useMemo(() => decodeLogsState(new URLSearchParams(paramsKey)), [paramsKey]);
  const filters = useMemo(() => urlState.filters ?? [], [urlState]);
  const [fallbackRange] = useState(() => getDefaultTimeRange());
  const timeRange = urlState.timeRange ?? fallbackRange;
  const ret = useMemo(() => new URLSearchParams(paramsKey).get('ret'), [paramsKey]);

  const setFilters = useCallback(
    (next: FilterPill[]) => {
      setSearchParams((prev) => {
        const sp = new URLSearchParams(prev);
        const v = encodeLogsState({ search: '', filters: next, columns: [], timeRange }).get('filters');
        if (v) {
          sp.set('filters', v);
        } else {
          sp.delete('filters');
        }
        return sp;
      });
    },
    [setSearchParams, timeRange]
  );
  const addFilter = useCallback((pill: FilterPill) => setFilters(addFilterPill(filters, pill)), [filters, setFilters]);

  const fieldsState = useFieldDiscovery(config, timeRange);
  const fieldIndex = useMemo(() => buildFieldIndex(fieldsState.fields), [fieldsState.fields]);
  const columns = useMemo(
    () => contextColumns(urlState.columns, fieldsState.fields, config),
    [urlState.columns, fieldsState.fields, config]
  );
  const { loadValues } = useAutocompleteSources({
    config,
    query: { ...DEFAULT_LOGS_QUERY_STATE, filters },
    timeRange,
    fieldIndex,
  });

  // Re-anchor on another document (from the detail panel); filters stay as they are now.
  const reanchor = useCallback(
    async (row: LogRow) => {
      try {
        const next = await resolveContextAnchor(config, row, timeRange);
        if (!next) {
          throw new Error('This document could not be found again.');
        }
        locationService.push(
          buildContextUrl({ viewId, anchor: next, filters, columns: urlState.columns ?? [], timeRange, ret: ret ?? '' })
        );
      } catch (e) {
        getAppEvents().publish({
          type: AppEvents.alertError.name,
          payload: [`Could not open surrounding documents: ${errMsg(e)}`],
        });
      }
    },
    [config, timeRange, viewId, filters, urlState.columns, ret]
  );

  let body: React.ReactNode;
  if (!anchor) {
    body = <Alert title="Invalid document link">The link does not name a document.</Alert>;
  } else if (!viewExists) {
    body = <Alert title="Data view not found">{`No data view with id "${viewId}".`}</Alert>;
  } else if (!viewReady || fieldsState.loading) {
    body = <LoadingPlaceholder text="Loading…" />;
  } else if (!config.columns.timestamp) {
    body = <Alert title="No timestamp column">Surrounding documents need a mapped timestamp column.</Alert>;
  } else {
    body = (
      <SurroundingGrid
        key={anchorParam}
        enabled
        config={config}
        anchor={anchor}
        columns={columns}
        filters={filters}
        fieldIndex={fieldIndex}
        fields={fieldsState.fields}
        fieldsLoading={fieldsState.loading}
        fieldsError={fieldsState.error}
        timeRange={timeRange}
        onAddFilter={addFilter}
        onReanchor={reanchor}
      />
    );
  }

  return (
    <FieldsContext.Provider value={fieldsState}>
      <PluginPage layout={PageLayoutType.Custom} pageNav={{ text: 'Surrounding documents' }}>
        <div className={styles.page}>
          <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
            <TextLink href={discoverReturnUrl(ret)} inline={false}>
              Discover
            </TextLink>
            <span aria-hidden>/</span>
            <span aria-current="page">Surrounding documents</span>
          </nav>
          <h2 className={styles.title}>{anchor ? `Documents surrounding #${anchor.id}` : 'Surrounding documents'}</h2>
          {anchor && viewExists && (
            <FilterPills
              filters={filters}
              onChange={setFilters}
              loadValues={loadValues}
              pinTable={tableKey(config.database, config.logsTable)}
            />
          )}
          {body}
        </div>
      </PluginPage>
    </FieldsContext.Provider>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  page: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    height: calc(100vh - 120px);
    min-height: 480px;
  `,
  breadcrumb: css`
    display: flex;
    gap: ${theme.spacing(1)};
    align-items: center;
    color: ${theme.colors.text.secondary};
  `,
  title: css`
    margin: 0;
    font-size: ${theme.typography.h4.fontSize};
    overflow-wrap: anywhere;
  `,
  split: css`
    display: flex;
    gap: ${theme.spacing(1)};
    flex: 1;
    min-height: 0;
  `,
  gridColumn: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    flex: 1;
    min-width: 0;
    min-height: 0;
  `,
  grid: css`
    flex: 1;
    min-height: 0;
    overflow: auto;
  `,
  drawer: css`
    width: 540px;
    max-width: 50%;
    flex-shrink: 0;
    overflow: auto;
    border-left: 1px solid ${theme.colors.border.weak};
  `,
  loadMore: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  status: css`
    color: ${theme.colors.text.secondary};
    margin-left: ${theme.spacing(1)};
  `,
});
