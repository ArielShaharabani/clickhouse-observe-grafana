/**
 * "Open in Discover" from a dashboard panel (PARITY-DASHBOARDS; Kibana: a saved search panel opens
 * in Discover). Same pattern as "Edit in Visualize" (lens/panelSource.ts): the logs panel exported
 * from Discover keeps Discover's search as URL parameters on its query target (`observeDiscover`:
 * query, filters, columns, sort, data view, histogram interval / breakdown — never time), and the
 * dashboard panel menu link reopens Discover from it with the dashboard's current time range.
 *
 * Dashboard JSON is untrusted: only Discover's own parameters survive, the value is capped, the
 * path is always the plugin's own Discover route, and Discover decodes / sanitizes the parameters
 * exactly as it does any shared link (urlState.ts, sanitizeColumns, filter / KQL compilers).
 * Kept free of heavy imports: module.tsx loads it at plugin start.
 */
import type { DataQuery, RawTimeRange } from '@grafana/data';
import { PLUGIN_BASE_URL } from '../constants';

export const DISCOVER_SOURCE_KEY = 'observeDiscover';

/** Discover URL parameters a stored source may carry (time comes from the dashboard). */
export const DISCOVER_SOURCE_PARAMS = ['q', 'filters', 'cols', 'sort', 'ds', 'interval', 'bd'] as const;
/** Cap on the stored value (a URL's worth). */
export const MAX_DISCOVER_SOURCE_LEN = 16_000;

/** Keep only Discover's own parameters (no time) from `sp`, as the stored source value. */
export function discoverSourceOf(sp: URLSearchParams): string {
  const out = new URLSearchParams();
  for (const k of DISCOVER_SOURCE_PARAMS) {
    const v = sp.get(k);
    if (v !== null) {
      out.set(k, v);
    }
  }
  return out.toString();
}

function timeParam(v: RawTimeRange['from'] | undefined): string | undefined {
  if (typeof v === 'string') {
    return /^[A-Za-z0-9:+\-/._ ]{1,64}$/.test(v) ? v : undefined;
  }
  const ms = v?.valueOf();
  return typeof ms === 'number' && Number.isFinite(ms) ? String(ms) : undefined;
}

/** Discover path for a panel's menu, or undefined when the panel wasn't exported from Discover. */
export function openInDiscoverPath(ctx: { targets?: DataQuery[]; timeRange?: RawTimeRange }): string | undefined {
  const raw = (ctx.targets ?? [])
    .map((t) => (t as unknown as Record<string, unknown>)[DISCOVER_SOURCE_KEY])
    .find((v): v is string => typeof v === 'string');
  if (raw === undefined || raw.length > MAX_DISCOVER_SOURCE_LEN) {
    return undefined;
  }
  const sp = new URLSearchParams(discoverSourceOf(new URLSearchParams(raw)));
  const from = timeParam(ctx.timeRange?.from);
  const to = timeParam(ctx.timeRange?.to);
  if (from && to) {
    sp.set('from', from);
    sp.set('to', to);
  }
  const qs = sp.toString();
  return `${PLUGIN_BASE_URL}/logs${qs ? `?${qs}` : ''}`;
}
