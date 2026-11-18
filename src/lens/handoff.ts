/**
 * Discover ↔ Lens hand-off (spec LENS-INTERACT-02, DISC-CHART-03, DISC-SIDEBAR-02 "Visualize").
 *
 * Every hand-off is a URL: the shared search context (query, filters, time, data view) plus the
 * page's own state — `lens` for Visualize, `cols` for Discover. Pure functions so both directions
 * are unit-tested without rendering either page.
 */
import { EncodeLogsUrlStateInput, encodeLogsState } from '../data/urlState';
import { defaultColumns, fieldToColumn } from '../data/columns';
import { prefixRoute } from '../utils/utils.routing';
import { FieldModel } from '../sql/fieldModel';
import { SelectedColumn, SourceConfig } from '../types';
import { EMPTY_LENS, encodeLens, LensField, LensState, RECORDS_FIELD } from './state';
import { addField, isLensField, LensContext, switchChart } from './suggest';

/** Search context carried by a hand-off (Discover's columns, sort, interval stay behind). */
export type HandoffContext = Pick<EncodeLogsUrlStateInput, 'search' | 'filters' | 'timeRange' | 'viewId'>;

export function lensFieldOf(field: Pick<FieldModel, 'id' | 'sqlExpr' | 'displayName' | 'type'>): LensField {
  return { id: field.id, sqlExpr: field.sqlExpr, label: field.displayName, type: field.type };
}

/** The Lens context for a view: its time field (Discover and Lens must build the same charts). */
export function lensContextFor(config: Pick<SourceConfig, 'columns'>): LensContext {
  const ts = config.columns.timestamp;
  return ts ? { timeField: { sqlExpr: ts, label: ts } } : {};
}

/** Field popover "Visualize": the chart Lens builds when this field is the first one added. */
export function lensForField(
  field: Pick<FieldModel, 'id' | 'sqlExpr' | 'displayName' | 'type'>,
  ctx: LensContext
): LensState | undefined {
  const f = lensFieldOf(field);
  return isLensField(f) ? addField(EMPTY_LENS, f, ctx) : undefined;
}

/**
 * Histogram "Edit visualization" (DISC-CHART-03): Bar, time on the horizontal axis, Count of
 * records vertically, and the histogram's breakdown (if any) as the series split.
 */
export function lensForHistogram(ctx: LensContext, breakdown?: LensField): LensState | undefined {
  if (!ctx.timeField) {
    return undefined;
  }
  let s = switchChart(addField(EMPTY_LENS, RECORDS_FIELD, ctx), 'bar', ctx, 'stacked');
  if (breakdown) {
    s = addField(s, breakdown, ctx);
  }
  return s;
}

/** /visualize link for a Lens state in the given search context. */
export function visualizeUrl(c: HandoffContext, lens?: LensState): string {
  const sp = encodeLogsState({ ...c, columns: [] });
  if (lens) {
    sp.set('lens', encodeLens(lens));
  }
  return `${prefixRoute('visualize')}?${sp.toString()}`;
}

/**
 * Lens "Explore in Discover" columns: the view's default columns (time, level, message, …) plus
 * the chart's top-values fields in bucket order. Bucket fields already shown by a default column
 * and fields the data view does not have are skipped.
 */
export function discoverColumns(lens: LensState, fields: FieldModel[], config: SourceConfig): SelectedColumn[] {
  const cols = defaultColumns(config);
  const shown = new Set(cols.map((c) => c.sqlExpr));
  const bySql = new Map(fields.map((f) => [f.sqlExpr, f]));
  for (const b of lens.buckets) {
    const f = b.kind === 'terms' ? bySql.get(b.field) : undefined;
    if (f && !shown.has(f.sqlExpr)) {
      shown.add(f.sqlExpr);
      cols.push(fieldToColumn(f));
    }
  }
  return cols;
}

/** /logs link carrying the search context and the given grid columns. */
export function discoverUrl(c: HandoffContext, columns: SelectedColumn[]): string {
  return `${prefixRoute('logs')}?${encodeLogsState({ ...c, columns }).toString()}`;
}
