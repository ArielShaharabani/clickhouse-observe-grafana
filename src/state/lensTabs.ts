/**
 * Visualize session tabs: the same tab list as Discover's (discoverTabs.ts), each tab holding one
 * visualization: its URL state (chart, query, filters, time, data view) plus the dashboard panel it
 * was opened from, if any. Stored params are untrusted and go through the same decoders a link does.
 */
import { decodeLens, encodeLens, isEmptyLens } from '../lens/state';
import { IMPORT_PARAM, readDashboardReturn, RETURN_PARAMS } from '../lens/panelSource';
import { DiscoverTab, hasDiscoverState, MAX_PARAMS_LENGTH, sanitizeTabParams, TabsStore } from './discoverTabs';
import { SEARCH_CONTEXT_PARAMS } from './lastSearch';

const hasState = (sp: URLSearchParams) =>
  ['lens', IMPORT_PARAM, ...RETURN_PARAMS, ...SEARCH_CONTEXT_PARAMS].some((k) => sp.has(k));

export function sanitizeLensTabParams(raw: unknown, viewIds?: string[]): string {
  // Charts with many dimensions and layers are longer than a Discover state.
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PARAMS_LENGTH * 4) {
    return '';
  }
  const sp = new URLSearchParams(raw);
  const ctx = new URLSearchParams();
  for (const k of SEARCH_CONTEXT_PARAMS) {
    const v = sp.get(k);
    if (v !== null) {
      ctx.set(k, v);
    }
  }
  const out = new URLSearchParams(hasDiscoverState(ctx) ? sanitizeTabParams(ctx.toString(), viewIds) : '');
  // `sanitizeTabParams` fills in a time range; a tab without one stays without.
  if (!sp.has('from') || !sp.has('to')) {
    out.delete('from');
    out.delete('to');
  }
  const lens = decodeLens(sp.get('lens'));
  if (lens && !isEmptyLens(lens)) {
    out.set('lens', encodeLens(lens));
  }
  if (readDashboardReturn(sp)) {
    for (const k of RETURN_PARAMS) {
      const v = sp.get(k);
      if (v !== null) {
        out.set(k, v);
      }
    }
    const pi = sp.get(IMPORT_PARAM);
    if (pi && /^[a-z0-9]{1,12}(\.k)?$/.test(pi)) {
      out.set(IMPORT_PARAM, pi);
    }
  }
  return out.toString();
}

export const LENS_TABS: TabsStore = {
  key: 'clickhouse-observe.lensTabs',
  hasState,
  sanitize: sanitizeLensTabParams,
};

/** The tab holds a chart or an open dashboard panel: a link opens beside it, never over it. */
export function lensTabInUse(tab: DiscoverTab): boolean {
  const sp = new URLSearchParams(tab.params);
  const lens = decodeLens(sp.get('lens'));
  return (lens !== undefined && !isEmptyLens(lens)) || readDashboardReturn(sp) !== undefined;
}
