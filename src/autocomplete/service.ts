/**
 * Shared autocomplete service (spec SHARED-AUTOCOMPLETE-01, docs/spec/30-shared.md).
 *
 * Every input that names a field, value or Map key gets its suggestions here, so the KQL bar,
 * the filter builder and the Visualize page's field pickers all behave the same way:
 * - field suggestions carry their type (for the type icon) and are filtered to what is valid in
 *   that context;
 * - value suggestions come from real data, scoped to the current time range and filters;
 * - a lookup never rejects: an unparsable search is dropped from the scope instead.
 */
import { useMemo } from 'react';
import { TimeRange } from '@grafana/data';
import { buildWhereConditions } from '../sql/queryBuilder';
import { loadFieldValues, FieldValue } from '../sql/kql/_values';
import { loadColumnKeys, KeysResult } from '../sql/keys';
import { FieldIndex } from '../sql/fields';
import { FieldModel } from '../sql/fieldModel';
import { LogsQueryState, SourceConfig } from '../types';

export interface AutocompleteScope {
  config: SourceConfig;
  /** Current search + filters; suggestions are drawn from rows matching them. */
  query: LogsQueryState;
  timeRange: TimeRange;
  fieldIndex?: FieldIndex;
}

export interface AutocompleteSources {
  /** Top values of a field expression within the scope. */
  loadValues: (sqlExpr: string) => Promise<FieldValue[]>;
  /** Keys of a Map/JSON column within the scope. */
  loadMapKeys: (mapColumn: string) => Promise<KeysResult>;
}

function scopeConditions({ config, query, fieldIndex }: AutocompleteScope): string[] {
  try {
    return buildWhereConditions(config, query, fieldIndex);
  } catch {
    // A saved search or URL query that doesn't parse yet: suggest from the filters alone rather
    // than rejecting on every keystroke.
    return buildWhereConditions(config, { ...query, search: '' }, fieldIndex);
  }
}

export function createAutocompleteSources(scope: AutocompleteScope): AutocompleteSources {
  const lookupOpts = () => ({
    table: scope.config.logsTable,
    conditions: scopeConditions(scope),
    timeRange: scope.timeRange,
    cacheKey: JSON.stringify([scope.query.search, scope.query.filters]),
  });
  return {
    loadValues: (sqlExpr) => loadFieldValues(scope.config, sqlExpr, lookupOpts()),
    loadMapKeys: (mapColumn) => loadColumnKeys(scope.config, mapColumn, lookupOpts()),
  };
}

/** React binding: stable sources for as long as the scope is unchanged. */
export function useAutocompleteSources(scope: AutocompleteScope): AutocompleteSources {
  const { config, query, timeRange, fieldIndex } = scope;
  return useMemo(
    () => createAutocompleteSources({ config, query, timeRange, fieldIndex }),
    [config, query, timeRange, fieldIndex]
  );
}

export interface RankFieldsOptions {
  /** Context filter, e.g. numeric-only for Average/Percentile, aggregatable for breakdowns. */
  allow?: (field: FieldModel) => boolean;
}

/**
 * Fields matching `prefix` (case-insensitive) for a field picker: names starting with the prefix
 * first, then names containing it, each group alphabetical. Empty prefix → all allowed fields.
 */
export function rankFields(fields: FieldModel[], prefix: string, opts: RankFieldsOptions = {}): FieldModel[] {
  const p = prefix.trim().toLowerCase();
  const allowed = opts.allow ? fields.filter(opts.allow) : fields;
  const byName = (a: FieldModel, b: FieldModel) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  if (!p) {
    return [...allowed].sort(byName);
  }
  const starts = allowed.filter((f) => f.name.toLowerCase().startsWith(p)).sort(byName);
  const contains = allowed
    .filter((f) => !f.name.toLowerCase().startsWith(p) && f.name.toLowerCase().includes(p))
    .sort(byName);
  return [...starts, ...contains];
}
