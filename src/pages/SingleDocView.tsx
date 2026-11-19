/**
 * Single document (PARITY-GRID, Kibana's "View single document"): one document named by its
 * ContextAnchor, route `doc/<dataViewId>/<ns>_<id>` (see data/surrounding.ts buildSingleDocUrl).
 * The path is untrusted URL input: parseAnchorParam accepts only two bounded decimal numbers, and
 * the lookup query (buildDocumentByAnchorQuery) re-validates them. The document opens in the same
 * detail panel as Discover, full width; a filter action returns to Discover with that filter.
 */
import React, { useContext, useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { css } from '@emotion/css';
import { getDefaultTimeRange, GrafanaTheme2, PageLayoutType } from '@grafana/data';
import { locationService, PluginPage } from '@grafana/runtime';
import { Alert, LoadingPlaceholder, TextLink, useStyles2 } from '@grafana/ui';
import { DataViewContext, SourceConfigContext } from '../components/App/App';
import { FieldsContext, useFieldDiscovery } from '../components/FieldsContext';
import { LogDetailDrawer } from '../components/LogDetailDrawer';
import { buildContextUrl, discoverReturnUrl, parseAnchorParam } from '../data/surrounding';
import { decodeLogsState } from '../data/urlState';
import { runQueryRows } from '../data/runQuery';
import { buildDocumentByAnchorQuery, CORE_ALIAS } from '../sql/queryBuilder';
import { addFilterPill } from '../sql/filters';
import { defaultColumns } from '../data/columns';
import { errMsg } from '../errMsg';
import { FilterPill, LogRow } from '../types';

/** Discover URL (the `ret` context) with one more filter. `ret` is re-serialized as parameters. */
export function discoverWithFilter(ret: string | null, pill: FilterPill): string {
  const sp = new URLSearchParams(ret ?? '');
  // decodeLogsState sanitizes the untrusted filters; Discover sanitizes them again on load.
  const current = decodeLogsState(sp).filters ?? [];
  sp.set('filters', JSON.stringify(addFilterPill(current, pill)));
  return discoverReturnUrl(sp.toString());
}

export function SingleDocView() {
  const styles = useStyles2(getStyles);
  const { viewId = '', anchor: anchorParam } = useParams();
  const anchor = useMemo(() => parseAnchorParam(anchorParam), [anchorParam]);
  const config = useContext(SourceConfigContext);
  const { views, activeView, setActiveViewId } = useContext(DataViewContext);
  const viewExists = views.some((v) => v.id === viewId);
  useEffect(() => {
    if (viewExists && activeView?.id !== viewId) {
      setActiveViewId(viewId);
    }
  }, [viewExists, activeView?.id, viewId, setActiveViewId]);
  const viewReady = viewExists && activeView?.id === viewId;

  const [searchParams] = useSearchParams();
  const paramsKey = searchParams.toString();
  const urlState = useMemo(() => decodeLogsState(new URLSearchParams(paramsKey)), [paramsKey]);
  const [fallbackRange] = useState(() => getDefaultTimeRange());
  const timeRange = urlState.timeRange ?? fallbackRange;
  const ret = useMemo(() => new URLSearchParams(paramsKey).get('ret'), [paramsKey]);
  const fieldsState = useFieldDiscovery(config, timeRange);

  const sql = anchor && viewReady ? buildDocumentByAnchorQuery(config, anchor) : '';
  const [result, setResult] = useState<{ sql: string; row?: LogRow; error?: string } | null>(null);
  useEffect(() => {
    if (!sql) {
      return;
    }
    const abort = new AbortController();
    runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange, op: 'detailRow', signal: abort.signal }).then(
      (rows) => setResult({ sql, row: rows[0] as LogRow | undefined }),
      (e) => {
        if (!abort.signal.aborted) {
          setResult({ sql, error: errMsg(e) });
        }
      }
    );
    return () => abort.abort();
    // The SQL names everything the lookup depends on; the time range is not a filter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, config.datasourceUid]);
  const current = result?.sql === sql ? result : null;
  // The panel's header reads the grid-style time alias; the body reads the full row.
  const headerRow = useMemo<LogRow | null>(() => {
    const full = current?.row;
    if (!full) {
      return null;
    }
    return { [CORE_ALIAS.timestamp]: full[CORE_ALIAS.timestamp] ?? full[config.columns.timestamp] };
  }, [current, config.columns.timestamp]);

  let body: React.ReactNode;
  if (!anchor) {
    body = <Alert title="Invalid document link">The link does not name a document.</Alert>;
  } else if (!viewExists) {
    body = <Alert title="Data view not found">{`No data view with id "${viewId}".`}</Alert>;
  } else if (!config.columns.timestamp && viewReady) {
    body = <Alert title="No timestamp column">A document link needs a mapped timestamp column.</Alert>;
  } else if (!viewReady || !current) {
    body = <LoadingPlaceholder text="Loading document…" />;
  } else if (current.error) {
    body = <Alert title="Could not load the document">{current.error}</Alert>;
  } else if (!current.row || !headerRow) {
    body = (
      <Alert title="Document not found">
        The document was not found. It may have been deleted, or the link may be from another data view.
      </Alert>
    );
  } else {
    body = (
      <div className={styles.panel}>
        <LogDetailDrawer
          row={headerRow}
          detailRow={current.row}
          fieldsLoading={fieldsState.loading}
          fieldsError={fieldsState.error}
          config={config}
          fields={fieldsState.fields}
          columns={defaultColumns(config)}
          onClose={() => locationService.push(discoverReturnUrl(ret))}
          onAddFilter={(pill) => locationService.push(discoverWithFilter(ret, pill))}
          onViewSurrounding={() =>
            locationService.push(
              buildContextUrl({ viewId, anchor, filters: [], columns: [], timeRange, ret: ret ?? '' })
            )
          }
        />
      </div>
    );
  }

  return (
    <FieldsContext.Provider value={fieldsState}>
      <PluginPage layout={PageLayoutType.Custom} pageNav={{ text: 'Single document' }}>
        <div className={styles.page}>
          <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
            <TextLink href={discoverReturnUrl(ret)} inline={false}>
              Discover
            </TextLink>
            <span aria-hidden>/</span>
            <span aria-current="page">Single document</span>
          </nav>
          <h2 className={styles.title}>{anchor ? `Document #${anchor.id}` : 'Single document'}</h2>
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
  panel: css`
    height: calc(100vh - 200px);
    min-height: 420px;
  `,
});
