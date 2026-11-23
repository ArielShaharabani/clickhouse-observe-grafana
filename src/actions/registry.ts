/**
 * Action registry (spec SHARED-ACTION-01, docs/spec/30-shared.md).
 *
 * Each action is defined once — icon, tooltip, accessible name, when it applies and what it does —
 * and every surface (results grid, document drawer, field stats popover, field list, histogram
 * popover, and later the Visualize page) asks the registry which actions apply to a value or
 * field instead of hand-building its own buttons. Surfaces keep their own visual style; behaviour
 * and wording stay identical everywhere. Pure: no React.
 */
import { pathLabel } from '../sql/pathLabel';
import { AppEvents } from '@grafana/data';
import { getAppEvents } from '@grafana/runtime';
import { IconName } from '@grafana/ui';
import { makeFilter } from '../sql/filters';
import { FilterPill } from '../types';

/** What a surface can do. A surface without `addFilter` is read-only (copy only). */
export interface ActionHost {
  addFilter?: (pill: FilterPill) => void;
  copyText: (text: string) => void;
  /** Break the histogram down by a field (DISC-SIDEBAR-02 / DISC-CHART-02). */
  setBreakdown?: (ctx: FieldContext) => void;
  /** Open the field in the Visualize page (LENS hand-off, wired in #15). */
  visualize?: (ctx: FieldContext) => void;
  /** Show the full value in an Expand popover (results grid, DISC-TABLE-02). */
  expand?: (ctx: ValueContext) => void;
}

export interface ValueContext {
  /** SQL expression of the field (what a filter pill stores). */
  field: string;
  /** Name used in accessible names; defaults to `fieldLabelFor(field)` so every surface names a
   *  field the same way. */
  fieldLabel?: string;
  /** The value as text. */
  value: string;
  /** False for values that can't be filtered on (see `isFilterableValue`) → copy only. */
  filterable?: boolean;
}

export type FieldContext = Omit<ValueContext, 'value' | 'filterable'>;

/** One display name per field, derived from its SQL expression: `LogAttributes['http.method']`
 *  → `LogAttributes.http.method`; JSON paths as `pathLabel`; plain columns stay as they are. */
export function fieldLabelFor(sqlExpr: string): string {
  return pathLabel(sqlExpr).replace(/\['((?:[^'\\]|\\.)*)'\]/g, '.$1');
}

const CONTAINER_TYPES = new Set(['map', 'json', 'tuple', 'array']);

/**
 * Whether a cell value can be turned into a filter: not null/undefined, not an object, and not
 * the serialized form of a whole Map/JSON/Tuple/Array container (those match nothing as text).
 */
export function isFilterableValue(raw: unknown, type?: string): boolean {
  if (raw === null || raw === undefined || typeof raw === 'object') {
    return false;
  }
  if (typeof raw === 'string' && type && CONTAINER_TYPES.has(type) && /^[\[{]/.test(raw.trim())) {
    return false;
  }
  return true;
}

const MAX_NAME_VALUE = 60;
/** Value as spoken in an accessible name: "(empty)" for '', truncated when long. */
function spokenValue(v: string): string {
  if (v === '') {
    return '(empty)';
  }
  return v.length > MAX_NAME_VALUE ? `${v.slice(0, MAX_NAME_VALUE)}…` : v;
}
const label = (c: FieldContext) => c.fieldLabel ?? fieldLabelFor(c.field);

export interface ResolvedAction {
  id: string;
  icon: IconName;
  tooltip: string;
  ariaLabel: string;
  run: () => void;
}

interface ActionDef<C> {
  icon: IconName;
  tooltip: string;
  ariaLabel: (ctx: C) => string;
  isCompatible: (ctx: C, host: ActionHost) => boolean;
  execute: (ctx: C, host: ActionHost) => void;
}

const canFilter = (_: unknown, host: ActionHost) => !!host.addFilter;
const canFilterValue = (c: ValueContext, host: ActionHost) => !!host.addFilter && c.filterable !== false;

export type ValueActionId = 'filterFor' | 'filterOut' | 'copy' | 'expand';

const VALUE_ACTIONS: Record<ValueActionId, ActionDef<ValueContext>> = {
  filterFor: {
    icon: 'filter-plus',
    tooltip: 'Filter for value',
    ariaLabel: (c) => `Filter for ${label(c)}: ${spokenValue(c.value)}`,
    isCompatible: canFilterValue,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, c.value, '=')),
  },
  filterOut: {
    icon: 'filter-minus',
    tooltip: 'Filter out value',
    ariaLabel: (c) => `Filter out ${label(c)}: ${spokenValue(c.value)}`,
    isCompatible: canFilterValue,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, c.value, '!=')),
  },
  copy: {
    icon: 'copy',
    tooltip: 'Copy value',
    ariaLabel: (c) => `Copy value of ${label(c)}`,
    isCompatible: () => true,
    execute: (c, h) => h.copyText(c.value),
  },
  expand: {
    icon: 'expand-arrows',
    tooltip: 'Expand value',
    ariaLabel: (c) => `Expand value of ${label(c)}`,
    isCompatible: (_c, h) => !!h.expand,
    execute: (c, h) => h.expand?.(c),
  },
};

export type FieldActionId = 'exists' | 'notExists' | 'breakdown' | 'visualize';

const FIELD_ACTIONS: Record<FieldActionId, ActionDef<FieldContext>> = {
  exists: {
    icon: 'filter-plus',
    tooltip: 'Filter to rows where this field has any value',
    ariaLabel: (c) => `Filter to rows where ${label(c)} has any value`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, '', 'exists')),
  },
  notExists: {
    icon: 'filter-minus',
    tooltip: 'Filter to rows where this field is missing',
    ariaLabel: (c) => `Filter to rows where ${label(c)} is missing`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, '', 'not_exists')),
  },
  breakdown: {
    icon: 'graph-bar',
    tooltip: 'Break down histogram by this field',
    ariaLabel: (c) => `Break down histogram by ${label(c)}`,
    isCompatible: (_c, h) => !!h.setBreakdown,
    execute: (c, h) => h.setBreakdown?.(c),
  },
  visualize: {
    icon: 'chart-line',
    tooltip: 'Visualize',
    ariaLabel: (c) => `Visualize ${label(c)}`,
    isCompatible: (_c, h) => !!h.visualize,
    execute: (c, h) => h.visualize?.(c),
  },
};

function resolve<C, Id extends string>(
  defs: Record<Id, ActionDef<C>>,
  ids: readonly Id[],
  ctx: C,
  host: ActionHost
): ResolvedAction[] {
  return ids
    .filter((id) => defs[id].isCompatible(ctx, host))
    .map((id) => ({
      id,
      icon: defs[id].icon,
      tooltip: defs[id].tooltip,
      ariaLabel: defs[id].ariaLabel(ctx),
      run: () => defs[id].execute(ctx, host),
    }));
}

const ALL_VALUE_ACTIONS: readonly ValueActionId[] = ['filterFor', 'filterOut', 'copy', 'expand'];
const ALL_FIELD_ACTIONS: readonly FieldActionId[] = ['exists', 'notExists'];

/** Actions that apply to a value on this surface, in the requested order (default: all). */
export function valueActions(
  ctx: ValueContext,
  host: ActionHost,
  ids: readonly ValueActionId[] = ALL_VALUE_ACTIONS
): ResolvedAction[] {
  return resolve(VALUE_ACTIONS, ids, ctx, host);
}

/** Actions that apply to a field (not a specific value) on this surface. */
export function fieldActions(
  ctx: FieldContext,
  host: ActionHost,
  ids: readonly FieldActionId[] = ALL_FIELD_ACTIONS
): ResolvedAction[] {
  return resolve(FIELD_ACTIONS, ids, ctx, host);
}

function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    // Deprecated but still the only copy path in insecure (plain-HTTP) contexts, where
    // navigator.clipboard is unavailable.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function notify(ok: boolean): void {
  try {
    getAppEvents().publish({
      type: ok ? AppEvents.alertSuccess.name : AppEvents.alertError.name,
      payload: [ok ? 'Copied to clipboard' : 'Could not copy to clipboard'],
    });
  } catch {
    // No Grafana app events (e.g. unit tests).
  }
}

/**
 * Copy text and tell the user. Uses the async Clipboard API where available (secure contexts),
 * else the legacy execCommand path so copying also works on Grafana served over plain HTTP.
 * Never throws.
 */
export function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => notify(true),
      () => notify(legacyCopy(text))
    );
    return;
  }
  notify(legacyCopy(text));
}
