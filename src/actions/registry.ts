/**
 * Action registry (spec SHARED-ACTION-01, docs/spec/30-shared.md).
 *
 * Each action is defined once — icon, tooltip, accessible name, when it applies and what it does —
 * and every surface (results grid, document drawer, field stats popover, field list, histogram
 * popover, and later the Visualize page) asks the registry which actions apply to a value or
 * field instead of hand-building its own buttons. Surfaces keep their own visual style; behaviour
 * and wording stay identical everywhere. Pure: no React.
 */
import { IconName } from '@grafana/ui';
import { makeFilter } from '../sql/filters';
import { FilterPill } from '../types';

/** What a surface can do. A surface without `addFilter` is read-only (copy only). */
export interface ActionHost {
  addFilter?: (pill: FilterPill) => void;
  copyText: (text: string) => void;
}

export interface ValueContext {
  /** SQL expression of the field (what a filter pill stores). */
  field: string;
  /** Name shown to the user. */
  fieldLabel: string;
  /** The value as text. */
  value: string;
}

export type FieldContext = Omit<ValueContext, 'value'>;

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

export type ValueActionId = 'filterFor' | 'filterOut' | 'copy';

const VALUE_ACTIONS: Record<ValueActionId, ActionDef<ValueContext>> = {
  filterFor: {
    icon: 'filter-plus',
    tooltip: 'Filter for value',
    ariaLabel: (c) => `Filter for ${c.fieldLabel}: ${c.value}`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, c.value, '=')),
  },
  filterOut: {
    icon: 'filter-minus',
    tooltip: 'Filter out value',
    ariaLabel: (c) => `Filter out ${c.fieldLabel}: ${c.value}`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, c.value, '!=')),
  },
  copy: {
    icon: 'copy',
    tooltip: 'Copy value',
    ariaLabel: (c) => `Copy value of ${c.fieldLabel}`,
    isCompatible: () => true,
    execute: (c, h) => h.copyText(c.value),
  },
};

export type FieldActionId = 'exists' | 'notExists';

const FIELD_ACTIONS: Record<FieldActionId, ActionDef<FieldContext>> = {
  exists: {
    icon: 'filter-plus',
    tooltip: 'Filter to rows where this field has any value',
    ariaLabel: (c) => `Filter for ${c.fieldLabel} exists`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, '', 'exists')),
  },
  notExists: {
    icon: 'filter-minus',
    tooltip: 'Filter to rows where this field is missing',
    ariaLabel: (c) => `Filter for ${c.fieldLabel} does not exist`,
    isCompatible: canFilter,
    execute: (c, h) => h.addFilter?.(makeFilter(c.field, '', 'not_exists')),
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

const ALL_VALUE_ACTIONS: readonly ValueActionId[] = ['filterFor', 'filterOut', 'copy'];
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

/** Clipboard write that never throws (insecure contexts / denied permission). */
export function copyToClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text).catch(() => undefined);
  } catch {
    // Clipboard API unavailable — nothing to do.
  }
}
