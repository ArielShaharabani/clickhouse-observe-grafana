import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { FieldModel, inferFieldType, parseJsonTypedPaths, parseTupleElements } from '../sql/fieldModel';
import { buildColumnsQuery, buildJsonPathsQuery } from '../sql/introspection';
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

// Module-level cache survives re-renders; cleared on explicit refresh(). Keyed by table only —
// Map *keys* stay on-demand (FieldKeysPopover, backed by sql/keys.ts): reading them costs a scan of
// real row data no matter how the query is written, so they're only paid for when the user clicks
// that column. JSON *paths* are back here at mount (Phase C below) because ClickHouse can answer
// `distinctJSONPaths` from part metadata — see buildJsonPathsQuery's doc comment.
const columnCache = new Map<string, FieldModel[]>();
const textIndexCache = new Map<string, TextIndexInfo[]>();
// Raw system.columns rows backing columnCache's entry, kept alongside it (same key, same
// lifetime/invalidation) purely so detectPruneColumn can re-run against the widened columns
// (default_kind/default_expression/is_in_*_key/position — see introspection.ts's buildColumnsQuery)
// on a cache hit too, without a second round-trip.
const rawColumnCache = new Map<string, PruneCandidateColumn[]>();

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

/**
 * Discovered path list per native-JSON column. Deliberately *not* time-bucket-scoped, unlike the
 * old Phase B/C caches: buildJsonPathsQuery carries no time or filter predicate (a predicate would
 * cost it the metadata fast path), so its answer can't change with the dashboard's time range —
 * re-running it on every coarse-bucket change would be pure waste.
 */
const jsonPathCache = new Map<string, string[]>();

function jsonPathCacheKey(config: SourceConfig, table: string, jsonColumn: string): string {
  return `${columnCacheKey(config, table)}:${jsonColumn}`;
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

/**
 * One JSON column's full path list, straight from `distinctJSONPaths`. The query returns a single
 * `toJSONString(...)` cell rather than an `Array(String)` (see buildJsonPathsQuery) so the result
 * doesn't depend on how the datasource marshals array columns into a DataFrame — hence the parse
 * here. A malformed/absent cell throws, and the caller turns that into a per-column error.
 */
async function fetchJsonPaths(
  config: SourceConfig,
  table: string,
  jsonColumn: string,
  timeRange: TimeRange
): Promise<string[]> {
  const rows = await runQueryRows({
    datasourceUid: config.datasourceUid,
    sql: buildJsonPathsQuery(config, jsonColumn, { table }),
    timeRange,
    op: 'jsonPaths',
  });
  const cell = rows.length > 0 ? String(rows[0]['paths'] ?? '') : '';
  if (!cell) {
    return [];
  }
  const parsed = JSON.parse(cell);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.map((p) => String(p)).filter((p) => p.length > 0);
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
  const { table } = opts;
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

  const bucket = useMemo(() => coarseTimeBucket(timeRange), [timeRange]);

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
      columnCache.delete(cKey);
      textIndexCache.delete(cKey);
      rawColumnCache.delete(cKey);
      // Phase C's cache is keyed per column (`<cKey>:<column>`), so an explicit refresh has to drop
      // every entry under this table — otherwise a schema change that adds a JSON path would keep
      // serving the stale list for the rest of the session.
      for (const key of [...jsonPathCache.keys()]) {
        if (key.startsWith(`${cKey}:`)) {
          jsonPathCache.delete(key);
        }
      }
      // Map-key and value-suggestion caches are sample-scoped (a LIMIT-bounded read of row data,
      // not metadata), so an explicit "reload fields" gesture should drop them too — otherwise a
      // key/value added after the last sample stays invisible even though the user just asked for
      // fresh data.
      clearKeysCacheForTable(config.datasourceUid, resolvedTable);
      clearValuesCacheForTable(config.datasourceUid, resolvedTable);
    }

    // Top-level columns (time-independent, cached per table).
    let columns: FieldModel[];
    let rawColumns: PruneCandidateColumn[];
    if (columnCache.has(cKey)) {
      columns = columnCache.get(cKey)!;
      rawColumns = rawColumnCache.get(cKey) ?? [];
    } else {
      setLoading(true);
      try {
        const rows = await runQueryRows({
          datasourceUid: config.datasourceUid,
          sql: buildColumnsQuery(config, resolvedTable),
          timeRange,
          op: 'columns',
        });
        columns = rows
          .filter((r) => String(r['name'] ?? '').length > 0)
          .map((r) => {
            const name = String(r['name']);
            const chType = String(r['type']);
            const type = inferFieldType(chType);
            return {
              id: `col:${name}`,
              name,
              displayName: name,
              sqlExpr: name,
              type,
              source: 'column' as const,
              rawType: chType,
            };
          });
        rawColumns = rows
          .filter((r) => String(r['name'] ?? '').length > 0)
          .map((r) => ({
            name: String(r['name']),
            type: String(r['type']),
            defaultKind: String(r['default_kind'] ?? ''),
            defaultExpression: String(r['default_expression'] ?? ''),
            isInPartitionKey: Number(r['is_in_partition_key'] ?? 0) === 1,
            isInPrimaryKey: Number(r['is_in_primary_key'] ?? 0) === 1,
            position: Number(r['position'] ?? 0),
          }));
        columnCache.set(cKey, columns);
        rawColumnCache.set(cKey, rawColumns);
      } catch (e) {
        if (runRef.current === runId) {
          setError(errMsg(e));
          setLoading(false);
        }
        return;
      }
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

    // Text skip indexes (cached per table). Best effort: an unreadable system table just means
    // the plain ILIKE forms are used.
    let textIdx = textIndexCache.get(cKey);
    if (!textIdx) {
      try {
        const idxRows = await runQueryRows({
          datasourceUid: config.datasourceUid,
          sql: buildSkipIndicesQuery(config, resolvedTable),
          timeRange,
          op: 'columns',
        });
        textIdx = parseTextIndexes(idxRows);
        textIndexCache.set(cKey, textIdx);
      } catch {
        textIdx = [];
      }
      if (runRef.current !== runId) {
        return;
      }
    }
    setTextIndexes(textIdx);

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
      const jKey = jsonPathCacheKey(config, resolvedTable, col.name);
      const cached = jsonPathCache.get(jKey);
      if (cached) {
        return { col, paths: cached, error: null as string | null };
      }
      try {
        const paths = await fetchJsonPaths(config, resolvedTable, col.name, timeRange);
        jsonPathCache.set(jKey, paths);
        return { col, paths, error: null as string | null };
      } catch (e) {
        // One unreadable JSON column must not cost the user every other field — record it and
        // publish the rest, same as the pre-0.8.0 discovery did.
        return { col, paths: [] as string[], error: errMsg(e) };
      }
    });

    if (runRef.current !== runId) {
      return;
    }

    const jsonFields: FieldModel[] = [];
    for (const { col, paths } of perCol) {
      const declaredTypes = new Map(parseJsonTypedPaths(col.rawType ?? '').map((p) => [p.path, p.type]));
      for (const path of paths) {
        const chType = declaredTypes.get(path);
        jsonFields.push({
          id: `json:${col.name}:${path}`,
          name: path,
          displayName: `${col.name}.${path}`,
          sqlExpr: quoteDottedPath(col.name, path),
          // Dynamic (undeclared) paths have no type here. 'string' is only cosmetic — generated SQL
          // never reads FieldModel.type: equality always string-quotes (kql/toSql.ts's equalsSql)
          // and numeric ranges cast on `kind === 'json'`, which comes from `source`, not `type`.
          type: chType ? inferFieldType(chType) : 'string',
          source: 'json',
          jsonColumn: col.name,
          jsonPath: path,
        });
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
    if (mapCols.length === 0) {
      return;
    }
    const perMap = await runWithConcurrencyLimit(mapCols, DISCOVERY_CONCURRENCY, async (name) => {
      try {
        const res = await loadColumnKeys(config, name, {
          table: resolvedTable,
          conditions: [],
          timeRange,
          cacheKey: 'fields',
        });
        return res.keys
          .map((k) => k.key)
          .sort((a, b) => a.localeCompare(b))
          .slice(0, MAX_MAP_KEY_FIELDS)
          .map((key) => buildMapKeyField(name, { key }));
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
