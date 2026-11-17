/**
 * Field ranking shared by every field suggestion surface (KQL bar, filter builder, Visualize
 * field pickers) — spec SHARED-AUTOCOMPLETE-01. Pure: no React or Grafana runtime imports, so the
 * KQL suggestion engine (src/sql/kql/suggest.ts) can use it directly.
 */
import { FieldModel } from '../sql/fieldModel';

export interface RankFieldsOptions {
  /** Context filter, e.g. numeric-only for Average/Percentile, aggregatable for breakdowns. */
  allow?: (field: FieldModel) => boolean;
}

/**
 * Fields whose name or display name contains `prefix` (case-insensitive), prefix matches first.
 * Both names count: a nested Map/JSON field's `name` is only the leaf key ("http.status_code"),
 * while users type what's on screen, the source-column-prefixed display name
 * ("LogAttributes.http.status_code"). Ties sort by name. Empty prefix → all allowed fields.
 */
export function rankFields(fields: FieldModel[], prefix: string, opts: RankFieldsOptions = {}): FieldModel[] {
  const lp = prefix.trim().toLowerCase();
  const allowed = opts.allow ? fields.filter(opts.allow) : fields;
  const starts = (f: FieldModel) =>
    f.name.toLowerCase().startsWith(lp) || f.displayName.toLowerCase().startsWith(lp) ? 0 : 1;
  return allowed
    .filter((f) => f.name.toLowerCase().includes(lp) || f.displayName.toLowerCase().includes(lp))
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name));
}
