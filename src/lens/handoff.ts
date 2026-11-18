/**
 * Discover ↔ Lens hand-off (spec LENS-INTERACT-02, DISC-CHART-03, DISC-SIDEBAR-02 "Visualize").
 *
 * Every hand-off is a URL: the shared search context (query, filters, time, data view) plus the
 * page's own state — `lens` for Visualize, `cols` for Discover. Pure functions so both directions
 * are unit-tested without rendering either page.
 */
import { EncodeLogsUrlStateInput } from '../data/urlState';
import { buildAppPageUrl } from '../state/sharedSearch';
import { FieldModel } from '../sql/fieldModel';
import { SelectedColumn } from '../types';
import { EMPTY_LENS, encodeLens, LensField, LensState, RECORDS_FIELD } from './state';
import { addField, isLensField, LensContext, switchChart } from './suggest';

/** Search context carried by a hand-off (Discover's columns, sort, interval stay behind). */
export type HandoffContext = Pick<EncodeLogsUrlStateInput, 'search' | 'filters' | 'timeRange' | 'viewId'>;

export function lensFieldOf(field: Pick<FieldModel, 'id' | 'sqlExpr' | 'displayName' | 'type'>): LensField {
  return { id: field.id, sqlExpr: field.sqlExpr, label: field.displayName, type: field.type };
}

/** Field popover "Visualize": the chart Lens builds when this field is the first one added. */
export function lensForField(field: Pick<FieldModel, 'id' | 'sqlExpr' | 'displayName' | 'type'>, ctx: LensContext): LensState | undefined {
  const f = lensFieldOf(field);
  return isLensField(f) ? addField(EMPTY_LENS, f, ctx) : undefined;
}

/**
 * Histogram "Edit visualization" (DISC-CHART-03): Bar, time on the horizontal axis, Count of
 * records vertically, and the histogram's breakdown (if any) as the series split.
 */
export function lensForHistogram(ctx: LensContext, breakdown?: { field: string; label: string }): LensState | undefined {
  if (!ctx.timeField) {
    return undefined;
  }
  let s = switchChart(addField(EMPTY_LENS, RECORDS_FIELD, ctx), 'bar', ctx, 'stacked');
  if (breakdown) {
    s = addField(s, { id: breakdown.field, sqlExpr: breakdown.field, label: breakdown.label, type: 'string' }, ctx);
  }
  return s;
}

/** /visualize link for a Lens state in the given search context. */
export function visualizeUrl(c: HandoffContext, lens?: LensState): string {
  const url = buildAppPageUrl('visualize', { ...c, columns: [] });
  return lens ? `${url}&lens=${encodeURIComponent(encodeLens(lens))}` : url;
}

/**
 * Lens "Explore in Discover" columns: the chart's top-values fields, in bucket order (the caller
 * turns them into grid columns). Fields not found in the data view are skipped.
 */
export function discoverColumnFields(lens: LensState, fields: FieldModel[]): FieldModel[] {
  const bySql = new Map(fields.map((f) => [f.sqlExpr, f]));
  const out: FieldModel[] = [];
  for (const b of lens.buckets) {
    const f = b.kind === 'terms' ? bySql.get(b.field) : undefined;
    if (f && !out.includes(f)) {
      out.push(f);
    }
  }
  return out;
}

/** /logs link carrying the search context and the chart's bucket fields as columns. */
export function discoverUrl(c: HandoffContext, columns: SelectedColumn[]): string {
  return buildAppPageUrl('logs', { ...c, columns });
}
