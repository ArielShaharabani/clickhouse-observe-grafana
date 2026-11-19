/**
 * Fetches what the reference line / annotation layers need beyond the chart query (LENS-LAYER-01):
 * computed reference values (one row with the chart's conditions) and query-annotation event
 * times (time conditions only). Each runs only when its own inputs change, so editing a label or
 * colour never re-queries; a failure leaves those lines / markers out instead of breaking the chart.
 */
import { useEffect, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { runQueryRows } from '../data/runQuery';
import { SourceConfig } from '../types';
import { FieldIndex } from '../sql/fields';
import { compileAnnotationQuery, compileReferenceValues, shapeAnnotationRows, shapeReferenceRow } from './compile';
import { computedLines, LayerData, MAX_QUERY_EVENTS, queryAnnotations } from './layers';
import { LensState } from './state';

interface Inputs {
  lens: LensState;
  config: SourceConfig;
  /** The chart's WHERE conditions (query, filters, time). */
  conditions: string[];
  /** Time conditions only (annotation queries ignore the chart's query and filters). */
  timeConditions: string[];
  timeRange: TimeRange;
  index?: FieldIndex;
  /** Draw on a time axis (annotations are only fetched for time charts). */
  timeAxis: boolean;
  enabled: boolean;
}

const EMPTY: LayerData = { values: {}, events: {} };

export function useLayerData({
  lens,
  config,
  conditions,
  timeConditions,
  timeRange,
  index,
  timeAxis,
  enabled,
}: Inputs): LayerData {
  const [values, setValues] = useState<{ key: string; v: LayerData['values'] } | null>(null);
  const [events, setEvents] = useState<{ key: string; v: LayerData['events'] } | null>(null);

  const refs = enabled ? computedLines(lens.layers).map((l) => ({ id: l.id, computed: l.computed })) : [];
  const refKey = refs.length
    ? JSON.stringify([
        refs,
        config.datasourceUid,
        config.database,
        config.logsTable,
        conditions,
        timeRange.from.valueOf(),
        timeRange.to.valueOf(),
      ])
    : '';
  const anns = enabled && timeAxis ? queryAnnotations(lens.layers).map((a) => ({ id: a.id, query: a.query })) : [];
  const annKey = anns.length
    ? JSON.stringify([
        anns,
        config.datasourceUid,
        config.database,
        config.logsTable,
        timeConditions,
        timeRange.from.valueOf(),
        timeRange.to.valueOf(),
      ])
    : '';

  useEffect(() => {
    const q = refKey ? compileReferenceValues(refs, config, conditions, timeRange) : null;
    if (!q || !config.datasourceUid) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: q.sql,
      timeRange,
      op: 'lensLayers',
      signal: abort.signal,
    }).then(
      (rows) => !cancelled && setValues({ key: refKey, v: shapeReferenceRow(q.ids, rows[0]) }),
      () => !cancelled && setValues({ key: refKey, v: {} })
    );
    return () => {
      cancelled = true;
      abort.abort();
    };
    // refKey covers every input of the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refKey]);

  useEffect(() => {
    const q = annKey ? compileAnnotationQuery(anns, config, timeConditions, index, MAX_QUERY_EVENTS) : null;
    if (!q || !config.datasourceUid) {
      return;
    }
    let cancelled = false;
    const abort = new AbortController();
    runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: q.sql,
      timeRange,
      op: 'lensLayers',
      signal: abort.signal,
    }).then(
      (rows) => !cancelled && setEvents({ key: annKey, v: shapeAnnotationRows(q.ids, rows) }),
      () => !cancelled && setEvents({ key: annKey, v: {} })
    );
    return () => {
      cancelled = true;
      abort.abort();
    };
    // annKey covers every input of the SQL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annKey]);

  if (!refKey && !annKey) {
    return EMPTY;
  }
  return {
    values: values && values.key === refKey ? values.v : {},
    events: events && events.key === annKey ? events.v : {},
  };
}
