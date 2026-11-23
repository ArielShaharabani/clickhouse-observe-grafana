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
 *
 * Save and return (Kibana's "Save and return"): the link also names the dashboard (`dash`), the
 * panel (`panel`) and the dashboard's time range (`dfrom` / `dto`), so Visualize can replace that
 * panel in place and go back. These are untrusted too: `readDashboardReturn` keeps them only when
 * they have the shape Grafana gives them (uid, positive integer id, short time strings).
 */
import type { DataQuery, RawTimeRange } from '@grafana/data';
import { PLUGIN_BASE_URL } from '../constants';

export const VISUALIZE_SOURCE_KEY = 'observeVisualize';

/** Signature of the panel as Visualize saved it (`panelSignature`): tells later edits in Grafana. */
export const VISUALIZE_SIG_KEY = 'observeVisualizeSig';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** JSON with sorted keys; undefined members dropped (as a dashboard save does). */
function canonical(x: unknown): string {
  if (Array.isArray(x)) {
    return `[${x.map(canonical).join(',')}]`;
  }
  if (isObj(x)) {
    return `{${Object.keys(x)
      .filter((k) => x[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

/** 53-bit string hash (cyrb53): detects edits, not tampering. */
function hash(s: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}

/**
 * The parts of a panel Grafana's editor changes only when the user does: query, panel type, field
 * overrides, transformations. (Options and field defaults are left out: Grafana fills in its own
 * defaults on every save.)
 */
export function panelSignature(p: {
  type?: unknown;
  targets?: unknown;
  fieldConfig?: unknown;
  transformations?: unknown;
}): string {
  const t = Array.isArray(p.targets) ? p.targets.map((x) => (isObj(x) ? x.rawSql : x)) : [];
  const overrides = isObj(p.fieldConfig) ? p.fieldConfig.overrides : undefined;
  const part = (x: unknown) => hash(canonical(Array.isArray(x) ? x : []));
  return [part(t), hash(String(p.type)), part(overrides), part(p.transformations)].join('.');
}

const EDITED = [
  'The query as it was edited in Grafana',
  'The visualization type as it was changed in Grafana',
  'Field overrides as they were edited in Grafana',
  'Transformations as they were edited in Grafana',
];

/** What was edited in Grafana since Visualize saved this panel (empty: nothing, or not known). */
export function panelEdits(p: Record<string, unknown>): string[] {
  const t = Array.isArray(p.targets) ? p.targets.find(isObj) : undefined;
  const sig = t?.[VISUALIZE_SIG_KEY];
  if (typeof sig !== 'string') {
    return [];
  }
  const was = sig.split('.');
  return panelSignature(p)
    .split('.')
    .flatMap((h, i) => (h === was[i] ? [] : [EDITED[i]]));
}

/** The query or the panel type was edited: the stored chart is no longer what the panel shows. */
export const chartEdited = (edits: string[]): boolean => edits.includes(EDITED[0]) || edits.includes(EDITED[1]);

export const EDIT_LINK_TITLE = 'Edit in Visualize';
/** Import token of the panel's own link. */
export const LINK_TOKEN = 'link';
const LINK_PATH = `${PLUGIN_BASE_URL}/visualize?`;

export const isEditLink = (l: unknown): boolean =>
  isObj(l) && typeof l.url === 'string' && l.url.startsWith(LINK_PATH) && l.url.includes(`&pi=${LINK_TOKEN}`);

/**
 * The panel with its own "Edit in Visualize" panel link. Grafana drops plugin menu items while a
 * dashboard is in edit mode (and editing a panel leaves it there); panel links stay. Panels that
 * were not made in Visualize are returned as they are, unless `anyPanel` (Configuration adds links).
 */
export function withEditLink<T extends { targets?: unknown; links?: unknown }>(panel: T, id: number, anyPanel = false): T {
  const made = Array.isArray(panel.targets) && panel.targets.some((t) => isObj(t) && typeof t[VISUALIZE_SOURCE_KEY] === 'string');
  if (!made && !anyPanel) {
    return panel;
  }
  const others = Array.isArray(panel.links) ? panel.links.filter((l) => !isEditLink(l)) : [];
  const url = `${LINK_PATH}dash=\${__dashboard.uid}&panel=${id}&pi=${LINK_TOKEN}&\${__url_time_range}`;
  return { ...panel, links: [...others, { title: EDIT_LINK_TITLE, type: 'link', url, targetBlank: false }] };
}

/** The panel without that link. */
export function withoutEditLink(p: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(p.links) || !p.links.some(isEditLink)) {
    return p;
  }
  const { links, ...rest } = p;
  const others = (links as unknown[]).filter((l) => !isEditLink(l));
  return others.length > 0 ? { ...rest, links: others } : rest;
}

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

/** Grafana dashboard uids: letters, digits, `-` and `_`, at most 40 characters. */
export function isDashboardUid(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v);
}

/** Panel ids are positive integers (Grafana stores them as int64; we accept up to 2^31). */
export function isPanelId(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31;
}

/** A dashboard time bound as Grafana writes it: dateMath (`now-1h`, `now/d`), epoch ms or ISO. */
export function isTimeParam(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9:+\-/._ ]{1,64}$/.test(v);
}

/** The dashboard panel Visualize was opened from (Save and return). */
export interface DashboardReturn {
  uid: string;
  panelId: number;
  /** The dashboard's time range when the panel was opened; restored on return. */
  from?: string;
  to?: string;
}

export const RETURN_PARAMS = ['dash', 'panel', 'dfrom', 'dto'] as const;
/** Marks a link from a panel with no Visualize state: Visualize reads the dashboard and converts the panel (a token: apply; token.k: applied). */
export const IMPORT_PARAM = 'pi';

/** Save-and-return context from Visualize's URL; undefined unless the uid and panel id are valid. */
export function readDashboardReturn(sp: URLSearchParams): DashboardReturn | undefined {
  const uid = sp.get('dash');
  const rawPanel = sp.get('panel');
  const panelId = rawPanel !== null && /^\d{1,10}$/.test(rawPanel) ? Number(rawPanel) : NaN;
  if (!isDashboardUid(uid) || !isPanelId(panelId)) {
    return undefined;
  }
  const from = sp.get('dfrom');
  const to = sp.get('dto');
  return isTimeParam(from) && isTimeParam(to) ? { uid, panelId, from, to } : { uid, panelId };
}

/** The dashboard's path (relative to Grafana), with the time range the user had there. */
export function dashboardReturnPath(ret: DashboardReturn): string {
  const qs = ret.from && ret.to ? `?${new URLSearchParams({ from: ret.from, to: ret.to }).toString()}` : '';
  return `/d/${encodeURIComponent(ret.uid)}${qs}`;
}

type PanelCtx = {
  /** Panel type (PluginExtensionPanelContext). */
  pluginId?: string;
  targets?: DataQuery[];
  timeRange?: RawTimeRange;
  /** Panel id and dashboard (PluginExtensionPanelContext); enable Save and return. */
  id?: unknown;
  dashboard?: { uid?: unknown };
};

/** Visualize path for a panel's menu, or undefined when the panel didn't come from Visualize. */
export function editInVisualizePath(ctx: PanelCtx): string | undefined {
  const raw = (ctx.targets ?? [])
    .map((t) => (t as unknown as Record<string, unknown>)[VISUALIZE_SOURCE_KEY])
    .find((v): v is string => typeof v === 'string');
  if (raw === undefined) {
    return importPanelPath(ctx);
  }
  if (!raw || raw.length > MAX_SOURCE_LEN) {
    return undefined;
  }
  // Query or visualization changed in Grafana since: read the panel as it is now.
  const edited = ctx.pluginId ? panelEdits({ type: ctx.pluginId, targets: ctx.targets }) : [];
  if (chartEdited(edited)) {
    const path = importPanelPath(ctx);
    if (path) {
      return path;
    }
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
  const uid = ctx.dashboard?.uid;
  if (isDashboardUid(uid) && isPanelId(ctx.id)) {
    sp.set('dash', uid);
    sp.set('panel', String(ctx.id));
    if (from && to && isTimeParam(from) && isTimeParam(to)) {
      sp.set('dfrom', from);
      sp.set('dto', to);
    }
  }
  return `${PLUGIN_BASE_URL}/visualize?${sp.toString()}`;
}

/**
 * Edit in Visualize for a panel that has no Visualize state (R6-PANELS): the link names only the
 * dashboard, the panel and the times; Visualize loads the dashboard and converts the panel there
 * (lens/panelImport.ts). No SQL or settings travel in the URL. Needs a saved dashboard (uid) and panel id.
 */
function importPanelPath(ctx: PanelCtx): string | undefined {
  const uid = ctx.dashboard?.uid;
  if (!isDashboardUid(uid) || !isPanelId(ctx.id)) {
    return undefined;
  }
  const sp = new URLSearchParams({ dash: uid, panel: String(ctx.id), [IMPORT_PARAM]: Date.now().toString(36) });
  const from = timeParam(ctx.timeRange?.from);
  const to = timeParam(ctx.timeRange?.to);
  if (from && to && isTimeParam(from) && isTimeParam(to)) {
    sp.set('from', from);
    sp.set('to', to);
    sp.set('dfrom', from);
    sp.set('dto', to);
  }
  return `${PLUGIN_BASE_URL}/visualize?${sp.toString()}`;
}
