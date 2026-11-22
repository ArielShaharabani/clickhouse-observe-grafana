import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { FieldModel, inferFieldType, parseJsonTypedPaths, parseTupleElements } from '../sql/fieldModel';
import { buildColumnsQuery, buildDiscoveryWindows, buildJsonPathsQuery, buildJsonPathTypesSampleQuery } from '../sql/introspection';
import { jsonPathField, parseJsonPathTypes } from '../sql/jsonPaths';
import { hasFreshMetadata, invalidateMetadata, loadMetadata } from '../sql/metadataCache';
import { quoteDottedPath } from '../sql/queryBuilder';
import { buildSkipIndicesQuery, parseTextIndexes, TextIndexInfo } from '../sql/textIndex';
import { detectPruneColumn, PruneCandidateColumn } from '../sql/pruneColumn';
import { runQueryRows } from '../data/runQuery';
import { SourceConfig } from '../types';
import { errMsg } from '../errMsg';
import { coarseTimeBucket } from '../sql/timeBucket';
import { buildMapKeyField, clearKeysCacheForTable, loadColumnKeys, MAX_MAP_KEY_FIELDS } from '../sql/keys';
import { clearValuesCacheForTable } from '../sql/kql/_values';

// Re-exported for existing importers (FieldSidebar/FieldKeysPopover, sql/keys.ts,
// sql/kql/_values.ts) — the implementation itself now lives in sql/timeBucket.ts, which this file
// also depends on, to avoid a cycle with sql/keys.ts (see that module's cache-clear helpers below).
export { coarseTimeBucket };

// Schema queries (system.columns, JSON paths) go through the shared metadata layer
// (sql/metadataCache.ts): one in-flight request per datasource+database+table+kind, reused for the
// session and cleared on explicit refresh(). Map *keys* stay a separate, time-scoped sample
// (sql/keys.ts) — reading them costs real row data, so they're bounded to the current time window.
interface ColumnsResult {
  columns: FieldModel[];
  rawColumns: PruneCandidateColumn[];
}

function columnCacheKey(config: SourceConfig, table: string): string {
  return `${config.datasourceUid}:${config.database}:${table}`;
}

/** Identifies the table a discovery result belongs to; compare with `FieldDiscoveryResult.fieldsFor`. */
export function discoveryKey(
  config: Pick<SourceConfig, 'datasourceUid' | 'database' | 'logsTable'>,
  table?: string
): string {
  return `${config.datasourceUid}:${config.database}:${table ?? config.logsTable}`;
}

/** Max JSON-path discovery queries in flight at once — one per JSON column, so a wide schema
 *  doesn't open a connection per column at mount. */
const DISCOVERY_CONCURRENCY = 4;

/** Map columns whose keys are published as fields (the cap bounds the discovery queries of a wide schema). */
const MAX_MAP_COLUMNS = 6;

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Used by this file's Phase C
 * (JSON-path discovery) and by CreateDataViewModal's "Guess with AI" JSON-path scan. `fn` is
 * expected to handle its own errors — a rejection from `fn` propagates out of this function same
 * as Promise.all.
 */
export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** One JSON column's discovered paths, plus the types the bounded sample saw for its dynamic paths. */
export interface JsonPathsResult {
  paths: string[];
  types: Map<string, string[]>;
}

/** Parses a `toJSONString(<array>)` cell into its non-empty strings; a malformed/absent cell throws. */
function parsePathList(cell: string): string[] {
  if (!cell) {
    return [];
  }
  const parsed = JSON.parse(cell);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((p) => String(p)).filter((p) => p.length > 0);
}

/**
 * One JSON column's full path list, straight from `distinctJSONPaths` (see buildJsonPathsQuery:
 * one `toJSONString(...)` cell, so the result doesn't depend on how the datasource marshals array
 * columns), run alongside the bounded type sample (buildJsonPathTypesSampleQuery). The sample gives
 * the dynamic paths their types; it also stands in for the path list when the whole-table query
 * fails (a timeout on a server without the paths-only optimization), so one slow query no longer
 * leaves the column with no fields. Throws only when both fail.
 */
async function fetchJsonPathsUncached(
  config: SourceConfig,
  table: string,
  jsonColumn: string,
  timeRange: TimeRange
): Promise<JsonPathsResult> {
  const [full, sample] = await Promise.allSettled([
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: buildJsonPathsQuery(config, jsonColumn, { table }),
      timeRange,
      op: 'jsonPaths',
    }).then((rows) => parsePathList(rows.length > 0 ? String(rows[0]['paths'] ?? '') : '')),
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: buildJsonPathTypesSampleQuery(config, jsonColumn, { table }),
      timeRange,
      op: 'jsonPaths',
    }).then((rows) => parseJsonPathTypes(rows.length > 0 ? String(rows[0]['types'] ?? '') : '')),
  ]);
  const types = sample.status === 'fulfilled' ? sample.value : new Map<string, string[]>();
  if (full.status === 'fulfilled') {
    return { paths: full.value, types };
  }
  if (sample.status === 'fulfilled') {
    return { paths: [...types.keys()].sort(), types };
  }
  throw full.reason;
}

/** Fetches (shared, cached) the column list + prune-candidate rows of a table. */
async function fetchColumns(config: SourceConfig, table: string, timeRange: TimeRange): Promise<ColumnsResult> {
  return loadMetadata(
    { datasourceUid: config.datasourceUid, database: config.database, table, kind: 'columns' },
    async () => {
      const rows = await runQueryRows({
        datasourceUid: config.datasourceUid,
        sql: buildColumnsQuery(config, table),
        timeRange,
        op: 'columns',
      });
      const named = rows.filter((r) => String(r['name'] ?? '').length > 0);
      const columns: FieldModel[] = named.map((r) => {
        const name = String(r['name']);
        const chType = String(r['type']);
        return {
          id: `col:${name}`,
          name,
          displayName: name,
          sqlExpr: name,
          type: inferFieldType(chType),
          source: 'column' as const,
          rawType: chType,
        };
      });
      const rawColumns: PruneCandidateColumn[] = named.map((r) => ({
        name: String(r['name']),
        type: String(r['type']),
        defaultKind: String(r['default_kind'] ?? ''),
        defaultExpression: String(r['default_expression'] ?? ''),
        isInPartitionKey: Number(r['is_in_partition_key'] ?? 0) === 1,
        isInPrimaryKey: Number(r['is_in_primary_key'] ?? 0) === 1,
        position: Number(r['position'] ?? 0),
      }));
      return { columns, rawColumns };
    }
  );
}

/** Fetches (shared, cached) one JSON column's path list. */
function fetchJsonPaths(config: SourceConfig, table: string, jsonColumn: string, timeRange: TimeRange): Promise<JsonPathsResult> {
  return loadMetadata(
    { datasourceUid: config.datasourceUid, database: config.database, table, kind: 'jsonPaths', detail: jsonColumn },
    () => fetchJsonPathsUncached(config, table, jsonColumn, timeRange)
  );
}

// Text skip indexes per table (PERF-SEARCH), same lifetime as the metadata cache.
const textIndexCache = new Map<string, TextIndexInfo[]>();
/** Lookups in flight, so concurrent discoveries of one table share one request. */
const textIndexInFlight = new Map<string, Promise<TextIndexInfo[]>>();

/** The table's text skip indexes: cached, shared while in flight; a failure is [] and not cached. */
function loadTextIndexes(
  config: SourceConfig,
  table: string,
  timeRange: TimeRange,
  cKey: string
): Promise<TextIndexInfo[]> {
  const cached = textIndexCache.get(cKey);
  if (cached) {
    return Promise.resolve(cached);
  }
  const pending = textIndexInFlight.get(cKey);
  if (pending) {
    return pending;
  }
  const p = runQueryRows({
    datasourceUid: config.datasourceUid,
    sql: buildSkipIndicesQuery(config, table),
    timeRange,
    op: 'columns',
  })
    .then(
      (rows) => {
        const parsed = parseTextIndexes(rows);
        textIndexCache.set(cKey, parsed);
        return parsed;
      },
      () => [] as TextIndexInfo[]
    )
    .finally(() => textIndexInFlight.delete(cKey));
  textIndexInFlight.set(cKey, p);
  return p;
}

interface FieldsContextValue {
  fields: FieldModel[];
  /** Text skip indexes on the table (read-only discovery; empty when none / unreadable). */
  textIndexes?: TextIndexInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY_FIELDS_CONTEXT: FieldsContextValue = {
  fields: [],
  loading: false,
  error: null,
  refresh: () => {},
};

// Exported (not just useFields()) so pages that need the same discovered fields for query
// building — not just for descendant consumers like FieldSidebar/SearchBar — can call
// useFieldDiscovery() once and hand the value to <FieldsContext.Provider> directly.
export const FieldsContext = createContext<FieldsContextValue>(EMPTY_FIELDS_CONTEXT);

export function useFields(): FieldsContextValue {
  return useContext(FieldsContext);
}

export interface FieldDiscoveryOpts {
  /** Table to introspect. Defaults to config.logsTable (existing Logs behavior). */
  table?: string;
  /**
   * Phase A + B only (columns and the prune-column detection): no JSON-path or Map-key discovery,
   * no re-run on time range changes. For App.tsx's bootstrap, which only needs
   * `detectedPartitionTimestamp` — the page's own discovery shares the same `system.columns`
   * request through the metadata layer and owns the field lists.
   */
  columnsOnly?: boolean;
  /**
   * Look up the table's text skip indexes (default true). Visualize passes false: its queries do
   * not use them, so the lookup would only add a query to every open (round 3 #8).
   */
  textIndexes?: boolean;
}

export interface FieldDiscoveryResult extends FieldsContextValue {
  /**
   * Auto-detected coarse index-pruning column for `config.columns.timestamp` (see
   * sql/pruneColumn.ts), or `''` when none qualifies. App.tsx reads this to fill in
   * `columns.partitionTimestamp` at runtime when the persisted value is `''` (auto-detect) — see
   * SourceConfigContext's doc comment — so already-saved views benefit without re-saving.
   */
  detectedPartitionTimestamp: string;
  /**
   * `discoveryKey` of the table `fields` were discovered for ('' before the first result). After a
   * data view switch, `fields` still holds the previous table's fields until the new discovery
   * publishes — a consumer that must not mix the two (Visualize) waits until this matches.
   */
  fieldsFor: string;
}

/**
 * Discovers the fields of a table, in three phases:
 *
 *   A. top-level columns — one `system.columns` query, cached per table;
 *   B. Tuple elements — synchronous parse of the type strings A already fetched, no query;
 *   C. paths inside native JSON columns — one `distinctJSONPaths` query per JSON column, cached
 *      per column, published as first-class `source: 'json'` fields.
 *
 * Map keys are the deliberate exception: they stay on-demand (FieldKeysPopover → sql/keys.ts,
 * `buildMapKeysQuery`), because listing them always costs a scan of real row data, while Phase C's
 * query is answered from part metadata (see buildJsonPathsQuery's doc comment for the exact
 * conditions that keeps true — chiefly: it must carry no WHERE).
 */
export function useFieldDiscovery(
  config: SourceConfig,
  timeRange: TimeRange,
  opts: FieldDiscoveryOpts = {}
): FieldDiscoveryResult {
  const { table, columnsOnly = false, textIndexes: wantTextIndexes = true } = opts;
  const resolvedTable = table ?? config.logsTable;
  const [fields, setFields] = useState<FieldModel[]>([]);
  // Starts true (not false): discovery always kicks off on mount once datasourceUid is known, so
  // an initial `false` is indistinguishable from "already checked, found nothing" to consumers
  // like BreakdownPicker's severity-fallback guard — that false-negative made it permanently
  // downgrade the severity breakdown to "none" on every fresh load, before fields even arrived.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detectedPartitionTimestamp, setDetectedPartitionTimestamp] = useState('');
  const [fieldsFor, setFieldsFor] = useState('');
  const [textIndexes, setTextIndexes] = useState<TextIndexInfo[]>([]);
  const runRef = useRef(0);

  const bucket = useMemo(() => (columnsOnly ? '' : coarseTimeBucket(timeRange)), [timeRange, columnsOnly]);

  async function loadFields(invalidateColumns = false) {
    if (!config.datasourceUid) {
      // No datasource configured yet — nothing to discover. Without this, `loading` (which
      // starts true) never resolves, so sidebar/pickers spin forever until a datasource shows up.
      setFields([]);
      setFieldsFor(columnCacheKey(config, resolvedTable));
      setLoading(false);
      return;
    }
    const runId = ++runRef.current;
    const cKey = columnCacheKey(config, resolvedTable);

    if (invalidateColumns) {
      invalidateMetadata(config.datasourceUid, config.database, resolvedTable);
      textIndexCache.delete(cKey);
      // Map-key and value-suggestion caches are sample-scoped (a LIMIT-bounded read of row data,
      // not metadata), so an explicit "reload fields" gesture should drop them too — otherwise a
      // key/value added after the last sample stays invisible even though the user just asked for
      // fresh data.
      clearKeysCacheForTable(config.datasourceUid, resolvedTable);
      clearValuesCacheForTable(config.datasourceUid, resolvedTable);
    }

    // Text skip indexes (cached per table), looked up alongside the columns rather than after them:
    // both are metadata reads, so a page waits one round trip instead of two. Best effort: an
    // unreadable system table just means the plain ILIKE forms are used.
    const textIdxPromise: Promise<TextIndexInfo[]> =
      columnsOnly || !wantTextIndexes
        ? Promise.resolve([])
        : loadTextIndexes(config, resolvedTable, timeRange, cKey);

    // Top-level columns (time-independent, shared + cached per table by the metadata layer).
    let columns: FieldModel[];
    let rawColumns: PruneCandidateColumn[];
    if (!hasFreshMetadata({ datasourceUid: config.datasourceUid, database: config.database, table: resolvedTable, kind: 'columns' })) {
      setLoading(true);
    }
    try {
      ({ columns, rawColumns } = await fetchColumns(config, resolvedTable, timeRange));
    } catch (e) {
      if (runRef.current === runId) {
        setError(errMsg(e));
        setLoading(false);
      }
      return;
    }

    if (runRef.current !== runId) {
      return;
    }

    // Phase B — Tuple elements. Unlike Map keys or JSON paths, no query is needed: a Tuple's
    // element list is fully determined by the type string Phase A already fetched
    // (system.columns), so this is a synchronous parse, not a scan.
    // See parseTupleElements' doc comment (sql/fieldModel.ts) for the one-level-flatten boundary.
    const tupleFields: FieldModel[] = [];
    for (const col of columns) {
      if (col.type !== 'tuple' || !col.rawType) {
        continue;
      }
      for (const el of parseTupleElements(col.rawType)) {
        tupleFields.push({
          id: `tuple:${col.name}:${el.name}`,
          name: el.name,
          displayName: `${col.name}.${el.name}`,
          sqlExpr: quoteDottedPath(col.name, el.name),
          type: inferFieldType(el.type),
          source: 'tuple',
          tupleColumn: col.name,
        });
      }
    }

    const detected = detectPruneColumn(rawColumns, config.columns.timestamp) ?? '';

    // Publish what's already known before Phase C runs, so the sidebar paints immediately instead
    // of waiting on a round-trip per JSON column. `loading` deliberately stays true until Phase C
    // settles — LogDetailDrawer blocks on it, and BreakdownPicker's severity guard reads it.
    if (runRef.current !== runId) {
      return;
    }
    setFields([...columns, ...tupleFields]);
    setFieldsFor(cKey);
    setError(null);
    setDetectedPartitionTimestamp(detected);
    if (columnsOnly) {
      setLoading(false);
      return;
    }

    const textIdx = await textIdxPromise;
    if (runRef.current !== runId) {
      return;
    }
    setTextIndexes(textIdx);

    // Phase C — paths inside native JSON columns, one query per column, cached per column for the
    // session (the query is time- and filter-independent). Each path becomes a first-class field,
    // so the sidebar, KQL field/value completion, filter editor and add-as-column all pick it up
    // from `fields` with no further work. Types come from the column's own declared JSON(...)
    // paths, not from the query: `distinctJSONPathsAndTypes` isn't covered by the subcolumn
    // optimization the bare variant relies on, so asking for types would cost a full column scan.
    const jsonCols = columns.filter((c) => c.type === 'json');
    if (jsonCols.length === 0) {
      setLoading(false);
      await publishMapKeys(columns, tupleFields, [], runId);
      return;
    }

    const perCol = await runWithConcurrencyLimit(jsonCols, DISCOVERY_CONCURRENCY, async (col) => {
      try {
        const { paths, types } = await fetchJsonPaths(config, resolvedTable, col.name, timeRange);
        return { col, paths, types, error: null as string | null };
      } catch (e) {
        // One unreadable JSON column must not cost the user every other field — record it and
        // publish the rest, same as the pre-0.8.0 discovery did.
        return { col, paths: [] as string[], types: new Map<string, string[]>(), error: errMsg(e) };
      }
    });

    if (runRef.current !== runId) {
      return;
    }

    const jsonFields: FieldModel[] = [];
    for (const { col, paths, types } of perCol) {
      const declaredTypes = new Map(parseJsonTypedPaths(col.rawType ?? '').map((p) => [p.path, p.type]));
      for (const path of paths) {
        // Declared paths keep their declared type; dynamic ones are read as the typed subcolumn the
        // sample saw (or stay a bare 'string' Dynamic) — see sql/jsonPaths.ts.
        jsonFields.push(jsonPathField(col.name, path, declaredTypes.get(path), types.get(path)));
      }
    }

    const failedCols = perCol.filter((r) => r.error).map((r) => r.col.name);
    // Columns stay first in the published array: buildFieldIndex (sql/fields.ts) is first-wins on
    // `byName`, so a real column keeps its bare name against a same-named JSON path.
    setFields([...columns, ...tupleFields, ...jsonFields]);
    setFieldsFor(cKey);
    setError(
      failedCols.length > 0
        ? `Field discovery failed for: ${failedCols.join(', ')}. Some JSON attribute fields may be missing.`
        : null
    );
    setLoading(false);
    await publishMapKeys(columns, tupleFields, jsonFields, runId);
  }

  // Phase D — Map keys as first-class fields (Kibana parity: `ResourceAttributes.host.name`).
  // Published after everything else and never blocking: a failed or slow key sample must not cost
  // the user the fields already shown. The sample is the table's latest rows (no filters), capped
  // per column, so the list is stable across search / filter changes.
  async function publishMapKeys(
    columns: FieldModel[],
    tupleFields: FieldModel[],
    jsonFields: FieldModel[],
    runId: number
  ) {
    const mapCols = columns
      .filter((c) => c.type === 'map')
      .map((c) => c.name)
      .slice(0, MAX_MAP_COLUMNS);
    const mapTypes = new Map(columns.map((c) => [c.name, c.rawType] as const));
    if (mapCols.length === 0) {
      return;
    }
    const windows = buildDiscoveryWindows(config, timeRange.to.valueOf() - timeRange.from.valueOf());
    const perMap = await runWithConcurrencyLimit(mapCols, DISCOVERY_CONCURRENCY, async (name) => {
      try {
        const res = await loadColumnKeys(config, name, {
          table: resolvedTable,
          // Time-bounded (latest hour of the range first, widened while the sample finds nothing) — never a
          // whole-table read; see buildDiscoveryWindows.
          conditions: windows[0],
          fallbackWindows: windows.slice(1),
          timeRange,
          cacheKey: 'fields',
        });
        return res.keys
          .map((k) => k.key)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_MAP_KEY_FIELDS)
          .map((key) => buildMapKeyField(name, { key }, mapTypes.get(name)));
      } catch {
        return [] as FieldModel[];
      }
    });
    if (runRef.current !== runId) {
      return;
    }
    const mapFields = perMap.flat();
    if (mapFields.length > 0) {
      setFields([...columns, ...tupleFields, ...jsonFields, ...mapFields]);
    }
  }

  const refresh = () => loadFields(true);

  // loadFields fetches columns and mirrors the result into state — an external fetch synced to
  // React, not a render-time update.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.datasourceUid, config.database, resolvedTable, bucket, config.columns.timestamp]);

  return { fields, textIndexes, loading, error, refresh, detectedPartitionTimestamp, fieldsFor };
}
