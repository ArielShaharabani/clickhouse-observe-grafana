/**
 * Discover session tabs (DISC-NAV-01): several explorations open in one browser tab, each with its
 * own query, filters, columns, sort, time, data view, interval and breakdown. A tab is the Discover
 * URL state of that exploration (the same params a shared link carries); the active tab is named by
 * `_tab` in the URL. Tabs live in session storage (per browser tab, like pinned filters and the
 * last search context).
 *
 * Stored state is untrusted: every tab's params are decoded and re-encoded through the URL codec on
 * load (exactly the validation a link gets), ids and titles are checked, and sizes are capped.
 */
import { getDefaultTimeRange } from '@grafana/data';
import { decodeLogsState, encodeLogsState } from '../data/urlState';

export const DISCOVER_TABS_KEY = 'clickhouse-observe.discoverTabs';
/** URL param naming the active tab. */
export const TAB_PARAM = '_tab';

export const MAX_TABS = 20;
export const MAX_CLOSED = 10;
export const MAX_TITLE_LENGTH = 80;
const MAX_PARAMS_LENGTH = 16_384;
const ID_RE = /^[a-z0-9]{4,24}$/;
const DEFAULT_TITLE = 'Untitled';

export interface DiscoverTab {
  id: string;
  title: string;
  /** Discover URL params of this tab, without `_tab`. */
  params: string;
}

export interface ClosedTab {
  tab: DiscoverTab;
  /** Epoch ms. */
  closedAt: number;
}

export interface DiscoverTabsState {
  tabs: DiscoverTab[];
  activeId: string;
  /** Most recent first. */
  closed: ClosedTab[];
}

/** URL params that are Discover state (anything else, like `_tab`, is not part of a tab). */
const STATE_PARAMS = ['q', 'filters', 'cols', 'sort', 'from', 'to', 'ds', 'interval', 'bd', 'traceId', 'dsUid'];

export function hasDiscoverState(sp: URLSearchParams): boolean {
  return STATE_PARAMS.some((k) => sp.has(k));
}

export function isTabId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id);
}

export function newTabId(): string {
  return `t${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** `sp` without `_tab`, as a string. */
export function paramsWithoutTab(sp: URLSearchParams): string {
  const copy = new URLSearchParams(sp);
  copy.delete(TAB_PARAM);
  return copy.toString();
}

/**
 * Tab params validated like a link: decoded and re-encoded through the URL codec (malformed
 * filters / time / columns dropped, inbound-only trace params dropped), and a data view not in
 * `viewIds` dropped. '' when nothing is left.
 */
export function sanitizeTabParams(raw: unknown, viewIds?: string[]): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_PARAMS_LENGTH) {
    return '';
  }
  const sp = new URLSearchParams(raw);
  if (!hasDiscoverState(sp)) {
    return '';
  }
  const d = decodeLogsState(sp);
  const viewId = d.viewId && (!viewIds || viewIds.includes(d.viewId)) ? d.viewId : undefined;
  return encodeLogsState({
    search: d.search ?? '',
    filters: d.filters ?? [],
    columns: d.columns ?? [],
    sort: d.sort,
    timeRange: d.timeRange ?? getDefaultTimeRange(),
    viewId,
    interval: d.interval,
    breakdown: d.breakdown,
  }).toString();
}

function cleanTitle(raw: unknown): string {
  if (typeof raw !== 'string') {
    return DEFAULT_TITLE;
  }
  // Display text only (rendered as a React text node), but keep it one short line.
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TITLE_LENGTH);
  return t || DEFAULT_TITLE;
}

function cleanTab(raw: unknown, viewIds?: string[]): DiscoverTab | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  if (!isTabId(r.id)) {
    return undefined;
  }
  return { id: r.id, title: cleanTitle(r.title), params: sanitizeTabParams(r.params, viewIds) };
}

/** A fresh state with one tab. */
export function initialTabsState(params = '', id = newTabId()): DiscoverTabsState {
  return { tabs: [{ id, title: DEFAULT_TITLE, params }], activeId: id, closed: [] };
}

/** Validates a parsed storage value; undefined when unusable. */
export function parseTabsState(raw: unknown, viewIds?: string[]): DiscoverTabsState | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const r = raw as Record<string, unknown>;
  const seen = new Set<string>();
  const tabs: DiscoverTab[] = [];
  for (const t of Array.isArray(r.tabs) ? r.tabs.slice(0, MAX_TABS) : []) {
    const tab = cleanTab(t, viewIds);
    if (tab && !seen.has(tab.id)) {
      seen.add(tab.id);
      tabs.push(tab);
    }
  }
  if (tabs.length === 0) {
    return undefined;
  }
  const closed: ClosedTab[] = [];
  for (const c of Array.isArray(r.closed) ? r.closed.slice(0, MAX_CLOSED) : []) {
    const cc = c as Record<string, unknown> | null;
    const tab = cleanTab(cc?.tab, viewIds);
    const closedAt = cc?.closedAt;
    if (tab && !seen.has(tab.id) && typeof closedAt === 'number' && Number.isFinite(closedAt)) {
      seen.add(tab.id);
      closed.push({ tab, closedAt });
    }
  }
  const activeId = isTabId(r.activeId) && tabs.some((t) => t.id === r.activeId) ? r.activeId : tabs[0].id;
  return { tabs, activeId, closed };
}

export function loadTabsState(viewIds?: string[]): DiscoverTabsState | undefined {
  try {
    const raw = window.sessionStorage.getItem(DISCOVER_TABS_KEY);
    return raw ? parseTabsState(JSON.parse(raw), viewIds) : undefined;
  } catch {
    return undefined;
  }
}

export function saveTabsState(state: DiscoverTabsState): void {
  try {
    window.sessionStorage.setItem(DISCOVER_TABS_KEY, JSON.stringify(state));
  } catch {
    // Private mode / blocked storage: tabs last until reload.
  }
}

/** Next free default title: Untitled, Untitled 2, Untitled 3, … */
export function nextUntitled(tabs: DiscoverTab[]): string {
  const used = new Set(tabs.map((t) => t.title));
  if (!used.has(DEFAULT_TITLE)) {
    return DEFAULT_TITLE;
  }
  for (let n = 2; ; n++) {
    if (!used.has(`${DEFAULT_TITLE} ${n}`)) {
      return `${DEFAULT_TITLE} ${n}`;
    }
  }
}

// ---- pure updates (each returns a new state; the input is never mutated) ----

export function setTabParams(s: DiscoverTabsState, id: string, params: string): DiscoverTabsState {
  if (!s.tabs.some((t) => t.id === id && t.params !== params)) {
    return s;
  }
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, params } : t)) };
}

export function activate(s: DiscoverTabsState, id: string): DiscoverTabsState {
  return s.activeId === id || !s.tabs.some((t) => t.id === id) ? s : { ...s, activeId: id };
}

/** Adds a tab after the active one and activates it. No-op at MAX_TABS. */
export function addTab(s: DiscoverTabsState, params: string, title?: string, id = newTabId()): DiscoverTabsState {
  if (s.tabs.length >= MAX_TABS) {
    return s;
  }
  const tab: DiscoverTab = { id, title: title ? cleanTitle(title) : nextUntitled(s.tabs), params };
  const at = s.tabs.findIndex((t) => t.id === s.activeId) + 1;
  const tabs = [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)];
  return { ...s, tabs, activeId: id };
}

/** A copy of tab `id` (identical state) right after it, activated. */
export function duplicateTab(s: DiscoverTabsState, id: string, newId = newTabId()): DiscoverTabsState {
  const src = s.tabs.find((t) => t.id === id);
  if (!src || s.tabs.length >= MAX_TABS) {
    return s;
  }
  const tab: DiscoverTab = { id: newId, title: cleanTitle(`${src.title} (copy)`), params: src.params };
  const at = s.tabs.indexOf(src) + 1;
  return { ...s, tabs: [...s.tabs.slice(0, at), tab, ...s.tabs.slice(at)], activeId: newId };
}

export function renameTab(s: DiscoverTabsState, id: string, title: string): DiscoverTabsState {
  return { ...s, tabs: s.tabs.map((t) => (t.id === id ? { ...t, title: cleanTitle(title) } : t)) };
}

/**
 * Closes tab `id` into Recently closed. The last open tab can't be closed. Closing the active tab
 * activates its right neighbour (or the left one at the end).
 */
export function closeTab(s: DiscoverTabsState, id: string, now = Date.now()): DiscoverTabsState {
  const i = s.tabs.findIndex((t) => t.id === id);
  if (i < 0 || s.tabs.length <= 1) {
    return s;
  }
  const tabs = s.tabs.filter((t) => t.id !== id);
  const activeId = s.activeId === id ? tabs[Math.min(i, tabs.length - 1)].id : s.activeId;
  const closed = [{ tab: s.tabs[i], closedAt: now }, ...s.closed].slice(0, MAX_CLOSED);
  return { tabs, activeId, closed };
}

/** Reopens a recently closed tab (at the end) and activates it. */
export function restoreClosed(s: DiscoverTabsState, id: string): DiscoverTabsState {
  const c = s.closed.find((x) => x.tab.id === id);
  if (!c || s.tabs.length >= MAX_TABS) {
    return s;
  }
  return { tabs: [...s.tabs, c.tab], activeId: c.tab.id, closed: s.closed.filter((x) => x !== c) };
}

export function clearClosed(s: DiscoverTabsState): DiscoverTabsState {
  return s.closed.length === 0 ? s : { ...s, closed: [] };
}

/** Moves tab `id` to index `to` (clamped). */
export function moveTab(s: DiscoverTabsState, id: string, to: number): DiscoverTabsState {
  const from = s.tabs.findIndex((t) => t.id === id);
  if (from < 0) {
    return s;
  }
  const target = Math.max(0, Math.min(s.tabs.length - 1, to));
  if (target === from) {
    return s;
  }
  const tabs = [...s.tabs];
  const [tab] = tabs.splice(from, 1);
  tabs.splice(target, 0, tab);
  return { ...s, tabs };
}

/** "17 seconds ago", "5 minutes ago", … for the Recently closed list. */
export function relativeTime(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  const fmt = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 60) {
    return fmt(s, 'second');
  }
  if (s < 3600) {
    return fmt(Math.floor(s / 60), 'minute');
  }
  if (s < 86400) {
    return fmt(Math.floor(s / 3600), 'hour');
  }
  return fmt(Math.floor(s / 86400), 'day');
}
