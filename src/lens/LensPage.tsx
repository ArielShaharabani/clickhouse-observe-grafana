/**
 * Visualize (Lens) page — specs LENS-START-01, LENS-AUTO-01, LENS-SUGG-01 (docs/spec/20-lens.md).
 *
 * Field list (left) → workspace chart (centre) + suggestions strip → dimension groups (right).
 * Shares the search context with Discover through the URL (q, filters, from/to); the Lens state
 * itself lives in the `lens` param so an unsaved visualization survives a refresh (IT-K).
 */
import React, { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import { dateTime, GrafanaTheme2, IconName, locationUtil, TimeRange } from '@grafana/data';
import { locationService } from '@grafana/runtime';
import { Alert, Button, Icon, IconButton, Input, LinkButton, Spinner, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { DataViewContext, SourceConfigContext } from '../components/App/App';
import { discoveryKey, FieldsContext, useFieldDiscovery } from '../components/FieldsContext';
import { DataViewPicker } from '../components/DataViewPicker/DataViewPicker';
import { FIELD_TYPE_ICONS } from '../components/FieldSidebar/fieldIcons';
import { FIELD_DRAG_MIME } from '../constants';
import { decodeLogsState, encodeLogsState } from '../data/urlState';
import { runQueryRows } from '../data/runQuery';
import { ResultCache } from './resultCache';
import { buildFieldIndex } from '../sql/fields';
import { buildWhereConditions } from '../sql/queryBuilder';
import { filtersForViewSwitch, loadPinnedFilters, mergePinnedFilters, tableKey } from '../state/sharedSearch';
import { hasSearchContext, rememberSearchContext, restoreSearchContext } from '../state/lastSearch';
import { visualizeEntry } from './entry';
import { discoverBreakdownOf, discoverColumns, discoverIntervalOf, discoverUrl, lensContextFor } from './handoff';
import { buildLensPanel, defaultPanelTitle } from './panelExport';
import { SaveActions } from './SaveActions';
import { FilterPills } from '../components/FilterPills';
import { QueryRow, withQuery } from './QueryRow';
import { LoadedQuery } from '../components/QueryMenu/QueryMenu';
import { parseKql } from '../sql/kql';
import { useAutocompleteSources } from '../autocomplete/service';
import { addFilterPill, makeFilter, sanitizeFilterPills } from '../sql/filters';
import { FilterChoice, FilterChooser } from './FilterChooser';
import { XySelection, xLabel } from './render/XyChart';
import { DEFAULT_LOGS_QUERY_STATE, FilterPill } from '../types';
import { compileLens, LensResult, realKey, shapeLensRows } from './compile';
import { LensChart } from './render/LensChart';
import { CHART_ICONS, ChartTypeSwitcher } from './ChartTypeSwitcher';
import { StylePanel, StyleToolbar, StyleView } from './StylePanel';
import { DimensionEditor } from './DimensionEditor';
import { LensInterval, stepBucket } from './interval';
import { addBucket, addMetric, metricForField, nextBucketField, queryShape, replaceDim } from './dimensions';
import { withSeriesColor } from './style';
import {
  BucketDim,
  calculationError,
  decodeLens,
  dimLabelIn,
  dropMissingRankMetric,
  EMPTY_LENS,
  encodeLens,
  isEmptyLens,
  LensField,
  LensState,
  MetricDim,
  RECORDS_FIELD,
  sanitizeLens,
} from './state';
import {
  addField,
  chartKind,
  chartTitle,
  chooseChart,
  isLensField,
  isXy,
  LensContext,
  suggestions,
  switchChart,
  switchKind,
} from './suggest';
import { shiftTimeRange, zoomOutTimeRange } from '../utils/timeRangeNav';
import { QueryProgress } from '../components/QueryProgress/QueryProgress';
import { lensApproxNote } from './approx';
import { LensInspector } from './Inspector';
import { DND_INSTRUCTIONS, DropTarget, useKeyboardDrag } from './keyboardDnd';
import { LiveRegion, srOnly } from '../components/a11y/dialog';
import { LayerItemEditor, LayerItemRef, LayersSection } from './LayerPanel';
import { ExtraLayer } from './layers';
import { useLayerData } from './useLayerData';
import { DefaultTimeRangeContext, resolveDefaultTimeRange } from '../utils/defaultTimeRange';
import { panelSourceOf } from './panelSource';
import { gaugeAutoMax } from './render/gaugeSpec';
import { GaugePanel } from './GaugePanel';

interface Group {
  name: string;
  /** What the group's "+ Add" slot adds. */
  role: 'metric' | 'bucket';
  dims: Array<BucketDim | MetricDim>;
  /** Holds several dimensions (the slot stays after the first). */
  multi?: boolean;
  /** What a dimension added here is marked as (LENS-CHART-01): a Table pivot, a Metric chart maximum. */
  tag?: 'pivot' | 'max';
}

/** Dimension groups as each chart type names them (LENS-DIM-01). */
export function dimensionGroups(s: LensState): Group[] {
  const [b0, b1] = s.buckets;
  const opt = (d?: BucketDim) => (d ? [d] : []);
  switch (s.chartType) {
    case 'line':
    case 'area':
    case 'bar': {
      // Horizontal bars: the categories run down the vertical axis, the values along the horizontal one.
      const flip = chartKind(s) === 'bar_horizontal';
      return [
        { name: flip ? 'Vertical axis' : 'Horizontal axis', role: 'bucket', dims: opt(b0) },
        { name: flip ? 'Horizontal axis' : 'Vertical axis', role: 'metric', dims: s.metrics, multi: true },
        { name: 'Breakdown', role: 'bucket', dims: b0 ? opt(b1) : [] },
      ];
    }
    case 'table':
      return [
        { name: 'Rows', role: 'bucket', dims: s.buckets.filter((b) => !b.pivot), multi: true },
        { name: 'Split metrics by', role: 'bucket', dims: s.buckets.filter((b) => b.pivot), multi: true, tag: 'pivot' },
        { name: 'Metrics', role: 'metric', dims: s.metrics, multi: true },
      ];
    case 'metric': {
      const values = s.metrics.filter((m) => m.role !== 'max');
      return [
        { name: 'Primary metric', role: 'metric', dims: values.slice(0, 1) },
        { name: 'Secondary metric', role: 'metric', dims: values.slice(1, 2) },
        {
          name: 'Maximum value',
          role: 'metric',
          dims: s.metrics.filter((m) => m.role === 'max').slice(0, 1),
          tag: 'max',
        },
        { name: 'Break down by', role: 'bucket', dims: opt(b0) },
      ];
    }
    case 'pie':
    case 'donut':
      return [
        { name: 'Slice by', role: 'bucket', dims: s.buckets },
        { name: 'Size by', role: 'metric', dims: s.metrics },
      ];
    case 'heatmap':
      return [
        { name: 'Horizontal axis', role: 'bucket', dims: opt(b0) },
        { name: 'Vertical axis', role: 'bucket', dims: b0 ? opt(b1) : [] },
        { name: 'Cell value', role: 'metric', dims: s.metrics.slice(0, 1) },
      ];
    case 'gauge':
      return [
        { name: 'Metric', role: 'metric', dims: s.metrics.filter((m) => m.role !== 'max').slice(0, 1) },
        {
          name: 'Maximum value',
          role: 'metric',
          dims: s.metrics.filter((m) => m.role === 'max').slice(0, 1),
          tag: 'max',
        },
        { name: 'Break down by', role: 'bucket', dims: opt(b0) },
      ];
  }
}

/** Rows of recent identical queries (PERF-QUERIES #5). */
const lensRowCache = new ResultCache<Awaited<ReturnType<typeof runQueryRows>>>();

export function LensPage() {
  const styles = useStyles2(getStyles);
  const config = useContext(SourceConfigContext);
  const defaultTime = useContext(DefaultTimeRangeContext);
  const { activeView, views, setActiveViewId } = useContext(DataViewContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();

  // Entry (#16b / #16c): restore the tab's last context when the URL has none, apply the URL's
  // data view, merge pins — computed once, applied in ONE URL update below. The chart comes from
  // the URL only: a fresh open starts empty (as Kibana), a reload keeps it.
  const [entry] = useState(() =>
    visualizeEntry({
      params: searchParams,
      views,
      activeView,
      storedPins: loadPinnedFilters(),
      restoreContext: restoreSearchContext,
    })
  );
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (entry.params.toString() !== searchParams.toString()) {
      setSearchParams(entry.params, { replace: true });
    }
    if (entry.view && entry.view.id !== activeView?.id) {
      setActiveViewId(entry.view.id);
    }
    // Mount-once flag: what the page reads before this has applied is not its entry state yet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntered(true);
    // Once, at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The page is on its view once the entry's view is active (App applies it a render later).
  // Latched: after that, a switch from the picker must not un-settle the page, or the switch
  // effect below would never run for it.
  const entryViewActive = entered && (!entry.view || activeView?.id === entry.view.id);
  const [settledOnce, setSettledOnce] = useState(false);
  useEffect(() => {
    if (entryViewActive && !settledOnce) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSettledOnce(true);
    }
  }, [entryViewActive, settledOnce]);
  const viewSettled = settledOnce || entryViewActive;
  useEffect(() => {
    if (!entered) {
      return;
    }
    const sp = new URLSearchParams(paramsKey);
    if (hasSearchContext(sp)) {
      rememberSearchContext(sp);
      return;
    }
    // The side-menu link clicked while already on Visualize: same page, URL emptied — enter again.
    const again = visualizeEntry({
      params: sp,
      views,
      activeView,
      storedPins: loadPinnedFilters(),
      restoreContext: restoreSearchContext,
    });
    if (again.params.toString() !== sp.toString()) {
      setSearchParams(again.params, { replace: true });
    }
    if (again.view && again.view.id !== activeView?.id) {
      setActiveViewId(again.view.id);
    }
    // Driven by the URL only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, entered]);

  // Shared search context from the URL (same params as Discover).
  const urlState = useMemo(() => decodeLogsState(new URLSearchParams(paramsKey)), [paramsKey]);
  const search = urlState.search ?? '';
  const filters = useMemo(() => urlState.filters ?? [], [urlState]);
  const timeRange = useMemo(() => urlState.timeRange ?? resolveDefaultTimeRange(defaultTime), [urlState, defaultTime]);
  const urlLens = useMemo(() => decodeLens(new URLSearchParams(paramsKey).get('lens')) ?? EMPTY_LENS, [paramsKey]);

  const setLens = useCallback(
    (raw: LensState) => {
      // A rank metric that was removed goes back to ranking by count in the stored state too.
      const next = dropMissingRankMetric(raw);
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          if (isEmptyLens(next)) {
            sp.delete('lens');
          } else {
            sp.set('lens', encodeLens(next));
          }
          return sp;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );
  const setTimeRange = useCallback(
    (r: TimeRange) => {
      const enc = encodeLogsState({ search: '', filters: [], columns: [], timeRange: r });
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('from', enc.get('from') ?? '');
          sp.set('to', enc.get('to') ?? '');
          return sp;
        },
        { replace: false }
      );
    },
    [setSearchParams]
  );

  // Filters live in the shared URL param, same as Discover (LENS-INTERACT-01 writes there).
  const setFilters = useCallback(
    (next: FilterPill[]) => {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          const enc = encodeLogsState({
            search: '',
            filters: next,
            columns: [],
            timeRange: resolveDefaultTimeRange(defaultTime),
          });
          const v = enc.get('filters');
          if (v) {
            sp.set('filters', v);
          } else {
            sp.delete('filters');
          }
          return sp;
        },
        { replace: false }
      );
    },
    [setSearchParams, defaultTime]
  );
  // Query bar (R3-QUERYBAR): a submitted query goes to `q` the way filters go to `filters` (one
  // history entry). `invalidQuery` is the bar's own parse error; a `q` that arrives by URL is
  // checked here too, so neither ever reaches the query.
  const [invalidQuery, setInvalidQuery] = useState<string | null>(null);
  const urlQueryError = useMemo(() => {
    if (!search.trim()) {
      return null;
    }
    try {
      parseKql(search.trim());
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, [search]);
  const queryError = invalidQuery ?? urlQueryError;
  const setSearch = useCallback(
    (next: string) => {
      setSearchParams((prev) => withQuery(prev, next), { replace: false });
    },
    [setSearchParams]
  );
  const addFilters = useCallback(
    (pills: FilterPill[]) => setFilters(pills.reduce(addFilterPill, filters)),
    [filters, setFilters]
  );

  // Query menu: clear all / a saved query. One URL update, like a filter change.
  const clearQuery = useCallback(() => {
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.delete('q');
        sp.delete('filters');
        return sp;
      },
      { replace: false }
    );
  }, [setSearchParams]);
  const onLoadQuery = useCallback(
    ({ query, filters: loaded, timeRange: tr }: LoadedQuery) => {
      setInvalidQuery(null);
      const merged = loaded
        ? mergePinnedFilters(
            sanitizeFilterPills(loaded),
            loadPinnedFilters(),
            tableKey(config.database, config.logsTable)
          )
        : undefined;
      const enc = encodeLogsState({
        search: query,
        filters: merged ?? [],
        columns: [],
        timeRange: tr ?? resolveDefaultTimeRange(defaultTime),
      });
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          if (query.trim()) {
            sp.set('q', query);
          } else {
            sp.delete('q');
          }
          if (merged) {
            const f = enc.get('filters');
            if (f) {
              sp.set('filters', f);
            } else {
              sp.delete('filters');
            }
          }
          if (tr) {
            sp.set('from', enc.get('from') ?? '');
            sp.set('to', enc.get('to') ?? '');
          }
          return sp;
        },
        { replace: false }
      );
    },
    [setSearchParams, config.database, config.logsTable, defaultTime]
  );
  // A query that changes through the URL (Back / Forward, a saved query) replaces a typed-in error.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInvalidQuery(null);
  }, [search]);

  // Fields of the active data view.
  const discovery = useFieldDiscovery(config, timeRange);
  const { fields, loading: discovering, fieldsFor } = discovery;
  // Fields are usable only when they are this view's: right after a view switch `fields` still
  // holds the previous table's until the new discovery publishes (#16b).
  const fieldsLoading = discovering || !viewSettled || fieldsFor !== discoveryKey(config);
  const fieldIndex = useMemo(() => buildFieldIndex(fields), [fields]);
  const fieldIndexRef = useRef(fieldIndex);
  useLayoutEffect(() => {
    fieldIndexRef.current = fieldIndex;
  });
  const lensFields = useMemo<LensField[]>(
    () => [
      RECORDS_FIELD,
      ...fields.map((f) => ({ id: f.id, sqlExpr: f.sqlExpr, label: f.displayName, type: f.type })).filter(isLensField),
    ],
    [fields]
  );
  // The URL's Lens state is untrusted: only dimensions on discovered fields are kept (and nothing
  // runs until discovery has finished, so a real field is never dropped for being "unknown").
  const allowedFields = useMemo(
    () => new Set([...fields.map((f) => f.sqlExpr), ...(config.columns.timestamp ? [config.columns.timestamp] : [])]),
    [fields, config.columns.timestamp]
  );
  const lens = useMemo(
    () => (fieldsLoading ? urlLens : sanitizeLens(urlLens, allowedFields)),
    [urlLens, allowedFields, fieldsLoading]
  );

  // Data view switch on this page (#16b): the URL names the new view, query and time stay, filters
  // follow filtersForViewSwitch (D7 for pins; other pills disabled on a different table), and once
  // the new view's fields are in, the chart keeps only dimensions on fields that view has.
  const prevView = useRef<{ id: string; table: string } | undefined>(undefined);
  const resanitize = useRef(false);
  useEffect(() => {
    if (!viewSettled || !activeView) {
      return;
    }
    const now = { id: activeView.id, table: tableKey(activeView.database, activeView.logsTable) };
    const before = prevView.current;
    prevView.current = now;
    if (!before || before.id === now.id) {
      return;
    }
    resanitize.current = true;
    const nextFilters = filtersForViewSwitch(filters, loadPinnedFilters(), before.table, now.table);
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        sp.set('ds', now.id);
        if (nextFilters.length > 0) {
          sp.set('filters', JSON.stringify(nextFilters));
        } else {
          sp.delete('filters');
        }
        return sp;
      },
      { replace: false }
    );
    // Only the view change drives this; `filters` is read as it is at the switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, viewSettled]);
  useEffect(() => {
    if (resanitize.current && !fieldsLoading) {
      resanitize.current = false;
      if (encodeLens(lens) !== encodeLens(urlLens)) {
        setLens(lens);
      }
    }
  }, [fieldsLoading, lens, urlLens, setLens]);
  const { loadValues, loadMapKeys } = useAutocompleteSources({
    config,
    query: { ...DEFAULT_LOGS_QUERY_STATE, search, filters },
    timeRange,
    fieldIndex,
  });
  const ctx: LensContext = useMemo(() => lensContextFor(config), [config]);
  const [nameFilter, setNameFilter] = useState('');
  const shownFields = useMemo(() => {
    const q = nameFilter.toLowerCase();
    return q ? lensFields.filter((f) => f.label.toLowerCase().includes(q)) : lensFields;
  }, [lensFields, nameFilter]);

  // Run the chart query. `refreshNonce` bumps on an explicit Refresh and bypasses the row cache.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const bypassRef = useRef(0);
  const [result, setResult] = useState<{
    key: string;
    /** `queryKey` without the chart type / sub-type: a type switch may keep showing this result. */
    baseKey: string;
    /** The chart state the rows were shaped for. */
    lens: LensState;
    data?: LensResult;
    error?: string;
    bucketMs?: number;
    interval?: LensInterval;
  } | null>(null);
  // Names are display-only: renaming a dimension must not re-run the query.
  const queryContext = [
    config.datasourceUid,
    config.database,
    config.logsTable,
    search,
    filters,
    timeRange.from.valueOf(),
    timeRange.to.valueOf(),
  ];
  const queryKey = JSON.stringify([encodeLens(queryShape(lens)), ...queryContext]);
  const { chartType: _ct, subType: _st, ...lensBase } = queryShape(lens);
  const baseKey = JSON.stringify([JSON.stringify(lensBase), ...queryContext]);
  // A time-series calculation without a date histogram (LENS-CALC-01): say why instead of querying.
  const calcError = calculationError(lens);
  useEffect(() => {
    if (isEmptyLens(lens) || !config.datasourceUid || fieldsLoading || queryError || calcError) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const conditions = buildWhereConditions(
      config,
      { ...DEFAULT_LOGS_QUERY_STATE, search, filters },
      fieldIndexRef.current
    );
    const { sql, intervalMs, interval } = compileLens(
      lens,
      config,
      conditions,
      timeRange,
      'app',
      fieldIndexRef.current
    );
    const range = { from: timeRange.from.valueOf(), to: timeRange.to.valueOf() };
    // A chart-type switch compiles the same SQL: reuse its rows (small LRU + TTL) unless Refresh was hit.
    const cacheKey = ResultCache.key(config.datasourceUid, sql, range.from, range.to);
    const bypass = bypassRef.current !== refreshNonce;
    bypassRef.current = refreshNonce;
    const cached = bypass ? undefined : lensRowCache.get(cacheKey);
    const rowsPromise = cached
      ? Promise.resolve(cached)
      : runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange, op: 'lens', signal: abort.signal }).then(
          (r) => {
            lensRowCache.set(cacheKey, r);
            return r;
          }
        );
    rowsPromise.then(
      (rows) =>
        !cancelled &&
        setResult({
          key: queryKey,
          baseKey,
          lens,
          data: shapeLensRows(lens, rows, intervalMs, { interval, range }),
          bucketMs: intervalMs,
          interval,
        }),
      (e) =>
        !cancelled && setResult({ key: queryKey, baseKey, lens, error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      cancelled = true;
      abort.abort();
    };
    // queryKey covers every input that changes the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, fieldsLoading, refreshNonce, !!queryError]);
  const current = result?.key === queryKey ? result : null;
  // A chart-type switch re-runs the query; until the new rows arrive keep drawing the previous chart
  // (same dimensions, filters and time) instead of a blank spinner frame. It is not interactive.
  const stale = !current && result?.data && result.baseKey === baseKey ? result : null;

  // Reference line / annotation layers (LENS-LAYER-01): their own small queries.
  const xyChart = isXy(lens.chartType);
  const horizontalBars = lens.chartType === 'bar' && lens.style?.orientation === 'horizontal';
  const timeAxis = xyChart && lens.buckets[0]?.kind === 'date_histogram' && !horizontalBars;
  const chartConditions = useMemo(
    () => buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, search, filters }, fieldIndex),
    [config, search, filters, fieldIndex]
  );
  const timeConditions = useMemo(
    () => buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, search: '', filters: [] }, fieldIndex),
    [config, fieldIndex]
  );
  const layerData = useLayerData({
    lens,
    config,
    conditions: chartConditions,
    timeConditions,
    timeRange,
    index: fieldIndex,
    timeAxis,
    enabled: xyChart && !fieldsLoading && !queryError && !!lens.layers,
  });
  const setLayers = (layers: ExtraLayer[]) => setLens({ ...lens, layers: layers.length > 0 ? layers : undefined });
  const [layerItemRef, setLayerItem] = useState<LayerItemRef | null>(null);
  // An item removed elsewhere (Clear layer, a shared link) closes its editor.
  const layerItem =
    layerItemRef &&
    (lens.layers ?? []).some(
      (l) =>
        l.id === layerItemRef.layerId &&
        (l.kind === 'referenceLine' ? l.lines : l.annotations).some((x) => x.id === layerItemRef.itemId)
    )
      ? layerItemRef
      : null;
  // A new static reference line starts at the data's highest value (Kibana starts near the data too).
  const suggestedValue = useMemo(() => {
    let max = -Infinity;
    current?.data?.series.forEach((sr) => sr.points.forEach((v) => (max = Math.max(max, v))));
    return Number.isFinite(max) ? Number(max.toPrecision(3)) : 0;
  }, [current]);
  const suggestedTime = Math.round((timeRange.from.valueOf() + timeRange.to.valueOf()) / 2);
  // SHARED-PERF-01: same running cue as Discover (no Cancel here: leaving the chart without a
  // result would need its own empty state).
  const chartLoading = fieldsLoading || (!isEmptyLens(lens) && !!config.datasourceUid && !current && !queryError && !calcError);
  const approxNote = current?.data ? lensApproxNote(lens) : null;

  const onAdd = (f: LensField) => setLens(addField(lens, f, ctx));
  const removeDim = (id: string) => {
    const next = {
      ...lens,
      buckets: lens.buckets.filter((b) => b.id !== id),
      metrics: lens.metrics.filter((m) => m.id !== id),
    };
    if (next.buckets.length === 0 && next.metrics.length === 0) {
      setLens(EMPTY_LENS);
      return;
    }
    // A removal must stick: line/area (and a bar left with nothing on X) would add the time axis
    // straight back, so re-pick the chart from what remains instead.
    const lostTime =
      (next.chartType === 'heatmap' && next.buckets.length === 0) ||
      (isXy(next.chartType) &&
        (next.chartType === 'bar'
          ? next.buckets.length === 0
          : !next.buckets.some((b) => b.kind === 'date_histogram')));
    setLens(switchChart(next, lostTime ? chooseChart(next.buckets) : next.chartType, ctx));
  };
  const cards = useMemo(() => suggestions(lens, ctx), [lens, ctx]);
  // Dimension being edited (LENS-DIM-02). Its group is looked up in the current state each render,
  // so a chart change elsewhere (suggestion, type switch) retitles or closes the editor.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [styleView, setStyleView] = useState<StyleView | null>(null);
  const editingGroup = editingId
    ? dimensionGroups(lens).find((g) => g.dims.some((d) => d.id === editingId))
    : undefined;
  const editingDim = editingGroup?.dims.find((d) => d.id === editingId);
  const canAddTo = (g: Group) => g.role === 'metric' || !!nextBucketField(lens, lensFields);
  const addToGroup = (g: Group, dropped?: LensField) => {
    if (g.role === 'metric') {
      const role = g.tag === 'max' ? ('max' as const) : undefined;
      const { state, id } = addMetric(lens, ctx, role ? { role } : {});
      const m = dropped ? metricForField(id, dropped) : undefined;
      setLens(m ? replaceDim(state, role ? { ...m, role } : m) : state);
      setEditingId(id);
      return;
    }
    const field = dropped && dropped.type !== 'records' ? dropped : nextBucketField(lens, lensFields);
    if (field) {
      const { state, id } = addBucket(lens, field, ctx, g.tag === 'pivot' ? { pivot: true } : {});
      setLens(state);
      setEditingId(id);
    }
  };
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  // LENS-INTERACT-01: one click on a bar / point. One candidate filter → applied at once; several
  // (X value + breakdown value, or a time bucket + breakdown) → "Select filters to apply".
  const [chooser, setChooser] = useState<FilterChoice[] | null>(null);
  const [inspectOpen, setInspectOpen] = useState(false);
  const buildPanel = (title: string, description: string) =>
    buildLensPanel(
      lens,
      config,
      buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, search, filters }, fieldIndex),
      timeRange,
      {
        id: 1,
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
        title,
        description,
        gaugeMax: lens.chartType === 'gauge' && current?.data ? gaugeAutoMax(lens, current.data) : undefined,
        series: (current?.data ?? stale?.data)?.series.map((x) => ({
          name: x.name,
          breakdown: x.breakdown,
          synthetic: x.synthetic,
        })),
        source: panelSourceOf({
          lens: encodeLens(lens),
          search,
          filters: filters.length > 0 ? JSON.stringify(filters) : undefined,
          viewId: activeView?.id,
        }),
      }
    );
  // Same pill the action registry's Filter for / Filter out builds everywhere else.
  const pillFor = (field: string, value: string, mode: 'for' | 'out'): FilterPill =>
    makeFilter(field, value, mode === 'for' ? '=' : '!=');
  const choicesFor = (sel: XySelection, data: LensResult, bucketMs?: number, iv?: LensInterval): FilterChoice[] => {
    const out: FilterChoice[] = [];
    const [x, breakdown] = lens.buckets;
    const xv = data.xs[sel.xIndex];
    const series = data.series[sel.seriesIndex];
    if (x?.kind === 'terms' && !data.xSynthetic[sel.xIndex]) {
      out.push({
        label: `${x.label}: ${xLabel(data.xLabels[sel.xIndex] ?? xv, false, 0)}`,
        pill: pillFor(x.field, realKey(String(xv)), 'for'),
      });
    } else if (x?.kind === 'date_histogram' && bucketMs) {
      const from = Number(xv);
      // Exact bucket end (calendar months / years are not a fixed number of ms).
      const end = iv ? stepBucket(from, iv, 1) : from + bucketMs;
      out.push({
        label: `${x.label}: ${dateTime(from).format('YYYY-MM-DD HH:mm')} – ${dateTime(end).format('YYYY-MM-DD HH:mm')}`,
        time: [from, end],
      });
    }
    if (breakdown?.kind === 'terms' && series?.breakdown !== undefined && !series.synthetic) {
      out.push({
        label: `${breakdown.label}: ${series.breakdown || '(empty)'}`,
        pill: pillFor(breakdown.field, series.breakdown, 'for'),
      });
    }
    return out;
  };
  // Filters and time go into ONE URL update: two setSearchParams calls in a row each start from the
  // render-time params, so the second would drop the first's change.
  const applyChoices = (choices: FilterChoice[]) => {
    const pills = choices.flatMap((c) => (c.pill ? [c.pill] : []));
    const time = choices.find((c) => c.time)?.time;
    const nextFilters = pills.reduce(addFilterPill, filters);
    const tr = time
      ? { from: dateTime(time[0]), to: dateTime(time[1]), raw: { from: dateTime(time[0]), to: dateTime(time[1]) } }
      : timeRange;
    const enc = encodeLogsState({ search: '', filters: nextFilters, columns: [], timeRange: tr });
    setSearchParams(
      (prev) => {
        const sp = new URLSearchParams(prev);
        const f = enc.get('filters');
        if (f) {
          sp.set('filters', f);
        } else {
          sp.delete('filters');
        }
        if (time) {
          sp.set('from', enc.get('from') ?? '');
          sp.set('to', enc.get('to') ?? '');
        }
        return sp;
      },
      { replace: false }
    );
  };
  const onSelect = (sel: XySelection) => {
    if (!current?.data) {
      return;
    }
    const choices = choicesFor(sel, current.data, current.bucketMs, current.interval);
    if (choices.length === 1) {
      applyChoices(choices);
    } else if (choices.length > 1) {
      setChooser(choices);
    }
  };
  const onLegendFilter = (seriesIndex: number, mode: 'for' | 'out') => {
    const breakdown = lens.buckets[1];
    const s = current?.data?.series[seriesIndex];
    if (breakdown?.kind === 'terms' && s?.breakdown !== undefined && !s.synthetic) {
      addFilters([pillFor(breakdown.field, s.breakdown, mode)]);
    }
  };
  const [dragOver, setDragOver] = useState(false);
  // SHARED-A11Y-01: keyboard alternative to dragging a field onto the workspace or a dimension
  // group, with spoken instructions (live region). Targets are the same as the mouse drop zones.
  const dropTargetsFor = (f: LensField): DropTarget[] => {
    const targets: DropTarget[] = [{ id: 'workspace', label: 'the workspace', drop: () => onAdd(f) }];
    if (!isEmptyLens(lens) && !editingDim && !styleView) {
      for (const g of dimensionGroups(lens)) {
        if ((g.dims.length === 0 || g.multi) && canAddTo(g)) {
          targets.push({ id: `group:${g.name}`, label: g.name, drop: () => addToGroup(g, f) });
        }
      }
    }
    return targets;
  };
  const kbDrag = useKeyboardDrag(
    dropTargetsFor,
    (f) => f.label,
    (f) => f.id
  );
  const dndHelpId = useId();
  // The dimension's button in the list: focus returns there when its editor closes.
  const dimsRef = useRef<HTMLElement>(null);
  const dimButton = (id: string) =>
    Array.from(dimsRef.current?.querySelectorAll<HTMLElement>('[data-dim-edit]') ?? []).find(
      (el) => el.dataset.dimEdit === id
    );

  // LENS-INTERACT-02: Discover in this tab, same context and data view (the one this page queries),
  // default columns plus the chart's top-values fields. A plain click navigates in this tab (the
  // browser Back button returns to the chart); the href carries the server's sub-path so a
  // modified click (Ctrl / middle button) still opens a new tab.
  const explorePath = useMemo(
    () =>
      discoverUrl(
        { search, filters, timeRange, viewId: activeView?.id },
        discoverColumns(lens, fields, config),
        discoverIntervalOf(lens),
        discoverBreakdownOf(lens, fields)
      ),
    [search, filters, timeRange, activeView?.id, lens, fields, config]
  );
  const exploreUrl = useMemo(() => locationUtil.assureBaseUrl(explorePath), [explorePath]);
  const onExplore = (e: React.MouseEvent) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
      return;
    }
    e.preventDefault();
    locationService.push(explorePath);
  };

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Visualize</span>
        <DataViewPicker />
        <div className={styles.spacer} />
        <LinkButton href={exploreUrl} onClick={onExplore} variant="secondary" size="sm" icon="compass" fill="outline">
          Explore in Discover
        </LinkButton>
        <Button
          size="sm"
          variant="secondary"
          icon="info-circle"
          onClick={() => setInspectOpen(true)}
          disabled={isEmptyLens(lens)}
        >
          Inspect
        </Button>
        <SaveActions
          paramsKey={paramsKey}
          disabled={isEmptyLens(lens) || fieldsLoading || !!queryError || !!calcError}
          defaultTitle={defaultPanelTitle(lens)}
          buildPanel={buildPanel}
          timeRange={timeRange}
        />
        <IconButton
          name="sync"
          aria-label="Refresh"
          tooltip="Refresh (re-runs the query)"
          onClick={() => setRefreshNonce((n) => n + 1)}
        />
        {/* A view without a time field has no time range (same as Discover). */}
        {ctx.timeField && (
          <TimeRangePicker
            value={timeRange}
            onChange={setTimeRange}
            onChangeTimeZone={() => undefined}
            onMoveBackward={() => setTimeRange(shiftTimeRange(timeRange, -1))}
            onMoveForward={() => setTimeRange(shiftTimeRange(timeRange, 1))}
            onZoom={() => setTimeRange(zoomOutTimeRange(timeRange))}
            timeZone="browser"
          />
        )}
      </div>

      <QueryProgress active={chartLoading} />

      <FieldsContext.Provider value={discovery}>
        <QueryRow
          search={search}
          filters={filters}
          timeRange={timeRange}
          dataViewId={activeView?.id}
          pinTable={tableKey(config.database, config.logsTable)}
          loadValues={loadValues}
          loadMapKeys={loadMapKeys}
          onSearch={setSearch}
          onInvalidQuery={setInvalidQuery}
          onFiltersChange={setFilters}
          onAddFilter={(pill) => addFilters([pill])}
          onClearAll={() => {
            setInvalidQuery(null);
            clearQuery();
          }}
          onLoadQuery={onLoadQuery}
        />
      </FieldsContext.Provider>

      <FilterPills
        filters={filters}
        onChange={setFilters}
        loadValues={loadValues}
        pinTable={tableKey(config.database, config.logsTable)}
      />

      <div className={styles.body}>
        <section className={styles.fields} aria-label="Fields">
          <Input
            prefix={<Icon name="search" />}
            placeholder="Search field names"
            aria-label="Search field names"
            value={nameFilter}
            onChange={(e) => setNameFilter(e.currentTarget.value)}
          />
          {fieldsLoading && <Spinner size="sm" />}
          <span id={dndHelpId} className={srOnly}>
            {DND_INSTRUCTIONS}
          </span>
          <LiveRegion message={kbDrag.message} testId="lens-dnd-live" />
          <div className={styles.fieldList}>
            {shownFields.map((f) => (
              <div
                key={f.id}
                className={styles.fieldRow}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(FIELD_DRAG_MIME, f.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title={f.sqlExpr || f.label}
              >
                <Icon
                  name={
                    (f.type === 'records' ? 'list-ul' : (FIELD_TYPE_ICONS[f.type] ?? 'question-circle')) as IconName
                  }
                  size="sm"
                />
                <span className={styles.fieldName}>{f.label}</span>
                <button
                  type="button"
                  className={cx(styles.dragHandle, kbDrag.isLifted(f) && styles.dragHandleLifted)}
                  aria-label={`Drag ${f.label}`}
                  aria-describedby={dndHelpId}
                  aria-pressed={kbDrag.isLifted(f)}
                  onKeyDown={kbDrag.onKeyDown(f)}
                  onBlur={kbDrag.onBlur(f)}
                >
                  <Icon name="draggabledots" size="sm" />
                </button>
                <Button
                  size="sm"
                  variant="secondary"
                  fill="text"
                  icon="plus"
                  aria-label={`Add ${f.label} to workspace`}
                  onClick={() => onAdd(f)}
                />
              </div>
            ))}
          </div>
        </section>

        <section className={styles.workspace} aria-label="Workspace">
          <div className={styles.chartHeader}>
            <Icon name={CHART_ICONS[chartKind(lens)]} />
            <span>{isEmptyLens(lens) ? 'No visualization' : chartTitle(lens)}</span>
            {!isEmptyLens(lens) && (
              <Button size="sm" variant="secondary" fill="text" icon="trash-alt" onClick={() => setLens(EMPTY_LENS)}>
                Clear workspace
              </Button>
            )}
          </div>
          <div
            className={cx(
              styles.chartArea,
              (dragOver || kbDrag.activeTargetId === 'workspace') && styles.chartAreaOver
            )}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              setDragOver(false);
              const id = e.dataTransfer.getData(FIELD_DRAG_MIME);
              const f = lensFields.find((x) => x.id === id);
              if (f) {
                e.preventDefault();
                onAdd(f);
              }
            }}
          >
            {isEmptyLens(lens) ? (
              <div className={styles.empty}>
                <Icon name="chart-line" size="xxxl" />
                <div className={styles.emptyTitle}>Drop some fields here to start</div>
                <div className={styles.emptySub}>
                  Visualize builds a chart from the fields you pick — no query editor needed.
                </div>
              </div>
            ) : queryError ? (
              <Alert severity="error" title="The query is not valid" data-testid="lens-invalid-query">
                {queryError}
              </Alert>
            ) : calcError ? (
              <Alert severity="warning" title="This chart needs a date histogram">
                {calcError}
              </Alert>
            ) : current?.error ? (
              <Alert severity="error" title="The chart query failed">
                {current.error}
              </Alert>
            ) : current?.data ? (
              <LensChart
                state={lens}
                result={current.data}
                timeRange={timeRange}
                onChangeTimeRange={(from, to) =>
                  setTimeRange({
                    from: dateTime(from),
                    to: dateTime(to),
                    raw: { from: dateTime(from), to: dateTime(to) },
                  })
                }
                bucketMs={current.bucketMs}
                onSelect={onSelect}
                onLegendFilter={lens.buckets[1]?.kind === 'terms' ? onLegendFilter : undefined}
                layerData={layerData}
                onSeriesColor={(name, color) => setLens({ ...lens, style: withSeriesColor(lens.style, name, color) })}
              />
            ) : stale?.data ? (
              <div className={styles.staleChart} data-testid="lens-chart-stale" aria-busy="true">
                <LensChart state={stale.lens} result={stale.data} timeRange={timeRange} bucketMs={stale.bucketMs} />
              </div>
            ) : (
              <div className={styles.empty}>
                <Spinner />
              </div>
            )}
          </div>

          {approxNote && (
            <div className={styles.approxNote} data-testid="lens-approx-note">
              <Icon name="info-circle" size="sm" /> {approxNote}
            </div>
          )}

          {cards.length > 0 && (
            <div className={styles.suggestions}>
              <button
                type="button"
                className={styles.suggestionsHeader}
                aria-expanded={suggestionsOpen}
                onClick={() => setSuggestionsOpen((v) => !v)}
              >
                <Icon name={suggestionsOpen ? 'angle-down' : 'angle-right'} />
                Suggestions
              </button>
              {suggestionsOpen && (
                <div className={styles.cards} role="group" aria-label="Suggestions">
                  {cards.map((c, i) => (
                    <button
                      key={`${i}:${c.title}`}
                      type="button"
                      className={cx(styles.card, c.current && styles.cardCurrent)}
                      title={c.title}
                      aria-label={`Suggestion: ${c.title}`}
                      aria-current={c.current || undefined}
                      onClick={() => !c.current && setLens(c.state)}
                    >
                      <Icon name={CHART_ICONS[chartKind(c.state)]} size="xl" />
                      <span className={styles.cardTitle}>{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {inspectOpen && (
          <LensInspector
            lens={lens}
            data={current?.data}
            title={chartTitle(lens)}
            dataView={activeView}
            tableName={`${config.database}.${config.logsTable}`}
            addFilter={(pill) => addFilters([pill])}
            onClose={() => setInspectOpen(false)}
          />
        )}
        {chooser && (
          <FilterChooser
            choices={chooser}
            onApply={(picked) => {
              setChooser(null);
              applyChoices(picked);
            }}
            onCancel={() => setChooser(null)}
          />
        )}
        <section ref={dimsRef} className={styles.dims} aria-label="Dimensions">
          {!isEmptyLens(lens) && !editingDim && (
            <ChartTypeSwitcher
              value={chartKind(lens)}
              subType={lens.subType}
              onChange={(t) => setLens(switchKind(lens, t, ctx))}
              onSubTypeChange={(sub) => setLens(switchChart(lens, lens.chartType, ctx, sub))}
            />
          )}
          {!isEmptyLens(lens) && !editingDim && !styleView && !layerItem && isXy(lens.chartType) && (
            <StyleToolbar onOpen={setStyleView} />
          )}
          {layerItem && !editingDim && !styleView && xyChart ? (
            <LayerItemEditor
              key={`${layerItem.layerId}:${layerItem.itemId}`}
              layers={lens.layers ?? []}
              target={layerItem}
              fields={lensFields}
              canUseRightAxis={!horizontalBars && lens.metrics.some((m) => m.axis === 'right')}
              suggestedTime={suggestedTime}
              onChange={setLayers}
              onBack={() => setLayerItem(null)}
            />
          ) : styleView && !editingDim && isXy(lens.chartType) ? (
            <StylePanel
              view={styleView}
              chartType={lens.chartType}
              style={lens.style}
              hasRightAxis={lens.metrics.some((m) => m.axis === 'right')}
              onChange={(style) => setLens({ ...lens, style })}
              onBack={() => setStyleView(null)}
            />
          ) : editingGroup && editingDim ? (
            <DimensionEditor
              dim={editingDim}
              group={editingGroup.name}
              fields={lensFields}
              metrics={lens.metrics}
              timeRange={{ from: timeRange.from.valueOf(), to: timeRange.to.valueOf() }}
              timeField={ctx.timeField?.sqlExpr}
              chart={lens}
              onChange={(d) => setLens(replaceDim(lens, d))}
              onRemove={() => {
                setEditingId(null);
                removeDim(editingDim.id);
              }}
              onClose={() => setEditingId(null)}
              returnFocus={() => dimButton(editingDim.id)}
            />
          ) : isEmptyLens(lens) ? (
            <div className={styles.emptySub}>Dimensions appear here as you add fields.</div>
          ) : (
            dimensionGroups(lens).map((g) => (
              <div key={g.name} className={styles.group} role="group" aria-label={g.name}>
                <div className={styles.groupName}>{g.name}</div>
                {g.dims.map((d) => (
                  <div key={d.id} className={styles.dim}>
                    <button
                      type="button"
                      className={styles.dimLabel}
                      data-dim-edit={d.id}
                      aria-label={`Edit ${dimLabelIn(d, lens.metrics)}`}
                      onClick={() => setEditingId(d.id)}
                    >
                      {dimLabelIn(d, lens.metrics)}
                    </button>
                    <IconButton
                      name="times"
                      size="sm"
                      tooltip={`Remove ${dimLabelIn(d, lens.metrics)}`}
                      onClick={() => removeDim(d.id)}
                    />
                  </div>
                ))}
                {(g.dims.length === 0 || g.multi) && (
                  <button
                    type="button"
                    className={cx(styles.slot, kbDrag.activeTargetId === `group:${g.name}` && styles.slotTarget)}
                    aria-label={`Add to ${g.name}`}
                    disabled={!canAddTo(g)}
                    title={canAddTo(g) ? undefined : 'No other field can be added here'}
                    onClick={() => addToGroup(g)}
                    onDragOver={(e) => {
                      if (e.dataTransfer.types.includes(FIELD_DRAG_MIME)) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                    onDrop={(e) => {
                      const f = lensFields.find((x) => x.id === e.dataTransfer.getData(FIELD_DRAG_MIME));
                      if (f) {
                        e.preventDefault();
                        e.stopPropagation();
                        addToGroup(g, f);
                      }
                    }}
                  >
                    + Add or drag-and-drop a field
                  </button>
                )}
              </div>
            ))
          )}
          {!isEmptyLens(lens) && !editingDim && !styleView && !layerItem && xyChart && (
            <LayersSection
              layers={lens.layers ?? []}
              timeAxis={timeAxis}
              suggestedValue={suggestedValue}
              suggestedTime={suggestedTime}
              onChange={setLayers}
              onEdit={setLayerItem}
            />
          )}
          {!isEmptyLens(lens) && !editingDim && lens.chartType === 'gauge' && (
            <GaugePanel
              gauge={lens.gauge}
              hasMaxMetric={lens.metrics.some((m) => m.role === 'max')}
              onChange={(gauge) => {
                const { gauge: _g, ...rest } = lens;
                setLens(gauge ? { ...rest, gauge } : rest);
              }}
            />
          )}
        </section>
      </div>
    </div>
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
  approxNote: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
  `,
  toolbar: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    flex-wrap: wrap;
  `,
  title: css`
    font-size: ${theme.typography.h4.fontSize};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  context: css`
    color: ${theme.colors.text.secondary};
    font-family: ${theme.typography.fontFamilyMonospace};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 50%;
  `,
  spacer: css`
    flex: 1;
  `,
  body: css`
    display: grid;
    grid-template-columns: 240px minmax(0, 1fr) 260px;
    gap: ${theme.spacing(1)};
    flex: 1;
    min-height: 0;
  `,
  fields: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    min-height: 0;
    border-right: 1px solid ${theme.colors.border.weak};
    padding-right: ${theme.spacing(1)};
  `,
  fieldList: css`
    overflow-y: auto;
    flex: 1;
  `,
  fieldRow: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: ${theme.spacing(0.25, 0.5)};
    border-radius: ${theme.shape.radius.default};
    cursor: grab;
    &:hover {
      background: ${theme.colors.action.hover};
    }
  `,
  dragHandle: css`
    display: flex;
    align-items: center;
    padding: 0;
    background: none;
    border: none;
    border-radius: ${theme.shape.radius.default};
    color: ${theme.colors.text.secondary};
    cursor: grab;
  `,
  dragHandleLifted: css`
    color: ${theme.colors.primary.text};
    box-shadow: 0 0 0 2px ${theme.colors.primary.border};
  `,
  slotTarget: css`
    border-color: ${theme.colors.primary.border} !important;
    background: ${theme.colors.primary.transparent};
  `,
  fieldName: css`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  workspace: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    min-height: 0;
  `,
  chartHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    font-weight: ${theme.typography.fontWeightMedium};
  `,
  chartArea: css`
    flex: 1;
    min-height: 240px;
    border: 1px solid ${theme.colors.border.weak};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.primary};
    padding: ${theme.spacing(1)};
    display: flex;
    flex-direction: column;
  `,
  chartAreaOver: css`
    box-shadow: inset 0 0 0 2px ${theme.colors.primary.border};
    background: ${theme.colors.primary.transparent};
  `,
  staleChart: css`
    width: 100%;
    height: 100%;
    pointer-events: none;
  `,
  empty: css`
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: ${theme.spacing(1)};
    color: ${theme.colors.text.secondary};
  `,
  emptyTitle: css`
    font-size: ${theme.typography.h5.fontSize};
    color: ${theme.colors.text.primary};
  `,
  emptySub: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  suggestions: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  suggestionsHeader: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    background: none;
    border: none;
    padding: 0;
    color: ${theme.colors.text.secondary};
    cursor: pointer;
    font-weight: ${theme.typography.fontWeightMedium};
    width: fit-content;
  `,
  cards: css`
    display: flex;
    gap: ${theme.spacing(1)};
    overflow-x: auto;
    padding-bottom: ${theme.spacing(0.5)};
  `,
  card: css`
    flex: 0 0 150px;
    height: 100px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: ${theme.spacing(1)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.primary};
    cursor: pointer;
    padding: ${theme.spacing(1)};
    &:hover {
      border-color: ${theme.colors.primary.border};
    }
  `,
  cardCurrent: css`
    border: 2px solid ${theme.colors.primary.main};
    cursor: default;
  `,
  cardTitle: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  `,
  dims: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(2)};
    border-left: 1px solid ${theme.colors.border.weak};
    padding-left: ${theme.spacing(1)};
    overflow-y: auto;
  `,
  group: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
  `,
  groupName: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  slot: css`
    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    background: none;
    text-align: left;
    cursor: pointer;
    &:hover {
      border-color: ${theme.colors.primary.border};
      color: ${theme.colors.text.primary};
    }
    border: 1px dashed ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(0.75)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  dim: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    padding: ${theme.spacing(0.5, 0.75)};
    background: ${theme.colors.background.secondary};
  `,
  dimLabel: css`
    flex: 1;
    background: none;
    border: none;
    padding: 0;
    color: ${theme.colors.text.primary};
    text-align: left;
    cursor: pointer;
    &:hover {
      text-decoration: underline;
    }
    font-size: ${theme.typography.bodySmall.fontSize};
    overflow: hidden;
    text-overflow: ellipsis;
  `,
});
