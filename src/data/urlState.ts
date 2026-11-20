/**
 * Encodes/decodes the Logs Explorer's shareable state (search, filters, columns, sort, time
 * range, active data view) to/from URL query params, so a link can be copied to a colleague and
 * reproduce the same view. Same field set Saved Searches already prove serializable (see
 * data/savedSearches.ts + SavedSearchMenu.tsx) — this just targets the URL instead of localStorage.
 *
 * Deliberately plain JSON in the query string (not base64) — URLSearchParams already percent-
 * encodes/decodes values for us, so there's nothing base64 buys here beyond a longer URL.
 */
import { dateMath, dateTime, rangeUtil, TimeRange } from '@grafana/data';
import { FilterPill, IntervalMode, SelectedColumn } from '../types';
import { sanitizeFilterPills } from '../sql/filters';
import type { FieldModel } from '../sql/fieldModel';

/** Breakdown as stored in the URL: a field is referenced by its stable FieldModel id and
 *  resolved against discovered fields once they load (SHARED-STATE-02). */
export type BreakdownUrl = { kind: 'none' } | { kind: 'severity' } | { kind: 'field'; fieldId: string };

const INTERVAL_MODES: readonly IntervalMode[] = ['auto', 'millisecond', 'second', 'minute', 'hour', 'day', 'week', 'month', 'year'];

export interface DecodedLogsUrlState {
  search?: string;
  filters?: FilterPill[];
  columns?: SelectedColumn[];
  sort?: { col: string; dir: 'asc' | 'desc' };
  timeRange?: TimeRange;
  viewId?: string;
  interval?: IntervalMode;
  breakdown?: BreakdownUrl;
  /** Auto-refresh interval ('30s', '1m', …); absent = paused (the default, as in Kibana). */
  refresh?: string;
  // traceId/dsUid: inbound-only fields carried by a trace->logs deep link from Grafana Explore's
  // ClickHouse trace view (see data/traceToLogsLink.ts) — a `traceId`/`dsUid` filter pill isn't
  // something a colleague reproduces by copying a Logs Explorer URL, so unlike every other field
  // here these are deliberately absent from EncodeLogsUrlStateInput/encodeLogsState below. Never
  // round-tripped, only consumed once at mount (App.tsx / LogsExplorer.tsx).
  traceId?: string;
  dsUid?: string;
}

export interface EncodeLogsUrlStateInput {
  search: string;
  filters: FilterPill[];
  columns: SelectedColumn[];
  sort?: { col: string; dir: 'asc' | 'desc' };
  timeRange: TimeRange;
  viewId?: string;
  /** Omitted from the URL when 'auto' (the default). */
  interval?: IntervalMode;
  /** Only set when the user explicitly chose a breakdown; undefined = view default. */
  breakdown?: BreakdownUrl;
  /** Auto-refresh interval; omitted when paused (the default). */
  refresh?: string;
}

/** A Grafana-style refresh interval ('5s', '1m', '2h', '1d'), at least 5 seconds. URL input is
 *  untrusted, so anything else (paused, junk, sub-5s) reads as paused. */
export function cleanRefreshInterval(raw: string | null | undefined): string | undefined {
  if (!raw || !/^[1-9]\d{0,3}[smhd]$/.test(raw)) {
    return undefined;
  }
  try {
    return rangeUtil.intervalToMs(raw) >= 5000 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function encodeLogsState(state: EncodeLogsUrlStateInput): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.search.trim()) {
    sp.set('q', state.search);
  }
  if (state.filters.length > 0) {
    sp.set('filters', JSON.stringify(state.filters));
  }
  // Only encode a non-empty column set — an empty array means "use the view's default columns",
  // which is both the common case and avoids baking one user's exact grid layout into every link
  // a colleague opens against a possibly different (future) default.
  if (state.columns.length > 0) {
    sp.set('cols', JSON.stringify(state.columns));
  }
  if (state.sort) {
    sp.set('sort', `${state.sort.col}:${state.sort.dir}`);
  }
  // Preserve relative strings ('now-1h') so the link stays "last hour" for whoever opens it,
  // rather than freezing to the exact absolute range at copy time — same convention
  // SavedSearchMenu.tsx's handleSave uses.
  const from = typeof state.timeRange.raw.from === 'string' ? state.timeRange.raw.from : String(state.timeRange.from.valueOf());
  const to = typeof state.timeRange.raw.to === 'string' ? state.timeRange.raw.to : String(state.timeRange.to.valueOf());
  sp.set('from', from);
  sp.set('to', to);
  if (state.viewId) {
    sp.set('ds', state.viewId);
  }
  if (state.interval && state.interval !== 'auto') {
    sp.set('interval', state.interval);
  }
  if (state.breakdown) {
    sp.set('bd', state.breakdown.kind === 'field' ? `field:${state.breakdown.fieldId}` : state.breakdown.kind);
  }
  const refresh = cleanRefreshInterval(state.refresh);
  if (refresh) {
    sp.set('refresh', refresh);
  }
  return sp;
}

/** The discovered field a URL breakdown id names: the exact id, else (a hand-written link) the
 *  column field of that name (`ServiceName` → `col:ServiceName`). */
export function resolveBreakdownField(id: string, fields: FieldModel[]): FieldModel | undefined {
  return fields.find((f) => f.id === id) ?? fields.find((f) => f.id === `col:${id}`);
}

function decodeBreakdown(raw: string | null): BreakdownUrl | undefined {
  if (raw === 'none' || raw === 'severity') {
    return { kind: raw };
  }
  if (raw?.startsWith('field:') && raw.length > 'field:'.length) {
    return { kind: 'field', fieldId: raw.slice('field:'.length) };
  }
  return undefined;
}

function safeParseArray<T>(raw: string | null): T[] | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : undefined;
  } catch {
    return undefined;
  }
}

const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** Best-effort — any field that fails to parse is simply omitted, never throws. */
export function decodeLogsState(searchParams: URLSearchParams): DecodedLogsUrlState {
  const result: DecodedLogsUrlState = {};

  const q = searchParams.get('q');
  if (q !== null) {
    result.search = q;
  }

  const filters = safeParseArray<FilterPill>(searchParams.get('filters'));
  if (filters) {
    // Untrusted: keep only well-formed pills (known op, string field / value / values).
    result.filters = sanitizeFilterPills(filters);
  }

  const cols = safeParseArray<SelectedColumn>(searchParams.get('cols'));
  if (cols) {
    result.columns = cols;
  }

  const sortRaw = searchParams.get('sort');
  if (sortRaw) {
    const [col, dir] = sortRaw.split(':');
    if (col && (dir === 'asc' || dir === 'desc')) {
      result.sort = { col, dir };
    }
  }

  const from = searchParams.get('from');
  const to = searchParams.get('to');
  if (from && to) {
    try {
      // Same convention as SavedSearchMenu.tsx's handleLoad: relative strings pass through for
      // dateMath to resolve, absolute epoch-ms strings become DateTime objects.
      // Epoch ms (what we write, any finite number), ISO-8601 with an explicit zone (as Kibana's
      // _g.time writes), or a valid relative expression. Anything else is dropped.
      const toRaw = (v: string) => {
        if (v.startsWith('now')) {
          if (!dateMath.isValid(v)) {
            throw new Error('bad time');
          }
          return v;
        }
        const ms = v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : ISO_WITH_ZONE.test(v) ? Date.parse(v) : NaN;
        if (Number.isNaN(ms)) {
          throw new Error('bad time');
        }
        return dateTime(ms);
      };
      result.timeRange = rangeUtil.convertRawToRange({ from: toRaw(from), to: toRaw(to) });
    } catch {
      // Malformed from/to — leave timeRange undefined, caller keeps its own default.
    }
  }

  const ds = searchParams.get('ds');
  if (ds) {
    result.viewId = ds;
  }

  const interval = searchParams.get('interval') as IntervalMode | null;
  if (interval && INTERVAL_MODES.includes(interval)) {
    result.interval = interval;
  }

  const breakdown = decodeBreakdown(searchParams.get('bd'));
  if (breakdown) {
    result.breakdown = breakdown;
  }

  const refresh = cleanRefreshInterval(searchParams.get('refresh'));
  if (refresh) {
    result.refresh = refresh;
  }

  const traceId = searchParams.get('traceId');
  if (traceId) {
    result.traceId = traceId;
  }

  const dsUid = searchParams.get('dsUid');
  if (dsUid) {
    result.dsUid = dsUid;
  }

  return result;
}
