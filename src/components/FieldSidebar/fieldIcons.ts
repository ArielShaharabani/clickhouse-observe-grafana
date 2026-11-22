import { FieldType } from '../../sql/fieldModel';

// `map` and `json` used to share the same icon ('brackets-curly'), so a plain Map(String,String)
// column visually read as JSON — the reported symptom being a Map column named "A project"
// appearing to be a JSON field. Map now gets its own icon (key→value list) distinct from JSON's
// curly braces.
export const FIELD_TYPE_ICONS: Record<FieldType, string> = {
  time: 'clock-nine',
  number: 'calculator-alt',
  string: 'font',
  boolean: 'toggle-on',
  map: 'list-ul',
  json: 'brackets-curly',
  tuple: 'layer-group',
  array: 'list-ol',
  unknown: 'question-circle',
};

/** The slice of a field the source badge and type tooltip need (FieldModel, or a Visualize field). */
export interface FieldTypeInfo {
  displayName: string;
  type: FieldType | 'records';
  source?: 'column' | 'map' | 'json' | 'tuple';
  rawType?: string;
  mapColumn?: string;
  jsonColumn?: string;
}

/**
 * "Map" / "JSON" for a Map or JSON column and for each of its keys / paths, so the two container
 * kinds (and the fields that come out of them) never read alike; null for everything else.
 */
export function fieldSourceBadge(f: Pick<FieldTypeInfo, 'type' | 'source'>): 'Map' | 'JSON' | null {
  if (f.source === 'map' || (f.source === 'column' && f.type === 'map')) {
    return 'Map';
  }
  if (f.source === 'json' || (f.source === 'column' && f.type === 'json')) {
    return 'JSON';
  }
  return null;
}

/**
 * Left-hand marker icon of a field row: the Map / JSON container icon for a Map / JSON column and
 * its keys / paths (replacing the value-type icon), otherwise the icon of the field's own type.
 */
export function fieldMarkerIcon(f: Pick<FieldTypeInfo, 'type' | 'source'>): string {
  const badge = fieldSourceBadge(f);
  if (badge) {
    return badge === 'Map' ? FIELD_TYPE_ICONS.map : FIELD_TYPE_ICONS.json;
  }
  return f.type === 'records' ? 'list-ul' : (FIELD_TYPE_ICONS[f.type] ?? 'question-circle');
}

/** Hover text of a field row: its name, where it comes from, and its ClickHouse type. */
export function fieldTypeTooltip(f: FieldTypeInfo): string {
  if (f.type === 'records') {
    return f.displayName;
  }
  const origin =
    f.source === 'map'
      ? `Key of Map column ${f.mapColumn ?? ''}`.trim()
      : f.source === 'json'
        ? `Path in JSON column ${f.jsonColumn ?? ''}`.trim()
        : f.source === 'tuple'
          ? 'Tuple element'
          : f.type === 'map'
            ? 'Map column'
            : f.type === 'json'
              ? 'JSON column'
              : null;
  const chType = f.rawType ? `ClickHouse type: ${f.rawType}` : `Type: ${f.type}`;
  return [f.displayName, origin, chType].filter(Boolean).join('\n');
}
