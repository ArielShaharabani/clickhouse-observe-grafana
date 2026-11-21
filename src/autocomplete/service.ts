/**
 * Shared autocomplete service (spec SHARED-AUTOCOMPLETE-01, docs/spec/30-shared.md).
 *
 * Every input that names a field, value or Map key gets its suggestions here, so the KQL bar,
 * the filter builder and the Visualize page's field pickers all behave the same way:
 * - field suggestions carry their type (for the type icon) and are filtered to what is valid in
 *   that context (`rankFields`, also used by the KQL suggestion engine);
 * - value suggestions come from real data, scoped to the current time range and to the filters on
 *   other fields. The search text and filters on the same field are left out, so with
 *   `ServiceName: "frontend"` typed the other services are still offered (Kibana scopes value
 *   suggestions to the time range only);
 * - a lookup never rejects or throws: failures resolve to an empty result, and an unparsable
 *   search is dropped from the scope instead of failing the lookup.
 */
import { useMemo } from 'react';
import { TimeRange } from '@grafana/data';
import { buildWhereConditions } from '../sql/queryBuilder';
import { loadFieldValues, FieldValue } from '../sql/kql/_values';
import { loadColumnKeys, KeysResult } from '../sql/keys';
import { FieldIndex, resolveField } from '../sql/fields';
import { FilterCondGroup, FilterCondition, FilterPill, LogsQueryState, SourceConfig } from '../types';

export { rankFields } from './rankFields';
export type { RankFieldsOptions } from './rankFields';

export interface AutocompleteScope {
  config: SourceConfig;
  /** Current search + filters; suggestions are drawn from rows matching them. */
  query: Pick<LogsQueryState, 'search' | 'filters'>;
  timeRange: TimeRange;
  fieldIndex?: FieldIndex;
}

export interface AutocompleteSources {
  /** Top values of a field expression within the scope. Never rejects. */
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  /** Keys of a Map/JSON column within the scope. Never rejects. */
  loadMapKeys: (mapColumn: string) => Promise<KeysResult>;
}

const EMPTY_KEYS: KeysResult = { keys: [], total: 0 };

/** WHERE conditions for the scope, or null if even the filters alone can't be compiled. */
function scopeConditions({ config, query, fieldIndex }: AutocompleteScope): string[] | null {
  const state = { search: query.search, filters: query.filters } as LogsQueryState;
  try {
    return buildWhereConditions(config, state, fieldIndex);
  } catch {
    try {
      // A saved search or URL query that doesn't parse yet: suggest from the filters alone.
      return buildWhereConditions(config, { ...state, search: '' }, fieldIndex);
    } catch {
      return null;
    }
  }
}

function condFields(c: FilterCondition | FilterCondGroup): string[] {
  return 'items' in c ? c.items.flatMap(condFields) : [c.field];
}

/** True when the pill (or any condition of a compound pill) is on the field `sqlExpr`. */
function pillOnField(p: FilterPill, sqlExpr: string, config: SourceConfig, index?: FieldIndex): boolean {
  const fields = p.cond ? condFields(p.cond) : [p.field];
  return fields.some((f) => f === sqlExpr || resolveField(f, config, index)?.sqlExpr === sqlExpr);
}

export function createAutocompleteSources(scope: AutocompleteScope): AutocompleteSources {
  // The search text is never part of the scope: the user is usually editing it, and a clause on the
  // field being completed would leave only the value already typed.
  const scopeFor = (filters: FilterPill[]) => {
    const conditions = scopeConditions({ ...scope, query: { search: '', filters } });
    return (
      conditions && {
        table: scope.config.logsTable,
        conditions,
        timeRange: scope.timeRange,
        // Conditions depend on field discovery (Map keys / JSON paths resolve through the index), so
        // results computed before discovery finished must not be reused after it.
        cacheKey: JSON.stringify([filters, scope.fieldIndex ? 'indexed' : 'raw']),
      }
    );
  };
  // Computed once per scope (and per field for values), not per keystroke.
  const opts = scopeFor(scope.query.filters);
  const byField = new Map<string, ReturnType<typeof scopeFor>>();
  const valueOpts = (sqlExpr: string) => {
    if (!byField.has(sqlExpr)) {
      const others = scope.query.filters.filter((p) => !pillOnField(p, sqlExpr, scope.config, scope.fieldIndex));
      byField.set(sqlExpr, others.length === scope.query.filters.length ? opts : scopeFor(others));
    }
    return byField.get(sqlExpr)!;
  };
  return {
    loadValues: async (sqlExpr) => {
      const opts = valueOpts(sqlExpr);
      if (!opts) {
        return [];
      }
      try {
        return await loadFieldValues(scope.config, sqlExpr, opts);
      } catch {
        return [];
      }
    },
    loadMapKeys: async (mapColumn) => {
      if (!opts) {
        return EMPTY_KEYS;
      }
      try {
        return await loadColumnKeys(scope.config, mapColumn, opts);
      } catch {
        return EMPTY_KEYS;
      }
    },
  };
}

/** React binding: stable sources while config, search, filters, time and field index are unchanged. */
export function useAutocompleteSources(scope: AutocompleteScope): AutocompleteSources {
  const { config, timeRange, fieldIndex } = scope;
  const search = scope.query.search;
  const filters: FilterPill[] = scope.query.filters;
  return useMemo(
    () => createAutocompleteSources({ config, query: { search, filters }, timeRange, fieldIndex }),
    [config, search, filters, timeRange, fieldIndex]
  );
}
