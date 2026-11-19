/**
 * "Edit in Visualize" from a dashboard panel (LENS-SAVE-02): Kibana's "Edit visualization in Lens".
 *
 * A panel added from Visualize carries its Visualize state on its query target
 * (`observeVisualize`: the chart, query, filters and data view as URL parameters, no time); the
 * dashboard panel menu link reopens Visualize from it with the dashboard's current time range.
 *
 * Dashboard JSON is editable by anyone who can edit the dashboard, so the stored value is untrusted:
 * only the known parameters survive, the size is capped, and Visualize decodes and sanitizes them
 * exactly as it does any shared link (`decodeLens` + `sanitizeLens`, the filter / KQL compilers).
 * Kept free of Lens imports: module.ts loads it at plugin start.
 */
import type { DataQuery, RawTimeRange } from '@grafana/data';
import { PLUGIN_BASE_URL } from '../constants';

export const VISUALIZE_SOURCE_KEY = 'observeVisualize';

/** URL parameters a stored source may carry (time comes from the dashboard). */
const KEYS = ['lens', 'q', 'filters', 'ds'] as const;
/** Cap on the stored value (a URL's worth; Lens states are a few KB). */
export const MAX_SOURCE_LEN = 16_000;

export interface PanelSourceInput {
  /** `encodeLens(state)` */
  lens: string;
  search?: string;
  /** Filter pills, JSON-encoded as in the page URL. */
  filters?: string;
  viewId?: string;
}

/** The value stored on the exported panel's target. */
export function panelSourceOf(input: PanelSourceInput): string {
  const sp = new URLSearchParams();
  sp.set('lens', input.lens);
  if (input.search) {
    sp.set('q', input.search);
  }
  if (input.filters) {
    sp.set('filters', input.filters);
  }
  if (input.viewId) {
    sp.set('ds', input.viewId);
  }
  return sp.toString();
}

function timeParam(v: RawTimeRange['from'] | undefined): string | undefined {
  if (typeof v === 'string') {
    return v.slice(0, 64);
  }
  const ms = v?.valueOf();
  return typeof ms === 'number' && Number.isFinite(ms) ? String(ms) : undefined;
}

/** Visualize path for a panel's menu, or undefined when the panel didn't come from Visualize. */
export function editInVisualizePath(ctx: { targets?: DataQuery[]; timeRange?: RawTimeRange }): string | undefined {
  const raw = (ctx.targets ?? [])
    .map((t) => (t as unknown as Record<string, unknown>)[VISUALIZE_SOURCE_KEY])
    .find((v): v is string => typeof v === 'string');
  if (!raw || raw.length > MAX_SOURCE_LEN) {
    return undefined;
  }
  const stored = new URLSearchParams(raw);
  const sp = new URLSearchParams();
  for (const k of KEYS) {
    const v = stored.get(k);
    if (v !== null) {
      sp.set(k, v);
    }
  }
  if (!sp.get('lens')) {
    return undefined;
  }
  const from = timeParam(ctx.timeRange?.from);
  const to = timeParam(ctx.timeRange?.to);
  if (from && to) {
    sp.set('from', from);
    sp.set('to', to);
  }
  return `${PLUGIN_BASE_URL}/visualize?${sp.toString()}`;
}
