/**
 * Visualize (Lens) page — specs LENS-START-01, LENS-AUTO-01, LENS-SUGG-01 (docs/spec/20-lens.md).
 *
 * Field list (left) → workspace chart (centre) + suggestions strip → dimension groups (right).
 * Shares the search context with Discover through the URL (q, filters, from/to); the Lens state
 * itself lives in the `lens` param so an unsaved visualization survives a refresh (IT-K).
 */
import React, { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { css, cx } from '@emotion/css';
import { dateTime, GrafanaTheme2, IconName, locationUtil, TimeRange } from '@grafana/data';
import { Alert, Button, Icon, IconButton, Input, LinkButton, Spinner, TimeRangePicker, useStyles2 } from '@grafana/ui';
import { DataViewContext, SourceConfigContext } from '../components/App/App';
import { useFieldDiscovery } from '../components/FieldsContext';
import { FIELD_TYPE_ICONS } from '../components/FieldSidebar/fieldIcons';
import { FIELD_DRAG_MIME } from '../constants';
import { decodeLogsState, encodeLogsState } from '../data/urlState';
import { runQueryRows } from '../data/runQuery';
import { buildFieldIndex } from '../sql/fields';
import { buildWhereConditions } from '../sql/queryBuilder';
import { tableKey } from '../state/sharedSearch';
import { discoverColumns, discoverUrl, lensContextFor } from './handoff';
import { buildLensPanel, defaultPanelTitle } from './panelExport';
import { SaveLensModal } from './SaveLensModal';
import { canCreateDashboards } from '../utils/permissions';
import { loadLensDraft, saveLensDraft } from './draft';
import { FilterPills } from '../components/FilterPills';
import { useAutocompleteSources } from '../autocomplete/service';
import { addFilterPill, makeFilter } from '../sql/filters';
import { FilterChoice, FilterChooser } from './FilterChooser';
import { XySelection, xLabel } from './render/XyChart';
import { DEFAULT_LOGS_QUERY_STATE, FilterPill } from '../types';
import { compileLens, LensResult, shapeLensRows } from './compile';
import { LensChart } from './render/LensChart';
import { CHART_ICONS, ChartTypeSwitcher } from './ChartTypeSwitcher';
import { DimensionEditor } from './DimensionEditor';
import { addBucket, addMetric, metricForField, nextBucketField, queryShape, replaceDim } from './dimensions';
import {
  BucketDim,
  decodeLens,
  dimLabel,
  EMPTY_LENS,
  encodeLens,
  isEmptyLens,
  LensField,
  LensState,
  MetricDim,
  RECORDS_FIELD,
  sanitizeLens,
} from './state';
import { addField, chartTitle, chooseChart, isLensField, isXy, LensContext, suggestions, switchChart } from './suggest';
import { shiftTimeRange, zoomOutTimeRange } from '../utils/timeRangeNav';

function defaultRange(): TimeRange {
  return { from: dateTime(Date.now() - 3600 * 1000), to: dateTime(Date.now()), raw: { from: 'now-1h', to: 'now' } };
}

interface Group {
  name: string;
  /** What the group's "+ Add" slot adds. */
  role: 'metric' | 'bucket';
  dims: Array<BucketDim | MetricDim>;
  /** Holds several dimensions (the slot stays after the first). */
  multi?: boolean;
}

/** Dimension groups as each chart type names them (LENS-DIM-01). */
export function dimensionGroups(s: LensState): Group[] {
  const [b0, b1] = s.buckets;
  const opt = (d?: BucketDim) => (d ? [d] : []);
  switch (s.chartType) {
    case 'line':
    case 'area':
    case 'bar':
      return [
        { name: 'Horizontal axis', role: 'bucket', dims: opt(b0) },
        { name: 'Vertical axis', role: 'metric', dims: s.metrics, multi: true },
        { name: 'Breakdown', role: 'bucket', dims: b0 ? opt(b1) : [] },
      ];
    case 'table':
      return [
        { name: 'Rows', role: 'bucket', dims: s.buckets, multi: true },
        { name: 'Metrics', role: 'metric', dims: s.metrics, multi: true },
      ];
    case 'metric':
      return [
        { name: 'Primary metric', role: 'metric', dims: s.metrics.slice(0, 1) },
        { name: 'Secondary metric', role: 'metric', dims: s.metrics.slice(1, 2) },
        { name: 'Break down by', role: 'bucket', dims: opt(b0) },
      ];
    case 'pie':
      return [
        { name: 'Slice by', role: 'bucket', dims: s.buckets },
        { name: 'Size by', role: 'metric', dims: s.metrics },
      ];
  }
}

export function LensPage() {
  const styles = useStyles2(getStyles);
  const config = useContext(SourceConfigContext);
  const { activeView } = useContext(DataViewContext);
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsKey = searchParams.toString();

  // Shared search context from the URL (same params as Discover).
  const urlState = useMemo(() => decodeLogsState(new URLSearchParams(paramsKey)), [paramsKey]);
  const search = urlState.search ?? '';
  const filters = useMemo(() => urlState.filters ?? [], [urlState]);
  const timeRange = useMemo(() => urlState.timeRange ?? defaultRange(), [urlState]);
  // LENS-SAVE-01 draft, scoped to the datasource + table the chart was built on.
  const draftScope = `${config.datasourceUid}|${tableKey(config.database, config.logsTable)}`;
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) {
      return;
    }
    restored.current = true;
    const draft = new URLSearchParams(window.location.search).has('lens') ? undefined : loadLensDraft(draftScope);
    if (draft) {
      setSearchParams(
        (prev) => {
          const sp = new URLSearchParams(prev);
          sp.set('lens', encodeLens(draft));
          return sp;
        },
        { replace: true }
      );
    }
  }, [setSearchParams, draftScope]);
  const urlLens = useMemo(() => decodeLens(new URLSearchParams(paramsKey).get('lens')) ?? EMPTY_LENS, [paramsKey]);
  // Every chart shown (also one opened from a Discover link) becomes the draft; clearing happens in setLens.
  useEffect(() => {
    if (restored.current && !isEmptyLens(urlLens)) {
      saveLensDraft(draftScope, urlLens);
    }
  }, [urlLens, draftScope]);

  const setLens = useCallback(
    (next: LensState) => {
      if (isEmptyLens(next)) {
        saveLensDraft(draftScope, next);
      }
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
    [setSearchParams, draftScope]
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
          const enc = encodeLogsState({ search: '', filters: next, columns: [], timeRange: defaultRange() });
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
    [setSearchParams]
  );
  const addFilters = useCallback(
    (pills: FilterPill[]) => setFilters(pills.reduce(addFilterPill, filters)),
    [filters, setFilters]
  );

  // Fields of the active data view.
  const { fields, loading: fieldsLoading } = useFieldDiscovery(config, timeRange);
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
  const { loadValues } = useAutocompleteSources({
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

  // Run the chart query.
  const [result, setResult] = useState<{ key: string; data?: LensResult; error?: string; bucketMs?: number } | null>(
    null
  );
  // Names are display-only: renaming a dimension must not re-run the query.
  const queryKey = JSON.stringify([
    encodeLens(queryShape(lens)),
    config.datasourceUid,
    config.database,
    config.logsTable,
    search,
    filters,
    timeRange.from.valueOf(),
    timeRange.to.valueOf(),
  ]);
  useEffect(() => {
    if (isEmptyLens(lens) || !config.datasourceUid || fieldsLoading) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    const conditions = buildWhereConditions(
      config,
      { ...DEFAULT_LOGS_QUERY_STATE, search, filters },
      fieldIndexRef.current
    );
    const { sql, intervalMs } = compileLens(lens, config, conditions, timeRange);
    runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange, op: 'lens', signal: abort.signal }).then(
      (rows) =>
        !cancelled && setResult({ key: queryKey, data: shapeLensRows(lens, rows, intervalMs), bucketMs: intervalMs }),
      (e) => !cancelled && setResult({ key: queryKey, error: e instanceof Error ? e.message : String(e) })
    );
    return () => {
      cancelled = true;
      abort.abort();
    };
    // queryKey covers every input that changes the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryKey, fieldsLoading]);
  const current = result?.key === queryKey ? result : null;

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
      isXy(next.chartType) &&
      (next.chartType === 'bar' ? next.buckets.length === 0 : !next.buckets.some((b) => b.kind === 'date_histogram'));
    setLens(switchChart(next, lostTime ? chooseChart(next.buckets) : next.chartType, ctx));
  };
  const cards = useMemo(() => suggestions(lens, ctx), [lens, ctx]);
  // Dimension being edited (LENS-DIM-02). Its group is looked up in the current state each render,
  // so a chart change elsewhere (suggestion, type switch) retitles or closes the editor.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingGroup = editingId
    ? dimensionGroups(lens).find((g) => g.dims.some((d) => d.id === editingId))
    : undefined;
  const editingDim = editingGroup?.dims.find((d) => d.id === editingId);
  const canAddTo = (g: Group) => g.role === 'metric' || !!nextBucketField(lens, lensFields);
  const addToGroup = (g: Group, dropped?: LensField) => {
    if (g.role === 'metric') {
      const { state, id } = addMetric(lens, ctx);
      const m = dropped ? metricForField(id, dropped) : undefined;
      setLens(m ? replaceDim(state, m) : state);
      setEditingId(id);
      return;
    }
    const field = dropped && dropped.type !== 'records' ? dropped : nextBucketField(lens, lensFields);
    if (field) {
      const { state, id } = addBucket(lens, field, ctx);
      setLens(state);
      setEditingId(id);
    }
  };
  const [suggestionsOpen, setSuggestionsOpen] = useState(true);

  // LENS-INTERACT-01: one click on a bar / point. One candidate filter → applied at once; several
  // (X value + breakdown value, or a time bucket + breakdown) → "Select filters to apply".
  const [chooser, setChooser] = useState<FilterChoice[] | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const buildPanel = (title: string, description: string) =>
    buildLensPanel(
      lens,
      config,
      buildWhereConditions(config, { ...DEFAULT_LOGS_QUERY_STATE, search, filters }, fieldIndex),
      timeRange,
      { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 }, title, description }
    );
  // Same pill the action registry's Filter for / Filter out builds everywhere else.
  const pillFor = (field: string, value: string, mode: 'for' | 'out'): FilterPill =>
    makeFilter(field, value, mode === 'for' ? '=' : '!=');
  const choicesFor = (sel: XySelection, data: LensResult, bucketMs?: number): FilterChoice[] => {
    const out: FilterChoice[] = [];
    const [x, breakdown] = lens.buckets;
    const xv = data.xs[sel.xIndex];
    const series = data.series[sel.seriesIndex];
    if (x?.kind === 'terms') {
      out.push({ label: `${x.label}: ${xLabel(xv, false, 0)}`, pill: pillFor(x.field, String(xv), 'for') });
    } else if (x?.kind === 'date_histogram' && bucketMs) {
      const from = Number(xv);
      out.push({
        label: `${x.label}: ${dateTime(from).format('YYYY-MM-DD HH:mm')} – ${dateTime(from + bucketMs).format('YYYY-MM-DD HH:mm')}`,
        time: [from, from + bucketMs],
      });
    }
    if (breakdown?.kind === 'terms' && series?.breakdown !== undefined) {
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
    const choices = choicesFor(sel, current.data, current.bucketMs);
    if (choices.length === 1) {
      applyChoices(choices);
    } else if (choices.length > 1) {
      setChooser(choices);
    }
  };
  const onLegendFilter = (seriesIndex: number, mode: 'for' | 'out') => {
    const breakdown = lens.buckets[1];
    const s = current?.data?.series[seriesIndex];
    if (breakdown?.kind === 'terms' && s?.breakdown !== undefined) {
      addFilters([pillFor(breakdown.field, s.breakdown, mode)]);
    }
  };
  const [dragOver, setDragOver] = useState(false);

  // LENS-INTERACT-02: Discover in a new tab, same context and data view (the one this page queries),
  // default columns plus the chart's top-values fields. A new tab bypasses Grafana's router, so the
  // href needs the server's sub-path.
  const exploreUrl = useMemo(
    () =>
      locationUtil.assureBaseUrl(
        discoverUrl({ search, filters, timeRange, viewId: activeView?.id }, discoverColumns(lens, fields, config))
      ),
    [search, filters, timeRange, activeView?.id, lens, fields, config]
  );

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.title}>Visualize</span>
        <span className={styles.context} title={`${config.database}.${config.logsTable}`}>
          {config.database}.{config.logsTable}
          {search && ` · ${search}`}
          {filters.length > 0 && ` · ${filters.length} filter${filters.length > 1 ? 's' : ''}`}
        </span>
        <div className={styles.spacer} />
        <LinkButton href={exploreUrl} target="_blank" variant="secondary" size="sm" icon="compass" fill="outline">
          Explore in Discover
        </LinkButton>
        <Button size="sm" icon="save" onClick={() => setSaveOpen(true)} disabled={isEmptyLens(lens) || fieldsLoading}>
          Save
        </Button>
        <TimeRangePicker
          value={timeRange}
          onChange={setTimeRange}
          onChangeTimeZone={() => undefined}
          onMoveBackward={() => setTimeRange(shiftTimeRange(timeRange, -1))}
          onMoveForward={() => setTimeRange(shiftTimeRange(timeRange, 1))}
          onZoom={() => setTimeRange(zoomOutTimeRange(timeRange))}
          timeZone="browser"
        />
      </div>

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
            <Icon name={CHART_ICONS[lens.chartType]} />
            <span>{isEmptyLens(lens) ? 'No visualization' : chartTitle(lens)}</span>
            {!isEmptyLens(lens) && (
              <Button size="sm" variant="secondary" fill="text" icon="trash-alt" onClick={() => setLens(EMPTY_LENS)}>
                Clear workspace
              </Button>
            )}
          </div>
          <div
            className={cx(styles.chartArea, dragOver && styles.chartAreaOver)}
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
              />
            ) : (
              <div className={styles.empty}>
                <Spinner />
              </div>
            )}
          </div>

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
                      <Icon name={CHART_ICONS[c.state.chartType]} size="xl" />
                      <span className={styles.cardTitle}>{c.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        <SaveLensModal
          isOpen={saveOpen}
          onDismiss={() => setSaveOpen(false)}
          defaultTitle={defaultPanelTitle(lens)}
          buildPanel={buildPanel}
          timeRange={timeRange}
          canSaveDashboards={canCreateDashboards()}
        />
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
        <section className={styles.dims} aria-label="Dimensions">
          {!isEmptyLens(lens) && !editingDim && (
            <ChartTypeSwitcher
              value={lens.chartType}
              subType={lens.subType}
              onChange={(t) => setLens(switchChart(lens, t, ctx))}
              onSubTypeChange={(sub) => setLens(switchChart(lens, lens.chartType, ctx, sub))}
            />
          )}
          {editingGroup && editingDim ? (
            <DimensionEditor
              dim={editingDim}
              group={editingGroup.name}
              fields={lensFields}
              onChange={(d) => setLens(replaceDim(lens, d))}
              onRemove={() => {
                setEditingId(null);
                removeDim(editingDim.id);
              }}
              onClose={() => setEditingId(null)}
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
                      aria-label={`Edit ${dimLabel(d)}`}
                      onClick={() => setEditingId(d.id)}
                    >
                      {dimLabel(d)}
                    </button>
                    <IconButton
                      name="times"
                      size="sm"
                      tooltip={`Remove ${dimLabel(d)}`}
                      onClick={() => removeDim(d.id)}
                    />
                  </div>
                ))}
                {(g.dims.length === 0 || g.multi) && (
                  <button
                    type="button"
                    className={styles.slot}
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
